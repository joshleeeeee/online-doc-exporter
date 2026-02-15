import { handleRuntimeMessage } from './messageHandlers'
import { ensureProcessing } from './processor'
import { syncRuntimeState, updateConfiguredConcurrencyFromOptions } from './runtime'
import { runtimeState } from './state'
import { saveState } from './storage'
import type { BatchItem } from './types'

export type { BatchItem } from './types'

const preparePromise = new Promise<void>((resolve) => {
    chrome.storage.local.get(['batchQueue', 'processedResults', 'isProcessing', 'isPaused'], (data) => {
        if (data && data.batchQueue && Array.isArray(data.batchQueue)) {
            runtimeState.BATCH_QUEUE = data.batchQueue as BatchItem[]
        }
        if (data.processedResults && Array.isArray(data.processedResults)) {
            runtimeState.processedResults = data.processedResults
            let needsSave = false
            runtimeState.processedResults.forEach(item => {
                if (item.status === 'success' && (item.size === undefined || item.size === 0)) {
                    let s = (item.content ? item.content.length : 0)
                    if (item.images) {
                        item.images.forEach(img => {
                            if (img.base64) s += (img.base64.length * 0.75)
                        })
                    }
                    item.size = Math.round(s)
                    needsSave = true
                }
            })
            if (needsSave) saveState()
        }
        if (data.isPaused !== undefined) runtimeState.isPaused = !!data.isPaused

        updateConfiguredConcurrencyFromOptions(runtimeState.BATCH_QUEUE[0]?.options)

        if (data && data.isProcessing && runtimeState.BATCH_QUEUE.length > 0 && !runtimeState.isPaused) {
            void ensureProcessing()
        }
        syncRuntimeState()
        runtimeState.isReady = true
        resolve()
    })
})

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    preparePromise.then(async () => {
        try {
            const response = await handleRuntimeMessage(request)
            if (response !== undefined) {
                sendResponse(response)
            }
        } catch (err: any) {
            sendResponse({ success: false, error: err?.message || String(err) })
        }
    })
    return true
})
