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
        } else if (request.action === 'GENERATE_PDF') {
            const { title } = request
            generatePDF(title)
                .then(result => sendResponse(result))
                .catch(err => sendResponse({ success: false, error: err.message }))
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

// ==================== CDP PDF Generation ====================

function cdpAttach(tabId: number): Promise<void> {
    return new Promise((resolve, reject) => {
        chrome.debugger.attach({ tabId }, '1.3', () => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
            else resolve()
        })
    })
}

function cdpDetach(tabId: number): Promise<void> {
    return new Promise((resolve) => {
        chrome.debugger.detach({ tabId }, () => {
            // Must consume lastError to avoid 'Unchecked runtime.lastError' warning
            void chrome.runtime.lastError
            resolve()
        })
    })
}

function cdpSend(tabId: number, method: string, params?: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
            else resolve(result)
        })
    })
}

async function generatePDF(docTitle: string): Promise<{ success: boolean; error?: string }> {
    // Read stored content from chrome.storage
    const stored = await chrome.storage.local.get(['printData']) as Record<string, any>
    if (!stored?.printData?.content) {
        return { success: false, error: '没有找到可打印的内容' }
    }

    const { content, images } = stored.printData

    // Replace local image references with base64 data
    let processedContent: string = content
    if (images && images.length > 0) {
        for (const img of images) {
            if (img.base64 && img.filename) {
                const escaped = img.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                processedContent = processedContent.replace(new RegExp(`images/${escaped}`, 'g'), img.base64)
            }
        }
    }

    // Build a standalone HTML page with inline styles
    const html = buildPrintHTML(processedContent, docTitle)

    // Use about:blank tab (chrome.debugger CANNOT attach to chrome-extension:// pages)
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
    const tabId = tab.id!
    console.log('[PDF] Created blank tab:', tabId)

    try {
        await waitForTabLoad(tabId)
        // Extra delay to ensure about:blank is fully initialized
        await new Promise(r => setTimeout(r, 500))

        // Attach Chrome DevTools Protocol
        console.log('[PDF] Attaching debugger to tab:', tabId)
        await cdpAttach(tabId)
        console.log('[PDF] Debugger attached successfully')

        // Enable Page domain and get frame ID
        await cdpSend(tabId, 'Page.enable', {})
        const frameTree = await cdpSend(tabId, 'Page.getFrameTree', {})
        const frameId = (frameTree as any).frameTree.frame.id

        // Inject the full HTML document into the blank page
        await cdpSend(tabId, 'Page.setDocumentContent', { frameId, html })

        // Wait for content to render (layout, inline base64 images)
        await new Promise(r => setTimeout(r, 2000))

        // Generate PDF with document outline (bookmarks from H1/H2/H3)
        const pdf = await cdpSend(tabId, 'Page.printToPDF', {
            landscape: false,
            printBackground: true,
            scale: 1,
            paperWidth: 8.27,    // A4 width in inches
            paperHeight: 11.69,  // A4 height in inches
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            preferCSSPageSize: true,
            generateDocumentOutline: true,
            generateTaggedPDF: true,
            transferMode: 'ReturnAsBase64'
        })

        console.log('[PDF] PDF generated, preparing download...')

        // Clean up storage
        await chrome.storage.local.remove(['printData'])

        // Build a download page that triggers file save from tab context
        const pdfBase64 = (pdf as any).data as string
        const safeTitle = sanitizeFilename(docTitle)
        const fname = safeTitle ? `${safeTitle}.pdf` : `document_${Date.now()}.pdf`

        const dlHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>PDF Download</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh}.c{background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:420px;width:90%}h2{font-size:20px;color:#111;margin-bottom:8px}p{color:#666;font-size:14px;margin-bottom:20px}.b{display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px}</style></head><body>
<div class="c"><div id="L"><p>正在准备下载...</p></div><div id="D" style="display:none"><h2>✅ PDF 已生成</h2><p>如果下载没有自动开始，请点击下方按钮</p><a id="A" class="b">💾 下载 PDF</a></div></div>
<script id="B" type="text/plain">${pdfBase64}</script>
<script>try{var d=atob(document.getElementById('B').textContent),u=new Uint8Array(d.length);for(var i=0;i<d.length;i++)u[i]=d.charCodeAt(i);var bl=new Blob([u],{type:'application/pdf'}),url=URL.createObjectURL(bl),a=document.getElementById('A');a.href=url;a.download=${JSON.stringify(fname)};document.getElementById('L').style.display='none';document.getElementById('D').style.display='block';a.click()}catch(e){document.getElementById('L').innerHTML='<p style=\"color:red\">Error: '+e.message+'</p>'}</script>
</body></html>`

        // Inject the download page into the tab
        await cdpSend(tabId, 'Page.setDocumentContent', { frameId, html: dlHtml })
        console.log('[PDF] Download page injected:', fname)

        // Make tab visible so user sees the download prompt
        await chrome.tabs.update(tabId, { active: true })

        // Detach debugger
        await cdpDetach(tabId)

        // Auto close the tab after delay
        setTimeout(async () => {
            try { await chrome.tabs.remove(tabId) } catch (_) { }
        }, 8000)

        return { success: true }
    } catch (err: any) {
        console.error('[PDF] Error:', err.message)
        try { await cdpDetach(tabId) } catch (_) { }
        try { await chrome.tabs.remove(tabId) } catch (_) { }
        return { success: false, error: err.message }
    }
}

function sanitizeFilename(name: string): string {
    if (!name) return 'document'
    let safe = name
        .replace(/[\\/]/g, '_')
        .replace(/[<>:"|?*#%&{}$!@`+=~^]/g, '')
        .replace(/[\x00-\x1f\x7f]/g, '')
        .replace(/^\.+/, '')
        .replace(/\s+/g, ' ')
        .trim()
    if (!safe) return 'document'
    if (safe.length > 200) safe = safe.substring(0, 200)
    return safe
}

function buildPrintHTML(content: string, title: string): string {
    const safeTitle = title
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${safeTitle}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Helvetica Neue',Helvetica,Arial,sans-serif;
  color:#1a1a1a;line-height:1.8;-webkit-font-smoothing:antialiased;
}
.document-body{padding:1.5cm 2cm}
.document-body h1{font-size:26px;font-weight:800;color:#111827;margin:0 0 20px 0;line-height:1.4;border-bottom:2px solid #e5e7eb;padding-bottom:10px}
.document-body h2{font-size:21px;font-weight:700;color:#1f2937;margin:28px 0 14px 0;line-height:1.4}
.document-body h3{font-size:17px;font-weight:600;color:#374151;margin:22px 0 10px 0;line-height:1.4}
.document-body p{margin:0 0 10px 0;line-height:1.8;color:#374151}
.document-body ul,.document-body ol{margin:0 0 14px 0;padding-left:24px}
.document-body li{margin-bottom:5px;line-height:1.7}
.document-body blockquote{margin:14px 0;padding:10px 18px;border-left:4px solid #6366f1;background:#f8fafc;color:#4b5563;border-radius:0 6px 6px 0}
.document-body pre{margin:14px 0;padding:14px 18px;background:#f3f4f6;color:#1e293b;border:1px solid #d1d5db;border-radius:6px;font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-wrap:break-word;overflow-x:auto}
.document-body code{font-family:'SF Mono','Fira Code',Consolas,monospace;font-size:12px}
.document-body p code,.document-body li code{background:#f1f5f9;padding:1px 5px;border-radius:3px;color:#e11d48;font-size:0.9em}
.document-body img{max-width:100%;height:auto;border-radius:3px;margin:6px 0}
.document-body table{width:100%;border-collapse:collapse;margin:14px 0;font-size:12px}
.document-body table td,.document-body table th{border:1px solid #d1d5db;padding:6px 10px;text-align:left}
.document-body table tr:nth-child(even){background:#f9fafb}
.document-body hr{border:none;border-top:1px solid #e5e7eb;margin:20px 0}
.document-body a{color:#3b82f6;text-decoration:none}
@page{margin:0;size:A4}
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  .document-body img{page-break-inside:avoid}
  .document-body h1,.document-body h2,.document-body h3{page-break-after:avoid}
  .document-body table{page-break-inside:auto}
  .document-body tr{page-break-inside:avoid}
}
</style>
</head>
<body>
<article class="document-body">
${content}
</article>
</body>
</html>`
}

// ==================== Tab Utilities ====================

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
