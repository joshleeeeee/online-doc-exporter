import { runtimeState } from './state'

export async function saveState() {
    try {
        await chrome.storage.local.set({
            batchQueue: runtimeState.BATCH_QUEUE,
            processedResults: runtimeState.processedResults,
            isProcessing: runtimeState.isProcessing,
            isPaused: runtimeState.isPaused
        })
    } catch (err: any) {
        console.error('[Batch] saveState failed:', err?.message || err)
    }
}

export async function removeStorageKeys(keys: string[]) {
    if (!keys.length) return
    try {
        await chrome.storage.local.remove(keys)
    } catch (err: any) {
        console.warn('[Batch] remove storage keys failed:', err?.message || err)
    }
}
