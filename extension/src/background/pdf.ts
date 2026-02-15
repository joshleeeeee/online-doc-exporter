import { buildPrintHTML, sanitizeFilename } from './exportUtils'
import { waitForTabLoad } from './tabUtils'

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

export async function generateBatchPDF(htmlContent: string, docTitle: string): Promise<{ success: boolean; data?: string; error?: string }> {
    const html = buildPrintHTML(htmlContent, docTitle)
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
    const tabId = tab.id!

    try {
        await waitForTabLoad(tabId)
        await new Promise(r => setTimeout(r, 500))

        await cdpAttach(tabId)
        await cdpSend(tabId, 'Page.enable', {})
        const frameTree = await cdpSend(tabId, 'Page.getFrameTree', {})
        const frameId = (frameTree as any).frameTree.frame.id

        await cdpSend(tabId, 'Page.setDocumentContent', { frameId, html })
        await new Promise(r => setTimeout(r, 2000))

        const pdf = await cdpSend(tabId, 'Page.printToPDF', {
            landscape: false,
            printBackground: true,
            scale: 1,
            paperWidth: 8.27,
            paperHeight: 11.69,
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            preferCSSPageSize: true,
            generateDocumentOutline: true,
            generateTaggedPDF: true,
            transferMode: 'ReturnAsBase64'
        })

        await cdpDetach(tabId)
        try { await chrome.tabs.remove(tabId) } catch (_) { }

        return { success: true, data: (pdf as any).data as string }
    } catch (err: any) {
        try { await cdpDetach(tabId) } catch (_) { }
        try { await chrome.tabs.remove(tabId) } catch (_) { }
        return { success: false, error: err.message }
    }
}

export async function generatePDF(docTitle: string): Promise<{ success: boolean; error?: string }> {
    const stored = await chrome.storage.local.get(['printData']) as Record<string, any>
    if (!stored?.printData?.content) {
        return { success: false, error: '没有找到可打印的内容' }
    }

    const { content, images } = stored.printData

    let processedContent: string = content
    if (images && images.length > 0) {
        for (const img of images) {
            if (img.base64 && img.filename) {
                const escaped = img.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                processedContent = processedContent.replace(new RegExp(`images/${escaped}`, 'g'), img.base64)
            }
        }
    }

    const html = buildPrintHTML(processedContent, docTitle)

    const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
    const tabId = tab.id!
    console.log('[PDF] Created blank tab:', tabId)

    try {
        await waitForTabLoad(tabId)
        await new Promise(r => setTimeout(r, 500))

        console.log('[PDF] Attaching debugger to tab:', tabId)
        await cdpAttach(tabId)
        console.log('[PDF] Debugger attached successfully')

        await cdpSend(tabId, 'Page.enable', {})
        const frameTree = await cdpSend(tabId, 'Page.getFrameTree', {})
        const frameId = (frameTree as any).frameTree.frame.id

        await cdpSend(tabId, 'Page.setDocumentContent', { frameId, html })
        await new Promise(r => setTimeout(r, 2000))

        const pdf = await cdpSend(tabId, 'Page.printToPDF', {
            landscape: false,
            printBackground: true,
            scale: 1,
            paperWidth: 8.27,
            paperHeight: 11.69,
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

        await chrome.storage.local.remove(['printData'])

        const pdfBase64 = (pdf as any).data as string
        const safeTitle = sanitizeFilename(docTitle)
        const fname = safeTitle ? `${safeTitle}.pdf` : `document_${Date.now()}.pdf`

        const dlHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>PDF Download</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;background:#f5f5f5;display:flex;align-items:center;justify-content:center;min-height:100vh}.c{background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:420px;width:90%}h2{font-size:20px;color:#111;margin-bottom:8px}p{color:#666;font-size:14px;margin-bottom:20px}.b{display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px}</style></head><body>
<div class="c"><div id="L"><p>正在准备下载...</p></div><div id="D" style="display:none"><h2>✅ PDF 已生成</h2><p>如果下载没有自动开始，请点击下方按钮</p><a id="A" class="b">💾 下载 PDF</a></div></div>
<script id="B" type="text/plain">${pdfBase64}</script>
<script>try{var d=atob(document.getElementById('B').textContent),u=new Uint8Array(d.length);for(var i=0;i<d.length;i++)u[i]=d.charCodeAt(i);var bl=new Blob([u],{type:'application/pdf'}),url=URL.createObjectURL(bl),a=document.getElementById('A');a.href=url;a.download=${JSON.stringify(fname)};document.getElementById('L').style.display='none';document.getElementById('D').style.display='block';a.click()}catch(e){document.getElementById('L').innerHTML='<p style="color:red">Error: '+e.message+'</p>'}</script>
</body></html>`

        await cdpSend(tabId, 'Page.setDocumentContent', { frameId, html: dlHtml })
        console.log('[PDF] Download page injected:', fname)

        await chrome.tabs.update(tabId, { active: true })

        await cdpDetach(tabId)

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
