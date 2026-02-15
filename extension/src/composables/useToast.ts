import { ref } from 'vue'

export function useToast(defaultDurationMs = 2000) {
    const toastMsg = ref('')
    const showToast = ref(false)
    let toastTimer: number | null = null

    const clearToastTimer = () => {
        if (toastTimer !== null) {
            window.clearTimeout(toastTimer)
            toastTimer = null
        }
    }

    const triggerToast = (msg: string, durationMs = defaultDurationMs) => {
        toastMsg.value = msg
        showToast.value = true
        clearToastTimer()
        toastTimer = window.setTimeout(() => {
            showToast.value = false
            toastTimer = null
        }, durationMs)
    }

    const dismissToast = () => {
        clearToastTimer()
        showToast.value = false
    }

    return {
        toastMsg,
        showToast,
        triggerToast,
        dismissToast
    }
}
