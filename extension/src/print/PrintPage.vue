<script setup lang="ts">
import { ref, onMounted } from 'vue'

const title = ref('加载中...')
const htmlContent = ref('')
const isLoading = ref(true)
const errorMsg = ref('')

const handlePrint = () => {
  window.print()
}

onMounted(async () => {
  try {
    const data = await chrome.storage.local.get(['printData']) as { printData?: { title?: string; content: string; images?: { filename: string; base64: string }[] } }
    if (!data.printData) {
      errorMsg.value = '没有找到可打印的内容'
      isLoading.value = false
      return
    }

    const { title: docTitle, content, images } = data.printData
    title.value = docTitle || '文档'
    document.title = `${title.value} - PDF 预览`

    // Process content: if images are stored as local references, replace with base64
    let processedContent = content
    if (images && images.length > 0) {
      images.forEach((img: { filename: string; base64: string }) => {
        if (img.base64 && img.filename) {
          processedContent = processedContent.replace(
            new RegExp(`images/${img.filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
            img.base64
          )
        }
      })
    }

    htmlContent.value = processedContent
    isLoading.value = false

    // Signal to background CDP that rendering is complete
    ;(window as any).__PRINT_READY__ = true
  } catch (e: any) {
    errorMsg.value = '加载失败: ' + e.message
    isLoading.value = false
  }
})
</script>

<template>
  <div class="print-page">
    <!-- Screen-only toolbar -->
    <div class="toolbar no-print">
      <div class="toolbar-inner">
        <div class="toolbar-left">
          <div class="logo">
            <svg xmlns="http://www.w3.org/2000/svg" class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div>
            <h1 class="toolbar-title">{{ title }}</h1>
            <p class="toolbar-hint">使用浏览器打印功能保存为 PDF（⌘P / Ctrl+P）</p>
          </div>
        </div>
        <button class="print-btn" @click="handlePrint">
          <svg xmlns="http://www.w3.org/2000/svg" class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <rect x="6" y="14" width="12" height="8" />
          </svg>
          打印 / 保存 PDF
        </button>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="isLoading" class="status-msg">
      <div class="spinner"></div>
      <p>正在加载文档内容...</p>
    </div>

    <!-- Error State -->
    <div v-else-if="errorMsg" class="status-msg error">
      <p>⚠️ {{ errorMsg }}</p>
    </div>

    <!-- Document Content -->
    <article v-else class="document-body" v-html="htmlContent"></article>
  </div>
</template>

<style>
/* ========== Reset & Base ========== */
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  font-size: 14px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  color: #1a1a1a;
  background: #f0f2f5;
  line-height: 1.8;
  -webkit-font-smoothing: antialiased;
}

/* ========== Toolbar (screen only) ========== */
.toolbar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid #e5e7eb;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.toolbar-inner {
  max-width: 900px;
  margin: 0 auto;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.logo {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.logo-icon {
  width: 20px;
  height: 20px;
  color: white;
}

.toolbar-title {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 400px;
}

.toolbar-hint {
  font-size: 12px;
  color: #9ca3af;
  margin-top: 2px;
}

.print-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  background: linear-gradient(135deg, #3b82f6, #6366f1);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
  flex-shrink: 0;
}

.print-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(99, 102, 241, 0.4);
}

.print-btn:active {
  transform: translateY(0);
}

.btn-icon {
  width: 18px;
  height: 18px;
}

/* ========== Status Messages ========== */
.status-msg {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 80px 20px;
  color: #6b7280;
  font-size: 16px;
}

.status-msg.error {
  color: #ef4444;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e5e7eb;
  border-top: 3px solid #6366f1;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* ========== Document Body ========== */
.document-body {
  max-width: 900px;
  margin: 32px auto;
  padding: 60px 72px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
  min-height: 80vh;
}

.document-body h1 {
  font-size: 28px;
  font-weight: 800;
  color: #111827;
  margin: 0 0 24px 0;
  line-height: 1.4;
  border-bottom: 2px solid #e5e7eb;
  padding-bottom: 12px;
}

.document-body h2 {
  font-size: 22px;
  font-weight: 700;
  color: #1f2937;
  margin: 32px 0 16px 0;
  line-height: 1.4;
}

.document-body h3 {
  font-size: 18px;
  font-weight: 600;
  color: #374151;
  margin: 24px 0 12px 0;
  line-height: 1.4;
}

.document-body p {
  margin: 0 0 12px 0;
  line-height: 1.8;
  color: #374151;
}

.document-body ul, .document-body ol {
  margin: 0 0 16px 0;
  padding-left: 24px;
}

.document-body li {
  margin-bottom: 6px;
  line-height: 1.7;
}

.document-body blockquote {
  margin: 16px 0;
  padding: 12px 20px;
  border-left: 4px solid #6366f1;
  background: #f8fafc;
  color: #4b5563;
  border-radius: 0 8px 8px 0;
}

.document-body pre {
  margin: 16px 0;
  padding: 16px 20px;
  background: #1e293b;
  color: #e2e8f0;
  border-radius: 8px;
  overflow-x: auto;
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
}

.document-body code {
  font-family: 'SF Mono', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
}

.document-body p code, .document-body li code {
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  color: #e11d48;
  font-size: 0.9em;
}

.document-body img {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  margin: 8px 0;
}

.document-body table {
  width: 100%;
  border-collapse: collapse;
  margin: 16px 0;
  font-size: 13px;
}

.document-body table td, .document-body table th {
  border: 1px solid #d1d5db;
  padding: 8px 12px;
  text-align: left;
}

.document-body table tr:nth-child(even) {
  background: #f9fafb;
}

.document-body hr {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 24px 0;
}

.document-body a {
  color: #3b82f6;
  text-decoration: none;
}

.document-body a:hover {
  text-decoration: underline;
}

/* ========== Print Styles ========== */
@media print {
  .no-print {
    display: none !important;
  }

  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  html, body {
    background: white !important;
    margin: 0 !important;
    padding: 0 !important;
    font-size: 12px !important;
  }

  .print-page {
    background: white;
  }

  .document-body {
    max-width: none;
    margin: 0;
    /* Use padding to ensure content spacing, independent of Chrome's Margins setting */
    padding: 1.5cm 2cm !important;
    box-shadow: none;
    border-radius: 0;
    min-height: auto;
  }

  .document-body pre {
    white-space: pre-wrap;
    word-wrap: break-word;
    background: #f3f4f6 !important;
    color: #1e293b !important;
    border: 1px solid #d1d5db;
  }

  .document-body img {
    max-width: 100%;
    page-break-inside: avoid;
  }

  .document-body h1, .document-body h2, .document-body h3 {
    page-break-after: avoid;
  }

  .document-body table {
    page-break-inside: auto;
  }

  .document-body tr {
    page-break-inside: avoid;
  }

  .document-body blockquote {
    border-left: 3px solid #6366f1;
    background: #f8fafc !important;
  }

  /* Let @page margin be 0 so our padding handles spacing. This avoids
     Chrome's margin dropdown from creating double-margins. */
  @page {
    margin: 0;
    size: A4;
  }
}
</style>
