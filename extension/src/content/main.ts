import { PlatformAdapterFactory } from './adapters';
import JSZip from 'jszip';

class App {
    static readonly LOCAL_ARCHIVE_TIMEOUT_MS = 3 * 60_000;
    static readonly LOCAL_ARCHIVE_INLINE_MAX_BYTES = 8 * 1024 * 1024;

    static init() {
        // Check if context is still valid
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
            console.warn('OnlineDocExporter: Extension context invalidated. Please refresh the page.');
            return;
        }

        console.log('OnlineDocExporter: Content Script Initialized');

        if (chrome.runtime.onMessage) {
            chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
                if (request.action === 'EXTRACT_CONTENT') {
                    App.handleExtraction(request.format, request.options)
                        .then(result => {
                            if (typeof result === 'object' && result.content) {
                                sendResponse({ success: true, title: document.title, ...result });
                            } else {
                                sendResponse({ success: true, title: document.title, content: result });
                            }
                        })
                        .catch(error => sendResponse({ success: false, error: error.message }));
                    return true;
                }

                if (request.action === 'EXTRACT_AND_DOWNLOAD_LOCAL') {
                    App.handleLocalDownload(request.format, request.options)
                        .then(result => sendResponse({ success: true, title: document.title, ...result }))
                        .catch(error => sendResponse({ success: false, error: error.message }));
                    return true;
                }

                if (request.action === 'EXTRACT_LOCAL_ARCHIVE') {
                    App.handleLocalArchive(request.format, request.options)
                        .then(result => sendResponse({ success: true, title: document.title, ...result }))
                        .catch(error => sendResponse({ success: false, error: error.message }));
                    return true;
                }

                if (request.action === 'SCAN_LINKS') {
                    App.handleScan()
                        .then(links => sendResponse({ success: true, links }))
                        .catch(error => sendResponse({ success: false, error: error.message }));
                    return true;
                }

                if (request.action === 'STOP_SCROLL_SCAN') {
                    App.stopScrollScan();
                    sendResponse({ success: true });
                    return false;
                }
            });
        }
    }

    static _scrollScanAbort = false;

    static stopScrollScan() {
        App._scrollScanAbort = true;
    }

    static async handleScan() {
        try {
            const adapter = PlatformAdapterFactory.getAdapter('markdown', {});
            if (adapter && adapter.scanLinks) {
                return await adapter.scanLinks();
            }
            return [];
        } catch (e) {
            console.error('Scan Error:', e);
            throw e;
        }
    }

    static async handleScrollScan(port: chrome.runtime.Port) {
        App._scrollScanAbort = false;
        try {
            const adapter = PlatformAdapterFactory.getAdapter('markdown', {});
            if (!adapter || !adapter.scanLinks) {
                console.log('[ScrollScan] No adapter or scanLinks not supported');
                port.postMessage({ type: 'done', links: [] });
                return;
            }

            // Find scroll container based on page type
            const getScrollContainer = (): HTMLElement | null => {
                const url = window.location.href;
                const hostname = window.location.hostname;
                const isFeishu = hostname.includes('feishu.cn') || hostname.includes('larksuite.com');

                // === Feishu Drive folder page (/drive/folder/) ===
                if (isFeishu && url.includes('/drive/folder/')) {
                    console.log('[ScrollScan] Detected Feishu Drive folder page');

                    // Try specific selectors for the file list area
                    const driveFolderSelectors = [
                        '[class*="folderScrollListWrapper"]',
                        '.explorer-file-list-virtualized__container',
                        '[class*="VirtualizedList_Scroller"]',
                        '.explorer-file-list',
                    ];

                    for (const selector of driveFolderSelectors) {
                        const el = document.querySelector(selector) as HTMLElement;
                        if (el && el.scrollHeight > el.clientHeight && el.clientHeight > 100) {
                            console.log(`[ScrollScan] Found Drive folder container: ${selector}`, { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
                            return el;
                        }
                    }

                    // Walk up from a file list item to find the scrollable parent
                    const fileItem = document.querySelector('.file-list-item, [class*="file-list-item"]');
                    if (fileItem) {
                        let parent = fileItem.parentElement;
                        while (parent && parent !== document.body && parent !== document.documentElement) {
                            const style = window.getComputedStyle(parent);
                            const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay');
                            if (isScrollable && parent.scrollHeight > parent.clientHeight && parent.clientHeight > 100) {
                                console.log(`[ScrollScan] Found Drive folder container via file-item walk:`, parent.tagName, parent.className.substring(0, 80), { scrollHeight: parent.scrollHeight, clientHeight: parent.clientHeight });
                                return parent;
                            }
                            parent = parent.parentElement;
                        }
                    }
                    console.log('[ScrollScan] Drive folder: no file list container found, falling through to generic');
                }

                // === Feishu Wiki / Space pages ===
                if (isFeishu && (url.includes('/wiki/') || url.includes('/space/'))) {
                    console.log('[ScrollScan] Detected Feishu Wiki/Space page');
                    const wikiSelectors = [
                        '.catalog-module', '.wiki-tree-container', '.space-main-container',
                        '.obj-list-container', '.main-content',
                    ];
                    for (const selector of wikiSelectors) {
                        const el = document.querySelector(selector) as HTMLElement;
                        if (el && el.scrollHeight > el.clientHeight && el.clientHeight > 100) {
                            console.log(`[ScrollScan] Found Wiki container: ${selector}`, { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
                            return el;
                        }
                    }
                }

                // === Generic scroll container detection ===
                const candidates = [
                    '.scroll-container', '.editor-wrapper', '.render-content', '.document-container',
                    '#doc-body', '.ace-content-scroll-container', '.drive-scroll-container',
                    '.editor-scroll', '.note-content-container',
                ];

                for (const selector of candidates) {
                    const el = document.querySelector(selector) as HTMLElement;
                    if (el && el.scrollHeight > el.clientHeight && el.clientHeight > 100) {
                        console.log(`[ScrollScan] Found container via selector: ${selector}`, { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
                        return el;
                    }
                }

                // Try to find a scrollable parent from common page content
                const contentNode = document.querySelector('.workspace-tree-view-node') ||
                    document.querySelector('.table-view') ||
                    document.querySelector('[data-block-type]') ||
                    document.querySelector('.ace-line');

                if (contentNode) {
                    let parent = contentNode.parentElement;
                    while (parent && parent !== document.body && parent !== document.documentElement) {
                        const style = window.getComputedStyle(parent);
                        const isScrollStyle = (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay');
                        if (parent.scrollHeight > parent.clientHeight && parent.clientHeight > 150) {
                            if (isScrollStyle || parent.scrollHeight > parent.clientHeight + 50) {
                                console.log(`[ScrollScan] Found container via parent walk:`, parent.tagName, parent.className.substring(0, 80), { scrollHeight: parent.scrollHeight, clientHeight: parent.clientHeight });
                                return parent;
                            }
                        }
                        parent = parent.parentElement;
                    }
                }

                // Generic fallback: find any scrollable element in the main content area (skip sidebar)
                const mainArea = document.querySelector('[class*="main-content"], [class*="content-area"], main, [role="main"]') as HTMLElement;
                const searchRoot = mainArea || document.body;
                const allElements = Array.from(searchRoot.querySelectorAll('div, main, section, article'));
                for (const el of allElements) {
                    const htmlEl = el as HTMLElement;
                    const style = window.getComputedStyle(htmlEl);
                    const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay');
                    if (isScrollable && htmlEl.scrollHeight > htmlEl.clientHeight + 200 && htmlEl.clientHeight > 200) {
                        console.log(`[ScrollScan] Found container via generic fallback:`, htmlEl.tagName, htmlEl.className.substring(0, 80), { scrollHeight: htmlEl.scrollHeight, clientHeight: htmlEl.clientHeight });
                        return htmlEl;
                    }
                }

                if (document.body.scrollHeight > document.documentElement.clientHeight &&
                    window.getComputedStyle(document.body).overflowY !== 'hidden') {
                    console.log('[ScrollScan] Using document.body as container');
                    return document.body;
                }

                if (document.documentElement.scrollHeight > document.documentElement.clientHeight) {
                    console.log('[ScrollScan] Using document.documentElement as container');
                    return document.documentElement;
                }

                console.log('[ScrollScan] No scroll container found!');
                return null;
            };

            const container = getScrollContainer();
            const getScrollHeight = () => container ? container.scrollHeight : document.documentElement.scrollHeight;
            const getClientHeight = () => container ? container.clientHeight : document.documentElement.clientHeight;
            const scrollTo = (y: number) => {
                if (container) {
                    container.scrollTop = y;
                } else {
                    window.scrollTo(0, y);
                }
            };
            const getCurrentScroll = () => container ? container.scrollTop : window.scrollY;

            // Scroll to top first
            scrollTo(0);
            await new Promise(r => setTimeout(r, 500));

            console.log('[ScrollScan] Starting. Container:', container?.tagName, container?.className?.substring(0, 60),
                'scrollHeight:', getScrollHeight(), 'clientHeight:', getClientHeight(), 'currentScroll:', getCurrentScroll());

            const allFoundUrls = new Set<string>();

            // Initial scan before scrolling
            const initialLinks = await adapter.scanLinks();
            initialLinks.forEach(link => allFoundUrls.add(link.url));
            if (initialLinks.length > 0) {
                port.postMessage({ type: 'partial', links: initialLinks });
            }
            console.log(`[ScrollScan] Initial scan found ${initialLinks.length} links`);

            // Start scrolling
            let reachedBottomCount = 0;
            let scrollStuckCount = 0;
            let lastScrollTop = -1;

            while (!App._scrollScanAbort) {
                const totalHeight = getScrollHeight();
                const clientHeight = getClientHeight();
                const currentScroll = getCurrentScroll();

                console.log(`[ScrollScan] Loop: scroll=${Math.round(currentScroll)}, total=${totalHeight}, client=${clientHeight}, bottom=${Math.round(currentScroll + clientHeight)}`);

                // Scroll down
                const nextScroll = currentScroll + Math.max(clientHeight * 0.7, 300);
                scrollTo(nextScroll);
                await new Promise(r => setTimeout(r, 1200));

                if (App._scrollScanAbort) break;

                // Check actual scroll position after scrolling
                const newScroll = getCurrentScroll();
                const newTotalHeight = getScrollHeight();

                // Scan at current position
                const newLinks = await adapter.scanLinks();
                const incrementalLinks = newLinks.filter(link => !allFoundUrls.has(link.url));
                incrementalLinks.forEach(link => allFoundUrls.add(link.url));

                if (incrementalLinks.length > 0) {
                    port.postMessage({ type: 'partial', links: incrementalLinks });
                    // Reset counters when we find new content
                    reachedBottomCount = 0;
                    scrollStuckCount = 0;
                }

                // Check if we've reached the bottom
                if (Math.ceil(newScroll + clientHeight) >= newTotalHeight - 50) {
                    reachedBottomCount++;
                    console.log(`[ScrollScan] Reached bottom (${reachedBottomCount}/3)`);
                    if (reachedBottomCount >= 3) break;
                } else {
                    reachedBottomCount = 0;
                }

                // Check if scroll position stopped changing (stuck)
                if (Math.abs(newScroll - lastScrollTop) < 5 && lastScrollTop !== -1) {
                    scrollStuckCount++;
                    console.log(`[ScrollScan] Scroll stuck (${scrollStuckCount}/3)`);
                    if (scrollStuckCount >= 3) break;
                } else {
                    scrollStuckCount = 0;
                }
                lastScrollTop = newScroll;
            }

            console.log(`[ScrollScan] Done. Total links found: ${allFoundUrls.size}`);
            port.postMessage({ type: 'done', total: allFoundUrls.size });
        } catch (e: any) {
            console.error('Scroll Scan Error:', e);
            port.postMessage({ type: 'error', error: e.message });
        }
    }

    static async handleExtraction(format: string, options: any) {
        try {
            const adapter = PlatformAdapterFactory.getAdapter(format, options);
            if (!adapter) {
                throw new Error('当前页面不受插件支持。');
            }
            return await adapter.extract();
        } catch (e) {
            console.error('Extraction Error:', e);
            throw e;
        }
    }

    static sanitizeFilename(name: string) {
        return (name || 'document').replace(/[\\/:*?"<>|]/g, "_");
    }

    static async withTimeout<T>(task: Promise<T>, timeoutMs: number, message: string): Promise<T> {
        let timer: number | null = null;
        try {
            return await Promise.race([
                task,
                new Promise<T>((_, reject) => {
                    timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
                })
            ]);
        } finally {
            if (timer) window.clearTimeout(timer);
        }
    }

    static blobToBase64Data(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const full = String(reader.result || '');
                const comma = full.indexOf(',');
                resolve(comma >= 0 ? full.slice(comma + 1) : full);
            };
            reader.onerror = () => reject(reader.error || new Error('Blob to base64 failed'));
            reader.readAsDataURL(blob);
        });
    }

    static storageSet(items: Record<string, any>) {
        return new Promise<void>((resolve, reject) => {
            chrome.storage.local.set(items, () => {
                const err = chrome.runtime.lastError;
                if (err) reject(new Error(err.message));
                else resolve();
            });
        });
    }

    static triggerFileDownload(blob: Blob, filename: string) {
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(dlUrl);
    }

    static async handleLocalDownload(format: 'markdown' | 'html', options: any) {
        const result = await App.handleExtraction(format, options) as { content?: string; images?: any[] };
        const content = result?.content || '';
        const images = Array.isArray(result?.images) ? result.images : [];
        const safeTitle = App.sanitizeFilename(document.title || 'document');

        if (images.length > 0) {
            const zip = new JSZip();
            const ext = format === 'html' ? '.html' : '.md';
            const contentFilename = `${safeTitle}${ext}`;
            const imgFolder = zip.folder('images');

            images.forEach((img: any) => {
                if (img.base64 && typeof img.base64 === 'string' && img.base64.includes(',')) {
                    const base64Data = img.base64.split(',')[1];
                    imgFolder?.file(img.filename, base64Data, { base64: true });
                }
            });

            zip.file(contentFilename, content);
            const blob = await zip.generateAsync({ type: 'blob' });
            App.triggerFileDownload(blob, `${safeTitle}.zip`);
            return { hasImages: true, imageCount: images.length };
        }

        const ext = format === 'html' ? '.html' : '.md';
        const mime = format === 'html' ? 'text/html;charset=utf-8' : 'text/markdown;charset=utf-8';
        const blob = new Blob([content], { type: mime });
        App.triggerFileDownload(blob, `${safeTitle}${ext}`);
        return { hasImages: false, imageCount: 0 };
    }

    static async handleLocalArchive(format: 'markdown' | 'html', options: any) {
        console.log('[LocalArchive] Start archive extraction');
        const result = await App.handleExtraction(format, options) as { content?: string; images?: any[] };
        const content = result?.content || '';
        const images = Array.isArray(result?.images) ? result.images : [];
        const safeTitle = App.sanitizeFilename(document.title || 'document');

        const zip = new JSZip();
        const ext = format === 'html' ? '.html' : '.md';
        const contentFilename = `${safeTitle}${ext}`;
        const imgFolder = zip.folder('images');

        images.forEach((img: any) => {
            if (img.base64 && typeof img.base64 === 'string' && img.base64.includes(',')) {
                const base64Data = img.base64.split(',')[1];
                imgFolder?.file(img.filename, base64Data, { base64: true });
            }
        });

        zip.file(contentFilename, content);
        console.log(`[LocalArchive] Build zip: content + ${images.length} images`);
        let lastLoggedStep = -1;
        const archiveBlob = await App.withTimeout(
            zip.generateAsync(
                { type: 'blob', compression: 'STORE' },
                (meta) => {
                    const step = Math.floor(meta.percent / 10);
                    if (step !== lastLoggedStep) {
                        lastLoggedStep = step;
                        console.log(`[LocalArchive] Packaging ${Math.round(meta.percent)}%`);
                    }
                }
            ),
            App.LOCAL_ARCHIVE_TIMEOUT_MS,
            '本地归档打包超时（请减少单次抓取内容）'
        );

        console.log(`[LocalArchive] Zip size: ${(archiveBlob.size / (1024 * 1024)).toFixed(2)} MB`);

        const archiveBase64 = await App.withTimeout(
            App.blobToBase64Data(archiveBlob),
            60_000,
            '归档编码超时（请减少单次抓取内容）'
        );
        const archiveSize = archiveBlob.size;
        console.log('[LocalArchive] Archive ready');

        if (archiveSize > App.LOCAL_ARCHIVE_INLINE_MAX_BYTES) {
            const storageKey = `localArchive:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
            await App.storageSet({ [storageKey]: archiveBase64 });
            console.log(`[LocalArchive] Stored archive in chrome.storage.local: ${storageKey}`);
            return {
                archiveStorageKey: storageKey,
                archiveName: `${safeTitle}.zip`,
                archiveSize,
                imageCount: images.length
            };
        }

        return {
            archiveBase64,
            archiveName: `${safeTitle}.zip`,
            archiveSize,
            imageCount: images.length
        };
    }
}

// Listen for port connections (scroll scan)
chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'scroll-scan') {
        App.handleScrollScan(port);
    }
});

// Run init
if (document.readyState === 'complete') {
    App.init();
} else {
    window.addEventListener('load', App.init);
}
