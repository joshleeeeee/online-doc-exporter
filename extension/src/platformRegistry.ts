export type PlatformId = 'feishu' | 'boss' | 'jd' | 'taobao'

export type TaskType = 'doc' | 'review'

export type ExportFormat = 'markdown' | 'html' | 'pdf' | 'csv' | 'json'

export interface PlatformCapabilities {
    taskType: TaskType;
    supportsScanLinks: boolean;
    supportsScrollScan: boolean;
    supportsPdf: boolean;
}

export interface PlatformProfile {
    id: PlatformId;
    label: string;
    supportMessage: string;
    hostMatchers: string[];
    defaults: {
        mergeBatch: boolean;
    };
    capabilities: PlatformCapabilities;
}

export interface PlatformPageContext {
    platform: PlatformProfile;
    supportMessage: string;
    ui: {
        singleFormats: ExportFormat[];
        showBatchShortcut: boolean;
        showBatchTab: boolean;
    };
}

export const PLATFORM_REGISTRY: PlatformProfile[] = [
    {
        id: 'feishu',
        label: '飞书/Lark 文档',
        supportMessage: '支持导出：飞书/Lark 文档',
        hostMatchers: ['feishu.cn', 'larksuite.com'],
        defaults: {
            mergeBatch: false
        },
        capabilities: {
            taskType: 'doc',
            supportsScanLinks: true,
            supportsScrollScan: true,
            supportsPdf: true
        }
    },
    {
        id: 'boss',
        label: 'BOSS 直聘职位',
        supportMessage: '支持导出：BOSS 直聘职位',
        hostMatchers: ['zhipin.com'],
        defaults: {
            mergeBatch: true
        },
        capabilities: {
            taskType: 'doc',
            supportsScanLinks: true,
            supportsScrollScan: false,
            supportsPdf: true
        }
    },
    {
        id: 'jd',
        label: '京东商品评论',
        supportMessage: '支持导出：京东/淘宝商品评论',
        hostMatchers: ['jd.com', 'jd.hk'],
        defaults: {
            mergeBatch: true
        },
        capabilities: {
            taskType: 'review',
            supportsScanLinks: true,
            supportsScrollScan: true,
            supportsPdf: true
        }
    },
    {
        id: 'taobao',
        label: '淘宝/天猫商品评论',
        supportMessage: '支持导出：京东/淘宝商品评论',
        hostMatchers: ['taobao.com', 'tmall.com'],
        defaults: {
            mergeBatch: true
        },
        capabilities: {
            taskType: 'review',
            supportsScanLinks: true,
            supportsScrollScan: true,
            supportsPdf: true
        }
    }
]

const normalize = (value: string) => value.trim().toLowerCase()

const isHostMatch = (hostname: string, matcher: string) => {
    return hostname === matcher || hostname.endsWith(`.${matcher}`)
}

export function detectPlatformByHostname(hostname: string): PlatformProfile | null {
    const normalizedHostname = normalize(hostname)
    if (!normalizedHostname) return null

    for (const platform of PLATFORM_REGISTRY) {
        if (platform.hostMatchers.some((matcher) => isHostMatch(normalizedHostname, matcher))) {
            return platform
        }
    }

    return null
}

export function detectPlatformByUrl(url: string): PlatformProfile | null {
    try {
        const parsed = new URL(url)
        return detectPlatformByHostname(parsed.hostname)
    } catch (_) {
        return detectPlatformByHostname(url)
    }
}

const getDefaultSingleFormats = (taskType: TaskType): ExportFormat[] => {
    if (taskType === 'review') {
        return ['markdown', 'html', 'pdf', 'csv', 'json']
    }
    return ['markdown', 'html', 'pdf']
}

const isJdProductDetailUrl = (parsedUrl: URL) => {
    const host = parsedUrl.hostname.toLowerCase()
    const pathname = parsedUrl.pathname.toLowerCase()
    const isItemHost = host.startsWith('item.') || host.startsWith('item-')
    return isItemHost && (host.includes('jd.com') || host.includes('jd.hk')) && /\/(?:product\/)?\d+\.html$/.test(pathname)
}

const isTaobaoProductDetailUrl = (parsedUrl: URL) => {
    const host = parsedUrl.hostname.toLowerCase()
    const pathname = parsedUrl.pathname.toLowerCase()
    const isDetailHost = host.includes('item.taobao.com') || host.includes('detail.tmall.com') || host.includes('chaoshi.detail.tmall.com')
    return isDetailHost && pathname.endsWith('/item.htm') && /^\d+$/.test(parsedUrl.searchParams.get('id') || '')
}

export function detectPlatformPageContextByUrl(url: string): PlatformPageContext | null {
    let parsedUrl: URL
    try {
        parsedUrl = new URL(url)
    } catch (_) {
        return null
    }

    const platform = detectPlatformByHostname(parsedUrl.hostname)
    if (!platform) return null

    let supportMessage = platform.supportMessage
    let singleFormats = getDefaultSingleFormats(platform.capabilities.taskType)
    let showBatchShortcut = platform.capabilities.supportsScanLinks
    let showBatchTab = platform.capabilities.supportsScanLinks

    if (platform.id === 'jd' && isJdProductDetailUrl(parsedUrl)) {
        supportMessage = '当前是京东商品详情页，建议导出评论 CSV / JSON（可在批量页粘贴多个商品链接）'
        singleFormats = ['csv', 'json']
        showBatchShortcut = false
        showBatchTab = true
    }

    if (platform.id === 'taobao' && isTaobaoProductDetailUrl(parsedUrl)) {
        supportMessage = '当前是淘宝/天猫商品详情页，建议导出评论 CSV / JSON（可在批量页粘贴多个商品链接）'
        singleFormats = ['csv', 'json']
        showBatchShortcut = false
        showBatchTab = true
    }

    return {
        platform,
        supportMessage,
        ui: {
            singleFormats,
            showBatchShortcut,
            showBatchTab
        }
    }
}
