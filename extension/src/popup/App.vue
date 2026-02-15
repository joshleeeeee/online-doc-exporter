<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import SettingsPanel from '../components/SettingsPanel.vue'
import BatchTab from '../components/BatchTab.vue'
import ManagerTab from '../components/ManagerTab.vue'
import { useSettingsStore } from '../store/settings'
import { useBatchStore } from '../store/batch'
import { useToast } from '../composables/useToast'
import { useSupportDetection } from '../composables/useSupportDetection'
import { useExtractor } from '../composables/useExtractor'
import { useBatchStatusPolling } from '../composables/useBatchStatusPolling'
import type { ExportFormat, TaskType } from '../platformRegistry'

const version = ref('1.7.2')
const activeTab = ref('main')
const settings = useSettingsStore()
const batchStore = useBatchStore()

const { toastMsg, showToast, triggerToast, dismissToast } = useToast()
const { isSupported, supportMessage, isDetecting, activePlatform, activePageContext, activeUrl, checkSupport } = useSupportDetection()

const defaultSingleFormatsByTask = (taskType: TaskType): ExportFormat[] => {
  if (taskType === 'review') return ['markdown', 'html', 'pdf', 'csv', 'json']
  return ['markdown', 'html', 'pdf']
}

const currentTaskType = computed<TaskType>(() => activePageContext.value?.platform.capabilities.taskType || activePlatform.value?.capabilities.taskType || 'doc')
const singleFormats = computed<ExportFormat[]>(() => activePageContext.value?.ui.singleFormats || defaultSingleFormatsByTask(currentTaskType.value))
const hasSingleFormat = (format: ExportFormat) => singleFormats.value.includes(format)

const isReviewTask = computed(() => currentTaskType.value === 'review')
const allowSingleActions = computed(() => activePageContext.value?.ui.allowSingleActions ?? true)
const canRunSingleActions = computed(() => isSupported.value && allowSingleActions.value)
const isSingleActionBlocked = computed(() => isSupported.value && !allowSingleActions.value)
const showBatchShortcut = computed(() => activePageContext.value?.ui.showBatchShortcut ?? true)
const showBatchTab = computed(() => {
  const pageAllows = activePageContext.value?.ui.showBatchTab ?? true
  if (pageAllows) return true
  return batchStore.isProcessing || batchStore.isPaused || batchStore.queueLength > 0
})

const currentEntityLabel = computed(() => currentTaskType.value === 'review' ? '评论' : '文档')
const formatActionLabelMap = computed<Record<ExportFormat, string>>(() => ({
  markdown: currentTaskType.value === 'review' ? '提取评论区为 Markdown' : '复制 Markdown',
  html: currentTaskType.value === 'review' ? '提取评论区为富文本' : '复制为富文本',
  pdf: currentTaskType.value === 'review' ? '下载评论区为 PDF' : '下载为 PDF',
  csv: currentTaskType.value === 'review' ? '提取评论区为 CSV' : '复制 CSV',
  json: currentTaskType.value === 'review' ? '提取评论区为 JSON' : '复制 JSON'
}))

const primaryFormat = computed<ExportFormat>(() => {
  if (isReviewTask.value) {
    if (hasSingleFormat('csv')) return 'csv'
    if (hasSingleFormat('json')) return 'json'
  }
  if (hasSingleFormat('markdown')) return 'markdown'
  if (hasSingleFormat('html')) return 'html'
  if (hasSingleFormat('pdf')) return 'pdf'
  if (hasSingleFormat('csv')) return 'csv'
  if (hasSingleFormat('json')) return 'json'
  return singleFormats.value[0] || 'markdown'
})

const secondaryFormats = computed<ExportFormat[]>(() => singleFormats.value.filter((f) => f !== primaryFormat.value))
const showSecondaryActions = ref(false)
const primaryActionLabel = computed(() => `一键${formatActionLabelMap.value[primaryFormat.value] || '导出'}`)

const isAnyActionBusy = computed(() => isExtracting.value || isQueueingReview.value)
const isFormatBusy = (format: ExportFormat) => {
  if (format === 'pdf') return isExtracting.value && extractingFormat.value === 'pdf'
  if (format === 'csv' || format === 'json') {
    return (isExtracting.value && extractingFormat.value === format) || (isQueueingReview.value && queueingReviewFormat.value === format)
  }
  return isExtracting.value && extractingFormat.value === format
}

const runAction = (format: ExportFormat) => {
  if (!canRunSingleActions.value || isAnyActionBusy.value) return

  if (format === 'pdf') {
    void executePDF()
    return
  }

  if (isReviewTask.value && (format === 'csv' || format === 'json')) {
    void queueReviewExtraction(format)
    return
  }

  if (format === 'markdown' || format === 'html' || format === 'csv' || format === 'json') {
    void executeCopy(format)
  }
}

const strategyHints = computed(() => {
  const hints: string[] = []
  const url = (activeUrl.value || '').toLowerCase()

  if (isReviewTask.value && (url.includes('jd.com') || url.includes('jd.hk'))) {
    hints.push('已启用京东前台策略：自动展开“全部评价”并在评论容器内滚动增量抓取。')
  }

  if (isReviewTask.value && (url.includes('taobao.com') || url.includes('tmall.com'))) {
    hints.push('已启用淘宝/天猫前台策略：自动打开“全部评价”并在评论容器内滚动增量抓取。')
  }

  if (isReviewTask.value) {
    hints.push('提取结果会进入下载中心，关闭弹窗后任务仍会继续。')
  }

  return hints
})

interface ReviewPreset {
  id: string
  label: string
  desc: string
  maxCount: number
  maxPages: number
}

const reviewPresets: ReviewPreset[] = [
  { id: 'quick', label: '快速抓取', desc: '100 条 / 浅层滚动', maxCount: 100, maxPages: 2 },
  { id: 'standard', label: '标准抓取', desc: '300 条 / 中层滚动', maxCount: 300, maxPages: 5 },
  { id: 'deep', label: '深度抓取', desc: '1000 条 / 深层滚动', maxCount: 1000, maxPages: 12 }
]

const activeReviewPresetId = computed(() => {
  const matched = reviewPresets.find((preset) =>
    settings.reviewMaxCount === preset.maxCount &&
    settings.reviewMaxPages === preset.maxPages &&
    settings.reviewMinRating === 0 &&
    settings.reviewWithImagesOnly === false &&
    settings.reviewRecentDays === 0
  )
  return matched?.id || ''
})

const applyReviewPreset = (preset: ReviewPreset) => {
  settings.reviewMinRating = 0
  settings.reviewWithImagesOnly = false
  settings.reviewRecentDays = 0
  settings.reviewMaxCount = preset.maxCount
  settings.reviewMaxPages = preset.maxPages
  triggerToast(`已切换到${preset.label}（${preset.desc}）`)
}

const onboardingStorageKey = 'ode-onboarding-seen-v1'
const showOnboarding = ref(false)
const onboardingStep = ref(0)
const onboardingSteps = [
  '在首页点击主按钮开始提取（通常一键即可）。',
  '切到“下载”页查看实时进度和累计条数。',
  '任务完成后点击下载按钮保存结果。'
]

const finishOnboarding = () => {
  showOnboarding.value = false
  localStorage.setItem(onboardingStorageKey, 'true')
}

const nextOnboardingStep = () => {
  if (onboardingStep.value >= onboardingSteps.length - 1) {
    finishOnboarding()
    return
  }
  onboardingStep.value += 1
}

const prevOnboardingStep = () => {
  onboardingStep.value = Math.max(0, onboardingStep.value - 1)
}

const maybeStartOnboarding = () => {
  const hasSeen = localStorage.getItem(onboardingStorageKey) === 'true'
  if (hasSeen) return
  if (!canRunSingleActions.value) return
  onboardingStep.value = 0
  showOnboarding.value = true
}

const batchShortcutDescription = computed(() => currentTaskType.value === 'review'
  ? '探测当前页面/列表下的商品链接并批量抓取评论'
  : '探测当前页面/列表下的所有文档链接')
const canExportPdf = computed(() => (activePlatform.value?.capabilities.supportsPdf ?? true) && hasSingleFormat('pdf'))
const canUseBatchScrollScan = computed(() => activePlatform.value?.capabilities.supportsScrollScan ?? true)

const { isExtracting, extractingFormat, extractionProgressMessage, executeCopy, executePDF } = useExtractor({
  triggerToast,
  getTaskType: () => currentTaskType.value
})

const isQueueingReview = ref(false)
const queueingReviewFormat = ref<'' | 'csv' | 'json'>('')

const queueReviewExtraction = async (format: 'csv' | 'json') => {
  if (isQueueingReview.value || isExtracting.value || !isSupported.value) return

  isQueueingReview.value = true
  queueingReviewFormat.value = format

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.url) throw new Error('找不到活动标签页')

    const normalizedUrl = tab.url.split('#')[0]
    const taskTitle = (tab.title || '').trim() || '评论抓取任务'

    await batchStore.startBatch([
      {
        url: normalizedUrl,
        title: taskTitle,
        taskType: 'review'
      }
    ], format, {
      taskType: 'review',
      imageMode: 'original',
      foreground: true,
      batchConcurrency: settings.batchConcurrency,
      scrollWaitTime: settings.scrollWaitTime,
      reviewMinRating: settings.reviewMinRating,
      reviewWithImagesOnly: settings.reviewWithImagesOnly,
      reviewMaxCount: settings.reviewMaxCount,
      reviewRecentDays: settings.reviewRecentDays,
      reviewMaxPages: settings.reviewMaxPages,
      imageConfig: {
        enabled: false,
        ...settings.ossConfig
      }
    })

    triggerToast(`评论提取任务已加入下载中心（${format.toUpperCase()}，前台运行）`)
    activeTab.value = 'manager'
  } catch (e: any) {
    triggerToast('错误: ' + (e?.message || '启动任务失败'))
  } finally {
    isQueueingReview.value = false
    queueingReviewFormat.value = ''
  }
}

useBatchStatusPolling(() => batchStore.updateStatus(), 2000)

onMounted(() => {
  const manifest = chrome.runtime.getManifest()
  version.value = manifest.version
  settings.setMergeBatchContextAware()
  void checkSupport().then(() => {
    maybeStartOnboarding()
  })
})

watch(showBatchTab, (visible) => {
  if (!visible && activeTab.value === 'batch') {
    activeTab.value = 'main'
  }
})

watch(singleFormats, () => {
  showSecondaryActions.value = false
})

watch(isSupported, (supported) => {
  if (supported) {
    maybeStartOnboarding()
  }
})

const showDisclaimer = () => {
  alert('【系统免责声明】\n\n1. 本工具仅限个人学习备份与学术研究使用，严禁商业用途。\n2. 使用本工具抓取受限文档可能违反平台协议，使用者需自行承担由此产生的合规性风险或账号封号风险。\n3. 开发者不对数据丢失或法律纠纷负责。\n\n如您继续使用，即表示您已阅读并同意上述所有条款。')
}

onUnmounted(() => {
  dismissToast()
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

    <transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="transform -translate-y-2 opacity-0"
      enter-to-class="transform translate-y-0 opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="transform translate-y-0 opacity-100"
      leave-to-class="transform -translate-y-2 opacity-0"
    >
      <div
        v-if="isExtracting && extractionProgressMessage"
        class="absolute top-24 left-1/2 -translate-x-1/2 z-40 px-4 py-2 bg-blue-600 text-white text-xs rounded-full shadow-xl flex items-center gap-2 max-w-[88%]"
      >
        <span class="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin shrink-0"></span>
        <span class="truncate">{{ extractionProgressMessage }}</span>
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
          ContentExtract
        </h1>
      </div>
      <div class="flex items-center gap-4">
        <a href="https://github.com/joshleeeeee/content-extract#sponsor" target="_blank" class="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-3 py-2 rounded-full font-bold hover:bg-amber-200 transition-all hover:scale-105 active:scale-95">
          ☕ 打赏
        </a>
        <div class="flex flex-col items-end">
          <span class="text-[11px] text-slate-400 dark:text-slate-500 font-mono font-bold leading-tight">v{{ version }}</span>
          <button @click="showDisclaimer" class="text-[11px] text-slate-400 dark:text-slate-500 hover:text-blue-500 underline decoration-dotted underline-offset-2 transition-colors leading-tight">免责声明</button>
        </div>
      </div>
    </header>

    <!-- Status Banner (Conditional based on Batch Active) -->
    <div v-if="!batchStore.isProcessing && !batchStore.isPaused && batchStore.queueLength === 0 && !batchStore.currentItem" :class="[
      'px-4 py-2.5 flex items-start gap-2 text-[13px] leading-relaxed font-semibold transition-colors',
      isDetecting ? 'bg-gray-100 text-gray-500' : 
      isSingleActionBlocked ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400' :
      isSupported ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400' : 
      'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'
    ]">
      <div :class="[
        'w-2 h-2 rounded-full mt-1.5 shrink-0',
        isDetecting ? 'bg-gray-400 animate-pulse' :
        isSingleActionBlocked ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.45)]' :
        isSupported ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' :
        'bg-red-500'
      ]"></div>
      {{ supportMessage }}
    </div>

    <!-- Batch Floating Progress -->
    <div v-else class="px-4 py-3 bg-blue-600 text-white flex flex-col gap-2 shadow-md">
       <div class="flex justify-between items-center">
          <span class="text-xs font-bold tracking-widest uppercase">{{ batchStore.isPaused ? '任务已暂停' : `正在抓取${currentEntityLabel}队列...` }}</span>
          <div class="flex gap-2">
             <button
               v-if="!batchStore.isPaused"
               @click="batchStore.pauseBatch"
               :disabled="batchStore.isPausing"
               class="text-[11px] bg-white/20 hover:bg-white/30 px-2 py-1 rounded uppercase font-bold disabled:opacity-60 flex items-center gap-1"
             >
               <span v-if="batchStore.isPausing" class="w-2.5 h-2.5 border border-white/50 border-t-white rounded-full animate-spin"></span>
               <span>{{ batchStore.isPausing ? '暂停中' : '暂停' }}</span>
             </button>
             <button
               v-else
               @click="batchStore.resumeBatch"
               :disabled="batchStore.isResuming"
               class="text-[11px] bg-white/20 hover:bg-white/30 px-2 py-1 rounded uppercase font-bold disabled:opacity-60 flex items-center gap-1"
             >
               <span v-if="batchStore.isResuming" class="w-2.5 h-2.5 border border-white/50 border-t-white rounded-full animate-spin"></span>
               <span>{{ batchStore.isResuming ? '继续中' : '继续' }}</span>
             </button>
          </div>
       </div>
       <div class="w-full h-1.5 bg-blue-400 rounded-full overflow-hidden">
          <div :style="{ width: batchStore.progressPercent + '%' }" class="h-full bg-white transition-all duration-500"></div>
       </div>
       <div class="text-[12px] opacity-95 font-medium">
          已完成 {{ batchStore.processedResults.length }} / 共 {{ batchStore.processedResults.length + batchStore.queueLength + batchStore.activeCount }} · 并发 {{ batchStore.effectiveConcurrency }}
       </div>
    </div>

    <!-- Content Area -->
    <main class="flex-1 overflow-y-auto p-5 custom-scrollbar relative z-10">
      <!-- Main Tab -->
      <div v-if="activeTab === 'main'" class="h-full flex flex-col pt-0 fade-in">

        <div
          v-if="isSingleActionBlocked"
          class="mb-4 rounded-2xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/80 dark:bg-amber-900/15 px-4 py-3.5"
        >
          <div class="text-[13px] font-black tracking-wide text-amber-700 dark:text-amber-300 mb-1.5">当前页不适合单页抓取</div>
          <div class="text-sm text-amber-700/95 dark:text-amber-200/95 leading-relaxed">{{ supportMessage }}</div>
          <button
            @click="activeTab = 'batch'"
            class="mt-3 h-10 px-4 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 transition-colors"
          >去批量页粘贴商品详情链接</button>
        </div>

        <!-- Action Section -->
        <div class="flex flex-col gap-3 mb-6">
          <button
            @click="runAction(primaryFormat)"
            :disabled="!canRunSingleActions || isAnyActionBusy"
            class="group relative flex flex-col items-center justify-center p-6 rounded-[2rem] bg-white dark:bg-slate-800/40 border-2 border-slate-200/60 dark:border-slate-700/50 hover:border-blue-500 shadow-lg hover:shadow-blue-500/20 transition-all duration-500 disabled:opacity-80"
          >
            <div class="w-14 h-14 mb-3 rounded-2xl bg-blue-600 dark:bg-blue-500 text-white flex items-center justify-center shadow-lg shadow-blue-500/30 group-hover:scale-105 transition-transform duration-500">
               <template v-if="isFormatBusy(primaryFormat)">
                  <div class="w-7 h-7 border-3 border-white border-t-transparent rounded-full animate-spin"></div>
               </template>
               <span v-else class="text-sm font-black font-mono uppercase">{{ primaryFormat }}</span>
            </div>
            <span class="text-xl font-black text-slate-800 dark:text-white tracking-tight text-center">{{ primaryActionLabel }}</span>
            <div class="absolute top-3 right-5 text-[9px] font-black text-blue-500/40 uppercase tracking-widest">Main</div>
          </button>

          <div v-if="isSingleActionBlocked" class="text-[13px] font-medium text-amber-700 dark:text-amber-300 px-1 -mt-1 leading-relaxed">
            提示：当前页可直接去“批量”页粘贴多个商品详情链接抓评论，无需先打开列表页。
          </div>

          <div v-if="isReviewTask" class="rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-white/70 dark:bg-slate-900/40 p-3">
            <div class="text-[12px] font-black tracking-wide text-slate-500 mb-2">抓取模板</div>
            <div class="grid grid-cols-3 gap-2">
              <button
                v-for="preset in reviewPresets"
                :key="preset.id"
                @click="applyReviewPreset(preset)"
                :class="[
                  'p-2 rounded-xl border text-left transition-all',
                  activeReviewPresetId === preset.id
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-slate-200 dark:border-slate-700 hover:border-blue-300'
                ]"
              >
                <div class="text-[12px] font-bold text-slate-700 dark:text-slate-200">{{ preset.label }}</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-300 mt-0.5">{{ preset.desc }}</div>
              </button>
            </div>
          </div>

          <div v-if="strategyHints.length > 0" class="rounded-2xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/70 dark:bg-blue-900/10 px-4 py-3 space-y-1">
            <div v-for="hint in strategyHints" :key="hint" class="text-[12px] leading-relaxed text-blue-700 dark:text-blue-300">- {{ hint }}</div>
          </div>

          <div v-if="secondaryFormats.length > 0" class="rounded-2xl border border-slate-200/70 dark:border-slate-700/70 bg-slate-100/60 dark:bg-slate-800/30 px-4 py-3">
            <button
              @click="showSecondaryActions = !showSecondaryActions"
              class="w-full flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300"
            >
              <span>更多格式（{{ secondaryFormats.length }}）</span>
              <span>{{ showSecondaryActions ? '收起' : '展开' }}</span>
            </button>

            <div v-if="showSecondaryActions" class="mt-3 space-y-2">
              <button
                v-for="format in secondaryFormats"
                :key="format"
                @click="runAction(format)"
                :disabled="!canRunSingleActions || isAnyActionBusy"
                class="group w-full flex items-center justify-between p-3 rounded-xl bg-white dark:bg-slate-800/40 border border-transparent hover:border-blue-300 dark:hover:border-blue-800 transition-all disabled:opacity-50"
              >
                <div class="flex items-center gap-2.5">
                  <div class="w-7 h-7 rounded-lg bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300">
                    <template v-if="isFormatBusy(format)">
                      <div class="w-3.5 h-3.5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin"></div>
                    </template>
                    <span v-else class="text-[9px] font-black font-mono uppercase">{{ format }}</span>
                  </div>
                  <span class="text-xs font-bold text-slate-600 dark:text-slate-300">{{ formatActionLabelMap[format] }}</span>
                </div>
                <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-slate-300 dark:text-slate-700 group-hover:text-blue-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Batch Tools Shortcut -->
        <div v-if="showBatchShortcut" class="mt-auto px-1">
          <div class="flex items-center gap-4 mb-2">
            <span class="text-[10px] font-black text-slate-300 dark:text-slate-600 tracking-[0.3em] uppercase">Advanced</span>
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
              <div class="text-[11px] text-indigo-100 font-medium opacity-85 truncate">{{ batchShortcutDescription }}</div>
            </div>
            <!-- Chevron on the right to fill space -->
            <div class="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
            </div>
          </button>
        </div>
      </div>

      <!-- Batch Tab -->
      <div v-if="activeTab === 'batch' && showBatchTab" class="fade-in h-full">
        <BatchTab :task-type="currentTaskType" :supports-scroll-scan="canUseBatchScrollScan" :supports-pdf="canExportPdf" />
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

    <div
      v-if="showOnboarding"
      class="absolute inset-0 z-30 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6"
    >
      <div class="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-5 space-y-4">
        <div class="flex items-center justify-between">
          <span class="text-[11px] font-black tracking-[0.25em] uppercase text-blue-500">快速上手</span>
          <button @click="finishOnboarding" class="text-xs text-slate-400 hover:text-slate-600">跳过</button>
        </div>
        <h3 class="text-lg font-black text-slate-800 dark:text-white">3 步学会使用</h3>
        <p class="text-sm text-slate-600 dark:text-slate-300 leading-relaxed min-h-[42px]">{{ onboardingSteps[onboardingStep] }}</p>
        <div class="flex items-center gap-1.5">
          <span
            v-for="(_, idx) in onboardingSteps"
            :key="idx"
            :class="[
              'h-1.5 rounded-full transition-all',
              idx === onboardingStep ? 'w-8 bg-blue-500' : 'w-3 bg-slate-300 dark:bg-slate-700'
            ]"
          ></span>
        </div>
        <div class="flex justify-between pt-1">
          <button
            @click="prevOnboardingStep"
            :disabled="onboardingStep === 0"
            class="h-9 px-4 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-500 disabled:opacity-40"
          >上一步</button>
          <button
            @click="nextOnboardingStep"
            class="h-9 px-5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700"
          >{{ onboardingStep >= onboardingSteps.length - 1 ? '完成' : '下一步' }}</button>
        </div>
      </div>
    </div>

    <footer class="h-20 border-t border-slate-200/60 dark:border-slate-800/60 bg-white/90 dark:bg-slate-900/90 backdrop-blur-xl px-6 flex items-center justify-around shrink-0 relative z-20 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
      <button @click="activeTab = 'main'" :class="[activeTab === 'main' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/20 shadow-inner' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800/50']" class="flex flex-col items-center justify-center px-5 py-2 rounded-2xl transition-all duration-500 group">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 mb-1 transition-transform duration-500 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        <span class="text-[12px] font-black uppercase tracking-tight">首页</span>
      </button>

      <button v-if="showBatchTab" @click="activeTab = 'batch'" :class="[activeTab === 'batch' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/20 shadow-inner' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800/50']" class="flex flex-col items-center justify-center px-5 py-2 rounded-2xl transition-all duration-500 group">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 mb-1 transition-transform duration-500 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <span class="text-[12px] font-black uppercase tracking-tight">批量</span>
      </button>
      
      <button @click="activeTab = 'manager'" :class="[activeTab === 'manager' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/20 shadow-inner' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800/50']" class="flex flex-col items-center justify-center px-5 py-2 rounded-2xl transition-all duration-500 relative group">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 mb-1 transition-transform duration-500 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
        <span class="text-[12px] font-black uppercase tracking-tight">下载</span>
        <!-- Numeric Badge -->
        <span v-if="batchStore.processedResults.length > 0" 
          class="absolute top-1 right-3.5 min-w-[19px] h-[19px] bg-red-500 text-white text-[9px] font-black rounded-full border border-white dark:border-slate-900 shadow-lg shadow-red-500/20 flex items-center justify-center leading-none tabular-nums animate-in zoom-in duration-300"
        >
          <span class="translate-y-[0.5px]">{{ batchStore.processedResults.length > 99 ? '99+' : batchStore.processedResults.length }}</span>
        </span>
      </button>

      <button @click="activeTab = 'settings'" :class="[activeTab === 'settings' ? 'text-blue-600 bg-blue-50 dark:bg-blue-500/20 shadow-inner' : 'text-slate-400 hover:text-blue-500 hover:bg-slate-50 dark:hover:bg-slate-800/50']" class="flex flex-col items-center justify-center px-5 py-2 rounded-2xl transition-all duration-500 group">
        <svg xmlns="http://www.w3.org/2000/svg" class="w-6 h-6 mb-1 transition-transform duration-500 group-hover:scale-110" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1-2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span class="text-[12px] font-black uppercase tracking-tight">设置</span>
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

.text-xs {
  font-size: 0.8125rem !important;
  line-height: 1.25rem !important;
}

.text-\[9px\] {
  font-size: 11px !important;
  line-height: 1.2 !important;
}

.text-\[10px\] {
  font-size: 12px !important;
  line-height: 1.25 !important;
}

.text-\[11px\] {
  font-size: 13px !important;
  line-height: 1.3 !important;
}
</style>
