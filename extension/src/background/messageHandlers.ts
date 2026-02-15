import { generatePDF } from './pdf'
import { cancelActiveTasks, ensureProcessing } from './processor'
import {
    collectArchiveStorageKeys,
    getConfiguredConcurrency,
    getEffectiveConcurrency,
    syncRuntimeState,
    updateConfiguredConcurrency,
    updateConfiguredConcurrencyFromOptions
} from './runtime'
import { runtimeState } from './state'
import { removeStorageKeys, saveState } from './storage'

export async function handleRuntimeMessage(request: any): Promise<any> {
    if (request.action === 'START_BATCH_PROCESS') {
        const { items, format, options } = request
        if (!items || !items.length) {
            return { success: false, error: 'No Items' }
        }

        updateConfiguredConcurrencyFromOptions(options)

        items.forEach((item: any) => {
            const isInQueue = runtimeState.BATCH_QUEUE.some(q => q.url === item.url)
            const isCurrent = runtimeState.activeTasks.has(item.url)
            if (!isInQueue && !isCurrent) {
                runtimeState.BATCH_QUEUE.push({
                    url: item.url,
                    title: item.title,
                    taskType: item.taskType || options?.taskType || 'doc',
                    format,
                    options,
                    status: 'pending'
                })
            }
        })

        runtimeState.isPaused = false
        await ensureProcessing()
        return { success: true, message: 'Started' }
    }

    if (request.action === 'SET_BATCH_CONCURRENCY') {
        updateConfiguredConcurrency(request.value)
        await ensureProcessing()
        return {
            success: true,
            configuredConcurrency: getConfiguredConcurrency(),
            effectiveConcurrency: getEffectiveConcurrency()
        }
    }

    if (request.action === 'GET_BATCH_STATUS') {
        const lightResults = runtimeState.processedResults.map(r => ({
            url: r.url,
            title: r.title,
            taskType: r.taskType,
            format: r.format,
            size: r.size || 0,
            status: r.status,
            timestamp: r.timestamp,
            error: r.error
        }))
        return {
            isProcessing: runtimeState.isProcessing,
            isPaused: runtimeState.isPaused,
            queueLength: runtimeState.BATCH_QUEUE.length,
            results: lightResults,
            currentItem: runtimeState.currentItem,
            activeCount: runtimeState.activeTasks.size,
            configuredConcurrency: getConfiguredConcurrency(),
            effectiveConcurrency: getEffectiveConcurrency()
        }
    }

    if (request.action === 'GET_FULL_RESULTS') {
        const { urls } = request
        const fullItems = runtimeState.processedResults.filter(r => urls.includes(r.url))
        return { success: true, data: fullItems }
    }

    if (request.action === 'PAUSE_BATCH') {
        runtimeState.isPaused = true
        await cancelActiveTasks()
        syncRuntimeState()
        await saveState()
        return { success: true }
    }

    if (request.action === 'RESUME_BATCH') {
        runtimeState.isPaused = false
        await ensureProcessing()
        return { success: true }
    }

    if (request.action === 'CLEAR_BATCH_RESULTS') {
        await cancelActiveTasks()
        await removeStorageKeys(collectArchiveStorageKeys(runtimeState.processedResults))
        runtimeState.processedResults = []
        runtimeState.BATCH_QUEUE = []
        runtimeState.isPaused = false
        runtimeState.activeTasks.clear()
        runtimeState.cancelledTaskUrls.clear()
        syncRuntimeState()
        await saveState()
        return { success: true }
    }

    if (request.action === 'DELETE_BATCH_ITEM') {
        const { url } = request
        const targets = runtimeState.processedResults.filter(item => item.url === url)
        await removeStorageKeys(collectArchiveStorageKeys(targets))
        runtimeState.processedResults = runtimeState.processedResults.filter(item => item.url !== url)
        runtimeState.BATCH_QUEUE = runtimeState.BATCH_QUEUE.filter(item => item.url !== url)

        const running = runtimeState.activeTasks.get(url)
        if (running) {
            runtimeState.cancelledTaskUrls.add(url)
            if (running.tabId) {
                try { await chrome.tabs.remove(running.tabId) } catch (_) { }
            }
        }

        syncRuntimeState()
        await saveState()
        return { success: true }
    }

    if (request.action === 'RETRY_BATCH_ITEM') {
        const { url } = request
        const failedItem = runtimeState.processedResults.find(r => r.url === url && r.status === 'failed')
        if (failedItem) {
            runtimeState.processedResults = runtimeState.processedResults.filter(r => r.url !== url)
            runtimeState.BATCH_QUEUE.push({
                url: failedItem.url,
                title: failedItem.title,
                taskType: failedItem.taskType || failedItem.options?.taskType || 'doc',
                format: failedItem.format,
                options: failedItem.options,
                status: 'pending'
            })
            runtimeState.isPaused = false
            updateConfiguredConcurrencyFromOptions(failedItem.options)
            await ensureProcessing()
            return { success: true }
        }
        return { success: false, error: 'Item not found or not failed' }
    }

    if (request.action === 'RETRY_ALL_FAILED') {
        const failedItems = runtimeState.processedResults.filter(r => r.status === 'failed')
        if (failedItems.length > 0) {
            runtimeState.processedResults = runtimeState.processedResults.filter(r => r.status !== 'failed')
            failedItems.forEach(item => {
                runtimeState.BATCH_QUEUE.push({
                    url: item.url,
                    title: item.title,
                    taskType: item.taskType || item.options?.taskType || 'doc',
                    format: item.format,
                    options: item.options,
                    status: 'pending'
                })
            })
            runtimeState.isPaused = false
            if (failedItems[0]) {
                updateConfiguredConcurrencyFromOptions(failedItems[0].options)
            }
            await ensureProcessing()
        }
        return { success: true, count: failedItems.length }
    }

    if (request.action === 'GENERATE_PDF') {
        const { title } = request
        return await generatePDF(title)
    }

    if (request.action === 'EXTRACTION_PROGRESS') {
        const requestId = String(request.requestId || '')
        const taskUrl = runtimeState.extractionRequestToUrl.get(requestId)
        if (taskUrl) {
            const running = runtimeState.activeTasks.get(taskUrl)
            if (running) {
                const total = Number(request.total)
                const round = Number(request.round)
                const added = Number(request.added)
                const maxRounds = Number(request.maxRounds)
                const message = typeof request.message === 'string' ? request.message : ''

                if (Number.isFinite(total) && total >= 0) running.item.progressTotal = total
                if (Number.isFinite(round) && round >= 0) running.item.progressRound = round
                if (Number.isFinite(added) && added >= 0) running.item.progressAdded = added
                if (Number.isFinite(maxRounds) && maxRounds > 0) running.item.progressMaxRounds = maxRounds
                if (message) running.item.progressMessage = message

                syncRuntimeState()

                const now = Date.now()
                if (request.done || now - runtimeState.lastProgressPersistAt > 1500) {
                    runtimeState.lastProgressPersistAt = now
                    await saveState()
                }
            }
        }
        return { success: true }
    }

    return undefined
}
