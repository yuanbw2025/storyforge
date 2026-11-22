import Dexie from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope, AgentRunEventTypeV1, AgentRunEventPayloadByTypeV1 } from '../types'
import type { NarrativeCompilationResultV1, NarrativeIncrementalBaseV1 } from './narrative-incremental'
import { agentRunScopeTransactionTablesV1, appendAgentRunEventV1, appendAgentRunEventWithSettlementInTransactionV1,
  createAgentRunV1, readAgentRunV1, readVerifiedAgentRunInTransactionV1, withAgentRunMutationLockV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { createAgentRunCheckpointV1, createAgentRunCheckpointInTransactionV1, readLatestVerifiedAgentRunCheckpointV1,
  beginAgentRunRecoveryV1, completeAgentRunRecoveryV1 } from '../agent/run/checkpoint'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import { captureWorldReleaseInputV4, type WorldReleaseInputV4 } from './narrative-release-capture'
import type { NarrativeDomainCompilerV4 } from '../types/narrative-release'
import { compileNarrativeReleaseInWorkerV1, type NarrativeCompileProgressV1 } from './narrative-release-worker'
import { canonicalNarrativeJsonV1, hashNarrativeValueV1 } from './narrative-json'
import { readOwnedRows } from '../workspace/scope'
import { sealPreparedNarrativeWorldRevisionV4 } from './releases'

const STEP = 'world.narrative.compile-v4', MAX_ATTEMPTS = 3
const OBJECTIVE = '编译并核验作者选定的叙事世界快照；完成只表示编译完成，未发布'
const active = new Map<number, AbortController>()
export interface NarrativeCompilationCheckpointV1 {
  version: 1
  kind: 'narrative-compilation-v1'
  portable: false
  scope: WorkspaceScope
  selectedTables: string[]
  includeWorkSources: boolean
  input: WorldReleaseInputV4
  inputHash: string
  baseline?: NarrativeIncrementalBaseV1
  result?: Omit<NarrativeCompilationResultV1, 'manifestJson'>
  receipt?: { schema: 'storyforge.narrative-compilation-receipt'; version: 1; inputHash: string; contentHash: string; indexHash: string; compilerVersion: string; modelCalls: 0; impactPlanHash?: string; operationKey?: string }
  receiptHash?: string
}
async function bindingHash(state: NarrativeCompilationCheckpointV1) {
  return state.baseline ? hashNarrativeValueV1({ inputHash: state.inputHash, baseline: state.baseline }) : state.inputHash
}
function append<T extends AgentRunEventTypeV1>(scope: WorkspaceScope, run: AgentRunSnapshotV1, type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
  return appendAgentRunEventV1({ scope, runId: run.run.id, expectedLastSequence: run.projection.lastSequence, type, payload })
}
async function assertSourceCurrent(state: NarrativeCompilationCheckpointV1): Promise<void> {
  const current = await captureWorldReleaseInputV4({ scope: state.scope, selectedTables: state.selectedTables,
    includeWorkSources: state.includeWorkSources, compilerVersion: state.input.compilerVersion })
  if (await hashNarrativeValueV1(current.input) !== state.inputHash) throw Error('[narrative-compile-task:stale] 来源、权限或审核已变化，请重新捕获')
}

/** Captures one author-selected input without compiling or publishing it. The
 * zero-model run owns only a deterministic result/checkpoint, no Canon writes.
 * A later seal action must separately pass the source CAS in releases.ts. */
export async function createNarrativeCompilationTaskV1(input: { scope: WorkspaceScope; selectedTables?: string[]; includeWorkSources?: boolean;
  baseRevisionId?: number; compilerVersion?: NarrativeDomainCompilerV4 }) {
  const request = { scope: { ...input.scope }, selectedTables: input.selectedTables && [...input.selectedTables],
    includeWorkSources: input.includeWorkSources, compilerVersion: input.compilerVersion }
  const captured = await captureWorldReleaseInputV4(request)
  const state: NarrativeCompilationCheckpointV1 = { version: 1, kind: 'narrative-compilation-v1', portable: false,
    scope: request.scope, selectedTables: captured.input.selectedTables, includeWorkSources: request.includeWorkSources === true,
    input: captured.input, inputHash: await hashNarrativeValueV1(captured.input) }
  if (input.baseRevisionId !== undefined) {
    const revision = await db.worldRevisions.get(input.baseRevisionId)
    if (!revision || revision.projectId !== request.scope.projectId || revision.worldId !== request.scope.worldId) throw Error('[narrative-compile-task] 比较基准不属于当前世界')
    if (JSON.parse(revision.manifestJson).version !== 4) throw Error('[narrative-compile-task] 增量比较只接受已冻结的叙事 v4 修订')
    state.baseline = { version: 1, manifestJson: revision.manifestJson, contentHash: revision.contentHash }
  }
  let run = await createAgentRunV1({ scope: request.scope, contract: {
    version: 1, objective: OBJECTIVE, workflowKind: 'plan-execute',
    scope: { projectId: request.scope.projectId, worldGroupId: null }, runtimeBindingHash: await bindingHash(state),
    permissions: { contextSourceKeys: [], writeTargets: [] },
    budget: { maxModelCalls: 0, maxToolCalls: MAX_ATTEMPTS, maxInputTokens: 0, maxOutputTokens: 0, maxAttemptsPerStep: MAX_ATTEMPTS, maxProtocolErrors: 0 },
    acceptance: [{ id: 'narrative.compiled-result', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'narrative.compilation', kind: 'terminal', verifier: captured.input.compilerVersion, criterionIds: ['narrative.compiled-result'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  } })
  run = await append(request.scope, run, 'step.scheduled', { stepId: STEP })
  run = (await createAgentRunCheckpointV1({ scope: request.scope, runId: run.run.id, expectedLastSequence: run.projection.lastSequence, resumePayload: state })).snapshot
  run = await append(request.scope, run, 'run.paused', { reason: 'narrative-input-captured', recoverable: true })
  return { snapshot: run, checkpoint: state }
}

export async function readNarrativeCompilationTaskV1(scope: WorkspaceScope, runId: number) {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  const state = saved?.resumePayload as NarrativeCompilationCheckpointV1 | undefined
  if (!saved || !state || state.version !== 1 || state.kind !== 'narrative-compilation-v1' || state.portable !== false
    || saved.snapshot.contract.runtimeBindingHash !== await bindingHash(state) || await hashNarrativeValueV1(state.input) !== state.inputHash) throw Error('[narrative-compile-task] 检查点或输入绑定无效')
  const historicalOnly = canonicalNarrativeJsonV1(scope) !== canonicalNarrativeJsonV1(state.scope)
    || saved.snapshot.events.some(event => event.type === 'run.cancelled' && event.payload.reason === 'project-import-nonportable-checkpoint')
  if (state.result && (!state.receipt || !state.receiptHash || await hashNarrativeValueV1(state.receipt) !== state.receiptHash
    || state.receipt.inputHash !== state.inputHash || state.receipt.contentHash !== state.result.contentHash
    || state.receipt.indexHash !== state.result.index.indexHash)) throw Error('[narrative-compile-task] 编译结果回执无效')
  if (state.result?.update) {
    const update = state.result.update, { planHash, ...plan } = update.impact
    if (!state.baseline || state.receipt?.impactPlanHash !== planHash || state.receipt.operationKey !== update.impact.operationKey
      || await hashNarrativeValueV1(plan) !== planHash || update.baseContentHash !== state.baseline.contentHash
      || update.impact.nextRevisionVector.semanticRootHash !== state.result.manifest.semanticRootHash) throw Error('[narrative-compile-task] 版本向量或修改影响回执无效')
  } else if (state.baseline && state.result) throw Error('[narrative-compile-task] 增量任务缺少修改影响回执')
  let staleReason: string | null = historicalOnly ? '导入历史副本只可查看，不能恢复原工作区编译' : null
  if (!staleReason) try { await assertSourceCurrent(state) } catch (error) { staleReason = error instanceof Error ? error.message : '来源已失效' }
  return { snapshot: saved.snapshot, checkpoint: state, historicalOnly, staleReason }
}

export async function listNarrativeCompilationTasksV1(scope: WorkspaceScope) {
  return (await readOwnedRows<{ id?: number; contractJson: string; status: string; updatedAt: number }>(scope, 'agentRuns', { owner: 'work' }))
    .filter(row => row.id != null && row.contractJson.includes(OBJECTIVE))
    .sort((a, b) => b.updatedAt - a.updatedAt || b.id! - a.id!)
    .map(row => ({ id: row.id!, status: row.status }))
}

/** Requires a separate author action; neither create nor continue calls this. */
export async function sealNarrativeCompilationTaskV1(input: { scope: WorkspaceScope; runId: number; label: string; parentRevisionId?: number | null }) {
  const request = { ...input, scope: { ...input.scope } }
  const loaded = await readNarrativeCompilationTaskV1(request.scope, request.runId)
  if (loaded.historicalOnly || loaded.staleReason) throw Error(loaded.staleReason ?? '历史副本不可封存')
  if (loaded.snapshot.projection.state !== 'completed' || !loaded.checkpoint.result) throw Error('[narrative-compile-task] 编译尚未完成')
  if (loaded.checkpoint.baseline) {
    const base = request.parentRevisionId == null ? null : await db.worldRevisions.get(request.parentRevisionId)
    if (!base || base.contentHash !== loaded.checkpoint.baseline.contentHash || base.manifestJson !== loaded.checkpoint.baseline.manifestJson
      || base.projectId !== request.scope.projectId || base.worldId !== request.scope.worldId) throw Error('[narrative-compile-task] 冻结父版本与修改影响基准不一致')
    const { planNarrativeReleaseUpdateV1 } = await import('./narrative-incremental')
    const { verifyWorldReleaseContentV4 } = await import('./narrative-release-v4')
    const baseline = await verifyWorldReleaseContentV4({ manifest: base.manifestJson, expectedContentHash: base.contentHash })
    const next = loaded.checkpoint.result.manifest
    const expected = await planNarrativeReleaseUpdateV1(baseline.manifest, next, next.semanticRootHash)
    if (canonicalNarrativeJsonV1(expected) !== canonicalNarrativeJsonV1(loaded.checkpoint.result.update?.impact)) throw Error('[narrative-compile-task:stale] 依赖图已变化，请重新规划')
  }
  return sealPreparedNarrativeWorldRevisionV4({ scope: request.scope, label: request.label, parentRevisionId: request.parentRevisionId,
    includeWorkSources: loaded.checkpoint.includeWorkSources, capturedInput: loaded.checkpoint.input, result: loaded.checkpoint.result })
}

async function finish(run: AgentRunSnapshotV1, state: NarrativeCompilationCheckpointV1, result: NarrativeCompilationResultV1) {
  const { manifestJson: _manifestJson, ...storedResult } = result
  const receipt: NonNullable<NarrativeCompilationCheckpointV1['receipt']> = { schema: 'storyforge.narrative-compilation-receipt', version: 1,
    inputHash: state.inputHash, contentHash: result.contentHash, indexHash: result.index.indexHash, compilerVersion: result.manifest.compilerVersion, modelCalls: 0,
    ...(result.update ? { impactPlanHash: result.update.impact.planHash, operationKey: result.update.impact.operationKey } : {}) }
  const receiptHash = await hashNarrativeValueV1(receipt)
  const completed = { ...state, result: storedResult, receipt, receiptHash }
  return withAgentRunMutationLockV1(run.run.id, () => db.transaction('rw', agentRunScopeTransactionTablesV1(run.run.id, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints), async () => {
    let current = await readVerifiedAgentRunInTransactionV1(state.scope, run.run.id)
    if (current.projection.lastSequence !== run.projection.lastSequence || current.projection.state !== 'running') throw Error('[narrative-compile-task] 编译记录已被另一窗口推进或取消')
    current = (await Dexie.Promise.resolve(createAgentRunCheckpointInTransactionV1({ snapshot: current, resumePayload: completed }))).snapshot
    const event = <T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadByTypeV1[T]) => {
      const next = parseAgentRunEventV1({ version: 1, runId: current.run.id, projectId: current.run.projectId, worldGroupId: current.run.worldGroupId ?? null,
        contractHash: current.run.contractHash, generation: current.run.generation, sequence: current.projection.lastSequence + 1, createdAt: Date.now(), type, payload })
      return Dexie.Promise.resolve(appendAgentRunEventWithSettlementInTransactionV1({ snapshot: current, event: next, scope: state.scope }))
    }
    const attempt = current.projection.steps[STEP].attempt
    current = await event('tool.returned', { stepId: STEP, attempt, toolName: STEP, resultHash: result.contentHash })
    current = await event('step.succeeded', { stepId: STEP, attempt, outputHash: result.contentHash })
    current = await event('verification.started', { verifierSetVersion: state.input.compilerVersion })
    current = await event('verification.accepted', { receiptHash })
    return { snapshot: current, checkpoint: completed }
  }))
}

/** Every retry is an explicit call and is bounded. Resuming a running record
 * after a reload never assumes that its old worker completed. Compilation is
 * pure; only its verified result is resumed, never a prior write transaction. */
export async function continueNarrativeCompilationTaskV1(input: { scope: WorkspaceScope; runId: number; signal?: AbortSignal; onProgress?: (phase: NarrativeCompileProgressV1) => void }) {
  const scope = { ...input.scope }, runId = input.runId
  if (active.has(runId)) throw Error('[narrative-compile-task] 当前窗口已在编译这个任务')
  const loaded = await readNarrativeCompilationTaskV1(scope, runId)
  if (loaded.historicalOnly || loaded.staleReason) throw Error(loaded.staleReason ?? '历史副本不可恢复')
  if (loaded.snapshot.projection.state === 'completed') return loaded
  if (['failed', 'cancelled'].includes(loaded.snapshot.projection.state)) throw Error('[narrative-compile-task] 终态任务不能再次派发')
  let run = loaded.snapshot
  if (run.projection.state === 'running') run = await append(scope, run, 'run.paused', { reason: 'narrative-worker-reload-recovery', recoverable: true })
  if (run.projection.state === 'paused' || run.projection.state === 'recovering') {
    const recovery = await beginAgentRunRecoveryV1({ scope, runId, expectedLastSequence: run.projection.lastSequence })
    run = await completeAgentRunRecoveryV1({ scope, runId, checkpointHash: recovery.checkpointHash, expectedLastSequence: recovery.snapshot.projection.lastSequence })
  }
  const previous = run.projection.steps[STEP]
  if (previous.attempt >= MAX_ATTEMPTS) {
    await append(scope, run, 'budget.exhausted', { resource: 'attempts' })
    throw Error('[narrative-compile-task] 已达到三次显式编译上限，请重新创建任务')
  }
  if (previous.status === 'running') run = await append(scope, run, 'step.failed', { stepId: STEP, attempt: previous.attempt, code: 'narrative-worker-interrupted', retryable: true })
  const attempt = previous.status === 'scheduled' ? 1 : previous.attempt + 1
  run = await append(scope, run, 'step.started', { stepId: STEP, attempt })
  run = await append(scope, run, 'tool.called', { stepId: STEP, attempt, toolName: STEP, callHash: loaded.checkpoint.inputHash })
  const controller = new AbortController(), onAbort = () => controller.abort()
  active.set(runId, controller)
  input.signal?.addEventListener('abort', onAbort, { once: true })
  if (input.signal?.aborted) controller.abort()
  try {
    const result = await compileNarrativeReleaseInWorkerV1(loaded.checkpoint.input, { baseline: loaded.checkpoint.baseline, signal: controller.signal, onProgress: input.onProgress })
    await assertSourceCurrent(loaded.checkpoint)
    if (controller.signal.aborted) throw new DOMException('编译已停止', 'AbortError')
    return await finish(run, loaded.checkpoint, result)
  } catch (error) {
    const current = await readAgentRunV1(scope, runId)
    if (current.projection.state === 'running' && current.projection.lastSequence === run.projection.lastSequence) {
      await append(scope, current, 'run.paused', { reason: error instanceof Error ? error.message.slice(0, 500) : 'narrative-worker-failed', recoverable: true })
    }
    throw error
  } finally { input.signal?.removeEventListener('abort', onAbort); active.delete(runId) }
}

export async function cancelNarrativeCompilationTaskV1(scope: WorkspaceScope, runId: number) {
  const loaded = await readNarrativeCompilationTaskV1(scope, runId)
  if (loaded.historicalOnly) throw Error('[narrative-compile-task] 历史副本不可操作')
  if (['completed', 'failed', 'cancelled'].includes(loaded.snapshot.projection.state)) return loaded.snapshot
  const cancelled = await append(scope, loaded.snapshot, 'run.cancelled', { reason: '作者取消叙事世界编译；未发布' })
  active.get(runId)?.abort()
  return cancelled
}
