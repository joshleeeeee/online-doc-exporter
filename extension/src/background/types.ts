export interface BatchItem {
    url: string
    title: string
    taskType?: 'doc' | 'review'
    format?: string
    options?: any
    status: 'pending' | 'processing' | 'success' | 'failed'
    size?: number
    timestamp?: number
    error?: string
    content?: string
    images?: any[]
    archiveBase64?: string
    archiveName?: string
    archiveStorageKey?: string
    progressMessage?: string
    progressTotal?: number
    progressRound?: number
    progressAdded?: number
    progressMaxRounds?: number
    progressStartedAt?: number
    strategyHint?: string
}
