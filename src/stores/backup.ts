import { create } from 'zustand'
import { db } from '../lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../lib/export/json-export'
import type { Snapshot } from '../lib/types'

/** 每个项目最多保留的快照数量 */
const MAX_SNAPSHOTS_PER_PROJECT = 20
/** 自动备份间隔（毫秒）— 5 分钟 */
export const AUTO_BACKUP_INTERVAL = 5 * 60 * 1000

export interface BackupOwner {
  projectId: number
  workspaceUid: string
}
type BackupProblem = 'quota' | 'export' | 'serialize' | 'write'
export interface AutoBackupStatus {
  owner: BackupOwner
  state: 'unverified' | 'saving' | 'saved' | 'failed'
  lastAttemptAt: number | null
  lastSuccessAt: number | null
  snapshotId: number | null
  problem: BackupProblem | null
  maintenance: ('prune' | 'refresh')[]
  maintenanceType: 'auto' | 'manual'
}
export const backupOwnerKey = (owner: BackupOwner) => JSON.stringify([owner.projectId, owner.workspaceUid])
const sameOwner = (left: BackupOwner | null, right: BackupOwner) => left != null && backupOwnerKey(left) === backupOwnerKey(right)
const autoRequests = new Map<string, Promise<number>>()
let listSequence = 0
let viewSequence = 0
let detailSequence = 0

export async function readBackupOwner(projectId: number): Promise<BackupOwner> {
  const project = await db.projects.get(projectId)
  if (!project?.workspaceUid) throw new Error('工作区已不存在，未创建快照。')
  return { projectId, workspaceUid: project.workspaceUid }
}
const readOwner = readBackupOwner

function snapshotMatchesOwner(snapshot: Snapshot, owner: BackupOwner): boolean {
  try {
    const body: unknown = JSON.parse(snapshot.data)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false
    const project = (body as Record<string, unknown>).project
    return !!project && typeof project === 'object' && !Array.isArray(project)
      && (project as Record<string, unknown>).workspaceUid === owner.workspaceUid
  } catch { return false }
}

const emptyStatus = (owner: BackupOwner): AutoBackupStatus => ({
  owner, state: 'unverified', lastAttemptAt: null, lastSuccessAt: null,
  snapshotId: null, problem: null, maintenance: [], maintenanceType: 'auto',
})

interface BackupStore {
  snapshots: Snapshot[]
  loading: boolean
  snapshotsOwner: BackupOwner | null
  autoStatus: Record<string, AutoBackupStatus>
  activeView: { projectId: number; routeKey: string; owner: BackupOwner | null } | null
  detailOwnerKey: string | null
  activateAutoBackup: (projectId: number, routeKey: string) => () => void
  resolveActiveBackupOwner: (projectId: number, expectedOwner?: BackupOwner | null) => Promise<BackupOwner | null>
  showBackupDetails: (owner: BackupOwner) => () => void
  readAutoBackupStatus: (projectId: number) => Promise<BackupOwner>

  /** 加载某个项目的所有快照（按时间倒序） */
  loadSnapshots: (projectId: number) => Promise<void>

  /** 创建快照 */
  createSnapshot: (projectId: number, label: string, type: 'auto' | 'manual', expectedWorkspaceUid?: string) => Promise<number>

  /** 删除快照 */
  deleteSnapshot: (id: number) => Promise<void>

  /** 从快照恢复 — 返回新创建的项目 ID */
  restoreSnapshot: (snapshotId: number) => Promise<number>

  /** 清理旧快照（保留最新 MAX 条） */
  pruneSnapshots: (projectId: number, expectedWorkspaceUid?: string) => Promise<void>
}

export const useBackupStore = create<BackupStore>((set, get) => ({
  snapshots: [],
  loading: false,
  snapshotsOwner: null,
  autoStatus: {},
  activeView: null,
  detailOwnerKey: null,

  activateAutoBackup: (projectId, routeKey) => {
    const sequence = ++viewSequence
    set({ activeView: { projectId, routeKey, owner: null } })
    void get().resolveActiveBackupOwner(projectId).then(async owner => {
      if (owner && !get().autoStatus[backupOwnerKey(owner)]) await get().readAutoBackupStatus(projectId)
    }).catch(() => { /* A removed owner must not borrow another workspace's status. */ })
    return () => {
      if (sequence === viewSequence) { viewSequence++; set({ activeView: null }) }
    }
  },

  resolveActiveBackupOwner: async (projectId, expectedOwner) => {
    const view = get().activeView
    if (!view || view.projectId !== projectId) return null
    const sequence = viewSequence
    const owner = view.owner ?? await readOwner(projectId)
    const current = get().activeView
    if (!current || sequence !== viewSequence
      || (expectedOwner && !sameOwner(expectedOwner, owner))
      || (current.owner && !sameOwner(current.owner, owner))) return null
    if (!current.owner) set({ activeView: { ...current, owner } })
    return owner
  },

  showBackupDetails: owner => {
    const sequence = ++detailSequence
    set({ detailOwnerKey: backupOwnerKey(owner) })
    return () => { if (sequence === detailSequence) set({ detailOwnerKey: null }) }
  },

  readAutoBackupStatus: async projectId => {
    const owner = await readOwner(projectId)
    const key = backupOwnerKey(owner)
    if (!get().autoStatus[key]) set(state => ({ autoStatus: { ...state.autoStatus, [key]: emptyStatus(owner) } }))
    const before = get().autoStatus[key]
    // A reload establishes only facts actually present in IndexedDB. An old,
    // in-memory failure is never replaced with an invented healthy status.
    const rows = await db.snapshots.where('projectId').equals(projectId)
      .filter(row => row.type === 'auto').sortBy('createdAt')
    const latest = rows.reverse().find(row => snapshotMatchesOwner(row, owner))
    if (!sameOwner(await readOwner(projectId), owner)) throw new Error('工作区身份已改变。')
    set(state => {
      const current = state.autoStatus[key]
      if (current !== before && (!latest || (current.lastSuccessAt != null
        && (current.lastSuccessAt > latest.createdAt
          || (current.lastSuccessAt === latest.createdAt && (current.snapshotId ?? 0) >= (latest.id ?? 0)))))) return state
      return { autoStatus: { ...state.autoStatus, [key]: {
        ...current, lastSuccessAt: latest?.createdAt ?? null, snapshotId: latest?.id ?? null,
      } } }
    })
    return owner
  },

  loadSnapshots: async (projectId: number) => {
    const sequence = ++listSequence
    set({ loading: true, snapshots: [], snapshotsOwner: null })
    try {
      const owner = await readOwner(projectId)
      const snapshots = await db.snapshots.where('projectId').equals(projectId).reverse().sortBy('createdAt')
      if (!sameOwner(await readOwner(projectId), owner)) throw new Error('工作区身份已改变。')
      if (sequence === listSequence) set({ snapshots, snapshotsOwner: owner, loading: false })
    } catch (error) {
      if (sequence === listSequence) set({ loading: false })
      throw error
    }
  },

  createSnapshot: async (projectId, label, type, expectedWorkspaceUid) => {
    let owner: BackupOwner
    try { owner = await readOwner(projectId) }
    catch (error) {
      if (type === 'auto' && expectedWorkspaceUid) {
        const frozenOwner = { projectId, workspaceUid: expectedWorkspaceUid }
        const key = backupOwnerKey(frozenOwner)
        set(state => ({ autoStatus: { ...state.autoStatus, [key]: {
          ...(state.autoStatus[key] ?? emptyStatus(frozenOwner)),
          state: 'failed', lastAttemptAt: Date.now(), problem: 'export',
        } } }))
      }
      throw error
    }
    if (expectedWorkspaceUid != null && owner.workspaceUid !== expectedWorkspaceUid) throw new Error('工作区身份已改变，未创建快照。')
    const key = backupOwnerKey(owner)
    if (type === 'auto' && autoRequests.has(key)) return autoRequests.get(key)!
    const updateStatus = (patch: Partial<AutoBackupStatus>) => {
      if (type === 'auto') set(state => ({ autoStatus: { ...state.autoStatus,
        [key]: { ...(state.autoStatus[key] ?? emptyStatus(owner)), ...patch } } }))
    }
    const create = async () => {
      let phase: BackupProblem = 'export'
      updateStatus({ state: 'saving', lastAttemptAt: Date.now() })
      let id: number
      let createdAt = 0
      try {
        const exportData = await exportProjectJSON(projectId)
        if (exportData.project.workspaceUid !== owner.workspaceUid) throw new Error('工作区身份已改变，未创建快照。')
        phase = 'serialize'
        const data = JSON.stringify(exportData)
        const size = new Blob([data]).size
        phase = 'write'
        createdAt = Date.now()
        id = await db.transaction('rw', db.projects, db.snapshots, async () => {
          if (!sameOwner(await readOwner(projectId), owner)) throw new Error('工作区身份已改变，未创建快照。')
          return await db.snapshots.add({ projectId, label, type, data, size, createdAt }) as number
        })
      } catch (error) {
        updateStatus({ state: 'failed', problem: error instanceof Error && error.name === 'QuotaExceededError' ? 'quota' : phase })
        throw error
      }
      // The native write has committed. Maintenance failure cannot undo it or
      // turn a real backup into a reported missing backup.
      updateStatus({ state: 'saved', lastSuccessAt: createdAt, snapshotId: id, problem: null, maintenance: [], maintenanceType: 'auto' })
      const maintenance: AutoBackupStatus['maintenance'] = []
      try { await get().pruneSnapshots(projectId, owner.workspaceUid) } catch { maintenance.push('prune') }
      // An old project's completion must not request/publish its list over the
      // different list currently being consumed by the author.
      if (sameOwner(get().snapshotsOwner, owner)) {
        try { await get().loadSnapshots(projectId) } catch { maintenance.push('refresh') }
      }
      if (type === 'auto') updateStatus({ maintenance })
      else if (maintenance.length || get().autoStatus[key]) set(state => ({ autoStatus: {
        ...state.autoStatus, [key]: { ...(state.autoStatus[key] ?? emptyStatus(owner)), maintenance, maintenanceType: 'manual' },
      } }))
      return id
    }
    const request = create()
    if (type === 'auto') autoRequests.set(key, request)
    try { return await request }
    finally { if (autoRequests.get(key) === request) autoRequests.delete(key) }
  },

  deleteSnapshot: async (id: number) => {
    const snap = await db.snapshots.get(id)
    await db.snapshots.delete(id)
    if (snap) {
      await get().loadSnapshots(snap.projectId)
    }
  },

  restoreSnapshot: async (snapshotId: number) => {
    const snap = await db.snapshots.get(snapshotId)
    if (!snap) throw new Error('快照不存在')

    const exportData = JSON.parse(snap.data)
    const newProjectId = await importProjectJSON(exportData)
    return newProjectId
  },

  pruneSnapshots: async (projectId: number, expectedWorkspaceUid?: string) => {
    const owner = await readOwner(projectId)
    if (expectedWorkspaceUid != null && owner.workspaceUid !== expectedWorkspaceUid) throw new Error('工作区身份已改变。')
    await db.transaction('rw', db.projects, db.snapshots, async () => {
      if (!sameOwner(await readOwner(projectId), owner)) throw new Error('工作区身份已改变。')
    // 分别处理自动和手动快照
    const autoSnaps = await db.snapshots
      .where('projectId')
      .equals(projectId)
      .filter((s) => s.type === 'auto')
      .reverse()
      .sortBy('createdAt')

    if (autoSnaps.length > MAX_SNAPSHOTS_PER_PROJECT) {
      const toDelete = autoSnaps.slice(MAX_SNAPSHOTS_PER_PROJECT)
      await db.snapshots.bulkDelete(toDelete.map((s) => s.id!))
    }
    })
  },
}))
