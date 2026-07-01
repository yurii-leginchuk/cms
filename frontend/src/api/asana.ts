import apiClient from './client'

export type AsanaConnStatus = 'untested' | 'verified' | 'failed'
export type AsanaWebhookStatus = 'none' | 'pending' | 'active' | 'error'
export type AsanaTaskOrigin = 'asana' | 'cms' | 'mcp'

export interface AsanaConnection {
  patSet: boolean
  workspaceGid: string | null
  workspaceName: string | null
  userName: string | null
  status: AsanaConnStatus
  verifiedAt: string | null
  lastError: string | null
}

export interface AsanaWorkspace { gid: string; name: string }
export interface AsanaProject { gid: string; name: string }
export interface AsanaUser { gid: string; name: string }
export interface AsanaSection { gid: string; name: string }

export interface VerifyResult {
  connection: AsanaConnection
  workspaces: AsanaWorkspace[]
}

export interface AsanaMapping {
  siteId: string
  projectGid: string | null
  projectName: string | null
  webhookStatus: AsanaWebhookStatus
  webhookLastReceivedAt: string | null
  lastFullSyncAt: string | null
  syncError: string | null
}

export interface AsanaTask {
  id: string
  siteId: string
  projectGid: string
  taskGid: string
  name: string
  notes: string | null
  assigneeGid: string | null
  assigneeName: string | null
  sectionGid: string | null
  sectionName: string | null
  completed: boolean
  dueOn: string | null
  permalinkUrl: string | null
  parentTaskGid: string | null
  numSubtasks: number
  linkedEntityType: string | null
  linkedEntityId: string | null
  origin: AsanaTaskOrigin
  asanaModifiedAt: string | null
  lastSyncedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TaskListResult {
  data: AsanaTask[]
  meta: { page: number; limit: number; total: number; totalPages: number }
}

export interface TaskDetail {
  task: AsanaTask
  subtasks: AsanaTask[]
}

export interface SyncResult {
  siteId: string
  synced: number
  pruned: number
  syncedAt: string
}

export interface ListTasksParams {
  page?: number
  limit?: number
  search?: string
  section?: string
  assignee?: string
  completed?: boolean
  linkedOnly?: boolean
  aiOnly?: boolean
}

const GLOBAL = '/api/asana'
const SITE = (siteId: string) => `/api/sites/${siteId}/asana`

async function unwrap<T>(p: Promise<{ data: { data: T } }>): Promise<T> {
  return (await p).data.data
}

export const asanaApi = {
  // ── Global connection / discovery ─────────────────────────────────────────
  connection: () => unwrap<AsanaConnection>(apiClient.get(`${GLOBAL}/connection`)),
  setConnection: (pat: string) =>
    unwrap<AsanaConnection>(apiClient.put(`${GLOBAL}/connection`, { pat })),
  disconnect: () => unwrap<AsanaConnection>(apiClient.delete(`${GLOBAL}/connection`)),
  verify: () => unwrap<VerifyResult>(apiClient.post(`${GLOBAL}/connection/verify`)),
  setWorkspace: (workspaceGid: string) =>
    unwrap<AsanaConnection>(apiClient.put(`${GLOBAL}/connection/workspace`, { workspaceGid })),
  workspaces: () => unwrap<AsanaWorkspace[]>(apiClient.get(`${GLOBAL}/workspaces`)),
  projects: () => unwrap<AsanaProject[]>(apiClient.get(`${GLOBAL}/projects`)),
  users: () => unwrap<AsanaUser[]>(apiClient.get(`${GLOBAL}/users`)),

  // ── Per-site ──────────────────────────────────────────────────────────────
  mapping: (siteId: string) => unwrap<AsanaMapping>(apiClient.get(`${SITE(siteId)}/mapping`)),
  setMapping: (siteId: string, projectGid: string) =>
    unwrap<AsanaMapping>(apiClient.put(`${SITE(siteId)}/mapping`, { projectGid })),
  sections: (siteId: string) => unwrap<AsanaSection[]>(apiClient.get(`${SITE(siteId)}/sections`)),
  sync: (siteId: string) => unwrap<SyncResult>(apiClient.post(`${SITE(siteId)}/sync`)),
  tasks: (siteId: string, params: ListTasksParams) =>
    unwrap<TaskListResult>(
      apiClient.get(`${SITE(siteId)}/tasks`, {
        params: {
          ...params,
          completed: params.completed === undefined ? undefined : String(params.completed),
          linkedOnly: params.linkedOnly ? 'true' : undefined,
          aiOnly: params.aiOnly ? 'true' : undefined,
        },
      }),
    ),
  task: (siteId: string, taskGid: string) =>
    unwrap<TaskDetail>(apiClient.get(`${SITE(siteId)}/tasks/${taskGid}`)),
}
