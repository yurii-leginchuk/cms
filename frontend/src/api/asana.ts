import apiClient from './client'

export type AsanaConnStatus = 'untested' | 'verified' | 'failed'
export type AsanaWebhookStatus = 'none' | 'pending' | 'active' | 'error'
export type AsanaTaskOrigin = 'asana' | 'cms' | 'mcp' | 'tracked'

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

export interface CreateTaskInput {
  name: string
  notes?: string
  assigneeGid?: string
  dueOn?: string
  sectionGid?: string
}

export interface UpdateTaskInput {
  name?: string
  notes?: string
  dueOn?: string | null
  completed?: boolean
}

export interface SubtaskResult {
  parent: AsanaTask
  subtask: AsanaTask
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
  establishWebhook: (siteId: string) => unwrap<AsanaMapping>(apiClient.post(`${SITE(siteId)}/webhook`)),
  removeWebhook: (siteId: string) => unwrap<AsanaMapping>(apiClient.delete(`${SITE(siteId)}/webhook`)),
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
  track: (siteId: string, url: string) =>
    unwrap<AsanaTask>(apiClient.post(`${SITE(siteId)}/tasks/track`, { url })),

  // ── Phase 2 writes ────────────────────────────────────────────────────────
  createTask: (siteId: string, input: CreateTaskInput) =>
    unwrap<AsanaTask>(apiClient.post(`${SITE(siteId)}/tasks`, input)),
  updateTask: (siteId: string, taskGid: string, input: UpdateTaskInput) =>
    unwrap<AsanaTask>(apiClient.patch(`${SITE(siteId)}/tasks/${taskGid}`, input)),
  untrack: (siteId: string, taskGid: string) =>
    unwrap<{ untracked: true; taskGid: string }>(apiClient.delete(`${SITE(siteId)}/tasks/${taskGid}`)),
  setStatus: (siteId: string, taskGid: string, sectionGid: string, completed?: boolean) =>
    unwrap<AsanaTask>(apiClient.post(`${SITE(siteId)}/tasks/${taskGid}/status`, { sectionGid, completed })),
  setAssignee: (siteId: string, taskGid: string, assigneeGid: string | null) =>
    unwrap<AsanaTask>(apiClient.post(`${SITE(siteId)}/tasks/${taskGid}/assignee`, { assigneeGid })),
  createSubtask: (siteId: string, taskGid: string, input: CreateTaskInput) =>
    unwrap<SubtaskResult>(apiClient.post(`${SITE(siteId)}/tasks/${taskGid}/subtasks`, input)),
  linkTask: (siteId: string, taskGid: string, entityType: string | null, entityId: string | null) =>
    unwrap<AsanaTask>(apiClient.post(`${SITE(siteId)}/tasks/${taskGid}/link`, { entityType, entityId })),

  // ── Optimization-Impact scope ─────────────────────────────────────────────
  getScope: (siteId: string, taskGid: string) =>
    unwrap<TaskScope>(apiClient.get(`${SITE(siteId)}/tasks/${taskGid}/scope`)),
  setScope: (siteId: string, taskGid: string, scope: 'sitewide' | 'pages' | null, pageIds: string[]) =>
    unwrap<TaskScope>(apiClient.put(`${SITE(siteId)}/tasks/${taskGid}/scope`, { scope, pageIds })),
}

export interface TaskScope {
  scope: 'sitewide' | 'pages' | null
  pageIds: string[]
}
