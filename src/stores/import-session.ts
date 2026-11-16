/**
 * 导入会话 CRUD store。
 *
 * 薄薄地封一层 Dexie 访问，让 pipeline.ts 和 UI 都不用直接摸 db。
 */
import { create } from 'zustand'
import Dexie from 'dexie'
import { db } from '../lib/db/schema'
import type { ImportSession, ImportLog, ChunkState } from '../lib/types/import-session'
import type { ImportFileBlob } from '../lib/types/import-file'
import type { WorkspaceScope } from '../lib/types/world-ownership'
import { resolveScope, scopeTransactionTables } from '../lib/workspace/scope'
import { sha256BinaryV1 } from '../lib/media/blob-store'

interface ImportSessionStore {
  /** 当前激活的 session（null = 没跑任何任务） */
  current: ImportSession | null

  /** 加载某 session 到内存；不存在返回 null */
  load: (sessionId: number) => Promise<ImportSession | null>
  /** 扫描项目里的未完成 session（用于断点续跑提示） */
  findUnfinished: (projectId: number) => Promise<ImportSession | null>
  /** 扫描项目里"已完成、可复用解析"的最新 session（解析一次·多次落地） */
  findReusableCompleted: (projectId: number) => Promise<ImportSession | null>
  /** 清除内存中的 current（不删除 DB） */
  clear: () => void
  /** 创建新 session 并持久化 */
  create: (data: Omit<ImportSession, 'id' | 'createdAt' | 'updatedAt'>) => Promise<number>
  /** 覆盖更新（部分字段） */
  patch: (sessionId: number, partial: Partial<ImportSession>) => Promise<void>
  /** 更新某个 chunk 的状态 */
  patchChunk: (sessionId: number, chunkIndex: number, partial: Partial<ChunkState>) => Promise<void>
  /** 追加日志到 DB */
  log: (sessionId: number, chunkIndex: number, level: ImportLog['level'], message: string) => Promise<void>
  /** 原子删除 session、全部日志与原文（用户明确放弃任务时） */
  deleteSession: (sessionId: number) => Promise<void>
  /** 取 session 的日志（给 Activity Log 回放） */
  listLogs: (sessionId: number, limit?: number) => Promise<ImportLog[]>

  // ── Phase 18 方案 A：Blob 持久化 ────────────────────────────
  /** 把上传的 File / Blob 作为原文存档（免得浏览器关了要重传） */
  saveBlob: (sessionId: number, filename: string, blob: Blob, fileHash: string) => Promise<void>
  /** 读取 Blob 存档 */
  loadBlob: (sessionId: number) => Promise<ImportFileBlob | null>
  /** 删除 Blob 存档（session 完成 / 放弃时） */
  deleteBlob: (sessionId: number) => Promise<void>
}


/** A deleted Session/Project is a terminal interruption, not a retryable
 * Blob-storage failure. Consumers must stop without recreating its records. */
export class ImportSessionUnavailableError extends Error {
  constructor() {
    super('导入会话或所属项目已删除，无法继续本次导入。')
    this.name = 'ImportSessionUnavailableError'
  }
}

// These checks only run inside the caller's write transaction. Persisted roots,
// rather than the current store cache or active Work, authorize this local write.
async function requireImportProject(projectId: number): Promise<void> {
  if (typeof projectId !== 'number' || !await db.projects.get(projectId)) {
    throw new ImportSessionUnavailableError()
  }
}
async function requireImportSession(sessionId: number): Promise<ImportSession> {
  const session = await db.importSessions.get(sessionId)
  if (!session) throw new ImportSessionUnavailableError()
  await requireImportProject(session.projectId)
  return session
}

export class ImportSessionAuthorityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportSessionAuthorityError'
  }
}

const SHA256 = /^[a-f0-9]{64}$/

export async function hashImportChunkTextV1(text: string): Promise<string> {
  return sha256BinaryV1(new TextEncoder().encode(text).buffer)
}

function sameScope(left: WorkspaceScope | undefined, right: WorkspaceScope | undefined): boolean {
  return left?.projectId === right?.projectId && left?.worldId === right?.worldId && left?.workId === right?.workId
}

async function assertImportTarget(
  row: Pick<ImportSession, 'projectId' | 'importTarget' | 'targetWorldGroupId'>,
  scope: WorkspaceScope,
): Promise<void> {
  if (row.projectId !== scope.projectId) throw new ImportSessionAuthorityError('导入目标不属于原工作区。')
  const project = await db.projects.get(scope.projectId)
  if (!project) throw new ImportSessionUnavailableError()
  const groupId = row.targetWorldGroupId ?? null
  if (row.importTarget === 'reference') {
    if (groupId !== null) throw new ImportSessionAuthorityError('项目参考不能绑定写入世界组。')
    return
  }
  if (row.importTarget !== 'project' || (project.enableMultiWorld && groupId === null))
    throw new ImportSessionAuthorityError('请确认本次导入的原目标世界组。')
  if (groupId !== null) {
    const group = await db.worldGroups.get(groupId)
    if (!group || group.projectId !== scope.projectId || group.worldId !== scope.worldId)
      throw new ImportSessionAuthorityError('导入目标世界组已删除或不属于原世界。')
  }
}

export async function verifyImportProjectTargetGroupV1(scope: WorkspaceScope, worldGroupId: number | null): Promise<void> {
  await assertImportTarget({ projectId: scope.projectId, importTarget: 'project', targetWorldGroupId: worldGroupId }, scope)
}

function sameChunkIdentity(left: ChunkState, right: ChunkState): boolean {
  return left.index === right.index && left.startChar === right.startChar && left.endChar === right.endChar &&
    left.charCount === right.charCount && left.label === right.label && left.sourceTextHash === right.sourceTextHash
}

function sameImportIdentity(left: ImportSession, right: ImportSession): boolean {
  return left.id === right.id && left.projectId === right.projectId && sameScope(left.targetScope, right.targetScope) &&
    left.fileHash === right.fileHash && left.totalChars === right.totalChars &&
    left.totalChunks === right.totalChunks && left.chunkSize === right.chunkSize && left.importTarget === right.importTarget &&
    left.targetWorldGroupId === right.targetWorldGroupId && left.analysisDepth === right.analysisDepth &&
    left.chunks.length === right.chunks.length && left.chunks.every((chunk, i) => sameChunkIdentity(chunk, right.chunks[i]))
}

export function hasFrozenImportIdentityV1(session: ImportSession): boolean {
  return session.targetScope != null && session.chunks.length === session.totalChunks &&
    session.chunks.every(chunk => typeof chunk.sourceTextHash === 'string' && SHA256.test(chunk.sourceTextHash))
}

/** Caller must include the scoped importSessions and worldGroups tables. */
export async function readImportSessionAuthorityInTransactionV1(
  sessionId: number,
  projectId: number,
  expected?: ImportSession,
): Promise<ImportSession & { targetScope: WorkspaceScope }> {
  const row = await requireImportSession(sessionId)
  if (row.projectId !== projectId || (expected && !sameImportIdentity(row, expected)))
    throw new ImportSessionAuthorityError('导入会话、原文或目标已经变化；请返回原会话重新确认。')
  if (!row.targetScope || !hasFrozenImportIdentityV1(row))
    throw new ImportSessionAuthorityError('这份旧导入没有保存准确的原文和落点；可查看原报告，请重新选择原文件和目标开始新任务。')
  const scope = await resolveScope({ scope: row.targetScope, projectId })
  const project = await db.projects.get(projectId)
  if (project?.activeWorldId !== scope.worldId || project?.activeWorkId !== scope.workId)
    throw new ImportSessionAuthorityError('当前世界或作品已切换。请回到原导入目标后继续。')
  await assertImportTarget(row, scope)
  return { ...row, targetScope: scope }
}

/** Freeze the exact local source and destination before reading or dispatching anything. */
export function readImportSessionAuthorityV1(sessionId: number, projectId: number, expected?: ImportSession) {
  return db.transaction('r', scopeTransactionTables(db.importSessions, db.worldGroups), async () =>
    Dexie.waitFor(readImportSessionAuthorityInTransactionV1(sessionId, projectId, expected)))
}

function sameDurableParse(left: ChunkState['durableParse'], right: ChunkState['durableParse']): boolean {
  return left?.claimKey === right?.claimKey && left?.runId === right?.runId &&
    JSON.stringify(left?.confirmation) === JSON.stringify(right?.confirmation)
}

export async function reserveImportChunkParseV1(session: ImportSession & { id: number }, index: number): Promise<string> {
  const claimKey = crypto.randomUUID()
  return db.transaction('rw', scopeTransactionTables(db.importSessions, db.worldGroups), async () => {
    const row = await Dexie.waitFor(readImportSessionAuthorityInTransactionV1(session.id, session.projectId, session))
    if (row.status === 'cancelled' || row.status === 'done') throw new ImportSessionAuthorityError('已结束的导入不能创建新候选。')
    const chunk = row.chunks[index]
    if (!chunk || chunk.index !== index || row.chunks.find(item => item.status !== 'done')?.index !== index)
      throw new ImportSessionAuthorityError('请先完成前面的分块确认。')
    if (chunk.durableParse)
      throw new ImportSessionAuthorityError('原分块已有候选或尝试记录；请核对原记录，不能再次发送。')
    const chunks = row.chunks.map(item => item.index === index ? { ...item, durableParse: { claimKey, runId: null } } : item)
    await db.importSessions.update(session.id, { chunks, updatedAt: Date.now() })
    return claimKey
  })
}

export async function bindImportChunkParseRunV1(
  session: ImportSession & { id: number }, index: number, claimKey: string, runId: number,
): Promise<void> {
  await db.transaction('rw', scopeTransactionTables(db.importSessions, db.worldGroups, db.agentRuns), async () => {
    const row = await requireImportSession(session.id)
    if (!row.targetScope || !sameImportIdentity(row, session)) throw new ImportSessionAuthorityError('原导入会话已变化。')
    const scope = await resolveScope({ scope: row.targetScope })
    const chunk = row.chunks[index], run = await db.agentRuns.get(runId)
    if (!chunk?.durableParse || chunk.durableParse.claimKey !== claimKey || chunk.durableParse.runId !== null ||
      !run || run.projectId !== scope.projectId || run.workId !== scope.workId)
      throw new ImportSessionAuthorityError('不能替换或跨作品绑定原分块候选运行。')
    const chunks = row.chunks.map(item => item.index === index ? { ...item, durableParse: { claimKey, runId } } : item)
    await db.importSessions.update(session.id, { chunks, updatedAt: Date.now() })
  })
}

export async function cancelImportSessionInScopeV1(input: { sessionId: number; projectId: number }): Promise<void> {
  return db.transaction('rw', scopeTransactionTables(db.importSessions, db.worldGroups), async () => {
    const row = await Dexie.waitFor(readImportSessionAuthorityInTransactionV1(input.sessionId, input.projectId))
    if (row.status === 'cancelled' || row.status === 'done') return
    await db.importSessions.update(input.sessionId, { status: 'cancelled', updatedAt: Date.now() })
  })
}

export function importedReferenceAnalysisStartTablesV1() {
  return scopeTransactionTables(db.importSessions, db.worldGroups, db.references)
}

/** Called inside the first ReferenceAnalysis Run/source write. No model has
 * started yet; if creation aborts, the whole claim rolls back naturally. */
export async function claimImportedReferenceAnalysisInTransactionV1(session: ImportSession & { id: number }): Promise<void> {
  const transaction = Dexie.currentTransaction
  if (!transaction || transaction.db !== db || transaction.mode !== 'readwrite' || !transaction.active ||
    importedReferenceAnalysisStartTablesV1().some(table => !transaction.storeNames.includes(table.name)))
    throw new ImportSessionAuthorityError('缺少原项目参考分析写入事务。')
  const original = await Dexie.waitFor(readImportSessionAuthorityInTransactionV1(session.id, session.projectId, session))
  const refId = original.publishedReferenceId
  if (original.importTarget !== 'reference' || original.status !== 'done' || refId == null ||
    refId !== session.publishedReferenceId || !original.chunks.every(chunk => chunk.durableParse?.confirmation))
    throw new ImportSessionAuthorityError('未找到已确认的原项目参考。')
  const ref = await transaction.table(db.references.name).get(refId)
  if (!ref || ref.projectId !== original.projectId || ref.workId !== original.targetScope.workId || ref.importSessionId !== original.id)
    throw new ImportSessionAuthorityError('原项目参考已删除或不属于当前作品。')
  if (original.referenceAnalysisStartedAt != null)
    throw new ImportSessionAuthorityError('原分析已开始过。请在项目参考中查看或恢复。')
  const sessions = transaction.table<ImportSession, number>(db.importSessions.name)
  if (!await sessions.update(session.id, { referenceAnalysisStartedAt: Date.now() }))
    throw new ImportSessionUnavailableError()
}

const now = () => Date.now()

export const useImportSessionStore = create<ImportSessionStore>((set, get) => ({
  current: null,

  load: async (sessionId) => {
    const s = (await db.importSessions.get(sessionId)) || null
    set({ current: s })
    return s
  },

  findUnfinished: async (projectId) => {
    const project = await db.projects.get(projectId)
    if (!project) return null
    const all = await db.importSessions.where('projectId').equals(projectId).reverse().sortBy('updatedAt')
    return all.find(row => row.status !== 'done' && row.status !== 'cancelled' &&
      (!row.targetScope || (row.targetScope.worldId === project.activeWorldId && row.targetScope.workId === project.activeWorkId))) ?? null
  },

  findReusableCompleted: async (projectId) => {
    const project = await db.projects.get(projectId)
    if (!project) return null
    const all = await db.importSessions.where('projectId').equals(projectId).reverse().sortBy('updatedAt')
    return all.find(row => {
      if (row.status !== 'done' || !hasFrozenImportIdentityV1(row) ||
        row.targetScope?.worldId !== project.activeWorldId || row.targetScope?.workId !== project.activeWorkId) return false
      const result = row.merged
      return Boolean(row.publishedReferenceId || (result?.worldview && Object.keys(result.worldview).length > 0) ||
        (Array.isArray(result?.characters) && result.characters.length > 0) ||
        (Array.isArray(result?.outline) && result.outline.length > 0) ||
        (result?.writingTechniques && Object.values(result.writingTechniques).some(v => typeof v === 'string' && v.trim())))
    }) ?? null
  },

  clear: () => set({ current: null }),

  create: async (input) => {
    const data = structuredClone(input)
    const row = await db.transaction('rw', scopeTransactionTables(db.importSessions, db.worldGroups), async () => {
      await requireImportProject(data.projectId)
      const current = await resolveScope({ projectId: data.projectId })
      if (data.targetScope && !sameScope(current, data.targetScope))
        throw new ImportSessionAuthorityError('当前世界或作品已切换；请重新确认导入目标。')
      const candidate: ImportSession = { ...data, targetScope: current, createdAt: now(), updatedAt: now() }
      if (candidate.publishedReferenceId != null || candidate.referenceAnalysisStartedAt != null || !hasFrozenImportIdentityV1(candidate) || candidate.chunks.some((chunk, i) => chunk.index !== i || chunk.durableParse !== undefined))
        throw new ImportSessionAuthorityError('导入缺少冻结的分块原文证据。')
      await assertImportTarget(candidate, current)
      const id = await db.importSessions.add(candidate) as number
      return { ...candidate, id }
    })
    set({ current: row })
    return row.id
  },

  patch: async (sessionId, partial) => {
    const next = { ...structuredClone(partial), updatedAt: now() }
    const updated = await db.transaction('rw', db.projects, db.importSessions, async () => {
      const session = await requireImportSession(sessionId)
      if (!sameImportIdentity(session, { ...session, ...next }) ||
        (Object.prototype.hasOwnProperty.call(next, 'publishedReferenceId') && next.publishedReferenceId !== session.publishedReferenceId) ||
        (Object.prototype.hasOwnProperty.call(next, 'referenceAnalysisStartedAt') && next.referenceAnalysisStartedAt !== session.referenceAnalysisStartedAt) ||
        (next.chunks && next.chunks.some((chunk, i) => !sameDurableParse(chunk.durableParse, session.chunks[i].durableParse))))
        throw new ImportSessionAuthorityError('导入会话身份、原文和目标不能更改。')
      if (!await db.importSessions.update(sessionId, next)) throw new ImportSessionUnavailableError()
      return { ...session, ...next }
    })
    if (get().current?.id === sessionId) set({ current: updated })
  },

  patchChunk: async (sessionId, chunkIndex, partial) => {
    const updated = await db.transaction('rw', db.projects, db.importSessions, async () => {
      const session = await requireImportSession(sessionId)
      const chunks = session.chunks.map(c => {
        if (c.index !== chunkIndex) return c
        const next = { ...c, ...partial }
        if (!sameChunkIdentity(c, next) || !sameDurableParse(c.durableParse, next.durableParse)) throw new ImportSessionAuthorityError('导入分块原文身份不能更改。')
        return next
      })
      const next = { chunks, updatedAt: now() }
      if (!await db.importSessions.update(sessionId, next)) throw new ImportSessionUnavailableError()
      return { ...session, ...next }
    })
    if (get().current?.id === sessionId) set({ current: updated })
  },

  log: async (sessionId, chunkIndex, level, message) => {
    await db.transaction('rw', db.projects, db.importSessions, db.importLogs, async () => {
      await requireImportSession(sessionId)
      await db.importLogs.add({ sessionId, chunkIndex, level, message, createdAt: now() })
    })
  },

  deleteSession: async (sessionId) => {
    // Explicit abandonment is idempotent even when the root is already gone.
    // These are the stores actually mutated by session CRUD; project-wide
    // lifecycle inventory remains derived by registry/lifecycle.ts.
    await db.transaction('rw', db.importSessions, db.importLogs, db.importFiles, async () => {
      await db.importLogs.where('sessionId').equals(sessionId).delete()
      await db.importFiles.delete(sessionId)
      await db.importSessions.delete(sessionId)
    })
    if (get().current?.id === sessionId) set({ current: null })
  },

  listLogs: async (sessionId, limit = 500) => {
    const rows = await db.importLogs
      .where('sessionId').equals(sessionId)
      .reverse().sortBy('createdAt')
    return rows.slice(0, limit)
  },

  saveBlob: async (sessionId, filename, blob, fileHash) => {
    const row: ImportFileBlob = {
      sessionId,
      filename,
      fileSize: blob.size,
      fileHash,
      blob,
      createdAt: now(),
    }
    await db.transaction('rw', db.projects, db.importSessions, db.importFiles, async () => {
      const session = await requireImportSession(sessionId)
      if (row.fileHash !== session.fileHash) throw new ImportSessionAuthorityError('原文档案与原导入文件不一致。')
      await db.importFiles.put(row)
    })
  },

  loadBlob: async (sessionId) => {
    const row = (await db.importFiles.get(sessionId)) || null
    return row
  },

  deleteBlob: async (sessionId) => {
    await db.importFiles.delete(sessionId)
  },
}))
