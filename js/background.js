let BATCH_QUEUE = [];
let isProcessing = false;
let isPaused = false;
let processedResults = [];
let currentItem = null;
let currentTabId = null;

let isReady = false;
const preparePromise = new Promise(resolve => {
    chrome.storage.local.get(['batchQueue', 'processedResults', 'isProcessing', 'isPaused'], (data) => {
        if (data.batchQueue) BATCH_QUEUE = data.batchQueue;
        if (data.processedResults) processedResults = data.processedResults;
        if (data.isPaused) isPaused = true;

        if (data.isProcessing && BATCH_QUEUE.length > 0 && !isPaused) {
            isProcessing = true;
            processNextItem();
        } else {
            isProcessing = data.isProcessing || false;
        }
        isReady = true;
        resolve();
    });
});

async function saveState() {
    await chrome.storage.local.set({
        batchQueue: BATCH_QUEUE,
        processedResults,
        isProcessing,
        isPaused
    });
}

// Listen for messages from popup/content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    preparePromise.then(async () => {
        if (request.action === 'START_BATCH_PROCESS') {
            const { items, format, options } = request;
            if (!items || !items.length) {
                sendResponse({ success: false, error: 'No Items' });
                return;
            }

            items.forEach(item => {
                const isInQueue = BATCH_QUEUE.some(q => q.url === item.url);
                const isCurrent = currentItem && currentItem.url === item.url;
                if (!isInQueue && !isCurrent) {
                    BATCH_QUEUE.push({
                        url: item.url,
                        title: item.title,
                        format,
                        options,
                        status: 'pending'
                    });
                }
            });

            isPaused = false; // Auto resume on new tasks
            if (!isProcessing) {
                processNextItem();
            }
            await saveState();
            sendResponse({ success: true, message: 'Started' });
        } else if (request.action === 'GET_BATCH_STATUS') {
            sendResponse({
                isProcessing,
                isPaused,
                queue: BATCH_QUEUE,
                results: processedResults,
                currentItem: currentItem
            });
        } else if (request.action === 'PAUSE_BATCH') {
            isPaused = true;
            await saveState();
            sendResponse({ success: true });
        } else if (request.action === 'RESUME_BATCH') {
            isPaused = false;
            if (!isProcessing && BATCH_QUEUE.length > 0) {
                processNextItem();
            }
            await saveState();
            sendResponse({ success: true });
        } else if (request.action === 'CLEAR_BATCH_RESULTS') {
            processedResults = [];
            BATCH_QUEUE = [];
            isProcessing = false;
            isPaused = false;
            if (currentTabId) {
                try { chrome.tabs.remove(currentTabId); } catch (e) { }
            }
            currentItem = null;
            currentTabId = null;
            await saveState();
            sendResponse({ success: true });
        } else if (request.action === 'DELETE_BATCH_ITEM') {
            const { url } = request;
            processedResults = processedResults.filter(item => item.url !== url);
            BATCH_QUEUE = BATCH_QUEUE.filter(item => item.url !== url);

            if (currentItem && currentItem.url === url) {
                if (currentTabId) {
                    try { chrome.tabs.remove(currentTabId); } catch (e) { }
                }
                currentItem = null;
                currentTabId = null;
            }

            await saveState();
            sendResponse({ success: true });
        }
    });

    return true;
});

async function processNextItem() {
    if (isPaused) {
        isProcessing = false;
        return;
    }

    if (BATCH_QUEUE.length === 0) {
        isProcessing = false;
        currentItem = null;
        currentTabId = null;
        await saveState();
        return;
    }

    isProcessing = true;
    currentItem = BATCH_QUEUE.shift();
    await saveState();

    currentTabId = null;
    const taskUrl = currentItem.url;
    console.log('Processing:', taskUrl);

    try {
        const tab = await chrome.tabs.create({ url: taskUrl, active: false });
        currentTabId = tab.id;

        await waitForTabLoad(currentTabId);

        if (!currentItem || currentItem.url !== taskUrl || isPaused) {
            throw new Error("Cancelled");
        }

        await new Promise(r => setTimeout(r, 4000));

        if (!currentItem || currentItem.url !== taskUrl || isPaused) {
            throw new Error("Cancelled");
        }

        let response = null;
        for (let i = 0; i < 3; i++) {
            try {
                if (!currentItem || currentItem.url !== taskUrl || isPaused) break;

                response = await chrome.tabs.sendMessage(currentTabId, {
                    action: 'EXTRACT_CONTENT',
                    format: currentItem.format || 'markdown',
                    options: currentItem.options || { useBase64: true }
                });
                if (response) break;
            } catch (e) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (!currentItem || currentItem.url !== taskUrl || isPaused) {
            throw new Error("Cancelled");
        }

        if (response && response.success) {
            let title = currentItem.title || 'Untitled';
            if (response.content) {
                if (currentItem.format === 'markdown') {
                    const match = response.content.match(/^#\s+(.*)/);
                    if (match) title = match[1];
                } else {
                    const match = response.content.match(/<h1>(.*?)<\/h1>/);
                    if (match) title = match[1].replace(/<[^>]+>/g, '');
                }
            }

            if (title === 'Untitled' || !title) {
                try {
                    const updatedTab = await chrome.tabs.get(currentTabId);
                    title = updatedTab.title || 'Doc ' + Date.now();
                } catch (e) {
                    title = 'Doc ' + Date.now();
                }
            }

            processedResults.push({
                url: taskUrl,
                title: title.trim(),
                content: response.content,
                status: 'success',
                timestamp: Date.now()
            });
        } else {
            throw new Error(response ? response.error : 'Extraction failed');
        }
    } catch (err) {
        if (err.message !== "Cancelled" && currentItem && currentItem.url === taskUrl) {
            console.error('Batch failed:', taskUrl, err);
            processedResults.push({
                url: taskUrl,
                title: currentItem.title || 'Failed Doc',
                status: 'failed',
                error: err.message,
                timestamp: Date.now()
            });
        }
    } finally {
        if (currentTabId) {
            try { await chrome.tabs.remove(currentTabId); } catch (e) { }
        }

        currentItem = null;
        currentTabId = null;
        await saveState();

        if (!isPaused) {
            setTimeout(processNextItem, 1000);
        } else {
            isProcessing = false;
        }
    }
}

function waitForTabLoad(tabId) {
    return new Promise(async resolve => {
        let isResolved = false;
        const done = () => {
            if (isResolved) return;
            isResolved = true;
            chrome.tabs.onUpdated.removeListener(onUpdated);
            chrome.tabs.onRemoved.removeListener(onRemoved);
            resolve();
        };

        const onUpdated = (tId, changeInfo) => {
            if (tId === tabId && changeInfo.status === 'complete') done();
        };

        const onRemoved = (tId) => {
            if (tId === tabId) done();
        };

        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab && tab.status === 'complete') {
                done();
                return;
            }
        } catch (e) {
            done();
            return;
        }

        chrome.tabs.onUpdated.addListener(onUpdated);
        chrome.tabs.onRemoved.addListener(onRemoved);

        // Safety timeout
        setTimeout(done, 30000);
    });
}
