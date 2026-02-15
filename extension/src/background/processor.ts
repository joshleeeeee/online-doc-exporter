import { normalizeExportTitle, sanitizeFilename } from './exportUtils'
import { generateBatchPDF } from './pdf'
import {
    getEffectiveConcurrency,
    isTaskCancelled,
    recordTaskOutcome,
    syncRuntimeState
} from './runtime'
import { runtimeState } from './state'
import { saveState } from './storage'
import { waitForTabLoad } from './tabUtils'
import type { BatchItem } from './types'

const EXTRACT_TIMEOUT_DEFAULT_MS = 6 * 60_000
const EXTRACT_TIMEOUT_LOCAL_IMAGE_MS = 12 * 60_000

function shouldForceForegroundForTask(item: BatchItem) {
    if (item.taskType !== 'review') return false

    const url = item.url || ''
    try {
        const parsed = new URL(url)
        const host = parsed.hostname.toLowerCase()
        return host.includes('jd.com')
            || host.includes('jd.hk')
            || host.includes('taobao.com')
            || host.includes('tmall.com')
    } catch (_) {
        const lowered = String(url).toLowerCase()
        return lowered.includes('jd.com')
            || lowered.includes('jd.hk')
            || lowered.includes('taobao.com')
            || lowered.includes('tmall.com')
    }
}

async function sendExtractMessage(tabId: number, payload: any, timeoutMs: number) {
    return await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Extraction timeout after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs)
        chrome.tabs.sendMessage(tabId, payload)
            .then((res) => {
                clearTimeout(timer)
                resolve(res)
            })
            .catch((err) => {
                clearTimeout(timer)
                reject(err)
            })
    })
}

export async function cancelActiveTasks() {
    const tabsToClose: number[] = []
    for (const [url, task] of runtimeState.activeTasks.entries()) {
        runtimeState.cancelledTaskUrls.add(url)
        if (task.tabId) tabsToClose.push(task.tabId)
    }

    await Promise.all(tabsToClose.map(async (tabId) => {
        try { await chrome.tabs.remove(tabId) } catch (_) { }
    }))
}

export async function ensureProcessing() {
    if (runtimeState.isPaused) {
        syncRuntimeState()
        await saveState()
        return
    }

    let spawned = false
    while (runtimeState.BATCH_QUEUE.length > 0 && runtimeState.activeTasks.size < getEffectiveConcurrency()) {
        const next = runtimeState.BATCH_QUEUE.shift()
        if (!next) break
        spawned = true
        void runBatchItem(next)
    }

    syncRuntimeState()
    if (spawned || !runtimeState.isProcessing) {
        await saveState()
    }
}

async function runBatchItem(item: BatchItem) {
    const taskUrl = item.url
    const taskType = item.taskType || item.options?.taskType || 'doc'
    const extractRequestId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const forceForeground = shouldForceForegroundForTask(item)
    let tabId: number | null = null
    let success = false

    item.progressStartedAt = Date.now()
    item.progressRound = 0
    item.progressAdded = 0
    item.progressTotal = 0
    item.progressMessage = taskType === 'review' ? '正在准备抓取评论区...' : '正在准备抓取内容...'
    if (forceForeground) {
        item.strategyHint = '已强制前台运行（电商评论）'
    }

    runtimeState.activeTasks.set(taskUrl, {
        item,
        tabId: null,
        startedAt: Date.now()
    })
    runtimeState.extractionRequestToUrl.set(extractRequestId, taskUrl)
    const taskSnapshot = runtimeState.activeTasks.get(taskUrl)
    if (taskSnapshot) {
        taskSnapshot.item.options = {
            ...(taskSnapshot.item.options || {}),
            extractRequestId
        }
    }
    syncRuntimeState()
    await saveState()

    try {
        const isForeground = forceForeground || !!(item.options && item.options.foreground)
        const tab = await chrome.tabs.create({ url: taskUrl, active: !!isForeground })
        tabId = tab.id || null

        const task = runtimeState.activeTasks.get(taskUrl)
        if (task) task.tabId = tabId
        syncRuntimeState()

        if (!tabId) throw new Error('Tab create failed')
        if (isTaskCancelled(taskUrl)) throw new Error('Cancelled')

        await waitForTabLoad(tabId)
        if (isTaskCancelled(taskUrl)) throw new Error('Cancelled')

        await new Promise(r => setTimeout(r, 4000))
        if (isTaskCancelled(taskUrl)) throw new Error('Cancelled')

        const isPdfFormat = item.format === 'pdf'
        const isLocalArchiveMode = !isPdfFormat && taskType === 'doc' && item.options?.imageMode === 'local'
        const extractTimeoutMs = item.options?.imageMode === 'local'
            ? EXTRACT_TIMEOUT_LOCAL_IMAGE_MS
            : EXTRACT_TIMEOUT_DEFAULT_MS
        let response: any = null
        let lastExtractError: any = null
        for (let i = 0; i < 3; i++) {
            try {
                if (isTaskCancelled(taskUrl)) break
                console.log(`[Batch] Extract start (${i + 1}/3): ${taskUrl}`)
                response = await sendExtractMessage(tabId, {
                    action: isLocalArchiveMode ? 'EXTRACT_LOCAL_ARCHIVE' : 'EXTRACT_CONTENT',
                    format: isPdfFormat ? 'html' : (item.format || 'markdown'),
                    options: isPdfFormat
                        ? { ...item.options, imageMode: 'base64', batchItemTitle: item.title, extractRequestId }
                        : { ...(item.options || { useBase64: true }), batchItemTitle: item.title, extractRequestId }
                }, extractTimeoutMs)
                console.log(`[Batch] Extract done: ${taskUrl}`)
                if (response) break
            } catch (err: any) {
                lastExtractError = err
                const msg = String(err?.message || '')
                const nonRetryable = msg.includes('归档体积过大') || msg.includes('归档打包超时') || msg.includes('归档编码超时')
                console.warn(`[Batch] Extract failed (${i + 1}/3): ${taskUrl}`, msg)
                if (nonRetryable) break
                await new Promise(r => setTimeout(r, 2000))
            }
        }

        if (isTaskCancelled(taskUrl)) throw new Error('Cancelled')
        if (!response || !response.success) {
            throw new Error(response ? response.error : (lastExtractError?.message || 'Extraction failed'))
        }

        let title = item.title || 'Untitled'
        if (response.content) {
            if (isPdfFormat || item.format === 'html') {
                const match = response.content.match(/<h1>(.*?)<\/h1>/)
                if (match) title = match[1].replace(/<[^>]+>/g, '')
            } else {
                const match = response.content.match(/^#\s+(.*)/)
                if (match) title = match[1]
            }
        }

        if (title === 'Untitled' || !title) {
            try {
                const updatedTab = await chrome.tabs.get(tabId)
                title = updatedTab.title || 'Doc ' + Date.now()
            } catch (_) {
                title = 'Doc ' + Date.now()
            }
        }

        const normalizedTitle = normalizeExportTitle(title.trim()) || title.trim() || 'document'
        const safeFilenameTitle = sanitizeFilename(normalizedTitle)

        if (isPdfFormat) {
            const pdfResult = await generateBatchPDF(response.content, normalizedTitle)
            if (!pdfResult.success || !pdfResult.data) {
                throw new Error(pdfResult.error || 'PDF generation failed')
            }

            runtimeState.processedResults.push({
                url: taskUrl,
                title: normalizedTitle,
                taskType,
                format: 'pdf',
                content: pdfResult.data,
                size: Math.round(pdfResult.data.length * 0.75),
                status: 'success',
                timestamp: Date.now()
            })
        } else if (isLocalArchiveMode) {
            if (!response.archiveBase64 && !response.archiveStorageKey) {
                throw new Error('Local archive generation failed')
            }

            runtimeState.processedResults.push({
                url: taskUrl,
                title: normalizedTitle,
                taskType,
                format: item.format || 'markdown',
                archiveBase64: response.archiveBase64,
                archiveStorageKey: response.archiveStorageKey,
                archiveName: `${safeFilenameTitle}.zip`,
                size: response.archiveSize || Math.round((response.archiveBase64?.length || 0) * 0.75),
                status: 'success',
                timestamp: Date.now()
            })
        } else {
            const calculatedSize = Math.round((response.content ? response.content.length : 0) +
                (response.images ? response.images.reduce((sum: number, img: any) => sum + (img.base64 ? img.base64.length * 0.75 : 0), 0) : 0))

            runtimeState.processedResults.push({
                url: taskUrl,
                title: normalizedTitle,
                taskType,
                format: item.format || 'markdown',
                content: response.content,
                images: response.images || [],
                size: calculatedSize,
                status: 'success',
                timestamp: Date.now()
            })
        }

        success = true
    } catch (err: any) {
        if (err.message !== 'Cancelled' && !runtimeState.cancelledTaskUrls.has(taskUrl)) {
            runtimeState.processedResults.push({
                url: taskUrl,
                title: item.title || 'Failed Item',
                taskType,
                format: item.format,
                options: item.options,
                status: 'failed',
                error: err.message,
                timestamp: Date.now()
            })
        }
    } finally {
        if (tabId) {
            try { await chrome.tabs.remove(tabId) } catch (_) { }
        }

        runtimeState.extractionRequestToUrl.delete(extractRequestId)
        runtimeState.activeTasks.delete(taskUrl)
        runtimeState.cancelledTaskUrls.delete(taskUrl)
        recordTaskOutcome(success)
        syncRuntimeState()
        await saveState()

        if (!runtimeState.isPaused) {
            setTimeout(() => { void ensureProcessing() }, 300)
        }
    }
}
