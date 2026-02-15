import { ref } from 'vue'
import { detectPlatformPageContextByUrl, type PlatformPageContext, type PlatformProfile } from '../platformRegistry'

export function useSupportDetection() {
    const isSupported = ref(false)
    const supportMessage = ref('正在检测网页支持情况...')
    const isDetecting = ref(true)
    const activePlatform = ref<PlatformProfile | null>(null)
    const activePageContext = ref<PlatformPageContext | null>(null)
    const activeUrl = ref('')

    const detectByUrl = (url: string) => {
        const pageContext = detectPlatformPageContextByUrl(url)
        if (pageContext) {
            return {
                supported: true,
                message: pageContext.supportMessage,
                platform: pageContext.platform,
                pageContext
            }
        }
        return {
            supported: false,
            message: '当前网页不受支持',
            platform: null,
            pageContext: null
        }
    }

    const checkSupport = async () => {
        isDetecting.value = true
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
            if (!tab?.url) {
                isSupported.value = false
                supportMessage.value = '无法获取网页信息'
                activePlatform.value = null
                activePageContext.value = null
                activeUrl.value = ''
                return
            }

            const result = detectByUrl(tab.url)
            isSupported.value = result.supported
            supportMessage.value = result.message
            activePlatform.value = result.platform
            activePageContext.value = result.pageContext
            activeUrl.value = tab.url
        } catch (_) {
            isSupported.value = false
            supportMessage.value = '无法获取网页信息'
            activePlatform.value = null
            activePageContext.value = null
            activeUrl.value = ''
        } finally {
            isDetecting.value = false
        }
    }

    return {
        isSupported,
        supportMessage,
        isDetecting,
        activePlatform,
        activePageContext,
        activeUrl,
        checkSupport
    }
}
