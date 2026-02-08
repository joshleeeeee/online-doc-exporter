export interface BatchItem {
    url: string
    title: string
    format?: string
    options?: any
    status: 'pending' | 'processing' | 'success' | 'failed'
    size?: number
    timestamp?: number
    error?: string
    content?: string
    images?: any[]
}

let BATCH_QUEUE: BatchItem[] = []
let isProcessing = false
let isPaused = false
let processedResults: BatchItem[] = []
let currentItem: BatchItem | null = null
let currentTabId: number | null = null
let isReady = false

const preparePromise = new Promise<void>((resolve) => {
    chrome.storage.local.get(['batchQueue', 'processedResults', 'isProcessing', 'isPaused'], (data) => {
        if (data && data.batchQueue && Array.isArray(data.batchQueue)) {
            BATCH_QUEUE = data.batchQueue as BatchItem[];
        }
        if (data.processedResults && Array.isArray(data.processedResults)) {
            processedResults = data.processedResults
            let needsSave = false
            processedResults.forEach(item => {
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
        if (data.isPaused !== undefined) isPaused = !!data.isPaused

        if (data && data.isProcessing && BATCH_QUEUE.length > 0 && !isPaused) {
            isProcessing = true
            processNextItem()
        } else {
            isProcessing = !!(data ? data.isProcessing : false)
        }
        isReady = true
        resolve()
    })
})

async function saveState() {
    await chrome.storage.local.set({
        batchQueue: BATCH_QUEUE,
        processedResults,
        isProcessing,
        isPaused
    })
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    preparePromise.then(async () => {
        if (request.action === 'START_BATCH_PROCESS') {
            const { items, format, options } = request
            if (!items || !items.length) {
                sendResponse({ success: false, error: 'No Items' })
                return
            }

            items.forEach((item: any) => {
                const isInQueue = BATCH_QUEUE.some(q => q.url === item.url)
                const isCurrent = currentItem && currentItem.url === item.url
                if (!isInQueue && !isCurrent) {
                    BATCH_QUEUE.push({
                        url: item.url,
                        title: item.title,
                        format,
                        options,
                        status: 'pending'
                    })
                }
            })

            isPaused = false
            if (!isProcessing) {
                processNextItem()
            }
            await saveState()
            sendResponse({ success: true, message: 'Started' })
        } else if (request.action === 'GET_BATCH_STATUS') {
            const lightResults = processedResults.map(r => ({
                url: r.url,
                title: r.title,
                size: r.size || 0,
                status: r.status,
                timestamp: r.timestamp,
                error: r.error
            }))
            sendResponse({
                isProcessing,
                isPaused,
                queueLength: BATCH_QUEUE.length,
                results: lightResults,
                currentItem: currentItem
            })
        } else if (request.action === 'GET_FULL_RESULTS') {
            const { urls } = request
            const fullItems = processedResults.filter(r => urls.includes(r.url))
            sendResponse({ success: true, data: fullItems })
        } else if (request.action === 'PAUSE_BATCH') {
            isPaused = true
            isProcessing = false
            await saveState()
            sendResponse({ success: true })
        } else if (request.action === 'RESUME_BATCH') {
            isPaused = false
            if (!isProcessing && BATCH_QUEUE.length > 0) {
                processNextItem()
            }
            await saveState()
            sendResponse({ success: true })
        } else if (request.action === 'CLEAR_BATCH_RESULTS') {
            processedResults = []
            BATCH_QUEUE = []
            isProcessing = false
            isPaused = false
            if (currentTabId) {
                try { chrome.tabs.remove(currentTabId) } catch (e) { }
            }
            currentItem = null
            currentTabId = null
            await saveState()
            sendResponse({ success: true })
        } else if (request.action === 'DELETE_BATCH_ITEM') {
            const { url } = request
            processedResults = processedResults.filter(item => item.url !== url)
            BATCH_QUEUE = BATCH_QUEUE.filter(item => item.url !== url)

            if (currentItem && currentItem.url === url) {
                if (currentTabId) {
                    try { chrome.tabs.remove(currentTabId) } catch (e) { }
                }
                currentItem = null
                currentTabId = null
            }

            await saveState()
            sendResponse({ success: true })
        }
    })
    return true
})

async function processNextItem() {
    if (isPaused) {
        isProcessing = false
        return
    }

    if (BATCH_QUEUE.length === 0) {
        isProcessing = false
        currentItem = null
        currentTabId = null
        await saveState()
        return
    }

    isProcessing = true
    currentItem = BATCH_QUEUE.shift() || null
    await saveState()

    if (!currentItem) {
        isProcessing = false
        return
    }

    const taskUrl = currentItem.url
    try {
        const isForeground = currentItem.options && currentItem.options.foreground
        const tab = await chrome.tabs.create({ url: taskUrl, active: !!isForeground })
        currentTabId = tab.id || null

        if (currentTabId) {
            await waitForTabLoad(currentTabId)

            if (!currentItem || currentItem.url !== taskUrl || isPaused) {
                throw new Error("Cancelled")
            }

            // Wait for content scripts to initialize
            await new Promise(r => setTimeout(r, 4000))

            if (!currentItem || currentItem.url !== taskUrl || isPaused) {
                throw new Error("Cancelled")
            }

            let response: any = null
            for (let i = 0; i < 3; i++) {
                try {
                    if (!currentItem || currentItem.url !== taskUrl || isPaused) break
                    response = await chrome.tabs.sendMessage(currentTabId, {
                        action: 'EXTRACT_CONTENT',
                        format: currentItem.format || 'markdown',
                        options: currentItem.options || { useBase64: true }
                    })
                    if (response) break
                } catch (e) {
                    await new Promise(r => setTimeout(r, 2000))
                }
            }

            if (!currentItem || currentItem.url !== taskUrl || isPaused) {
                throw new Error("Cancelled")
            }

            if (response && response.success) {
                let title = currentItem.title || 'Untitled'
                if (response.content) {
                    if (currentItem.format === 'markdown') {
                        const match = response.content.match(/^#\s+(.*)/)
                        if (match) title = match[1]
                    } else {
                        const match = response.content.match(/<h1>(.*?)<\/h1>/)
                        if (match) title = match[1].replace(/<[^>]+>/g, '')
                    }
                }

                if (title === 'Untitled' || !title) {
                    try {
                        const updatedTab = await chrome.tabs.get(currentTabId)
                        title = updatedTab.title || 'Doc ' + Date.now()
                    } catch (e) {
                        title = 'Doc ' + Date.now()
                    }
                }

                const calculatedSize = Math.round((response.content ? response.content.length : 0) +
                    (response.images ? response.images.reduce((sum: number, img: any) => sum + (img.base64 ? img.base64.length * 0.75 : 0), 0) : 0))

                processedResults.push({
                    url: taskUrl,
                    title: title.trim(),
                    content: response.content,
                    images: response.images || [],
                    size: calculatedSize,
                    status: 'success',
                    timestamp: Date.now()
                })
            } else {
                throw new Error(response ? response.error : 'Extraction failed')
            }
        }
    } catch (err: any) {
        if (err.message !== "Cancelled" && currentItem && currentItem.url === taskUrl) {
            processedResults.push({
                url: taskUrl,
                title: currentItem.title || 'Failed Doc',
                status: 'failed',
                error: err.message,
                timestamp: Date.now()
            })
        }
    } finally {
        if (currentTabId) {
            try { await chrome.tabs.remove(currentTabId) } catch (e) { }
        }

        currentItem = null
        currentTabId = null
        await saveState()

        if (!isPaused) {
            setTimeout(processNextItem, 1000)
        } else {
            isProcessing = false
        }
    }
}

function waitForTabLoad(tabId: number) {
    return new Promise<void>(async resolve => {
        let isResolved = false
        const done = () => {
            if (isResolved) return
            isResolved = true
            chrome.tabs.onUpdated.removeListener(onUpdated)
            chrome.tabs.onRemoved.removeListener(onRemoved)
            resolve()
        }

        const onUpdated = (tId: number, changeInfo: any) => {
            if (tId === tabId && changeInfo.status === 'complete') done()
        }

        const onRemoved = (tId: number) => {
            if (tId === tabId) done()
        }

        try {
            const tab = await chrome.tabs.get(tabId)
            if (tab && tab.status === 'complete') {
                done()
                return
            }
        } catch (e) {
            done()
            return
        }

        chrome.tabs.onUpdated.addListener(onUpdated)
        chrome.tabs.onRemoved.addListener(onRemoved)

        setTimeout(done, 30000)
    })
}
