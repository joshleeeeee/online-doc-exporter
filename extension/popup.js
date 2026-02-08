document.addEventListener('DOMContentLoaded', () => {
    // --- Auto Versioning ---
    const manifest = chrome.runtime.getManifest();
    const versionEl = document.getElementById('version-text');
    if (versionEl) versionEl.innerText = `v${manifest.version}`;

    // --- Tabs Logic ---
    // --- Tabs Logic ---
    const tabs = document.querySelectorAll('.tab-btn');
    const panes = document.querySelectorAll('.tab-pane');
    const settingsBtn = document.getElementById('btn-settings-icon');

    const switchTab = (targetId) => {
        tabs.forEach(t => t.classList.remove('active'));
        panes.forEach(p => p.classList.remove('active'));
        if (settingsBtn) settingsBtn.classList.remove('active');

        // Check if it is a main tab or settings
        if (targetId === 'tab-settings') {
            if (settingsBtn) settingsBtn.classList.add('active');
            document.getElementById('tab-settings').classList.add('active');
        } else {
            const activeTab = document.querySelector(`.tab-btn[data-target="${targetId}"]`);
            if (activeTab) activeTab.classList.add('active');
            document.getElementById(targetId).classList.add('active');
        }

        // Refresh list if switching to manager
        if (targetId === 'tab-manager') {
            updateStatus();
        }
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');
            switchTab(targetId);
        });
    });

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            switchTab('tab-settings');
        });
    }

    // --- Initial State Recovery ---
    chrome.runtime.sendMessage({ action: 'GET_BATCH_STATUS' }, (res) => {
        if (res && (res.isProcessing || res.queueLength > 0)) {
            startPolling();
        }
        updateStatus(); // Also update manager tab
    });


    // --- Single Copy Logic & Settings ---
    // --- Single Copy Logic & Settings ---
    const btnMarkdown = document.getElementById('btn-markdown');
    const btnRich = document.getElementById('btn-rich');
    const selectImageMode = document.getElementById('select-image-mode');
    const toggleForeground = document.getElementById('toggle-foreground');
    const inputScrollSpeed = document.getElementById('input-scroll-speed');
    const scrollSpeedValue = document.getElementById('scroll-speed-value');
    const toast = document.getElementById('toast');

    // Image Upload Elements
    // const toggleUploadImage = document.getElementById('toggle-upload-image'); // Removed
    const imageUploadConfig = document.getElementById('image-upload-config');
    const ossInputs = {
        provider: document.getElementById('oss-provider'),
        endpoint: document.getElementById('oss-endpoint'),
        accessKeyId: document.getElementById('oss-access-key'),
        accessKeySecret: document.getElementById('oss-secret-key'),
        bucket: document.getElementById('oss-bucket'),
        region: document.getElementById('oss-region'),
        domain: document.getElementById('oss-domain'),
        folder: document.getElementById('oss-folder')
    };

    // Restore State
    const savedMode = localStorage.getItem('feishu-copy-image-mode');
    if (savedMode) {
        selectImageMode.value = savedMode;
    } else {
        // Migration from old toggles
        const oldBase64 = localStorage.getItem('feishu-copy-base64') === 'true';
        const oldUpload = localStorage.getItem('feishu-copy-upload-image') === 'true';
        if (oldUpload) selectImageMode.value = 'minio';
        else if (oldBase64) selectImageMode.value = 'base64';
        else selectImageMode.value = 'original';
    }

    // Set initial visibility
    imageUploadConfig.style.display = (selectImageMode.value === 'minio') ? 'block' : 'none';

    const savedForeground = localStorage.getItem('feishu-copy-foreground');
    if (savedForeground === 'true') toggleForeground.checked = true;

    const savedScrollSpeed = localStorage.getItem('feishu-copy-scroll-speed');
    if (savedScrollSpeed) {
        inputScrollSpeed.value = savedScrollSpeed;
        scrollSpeedValue.innerText = (parseInt(savedScrollSpeed) / 1000).toFixed(1) + 's';
    }

    // (Old upload restore removed, handled by mode)

    // Restore OSS Config
    const savedOssConfig = JSON.parse(localStorage.getItem('feishu-copy-oss-config') || '{}');
    if (savedOssConfig) {
        Object.keys(ossInputs).forEach(key => {
            if (savedOssConfig[key] && ossInputs[key]) {
                ossInputs[key].value = savedOssConfig[key];
            }
        });
    }

    selectImageMode.addEventListener('change', () => {
        const mode = selectImageMode.value;
        localStorage.setItem('feishu-copy-image-mode', mode);
        imageUploadConfig.style.display = (mode === 'minio') ? 'block' : 'none';

        // Notify if local mode is selected in Single Tab (optional UX improvement)
        if (mode === 'local') {
            // Maybe show a hint that local mode works best with Download Center?
        }
    });

    toggleForeground.addEventListener('change', () => {
        localStorage.setItem('feishu-copy-foreground', toggleForeground.checked);
    });

    // Removed old toggle listeners

    // Save OSS Config on change
    Object.values(ossInputs).forEach(input => {
        input.addEventListener('change', () => {
            const config = {};
            Object.keys(ossInputs).forEach(key => {
                config[key] = ossInputs[key].value.trim();
            });
            localStorage.setItem('feishu-copy-oss-config', JSON.stringify(config));
        });
    });

    inputScrollSpeed.addEventListener('input', () => {
        scrollSpeedValue.innerText = (parseInt(inputScrollSpeed.value) / 1000).toFixed(1) + 's';
    });

    inputScrollSpeed.addEventListener('change', () => {
        localStorage.setItem('feishu-copy-scroll-speed', inputScrollSpeed.value);
    });

    const showToast = (msg) => {
        toast.textContent = msg;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    };

    const copyToClipboard = async (text, html = null) => {
        try {
            if (html) {
                const blobHtml = new Blob([html], { type: 'text/html' });
                const blobText = new Blob([text], { type: 'text/plain' });
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'text/html': blobHtml,
                        'text/plain': blobText
                    })
                ]);
            } else {
                await navigator.clipboard.writeText(text);
            }
            return true;
        } catch (err) {
            console.error('Clipboard write failed', err);
            return false;
        }
    };

    const executeCopy = async (format) => {
        const imageMode = selectImageMode.value; // 'original', 'base64', 'local', 'minio'
        const scrollWaitTime = parseInt(inputScrollSpeed.value) || 1500;

        const imageConfig = {
            enabled: (imageMode === 'minio'),
            provider: ossInputs.provider.value,
            endpoint: ossInputs.endpoint.value,
            accessKeyId: ossInputs.accessKeyId.value,
            accessKeySecret: ossInputs.accessKeySecret.value,
            bucket: ossInputs.bucket.value,
            region: ossInputs.region.value,
            domain: ossInputs.domain.value,
            folder: ossInputs.folder.value
        };

        const btn = format === 'markdown' ? btnMarkdown : btnRich;
        const span = btn.querySelector('span');
        const originalText = span.innerText;

        span.innerText = '正在处理...';
        btn.style.opacity = '0.7';
        btn.disabled = true;

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) throw new Error('找不到活动标签页');

            const response = await chrome.tabs.sendMessage(tab.id, {
                action: 'EXTRACT_CONTENT',
                format: format,
                options: { imageMode, scrollWaitTime, imageConfig }
            });

            if (response && response.success) {
                if (format === 'markdown') {
                    await copyToClipboard(response.content);
                    showToast('Markdown 已复制');
                } else {
                    const textFallback = response.content.replace(/<[^>]+>/g, '');
                    await copyToClipboard(textFallback, response.content);
                    showToast('富文本已复制');
                }
            } else {
                throw new Error(response.error || '未知错误');
            }

        } catch (e) {
            console.error(e);
            if (e.message.includes("Could not establish connection") || e.message.includes("Receiving end does not exist")) {
                showToast('插件已更新，请刷新页面后重试');
            } else {
                showToast('错误: ' + e.message);
            }
        } finally {
            span.innerText = originalText;
            btn.style.opacity = '1';
            btn.disabled = false;
        }
    };

    btnMarkdown.addEventListener('click', () => executeCopy('markdown'));
    btnRich.addEventListener('click', () => executeCopy('html'));

    // --- Batch & Manager Logic ---
    const btnScan = document.getElementById('btn-scan');
    const btnBatchStart = document.getElementById('btn-batch-start');
    const btnBatchPause = document.getElementById('btn-batch-pause');
    const btnBatchResume = document.getElementById('btn-batch-resume');
    const btnDownloadZip = document.getElementById('btn-download-zip');
    const btnClearAll = document.getElementById('btn-clear-all');

    const listContainer = document.getElementById('batch-list');
    const managerList = document.getElementById('manager-list');
    const checkAll = document.getElementById('batch-check-all');
    const managerCheckAll = document.getElementById('manager-check-all');
    const managerTotalSizeLabel = document.getElementById('manager-total-size');

    const countLabel = document.getElementById('batch-count');

    const progressContainer = document.getElementById('batch-progress-container');
    const globalProgressArea = document.getElementById('global-progress-area');
    const progressFill = document.getElementById('batch-progress-fill');
    const statusText = document.getElementById('batch-status-text');

    let scannedLinks = [];
    let pollInterval = null;

    // --- Actions ---
    btnScan.addEventListener('click', async () => {
        btnScan.disabled = true;
        const scanSpan = btnScan.querySelector('span');
        scanSpan.innerText = '正在扫描...';
        listContainer.innerHTML = '<div class="empty-state">正在扫描页面内容...</div>';

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab) throw new Error('找不到活动标签页');

            const response = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_LINKS' });

            if (response && response.success) {
                scannedLinks = response.links || [];
                renderBatchList();
            } else {
                listContainer.innerHTML = '<div class="empty-state">未发现文档链接。</div>';
            }
        } catch (e) {
            console.error(e);
            listContainer.innerHTML = '<div class="empty-state">扫描失败: ' + e.message + '</div>';
        } finally {
            btnScan.disabled = false;
            btnScan.querySelector('span').innerText = '扫描链接';
        }
    });

    const renderBatchList = () => {
        listContainer.innerHTML = '';
        if (scannedLinks.length === 0) {
            listContainer.innerHTML = '<div class="empty-state">未找到相关飞书文档链接。</div>';
            countLabel.innerText = '找到 0 个';
            btnBatchStart.disabled = true;
            return;
        }

        countLabel.innerText = `找到 ${scannedLinks.length} 个`;
        btnBatchStart.disabled = false;

        scannedLinks.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'batch-item';
            div.innerHTML = `
                <label>
                    <input type="checkbox" class="batch-checkbox" value="${index}" checked>
                    <span class="batch-item-text" title="${item.url}">${item.title}</span>
                </label>
            `;
            listContainer.appendChild(div);
        });
    };

    checkAll.addEventListener('change', () => {
        const checkboxes = document.querySelectorAll('.batch-checkbox');
        checkboxes.forEach(cb => cb.checked = checkAll.checked);
    });

    btnBatchPause.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'PAUSE_BATCH' }, () => updateStatus());
    });

    btnBatchResume.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'RESUME_BATCH' }, () => {
            startPolling();
            updateStatus();
        });
    });

    btnBatchStart.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.batch-checkbox:checked');
        if (checkboxes.length === 0) {
            showToast('请先选择要抓取的文档');
            return;
        }

        btnBatchStart.disabled = true;
        btnScan.disabled = true;

        const selectedItems = Array.from(checkboxes).map(cb => ({
            url: scannedLinks[cb.value].url,
            title: scannedLinks[cb.value].title
        }));

        chrome.runtime.sendMessage({
            action: 'START_BATCH_PROCESS',
            items: selectedItems,
            format: 'markdown',
            options: {
                imageMode: selectImageMode.value,
                foreground: toggleForeground.checked,
                scrollWaitTime: parseInt(inputScrollSpeed.value) || 1500,
                imageConfig: {
                    enabled: (selectImageMode.value === 'minio'),
                    provider: ossInputs.provider.value,
                    endpoint: ossInputs.endpoint.value,
                    accessKeyId: ossInputs.accessKeyId.value,
                    accessKeySecret: ossInputs.accessKeySecret.value,
                    bucket: ossInputs.bucket.value,
                    region: ossInputs.region.value,
                    domain: ossInputs.domain.value,
                    folder: ossInputs.folder.value
                }
            }
        }, (res) => {
            if (res && res.success) {
                startPolling();
                showToast('已加入后台抓取队列');
            } else {
                btnBatchStart.disabled = false;
                btnScan.disabled = false;
                showToast('启动任务失败');
            }
        });
    });


    btnClearAll.addEventListener('click', () => {
        if (confirm('确定要清空所有已下载的历史记录吗？正在进行的任务也会停止。')) {
            chrome.runtime.sendMessage({ action: 'CLEAR_BATCH_RESULTS' }, () => {
                updateStatus();
            });
        }
    });

    // --- Manager Selection Logic ---
    const MAX_ZIP_SIZE_MB = 300;

    // Helper to calculate estimated size
    const calculateSize = (item) => {
        let size = 0;
        if (item.content) size += item.content.length;
        if (item.images) {
            item.images.forEach(img => {
                if (img.base64) size += img.base64.length;
            });
        }
        return size;
    };

    const formatSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };

    const updateManagerSelection = () => {
        const checkboxes = document.querySelectorAll('.manager-checkbox:checked');
        let totalSize = 0;

        checkboxes.forEach(cb => {
            const size = parseInt(cb.getAttribute('data-size') || '0');
            totalSize += size;
        });

        const sizeMB = (totalSize / (1024 * 1024)).toFixed(1);
        managerTotalSizeLabel.innerText = `已选: ${sizeMB} MB / 限制: ${MAX_ZIP_SIZE_MB} MB`;

        if (totalSize > MAX_ZIP_SIZE_MB * 1024 * 1024) {
            managerTotalSizeLabel.style.color = '#ef4444';
        } else {
            managerTotalSizeLabel.style.color = '#666';
        }

        btnDownloadZip.disabled = checkboxes.length === 0;

        // Update check-all state
        const allCheckboxes = document.querySelectorAll('.manager-checkbox:not([disabled])');
        if (allCheckboxes.length > 0) {
            managerCheckAll.checked = checkboxes.length === allCheckboxes.length;
            managerCheckAll.disabled = false;
        } else {
            managerCheckAll.checked = false;
            managerCheckAll.disabled = true;
        }
    };

    managerCheckAll.addEventListener('change', () => {
        const checkboxes = document.querySelectorAll('.manager-checkbox:not([disabled])');
        const isChecked = managerCheckAll.checked;

        if (isChecked) {
            // Try to select all, stop if limit reached
            let currentTotal = 0;
            const limitBytes = MAX_ZIP_SIZE_MB * 1024 * 1024;
            let stopped = false;

            checkboxes.forEach(cb => {
                const size = parseInt(cb.getAttribute('data-size') || '0');
                if (currentTotal + size <= limitBytes) {
                    cb.checked = true;
                    currentTotal += size;
                } else {
                    cb.checked = false;
                    stopped = true;
                }
            });

            if (stopped) {
                showToast(`已达到 ${MAX_ZIP_SIZE_MB}MB 限制，部分文档未选中`);
            }
        } else {
            checkboxes.forEach(cb => cb.checked = false);
        }
        updateManagerSelection();
    });

    // --- Status & Rendering ---
    const updateStatus = () => {
        chrome.runtime.sendMessage({ action: 'GET_BATCH_STATUS' }, (res) => {
            if (!res) return;
            const { isProcessing, isPaused, queue, results, currentItem } = res;
            const queueList = queue || [];
            const queueLength = queueList.length;

            const isActive = isProcessing || queueLength > 0 || currentItem || isPaused;

            // Updated Toggle Logic for Global Progress Area
            if (isActive) {
                globalProgressArea.style.display = 'block';
                btnBatchStart.disabled = true;

                if (isPaused) {
                    btnBatchPause.style.display = 'none';
                    btnBatchResume.style.display = 'flex';
                } else {
                    btnBatchPause.style.display = 'flex';
                    btnBatchResume.style.display = 'none';
                }
            } else {
                // If it was polling but now finished
                if (pollInterval && !isProcessing && queueLength === 0 && !currentItem) {
                    clearInterval(pollInterval);
                    pollInterval = null;
                    progressFill.style.width = '100%';
                    statusText.innerText = '抓取任务已完成';
                    setTimeout(() => {
                        globalProgressArea.style.display = 'none';
                        btnBatchStart.disabled = false;
                        btnScan.disabled = false;
                    }, 3000);
                } else if (!pollInterval) {
                    globalProgressArea.style.display = 'none';
                    btnBatchStart.disabled = false;
                    btnScan.disabled = false;
                }
            }

            // Update Batch Tab/Bottom Progress Details
            if (isActive) {
                const finishedCount = results.length;
                const activeCount = currentItem ? 1 : 0;
                const totalInThisBatch = finishedCount + activeCount + queueLength;

                statusText.innerText = `进度: 已完成 ${finishedCount} | ${isPaused ? '暂停中' : '正在抓取'} ${activeCount} | 待抓取 ${queueLength}`;

                const percent = totalInThisBatch > 0 ? (finishedCount / totalInThisBatch) * 100 : 0;
                progressFill.style.width = Math.min(100, percent) + '%';
                btnScan.disabled = true;
            }


            // Update Manager Tab
            renderManagerList(results, currentItem, queueList);
            // btnDownloadZip.disabled update is handled inside renderManagerList/updateManagerSelection
        });
    };

    const renderManagerList = (results, currentItem, queue) => {
        managerList.innerHTML = '';

        const hasWork = results.length > 0 || currentItem || queue.length > 0;
        if (!hasWork) {
            managerList.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" width="48" height="48" style="margin-bottom:12px; opacity:0.2">
                        <path d="M19 11H5M19 11C20.1046 11 21 11.8954 21 13V19C21 20.1046 20.1046 21 19 21H5C3.89543 21 3 20.1046 3 19V13C3 11.8954 3.89543 11 5 11M19 11V9C19 7.89543 18.1046 7 17 7M5 11V9C5 7.89543 5.89543 7 7 7M17 7V5C17 3.89543 16.1046 3 15 3H9C7.89543 3 7 3.89543 7 5V7M17 7H7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                    <span>下载中心暂无记录</span>
                </div>`;
            return;
        }

        // Helper to create list items
        const createItemEl = (title, status, url, content = null, images = []) => {
            const div = document.createElement('div');
            div.className = 'batch-item';
            div.style.justifyContent = 'space-between';

            let statusIcon = '';
            let statusColor = '#1f2329';
            let actions = '';
            let checkboxHtml = '';

            // Calculate size if success
            let size = 0;
            let sizeText = '';

            if (status === 'success') {
                size = calculateSize({ content, images });
                sizeText = `<span style="font-size:11px; color:#8f959e; margin-left:8px;">(${formatSize(size)})</span>`;
                checkboxHtml = `<input type="checkbox" class="manager-checkbox" data-url="${url}" data-size="${size}" style="margin-right:8px;">`;
            } else {
                checkboxHtml = `<span style="width:13px; margin-right:8px; display:inline-block;"></span>`; // Spacer
            }

            if (status === 'success') {
                statusIcon = `<svg viewBox="0 0 24 24" fill="none" width="16" height="16" style="margin-right:8px"><path d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9888C18.7182 19.7228 16.9033 20.9972 14.8354 21.6226C12.7674 22.2479 10.5501 22.2031 8.51131 21.4939C6.47257 20.7848 4.7182 19.4471 3.51187 17.6835C2.30555 15.9199 1.71181 13.8214 1.81596 11.7019C1.92011 9.58232 2.71677 7.55024 4.08502 5.9103C5.45328 4.27035 7.31961 3.11196 9.40017 2.61099C11.4807 2.11003 13.6654 2.2929 15.63 3.13" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M22 4L12 14.01L9 11.01" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                actions = `<button class="btn-item-download" data-url="${url}" title="单独下载"><svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 10L12 15L17 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 15V3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
            } else if (status === 'failed') {
                statusIcon = `<svg viewBox="0 0 24 24" fill="none" width="16" height="16" style="margin-right:8px"><circle cx="12" cy="12" r="10" stroke="#ef4444" stroke-width="2"/><line x1="15" y1="9" x2="9" y2="15" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="9" x2="15" y2="15" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/></svg>`;
                statusColor = '#ef4444';
            } else if (status === 'processing') {
                statusIcon = `<div class="loading-spin-small" style="margin-right:8px"></div>`;
                statusColor = '#3370ff';
            } else {
                // pending
                statusIcon = `<svg viewBox="0 0 24 24" fill="none" width="16" height="16" style="margin-right:8px; opacity:0.5"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><path d="M12 6V12L16 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
                statusColor = '#8f959e';
            }

            actions += `<button class="btn-item-delete" data-url="${url}" title="删除"><svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M3 6H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;

            div.innerHTML = `
                <div style="display:flex; align-items:center; flex:1; min-width:0;">
                    ${checkboxHtml}
                    ${statusIcon}
                    <div style="display:flex; flex-direction:column; overflow:hidden;">
                         <span class="batch-item-text" style="color:${statusColor}">${title}${status === 'processing' ? ' (抓取中...)' : (status === 'pending' ? ' (等待中)' : '')}</span>
                    </div>
                    ${sizeText}
                </div>
                <div class="manager-actions">
                    ${actions}
                </div>
            `;
            return div;
        };

        // 1. Show Current Item
        if (currentItem) {
            managerList.appendChild(createItemEl(currentItem.title, 'processing', currentItem.url));
        }

        // 2. Show Queue
        queue.forEach(item => {
            managerList.appendChild(createItemEl(item.title, 'pending', item.url));
        });

        // 3. Show Results (sorted)
        // 3. Show Results (sorted)
        const sorted = [...results].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        sorted.forEach(item => {
            managerList.appendChild(createItemEl(item.title, item.status, item.url, item.content, item.images));
        });

        // Delegate clicks
        managerList.querySelectorAll('.manager-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const currentTotal = parseFloat(managerTotalSizeLabel.innerText.split(' ')[1]) * 1024 * 1024; // loose parsing, better re-calc
                const size = parseInt(cb.getAttribute('data-size'));
                const limitBytes = MAX_ZIP_SIZE_MB * 1024 * 1024;

                // Re-calculate real total
                let realTotal = 0;
                document.querySelectorAll('.manager-checkbox:checked').forEach(c => realTotal += parseInt(c.getAttribute('data-size')));

                if (realTotal > limitBytes && cb.checked) {
                    e.preventDefault();
                    cb.checked = false;
                    showToast(`已达到 ${MAX_ZIP_SIZE_MB}MB 限制，无法继续选择`);
                }
                updateManagerSelection();
            });
        });

        // Initial stat update
        updateManagerSelection();
        managerList.querySelectorAll('.btn-item-download').forEach(btn => {
            btn.onclick = () => {
                const url = btn.getAttribute('data-url');
                const doc = results.find(r => r.url === url);
                if (doc) downloadFile(doc.title, doc.content);
            };
        });

        managerList.querySelectorAll('.btn-item-delete').forEach(btn => {
            btn.onclick = () => {
                const url = btn.getAttribute('data-url');
                chrome.runtime.sendMessage({ action: 'DELETE_BATCH_ITEM', url }, () => updateStatus());
            };
        });
    };

    const downloadFile = (title, content) => {
        const filename = title.replace(/[\\/:*?"<>|]/g, "_") + ".md";
        const blob = new Blob([content], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    btnDownloadZip.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.manager-checkbox:checked');
        if (checkboxes.length === 0) {
            showToast('请选择要下载的文件');
            return;
        }

        const selectedUrls = new Set(Array.from(checkboxes).map(cb => cb.getAttribute('data-url')));

        chrome.runtime.sendMessage({ action: 'GET_BATCH_STATUS' }, async (res) => {
            if (!res || !res.results) return;
            const zip = new JSZip();
            let count = 0;

            // Only process selected items
            res.results.forEach(item => {
                if (item.status === 'success' && selectedUrls.has(item.url)) {
                    // Safe filename
                    let safeTitle = item.title.replace(/[\\/:*?"<>|]/g, "_");
                    // avoid duplicates in same zip
                    if (zip.file(safeTitle + ".md")) {
                        safeTitle += `_${Date.now().toString().slice(-4)}`;
                    }
                    const filename = safeTitle + ".md";

                    // Handle Images Logic
                    if (item.images && item.images.length > 0) {
                        const imgFolder = zip.folder("images");
                        item.images.forEach(img => {
                            if (img.base64 && img.base64.includes(',')) {
                                const base64Data = img.base64.split(',')[1];
                                imgFolder.file(img.filename, base64Data, { base64: true });
                            }
                        });
                    }

                    zip.file(filename, item.content);
                    count++;
                }
            });

            if (count === 0) {
                showToast('没有抓取成功的文件');
                return;
            }
            const blob = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `飞书批量导出_${new Date().toISOString().slice(0, 10)}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        });
    });

    const startPolling = () => {
        if (pollInterval) clearInterval(pollInterval);
        updateStatus(); // Initial update
        pollInterval = setInterval(updateStatus, 2000);
    };

    // --- Legal Disclaimer Alert ---
    const disclaimerLink = document.getElementById('disclaimer-link');
    disclaimerLink.addEventListener('click', (e) => {
        e.preventDefault();
        alert('【系统免责声明】\n\n1. 本工具仅限个人学习备份与学术研究使用，严禁商业用途。\n2. 使用本工具抓取受限文档可能违反平台协议，使用者需自行承担由此产生的合规性风险或账号封号风险。\n3. 开发者不对数据丢失或法律纠纷负责。\n\n如您继续使用，即表示您已阅读并同意上述所有条款。');
    });
});
