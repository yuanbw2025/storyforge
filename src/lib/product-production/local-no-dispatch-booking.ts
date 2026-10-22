/** Read-only historical no-dispatch proof. No native requests, model calls or
 * artifact adoption. Only the scoped command may apply the prepared ledger. */
import { db } from '../db/schema'
import type { ProductProductionCommandV1, WorkspaceScope, AgentRunArtifactRecordV1 } from '../types'
import type { readProductProductionUnreportedFailedAttemptsV1 } from './scheduler'
import { readAgentRunV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { prepareTtrpgOpenContentRevisionSourceV1 } from './artifact-store'
import { parseProductProductionBriefV3 } from './contracts'
import { parseProductProductionPlanV3 } from './plan'
import { canonicalProductProductionJsonV2 as json, hashProductProductionValueV2 as hash, hashProductProductionTaskInputV1 } from './hash'
import { isTtrpgOpenEmptyMediaTaskV3 } from '../ttrpg/open-production-bindings'
import { assertRecordInScope } from '../workspace/scope'

type Command = Extract<ProductProductionCommandV1, { type: 'book-local-no-dispatch' }>
export type LocalNoDispatchBookingViewV1 = Omit<Command, 'type' | 'commandId' | 'ledgerHash' | 'proofs'>
type Attempt = ReturnType<typeof readProductProductionUnreportedFailedAttemptsV1>[number]
const contentKeys = new Set(['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer'])
function fail(message: string): never { throw Error(`[local-no-dispatch] ${message}`) }
function exactKeys(value: unknown, expected: string[]) {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    && json(Object.keys(value).sort()) === json([...expected].sort())
}
function stableAttempt(entry: Attempt) {
  const { runId: _runId, ...stable } = entry
  return stable
}
async function rawRunSet(runIds: number[]) {
  return Promise.all(runIds.map(async id => ({ id, run: await db.agentRuns.get(id),
    events: await db.agentRunEvents.where('runId').equals(id).toArray(),
    checkpoints: await db.agentRunCheckpoints.where('runId').equals(id).toArray() })))
}

export async function inspectProductProductionLocalNoDispatchV1(input: {
  scope: WorkspaceScope; productionId: number; view: LocalNoDispatchBookingViewV1
}) {
  const { scope, view } = input
  if ([scope.projectId, scope.worldId, scope.workId].some(id => !Number.isSafeInteger(id) || id < 1)) fail('必须明确作品、世界和工作区')
  const production = await db.productProductions.get(input.productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'ttrpg' || production.status !== 'paused'
    || production.stateRevision !== view.expectedStateRevision || production.controlEpoch !== view.controlEpoch
    || production.currentBuildNumber !== view.buildNumber) fail('只能核对当前作品明确暂停的制作轮次')
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([input.productionId, view.buildNumber]).first()
  if (!build?.id || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || build.status !== 'paused' || !['building', 'recovery-required'].includes(build.resumeState ?? '')
    || build.releasedProductReleaseId != null || build.controlEpoch !== view.controlEpoch || build.planHash !== view.planHash
    || production.currentBriefRevision !== build.briefRevision) fail('原计划或未发布暂停状态已变化')
  const brief = await db.productProductionBriefs.where('[productionId+revision]').equals([input.productionId, build.briefRevision]).first()
  if (!brief || !await assertRecordInScope(scope, 'productProductionBriefs', brief, { owner: 'work' })
    || brief.status !== 'authorized' || brief.briefHash !== build.briefHash) fail('原授权方案不一致')
  const parsedBrief = parseProductProductionBriefV3(brief.briefJson)
  if (!parsedBrief.ttrpgOpen || await hash(parsedBrief) !== build.briefHash) fail('原跑团方案校验失败')
  const plan = parseProductProductionPlanV3(build.planJson, parsedBrief, build.briefHash)
  if (await hash(plan) !== build.planHash) fail('原冻结计划校验失败')
  // An imported pending Build cannot borrow historical failed Runs as local
  // authority: first prove a current adopted source and its complete producer.
  const anchor = await prepareTtrpgOpenContentRevisionSourceV1({ scope, build: { ...build, id: build.id },
    artifactKey: view.anchor.artifactKey, version: view.anchor.version, contentHash: view.anchor.contentHash })
  const ledger = await import('./scheduler')
  const entries = ledger.readProductProductionUnreportedFailedAttemptsV1(build.budgetLedgerJson)
  if (entries.length > 16) fail('旧未知记录超过本次有界核对容量；保留原记录，不能自动裁剪')
  const candidates = []
  const frozenRunSets: Awaited<ReturnType<typeof rawRunSet>>[] = []
  const artifactRows: AgentRunArtifactRecordV1[] = []
  for (const entry of entries) {
    const row = await db.agentRuns.get(entry.runId)
    if (!row?.id || row.parentRunId == null) fail('旧失败 Run 或父记录缺失')
    const runIds = [...new Set([row.id, row.parentRunId])].sort((a, b) => a - b)
    const before = await rawRunSet(runIds)
    const snapshot = await readAgentRunV1(scope, row.id), root = await readAgentRunV1(scope, row.parentRunId)
    // An explicit retry freezes a new Plan hash/epoch. Historical failures must
    // agree with their own complete root, not the later paused Plan.
    const boundary = snapshot.contract.scope.productProduction, rootBoundary = root.contract.scope.productProduction
    const step = snapshot.projection.steps[entry.taskKey], task = plan.tasks.find(task => task.taskKey === entry.taskKey)
    if (!task || snapshot.run.status !== 'failed' || snapshot.projection.state !== 'failed'
      || snapshot.run.productBuildId !== build.id || snapshot.run.workId !== scope.workId
      || snapshot.run.parentRelation !== `task:${entry.taskKey}` || boundary?.productBuildId !== build.id
      || boundary.buildNumber !== build.buildNumber || boundary.controlEpoch !== entry.controlEpoch
      || boundary.taskKey !== entry.taskKey || entry.controlEpoch >= build.controlEpoch
      || step?.status !== 'failed' || step.attempt !== entry.attempt || step.failureCode !== entry.errorCode
      || snapshot.run.terminalReceiptHash || snapshot.projection.terminalReceiptHash || step.candidateHash
      || root.run.productBuildId !== build.id || root.run.parentRunId != null || root.run.parentRelation != null
      || rootBoundary?.productBuildId !== build.id || rootBoundary.buildNumber !== build.buildNumber
      || rootBoundary.taskKey !== '$root' || rootBoundary.controlEpoch !== entry.controlEpoch
      || rootBoundary.planHash !== boundary.planHash
      || !['failed', 'cancelled', 'completed'].includes(root.run.status)) fail('旧失败尝试与完整 Run/父计划证据不闭合')
    if (snapshot.events.some(event => ['model.requested', 'model.responded', 'tool.called', 'tool.returned',
      'candidate.persisted', 'verification.started', 'verification.accepted'].includes(event.type))) {
      fail('旧 Run 存在发送、响应或候选证据，不能认定未调用供应商')
    }
    const evidence = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded')
    let classification: 'preflight-before-dispatch' | 'empty-media-kernel'
    const bodies: unknown[] = []
    for (const event of evidence) {
      if (event.type !== 'evidence.artifact.recorded' || event.payload.stepId !== entry.taskKey || event.payload.attempt !== entry.attempt
        || !['source-snapshot', 'tool-result'].includes(event.payload.artifactKind)) fail('旧 Run 含其他执行证据，不能认定未发送')
      const text = await readAgentRunArtifactExactV1({ projectId: scope.projectId,
        artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash })
      const artifact = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
        .equals([scope.projectId, event.payload.artifactKind, event.payload.contentHash]).first()
      if (!artifact?.id || new TextEncoder().encode(text).byteLength !== event.payload.byteLength) fail('旧执行证据缺失或字节不一致')
      artifactRows.push(artifact)
      bodies.push(JSON.parse(text))
    }
    if (entry.errorCode === 'task-preflight-failed' && contentKeys.has(entry.taskKey) && task.executionMode === 'model') {
      const bindings = snapshot.contract.executionBindings ?? []
      if (evidence.length !== 0 || bindings.length !== 1 || bindings[0].skillId !== task.skillId
        || bindings[0].stepId !== task.taskKey) fail('旧预检岗位或执行资料需单独核对，不能猜测未发送')
      classification = 'preflight-before-dispatch'
    } else if (entry.errorCode === 'task-executor-failed' && isTtrpgOpenEmptyMediaTaskV3(task)) {
      if (snapshot.contract.budget.maxModelCalls !== 0 || snapshot.contract.budget.maxInputTokens !== 0
        || snapshot.contract.budget.maxOutputTokens !== 0 || snapshot.contract.budget.maxToolCalls !== 1
        || snapshot.contract.permissions.contextSourceKeys.length !== 0
        || snapshot.contract.permissions.writeTargets.length !== 0 || (snapshot.contract.executionBindings ?? []).length !== 0
        || snapshot.events.some(event => event.type === 'context.assembled')
        || json(evidence.map(event => event.type === 'evidence.artifact.recorded' ? event.payload.artifactKind : null)) !== json(['source-snapshot', 'tool-result'])
        || bodies.length !== 2) fail('旧本地校验没有准确零模型合同')
      const structural = bodies[0] as {
        schema: string; version: number; modelContext: unknown; planHash: string; structuralInput: Record<string, unknown>
      } | undefined
      const failure = bodies[1] as {
        schema: string; version: number; taskKey: string; detail: string
      } | undefined
      if (!structural || !exactKeys(structural, ['schema', 'version', 'modelContext', 'planHash', 'structuralInput'])
        || structural.schema !== 'storyforge.ttrpg-open-empty-media-kernel-input' || structural.version !== 1
        || !exactKeys(structural.structuralInput, ['planHash', 'taskKey', 'controlEpoch', 'dependencies', 'artifacts', 'executionIdentityHash', 'capabilityBindings', 'authorResolution'])
        || structural.modelContext !== null || structural.planHash !== boundary.planHash
        || structural.structuralInput.taskKey !== entry.taskKey || structural.structuralInput.controlEpoch !== entry.controlEpoch
        || structural.structuralInput.planHash !== boundary.planHash || structural.structuralInput.authorResolution !== null
        || json(structural.structuralInput.capabilityBindings) !== '[]'
        || structural.structuralInput.executionIdentityHash !== await ledger.productProductionTaskExecutionIdentityHashV1(task)
        || await hashProductProductionTaskInputV1({ structuralInput: structural.structuralInput, sourcePlanHash: null,
          confirmedBriefHash: null, contextPacketHash: null, creatorDerivedAuthorizationHash: null }) !== entry.idempotencyKey
        || !failure || !exactKeys(failure, ['schema', 'version', 'taskKey', 'detail'])
        || failure.schema !== 'storyforge.product-task-failure' || failure.version !== 1 || failure.taskKey !== entry.taskKey
        || typeof failure.detail !== 'string' || !failure.detail) fail('旧本地输入或失败证明不一致')
      classification = 'empty-media-kernel'
    } else fail('旧记录不能确证为未发送预检或零模型本地校验，保留原未知用量')
    const started = snapshot.events.filter(event => event.type === 'step.started'
      && event.payload.stepId === entry.taskKey && event.payload.attempt === entry.attempt)
    const failed = snapshot.events.filter(event => event.type === 'step.failed'
      && event.payload.stepId === entry.taskKey && event.payload.attempt === entry.attempt)
    if (started.length !== 1 || failed.length !== 1 || failed[0].sequence <= started[0].sequence) fail('原尝试时间与终态不唯一')
    const durationMs = failed[0].createdAt - started[0].createdAt
    if (!Number.isSafeInteger(durationMs) || durationMs < 0) fail('原事件时钟不一致，不能推断本地时长')
    const original = stableAttempt(entry), attemptKeyHash = await hash(original)
    const proof = { schema: 'storyforge.product-production-no-dispatch-proof', version: 1, classification,
      original, anchor: { ...view.anchor, proofHash: anchor.proofHash },
      run: { contractHash: snapshot.run.contractHash, projectionHash: snapshot.run.projectionHash,
        generation: snapshot.run.generation, lastSequence: snapshot.run.lastSequence, planHash: boundary.planHash,
        rootContractHash: root.run.contractHash, rootProjectionHash: root.run.projectionHash },
      evidence: evidence.map(event => event.type === 'evidence.artifact.recorded'
        ? { artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash, byteLength: event.payload.byteLength } : null),
      durationMs, observedModelCalls: 0, observedToolCalls: 0 }
    candidates.push({ original, attemptKeyHash, proofHash: await hash(proof), proof, entry, durationMs })
    frozenRunSets.push(before)
  }
  if (new Set(candidates.map(value => value.attemptKeyHash)).size !== candidates.length) fail('旧尝试稳定身份不唯一，不能猜测归属')
  const assertCurrent = async () => {
    await anchor.assertCurrent()
    if (json(await db.productProductions.get(production.id!)) !== json(production)
      || json(await db.productBuilds.get(build.id!)) !== json(build)
      || json(await db.productProductionBriefs.get(brief.id!)) !== json(brief)) fail('原制作、方案或账本读取后已变化')
    for (const before of frozenRunSets) if (json(await rawRunSet(before.map(value => value.id))) !== json(before)) fail('旧 Run/事件/检查点读取后已变化')
    for (const row of artifactRows) if (json(await db.agentRunArtifacts.get(row.id!)) !== json(row)) fail('旧执行资料读取后已变化')
  }
  await assertCurrent()
  return { production, build, candidates, ledgerHash: await hash(build.budgetLedgerJson), assertCurrent }
}

export async function prepareProductProductionLocalNoDispatchBookingV1(input: {
  scope: WorkspaceScope; productionId: number; command: Command
}) {
  const inspected = await inspectProductProductionLocalNoDispatchV1({ ...input, view: input.command })
  const proofs = inspected.candidates.map(value => ({ attemptKeyHash: value.attemptKeyHash, proofHash: value.proofHash }))
  if (input.command.ledgerHash !== inspected.ledgerHash || json(input.command.proofs) !== json(proofs) || proofs.length === 0) fail('必须明确核对准确原账本和全部未发送证明')
  const { bookProductProductionVerifiedNoDispatchLedgerV1 } = await import('./scheduler')
  const budgetLedgerJson = bookProductProductionVerifiedNoDispatchLedgerV1({ budgetLedgerJson: inspected.build.budgetLedgerJson,
    verified: inspected.candidates.map(value => ({ original: value.entry, durationMs: value.durationMs })) })
  return { ...inspected, budgetLedgerJson, accounting: {
    schema: 'storyforge.product-production-local-no-dispatch-accounting', version: 1,
    originalLedgerHash: inspected.ledgerHash, resultingLedgerHash: await hash(budgetLedgerJson),
    entries: inspected.candidates.map(value => ({ original: value.original, proof: value.proof, proofHash: value.proofHash,
      resolution: 'system-released-before-dispatch', usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0,
        mediaCalls: 0, costUsd: 0, durationMs: value.durationMs, storageBytes: 0 } })),
    newModelCalls: 0, candidateCreated: false, adopted: false,
  } }
}
