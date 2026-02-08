class App {
    static init() {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
            console.warn('Feishu Copy Extension: chrome.runtime.onMessage is not available. This content script might be orphaned or running in an invalid context.');
            return;
        }

        console.log('Feishu Copy Extension: Listener Initialized');

        try {
            // Listen for messages from popup
            chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
                if (request.action === 'EXTRACT_CONTENT') {
                    App.handleExtraction(request.format, request.options)
                        .then(result => {
                            // Support returning object { content, images } or just string
                            if (typeof result === 'object' && result.content) {
                                sendResponse({ success: true, ...result });
                            } else {
                                sendResponse({ success: true, content: result });
                            }
                        })
                        .catch(error => sendResponse({ success: false, error: error.message }));

                    return true;
                }
                if (request.action === 'SCAN_LINKS') {
                    App.handleScan()
                        .then(links => sendResponse({ success: true, links }))
                        .catch(error => sendResponse({ success: false, error: error.message }));
                    return true;
                }
            });
        } catch (e) {
            console.error('Feishu Copy Extension: Failed to add listener', e);
        }
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

    static async handleExtraction(format, options) {
        try {
            const adapter = PlatformAdapterFactory.getAdapter(format, options);
            if (!adapter) {
                // Return generic error or fallback
                // If generic adapter existed, it would be here
                throw new Error('This page is not supported by Feishu Copy Extension.');
            }
            return await adapter.extract();
        } catch (e) {
            console.error('Extraction Error:', e);
            throw e;
        }
    }
}

// Run init
if (document.readyState === 'complete') {
    App.init();
} else {
    window.addEventListener('load', App.init);
}
