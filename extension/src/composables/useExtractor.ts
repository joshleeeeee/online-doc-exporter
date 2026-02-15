import { onUnmounted, ref } from 'vue'
import { useSettingsStore } from '../store/settings'
import type { TaskType } from '../platformRegistry'

interface UseExtractorOptions {
    triggerToast: (message: string) => void;
    getTaskType?: () => TaskType;
}

export function useExtractor({ triggerToast, getTaskType }: UseExtractorOptions) {
    const settings = useSettingsStore()
    const isExtracting = ref(false)
    const extractingFormat = ref('')
    const extractionProgressMessage = ref('')
    const activeRequestId = ref('')

    const handleRuntimeMessage = (message: any) => {
        if (!message || message.action !== 'EXTRACTION_PROGRESS') return
        if (!activeRequestId.value || message.requestId !== activeRequestId.value) return

        const msg = typeof message.message === 'string' ? message.message.trim() : ''
        if (msg) {
            extractionProgressMessage.value = msg
        }
    }

    if (chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.addListener(handleRuntimeMessage)
    }

    onUnmounted(() => {
        if (chrome.runtime?.onMessage) {
            chrome.runtime.onMessage.removeListener(handleRuntimeMessage)
        }
    })

    const createRequestId = () => `extract-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`

    const beginProgressTracking = (taskType: TaskType, format: string) => {
        const requestId = createRequestId()
        activeRequestId.value = requestId
        extractionProgressMessage.value = (taskType === 'review' && (format === 'csv' || format === 'json'))
            ? '正在准备评论区...'
            : ''
        return requestId
    }

    const endProgressTracking = () => {
        activeRequestId.value = ''
        extractionProgressMessage.value = ''
    }

    const sendExtractMessage = async (tabId: number, payload: any, timeoutMs: number) => {
        return await new Promise<any>((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error(`抓取超时（${Math.round(timeoutMs / 1000)}秒）`)), timeoutMs)
            chrome.tabs.sendMessage(tabId, payload)
                .then((res) => {
                    window.clearTimeout(timer)
                    resolve(res)
                })
                .catch((err) => {
                    window.clearTimeout(timer)
                    reject(err)
                })
        })
    }

    const copyToClipboard = async (text: string, html: string | null = null) => {
        try {
            if (html) {
                const blobHtml = new Blob([html], { type: 'text/html' })
                const blobText = new Blob([text], { type: 'text/plain' })
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': blobHtml,
                        'text/plain': blobText
                    })
                ])
            } else {
                await navigator.clipboard.writeText(text)
            }
            return true
        } catch (err) {
            console.error('Clipboard write failed', err)
            return false
        }
    }

    const executeCopy = async (format: 'markdown' | 'html' | 'csv' | 'json') => {
        if (isExtracting.value) return

        isExtracting.value = true
        extractingFormat.value = format
        const taskType = getTaskType ? getTaskType() : 'doc'
        const requestId = beginProgressTracking(taskType, format)

        const imageMode = settings.imageMode
        const scrollWaitTime = settings.scrollWaitTime
        const ossConfig = settings.ossConfig
        const imageConfig = {
            enabled: (imageMode === 'minio'),
            ...ossConfig
        }
        const reviewOptions = {
            reviewMinRating: settings.reviewMinRating,
            reviewWithImagesOnly: settings.reviewWithImagesOnly,
            reviewMaxCount: settings.reviewMaxCount,
            reviewRecentDays: settings.reviewRecentDays,
            reviewMaxPages: settings.reviewMaxPages
        }

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab?.id) throw new Error('找不到活动标签页')

            if (imageMode === 'local') {
                const response = await sendExtractMessage(tab.id, {
                    action: 'EXTRACT_AND_DOWNLOAD_LOCAL',
                    format,
                    options: { imageMode, scrollWaitTime, imageConfig, taskType, extractRequestId: requestId, ...reviewOptions }
                }, 15 * 60 * 1000)

                if (response && response.success) {
                    if (response.hasImages) {
                        triggerToast(`已下载 ZIP（图片 ${response.imageCount || 0} 张）`)
                    } else {
                        let exportLabel = 'Markdown'
                        if (format === 'html') exportLabel = taskType === 'review' ? '评论 HTML' : 'HTML'
                        if (format === 'csv') exportLabel = taskType === 'review' ? '评论 CSV' : 'CSV'
                        if (format === 'json') exportLabel = taskType === 'review' ? '评论 JSON' : 'JSON'
                        if (format === 'markdown') exportLabel = taskType === 'review' ? '评论 Markdown' : 'Markdown'
                        triggerToast(`已下载 ${exportLabel} 文件`)
                    }
                    return
                }
                throw new Error(response?.error || '本地下载失败')
            }

            const timeoutMs = 6 * 60 * 1000
            const response = await sendExtractMessage(tab.id, {
                action: 'EXTRACT_CONTENT',
                format,
                options: { imageMode, scrollWaitTime, imageConfig, taskType, extractRequestId: requestId, ...reviewOptions }
            }, timeoutMs)

            if (response && response.success) {
                if (format === 'markdown') {
                    await copyToClipboard(response.content)
                    triggerToast(taskType === 'review' ? '评论 Markdown 已复制到剪贴板' : 'Markdown 已复制到剪贴板')
                } else if (format === 'html') {
                    const textFallback = response.content.replace(/<[^>]+>/g, '')
                    await copyToClipboard(textFallback, response.content)
                    triggerToast(taskType === 'review' ? '评论富文本已复制到剪贴板' : '富文本已复制到剪贴板')
                } else if (format === 'csv') {
                    await copyToClipboard(response.content)
                    triggerToast(taskType === 'review' ? '评论区 CSV 已提取并复制到剪贴板' : 'CSV 已复制到剪贴板')
                } else {
                    await copyToClipboard(response.content)
                    triggerToast(taskType === 'review' ? '评论区 JSON 已提取并复制到剪贴板' : 'JSON 已复制到剪贴板')
                }
            } else {
                throw new Error(response?.error || '解析失败')
            }
        } catch (e: any) {
            console.error(e)
            if (e.message.includes('Could not establish connection')) {
                triggerToast('插件已更新，请刷新原页面')
            } else {
                triggerToast('错误: ' + e.message)
            }
        } finally {
            isExtracting.value = false
            extractingFormat.value = ''
            endProgressTracking()
        }
    }

    const executePDF = async () => {
        if (isExtracting.value) return

        isExtracting.value = true
        extractingFormat.value = 'pdf'
        const taskType = getTaskType ? getTaskType() : 'doc'
        const requestId = beginProgressTracking(taskType, 'pdf')

        const scrollWaitTime = settings.scrollWaitTime
        const ossConfig = settings.ossConfig
        const imageConfig = {
            enabled: false,
            ...ossConfig
        }
        const reviewOptions = {
            reviewMinRating: settings.reviewMinRating,
            reviewWithImagesOnly: settings.reviewWithImagesOnly,
            reviewMaxCount: settings.reviewMaxCount,
            reviewRecentDays: settings.reviewRecentDays,
            reviewMaxPages: settings.reviewMaxPages
        }

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab?.id) throw new Error('找不到活动标签页')

            const response = await sendExtractMessage(tab.id, {
                action: 'EXTRACT_CONTENT',
                format: 'html',
                options: { imageMode: 'base64', scrollWaitTime, imageConfig, taskType, extractRequestId: requestId, ...reviewOptions }
            }, 8 * 60 * 1000)

            if (response && response.success) {
                await chrome.storage.local.set({
                    printData: {
                        title: response.title || 'document',
                        content: response.content,
                        images: response.images || []
                    }
                })

                triggerToast('PDF 正在生成中...')

                const result = await chrome.runtime.sendMessage({
                    action: 'GENERATE_PDF',
                    title: response.title || 'document'
                })

                if (result && result.success) {
                    triggerToast('PDF 已生成并下载')
                } else {
                    throw new Error(result?.error || 'PDF 生成失败')
                }
            } else {
                throw new Error(response?.error || '解析失败')
            }
        } catch (e: any) {
            console.error(e)
            if (e.message.includes('Could not establish connection')) {
                triggerToast('插件已更新，请刷新原页面')
            } else {
                triggerToast('错误: ' + e.message)
            }
        } finally {
            isExtracting.value = false
            extractingFormat.value = ''
            endProgressTracking()
        }
    }

    return {
        isExtracting,
        extractingFormat,
        extractionProgressMessage,
        executeCopy,
        executePDF
    }
}
