<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import SettingsPanel from '../components/SettingsPanel.vue'
import BatchTab from '../components/BatchTab.vue'
import ManagerTab from '../components/ManagerTab.vue'
import { useSettingsStore } from '../store/settings'
import { useBatchStore } from '../store/batch'
import JSZip from 'jszip'

const version = ref('1.4.0')
const activeTab = ref('main')
const settings = useSettingsStore()
const batchStore = useBatchStore()

// --- Support State ---
const isSupported = ref(false)
const supportMessage = ref('正在检测网页支持情况...')
const isDetecting = ref(true)

// --- Extraction State ---
const isExtracting = ref(false)
const extractingFormat = ref('') // 'markdown' or 'html'

// --- Toast State ---
const toastMsg = ref('')
const showToast = ref(false)

const triggerToast = (msg: string) => {
  toastMsg.value = msg
  showToast.value = true
  setTimeout(() => {
    showToast.value = false
  }, 2000)
}

const checkSupport = async () => {
  isDetecting.value = true
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab || !tab.url) {
      isSupported.value = false
      supportMessage.value = '无法获取网页信息'
      isDetecting.value = false
      return
    }

    const url = tab.url.toLowerCase()
    const isFeishu = url.includes('feishu.cn') || url.includes('larksuite.com')
    const isBoss = url.includes('zhipin.com')

    if (isFeishu) {
      isSupported.value = true
      supportMessage.value = '支持导出：飞书/Lark 文档'
    } else if (isBoss) {
      isSupported.value = true
      supportMessage.value = '支持导出：BOSS 直聘职位'
    } else {
      isSupported.value = false
      supportMessage.value = '当前网页不受支持'
    }
    isDetecting.value = false
  })
}

const copyToClipboard = async (text: string, html: string | null = null) => {
  try {
    if (html) {
      const blobHtml = new Blob([html], { type: 'text/html' })
      const blobText = new Blob([text], { type: 'text/plain' })
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': blobHtml,
          'text/plain': blobText
        })
      ])
    } else {
      await navigator.clipboard.writeText(text)
    }
    return true
  } catch (err) {
    console.error('Clipboard write failed', err)
    return false
  }
}

const executeCopy = async (format: 'markdown' | 'html') => {
  if (isExtracting.value) return
  
  isExtracting.value = true
  extractingFormat.value = format

  const { imageMode, scrollWaitTime, ossConfig } = settings
  const imageConfig = {
    enabled: (imageMode === 'minio'),
    ...ossConfig
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) throw new Error('找不到活动标签页')

    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'EXTRACT_CONTENT',
      format: format,
      options: { imageMode, scrollWaitTime, imageConfig }
    })

    if (response && response.success) {
      const hasImages = response.images && response.images.length > 0
      
      if (imageMode === 'local' && hasImages) {
        const zip = new JSZip()
        const safeTitle = (response.title || 'document').replace(/[\\/:*?"<>|]/g, "_")
        const ext = format === 'markdown' ? '.md' : '.html'
        const filename = safeTitle + ext

        const imgFolder = zip.folder("images")
        response.images.forEach((img: any) => {
          if (img.base64 && img.base64.includes(',')) {
            const base64Data = img.base64.split(',')[1]
            imgFolder?.file(img.filename, base64Data, { base64: true })
          }
        })

        zip.file(filename, response.content)
        const blob = await zip.generateAsync({ type: "blob" })
        const dlUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = dlUrl
        a.download = `${safeTitle}.zip`
        a.click()
        URL.revokeObjectURL(dlUrl)
        triggerToast('已打包下载 ZIP (含图片)')
      } else {
        if (format === 'markdown') {
          await copyToClipboard(response.content)
          triggerToast('Markdown 已复制到剪贴板')
        } else {
          // HTML copy
          const textFallback = response.content.replace(/<[^>]+>/g, '')
          await copyToClipboard(textFallback, response.content)
          triggerToast('富文本已复制到剪贴板')
        }
      }
    } else {
      throw new Error(response?.error || '解析失败')
    }
  } catch (e: any) {
    console.error(e)
    if (e.message.includes("Could not establish connection")) {
      triggerToast('插件已更新，请刷新原页面')
    } else {
      triggerToast('错误: ' + e.message)
    }
  } finally {
    isExtracting.value = false
    extractingFormat.value = ''
  }
}

const executePDF = async () => {
  if (isExtracting.value) return

  isExtracting.value = true
  extractingFormat.value = 'pdf'

  const { scrollWaitTime, ossConfig } = settings
  const imageConfig = {
    enabled: false,
    ...ossConfig
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) throw new Error('找不到活动标签页')

    // Always extract as HTML with base64 images for PDF
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'EXTRACT_CONTENT',
      format: 'html',
      options: { imageMode: 'base64', scrollWaitTime, imageConfig }
    })

    if (response && response.success) {
      // Store content for the print rendering page
      await chrome.storage.local.set({
        printData: {
          title: response.title || 'document',
          content: response.content,
          images: response.images || []
        }
      })

      triggerToast('PDF 正在生成中...')

      // Delegate PDF generation to background (CDP + bookmarks)
      const result = await chrome.runtime.sendMessage({
        action: 'GENERATE_PDF',
        title: response.title || 'document'
      })

      if (result && result.success) {
        triggerToast('PDF 已生成并下载')
      } else {
        throw new Error(result?.error || 'PDF 生成失败')
      }
    } else {
      throw new Error(response?.error || '解析失败')
    }
  } catch (e: any) {
    console.error(e)
    if (e.message.includes('Could not establish connection')) {
      triggerToast('插件已更新，请刷新原页面')
    } else {
      triggerToast('错误: ' + e.message)
    }
  } finally {
    isExtracting.value = false
    extractingFormat.value = ''
  }
}

let statusTimer: number | null = null
onMounted(() => {
  const manifest = chrome.runtime.getManifest()
  version.value = manifest.version
  settings.setMergeBatchContextAware()
  checkSupport()
  
  batchStore.updateStatus()
  statusTimer = window.setInterval(() => batchStore.updateStatus(), 2000)
})

const showDisclaimer = () => {
  alert('【系统免责声明】\n\n1. 本工具仅限个人学习备份与学术研究使用，严禁商业用途。\n2. 使用本工具抓取受限文档可能违反平台协议，使用者需自行承担由此产生的合规性风险或账号封号风险。\n3. 开发者不对数据丢失或法律纠纷负责。\n\n如您继续使用，即表示您已阅读并同意上述所有条款。')
}

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer)
})
</script>

<template>
  <div class="w-full h-full bg-slate-50 dark:bg-[#0B1020] text-slate-800 dark:text-slate-100 flex flex-col overflow-hidden relative">
    <!-- Ambient Background Light (Dark Mode) -->
    <div class="absolute -top-20 -right-20 w-64 h-64 bg-blue-600/10 blur-[100px] rounded-full pointer-events-none"></div>
    <div class="absolute -bottom-20 -left-20 w-64 h-64 bg-indigo-600/10 blur-[100px] rounded-full pointer-events-none"></div>
    <!-- Toast -->
    <transition
      enter-active-class="transition duration-300 ease-out"
      enter-from-class="transform -translate-y-4 opacity-0"
      enter-to-class="transform translate-y-0 opacity-100"
      leave-active-class="transition duration-200 ease-in"
      leave-from-class="transform translate-y-0 opacity-100"
      leave-to-class="transform -translate-y-4 opacity-0"
    >
      <div v-if="showToast" class="absolute top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-gray-800 text-white text-xs rounded-full shadow-xl flex items-center gap-2">
        <span class="text-green-400">✓</span> {{ toastMsg }}
      </div>
    </transition>

    <!-- Header -->
    <header class="h-16 px-5 flex items-center justify-between bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-800/60 shrink-0 z-10">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-500/30">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </div>
        <h1 class="text-lg font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent italic">
          Online Doc Exporter
        </h1>
      </div>
      <div class="flex items-center gap-4">
        <a href="https://github.com/joshleeeeee/online-doc-exporter#sponsor" target="_blank" class="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-3 py-2 rounded-full font-bold hover:bg-amber-200 transition-all hover:scale-105 active:scale-95">
          ☕ 打赏
        </a>
        <div class="flex flex-col items-end">
          <span class="text-[10px] text-slate-400 dark:text-slate-500 font-mono font-bold leading-tight">v{{ version }}</span>
          <button @click="showDisclaimer" class="text-[10px] text-slate-400 dark:text-slate-500 hover:text-blue-500 underline decoration-dotted underline-offset-2 transition-colors leading-tight">免责声明</button>
        </div>
      </div>
    </header>

    <!-- Status Banner (Conditional based on Batch Active) -->
    <div v-if="!batchStore.isProcessing && !batchStore.isPaused && batchStore.queueLength === 0 && !batchStore.currentItem" :class="[
      'px-4 py-1.5 flex items-center gap-2 text-[11px] font-medium transition-colors',
      isDetecting ? 'bg-gray-100 text-gray-500' : 
      isSupported ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' : 
      'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'
    ]">
      <div :class="[
        'w-1.5 h-1.5 rounded-full',
        isDetecting ? 'bg-gray-400 animate-pulse' :
        isSupported ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' :
        'bg-red-500'
      ]"></div>
      {{ supportMessage }}
    </div>

    <!-- Batch Floating Progress -->
    <div v-else class="px-4 py-3 bg-blue-600 text-white flex flex-col gap-2 shadow-md">
       <div class="flex justify-between items-center">
          <span class="text-xs font-bold tracking-widest uppercase">{{ batchStore.isPaused ? '任务已暂停' : '正在抓取队列...' }}</span>
          <div class="flex gap-2">
             <button v-if="!batchStore.isPaused" @click="batchStore.pauseBatch" class="text-[10px] bg-white/20 hover:bg-white/30 px-2 py-1 rounded uppercase font-bold">暂停</button>
             <button v-else @click="batchStore.resumeBatch" class="text-[10px] bg-white/20 hover:bg-white/30 px-2 py-1 rounded uppercase font-bold">继续</button>
          </div>
       </div>
       <div class="w-full h-1.5 bg-blue-400 rounded-full overflow-hidden">
          <div :style="{ width: batchStore.progressPercent + '%' }" class="h-full bg-white transition-all duration-500"></div>
       </div>
       <div class="text-[11px] opacity-90 font-medium">
          已完成 {{ batchStore.processedResults.length }} / 共 {{ batchStore.processedResults.length + batchStore.queueLength + (batchStore.currentItem ? 1 : 0) }}
       </div>
    </div>

    <!-- Content Area -->
    <main class="flex-1 overflow-y-auto p-5 custom-scrollbar relative z-10">
      <!-- Main Tab -->
      <div v-if="activeTab === 'main'" class="h-full flex flex-col pt-0 fade-in">

        <!-- Action Section -->
        <div class="flex flex-col gap-3 mb-6">
          <!-- Primary Action: Markdown -->
          <button 
            @click="executeCopy('markdown')"
            :disabled="!isSupported || isExtracting"
            class="group relative flex flex-col items-center justify-center p-6 rounded-[2rem] bg-white dark:bg-slate-800/40 border-2 border-slate-200/60 dark:border-slate-700/50 hover:border-blue-500 shadow-lg hover:shadow-blue-500/20 transition-all duration-500 disabled:opacity-50"
          >
            <div class="w-14 h-14 mb-3 rounded-2xl bg-blue-600 dark:bg-blue-500 text-white flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:scale-105 transition-transform duration-500">
               <template v-if="isExtracting && extractingFormat === 'markdown'">
                  <div class="w-7 h-7 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
               </template>
               <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10v10M7 17L17 7"/></svg>
            </div>
            <span class="text-xl font-black text-slate-800 dark:text-white tracking-tight">复制 Markdown</span>
            <div class="absolute top-3 right-5 text-[9px] font-black text-blue-500/40 uppercase tracking-widest">Recommended</div>
          </button>

          <!-- PDF Export -->
          <button 
            @click="executePDF"
            :disabled="!isSupported || isExtracting"
            class="group flex items-center justify-between p-4 px-6 rounded-2xl bg-slate-100 dark:bg-slate-800/30 border border-transparent hover:bg-slate-200 dark:hover:bg-slate-800/60 transition-all duration-300 disabled:opacity-50"
          >
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-500 dark:text-rose-400">
                <template v-if="isExtracting && extractingFormat === 'pdf'">
                   <div class="w-4 h-4 border-2 border-rose-400 border-t-transparent rounded-full animate-spin"></div>
                </template>
                <span v-else class="text-[10px] font-bold font-mono">PDF</span>
              </div>
              <span class="text-sm font-bold text-slate-600 dark:text-slate-300">下载为 PDF</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-slate-300 dark:text-slate-700 group-hover:text-rose-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m9 18 6-6-6-6"/></svg>
          </button>

          <!-- Secondary Action: Rich Text -->
          <button 
            @click="executeCopy('html')"
            :disabled="!isSupported || isExtracting"
            class="group flex items-center justify-between p-4 px-6 rounded-2xl bg-slate-100 dark:bg-slate-800/30 border border-transparent hover:bg-slate-200 dark:hover:bg-slate-800/60 transition-all duration-300 disabled:opacity-50"
          >
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-400">
                <template v-if="isExtracting && extractingFormat === 'html'">
                   <div class="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                </template>
                <span v-else class="text-[10px] font-bold font-mono">HTML</span>
              </div>
              <span class="text-sm font-bold text-slate-600 dark:text-slate-300">复制为 富文本</span>
            </div>
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-slate-300 dark:text-slate-700 group-hover:text-blue-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </div>

        <!-- Batch Tools Shortcut -->
        <div class="mt-auto px-1">
          <div class="flex items-center gap-4 mb-2">
            <span class="text-[9px] font-black text-slate-300 dark:text-slate-600 tracking-[0.4em] uppercase">Advanced</span>
            <div class="h-px flex-1 bg-gradient-to-r from-slate-200 dark:from-slate-800 to-transparent"></div>
          </div>
          <button 
            @click="activeTab = 'batch'"
            class="group w-full flex items-center gap-4 p-4 rounded-2xl bg-indigo-600 dark:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/40 hover:-translate-y-0.5 transition-all duration-500"
          >
            <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center group-hover:bg-white group-hover:text-indigo-600 transition-all duration-500 shrink-0">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <div class="text-left flex-1 min-w-0">
              <div class="text-[14px] font-black tracking-tight truncate">批量扫描与导出</div>
              <div class="text-[10px] text-indigo-100 font-medium opacity-70 truncate">探测当前页面/列表下的所有文档链接</div>
            </div>
            <!-- Chevron on the right to fill space -->
            <div class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </div>
          </button>
        </div>
      </div>

      <!-- Batch Tab -->
      <div v-if="activeTab === 'batch'" class="fade-in h-full">
        <BatchTab />
      </div>

      <!-- Download Center (Manager) -->
      <div v-if="activeTab === 'manager'" class="fade-in h-full">
        <ManagerTab />
      </div>

      <!-- Settings Tab -->
      <div v-if="activeTab === 'settings'" class="fade-in">
        <SettingsPanel />
      </div>
    </main>

    <footer class="h-20 border-t border-slate-200/60 dark:border-slate-800/60 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl px-6 flex items-center justify-around shrink-0 relative z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
      <button @click="activeTab = 'main'" :class="[activeTab === 'main' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/20 shadow-inner' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800/50']" class="flex flex-col items-center justify-center px-5 py-2 rounded-2xl transition-all duration-500 group">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 mb-1 transition-transform duration-500 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <span class="text-[11px] font-black uppercase tracking-tighter">首页</span>
      </button>

      <button @click="activeTab = 'batch'" :class="[activeTab === 'batch' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/20 shadow-inner' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800/50']" class="flex flex-col items-center justify-center px-5 py-2 rounded-2xl transition-all duration-500 group">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 mb-1 transition-transform duration-500 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span class="text-[11px] font-black uppercase tracking-tighter">批量</span>
      </button>
      
      <button @click="activeTab = 'manager'" :class="[activeTab === 'manager' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/20 shadow-inner' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800/50']" class="flex flex-col items-center justify-center px-5 py-2 rounded-2xl transition-all duration-500 relative group">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 mb-1 transition-transform duration-500 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        <span class="text-[11px] font-black uppercase tracking-tighter">下载</span>
        <!-- Numeric Badge -->
        <span v-if="batchStore.processedResults.length > 0" 
          class="absolute top-1 right-3.5 min-w-[17px] h-[17px] bg-red-500 text-white text-[9px] font-black rounded-full border border-white dark:border-slate-900 shadow-lg shadow-red-500/20 flex items-center justify-center leading-none tabular-nums animate-in zoom-in duration-300"
        >
          <span class="translate-y-[0.5px]">{{ batchStore.processedResults.length > 99 ? '99+' : batchStore.processedResults.length }}</span>
        </span>
      </button>

      <button @click="activeTab = 'settings'" :class="[activeTab === 'settings' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/20 shadow-inner' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800/50']" class="flex flex-col items-center justify-center px-5 py-2 rounded-2xl transition-all duration-500 group">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 mb-1 transition-transform duration-500 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1-2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span class="text-[11px] font-black uppercase tracking-tighter">设置</span>
      </button>
    </footer>
  </div>
</template>

<style>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #e2e8f0;
  border-radius: 10px;
}
.dark .custom-scrollbar::-webkit-scrollbar-thumb {
  background: #334155;
}

.fade-in {
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%239ca3af' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-repeat: no-repeat;
  background-position: right 0.5rem center;
  background-size: 1.5em 1.5em;
}

button:disabled {
  cursor: not-allowed;
}

.hide-scrollbar::-webkit-scrollbar {
  display: none;
}
.hide-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
