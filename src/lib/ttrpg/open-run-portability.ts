import { assertAgentRunArtifactRecordIntegrityV1 } from '../memory/artifact-record'
import Dexie from 'dexie'
/** Export-frozen historical runtime evidence. This proves provenance, never current dispatch/adoption authority. */
import { db } from '../db/schema'
import type { AgentRunContract, AnyAgentRunEventV1 } from '../types'
import { parseAgentRunContract } from '../agent/run/contract'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import { replayAgentRunEventsV1 } from '../agent/run/projection'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { readAgentRunArtifactExactV1, AgentRunArtifactStoreError } from '../memory/artifact-store'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { assertTtrpgOpenFrozenContextSourcesV1, ttrpgOpenModelPurposeForSkillV1 } from './open-model-purpose-contract'
import * as p from './open-contract-parse'
import type { WorkspaceScope } from '../types'
import type { TtrpgOpenAgentEvidenceV1 } from './open-model-call-evidence'
import { assertInstanceBinding } from '../product/runtime-instances'
import { verifyContextManifestIntegrityV2 } from '../agent/run/context-manifest'
import type { TtrpgOpenInputEvidenceV1 } from './open-input-evidence'
import { TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1, readTtrpgOpenPublicSituationObjectiveV1 } from './open-public-situation-authorization-contract'

interface TtrpgOpenRunOriginBaseV1 {
  schema: 'storyforge.ttrpg-open-run-origin'
  sourceRunId: number; sourceProjectId: number; sourceSessionId: number; sessionKey: string
  workspaceUid: string; worldCode: string; workCode: string
  contractJson: string; contractHash: string; events: AnyAgentRunEventV1[]; originHash: string
}
export type TtrpgOpenRunOriginV1 = TtrpgOpenRunOriginBaseV1 & (
  { version: 1 } | { version: 2; phase: 'public-request-preparation' } | { version: 3; phase: 'voice-intent-only' })
function hash(value: unknown): Promise<string> {
  const pending = hashCanonicalValue(value)
  return Dexie.currentTransaction ? Dexie.waitFor(pending) : pending
}
function fail(message: string): never { throw new Error(`[ttrpg-run-portability] ${message}`) }

/** Closed, zero-model human intent. This is not an executable voice profile. */
function isVoiceIntentContract(contract: AgentRunContract): boolean {
  return contract.version === 1 && contract.objective.startsWith('ttrpg.open.voice-intent:') && contract.objective.length > 'ttrpg.open.voice-intent:'.length
    && !!contract.scope.runtime && contract.scope.worldGroupId == null && !contract.scope.chapterIds?.length && !contract.scope.outlineNodeIds?.length
    && !contract.scope.productProduction && !contract.ownership && !contract.lineage && !contract.executionBindings
    && !!contract.runtimeBindingHash && !contract.permissions.contextSourceKeys.length && !contract.permissions.writeTargets.length
    && contract.budget.maxModelCalls === 0 && contract.budget.maxToolCalls === 1 && contract.budget.maxInputTokens === 0
    && contract.budget.maxOutputTokens === 0 && contract.budget.maxAttemptsPerStep === 1
}

/** Only the two owner locators of a closed TTRPG runtime contract may change. */
function semanticContract(contract: AgentRunContract) {
  if (isVoiceIntentContract(contract)) return { ...contract, scope: { ...contract.scope, projectId: 1, runtime: { ...contract.scope.runtime!, productRuntimeSessionId: 1 } } }
  if (contract.version !== 3 || contract.executionBoundary !== 'product-runtime' || !contract.scope.runtime
    || contract.scope.worldGroupId != null || contract.scope.chapterIds?.length || contract.scope.outlineNodeIds?.length
    || contract.scope.productProduction || contract.ownership || contract.lineage || contract.executionBindings?.length !== 1
    || contract.permissions.writeTargets.length) fail('原始证据仅支持闭集实例运行契约')
  const binding = contract.executionBindings[0], purpose = ttrpgOpenModelPurposeForSkillV1(binding.skillId)
  if (binding.version !== 2 || binding.stepId !== purpose.stepId || !binding.formalEntry) fail('原始证据缺少准确冻结 Skill/正式入口')
  assertTtrpgOpenFrozenContextSourcesV1(binding.skillId, contract.permissions.contextSourceKeys)
  return { ...contract, scope: { ...contract.scope, projectId: 1, runtime: { ...contract.scope.runtime, productRuntimeSessionId: 1 } } }
}
function semanticEvent(event: AnyAgentRunEventV1) {
  if (event.generation !== 1 || event.type === 'contract.revised') fail('原始运行证据不支持重写契约代际')
  const payload = event.type === 'contract.accepted' ? { ...event.payload,
    contractJson: canonicalStringify(semanticContract(parseAgentRunContract(JSON.parse(event.payload.contractJson!)))) } : event.payload
  return { sequence: event.sequence, generation: event.generation, type: event.type, payload, createdAt: event.createdAt,
    worldGroupId: event.worldGroupId }
}
async function assertHistoricalInputIdentity(content: string, origin: TtrpgOpenRunOriginV1) {
  let value: Partial<TtrpgOpenInputEvidenceV1>
  try { value = JSON.parse(content) } catch { return }
  if (!value || value.schema !== 'storyforge.ttrpg-open-input-evidence') return
  const manifest = value.manifest, preflight = value.preflight
  const integrity = verifyContextManifestIntegrityV2(manifest)
  if (!await (Dexie.currentTransaction ? Dexie.waitFor(integrity) : integrity) || !manifest || !preflight
    || manifest.runId !== origin.sourceRunId || manifest.scope.projectId !== origin.sourceProjectId
    || manifest.scope.workspaceUid !== origin.workspaceUid || manifest.scope.worldCode !== origin.worldCode || manifest.scope.workCode !== origin.workCode
    || preflight.runId !== origin.sourceRunId || preflight.stepId !== manifest.stepId || preflight.attempt !== manifest.attempt
    || !origin.events.some(event => event.type === 'model.requested' && event.payload.stepId === preflight.stepId
      && event.payload.attempt === preflight.attempt && event.payload.bindingHash === preflight.promptHash)) fail('原始输入与来源身份不一致')
}

export async function parseTtrpgOpenRunOriginV1(json: string): Promise<TtrpgOpenRunOriginV1> {
  if (typeof json !== 'string' || json.length > 8_000_000) fail('原始证据超过单记录预算')
  const value = p.object(JSON.parse(json), 'runtime origin')
  if (value.version !== 1 && value.version !== 2 && value.version !== 3) fail('原始证据版本不受支持')
  const row = p.record(value, ['schema','version','sourceRunId','sourceProjectId','sourceSessionId','sessionKey',
    'workspaceUid','worldCode','workCode','contractJson','contractHash','events','originHash', ...(value.version !== 1 ? ['phase'] : [])], 'runtime origin')
  const sourceRunId = p.integer(row.sourceRunId, 'origin run', 1, Number.MAX_SAFE_INTEGER)
  const sourceProjectId = p.integer(row.sourceProjectId, 'origin project', 1, Number.MAX_SAFE_INTEGER)
  const sourceSessionId = p.integer(row.sourceSessionId, 'origin session', 1, Number.MAX_SAFE_INTEGER)
  const contractJson = p.text(row.contractJson, 'origin contract', 2_000_000), contract = parseAgentRunContract(JSON.parse(contractJson))
  semanticContract(contract)
  const events = p.list(row.events, 'origin events', value => parseAgentRunEventV1(value), 10000, 1)
  const contractHash = p.hash(row.contractHash, 'origin contract hash')
  if (await hash(contract) !== contractHash || contract.scope.projectId !== sourceProjectId
    || contract.scope.runtime!.productRuntimeSessionId !== sourceSessionId
    || events.some(event => event.runId !== sourceRunId || event.projectId !== sourceProjectId || event.contractHash !== contractHash)) fail('原始契约、身份与事件不一致')
  const projection = replayAgentRunEventsV1(events)
  if (projection.errors.length || projection.state === 'recovery_required') fail('原始事件不能严格重放')
  if (row.version === 1 && !events.some(event => event.type === 'model.requested')) fail('原始事件不能严格重放为真实请求')
  if (row.version === 2 && (contract.executionBindings?.[0].skillId !== TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1
    || !readTtrpgOpenPublicSituationObjectiveV1(contract.objective) || contract.budget.maxModelCalls !== 1
    || contract.budget.maxToolCalls !== 0 || contract.budget.maxAttemptsPerStep !== 1)) fail('准备阶段封存只允许准确的共同局势原 Run，不能假冒已发生请求')
  if (row.version === 3 && (!isVoiceIntentContract(contract) || events.some(e => e.type === 'model.requested' || e.type === 'model.responded' || e.type === 'tool.called' || e.type === 'tool.returned'))) fail('配音意图封存不允许模型执行或伪造已发送状态')
  if (row.version !== 3 && isVoiceIntentContract(contract)) fail('零模型配音意图必须保留独立的只读归档阶段')
  const generation = row.version === 1 ? { version: 1 as const } : row.version === 3 ? { version: 3 as const,
    phase: p.literal(row.phase, 'voice-intent-only', 'origin voice phase') } : { version: 2 as const,
    phase: p.literal(row.phase, 'public-request-preparation', 'origin preparation phase') }
  const result: TtrpgOpenRunOriginV1 = { schema: p.literal(row.schema, 'storyforge.ttrpg-open-run-origin', 'origin schema'),
    ...generation, sourceRunId, sourceProjectId, sourceSessionId,
    sessionKey: p.key(row.sessionKey, 'origin session key'), workspaceUid: p.text(row.workspaceUid, 'origin workspace UID', 512),
    worldCode: p.text(row.worldCode, 'origin world code', 512), workCode: p.text(row.workCode, 'origin work code', 512),
    contractJson, contractHash, events, originHash: p.hash(row.originHash, 'origin hash') }
  const { originHash, ...body } = result
  if (await hash(body) !== originHash) fail('原始证据 hash 不一致')
  return result
}

/** Validates the complete old event prefix and retained bytes against the actual current owner. */
export async function readTtrpgOpenRunOriginV1(runId: number, mode: 'archive' | 'recovery' = 'recovery'): Promise<TtrpgOpenRunOriginV1 | null> {
  const row = await db.agentRuns.get(runId)
  if (!row?.portableRuntimeOriginJson) return null
  if (row.productRuntimeSessionId == null || row.workId != null) fail('运行来源不能借用其他 owner')
  const origin = await parseTtrpgOpenRunOriginV1(row.portableRuntimeOriginJson)
  if (origin.version !== 1 && mode !== 'archive') fail('导入的准备记录仅供审计，不是可恢复派发的模型请求')
  const session = await db.productRuntimeSessions.get(row.productRuntimeSessionId)
  if (!session || session.kind !== 'ttrpg' || session.worldId == null || session.workId == null) fail('实际跑团实例不存在')
  const scope = { projectId: row.projectId, worldId: session.worldId, workId: session.workId }
  const [project, world, work] = await Promise.all([db.projects.get(scope.projectId), db.worlds.get(scope.worldId), db.works.get(scope.workId)])
  const runtime = parseTtrpgRuntimeStateV2(JSON.parse(session.initialStateJson).ttrpg)
  if (session.projectId !== row.projectId || runtime?.sessionKey !== origin.sessionKey || !project?.workspaceUid
    || world?.projectId !== row.projectId || work?.worldId !== session.worldId
    || world?.code !== origin.worldCode || work?.code !== origin.workCode) fail('原始证据与实际稳定身份不一致')
  // A cloned workspace intentionally receives a fresh UID on collision. The old UID stays provenance only.
  const snapshot = await readInstanceAgentRunV1(scope, runId)
  if (canonicalStringify(semanticContract(snapshot.contract)) !== canonicalStringify(semanticContract(parseAgentRunContract(JSON.parse(origin.contractJson))))) fail('重绑定改变了本地主键之外的契约内容')
  for (const event of origin.events) {
    const current = snapshot.events[event.sequence - 1]
    if (!current || canonicalStringify(semanticEvent(current)) !== canonicalStringify(semanticEvent(event))) fail('重绑定后的实际账本不含原始事件前缀')
    if (event.type !== 'evidence.artifact.recorded') continue
    const artifact = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([row.projectId, event.payload.artifactKind, event.payload.contentHash]).first()
    if (mode === 'archive' && artifact?.retentionState === 'evidence-pruned') {
      const integrity = assertAgentRunArtifactRecordIntegrityV1(artifact)
      await (Dexie.currentTransaction ? Dexie.waitFor(integrity) : integrity)
      if (artifact.byteLength !== event.payload.byteLength) fail('原始裁剪工件的字节回执不一致')
      continue
    }
    const content = await readAgentRunArtifactExactV1({ projectId: row.projectId, artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash })
    if (new TextEncoder().encode(content).byteLength !== event.payload.byteLength) fail('原始工件字节回执不一致')
    if (event.payload.artifactKind === 'source-snapshot') await assertHistoricalInputIdentity(content, origin)
  }
  return origin
}

/** Export owner freezes real evidence before physical IDs are remapped. Old backups remain read-only when absent. */
export async function freezeTtrpgOpenRunOriginForExportV1(runId: number, expected?: { contractHash: string; lastSequence: number }): Promise<string | undefined> {
  const row = await db.agentRuns.get(runId)
  if (!row) fail('实际导出 Run 不存在')
  if (expected && (row.contractHash !== expected.contractHash || row.lastSequence !== expected.lastSequence)) fail('导出期间 Run 已变化，请重新导出')
  if (row.portableRuntimeOriginJson) { await readTtrpgOpenRunOriginV1(runId, 'archive'); return row.portableRuntimeOriginJson }
  if (row.productRuntimeSessionId == null) return undefined
  const session = await db.productRuntimeSessions.get(row.productRuntimeSessionId)
  if (!session || session.kind !== 'ttrpg' || session.worldId == null || session.workId == null) return undefined
  const state = (await import('../product/runtime-core')).readProductRuntimeState
  const runtime = parseTtrpgRuntimeStateV2((await state(session.id!)).ttrpg)
  const calls = runtime?.openRun?.coordination.calls.filter(call => call.runContractHash === row.contractHash) ?? []
  // Preserve the old no-call export boundary for every unrelated/legacy runtime Run.
  const declared = JSON.parse(row.contractJson) as AgentRunContract
  const declaresPublicPreparation = row.contractVersion === 3 && declared.executionBindings?.length === 1
    && declared.executionBindings[0].skillId === TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1
  if (isVoiceIntentContract(declared)) {
    const scope = { projectId: row.projectId, worldId: session.worldId, workId: session.workId }
    const snapshot = await readInstanceAgentRunV1(scope, runId)
    if (expected && (snapshot.run.contractHash !== expected.contractHash || snapshot.run.lastSequence !== expected.lastSequence)) fail('导出期间配音意图已变化')
    const [project, world, work] = await Promise.all([db.projects.get(scope.projectId), db.worlds.get(scope.worldId), db.works.get(scope.workId)])
    if (!runtime || !project?.workspaceUid || !world?.code || !work?.code) fail('配音意图缺少原稳定身份')
    const body = { schema: 'storyforge.ttrpg-open-run-origin' as const, version: 3 as const, phase: 'voice-intent-only' as const,
      sourceRunId: runId, sourceProjectId: row.projectId, sourceSessionId: session.id!, sessionKey: runtime.sessionKey,
      workspaceUid: project.workspaceUid, worldCode: world.code, workCode: work.code,
      contractJson: snapshot.run.contractJson, contractHash: snapshot.run.contractHash, events: snapshot.events }
    const json = canonicalStringify({ ...body, originHash: await hash(body) })
    await parseTtrpgOpenRunOriginV1(json)
    return json
  }
  if (!calls.length && !declaresPublicPreparation) return undefined
  const scope = { projectId: row.projectId, worldId: session.worldId, workId: session.workId }
  const snapshot = await readInstanceAgentRunV1(scope, runId)
  if (expected && (snapshot.run.contractHash !== expected.contractHash || snapshot.run.lastSequence !== expected.lastSequence)) fail('导出期间 Run 已变化，请重新导出')
  // Valid older runtime ledgers remain exportable without receiving a newly invented origin.
  if (snapshot.contract.version !== 3 || snapshot.contract.executionBindings?.length !== 1
    || snapshot.contract.executionBindings[0].version !== 2 || !snapshot.contract.executionBindings[0].formalEntry) return undefined
  const publicRun = snapshot.contract.executionBindings[0].skillId === TTRPG_OPEN_PUBLIC_SITUATION_SKILL_V1
  if (!calls.length && !publicRun) return undefined
  // Same contracts can occur in failed/retried preparations: only exact recorded request/Manifest selects this Run.
  const verified = []
  const { verifyTtrpgOpenModelCallEvidenceV1, readTtrpgOpenModelCallRunsV1 } = await import('./open-model-call-evidence')
  const owners = await readTtrpgOpenModelCallRunsV1({ scope, sessionId: session.id!, calls })
  const ownsCall = owners.some(owner => owner.id === runId)
  if (!ownsCall && !publicRun) return undefined
  for (const call of ownsCall ? calls : []) {
    if (!snapshot.events.some(event => event.type === 'model.requested' && event.payload.bindingHash === call.requestHash)) continue
    try { await verifyTtrpgOpenModelCallEvidenceV1({ scope, sessionId: session.id!, runId, call, mode: 'finish' }) }
    catch (error) {
      if (error instanceof AgentRunArtifactStoreError && error.code === 'evidence-pruned') return undefined
      throw error
    }
    verified.push(call)
  }
  if (!verified.length && !publicRun) return undefined
  semanticContract(snapshot.contract)
  const [project, world, work] = await Promise.all([db.projects.get(scope.projectId), db.worlds.get(scope.worldId), db.works.get(scope.workId)])
  if (!project?.workspaceUid || !world?.code || !work?.code) fail('导出原始证据缺少稳定工作区身份')
  const generation = verified.length ? { version: 1 as const } : { version: 2 as const, phase: 'public-request-preparation' as const }
  const body = { schema: 'storyforge.ttrpg-open-run-origin' as const, ...generation,
    sourceRunId: runId, sourceProjectId: row.projectId, sourceSessionId: session.id!, sessionKey: runtime!.sessionKey,
    workspaceUid: project.workspaceUid, worldCode: world.code, workCode: work.code,
    contractJson: snapshot.run.contractJson, contractHash: snapshot.run.contractHash, events: snapshot.events }
  const json = canonicalStringify({ ...body, originHash: await hash(body) })
  await parseTtrpgOpenRunOriginV1(json)
  return json
}

/** Exact historical owner lookup for recovery diagnostics/cancellation; MUST NOT authorize sending or adopting. */
export async function readTtrpgOpenImportedCallOwnerV1(input: { scope: WorkspaceScope; sessionId: number; requestKey: string; runId?: number }) {
  await assertInstanceBinding(input.sessionId, input.scope)
  const { readProductRuntimeState } = await import('../product/runtime-core')
  const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(input.sessionId)).ttrpg)
  const call = runtime?.openRun?.coordination.calls.find(call => call.requestKey === input.requestKey)
  if (!call) fail('原请求不属于此运行实例')
  const rows = await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).toArray()
  const matches: Array<{ runId: number; origin: TtrpgOpenRunOriginV1; evidence: TtrpgOpenAgentEvidenceV1 }> = []
  for (const row of rows) {
    if (row.id == null || !row.portableRuntimeOriginJson || input.runId !== undefined && row.id !== input.runId) continue
    const origin = await parseTtrpgOpenRunOriginV1(row.portableRuntimeOriginJson)
    if (origin.version !== 1) continue // A pre-reservation Run never proves a model call, even with coincident IDs/hashes.
    if (origin.sessionKey !== call.createdRef.sessionKey || origin.contractHash !== call.runContractHash
      || !origin.events.some(event => event.type === 'model.requested' && event.payload.stepId === call.stepId
        && event.payload.attempt === call.attempt && event.payload.bindingHash === call.requestHash)) continue
    await readTtrpgOpenRunOriginV1(row.id)
    const refs = origin.events.filter((event): event is Extract<AnyAgentRunEventV1, { type: 'evidence.artifact.recorded' }> => event.type === 'evidence.artifact.recorded')
    let exactInput = false
    for (const ref of refs) {
      if (ref.payload.artifactKind !== 'source-snapshot' || ref.payload.stepId !== call.stepId || ref.payload.attempt !== call.attempt) continue
      const body = JSON.parse(await readAgentRunArtifactExactV1({ projectId: row.projectId, artifactKind: 'source-snapshot', contentHash: ref.payload.contentHash })) as Partial<TtrpgOpenInputEvidenceV1>
      if (body.schema !== 'storyforge.ttrpg-open-input-evidence' || body.manifest?.manifestHash !== call.inputManifestHash) continue
      const integrity = verifyContextManifestIntegrityV2(body.manifest)
      if (!await (Dexie.currentTransaction ? Dexie.waitFor(integrity) : integrity) || body.manifest.runId !== origin.sourceRunId
        || body.manifest.scope.projectId !== origin.sourceProjectId || body.manifest.scope.workspaceUid !== origin.workspaceUid
        || body.manifest.scope.worldCode !== origin.worldCode || body.manifest.scope.workCode !== origin.workCode
        || body.preflight?.promptHash !== call.requestHash || body.preflight.runId !== origin.sourceRunId
        || body.preflight.stepId !== call.stepId || body.preflight.attempt !== call.attempt) fail('原始输入不能准确绑定此请求')
      exactInput = true
    }
    if (!exactInput) continue
    const snapshot = await readInstanceAgentRunV1(input.scope, row.id)
    const artifacts: TtrpgOpenAgentEvidenceV1['artifacts'] = []
    for (const ref of refs) {
      const artifact = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([row.projectId, ref.payload.artifactKind, ref.payload.contentHash]).first()
      if (!artifact || artifact.retentionState !== 'available') fail('原始工件在读取期间已变化')
      if (!artifacts.some(previous => previous.id === artifact.id)) artifacts.push(artifact)
    }
    matches.push({ runId: row.id, origin, evidence: { run: snapshot.run, events: await db.agentRunEvents.where('runId').equals(row.id).sortBy('sequence'), artifacts } })
  }
  if (matches.length > 1) fail('原请求匹配了多份原始账本，必须先核对')
  return matches[0] ?? null
}
