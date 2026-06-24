import apiClient from './client'

export type PsiStrategy = 'mobile' | 'desktop'
export type PsiCategory = 'good' | 'needs_improvement' | 'poor'
export type PsiScanMode = 'all' | 'needs_improvement'

export interface PsiProgress {
  isRunning: boolean
  total: number
  completed: number
  failed: number
  currentUrl: string | null
  currentUrls?: string[]
}

export interface PsiStats {
  good: number
  needs_improvement: number
  poor: number
  avgScore: number
  lastScanAt: string | null
  trend: { date: string; avgScore: number }[]
}

export interface PsiPageResult {
  pageId: string
  url: string
  performanceScore: number
  category: PsiCategory
  lcp: number | null
  cls: number | null
  fcp: number | null
  tbt: number | null
  fetchedAt: string
}

export interface AuditIssue {
  id: string
  title: string
  displayValue: string | null
  savingsMs: number | null
  score: number | null
}

export interface PageAuditResult {
  url: string
  score: number
  issues: AuditIssue[]
}

export interface PsiHistoryPoint {
  id: string
  performanceScore: number
  category: PsiCategory
  fcp: number | null
  lcp: number | null
  cls: number | null
  tbt: number | null
  si: number | null
  ttfb: number | null
  fetchedAt: string
}

const unwrap = (res: any) => res.data?.data ?? res.data

const base = (siteId: string) => `/api/sites/${siteId}/pagespeed`

export const pagespeedApi = {
  triggerScan: (siteId: string, strategy: PsiStrategy = 'mobile', mode: PsiScanMode = 'all') =>
    apiClient.post(`${base(siteId)}/scan`, {}, { params: { strategy, mode } }).then(unwrap),

  getProgress: (siteId: string, strategy: PsiStrategy = 'mobile'): Promise<PsiProgress> =>
    apiClient.get(`${base(siteId)}/progress`, { params: { strategy } }).then(unwrap),

  getStats: (siteId: string, strategy: PsiStrategy = 'mobile'): Promise<PsiStats> =>
    apiClient.get(`${base(siteId)}/stats`, { params: { strategy } }).then(unwrap),

  getResults: (siteId: string, strategy: PsiStrategy = 'mobile'): Promise<PsiPageResult[]> =>
    apiClient.get(`${base(siteId)}/results`, { params: { strategy } }).then(unwrap),

  getPageHistory: (siteId: string, pageId: string, strategy: PsiStrategy = 'mobile'): Promise<PsiHistoryPoint[]> =>
    apiClient.get(`${base(siteId)}/pages/${pageId}/history`, { params: { strategy } }).then(unwrap),

  analyzePage: (siteId: string, pageId: string, strategy: PsiStrategy = 'mobile'): Promise<PageAuditResult> =>
    apiClient.get(`${base(siteId)}/pages/${pageId}/analyze`, { params: { strategy } }).then(unwrap),
}
