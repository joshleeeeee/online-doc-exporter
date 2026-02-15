import { onMounted, onUnmounted } from 'vue'

type UpdateStatus = () => Promise<unknown> | unknown;

export function useBatchStatusPolling(updateStatus: UpdateStatus, intervalMs = 2000) {
    let timer: number | null = null

    const refresh = () => {
        void Promise.resolve(updateStatus())
    }

    const stop = () => {
        if (timer !== null) {
            window.clearInterval(timer)
            timer = null
        }
    }

    onMounted(() => {
        refresh()
        timer = window.setInterval(() => refresh(), intervalMs)
    })

    onUnmounted(() => {
        stop()
    })

    return {
        refresh,
        stop
    }
}
