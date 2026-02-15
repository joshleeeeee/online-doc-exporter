<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useBatchStore, type BatchItem } from '../store/batch'
import JSZip from 'jszip'

const batchStore = useBatchStore()
const selectedUrls = ref<Set<string>>(new Set())

const VOLUME_SIZE_MB = 300
const VOLUME_SIZE_BYTES = VOLUME_SIZE_MB * 1024 * 1024
const MEMORY_WATERLINE_MB = 300
const MEMORY_WATERLINE_BYTES = MEMORY_WATERLINE_MB * 1024 * 1024
const ZIP_HEAP_SOFT_LIMIT_MB = 320
const ZIP_HEAP_HARD_LIMIT_MB = 420

const isDownloading = ref(false)
const downloadProgress = ref('')
const latestPreviewLines = ref<string[]>([])
const latestPreviewMeta = ref('')
const latestPreviewLoading = ref(false)
const showOverview = ref(localStorage.getItem('ode-manager-overview') === 'true')

watch(showOverview, (value) => {
  localStorage.setItem('ode-manager-overview', String(value))
})

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

const getExportFormatMeta = (format?: string) => {
  if (format === 'pdf') return { ext: '.pdf', mime: 'application/pdf' }
  if (format === 'html') return { ext: '.html', mime: 'text/html;charset=utf-8' }
  if (format === 'csv') return { ext: '.csv', mime: 'text/csv;charset=utf-8' }
  if (format === 'json') return { ext: '.json', mime: 'application/json;charset=utf-8' }
  return { ext: '.md', mime: 'text/markdown;charset=utf-8' }
}

const encodeExportContent = (format: string | undefined, content: string) => {
  if (format === 'csv') {
    return content.startsWith('\uFEFF') ? content : `\uFEFF${content}`
  }
  return content
}

const sanitizeDownloadName = (name?: string) => {
  const raw = (name || 'document')
  let safe = raw
    .replace(/[\\/]/g, '_')
    .replace(/[<>:"|?*#%&{}$!@`+=~^]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!safe) safe = 'document'
  if (safe.length > 200) safe = safe.slice(0, 200)
  return safe
}

const normalizeExportTitle = (title?: string) => {
  const raw = (title || '').trim()
  if (!raw) return ''
  return raw
    .replace(/\s*[-|｜]\s*(feishu|lark)\s*docs?$/i, '')
    .replace(/\s*[-|｜]\s*飞书(云)?文档$/i, '')
    .replace(/\s*[-|｜]\s*文档$/i, '')
    .trim()
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

const latestSuccessItem = computed<BatchItem | null>(() => {
  const sorted = [...batchStore.processedResults]
    .filter(item => item.status === 'success')
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
  return sorted[0] || null
})

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

const normalizeBase64Payload = (value: string) => {
  const normalized = String(value || '')
    .trim()
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/\s+/g, '')

  if (!normalized) return ''
  const remainder = normalized.length % 4
  if (remainder === 0) return normalized
  return normalized + '='.repeat(4 - remainder)
}

const base64ToBytes = (value: string) => {
  const normalized = normalizeBase64Payload(value)
  if (!normalized) {
    throw new Error('空的 Base64 数据')
  }

  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const blobToDataUrl = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('Blob 转 DataURL 失败'))
    reader.readAsDataURL(blob)
  })
}

const downloadByUrl = (url: string, filename: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify'
    }, (downloadId) => {
      const err = chrome.runtime.lastError
      if (err || !downloadId) {
        reject(new Error(err?.message || '下载失败'))
        return
      }
      resolve()
    })
  })
}

const triggerDownloadByAnchor = (url: string, filename: string) => {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const triggerDownload = async (blob: Blob, filename: string) => {
  // Small files use data URL via downloads API (popup lifecycle safe)
  if (blob.size <= 8 * 1024 * 1024) {
    try {
      const dataUrl = await blobToDataUrl(blob)
      await downloadByUrl(dataUrl, filename)
      return
    } catch (e) {
      console.warn('[Download] DataURL fallback failed, switch to blob URL', e)
    }
  }

  const dlUrl = URL.createObjectURL(blob)
  try {
    await downloadByUrl(dlUrl, filename)
  } catch (e) {
    console.warn('[Download] downloads API failed, fallback anchor click', e)
    triggerDownloadByAnchor(dlUrl, filename)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(dlUrl), 120_000)
  }
}

const recoverTextFromArchive = async (item: any): Promise<string> => {
  const archiveBase64 = item.archiveBase64 || (item.archiveStorageKey ? await fetchArchiveBase64ByKey(item.archiveStorageKey) : null)
  if (!archiveBase64) return ''

  try {
    const archiveZip = await JSZip.loadAsync(base64ToBytes(archiveBase64))
    const files = Object.values(archiveZip.files).filter(file => !file.dir)
    if (files.length === 0) return ''

    const preferredExt = item.format === 'json' ? '.json' : (item.format === 'csv' ? '.csv' : '')
    const preferredFile = preferredExt
      ? files.find(file => file.name.toLowerCase().endsWith(preferredExt))
      : null
    const targetFile = preferredFile || files[0]
    if (!targetFile) return ''

    return await targetFile.async('string')
  } catch (e) {
    console.warn('[Download] Recover text from archive failed', e)
    return ''
  }
}

const downloadReviewItemsAsFiles = async (items: BatchItem[]) => {
  for (let i = 0; i < items.length; i++) {
    const source = items[i]
    downloadProgress.value = `正在导出评论文件 ${i + 1}/${items.length}...`

    const item = await fetchSingleResult(source.url)
    if (!item) continue

    const safeTitle = sanitizeDownloadName(normalizeExportTitle(item.title) || item.title || 'document')
    const formatMeta = getExportFormatMeta(item.format)

    let content = typeof item.content === 'string' ? item.content : ''
    if (!content && (item.archiveBase64 || item.archiveStorageKey)) {
      content = await recoverTextFromArchive(item)
    }

    const blob = new Blob([encodeExportContent(item.format, content || '')], { type: formatMeta.mime })
    await triggerDownload(blob, `${safeTitle}${formatMeta.ext}`)
    await new Promise(r => setTimeout(r, 180))
  }
}

const handleDownloadZip = async () => {
  const selectedSuccessItems = batchStore.processedResults.filter(r => selectedUrls.value.has(r.url) && r.status === 'success')
  const pureReviewSelection = selectedSuccessItems.length > 0 && selectedSuccessItems.every(item => {
    const taskType = item.taskType || 'doc'
    return taskType === 'review' && (item.format === 'csv' || item.format === 'json')
  })

  if (pureReviewSelection) {
    isDownloading.value = true
    try {
      await downloadReviewItemsAsFiles(selectedSuccessItems)
    } finally {
      isDownloading.value = false
      downloadProgress.value = ''
    }
    return
  }

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

        const safeTitle = sanitizeDownloadName(normalizeExportTitle(item.title) || item.title || 'document')
        const isReviewTask = (item.taskType || 'doc') === 'review'
        const hasTextContent = typeof item.content === 'string' && item.content.length > 0
        const shouldUseArchive = !isReviewTask && !!(item.archiveBase64 || item.archiveStorageKey)

        if (item.format === 'pdf') {
          if (item.content) {
            zip.file(`${safeTitle}.pdf`, base64ToBytes(item.content))
          }
        } else if (shouldUseArchive) {
          const archiveBase64 = item.archiveBase64 || (item.archiveStorageKey ? await fetchArchiveBase64ByKey(item.archiveStorageKey) : null)
          if (archiveBase64) {
            zip.file(`${safeTitle}.zip`, base64ToBytes(archiveBase64))
          }
        } else {
          const formatMeta = getExportFormatMeta(item.format)
          zip.file(`${safeTitle}${formatMeta.ext}`, encodeExportContent(item.format, hasTextContent ? item.content : ''))
          if ((item.format === 'markdown' || item.format === 'html') && item.images && Array.isArray(item.images)) {
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
      const filename = vols.length > 1
        ? `Batch_Export_${timestamp}_Vol${vi + 1}.zip`
        : `Batch_Export_${timestamp}.zip`
      await triggerDownload(blob, filename)

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

const currentItemProgressText = computed(() => {
  const current = batchStore.currentItem
  if (!current) return ''
  if (current.taskType !== 'review') return '正在抓取内容并预处理图片...'

  const total = Number(current.progressTotal || 0)
  const round = Number(current.progressRound || 0)
  const added = Number(current.progressAdded || 0)

  if (total > 0) {
    const roundText = round > 0 ? `第 ${round} 轮 · ` : ''
    const addedText = round > 0 ? ` · 本轮 +${added}` : ''
    return `正在提取评论区... ${roundText}累计 ${total} 条${addedText}`
  }

  return current.progressMessage || '正在提取评论区...'
})

const currentItemEtaText = computed(() => {
  const current = batchStore.currentItem
  if (!current || current.taskType !== 'review') return ''

  const round = Number(current.progressRound || 0)
  const maxRounds = Number((current as any).progressMaxRounds || 0)
  const startedAt = Number((current as any).progressStartedAt || 0)
  if (round <= 0 || maxRounds <= 0 || startedAt <= 0 || round >= maxRounds) return ''

  const elapsedMs = Date.now() - startedAt
  if (elapsedMs <= 1000) return ''
  const avgMsPerRound = elapsedMs / round
  const etaMs = Math.max(0, avgMsPerRound * (maxRounds - round))

  if (etaMs < 60_000) {
    return `预计约 ${Math.round(etaMs / 1000)} 秒`
  }
  return `预计约 ${Math.ceil(etaMs / 60_000)} 分钟`
})

const parseCsvLine = (line: string) => {
  const cells: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      const next = line[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      cells.push(current)
      current = ''
      continue
    }

    current += char
  }

  cells.push(current)
  return cells
}

const extractPreviewFromData = (data: any) => {
  latestPreviewLines.value = []
  latestPreviewMeta.value = ''

  if (!data?.content) return

  if (data.format === 'json') {
    try {
      const parsed = JSON.parse(data.content)
      const reviews = Array.isArray(parsed?.reviews) ? parsed.reviews : []
      latestPreviewMeta.value = `质检预览：共 ${parsed?.reviewCount || reviews.length} 条`
      latestPreviewLines.value = reviews.slice(0, 3).map((item: any, idx: number) => {
        const user = String(item?.user || '匿名用户').trim()
        const content = String(item?.content || '').replace(/\s+/g, ' ').trim()
        return `${idx + 1}. ${user}：${content.slice(0, 70) || '（空）'}`
      })
    } catch (_) {
      latestPreviewMeta.value = ''
      latestPreviewLines.value = []
    }
    return
  }

  if (data.format === 'csv') {
    const raw = String(data.content || '').replace(/^\uFEFF/, '')
    const rows = raw.split(/\r?\n/).filter(Boolean)
    if (rows.length <= 1) return

    const header = parseCsvLine(rows[0])
    const userIndex = header.indexOf('user')
    const contentIndex = header.indexOf('content')
    const timeIndex = header.indexOf('time')

    latestPreviewMeta.value = `质检预览：共 ${rows.length - 1} 条`
    latestPreviewLines.value = rows.slice(1, 4).map((row, idx) => {
      const cols = parseCsvLine(row)
      const user = cols[userIndex] || '匿名用户'
      const time = cols[timeIndex] || ''
      const content = (cols[contentIndex] || '').replace(/\s+/g, ' ').trim()
      return `${idx + 1}. ${user}${time ? ` · ${time}` : ''}：${content.slice(0, 64) || '（空）'}`
    })
  }
}

watch(() => latestSuccessItem.value?.url, async (url) => {
  latestPreviewLines.value = []
  latestPreviewMeta.value = ''
  if (!url) return

  latestPreviewLoading.value = true
  try {
    const data = await fetchSingleResult(url)
    if (data?.taskType === 'review' && (data?.format === 'csv' || data?.format === 'json')) {
      extractPreviewFromData(data)
    }
  } finally {
    latestPreviewLoading.value = false
  }
}, { immediate: true })

const quickDownloadLatest = () => {
  if (!latestSuccessItem.value) return
  void handleSingleDownload(latestSuccessItem.value)
}

const getFailureTip = (item: BatchItem) => {
  const error = String(item.error || '').toLowerCase()
  if (!error) return ''

  if (error.includes('could not establish connection')) {
    return '页面连接中断，刷新商品页后点击重试。'
  }

  if (error.includes('timeout') || error.includes('超时')) {
    return '抓取超时，建议先用“快速抓取”模板再重试。'
  }

  if (error.includes('评论区') || error.includes('容器')) {
    return '请先手动展开“全部评价”，再点击重试。'
  }

  if (item.taskType === 'review') {
    return '建议保持商品页前台可见，等待滚动完成后再重试。'
  }

  return '建议点击重试；若持续失败请刷新目标页面。'
}

const openUrl = (url: string) => window.open(url, '_blank')

const getTaskTypeTag = (item: BatchItem) => {
    return item.taskType === 'review'
        ? { label: '评', className: 'text-[9px] font-black text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded uppercase border border-amber-100 dark:border-amber-800 shrink-0' }
        : { label: '文', className: 'text-[9px] font-black text-slate-500 bg-slate-50 dark:bg-slate-700/60 px-1.5 py-0.5 rounded uppercase border border-slate-200 dark:border-slate-700 shrink-0' }
}

const handleSingleDownload = async (item: BatchItem) => {
    chrome.runtime.sendMessage({ 
        action: 'GET_FULL_RESULTS', 
        urls: [item.url]
    }, async (response) => {
        if (response && response.success && response.data.length > 0) {
            const data = response.data[0]
            const safeTitle = sanitizeDownloadName(normalizeExportTitle(data.title) || data.title || 'document')
            const isReviewTask = (data.taskType || 'doc') === 'review'
            const hasTextContent = typeof data.content === 'string' && data.content.length > 0
            const shouldUseArchive = !isReviewTask && !!(data.archiveBase64 || data.archiveStorageKey)
            
            if (data.format === 'pdf') {
                // PDF: decode base64 and download as .pdf
                if (data.content) {
                    const blob = new Blob([base64ToBytes(data.content)], { type: 'application/pdf' })
                    await triggerDownload(blob, `${safeTitle}.pdf`)
                }
            } else if (shouldUseArchive) {
                const archiveBase64 = data.archiveBase64 || (data.archiveStorageKey ? await fetchArchiveBase64ByKey(data.archiveStorageKey) : null)
                if (!archiveBase64) return
                const blob = new Blob([base64ToBytes(archiveBase64)], { type: 'application/zip' })
                await triggerDownload(blob, `${safeTitle}.zip`)
            } else {
                const formatMeta = getExportFormatMeta(data.format)
                const hasImages = (data.format === 'markdown' || data.format === 'html') && data.images && data.images.length > 0
                
                if (hasImages) {
                    const zip = new JSZip()
                    zip.file(`${safeTitle}${formatMeta.ext}`, encodeExportContent(data.format, data.content || ''))
                    
                    const imagesFolder = zip.folder("images")
                    data.images.forEach((img: any) => {
                        if (img.base64 && img.filename) {
                            const base64Data = img.base64.includes(',') ? img.base64.split(',')[1] : img.base64;
                            imagesFolder?.file(img.filename, base64Data, { base64: true })
                        }
                    })

                    const blob = await zip.generateAsync({ type: "blob" })
                    await triggerDownload(blob, `${safeTitle}.zip`)
                } else {
                    const blob = new Blob([encodeExportContent(data.format, hasTextContent ? data.content : '')], { type: formatMeta.mime })
                    await triggerDownload(blob, `${safeTitle}${formatMeta.ext}`)
                }
            }
        }
    })
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden">
    <div class="mb-2 flex justify-end">
      <button
        @click="showOverview = !showOverview"
        class="h-8 px-3 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-500 hover:text-blue-600 hover:border-blue-300 transition-colors"
      >{{ showOverview ? '收起概览' : '展开概览' }}</button>
    </div>

    <!-- Summary Header -->
    <div v-if="showOverview" class="grid grid-cols-2 gap-3 mb-4">
      <div class="p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
        <div class="text-xs uppercase tracking-wider font-bold text-gray-400 mb-1">完成总量</div>
        <div class="text-xl font-black text-blue-600">{{ batchStore.processedResults.filter(r => r.status === 'success').length }}</div>
      </div>
      <div class="p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm">
        <div class="text-xs uppercase tracking-wider font-bold text-gray-400 mb-1">已选大小</div>
        <div class="text-xl font-black text-gray-700 dark:text-gray-200">{{ formatSize(totalSelectedSize) }}</div>
      </div>
    </div>

    <div v-if="showOverview && latestSuccessItem" class="mb-4 p-3 rounded-2xl border border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/70 dark:bg-emerald-900/10 space-y-2">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="text-[11px] font-black tracking-wider uppercase text-emerald-600">最近完成</div>
          <div class="text-sm font-bold text-emerald-900 dark:text-emerald-200 truncate">{{ latestSuccessItem.title }}</div>
        </div>
        <button
          @click="quickDownloadLatest"
          class="h-9 px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 shadow shrink-0"
        >立即下载</button>
      </div>

      <div v-if="latestPreviewLoading" class="text-[11px] text-emerald-700/80">正在生成质量预览...</div>
      <div v-else-if="latestPreviewLines.length > 0" class="space-y-1">
        <div class="text-[11px] font-bold text-emerald-700">{{ latestPreviewMeta }}</div>
        <div v-for="line in latestPreviewLines" :key="line" class="text-[11px] text-emerald-800/90 dark:text-emerald-200/90 truncate">{{ line }}</div>
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
                 {{ currentItemProgressText }}
                 <template v-if="batchStore.activeCount > 1">（另有 {{ batchStore.activeCount - 1 }} 个并发任务）</template>
               </div>
               <div v-if="currentItemEtaText" class="text-[9px] text-blue-400 mt-0.5">{{ currentItemEtaText }}</div>
               <div v-if="batchStore.currentItem.strategyHint" class="text-[9px] text-indigo-500 mt-0.5">策略：{{ batchStore.currentItem.strategyHint }}</div>
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
                 <span :class="getTaskTypeTag(item).className">{{ getTaskTypeTag(item).label }}</span>
                 <span v-if="item.format === 'pdf'" class="text-[9px] font-black text-red-500 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded uppercase border border-red-100 dark:border-red-800 shrink-0">PDF</span>
                 <span v-else-if="item.format === 'csv'" class="text-[9px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded uppercase border border-emerald-100 dark:border-emerald-800 shrink-0">CSV</span>
                 <span v-else-if="item.format === 'json'" class="text-[9px] font-black text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded uppercase border border-amber-100 dark:border-amber-800 shrink-0">JSON</span>
                 <span v-else-if="item.format === 'markdown'" class="text-[9px] font-black text-blue-500 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded uppercase border border-blue-100 dark:border-blue-800 shrink-0">MD</span>
                 <span v-if="item.size" class="text-xs font-mono text-gray-400 shrink-0">{{ formatSize(item.size) }}</span>
              </div>
             <div class="text-[11px] text-gray-400 truncate opacity-60">{{ item.url }}</div>
             <div v-if="item.status === 'failed' && item.error" class="text-[10px] text-red-400 mt-0.5 truncate" :title="item.error">❌ {{ item.error }}</div>
             <div v-if="item.status === 'failed'" class="text-[10px] text-amber-500 mt-0.5 truncate">建议：{{ getFailureTip(item) }}</div>
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
