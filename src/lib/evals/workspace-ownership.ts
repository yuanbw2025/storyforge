import { hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import { generateWorkspaceUid, isWorkspaceUid } from '../memory/identity'
import { cascadeDeleteProject, transactionTablesFor } from '../registry/lifecycle'
import type { CreateWorkspaceInput } from '../types'
import { createWorkspace, type CreateWorkspaceOptions } from '../workspace/create-workspace'

export type EvalWorkspaceSuiteV1 = 'h86-story-arc' | 'creative-reliability' | 'races-gateway'
export interface EvalWorkspaceOwnerV1 {
  suite: EvalWorkspaceSuiteV1
  runId: string
  workspaceUid: string
}
const EVAL_RUN_LEASE = Symbol('eval-workspace-run-lease')
export interface EvalWorkspaceRunLeaseV1 {
  readonly suite: EvalWorkspaceSuiteV1
  readonly runId: string
  readonly [EVAL_RUN_LEASE]: true
}
const activeLeases = new Map<string, EvalWorkspaceRunLeaseV1>()
function runLockKey(suite: EvalWorkspaceSuiteV1, runId: string): string {
  return `storyforge:eval-workspace-run:v1:${db.name}:${suite}:${encodeURIComponent(runId)}`
}
function assertActiveLease(lease: EvalWorkspaceRunLeaseV1, suite: EvalWorkspaceSuiteV1, runId: string): void {
  if (!lease || activeLeases.get(runLockKey(suite, runId)) !== lease || lease.suite !== suite || lease.runId !== runId) {
    throw new Error('评测活动持有者已失效或不属于本次运行；原数据保留。')
  }
}
async function withRunLease<Result>(
  input: { suite: EvalWorkspaceSuiteV1; runId: string; lease?: EvalWorkspaceRunLeaseV1 },
  operation: (lease: EvalWorkspaceRunLeaseV1) => Promise<Result>,
  busy: () => Result,
): Promise<Result> {
  if (!SUITES.includes(input.suite) || !validRunId(input.runId)) throw new Error('评测运行身份无效')
  if (input.lease) {
    assertActiveLease(input.lease, input.suite, input.runId)
    return operation(input.lease)
  }
  if (typeof navigator === 'undefined' || !navigator.locks?.request) {
    throw new Error('当前浏览器无法确认其他页面的评测占用；未创建或清理工作区，原记录保留。')
  }
  const key = runLockKey(input.suite, input.runId)
  return navigator.locks.request(key, { ifAvailable: true, mode: 'exclusive' }, async lock => {
    if (!lock) return busy()
    const lease: EvalWorkspaceRunLeaseV1 = Object.freeze({ suite: input.suite, runId: input.runId, [EVAL_RUN_LEASE]: true as const })
    activeLeases.set(key, lease)
    try { return await operation(lease) }
    finally { if (activeLeases.get(key) === lease) activeLeases.delete(key) }
  })
}

/** Held for the full public eval execution, never persisted as deletion authority. */
export function withEvalWorkspaceRunLeaseV1<Result>(
  input: { suite: EvalWorkspaceSuiteV1; runId: string; lease?: EvalWorkspaceRunLeaseV1 },
  operation: (lease: EvalWorkspaceRunLeaseV1) => Promise<Result>,
): Promise<Result> {
  return withRunLease(input, operation, () => { throw new Error('本次评测仍在另一页面执行；请保留原运行并等待结束。') })
}

interface OwnershipReceiptV1 extends EvalWorkspaceOwnerV1 {
  version: 1
  projectId: number | null
  createdAt: number
  ownershipHash: string
}
const STORAGE_PREFIX = 'storyforge:eval-workspace-ownership:v1:'
const SUITES: readonly string[] = ['h86-story-arc', 'creative-reliability', 'races-gateway']
function validRunId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u001f]/.test(value)
}
function storageKey(workspaceUid: string): string { return STORAGE_PREFIX + workspaceUid }
function receiptBody(receipt: OwnershipReceiptV1) {
  const { ownershipHash: _hash, ...body } = receipt
  return body
}
async function persistReceipt(receipt: OwnershipReceiptV1) {
  const sealed = { ...receipt, ownershipHash: await hashCanonicalValue(receiptBody(receipt)) }
  localStorage.setItem(storageKey(receipt.workspaceUid), JSON.stringify(sealed))
}
async function readReceipt(raw: string, key: string): Promise<OwnershipReceiptV1 | null> {
  try {
    const value = JSON.parse(raw) as Partial<OwnershipReceiptV1>
    if (value.version !== 1 || !SUITES.includes(value.suite ?? '') || !validRunId(value.runId)
      || !isWorkspaceUid(value.workspaceUid) || key !== storageKey(value.workspaceUid)
      || (value.projectId !== null && (!Number.isSafeInteger(value.projectId) || value.projectId! <= 0))
      || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt)
      || typeof value.ownershipHash !== 'string') return null
    const receipt = value as OwnershipReceiptV1
    return await hashCanonicalValue(receiptBody(receipt)) === receipt.ownershipHash ? receipt : null
  } catch { return null }
}

/**
 * A receipt is written before this evaluator allocates its own immutable UID.
 * Name/description, imported reports and arbitrary existing numeric IDs cannot
 * claim ownership. Pending creation survives interruption; no schema/table is added.
 */
export async function createOwnedEvalWorkspaceV1(input: {
  suite: EvalWorkspaceSuiteV1
  runId: string
  workspace: Omit<CreateWorkspaceInput, 'workspaceUid'>
  options?: CreateWorkspaceOptions
  lease: EvalWorkspaceRunLeaseV1
}) {
  assertActiveLease(input.lease, input.suite, input.runId)
  const owner: EvalWorkspaceOwnerV1 = { suite: input.suite, runId: input.runId, workspaceUid: generateWorkspaceUid() }
  const receipt: OwnershipReceiptV1 = { ...owner, version: 1, projectId: null, createdAt: Date.now(), ownershipHash: '' }
  // Failure to persist means no workspace is allocated at all.
  await persistReceipt(receipt)
  try {
    const created = await createWorkspace({ ...input.workspace, workspaceUid: owner.workspaceUid }, input.options)
    await persistReceipt({ ...receipt, projectId: created.scope.projectId })
    return { ...created, evalOwner: owner }
  } catch (cause) {
    try { await cleanupOwnedEvalWorkspaceV1(owner, input.lease) }
    catch (cleanupCause) {
      throw Object.defineProperty(new Error('评测工作区创建失败，隔离清理未完成；保留运行所有权记录以便重试。'), 'cause', { value: { creation: cause, cleanup: cleanupCause }, configurable: true, writable: true })
    }
    throw cause
  }
}

type CleanupOutcome = 'deleted' | 'missing' | 'mismatch'
async function cleanupReceipt(receipt: OwnershipReceiptV1, raw: string): Promise<boolean> {
  // The UID check and existing registered cascade share the same write locks.
  // No numeric-ID reuse or concurrent import can replace the root between them.
  const outcome = await db.transaction('rw', transactionTablesFor('deleteProject'), async (): Promise<CleanupOutcome> => {
    const project = receipt.projectId == null
      ? await db.projects.where('workspaceUid').equals(receipt.workspaceUid).first()
      : await db.projects.get(receipt.projectId)
    if (!project) return 'missing'
    if (project.workspaceUid !== receipt.workspaceUid || project.id == null) return 'mismatch'
    await cascadeDeleteProject(project.id)
    return 'deleted'
  })
  if (outcome !== 'mismatch' && localStorage.getItem(storageKey(receipt.workspaceUid)) === raw) {
    localStorage.removeItem(storageKey(receipt.workspaceUid))
  }
  return outcome === 'deleted'
}

/** Deletes only one workspace actually allocated by this exact eval run. */
export async function cleanupOwnedEvalWorkspaceV1(owner: EvalWorkspaceOwnerV1, lease?: EvalWorkspaceRunLeaseV1): Promise<boolean> {
  if (!isWorkspaceUid(owner.workspaceUid) || !validRunId(owner.runId)) return false
  return withRunLease({ suite: owner.suite, runId: owner.runId, lease }, async () => {
    const key = storageKey(owner.workspaceUid), raw = localStorage.getItem(key)
    if (!raw) return false
    const receipt = await readReceipt(raw, key)
    if (!receipt || receipt.suite !== owner.suite || receipt.runId !== owner.runId) return false
    return cleanupReceipt(receipt, raw)
  }, () => false)
}

/**
 * Reload/reset recovery is scoped to an explicit run. Unknown legacy rows and
 * malformed receipts remain untouched. Receipt removal follows committed deletion;
 * a failed cascade retains the proof for a later retry.
 */
export async function cleanupOwnedEvalWorkspacesV1(input: {
  suite: EvalWorkspaceSuiteV1
  runId?: string
  projectIds?: readonly number[]
  lease?: EvalWorkspaceRunLeaseV1
}): Promise<number> {
  if (!validRunId(input.runId)) return 0
  return withRunLease({ suite: input.suite, runId: input.runId, lease: input.lease }, async () => {
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key): key is string => key != null && key.startsWith(STORAGE_PREFIX))
    let deleted = 0
    for (const key of keys) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const receipt = await readReceipt(raw, key)
      if (!receipt || receipt.suite !== input.suite || receipt.runId !== input.runId
        || (input.projectIds && (receipt.projectId == null || !input.projectIds.includes(receipt.projectId)))) continue
      if (await cleanupReceipt(receipt, raw)) deleted += 1
    }
    return deleted
  }, () => 0)
}
