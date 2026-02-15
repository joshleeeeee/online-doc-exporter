import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { detectPlatformByUrl } from '../platformRegistry'

export interface OssConfig {
    provider: string
    endpoint: string
    accessKeyId: string
    accessKeySecret: string
    bucket: string
    region: string
    domain: string
    folder: string
}

export const useSettingsStore = defineStore('settings', () => {
    // --- States ---
    const imageMode = ref(localStorage.getItem('feishu-copy-image-mode') || 'local')
    const foreground = ref(localStorage.getItem('feishu-copy-foreground') === 'true')
    const mergeBatch = ref(localStorage.getItem('feishu-copy-merge-batch') === 'true')
    const scrollWaitTime = ref(parseInt(localStorage.getItem('feishu-copy-scroll-speed') || '1500'))
    const batchConcurrency = ref(Math.max(1, Math.min(3, parseInt(localStorage.getItem('feishu-copy-batch-concurrency') || '1'))))
    const reviewMinRating = ref(Math.max(0, Math.min(5, Number(localStorage.getItem('feishu-copy-review-min-rating') || '0'))))
    const reviewWithImagesOnly = ref(localStorage.getItem('feishu-copy-review-with-images-only') === 'true')
    const reviewMaxCount = ref(Math.max(0, Math.min(2000, parseInt(localStorage.getItem('feishu-copy-review-max-count') || '100'))))
    const reviewRecentDays = ref(Math.max(0, Math.min(3650, parseInt(localStorage.getItem('feishu-copy-review-recent-days') || '0'))))
    const reviewMaxPages = ref(Math.max(1, Math.min(50, parseInt(localStorage.getItem('feishu-copy-review-max-pages') || '1'))))

    const ossConfig = ref<OssConfig>(JSON.parse(localStorage.getItem('feishu-copy-oss-config') || '{}'))
    if (!ossConfig.value.provider) {
        ossConfig.value = {
            provider: 'aliyun',
            endpoint: '',
            accessKeyId: '',
            accessKeySecret: '',
            bucket: '',
            region: '',
            domain: '',
            folder: ''
        }
    }

    // --- Watchers for Persistence ---
    watch(imageMode, (val) => localStorage.setItem('feishu-copy-image-mode', val))
    watch(foreground, (val) => localStorage.setItem('feishu-copy-foreground', String(val)))
    watch(mergeBatch, (val) => localStorage.setItem('feishu-copy-merge-batch', String(val)))
    watch(scrollWaitTime, (val) => localStorage.setItem('feishu-copy-scroll-speed', String(val)))
    watch(reviewMinRating, (val) => {
        const normalized = Math.max(0, Math.min(5, Number(val) || 0))
        if (normalized !== val) {
            reviewMinRating.value = normalized
            return
        }
        localStorage.setItem('feishu-copy-review-min-rating', String(normalized))
    }, { immediate: true })
    watch(reviewWithImagesOnly, (val) => localStorage.setItem('feishu-copy-review-with-images-only', String(val)))
    watch(reviewMaxCount, (val) => {
        const normalized = Math.max(0, Math.min(2000, Number(val) || 0))
        if (normalized !== val) {
            reviewMaxCount.value = normalized
            return
        }
        localStorage.setItem('feishu-copy-review-max-count', String(normalized))
    }, { immediate: true })
    watch(reviewRecentDays, (val) => {
        const normalized = Math.max(0, Math.min(3650, Number(val) || 0))
        if (normalized !== val) {
            reviewRecentDays.value = normalized
            return
        }
        localStorage.setItem('feishu-copy-review-recent-days', String(normalized))
    }, { immediate: true })
    watch(reviewMaxPages, (val) => {
        const normalized = Math.max(1, Math.min(50, Number(val) || 1))
        if (normalized !== val) {
            reviewMaxPages.value = normalized
            return
        }
        localStorage.setItem('feishu-copy-review-max-pages', String(normalized))
    }, { immediate: true })
    const syncBatchConcurrencyToBackground = (val: number) => {
        const normalized = Math.max(1, Math.min(3, val))
        chrome.runtime.sendMessage({
            action: 'SET_BATCH_CONCURRENCY',
            value: normalized
        }, () => {
            // Consume runtime error in case service worker is sleeping or reloading
            void chrome.runtime.lastError
        })
    }

    watch(batchConcurrency, (val) => {
        const normalized = Math.max(1, Math.min(3, val))
        localStorage.setItem('feishu-copy-batch-concurrency', String(normalized))
        syncBatchConcurrencyToBackground(normalized)
    }, { immediate: true })
    watch(ossConfig, (val) => localStorage.setItem('feishu-copy-oss-config', JSON.stringify(val)), { deep: true })

    // --- Actions ---
    const setMergeBatchContextAware = async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        if (tab && tab.url) {
            const platform = detectPlatformByUrl(tab.url)
            if (platform) {
                mergeBatch.value = platform.defaults.mergeBatch
            }
        }
    }

    return {
        imageMode,
        foreground,
        mergeBatch,
        scrollWaitTime,
        batchConcurrency,
        reviewMinRating,
        reviewWithImagesOnly,
        reviewMaxCount,
        reviewRecentDays,
        reviewMaxPages,
        ossConfig,
        setMergeBatchContextAware
    }
})
