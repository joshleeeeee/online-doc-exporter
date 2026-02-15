export function waitForTabLoad(tabId: number) {
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
        } catch (_) {
            done()
            return
        }

        chrome.tabs.onUpdated.addListener(onUpdated)
        chrome.tabs.onRemoved.addListener(onRemoved)

        setTimeout(done, 30000)
    })
}
