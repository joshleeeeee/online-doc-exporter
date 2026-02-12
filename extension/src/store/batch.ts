import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface BatchItem {
    url: string
    title: string
    format?: string
    options?: any
    status?: 'pending' | 'processing' | 'success' | 'failed'
    size?: number
    error?: string
    archiveBase64?: string
    archiveName?: string
    archiveStorageKey?: string
}

export const useBatchStore = defineStore('batch', () => {
    const scannedLinks = ref<BatchItem[]>([])
    const processedResults = ref<BatchItem[]>([])
    const isProcessing = ref(false)
    const isPaused = ref(false)
    const currentItem = ref<BatchItem | null>(null)
    const queueLength = ref(0)
    const progressPercent = ref(0)
    const activeCount = ref(0)
    const effectiveConcurrency = ref(1)
    const isUpdatingStatus = ref(false)
    const hasLoadedStatus = ref(false)
    const isPausing = ref(false)
    const isResuming = ref(false)
    const isRetryingAll = ref(false)
    const retryingUrls = ref<Set<string>>(new Set())

    const sendMessage = <T = any>(payload: any) => {
        return new Promise<T>((resolve) => {
            chrome.runtime.sendMessage(payload, (res) => resolve(res as T))
        })
    }

    const updateStatus = async () => {
        isUpdatingStatus.value = true
        return new Promise<void>((resolve) => {
            chrome.runtime.sendMessage({ action: 'GET_BATCH_STATUS' }, (res) => {
                if (res) {
                    isProcessing.value = res.isProcessing
                    isPaused.value = res.isPaused
                    processedResults.value = res.results || []
                    currentItem.value = res.currentItem || null
                    queueLength.value = res.queueLength || 0
                    activeCount.value = res.activeCount || 0
                    effectiveConcurrency.value = res.effectiveConcurrency || 1

                    const finishedCount = processedResults.value.length
                    const total = finishedCount + activeCount.value + queueLength.value

                    progressPercent.value = total > 0 ? (finishedCount / total) * 100 : 0
                }
                hasLoadedStatus.value = true
                isUpdatingStatus.value = false
                resolve()
            })
        })
    }

    const startBatch = async (items: BatchItem[], format: string, options: any) => {
        await sendMessage({
            action: 'START_BATCH_PROCESS',
            items,
            format,
            options
        })
        await updateStatus()
    }

    const pauseBatch = async () => {
        if (isPausing.value) return
        isPausing.value = true
        // Optimistic update to avoid perceived freeze.
        isPaused.value = true
        try {
            await sendMessage({ action: 'PAUSE_BATCH' })
            await updateStatus()
        } finally {
            isPausing.value = false
        }
    }

    const resumeBatch = async () => {
        if (isResuming.value) return
        isResuming.value = true
        // Optimistic update to avoid perceived freeze.
        isPaused.value = false
        try {
            await sendMessage({ action: 'RESUME_BATCH' })
            await updateStatus()
        } finally {
            isResuming.value = false
        }
    }

    const clearResults = async () => {
        await sendMessage({ action: 'CLEAR_BATCH_RESULTS' })
        processedResults.value = []
        await updateStatus()
    }

    const retryItem = async (url: string) => {
        const next = new Set(retryingUrls.value)
        next.add(url)
        retryingUrls.value = next
        try {
            await sendMessage({ action: 'RETRY_BATCH_ITEM', url })
            await updateStatus()
        } finally {
            const done = new Set(retryingUrls.value)
            done.delete(url)
            retryingUrls.value = done
        }
    }

    const retryAllFailed = async () => {
        if (isRetryingAll.value) return
        isRetryingAll.value = true
        try {
            await sendMessage({ action: 'RETRY_ALL_FAILED' })
            await updateStatus()
        } finally {
            isRetryingAll.value = false
        }
    }

    return {
        scannedLinks,
        processedResults,
        isProcessing,
        isPaused,
        currentItem,
        queueLength,
        progressPercent,
        activeCount,
        effectiveConcurrency,
        isUpdatingStatus,
        hasLoadedStatus,
        isPausing,
        isResuming,
        isRetryingAll,
        retryingUrls,
        updateStatus,
        startBatch,
        pauseBatch,
        resumeBatch,
        clearResults,
        retryItem,
        retryAllFailed
    }
})
