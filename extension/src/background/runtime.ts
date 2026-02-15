import { runtimeState } from './state'
import type { BatchItem } from './types'

const MAX_BATCH_CONCURRENCY = 3
const THROTTLE_COOLDOWN_MS = 45_000
const STORAGE_THROTTLE_LV1_BYTES = 350 * 1024 * 1024
const STORAGE_THROTTLE_LV2_BYTES = 650 * 1024 * 1024

let configuredConcurrency = 1
let throttledConcurrency = 1
let throttleCooldownUntil = 0

function normalizeBatchConcurrency(value: any): number {
    const n = Number(value)
    if (!Number.isFinite(n)) return 1
    return Math.max(1, Math.min(MAX_BATCH_CONCURRENCY, Math.round(n)))
}

export function updateConfiguredConcurrencyFromOptions(options?: any) {
    const next = normalizeBatchConcurrency(options?.batchConcurrency)
    configuredConcurrency = next
    throttledConcurrency = Math.min(throttledConcurrency, configuredConcurrency)
    if (throttledConcurrency < 1) throttledConcurrency = 1
}

export function updateConfiguredConcurrency(value: any) {
    updateConfiguredConcurrencyFromOptions({ batchConcurrency: value })
}

function getStoredResultBytes() {
    return runtimeState.processedResults.reduce((sum, item) => sum + (item.size || 0), 0)
}

export function getConfiguredConcurrency() {
    return configuredConcurrency
}

export function getEffectiveConcurrency() {
    const now = Date.now()
    if (now > throttleCooldownUntil && throttledConcurrency < configuredConcurrency) {
        throttledConcurrency += 1
    }

    let limit = Math.min(configuredConcurrency, throttledConcurrency)
    const storedBytes = getStoredResultBytes()

    if (storedBytes > STORAGE_THROTTLE_LV2_BYTES) {
        limit = 1
    } else if (storedBytes > STORAGE_THROTTLE_LV1_BYTES) {
        limit = Math.min(limit, 2)
    }

    return Math.max(1, Math.min(MAX_BATCH_CONCURRENCY, limit))
}

export function recordTaskOutcome(success: boolean) {
    if (success) return
    throttledConcurrency = Math.max(1, throttledConcurrency - 1)
    throttleCooldownUntil = Date.now() + THROTTLE_COOLDOWN_MS
}

export function syncRuntimeState() {
    const firstActive = runtimeState.activeTasks.values().next().value as { item: BatchItem; tabId: number | null } | undefined
    runtimeState.currentItem = firstActive?.item || null
    runtimeState.currentTabId = firstActive?.tabId ?? null
    runtimeState.isProcessing = runtimeState.activeTasks.size > 0 || runtimeState.BATCH_QUEUE.length > 0
}

export function isTaskCancelled(url: string) {
    return runtimeState.isPaused || runtimeState.cancelledTaskUrls.has(url)
}

export function collectArchiveStorageKeys(items: BatchItem[]) {
    return items
        .map(item => item.archiveStorageKey)
        .filter((k): k is string => !!k)
}
