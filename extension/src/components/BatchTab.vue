<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useBatchStore, type BatchItem } from '../store/batch'
import { useSettingsStore } from '../store/settings'
import type { TaskType } from '../platformRegistry'

const props = withDefaults(defineProps<{
  taskType?: TaskType
  supportsScrollScan?: boolean
  supportsPdf?: boolean
}>(), {
  taskType: 'doc',
  supportsScrollScan: true,
  supportsPdf: true
})

const batchStore = useBatchStore()
const settingsStore = useSettingsStore()

const isScanning = ref(false)
const isScrollScanning = ref(false)
const selectedIndexes = ref<Set<number>>(new Set())
type BatchExportFormat = 'markdown' | 'pdf' | 'csv' | 'json'
const batchFormat = ref<BatchExportFormat>(props.taskType === 'review' ? 'csv' : 'markdown')
const showTips = ref({
  sidebar: localStorage.getItem('dismissed-tip-sidebar') !== 'true',
})
const showAutoDiscovery = ref(props.taskType !== 'review')
const manualLinksInput = ref('')
const manualImportMessage = ref('')
const manualImportError = ref('')

const availableFormats = computed(() => {
  const formats: Array<{ value: BatchExportFormat; label: string }> = [
    { value: 'markdown', label: 'Markdown' }
  ]

  if (props.taskType === 'review') {
    formats.push({ value: 'csv', label: 'CSV' })
    formats.push({ value: 'json', label: 'JSON' })
  }

  if (props.supportsPdf) {
    formats.push({ value: 'pdf', label: 'PDF' })
  }

  return formats
})

const itemLabel = computed(() => props.taskType === 'review' ? '商品链接' : '文档')
const listTargetLabel = computed(() => props.taskType === 'review' ? '商品链接' : '文档链接')
const startLabel = computed(() => props.taskType === 'review' ? '开始抓取评论' : '开始抓取')
const emptyHint = computed(() => {
  if (props.taskType === 'review') {
    return props.supportsScrollScan
      ? '优先粘贴商品详情链接（无需列表页）；也可点击「扫描页面/滚动扫描」自动发现'
      : '优先粘贴商品详情链接（无需列表页）；也可点击「扫描页面」自动发现'
  }
  return props.supportsScrollScan
    ? '点击「扫描页面」快速扫描，或「滚动扫描」自动边滚动边发现'
    : '点击「扫描页面」快速扫描'
})
const shouldShowSidebarTip = computed(() => props.taskType === 'doc' && showTips.value.sidebar)

watch(() => props.taskType, () => {
  selectedIndexes.value.clear()
  batchStore.scannedLinks = []
  isScrollScanning.value = false
  showAutoDiscovery.value = props.taskType !== 'review'
  batchFormat.value = props.taskType === 'review' ? 'csv' : 'markdown'
  manualLinksInput.value = ''
  manualImportMessage.value = ''
  manualImportError.value = ''
})

watch(() => props.supportsScrollScan, (enabled) => {
  if (!enabled) {
    isScrollScanning.value = false
  }
})

watch(availableFormats, (formats) => {
  if (!formats.some(item => item.value === batchFormat.value)) {
    batchFormat.value = formats[0]?.value || 'markdown'
  }
}, { immediate: true })

const dismissTip = (type: 'sidebar') => {
  showTips.value[type] = false
  localStorage.setItem(`dismissed-tip-${type}`, 'true')
}

const toCandidateUrl = (raw: string): string | null => {
  let token = raw.trim().replace(/[，,；;。\)\]\}>]+$/g, '')
  if (!token) return null

  if (!/^https?:\/\//i.test(token)) {
    if (/^(item\.jd\.com|item\.m\.jd\.com|item-yiyao\.jd\.com|item\.jd\.hk|item\.taobao\.com|detail\.tmall\.com|chaoshi\.detail\.tmall\.com)\//i.test(token)) {
      token = `https://${token}`
    } else {
      return null
    }
  }

  try {
    const parsed = new URL(token)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.href.split('#')[0]
  } catch (_) {
    return null
  }
}

const inferManualTitle = (url: string) => {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (host.includes('jd.com') || host.includes('jd.hk')) {
      const id = (parsed.pathname.match(/(?:\/product\/)?(\d+)\.html/i)?.[1]
        || parsed.searchParams.get('sku')
        || parsed.searchParams.get('skuId')
        || parsed.searchParams.get('id')
        || '').trim()
      return id ? `京东商品_${id}` : '京东商品'
    }
    if (host.includes('taobao.com') || host.includes('tmall.com')) {
      const id = (parsed.searchParams.get('id') || '').trim()
      return id ? `淘宝商品_${id}` : '淘宝商品'
    }
    return parsed.hostname
  } catch (_) {
    return '商品链接'
  }
}

const importManualLinks = (autoStart = false) => {
  const source = manualLinksInput.value.trim()
  if (!source) {
    manualImportError.value = '请先粘贴商品链接'
    manualImportMessage.value = ''
    return
  }

  const rawTokens = source.split(/[\s\n\t]+/g).map(item => item.trim()).filter(Boolean)
  const uniqueUrls = new Set<string>()
  let invalidCount = 0
  let duplicateInInput = 0

  for (const token of rawTokens) {
    const url = toCandidateUrl(token)
    if (!url) {
      invalidCount += 1
      continue
    }

    if (uniqueUrls.has(url)) {
      duplicateInInput += 1
      continue
    }

    uniqueUrls.add(url)
  }

  const candidates = Array.from(uniqueUrls).map((url) => ({
    url,
    title: inferManualTitle(url)
  }))

  const beforeCount = batchStore.scannedLinks.length
  addLinksIncrementally(candidates)
  const addedCount = Math.max(0, batchStore.scannedLinks.length - beforeCount)
  const existedCount = Math.max(0, candidates.length - addedCount)

  if (addedCount > 0) {
    manualImportError.value = ''
  }

  manualImportMessage.value = `导入 ${addedCount} 条，已存在 ${existedCount} 条${duplicateInInput > 0 ? `，输入重复 ${duplicateInInput} 条` : ''}${invalidCount > 0 ? `，无效 ${invalidCount} 条` : ''}`
  if (addedCount === 0 && invalidCount > 0) {
    manualImportError.value = '未识别到有效商品链接，请检查粘贴内容'
  }

  if (autoStart && addedCount > 0 && !batchStore.isProcessing) {
    handleStartBatch()
    manualImportMessage.value += '，已启动抓取任务'
  }
}

const importManualLinksFromInput = () => {
  importManualLinks(false)
}

const importManualLinksAndStart = () => {
  importManualLinks(true)
}

const clearManualLinks = () => {
  manualLinksInput.value = ''
  manualImportMessage.value = ''
  manualImportError.value = ''
}

// Helper to add links incrementally and auto-select new non-downloaded ones
const addLinksIncrementally = (newLinks: { title: string; url: string }[]) => {
  const existingUrls = new Set(batchStore.scannedLinks.map(l => l.url))
  const downloadedUrls = new Set(
    batchStore.processedResults
      .filter(r => (r.taskType || 'doc') === props.taskType)
      .map(r => r.url)
  )

  newLinks.forEach((link) => {
    if (!existingUrls.has(link.url)) {
      const item: BatchItem = {
        ...link,
        taskType: props.taskType
      }
      batchStore.scannedLinks.push(item)
      existingUrls.add(item.url)
    }
  })

  // Auto-select non-downloaded links
  batchStore.scannedLinks.forEach((link, idx) => {
    if (!downloadedUrls.has(link.url)) {
      selectedIndexes.value.add(idx)
    }
  })
}

const scanLinks = async () => {
  isScanning.value = true
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return

    const response = await chrome.tabs.sendMessage(tab.id, { action: 'SCAN_LINKS' })
    if (response && response.success) {
      addLinksIncrementally(response.links || [])
    }
  } catch (e) {
    console.error('Scan error:', e)
  } finally {
    isScanning.value = false
  }
}

const scrollScanLinks = async () => {
  if (!props.supportsScrollScan) return

  if (isScrollScanning.value) {
    // Stop the current scroll scan
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { action: 'STOP_SCROLL_SCAN' })
      }
    } catch (e) {
      console.error('Stop scroll scan error:', e)
    }
    isScrollScanning.value = false
    return
  }

  isScrollScanning.value = true
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id) return

    // Open a long-lived port connection to the content script
    const port = chrome.tabs.connect(tab.id, { name: 'scroll-scan' })

    port.onMessage.addListener((msg: any) => {
      if (msg.type === 'partial') {
        addLinksIncrementally(msg.links || [])
      } else if (msg.type === 'done') {
        isScrollScanning.value = false
      } else if (msg.type === 'error') {
        console.error('Scroll scan error:', msg.error)
        isScrollScanning.value = false
      }
    })

    port.onDisconnect.addListener(() => {
      isScrollScanning.value = false
    })
  } catch (e) {
    console.error('Scroll scan error:', e)
    isScrollScanning.value = false
  }
}

const toggleSelectAll = (e: Event) => {
  const checked = (e.target as HTMLInputElement).checked
  if (checked) {
    batchStore.scannedLinks.forEach((_, idx) => selectedIndexes.value.add(idx))
  } else {
    selectedIndexes.value.clear()
  }
}

const isAllSelected = computed(() => {
  return batchStore.scannedLinks.length > 0 && selectedIndexes.value.size === batchStore.scannedLinks.length
})

const isDownloaded = (url: string) => {
  return batchStore.processedResults.some(r =>
    r.url === url &&
    r.status === 'success' &&
    (r.taskType || 'doc') === props.taskType
  )
}

const handleStartBatch = () => {
  const items = Array.from(selectedIndexes.value)
    .map(idx => batchStore.scannedLinks[idx])
    .filter((item): item is BatchItem => !!item)
    .map(item => ({
      ...item,
      taskType: props.taskType
    }))
  if (items.length === 0) return

  const resolvedConcurrency = props.taskType === 'review' ? 1 : settingsStore.batchConcurrency
  const resolvedImageMode = props.taskType === 'review' ? 'original' : settingsStore.imageMode

  batchStore.startBatch(items, batchFormat.value, {
    taskType: props.taskType,
    imageMode: resolvedImageMode,
    foreground: settingsStore.foreground,
    batchConcurrency: resolvedConcurrency,
    scrollWaitTime: settingsStore.scrollWaitTime,
    reviewMinRating: settingsStore.reviewMinRating,
    reviewWithImagesOnly: settingsStore.reviewWithImagesOnly,
    reviewMaxCount: settingsStore.reviewMaxCount,
    reviewRecentDays: settingsStore.reviewRecentDays,
    reviewMaxPages: settingsStore.reviewMaxPages,
    imageConfig: {
      enabled: resolvedImageMode === 'minio',
      ...settingsStore.ossConfig
    }
  })
}
</script>

<template>
  <div class="flex flex-col min-h-full">
    <div v-if="props.taskType === 'review'" class="mb-4 p-3 rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-white/70 dark:bg-slate-900/40 space-y-2.5">
      <div class="flex items-center justify-between">
        <div class="text-[12px] font-black tracking-wide text-slate-500">手动导入商品链接</div>
        <span class="text-[11px] text-slate-400">支持换行/空格分隔</span>
      </div>

      <textarea
        v-model="manualLinksInput"
        rows="4"
        placeholder="粘贴多个商品详情链接（无需先打开列表页），例如：&#10;https://item.jd.com/100287911980.html&#10;https://detail.tmall.com/item.htm?id=1234567890"
        class="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs leading-relaxed text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
      ></textarea>

      <div class="grid grid-cols-2 gap-2">
        <button
          @click="importManualLinksFromInput"
          :disabled="batchStore.isProcessing"
          class="h-9 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >导入链接并自动勾选</button>
        <button
          @click="importManualLinksAndStart"
          :disabled="batchStore.isProcessing"
          class="h-9 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-50"
        >导入并开始抓取</button>
      </div>

      <button
        @click="clearManualLinks"
        class="h-8 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors"
      >清空输入</button>

      <div class="text-[12px] leading-relaxed text-slate-500">无需先打开列表页；任务会自动逐个打开商品详情页抓取评论（并发固定为 1）。</div>
      <div class="text-[12px] leading-relaxed text-slate-500">如果你当前就在商品详情页，也可以回到首页直接一键提取。</div>
      <div v-if="manualImportMessage" class="text-[12px] text-emerald-600 dark:text-emerald-400">{{ manualImportMessage }}</div>
      <div v-if="manualImportError" class="text-[12px] text-red-500">{{ manualImportError }}</div>
    </div>

    <!-- Scan Buttons -->
    <div class="flex flex-col gap-3 mb-4">
      <div v-if="props.taskType === 'review'" class="flex items-center justify-between px-1">
        <span class="text-[12px] font-bold text-slate-500">从当前页面自动发现链接（可选）</span>
        <button
          @click="showAutoDiscovery = !showAutoDiscovery"
          class="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-500 hover:text-blue-600 hover:border-blue-300 transition-colors"
        >{{ showAutoDiscovery ? '收起' : '展开' }}</button>
      </div>

      <div v-if="props.taskType !== 'review' || showAutoDiscovery" class="flex gap-2">
        <button 
          @click="scanLinks"
          :disabled="isScanning || isScrollScanning || batchStore.isProcessing"
          class="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl bg-blue-600 text-white font-bold text-sm hover:bg-blue-700 disabled:opacity-50 transition-all shadow-md shadow-blue-500/20"
        >
          <template v-if="isScanning">
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>扫描中...</span>
          </template>
          <template v-else>
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            <span>扫描页面</span>
          </template>
        </button>

        <button 
          @click="scrollScanLinks"
          v-if="props.supportsScrollScan"
          :disabled="isScanning || batchStore.isProcessing"
          :class="[
            'flex-1 flex items-center justify-center gap-2 h-10 rounded-xl font-bold text-sm transition-all shadow-md',
            isScrollScanning
              ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-amber-500/20'
              : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-500/20 disabled:opacity-50'
          ]"
        >
          <template v-if="isScrollScanning">
            <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            <span>停止滚动</span>
          </template>
          <template v-else>
            <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 3v18m0 0-4-4m4 4 4-4M8 7H4m16 0h-4"/></svg>
            <span>滚动扫描</span>
          </template>
        </button>
      </div>

      <!-- Format Selector -->
      <div class="flex items-center gap-2 px-1">
        <span class="text-xs font-bold text-gray-500">导出格式</span>
        <div class="flex bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
          <button
            v-for="format in availableFormats"
            :key="format.value"
            @click="batchFormat = format.value"
            :class="[
              'px-3 py-1 text-xs font-bold rounded-md transition-all',
              batchFormat === format.value
                ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm'
                : 'text-gray-400 hover:text-gray-600'
            ]"
          >{{ format.label }}</button>
        </div>
      </div>

      <!-- BIG Start Batch Button -->
      <button 
        @click="handleStartBatch"
        :disabled="selectedIndexes.size === 0 || batchStore.isProcessing"
        class="batch-start-btn group relative w-full flex items-center justify-center gap-3 h-14 rounded-2xl font-black text-base tracking-wide transition-all duration-500 disabled:opacity-55 disabled:cursor-not-allowed overflow-hidden"
      >
        <!-- Animated gradient background -->
        <div class="absolute inset-0 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 transition-all duration-500"></div>
        <div class="absolute inset-0 bg-gradient-to-r from-cyan-500 via-emerald-500 to-teal-500 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
        <!-- Glow effect -->
        <div class="absolute inset-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] rounded-2xl"></div>
        <div class="absolute -inset-1 bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 rounded-2xl blur-lg opacity-30 group-hover:opacity-50 transition-opacity duration-500 -z-10"></div>
        <!-- Content -->
        <div class="relative flex items-center justify-center gap-3 text-white z-10 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/>
            <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
          </svg>
          <span class="start-label">{{ startLabel }}</span>
          <span v-if="selectedIndexes.size > 0" class="bg-white/35 text-white text-xs font-black px-2 py-0.5 rounded-full border border-white/35">{{ selectedIndexes.size }}</span>
        </div>
      </button>
    </div>

    <!-- Tips -->
    <div class="space-y-2 mb-4">
      <div v-if="shouldShowSidebarTip" class="p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-900/30 rounded-xl flex gap-3 relative group">
        <span class="text-amber-500 mt-0.5 text-base">⚠️</span>
        <p class="text-xs text-amber-700 dark:text-amber-400 leading-relaxed pr-4">注意：暂不支持抓取左侧栏链接，建议进入文档列表后再扫描。</p>
        <button @click="dismissTip('sidebar')" class="absolute top-2 right-2 text-amber-300 hover:text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <!-- Scroll scan status indicator -->
      <div v-if="isScrollScanning" class="p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/30 rounded-xl flex gap-3 items-center">
        <div class="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0"></div>
        <p class="text-xs text-indigo-700 dark:text-indigo-400 leading-relaxed font-medium">正在自动滚动页面并扫描{{ listTargetLabel }}...已发现 <strong>{{ batchStore.scannedLinks.length }}</strong> 个{{ itemLabel }}</p>
      </div>
    </div>

    <!-- List Controls -->
    <div class="flex items-center justify-between px-1 mb-2">
      <label class="flex items-center gap-2 cursor-pointer group">
        <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" class="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
        <span class="text-xs font-bold text-gray-500 group-hover:text-gray-700">全选</span>
      </label>
      <span class="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full text-gray-500 font-bold">
        找到 {{ batchStore.scannedLinks.length }} 个{{ itemLabel }}
      </span>
    </div>

    <!-- Scrollable List -->
    <div class="overflow-y-auto custom-scrollbar pr-1 -mr-1 min-h-[160px] max-h-[260px]">
      <div v-if="batchStore.scannedLinks.length === 0" class="h-40 flex flex-col items-center justify-center text-gray-400 gap-2 opacity-60 italic">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <span class="text-sm">{{ emptyHint }}</span>
      </div>

      <div class="space-y-2">
        <div 
          v-for="(item, idx) in batchStore.scannedLinks" 
          :key="item.url"
          class="p-3 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl flex items-start gap-3 hover:border-blue-200 dark:hover:border-blue-900 transition-all cursor-pointer group"
          @click="selectedIndexes.has(idx) ? selectedIndexes.delete(idx) : selectedIndexes.add(idx)"
        >
          <input 
            type="checkbox" 
            :checked="selectedIndexes.has(idx)" 
            @click.stop 
            @change="selectedIndexes.has(idx) ? selectedIndexes.delete(idx) : selectedIndexes.add(idx)"
            class="mt-1 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          >
          <div class="flex-1 min-width-0">
             <h4 :class="[isDownloaded(item.url) ? 'text-gray-400' : 'text-gray-700 dark:text-gray-200']" class="text-sm font-medium leading-tight line-clamp-2 break-all">{{ item.title }}</h4>
             <div class="flex items-center gap-2 mt-1.5 hide-scrollbar overflow-x-auto whitespace-nowrap">
                <span v-if="isDownloaded(item.url)" class="text-[11px] font-bold text-green-600 bg-green-50 dark:bg-green-900/30 px-1.5 py-0.5 rounded uppercase border border-green-100 dark:border-green-800">已下载</span>
                <span class="text-[12px] text-gray-400 font-mono truncate max-w-[200px]">{{ item.url }}</span>
             </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.batch-start-btn:not(:disabled):active {
  transform: scale(0.98);
}

@keyframes glow-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 0.6; }
}

.batch-start-btn:not(:disabled) > div:last-of-type {
  animation: glow-pulse 2s ease-in-out infinite;
}

.start-label {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
}
</style>
