<script setup lang="ts">
import { ref, computed } from 'vue'
import { useBatchStore, type BatchItem } from '../store/batch'
import JSZip from 'jszip'

const batchStore = useBatchStore()
const selectedUrls = ref<Set<string>>(new Set())

const VOLUME_SIZE_MB = 200
const VOLUME_SIZE_BYTES = VOLUME_SIZE_MB * 1024 * 1024
const MEMORY_WATERLINE_MB = 140
const MEMORY_WATERLINE_BYTES = MEMORY_WATERLINE_MB * 1024 * 1024
const ZIP_HEAP_SOFT_LIMIT_MB = 320
const ZIP_HEAP_HARD_LIMIT_MB = 420

const isDownloading = ref(false)
const downloadProgress = ref('')

const getHeapUsageMb = () => {
  const mem = (performance as any)?.memory
  if (!mem?.usedJSHeapSize) return null
  return mem.usedJSHeapSize / (1024 * 1024)
}

const formatSize = (bytes: number = 0) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

const totalSelectedSize = computed(() => {
  let total = 0
  batchStore.processedResults.forEach(r => {
    if (selectedUrls.value.has(r.url)) {
      total += r.size || 0
    }
  })
  return total
})

// Group selected items into volumes by cumulative size
const volumes = computed(() => {
  const items = batchStore.processedResults.filter(r =>
    selectedUrls.value.has(r.url) && r.status === 'success'
  )
  const groups: (typeof items)[] = []
  let currentGroup: typeof items = []
  let currentSize = 0

  for (const item of items) {
    const itemSize = item.size || 0
    const maxChunkBytes = Math.min(VOLUME_SIZE_BYTES, MEMORY_WATERLINE_BYTES)
    if (currentGroup.length > 0 && currentSize + itemSize > maxChunkBytes) {
      groups.push(currentGroup)
      currentGroup = [item]
      currentSize = itemSize
    } else {
      currentGroup.push(item)
      currentSize += itemSize
    }
  }
  if (currentGroup.length > 0) groups.push(currentGroup)
  return groups
})

const volumeCount = computed(() => volumes.value.length)

const toggleSelectAll = (e: Event) => {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) {
    batchStore.processedResults.forEach(r => {
      if (r.status === 'success') selectedUrls.value.add(r.url)
    })
  } else {
    selectedUrls.value.clear()
  }
}

const fetchSingleResult = (url: string): Promise<any> => {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({
      action: 'GET_FULL_RESULTS',
      urls: [url]
    }, (response) => {
      resolve(response?.success && response.data?.length > 0 ? response.data[0] : null)
    })
  })
}

const fetchArchiveBase64ByKey = (key: string): Promise<string | null> => {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (res) => {
      resolve((res && typeof res[key] === 'string') ? res[key] : null)
    })
  })
}

const handleDownloadZip = async () => {
  const vols = volumes.value.map(v => [...v])
  if (vols.length === 0) return

  isDownloading.value = true
  const timestamp = new Date().getTime()

  try {
    for (let vi = 0; vi < vols.length; vi++) {
      const vol = vols[vi]
      const zip = new JSZip()
      const imagesFolder = zip.folder("images")
      let shouldSplitEarly = false

      // Fetch items one-by-one to avoid Chrome's 64MiB message limit
      for (let fi = 0; fi < vol.length; fi++) {
        const totalIndex = vols.slice(0, vi).reduce((s, v) => s + v.length, 0) + fi + 1
        const totalItems = vols.reduce((s, v) => s + v.length, 0)
        downloadProgress.value = vols.length > 1
          ? `卷${vi + 1}/${vols.length} · 第 ${totalIndex}/${totalItems} 个`
          : `第 ${fi + 1}/${vol.length} 个...`

        const item = await fetchSingleResult(vol[fi].url)
        if (!item) continue

        const safeTitle = (item.title || 'document').replace(/[\\/:*?"<>|]/g, "_")

        if (item.format === 'pdf') {
          if (item.content) {
            zip.file(`${safeTitle}.pdf`, item.content, { base64: true })
          }
        } else if (item.archiveBase64 || item.archiveStorageKey) {
          const archiveBase64 = item.archiveBase64 || (item.archiveStorageKey ? await fetchArchiveBase64ByKey(item.archiveStorageKey) : null)
          if (archiveBase64) {
            zip.file(item.archiveName || `${safeTitle}.zip`, archiveBase64, { base64: true })
          }
        } else {
          zip.file(`${safeTitle}.md`, item.content || '')
          if (item.images && Array.isArray(item.images)) {
            item.images.forEach((img: any) => {
              if (img.base64 && img.filename) {
                const base64Data = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64
                imagesFolder?.file(img.filename, base64Data, { base64: true })
              }
            })
          }
        }

        const heapMb = getHeapUsageMb()
        if (heapMb && heapMb > ZIP_HEAP_SOFT_LIMIT_MB) {
          await new Promise(r => setTimeout(r, 250))
        }
        if (heapMb && heapMb > ZIP_HEAP_HARD_LIMIT_MB && fi < vol.length - 1) {
          shouldSplitEarly = true
          const remaining = vol.slice(fi + 1)
          if (remaining.length > 0) {
            vols.splice(vi + 1, 0, remaining)
          }
          break
        }
      }

      downloadProgress.value = vols.length > 1
        ? `正在打包卷 ${vi + 1}...`
        : '正在打包...'

      const blob = await zip.generateAsync({ type: "blob" })
      const dlUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = dlUrl
      a.download = vols.length > 1
        ? `Batch_Export_${timestamp}_Vol${vi + 1}.zip`
        : `Batch_Export_${timestamp}.zip`
      a.click()
      URL.revokeObjectURL(dlUrl)

      // Delay between volumes to avoid browser blocking multiple downloads
      if (vi < vols.length - 1) {
        await new Promise(r => setTimeout(r, shouldSplitEarly ? 2000 : 1500))
      }
    }
  } finally {
    isDownloading.value = false
    downloadProgress.value = ''
  }
}

const handleClear = () => {
  if (confirm('确定要清空所有已下载的历史记录吗？正在进行的任务也会停止。')) {
    batchStore.clearResults()
    selectedUrls.value.clear()
  }
}

const deleteItem = (url: string) => {
  chrome.runtime.sendMessage({ action: 'DELETE_BATCH_ITEM', url }, () => {
    batchStore.updateStatus()
    selectedUrls.value.delete(url)
  })
}

const retryItem = (url: string) => {
  batchStore.retryItem(url)
}

const retryAllFailed = () => {
  batchStore.retryAllFailed()
}

const isRetryingItem = (url: string) => batchStore.retryingUrls.has(url)

const failedCount = computed(() => batchStore.processedResults.filter(r => r.status === 'failed').length)
const isListLoading = computed(() =>
  !batchStore.hasLoadedStatus || (batchStore.isUpdatingStatus && batchStore.processedResults.length === 0 && !batchStore.currentItem)
)

const openUrl = (url: string) => window.open(url, '_blank')

const handleSingleDownload = async (item: BatchItem) => {
    chrome.runtime.sendMessage({ 
        action: 'GET_FULL_RESULTS', 
        urls: [item.url]
    }, async (response) => {
        if (response && response.success && response.data.length > 0) {
            const data = response.data[0]
            const safeTitle = (data.title || 'document').replace(/[\\/:*?"<>|]/g, "_")
            
            if (data.format === 'pdf') {
                // PDF: decode base64 and download as .pdf
                if (data.content) {
                    const byteChars = atob(data.content)
                    const byteArray = new Uint8Array(byteChars.length)
                    for (let i = 0; i < byteChars.length; i++) {
                        byteArray[i] = byteChars.charCodeAt(i)
                    }
                    const blob = new Blob([byteArray], { type: 'application/pdf' })
                    const dlUrl = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = dlUrl
                    a.download = `${safeTitle}.pdf`
                    a.click()
                    URL.revokeObjectURL(dlUrl)
                }
            } else if (data.archiveBase64 || data.archiveStorageKey) {
                const archiveBase64 = data.archiveBase64 || (data.archiveStorageKey ? await fetchArchiveBase64ByKey(data.archiveStorageKey) : null)
                if (!archiveBase64) return
                const byteChars = atob(archiveBase64)
                const byteArray = new Uint8Array(byteChars.length)
                for (let i = 0; i < byteChars.length; i++) {
                    byteArray[i] = byteChars.charCodeAt(i)
                }
                const blob = new Blob([byteArray], { type: 'application/zip' })
                const dlUrl = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = dlUrl
                a.download = data.archiveName || `${safeTitle}.zip`
                a.click()
                URL.revokeObjectURL(dlUrl)
            } else {
                // Markdown: existing logic
                const hasImages = data.images && data.images.length > 0
                
                if (hasImages) {
                    const zip = new JSZip()
                    zip.file(`${safeTitle}.md`, data.content || '')
                    
                    const imagesFolder = zip.folder("images")
                    data.images.forEach((img: any) => {
                        if (img.base64 && img.filename) {
                            const base64Data = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64;
                            imagesFolder?.file(img.filename, base64Data, { base64: true })
                        }
                    })

                    const blob = await zip.generateAsync({ type: "blob" })
                    const dlUrl = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = dlUrl
                    a.download = `${safeTitle}.zip`
                    a.click()
                    URL.revokeObjectURL(dlUrl)
                } else {
                    const blob = new Blob([data.content || ''], { type: 'text/markdown' })
                    const dlUrl = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = dlUrl
                    a.download = `${safeTitle}.md`
                    a.click()
                    URL.revokeObjectURL(dlUrl)
                }
            }
        }
    })
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Summary Header -->
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
        <div class="text-xs uppercase tracking-wider font-bold text-gray-400 mb-1">完成总量</div>
        <div class="text-xl font-black text-blue-600">{{ batchStore.processedResults.filter(r => r.status === 'success').length }}</div>
      </div>
      <div class="p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
        <div class="text-xs uppercase tracking-wider font-bold text-gray-400 mb-1">已选大小</div>
        <div class="text-xl font-black text-gray-700 dark:text-gray-200">{{ formatSize(totalSelectedSize) }}</div>
      </div>
    </div>

    <!-- Actions Bar -->
    <div class="flex gap-2 mb-4">
      <button 
        @click="handleDownloadZip"
        :disabled="selectedUrls.size === 0 || isDownloading"
        class="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-40 transition-all shadow-lg shadow-blue-500/10"
      >
        <template v-if="isDownloading">
          <div class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
          <span>{{ downloadProgress }}</span>
        </template>
        <template v-else>
          <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>导出已选 ({{ selectedUrls.size }})<template v-if="volumeCount > 1"> · {{ volumeCount }} 卷</template></span>
        </template>
      </button>

      <button 
        @click="handleClear"
        class="w-10 h-10 flex items-center justify-center rounded-xl border-2 border-red-100 dark:border-red-900/30 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors shrink-0"
        title="清空所有记录"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </button>

      <button 
        v-if="failedCount > 0"
        @click="retryAllFailed"
        :disabled="batchStore.isRetryingAll"
        class="flex items-center justify-center gap-1.5 h-10 px-3 rounded-xl border-2 border-amber-200 dark:border-amber-900/40 text-amber-600 dark:text-amber-400 text-xs font-bold hover:bg-amber-50 dark:hover:bg-amber-900/10 transition-colors shrink-0 disabled:opacity-60"
        title="重试全部失败任务"
      >
        <div v-if="batchStore.isRetryingAll" class="w-3.5 h-3.5 border-2 border-amber-400/40 border-t-amber-500 rounded-full animate-spin"></div>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
        <span>{{ batchStore.isRetryingAll ? '重试中...' : `重试 (${failedCount})` }}</span>
      </button>
    </div>

    <!-- List Controls -->
    <div class="flex items-center justify-between px-1 mb-2">
      <label class="flex items-center gap-2 cursor-pointer">
        <input 
          type="checkbox" 
          @change="toggleSelectAll" 
          :checked="selectedUrls.size > 0 && selectedUrls.size === batchStore.processedResults.filter(r => r.status === 'success').length"
          class="w-4 h-4 rounded border-gray-300 text-blue-600"
        >
        <span class="text-xs font-bold text-gray-500">全选成品</span>
      </label>
      <span class="text-[10px] text-gray-400 flex items-center gap-1.5">
        <span v-if="batchStore.isUpdatingStatus && batchStore.hasLoadedStatus" class="inline-block w-2 h-2 border border-gray-300 border-t-blue-500 rounded-full animate-spin"></span>
        <span>每卷 ≤ {{ Math.min(VOLUME_SIZE_MB, MEMORY_WATERLINE_MB) }}MB<template v-if="volumeCount > 1"> · 共 {{ volumeCount }} 卷</template></span>
      </span>
    </div>

    <!-- Manager List -->
    <div class="flex-1 overflow-y-auto custom-scrollbar pr-1 -mr-1">
      <div v-if="isListLoading" class="h-40 flex flex-col items-center justify-center text-gray-400 gap-2 opacity-80">
        <div class="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
        <span class="text-xs">正在加载下载列表...</span>
      </div>

      <div v-if="!isListLoading && batchStore.processedResults.length === 0 && !batchStore.currentItem" class="h-40 flex flex-col items-center justify-center text-gray-400 gap-2 opacity-60 italic">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M19 11H5m14 0c1 0 2 1 2 2v6c0 1-1 2-2 2H5c-1 0-2-1-2-2v-6c0-1 1-2 2-2m14 0V9c0-1-1-2-2-2M5 11V9c0-1 1-2 2-2m10 0V5c0-1-1-2-2-2H9c-1 0-2 1-2 2v2m10 0H7"/></svg>
        <span class="text-xs">暂无下载记录</span>
      </div>

      <div v-else class="space-y-2 pb-4">
        <!-- Current Item (if any) -->
        <div v-if="batchStore.currentItem" class="p-3 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-900/40 rounded-xl flex items-center gap-3 animate-pulse">
           <div class="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0"></div>
           <div class="flex-1 min-w-0">
             <div class="text-xs font-bold text-blue-700 dark:text-blue-400 truncate">{{ batchStore.currentItem.title }}</div>
             <div class="text-[9px] text-blue-500 mt-0.5">
               正在抓取内容并预处理图片...
               <template v-if="batchStore.activeCount > 1">（另有 {{ batchStore.activeCount - 1 }} 个并发任务）</template>
             </div>
           </div>
        </div>

        <!-- History Results -->
        <div 
          v-for="item in [...batchStore.processedResults].reverse()" 
          :key="item.url"
          class="p-3 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl flex items-center gap-3 hover:border-blue-100 dark:hover:border-blue-900 group"
        >
          <input 
            v-if="item.status === 'success'"
            type="checkbox" 
            :checked="selectedUrls.has(item.url)"
            @change="selectedUrls.has(item.url) ? selectedUrls.delete(item.url) : selectedUrls.add(item.url)"
            class="w-4 h-4 rounded border-gray-300 text-blue-600"
          >
          <div v-else class="w-4 h-4 flex items-center justify-center shrink-0">
            <span v-if="item.status === 'failed'" class="text-red-500">❌</span>
            <span v-else class="text-gray-300">⏳</span>
          </div>

          <div class="flex-1 min-w-0">
             <div class="flex items-center gap-1.5 mb-0.5">
                <span :class="[item.status === 'success' ? 'text-gray-700 dark:text-gray-200' : 'text-gray-400']" class="text-xs font-bold truncate flex-1 uppercase tracking-tight">{{ item.title }}</span>
                <span v-if="item.format === 'pdf'" class="text-[9px] font-black text-red-500 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded uppercase border border-red-100 dark:border-red-800 shrink-0">PDF</span>
                <span v-else-if="item.format === 'markdown'" class="text-[9px] font-black text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded uppercase border border-blue-100 dark:border-blue-800 shrink-0">MD</span>
                <span v-if="item.size" class="text-xs font-mono text-gray-400 shrink-0">{{ formatSize(item.size) }}</span>
             </div>
             <div class="text-[11px] text-gray-400 truncate opacity-60">{{ item.url }}</div>
             <div v-if="item.status === 'failed' && item.error" class="text-[10px] text-red-400 mt-0.5 truncate" :title="item.error">❌ {{ item.error }}</div>
          </div>

          <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button v-if="item.status === 'success'" @click="handleSingleDownload(item)" class="p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg text-gray-400 hover:text-blue-600" title="常规下载">
               <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            </button>
            <button
              v-if="item.status === 'failed'"
              @click="retryItem(item.url)"
              :disabled="isRetryingItem(item.url)"
              class="p-1.5 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg text-gray-400 hover:text-amber-600 disabled:opacity-60"
              :title="isRetryingItem(item.url) ? '重试中' : '重试'"
            >
               <div v-if="isRetryingItem(item.url)" class="w-3.5 h-3.5 border-2 border-amber-400/40 border-t-amber-500 rounded-full animate-spin"></div>
               <svg v-else xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>
            </button>
            <button @click="openUrl(item.url)" class="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-blue-500" title="打开链接">
               <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </button>
            <button @click="deleteItem(item.url)" class="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-gray-400 hover:text-red-500" title="删除记录">
               <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>
            </button>
          </div>
        </div>

        <!-- Pending Items from Queue -->
        <div v-for="item in batchStore.queueLength" :key="item" class="p-3 bg-gray-50/50 dark:bg-gray-800/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl flex items-center gap-3 opacity-50">
           <div class="w-4 h-4 border-2 border-gray-300 rounded-full shrink-0"></div>
           <div class="text-[10px] text-gray-400 font-bold uppercase tracking-widest">排队等待中...</div>
        </div>
      </div>
    </div>
  </div>
</template>
