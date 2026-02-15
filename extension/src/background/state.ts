import type { BatchItem } from './types'

export interface ActiveTaskEntry {
    item: BatchItem
    tabId: number | null
    startedAt: number
}

export interface BatchRuntimeState {
    BATCH_QUEUE: BatchItem[]
    isProcessing: boolean
    isPaused: boolean
    processedResults: BatchItem[]
    currentItem: BatchItem | null
    currentTabId: number | null
    isReady: boolean
    activeTasks: Map<string, ActiveTaskEntry>
    cancelledTaskUrls: Set<string>
    extractionRequestToUrl: Map<string, string>
    lastProgressPersistAt: number
}

export const runtimeState: BatchRuntimeState = {
    BATCH_QUEUE: [],
    isProcessing: false,
    isPaused: false,
    processedResults: [],
    currentItem: null,
    currentTabId: null,
    isReady: false,
    activeTasks: new Map(),
    cancelledTaskUrls: new Set(),
    extractionRequestToUrl: new Map(),
    lastProgressPersistAt: 0
}
