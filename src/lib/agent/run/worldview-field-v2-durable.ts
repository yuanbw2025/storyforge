import Dexie from 'dexie'
import { db } from '../../db/schema'
import { useAIConfigStore } from '../../../stores/ai-config'
import { usePromptStore } from '../../../stores/prompt'
import { worldviewContentTemplateVariablesV1 } from '../../creation/worldview-content-skill'
import { renderPrompt } from '../../ai/prompt-engine'
import { estimateTokens } from '../../ai/context-budget'
import { resolveRequestConfig, freezeAIRequestAssessmentContextV2, prepareAIRequestV2,
  readPreparedRequestFrameV2, readPreparedNativeRequestRefV2, bindPreparedRequestObserversV2,
  type AIRequestConfigResolution, type PublicAIResponseV2, type ChatResult } from '../../ai/client'
import { readBoundCodexReceiptV1, acknowledgeBoundCodexReceiptV1 } from '../../ai/codex-transport'
import { worldviewFieldCaptureTransactionTablesV2 } from '../../registry/context-sources'
import { captureRegisteredContextSourceV2, assembleCapturedWorldviewContextV2 } from '../../registry/assemble-context'
import { adoptRestoredWorldviewFieldCandidateV2, parseWorldviewFieldCandidateDraftV2,
  resolveWorldviewAgentFieldV1, resolveWorldviewFieldModeV1,
  worldviewFieldCandidateIssuesV1, worldviewFieldHardSystemV2, worldviewFieldCandidateMatchesRowV1,
  type WorldviewFieldCopilotSnapshot } from '../worldview-field-copilot'
import { WORLDVIEW_GENERATABLE_FIELD_SPECS } from '../../registry/field-registry'
import { appendAgentEvent } from '../conversations'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentSkillExecutionBindingV2, assertAgentSkillExecutionBindingIntegrityV2 } from '../execution-binding'
import { freezeFormalAIEntryBindingV1, executeFrozenFormalAIEntryV1 } from '../formal-ai-entry'
import { createContextAccessPolicyForExecutionV2 } from '../../context-gateway/skill-policy'
import { readOwnedRows } from '../../workspace/scope'
import { adoptionTransactionTablesV1 } from '../../registry/adopt'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../../memory/artifact-store'
import { sha256Text } from '../../ai/chapter-memory/text-normalization'
import { observeAuthorLengthV1, planAuthorLengthRevisionV1, authorLengthRevisionInstructionV1 } from '../../ai/author-length-revision'
import { describeTaskLengthPlanV1 } from '../../ai/author-length-intent'
import { WORLDVIEW_FIELD_SKILL_V2, WORLDVIEW_FIELD_ENTRY_V2, WORLDVIEW_FULL_SOURCE_KEYS_V2,
  parseWorldviewFieldTaskV2, parseWorldviewExactRefV2, assertWorldviewRootV2, assertWorldviewExactKeysV2,
  worldviewTargetTextV2, resolveWorldviewLengthPlanV2,
  type WorldviewFieldRootV2, type WorldviewFieldPlanV2, type WorldviewFieldRoundV2,
  type WorldviewFieldCandidateMetadataV2, type WorldviewExactRefV2 } from '../worldview-field-v2-contract'
import type { MasterAgentPlan, MasterCandidatePayload } from '../orchestrator'
import type { RunDurableMasterAgentInputV1, MasterAgentDurableCandidateV1 } from './master-durable'
import type { MasterAgentCandidateAdoptionRefV1, MasterAgentCandidateAdoptionResultV1 } from './master-adoption'
import type { MasterAgentVerificationResultV1 } from './master-verification'
import type { WorkspaceScope, AgentEvent, ChatMessage, Worldview } from '../../types'
import type { TaskLengthPlanV1, ContextMaterialAllocationV2, AgentRunEventTypeV1, AgentRunEventPayloadByTypeV1 } from '../../types/agent-run'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, reviseAgentRunContractV1,
  withAgentRunMutationLockV1, agentRunScopeTransactionTablesV1, readVerifiedAgentRunInTransactionV1,
  appendPrivilegedAgentRunEventInTransactionV1, type AgentRunSnapshotV1 } from './event-store'
import { parseAgentRunEventV1 } from './event-schema'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import { createVerificationReceiptV1 } from './verification-receipt'
import { canonicalStringify, hashCanonicalValue } from './hash'

const CATEGORY = 'agent.world-origin.worldview-field.v2'
const VERIFIER = 'worldview-field-terminal-v2'
interface StateV2 {
  version: 'worldview-field-state-v2'
  rootRef: WorldviewExactRefV2
  planRef: WorldviewExactRefV2
  frameRef: WorldviewExactRefV2
  wireRef: WorldviewExactRefV2
  roundRefs: WorldviewExactRefV2[]
  pendingStateRef: WorldviewExactRefV2 | null
  callRef: WorldviewExactRefV2 | null
}
interface RawV2 {
  version: 'worldview-field-response-v2'
  runId: number; generation: number; contractHash: string
  rootHash: string; planHash: string; callId: string; frameHash: string
  nativeRequest: ReturnType<typeof readPreparedNativeRequestRefV2>
  response: PublicAIResponseV2
  rawTextHash: string
}
export interface WorldviewTaskBudgetEvidenceV2 {
  version: 'worldview-field-budget-evidence-v2'
  calls: number
  observedInputTokens: number | null
  observedOutputTokens: number | null
  allocation: import('../../types/agent-run').RunBudgetAllocationV2
}
export type WorldviewMasterResultV2 = {
  runId: number; resumed: boolean; plan: MasterAgentPlan; candidates: MasterAgentDurableCandidateV1[]
  budgetEvidence: WorldviewTaskBudgetEvidenceV2; projection: AgentRunSnapshotV1['projection']
}
export interface WorldviewMasterInputV2 extends RunDurableMasterAgentInputV1 {
  onLengthPlan?: (plan: TaskLengthPlanV1) => void
  onLengthProgress?: (progress: { rounds: number; words: number; status: string }) => void
}
function stepId(root: WorldviewFieldRootV2) { return `master:${root.task.id}` }
export function isWorldviewFieldRunV2(snapshot: AgentRunSnapshotV1): snapshot is AgentRunSnapshotV1 & {contract:import('../../types/agent-run').AgentRunContractV3} {
  return snapshot.contract.version === 3 && snapshot.contract.executionBindings.length === 1
    && snapshot.contract.executionBindings[0].skillId === WORLDVIEW_FIELD_SKILL_V2
    && snapshot.contract.verificationPlan.some(item => item.verifier === VERIFIER)
}
export function isWorldviewFieldPlanV2(plan: MasterAgentPlan | undefined): boolean {
  return !!plan?.tasks.some(task => task.skillId === WORLDVIEW_FIELD_SKILL_V2)
}
/** One product execution cursor over existing Run/artifact/checkpoint services.
 * On any write failure it seals; no inferred sequence or hidden reread/retry. */
class CursorV2 {
  stopped = false
  constructor(readonly scope: WorkspaceScope, public snapshot: AgentRunSnapshotV1) {}
  async write<T>(operation: (snapshot: AgentRunSnapshotV1) => Promise<{ snapshot: AgentRunSnapshotV1; value: T }>): Promise<T> {
    if (this.stopped) throw new Error('世界基座证据保存已停止，请显式回读原运行。')
    try {
      const saved = await operation(this.snapshot)
      if (saved.snapshot.run.id !== this.snapshot.run.id || saved.snapshot.projection.lastSequence < this.snapshot.projection.lastSequence) throw new Error('证据写入前缀无效。')
      this.snapshot = saved.snapshot
      return saved.value
    } catch (error) { this.stopped = true; throw error }
  }
  record(artifactKind: WorldviewExactRefV2['artifactKind'], content: string, step?: string): Promise<WorldviewExactRefV2> {
    return this.write(async snapshot => {
      const saved = await recordAgentRunArtifactV1({ scope: this.scope, runId: snapshot.run.id,
        expectedLastSequence: snapshot.projection.lastSequence, artifactKind, content,
        ...(step ? { stepId: step, attempt: 1 } : {}) })
      return { snapshot: saved.snapshot, value: { artifactKind, contentHash: saved.artifact.contentHash,
        byteLength: saved.artifact.byteLength, ...(step ? { stepId: step, attempt: 1 } : {}) } }
    })
  }
  append<T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadByTypeV1[T]): Promise<void> {
    return this.write(async snapshot => ({ value: undefined, snapshot: await appendAgentRunEventV1({ scope: this.scope,
      runId: snapshot.run.id, expectedLastSequence: snapshot.projection.lastSequence, type, payload }) }))
  }
  async checkpoint(state: StateV2): Promise<void> {
    // Resume JSON remains a constant-size exact reference even after many long drafts.
    const stateRef = await this.record('tool-result', canonicalStringify(state))
    await this.write(async snapshot => {
      const saved = await createAgentRunCheckpointV1({ scope: this.scope, runId: snapshot.run.id,
        expectedLastSequence: snapshot.projection.lastSequence,
        resumePayload: { version: 'worldview-field-checkpoint-v2', portable: false, stateRef } })
      return { snapshot: saved.snapshot, value: undefined }
    })
  }
}
async function exactText(snapshot: AgentRunSnapshotV1, value: WorldviewExactRefV2): Promise<string> {
  const ref = parseWorldviewExactRefV2(value)
  if (!snapshot.events.some(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === ref.artifactKind && event.payload.contentHash === ref.contentHash
    && event.payload.byteLength === ref.byteLength && event.payload.stepId === ref.stepId && event.payload.attempt === ref.attempt)) throw new Error('准确原件不属于当前作品运行。')
  const text = await readAgentRunArtifactExactV1({ projectId: snapshot.run.projectId, artifactKind: ref.artifactKind, contentHash: ref.contentHash })
  const digest = Dexie.currentTransaction ? await Dexie.waitFor(sha256Text(text)) : await sha256Text(text)
  if (new TextEncoder().encode(text).byteLength !== ref.byteLength || digest !== ref.contentHash) throw new Error('准确原件正文或长度不匹配。')
  return text
}
async function refOf(artifactKind: WorldviewExactRefV2['artifactKind'], content: string): Promise<WorldviewExactRefV2> {
  return { artifactKind, contentHash: await sha256Text(content), byteLength: new TextEncoder().encode(content).byteLength }
}
async function readState(scope: WorkspaceScope, runId: number) {
  const snapshot = await readAgentRunV1(scope, runId)
  if (isWorldviewImportedHistoryV2(snapshot)) throw new Error('导入的冻结世界基座历史只读；即使本机数字 ID 相同，也不取得原运行的付费、编辑、采用或新终验权限。请明确开始新任务。')
  if (!isWorldviewFieldRunV2(snapshot) || snapshot.run.workId !== scope.workId || snapshot.run.productRuntimeSessionId != null) throw new Error('不是原作品世界基座 V2 运行。')
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  const payload = checkpoint?.resumePayload as { version?: string; portable?: false; stateRef?: WorldviewExactRefV2 } | undefined
  assertWorldviewExactKeysV2(payload, ['version','portable','stateRef'], 'worldview checkpoint')
  if (payload.version !== 'worldview-field-checkpoint-v2' || payload.portable !== false || !payload.stateRef) throw new Error('缺少世界基座 V2 检查点。')
  let state = JSON.parse(await exactText(snapshot, payload.stateRef)) as StateV2
  assertWorldviewExactKeysV2(state, ['version','rootRef','planRef','frameRef','wireRef','roundRefs','pendingStateRef','callRef'], 'worldview state')
  if (state.pendingStateRef) {
    const successor = JSON.parse(await exactText(snapshot, state.pendingStateRef)) as StateV2
    const successorPlan = JSON.parse(await exactText(snapshot, successor.planRef)) as WorldviewFieldPlanV2
    if (snapshot.contract.budget.allocation?.planHash === successorPlan.planHash) state = successor
  }
  assertWorldviewExactKeysV2(state, ['version','rootRef','planRef','frameRef','wireRef','roundRefs','pendingStateRef','callRef'], 'worldview selected state')
  if (state.version !== 'worldview-field-state-v2' || !Array.isArray(state.roundRefs)) throw new Error('世界基座状态无效。')
  const root = JSON.parse(await exactText(snapshot, state.rootRef)) as WorldviewFieldRootV2
  assertWorldviewRootV2(root)
  const { rootHash, ...body } = root
  if (await hashCanonicalValue(body) !== rootHash || canonicalStringify(scope) !== canonicalStringify(root.scope)
    || snapshot.run.conversationId !== root.conversationId || (snapshot.run.worldGroupId ?? null) !== root.worldGroupId) throw new Error('世界基座 Root owner 或 hash 无效。')
  await parseWorldviewFieldTaskV2(root.task)
  const baseline = JSON.parse(await exactText(snapshot, root.baselineSnapshotRef)) as WorldviewFieldCopilotSnapshot
  const sourceCaptures = await Promise.all(root.sourceRefs.map(async ref => JSON.parse(await exactText(snapshot, ref)) as Awaited<ReturnType<typeof captureRegisteredContextSourceV2>>))
  const assembled = await assembleCapturedWorldviewContextV2(sourceCaptures)
  if (canonicalStringify(parseBaselineCapture(sourceCaptures[1].rawText)) !== canonicalStringify(baseline)
    || canonicalStringify(resolveWorldviewLengthPlanV2(root.task, baseline, root.operation)) !== canonicalStringify(root.lengthPlan)) throw new Error('篇幅计划或真实基线不一致。')
  const plan = JSON.parse(await exactText(snapshot, state.planRef)) as WorldviewFieldPlanV2
  const { planHash, ...planBody } = plan
  const binding = snapshot.contract.executionBindings[0]
  await assertAgentSkillExecutionBindingIntegrityV2(binding)
  if (plan.version !== 'worldview-field-plan-v2' || await hashCanonicalValue(planBody) !== planHash
    || plan.rootHash !== rootHash || binding.taskRequest?.planHash !== planHash
    || binding.taskRequest.materialAllocationHash !== plan.material.allocationHash
    || snapshot.contract.budget.allocation?.planHash !== planHash
    || canonicalStringify(plan.lengthPlan) !== canonicalStringify(root.lengthPlan)
    || canonicalStringify(plan.material) !== canonicalStringify(await makeMaterial(sourceCaptures))
    || plan.request.materialAllocationHash !== plan.material.allocationHash
    || snapshot.contract.runtimeBindingHash !== await hashCanonicalValue({rootHash,planHash,materialAllocationHash:plan.material.allocationHash})
    || canonicalStringify(binding.contextSourceKeys) !== canonicalStringify([...WORLDVIEW_FULL_SOURCE_KEYS_V2])
    || canonicalStringify(binding.writeTargets) !== canonicalStringify([{table:'worldviews',fields:[root.task.targetField],mode:'author-confirmed'}])) throw new Error('当前计划/合同/篇幅不一致。')
  const wire = JSON.parse(await exactText(snapshot, state.wireRef)) as ReturnType<typeof readPreparedRequestFrameV2>
  if (await hashCanonicalValue(wire) !== plan.frameHash || wire.wireBodyHash !== plan.request.wireBodyHash
    || await hashCanonicalValue(wire.messages) !== plan.request.messagesHash
    || await hashCanonicalValue(wire.options) !== plan.request.optionsHash || await sha256Text(wire.wireBody) !== wire.wireBodyHash) throw new Error('当前实际请求frame无效。')
  const rounds: WorldviewFieldRoundV2[] = []
  for (const ref of state.roundRefs) {
    const round = JSON.parse(await exactText(snapshot, ref)) as WorldviewFieldRoundV2
    assertWorldviewExactKeysV2(round,['version','runId','rootHash','planHash','callId','rawRef','callRef','planRef','wireRef','frameRef','draftRef','resultHash','observation','structuredOutputEvidence'],'worldview round')
    const {parseStructuredOutputRunEvidenceV1}=await import('../structured-output-pipeline')
    parseStructuredOutputRunEvidenceV1(round.structuredOutputEvidence)
    if (round.version !== 'worldview-field-round-v2' || round.runId !== runId || round.rootHash !== rootHash) throw new Error('修订稿来自其他运行。')
    const draft = await exactText(snapshot, round.draftRef)
    const candidate = parseWorldviewFieldCandidateDraftV2(draft)
    const observation = observeAuthorLengthV1({ plan: root.lengthPlan, text: worldviewTargetTextV2(candidate.value), representation: 'plain-text',
      candidateKind: 'complete-replacement', baseline: { text: worldviewTargetTextV2(baseline.values[root.task.targetField]), representation: 'plain-text' } })
    if (candidate.field !== root.task.targetField || await sha256Text(draft) !== round.resultHash
      || canonicalStringify(observation) !== canonicalStringify(round.observation)) throw new Error('修订稿计数或目标不一致。')
    await proveRaw(snapshot, root, round.rawRef, round.callId, round.planHash)
    await proveRoundWire(snapshot, root, round)
    rounds.push(round)
  }
  return { snapshot, state, root, baseline, sourceCaptures, assembled, plan, wire, rounds }
}
async function proveRawEnvelopeV2(snapshot: AgentRunSnapshotV1, root: WorldviewFieldRootV2, ref: WorldviewExactRefV2, callId: string, planHash: string): Promise<RawV2> {
  const raw = JSON.parse(await exactText(snapshot, ref)) as RawV2
  assertWorldviewExactKeysV2(raw, ['version','runId','generation','contractHash','rootHash','planHash','callId','frameHash','nativeRequest','response','rawTextHash'], 'worldview raw')
  if (raw.version !== 'worldview-field-response-v2' || raw.runId !== snapshot.run.id || raw.rootHash !== root.rootHash
    || raw.callId !== callId || raw.planHash !== planHash || await sha256Text(raw.response.text) !== raw.rawTextHash
    || !snapshot.events.some(event => event.type === 'model.requested' && event.payload.bindingHash === callId
      && event.generation === raw.generation && event.contractHash === raw.contractHash)
    || !snapshot.events.some(event => event.type === 'model.responded' && event.payload.outputHash === ref.contentHash
      && event.generation === raw.generation && event.contractHash === raw.contractHash)) throw new Error('原答缺少同一次真实调用证据。')
  return raw
}
async function proveRaw(snapshot: AgentRunSnapshotV1, root: WorldviewFieldRootV2, ref: WorldviewExactRefV2, callId: string, planHash: string): Promise<RawV2> {
  const raw=await proveRawEnvelopeV2(snapshot,root,ref,callId,planHash)
  const parsed=raw.response.completion==='complete'?parseWorldviewFieldCandidateDraftV2(raw.response.text):null
  if(parsed&&parsed.field!==root.task.targetField)throw new Error('实际原答跨越原字段目标。')
  return raw
}
function localEvent<T extends AgentRunEventTypeV1>(snapshot: AgentRunSnapshotV1, type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
  return parseAgentRunEventV1({ version: 1, runId: snapshot.run.id, projectId: snapshot.run.projectId,
    worldGroupId: snapshot.run.worldGroupId ?? null, generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash,
    sequence: snapshot.projection.lastSequence + 1, type, payload, createdAt: Date.now() })
}
function routeGuard(resolution: AIRequestConfigResolution) {
  // This local comparison includes credentials; never persists or prints them.
  return canonicalStringify({ taskKind: resolution.taskKind, presetId: resolution.presetId, config: resolution.config })
}
async function assertFresh(root: WorldviewFieldRootV2, sourceCaptures: Awaited<ReturnType<typeof captureRegisteredContextSourceV2>>[], checkTemplate: boolean): Promise<void> {
  const project = await db.projects.get(root.scope.projectId)
  if (project?.activeWorldId !== root.scope.worldId || project.activeWorkId !== root.scope.workId) throw new Error('活动作品已切换，不发送新请求。')
  for (const [index,sourceKey] of WORLDVIEW_FULL_SOURCE_KEYS_V2.entries()) {
    const fresh = await captureRegisteredContextSourceV2({ sourceKey, context: { projectId: root.scope.projectId,
      scope: root.scope, worldGroupId: root.worldGroupId, manualSourceText: root.task.instruction } })
    if (fresh.captureHash !== sourceCaptures[index].captureHash) throw new Error('已确认来源或目标已变化；原稿保留，不发送新请求。')
  }
  if (checkTemplate && await hashCanonicalValue(usePromptStore.getState().getActive('worldview.dimension')) !== root.task.worldviewFieldPromptV2.templateHash) throw new Error('有效模板已变化；原稿保留，不发送新的付费修订。')
}
async function makeMaterial(captures: Awaited<ReturnType<typeof captureRegisteredContextSourceV2>>[]): Promise<ContextMaterialAllocationV2> {
  const hashes = captures.map(item => item.captureHash)
  const body = { version: 'context-material-allocation-v2' as const, authorityHash: await hashCanonicalValue(captures.map(item => item.sourceAuthorityHash)),
    capturedSourceHashes: hashes, selectedSourceHashes: [...hashes], readPlanHash: await hashCanonicalValue({ version: 'worldview-field-full-selection-v2', sourceKeys: [...WORLDVIEW_FULL_SOURCE_KEYS_V2], hashes }),
    inputTokenForecast: captures.reduce((sum,item) => sum + estimateTokens(item.rawText),0), captureProtocolVersion: 'registered-host-full-v2' as const }
  return { ...body, allocationHash: await hashCanonicalValue(body) }
}
async function prepareRound(root: WorldviewFieldRootV2, baseline: WorldviewFieldCopilotSnapshot,
  captures: Awaited<ReturnType<typeof captureRegisteredContextSourceV2>>[], previous: WorldviewFieldPlanV2 | null,
  priorDraft?: { text: string; round: WorldviewFieldRoundV2 }, remainingExplicitOutput?: number) {
  const material = await makeMaterial(captures), assembled = await assembleCapturedWorldviewContextV2(captures)
  const request = root.task.worldviewFieldPromptV2.request
  const template = root.task.worldviewFieldPromptV2.template
  const spec = WORLDVIEW_GENERATABLE_FIELD_SPECS.find(item => item.field === root.task.targetField)!
  const frozenParams = { ...(request.parameterValues ?? {}) }
  // Only actual own-key parameters are explicit input. Seed defaults never
  // become a frozen author length or wire-output constraint.
  // The built-in detail-level→character bands are program defaults, not an
  // author length choice. Preserve the frozen original, change only this new
  // system-template rendering. User templates/overrides are never rewritten.
  const renderTemplate = template.scope === 'system' ? {...template,systemPrompt:template.systemPrompt.replace(
    '（简略=300 字内 / 中等=300-800 字 / 详尽=800-1500 字）','（控制细节覆盖，字数依本次篇幅计划安排）')} : template
  const rendered = renderPrompt(renderTemplate, { ...worldviewContentTemplateVariablesV1(root.task.targetField), projectName: JSON.parse(captures[2].rawText).work.title,
    dimension: spec.aiGeneration.label, userHint: '', genres: JSON.parse(captures[2].rawText).work.genres,
    worldContext: '', existingWorldview: '', currentValue: '' }, { parameterValues: frozenParams, contentPolicy: 'task-content-unbounded-v2',
    overrides: { ...(request.systemOverride == null ? {} : { systemPrompt: request.systemOverride }),
      ...(request.userOverride == null ? {} : { userPromptTemplate: request.userOverride }) } })
  const hard = worldviewFieldHardSystemV2({ targetField: root.task.targetField, snapshot: baseline,
    mode: root.operation, projectName: JSON.parse(captures[2].rawText).work.title })
  const messages: ChatMessage[] = [{ role: 'system', content: [
    ...rendered.messages.filter(message => message.role === 'system').map(message => message.content), hard,
    `【本次生效篇幅计划】${describeTaskLengthPlanV1(root.lengthPlan)}。本计划优先于系统模板预设的字数建议；自动参考没有最高字数。`,
    '正式材料只在下方的完整来源包出现一次。空资料别名不是来源缺失。作者自定义模板/说明仍保留，事实权限与字段结构不得越界。',
  ].join('\n\n') }, ...rendered.messages.filter(message => message.role !== 'system'),
    { role: 'user', content: `【实际登记完整来源】\n${assembled.text}` }]
  if (priorDraft) messages.push({ role: 'user', content: `${authorLengthRevisionInstructionV1(root.lengthPlan, priorDraft.round.observation)}\n【前轮完整候选】\n${priorDraft.text}` })
  const temperature = request.temperature ?? rendered.modelOverride?.temperature
  // Sampling overrides belong to the routed configuration, never to the
  // request-options schema. Keep this exact override in every route guard.
  const configOverrides = temperature === undefined ? undefined : Object.freeze({ temperature })
  const meta = { category: CATEGORY, ...(configOverrides ? { configOverrides } : {}) }
  const resolution = structuredClone(resolveRequestConfig(useAIConfigStore.getState().config, meta))
  const guard = routeGuard(resolution)
  const options = {}
  const explicitConstraints = request.maxTokens === undefined ? null : { version: 'explicit-author-consumption-v2' as const,
    sourceEvidenceHash: root.task.worldviewFieldPromptV2.requestHash,
    maxModelCalls: null, maxInputTokens: null, maxOutputTokens: remainingExplicitOutput ?? request.maxTokens, maxCostUsd: null }
  const prepared = await prepareAIRequestV2({ resolution, assessmentContext: await freezeAIRequestAssessmentContextV2(resolution),
    messages, stream: false, options, contextMaterial: material, lengthPlan: root.lengthPlan, explicitConstraints })
  if(request.maxTokens!==undefined&&readPreparedNativeRequestRefV2(prepared.handle)!==null)throw new Error('当前原生运输不能执行本次明确输出消费约束；没有发送生成请求。')
  const frame = readPreparedRequestFrameV2(prepared.handle)
  const body = { version: 'worldview-field-plan-v2' as const, rootHash: root.rootHash, previousPlanHash: previous?.planHash ?? null,
    round: previous ? previous.round + 1 : 0, predecessorDraftHash: priorDraft?.round.resultHash ?? null,
    material, request: prepared.evidence, lengthPlan: root.lengthPlan, frameHash: await hashCanonicalValue(frame),
    forecast: { modelCalls: 1, inputTokens: prepared.evidence.inputMeasurement.tokens, outputTokens: prepared.evidence.forecastOutputTokens } }
  const plan = { ...body, planHash: await hashCanonicalValue(body) }
  const assertCurrent = () => { if (routeGuard(resolveRequestConfig(useAIConfigStore.getState().config, meta)) !== guard) throw new Error('模型路由已改变，不发送原请求。') }
  return { plan, resolution, configOverrides, handle: prepared.handle, frame, assertCurrent }
}
async function contractFor(root: WorldviewFieldRootV2, plan: WorldviewFieldPlanV2) {
  const skill = getAgentSkillV1(WORLDVIEW_FIELD_SKILL_V2, 'world-origin')
  await createContextAccessPolicyForExecutionV2(skill, plan.material)
  const binding = await createAgentSkillExecutionBindingV2(skill, {
    taskRequest: { version: 'task-request-binding-v2', planHash: plan.planHash, materialAllocationHash: plan.material.allocationHash },
    outputForecastTokens: plan.forecast.outputTokens,
    writeTargets: [{ table: 'worldviews', fields: [root.task.targetField], mode: 'author-confirmed' }] })
  const request = root.task.worldviewFieldPromptV2.request
  return { version: 3 as const, executionBoundary: 'formal' as const, objective: `世界基座单字段 ${root.task.targetField}；Root ${root.rootHash}`,
    workflowKind: 'direct-generation' as const, scope: { projectId: root.scope.projectId, worldGroupId: root.worldGroupId },
    permissions: { contextSourceKeys: binding.contextSourceKeys, writeTargets: binding.writeTargets },
    runtimeBindingHash: await hashCanonicalValue({ rootHash: root.rootHash, planHash: plan.planHash, materialAllocationHash: plan.material.allocationHash }),
    executionBindings: [{ stepId: stepId(root), ...binding, formalEntry: await freezeFormalAIEntryBindingV1(WORLDVIEW_FIELD_ENTRY_V2) }],
    budget: { allocation: { version: 'task-budget-allocation-v2' as const, mode: 'adaptive-plan' as const, planHash: plan.planHash,
      inputBasis: 'prepared-complete-request-v2', outputBasis: 'source-token-estimate-v1', modelCallsBasis: 'remaining-exact-frontier-v2',
      hardConstraints: request.maxTokens === undefined ? null : { version: 'explicit-author-consumption-v2' as const,
        sourceEvidenceHash: root.task.worldviewFieldPromptV2.requestHash, maxModelCalls: null, maxInputTokens: null,
        maxOutputTokens: request.maxTokens, maxCostUsd: null } },
      maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: plan.forecast.inputTokens, maxOutputTokens: plan.forecast.outputTokens,
      maxAttemptsPerStep: 1, maxProtocolErrors: 0 },
    acceptance: [{ id: `${root.task.id}.candidate`, kind: 'output-present' as const, required: true },
      { id: `${root.task.id}.confirmed`, kind: 'author-confirmed' as const, required: true },
      { id: `${root.task.id}.adopted`, kind: 'post-state-matches' as const, required: true }],
    verificationPlan: [{ id: 'worldview.v2.terminal', kind: 'terminal' as const, verifier: VERIFIER,
      criterionIds: [`${root.task.id}.candidate`,`${root.task.id}.confirmed`,`${root.task.id}.adopted`] }],
    failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const } }
}
async function savePrepared(cursor: CursorV2, prepared: Awaited<ReturnType<typeof prepareRound>>, rootRef: WorldviewExactRefV2, rounds: WorldviewExactRefV2[], previousState?: StateV2): Promise<StateV2> {
  const planRef = await cursor.record('tool-result', canonicalStringify(prepared.plan))
  const wireRef = await cursor.record('rendered-request', canonicalStringify(prepared.frame))
  const frameRef = await cursor.record('rendered-request', canonicalStringify({ version: 'worldview-field-frame-v2', planHash: prepared.plan.planHash,
    request: prepared.plan.request, lengthPlan: prepared.plan.lengthPlan, wireRef }))
  const state: StateV2 = { version: 'worldview-field-state-v2', rootRef, planRef, frameRef, wireRef, roundRefs: [...rounds], pendingStateRef: null, callRef: null }
  if (previousState) {
    // Save the successor before changing contract generation. At every crash
    // boundary the last checkpoint names either current or committed successor.
    const nextRef = await cursor.record('tool-result', canonicalStringify(state))
    await cursor.checkpoint({ ...previousState, pendingStateRef: nextRef })
    const root = JSON.parse(await exactText(cursor.snapshot, rootRef)) as WorldviewFieldRootV2
    await cursor.write(async snapshot => ({ value: undefined, snapshot: await reviseAgentRunContractV1({ scope: cursor.scope,
      runId: snapshot.run.id, expectedLastSequence: snapshot.projection.lastSequence, contract: await contractFor(root, prepared.plan) }) }))
  }
  await cursor.checkpoint(state)
  await ensureActive(cursor)
  return state
}
async function targetLock<T>(scope: WorkspaceScope, field: string, group: number | null, operation: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('当前浏览器不能确认跨页面执行占用；输入已保留。')
  return navigator.locks.request(`storyforge:worldview-field-v2:${db.name}:${scope.projectId}:${scope.worldId}:${scope.workId}:${group ?? 'null'}:${field}`,
    { mode: 'exclusive', ifAvailable: true }, lock => { if (!lock) throw new Error('另一页面正在处理此字段，不重复创建或发送。'); return operation() })
}
export async function runWorldviewFieldMasterV2(input: WorldviewMasterInputV2): Promise<WorldviewMasterResultV2> {
  if(input.candidateSemanticReview==='required')throw new Error('此固定单字段入口尚未登记独立语义评审；不能把缺少评审伪称通过。请沿原带评审的任务入口执行。')
  const scope = Object.freeze({ ...input.scope })
  if (input.runId != null) {
    const saved = await readState(scope, input.runId)
    input.onLengthPlan?.(saved.root.lengthPlan)
    return targetLock(scope, saved.root.task.targetField, saved.root.worldGroupId, async () => resumeWorldviewFieldV2(input, saved))
  }
  if (!input.plan || input.plan.phase === 'proposal' || input.plan.tasks.length !== 1 || input.conversationId == null) throw new Error('世界基座 V2 首批只接受作者开始的一个固定字段。')
  const task = await parseWorldviewFieldTaskV2(input.plan.tasks[0])
  return targetLock(scope, task.targetField, input.worldGroupId, async () => {
    input.signal?.throwIfAborted()
    const work = await db.works.get(scope.workId), project = await db.projects.get(scope.projectId)
    if (!work || work.projectId !== scope.projectId || work.worldId !== scope.worldId
      || project?.activeWorkId !== scope.workId || project.activeWorldId !== scope.worldId
      || project.enableMultiWorld && input.worldGroupId == null) throw new Error('世界基座目标缺少真实活动作品/世界。')
    const group = project.enableMultiWorld ? input.worldGroupId : null
    for (const row of await readOwnedRows<import('../../types/agent-run').AgentRunRecord>(scope, 'agentRuns', { owner: 'work' })) {
      if (row.id == null || !['planned','running','paused','awaiting_confirmation','recovering','verifying'].includes(row.status)) continue
      const snapshot = await readAgentRunV1(scope, row.id)
      if(isWorldviewFieldRunV2(snapshot)&&isWorldviewImportedHistoryV2(snapshot))continue
      if (snapshot.run.conversationId === input.conversationId) throw new Error('原会谈仍有未处理运行，请先恢复或明确结束，不另发付费请求。')
    }
    const captures = await Promise.all(WORLDVIEW_FULL_SOURCE_KEYS_V2.map(sourceKey => captureRegisteredContextSourceV2({ sourceKey,
      context: { projectId: scope.projectId, scope, worldGroupId: group, manualSourceText: task.instruction } })))
    const baseline = parseBaselineCapture(captures[1].rawText)
    if (resolveWorldviewAgentFieldV1(task.instruction) !== task.targetField) throw new Error('作者要求与固定目标字段不一致。')
    const spec = WORLDVIEW_GENERATABLE_FIELD_SPECS.find(item => item.field === task.targetField)!
    const requestedMode = resolveWorldviewFieldModeV1(task.instruction)
    if (!spec.aiGeneration.modes.includes(requestedMode)) throw new Error('目标字段不支持本次操作。')
    const operation: WorldviewFieldRootV2['operation'] = worldviewTargetTextV2(baseline.values[task.targetField]).trim() ? requestedMode : 'create'
    const lengthPlan = resolveWorldviewLengthPlanV2(task, baseline, operation)
    input.onLengthPlan?.(lengthPlan)
    const sourceTexts = captures.map(capture => canonicalStringify(capture))
    const baselineText = canonicalStringify(baseline)
    const body = { version: 'worldview-field-root-v2' as const, portable: false as const, scope, worldGroupId: group,
      conversationId: input.conversationId!, task, operation, lengthPlan,
      sourceRefs: await Promise.all(sourceTexts.map(text => refOf('source-snapshot', text))),
      baselineSnapshotRef: await refOf('source-snapshot', baselineText) }
    const root: WorldviewFieldRootV2 = { ...body, rootHash: await hashCanonicalValue(body) }
    const prepared = await prepareRound(root, baseline, captures, null)
    await assertFresh(root, captures, true)
    prepared.assertCurrent(); input.signal?.throwIfAborted()
    const cursor = new CursorV2(scope, await createAgentRunV1({ scope, worldGroupId: group, conversationId: input.conversationId,
      contract: await contractFor(root, prepared.plan) }))
    const rootRef = await cursor.record('source-snapshot', canonicalStringify(root))
    for (const text of sourceTexts) await cursor.record('source-snapshot', text)
    await cursor.record('source-snapshot', baselineText)
    const state = await savePrepared(cursor, prepared, rootRef, [])
    await input.onTask?.(task, 'running')
    return continueWorldviewV2({ input, cursor, root, baseline, captures, state, prepared, rounds: [] })
  })
}
async function dispatchRound(input: {
  input: WorldviewMasterInputV2; cursor: CursorV2; root: WorldviewFieldRootV2
  captures: Awaited<ReturnType<typeof captureRegisteredContextSourceV2>>[]; state: StateV2
  prepared: Awaited<ReturnType<typeof prepareRound>>
}): Promise<{ raw: RawV2; rawRef: WorldviewExactRefV2 }> {
  const { cursor,root,state,prepared } = input, step = stepId(root)
  const wire = readPreparedRequestFrameV2(prepared.handle), nativeRequest = readPreparedNativeRequestRefV2(prepared.handle)
  const callId = await hashCanonicalValue({ runId: cursor.snapshot.run.id, generation: cursor.snapshot.projection.generation,
    rootHash: root.rootHash, planHash: prepared.plan.planHash, frameHash: prepared.plan.frameHash })
  let raw: RawV2 | undefined, rawRef: WorldviewExactRefV2 | undefined
  let deltaHead: string | null = null
  const bound = bindPreparedRequestObserversV2(prepared.handle, {
    beforeDispatch: async () => {
      input.input.signal?.throwIfAborted(); prepared.assertCurrent(); await assertFresh(root,input.captures,true)
      const actual = await readAgentRunV1(cursor.scope,cursor.snapshot.run.id)
      if (actual.projection.lastSequence !== cursor.snapshot.projection.lastSequence || actual.projection.state !== 'running') throw new Error('实际运行已推进或停止。')
      const assembled = await assembleCapturedWorldviewContextV2(input.captures)
      const manifest = await createContextManifestFromAssemblyV1({ runId: actual.run.id, stepId: step, attempt: 1,
        projectId: root.scope.projectId, worldGroupId: root.worldGroupId,
        declaredSourceKeys: [...WORLDVIEW_FULL_SOURCE_KEYS_V2], assembled, readerVersion: 'registered-host-full-v2' })
      await cursor.record('context-manifest',canonicalStringify(manifest),step)
      await cursor.append('context.assembled',{stepId:step,attempt:1,manifestHash:manifest.manifestHash})
      state.callRef = await cursor.record('tool-result', canonicalStringify({ version: 'worldview-field-call-v2',
        runId: actual.run.id, generation: actual.projection.generation, contractHash: actual.projection.contractHash,
        rootHash: root.rootHash, planHash: prepared.plan.planHash, frameHash: prepared.plan.frameHash,
        callId, contextManifestHash: manifest.manifestHash, nativeRequest }),step)
      await cursor.checkpoint(state)
      await cursor.append('model.requested',{stepId:step,attempt:1,bindingHash:callId})
      // Persist every exact pre-dispatch witness first. Changes during these
      // journal awaits must stop before transport, not only stale the result.
      input.input.signal?.throwIfAborted()
      prepared.assertCurrent()
      await assertFresh(root,input.captures,true)
      const final = await readAgentRunV1(cursor.scope,cursor.snapshot.run.id)
      if (final.projection.lastSequence !== cursor.snapshot.projection.lastSequence
        || final.projection.generation !== cursor.snapshot.projection.generation
        || final.projection.contractHash !== cursor.snapshot.projection.contractHash
        || final.projection.state !== 'running') throw new Error('实际运行已推进或停止，不发送原请求。')
      input.input.signal?.throwIfAborted()
      prepared.assertCurrent()
    },
    onPublicDelta: async text => {
      const ref = await cursor.record('raw-response',canonicalStringify({ version:'worldview-field-delta-v2',callId,previousDeltaHash:deltaHead,text }),step)
      deltaHead=ref.contentHash
    },
    onPublicResponse: async response => {
      if (!state.callRef || rawRef) throw new Error('原答回调身份无效或重复。')
      raw = { version:'worldview-field-response-v2',runId:cursor.snapshot.run.id,generation:cursor.snapshot.projection.generation,
        contractHash:cursor.snapshot.projection.contractHash,rootHash:root.rootHash,planHash:prepared.plan.planHash,
        callId,frameHash:prepared.plan.frameHash,nativeRequest,response:structuredClone(response),rawTextHash:await sha256Text(response.text) }
      rawRef = await cursor.record('raw-response',canonicalStringify(raw),step)
      await cursor.append('model.responded',{stepId:step,attempt:1,outputHash:rawRef.contentHash})
      // Public raw and same-call ledger are committed before acknowledging the
      // original native request. Failed acknowledgement never causes a POST.
      if (nativeRequest && ['complete','incomplete'].includes(response.completion)) {
        const receipt = await readBoundCodexReceiptV1(nativeRequest)
        if (receipt.status !== 'completed' || receipt.text !== response.text || nativeRequest.requestHash !== prepared.plan.request.wireBodyHash) throw new Error('原生运输原答与已保存请求不一致。')
        await acknowledgeBoundCodexReceiptV1({ request:nativeRequest,rawResponseHash:raw.rawTextHash,confirmation:'owner-record-saved-v1' })
      }
    },
  })
  const result: ChatResult = {}
  try {
    const binding = bindingFor(cursor.snapshot)
    if (!binding.formalEntry) throw new Error('缺少冻结正式入口。')
    await executePreparedWorldviewFieldV2({ binding:binding.formalEntry,skill:getAgentSkillV1(WORLDVIEW_FIELD_SKILL_V2,'world-origin'),
      resolution:prepared.resolution,configOverrides:prepared.configOverrides,messages:wire.messages,options:wire.options,bound,signal:input.input.signal,result,projectId:root.scope.projectId })
  } catch (error) {
    // The caller retains an earlier complete draft before ending an aborted first call.
    if(input.input.signal?.aborted) throw error
    if (cursor.stopped || !raw || !rawRef || raw.response.completion !== 'complete') throw error
    // Full already-paid raw survives later receipt/callback errors. Local parse
    // uses its real exact chain; no catch/retry can dispatch the same handle.
  }
  if (!raw || !rawRef) throw new Error('缺少可确认原答；保留原运行，不自动重发。')
  return { raw,rawRef }
}
async function compileRound(cursor: CursorV2, root: WorldviewFieldRootV2, baseline: WorldviewFieldCopilotSnapshot,
  plan: WorldviewFieldPlanV2, raw: RawV2, rawRef: WorldviewExactRefV2, state: StateV2): Promise<WorldviewFieldRoundV2> {
  if (raw.response.completion !== 'complete') throw new Error('本次回答停笔或结果未知；可见原答已保留，不能把不完整 JSON 标成完整候选。')
  const candidate = parseWorldviewFieldCandidateDraftV2(raw.response.text)
  const issues = worldviewFieldCandidateIssuesV1(candidate,{targetField:root.task.targetField,snapshot:baseline},parseWorldviewFieldCandidateDraftV2)
  if (issues.length) throw new Error(issues.map(item => item.message).join('；'))
  const { readStructuredOutputEvidenceV1 } = await import('../structured-output-pipeline')
  const evidence = readStructuredOutputEvidenceV1(candidate)
  if (!evidence) throw new Error('缺少同一 pipeline 的结构校验证据。')
  const draft = JSON.stringify(candidate,null,2), draftRef = await cursor.record('tool-result',draft,stepId(root))
  const observation = observeAuthorLengthV1({plan:root.lengthPlan,text:worldviewTargetTextV2(candidate.value),representation:'plain-text',
    candidateKind:'complete-replacement',baseline:{text:worldviewTargetTextV2(baseline.values[root.task.targetField]),representation:'plain-text'}})
  return {version:'worldview-field-round-v2',runId:cursor.snapshot.run.id,rootHash:root.rootHash,planHash:plan.planHash,callId:raw.callId,
    rawRef,callRef:state.callRef!,planRef:state.planRef,wireRef:state.wireRef,frameRef:state.frameRef,draftRef,resultHash:await sha256Text(draft),observation,
    structuredOutputEvidence:{version:1,schemaId:evidence.schemaId,target:evidence.target,status:evidence.status,
      attempts:[{callIndex:1,purpose:'generate',evidence}],repair:null}}
}
/** Uses only previously compiled, validated exact rounds. An unknown/failed
 * later call never becomes a successful response and can never be re-POSTed. */
async function retainBestWorldviewDraftV2(input: {
  cursor: CursorV2; root: WorldviewFieldRootV2; state: StateV2; rounds: readonly WorldviewFieldRoundV2[]
}, reason: string, resumed = true): Promise<WorldviewMasterResultV2 | null> {
  if (input.cursor.stopped || !input.rounds.length) return null
  const best = input.rounds.reduce((selected, round) => input.root.lengthPlan.mode === 'explicit'
    && round.observation.distance! > selected.observation.distance! ? selected : round)
  await persistCandidate(input.cursor,input.root,input.state,best,'needs-attention',reason)
  return resultFor(input.cursor.scope,input.cursor.snapshot.run.id,resumed)
}
async function continueWorldviewV2(input: {
  input: WorldviewMasterInputV2; cursor: CursorV2; root: WorldviewFieldRootV2; baseline: WorldviewFieldCopilotSnapshot
  captures: Awaited<ReturnType<typeof captureRegisteredContextSourceV2>>[]; state: StateV2
  prepared?: Awaited<ReturnType<typeof prepareRound>>; rounds: WorldviewFieldRoundV2[]
  recovered?: {raw:RawV2;rawRef:WorldviewExactRefV2;plan:WorldviewFieldPlanV2}
}): Promise<WorldviewMasterResultV2> {
  let prepared=input.prepared, state=input.state, previous:WorldviewFieldPlanV2|undefined, recovered=input.recovered
  const {cursor,root,baseline,rounds}=input
  while (true) {
    let response: {raw:RawV2;rawRef:WorldviewExactRefV2;plan:WorldviewFieldPlanV2}
    let round: WorldviewFieldRoundV2
    try {
      input.input.signal?.throwIfAborted()
      const received = recovered ?? (prepared ? {...await dispatchRound({...input,state,prepared}),plan:prepared.plan} : undefined)
      if (!received) throw new Error('没有明确未派发请求或已留存原答。')
      response = received
      round = await compileRound(cursor,root,baseline,response.plan,response.raw,response.rawRef,state)
    } catch (error) {
      if (cursor.stopped) throw error
      const saved = await retainBestWorldviewDraftV2({cursor,root,state,rounds},input.input.signal?.aborted
        ? '作者已停止后续生成；最佳完整稿与全部原答保留，请检查后明确编辑或拒绝。'
        : '后续请求或回答校验未完成；最佳完整稿与失败原件保留，没有自动重发。',input.input.runId!=null)
      if (saved) return saved
      if (input.input.signal?.aborted) await cursor.append('run.cancelled',{reason:'author-stopped-worldview-field-v2'})
      throw error
    }
    previous=response.plan; recovered=undefined
    const prior=rounds.map(item => ({resultHash:item.resultHash,observation:item.observation}))
    // Existing field gate above checks the actual carrier/field and unchanged
    // result. Semantic/factual quality remains visible author review; numeric
    // success never grants a write or claims literary quality.
    const decision=planAuthorLengthRevisionV1({plan:root.lengthPlan,current:{resultHash:round.resultHash,observation:round.observation},priorValidRounds:prior,
      completion:'complete',structuralValid:true,semanticComplete:true,semanticProgress:'unknown'})
    rounds.push(round)
    const roundRef=await cursor.record('tool-result',canonicalStringify(round),stepId(root));state.roundRefs.push(roundRef)
    await cursor.checkpoint(state)
    input.input.onLengthProgress?.({rounds:rounds.length,words:round.observation.measuredWords,status:decision.action})
    const best=[...rounds].reverse().find(item => item.resultHash===decision.bestResultHash) ?? round
    if (decision.action!=='revise-length') {
      await persistCandidate(cursor,root,state,best,decision.action==='ready'?'ready':'needs-attention',decision.reason)
      await input.input.onTask?.(root.task,'completed')
      return resultFor(cursor.scope,cursor.snapshot.run.id,false)
    }
    try {
      await assertFresh(root,input.captures,true); input.input.signal?.throwIfAborted()
      prepared=await prepareRound(root,baseline,input.captures,previous,{text:await exactText(cursor.snapshot,round.draftRef),round},await remainingConsumptionV2(cursor.snapshot,root))
    } catch (error) {
      if (cursor.stopped) throw error
      // The best complete validated draft is recoverable even when a new paid
      // revision is forbidden. It is visibly unmet, never marked length-ready.
      await persistCandidate(cursor,root,state,best,'needs-attention',error instanceof Error?error.message:'修订已停止。')
      return resultFor(cursor.scope,cursor.snapshot.run.id,false)
    }
    state=await savePrepared(cursor,prepared!,state.rootRef,state.roundRefs,state)
  }
}
async function persistCandidate(cursor: CursorV2,root:WorldviewFieldRootV2,state:StateV2,round:WorldviewFieldRoundV2,
  disposition:WorldviewFieldCandidateMetadataV2['disposition'],reason:string):Promise<void> {
  const draft=await exactText(cursor.snapshot,round.draftRef)
  const metadata:WorldviewFieldCandidateMetadataV2={version:'worldview-field-candidate-v2',rootRef:state.rootRef,draftRef:round.draftRef,
    roundRefs:[...state.roundRefs],lengthPlan:root.lengthPlan,lengthObservation:round.observation,disposition,reason}
  const selectedCall=JSON.parse(await exactText(cursor.snapshot,round.callRef)) as {contextManifestHash:string}
  const payload:MasterCandidatePayload={version:1,taskId:root.task.id,agentId:'world-origin',skillId:WORLDVIEW_FIELD_SKILL_V2,
    label:WORLDVIEW_GENERATABLE_FIELD_SPECS.find(item=>item.field===root.task.targetField)!.aiGeneration.label,
    contextSources:[...WORLDVIEW_FULL_SOURCE_KEYS_V2],contextManifestHash:selectedCall.contextManifestHash,baseSnapshot:{rootRef:state.rootRef},worldviewField:root.task.targetField,
    worldviewFieldOperation:root.operation,workspaceScope:root.scope,runId:cursor.snapshot.run.id,runGeneration:cursor.snapshot.projection.generation,
    runStepId:stepId(root),worldviewFieldV2:metadata}
  payload.candidateHash=await hashCanonicalValue({draft,payload})
  await cursor.write(async expected=>withAgentRunMutationLockV1(expected.run.id,()=>db.transaction('rw',
    agentRunScopeTransactionTablesV1(expected.run.id,db.agentConversations,db.agentEvents,db.agentRuns,db.agentRunEvents),async()=>{
      let snapshot=await readVerifiedAgentRunInTransactionV1(cursor.scope,expected.run.id)
      if (snapshot.projection.lastSequence!==expected.projection.lastSequence || snapshot.projection.state!=='running') throw new Error('候选保存前 Run 已变化。')
      await appendAgentEvent({projectId:cursor.scope.projectId,scope:cursor.scope,conversationId:root.conversationId,durableRunId:expected.run.id,
        kind:'candidate',content:draft,payload})
      snapshot=await appendPrivilegedAgentRunEventInTransactionV1(snapshot,localEvent(snapshot,'candidate.persisted',{
        stepId:stepId(root),attempt:1,candidateHash:payload.candidateHash!,requiresConfirmation:true}))
      return {snapshot,value:undefined}
    })))
}
export async function restoreWorldviewFieldMasterV2(scope:WorkspaceScope,runId:number) {
  const read=await readState(scope,runId)
  const rows=(await readOwnedRows<AgentEvent>(scope,'agentEvents',{owner:'work'})).filter(row=>row.durableRunId===runId&&row.kind==='candidate')
  const candidates:MasterAgentDurableCandidateV1[]=[]
  for(const event of rows) {
    const payload=JSON.parse(event.payload) as MasterCandidatePayload
    assertWorldviewExactKeysV2(payload,['version','taskId','agentId','skillId','label','contextSources','contextManifestHash','baseSnapshot','worldviewField',
      'worldviewFieldOperation','workspaceScope','runId','runGeneration','runStepId','worldviewFieldV2','candidateHash'],'worldview candidate payload')
    const metadata=payload.worldviewFieldV2!
    assertWorldviewExactKeysV2(metadata,['version','rootRef','draftRef','roundRefs','lengthPlan','lengthObservation','disposition','reason'],'worldview candidate metadata')
    const {candidateHash,...withoutHash}=payload
    const parsed=parseWorldviewFieldCandidateDraftV2(event.content)
    const observed=observeAuthorLengthV1({plan:read.root.lengthPlan,text:worldviewTargetTextV2(parsed.value),representation:'plain-text',candidateKind:'complete-replacement',
      baseline:{text:worldviewTargetTextV2(read.baseline.values[read.root.task.targetField]),representation:'plain-text'}})
    if(!read.snapshot.events.some(item=>item.type==='context.assembled'&&item.payload.manifestHash===payload.contextManifestHash))throw new Error('候选缺少已提交完整来源 manifest。')
    if(payload.version!==1||payload.agentId!=='world-origin'||payload.skillId!==WORLDVIEW_FIELD_SKILL_V2||payload.runId!==runId
      ||payload.taskId!==read.root.task.id||payload.worldviewField!==read.root.task.targetField||parsed.field!==payload.worldviewField
      ||payload.runStepId!==stepId(read.root)||event.conversationId!==read.root.conversationId
      ||canonicalStringify(payload.workspaceScope)!==canonicalStringify(scope)||canonicalStringify(metadata.rootRef)!==canonicalStringify(read.state.rootRef)
      ||metadata.version!=='worldview-field-candidate-v2'||!['ready','needs-attention','author-edited'].includes(metadata.disposition)
      ||canonicalStringify(metadata.lengthPlan)!==canonicalStringify(read.root.lengthPlan)
      ||canonicalStringify(metadata.roundRefs)!==canonicalStringify(read.state.roundRefs)
      ||canonicalStringify(observed)!==canonicalStringify(metadata.lengthObservation)
      ||await exactText(read.snapshot,metadata.draftRef)!==event.content
      ||await hashCanonicalValue({draft:event.content,payload:withoutHash})!==candidateHash
      ||read.snapshot.projection.steps[payload.runStepId]?.candidateHash!==candidateHash) throw new Error('世界基座候选身份/原稿/计数已变化。')
    candidates.push({event,payload,draft:event.content})
  }
  return {...read,candidates,plan:{summary:'世界基座单字段完整生成。',tasks:[read.root.task],workflow:{version:1,workflowId:'single-domain-direct',reasonCodes:['single-explicit-domain']}} as MasterAgentPlan,
    outputs:Object.fromEntries(candidates.map(item=>[item.payload.taskId,item.draft])),budgetEvidence:await budgetEvidenceFor(read.snapshot)}
}
async function budgetEvidenceFor(snapshot:AgentRunSnapshotV1):Promise<WorldviewTaskBudgetEvidenceV2> {
  let input:number|null=0,output:number|null=0
  const hashes=new Set<string>()
  for(const event of snapshot.events) {
    if(event.type!=='model.responded'||hashes.has(event.payload.outputHash))continue
    hashes.add(event.payload.outputHash)
    const refEvent=snapshot.events.find(row=>row.type==='evidence.artifact.recorded'&&row.payload.artifactKind==='raw-response'&&row.payload.contentHash===event.payload.outputHash)
    if(!refEvent||refEvent.type!=='evidence.artifact.recorded')throw new Error('实际使用记录缺少原答。')
    const raw=JSON.parse(await exactText(snapshot,refEvent.payload)) as RawV2
    input=typeof raw.response.usage.inputTokens==='number'&&input!==null?input+raw.response.usage.inputTokens:null
    output=typeof raw.response.usage.outputTokens==='number'&&output!==null?output+raw.response.usage.outputTokens:null
  }
  const calls=snapshot.events.filter(event=>event.type==='model.requested').length
  if(hashes.size!==calls){input=null;output=null}
  return {version:'worldview-field-budget-evidence-v2',calls,
    observedInputTokens:input,observedOutputTokens:output,allocation:snapshot.contract.budget.allocation!}
}
async function resultFor(scope:WorkspaceScope,runId:number,resumed:boolean):Promise<WorldviewMasterResultV2> {
  const restored=await restoreWorldviewFieldMasterV2(scope,runId)
  return {runId,resumed,plan:restored.plan,candidates:restored.candidates,budgetEvidence:restored.budgetEvidence,projection:restored.snapshot.projection}
}
async function resumeWorldviewFieldV2(input:WorldviewMasterInputV2,read:Awaited<ReturnType<typeof readState>>):Promise<WorldviewMasterResultV2> {
  if(input.conversationId!==undefined&&input.conversationId!==read.root.conversationId)throw new Error('不能跨会谈恢复世界基座。')
  if(input.worldGroupId!==read.root.worldGroupId)throw new Error('不能跨世界分组恢复。')
  if(read.snapshot.projection.state==='awaiting_confirmation'||read.snapshot.projection.state==='completed')return resultFor(input.scope,read.snapshot.run.id,true)
  if(!['planned','running'].includes(read.snapshot.projection.state))throw new Error('该运行当前不能新增模型请求；原件仍可读取。')
  const cursor=new CursorV2(input.scope,read.snapshot)
  const call=read.state.callRef?JSON.parse(await exactText(read.snapshot,read.state.callRef)) as {callId:string;planHash:string}:null
  if(call) {
    const rawEvents=read.snapshot.events.filter(event=>event.type==='evidence.artifact.recorded'&&event.payload.artifactKind==='raw-response')
    let recovered:{raw:RawV2;rawRef:WorldviewExactRefV2;plan:WorldviewFieldPlanV2}|undefined
    for(const event of rawEvents) {
      if(event.type!=='evidence.artifact.recorded')continue
      const ref=event.payload,raw=JSON.parse(await exactText(read.snapshot,ref)) as RawV2
      if(raw.version!=='worldview-field-response-v2'||raw.callId!==call.callId||raw.planHash!==read.plan.planHash)continue
      // Prove the exact paid response first; malformed content is handled by
      // compileRound, so an earlier validated draft remains recoverable.
      await proveRawEnvelopeV2(read.snapshot,read.root,ref,call.callId,read.plan.planHash)
      recovered={raw,rawRef:ref,plan:read.plan}
    }
    if(!recovered) {
      const saved = await retainBestWorldviewDraftV2({cursor,root:read.root,state:read.state,rounds:read.rounds},
        '后续请求缺少完整可靠原答；最佳完整稿与全部原件保留，不重新派发。')
      if(saved)return saved
      throw new Error('原请求已经登记派发，但没有完整可靠原答；只读保留，不能自动重新 POST。可明确结束此未完成任务后开始新任务。')
    }
    const compiled=read.rounds.find(round=>round.callId===call.callId)
    if(!compiled)return continueWorldviewV2({input,cursor,root:read.root,baseline:read.baseline,captures:read.sourceCaptures,
      state:read.state,rounds:read.rounds,recovered})
    const index=read.rounds.indexOf(compiled)
    const decision=planAuthorLengthRevisionV1({plan:read.root.lengthPlan,current:{resultHash:compiled.resultHash,observation:compiled.observation},
      priorValidRounds:read.rounds.slice(0,index).map(round=>({resultHash:round.resultHash,observation:round.observation})),completion:'complete',structuralValid:true,
      semanticComplete:true,semanticProgress:'unknown'})
    const best=[...read.rounds].reverse().find(round=>round.resultHash===decision.bestResultHash)??compiled
    if(decision.action!=='revise-length') {
      await persistCandidate(cursor,read.root,read.state,best,decision.action==='ready'?'ready':'needs-attention',decision.reason)
      return resultFor(input.scope,read.snapshot.run.id,true)
    }
    // An already-complete paid round is read locally first. Freshness of a new
    // model request is checked only when a new semantic revision is necessary.
    let prepared: Awaited<ReturnType<typeof prepareRound>>
    try {
      await assertFresh(read.root,read.sourceCaptures,true)
      prepared=await prepareRound(read.root,read.baseline,read.sourceCaptures,read.plan,{text:await exactText(read.snapshot,compiled.draftRef),round:compiled},await remainingConsumptionV2(cursor.snapshot,read.root))
    } catch(error) {
      if(cursor.stopped)throw error
      await persistCandidate(cursor,read.root,read.state,best,'needs-attention',error instanceof Error?error.message:'新修订已停止。')
      return resultFor(input.scope,read.snapshot.run.id,true)
    }
    const state=await savePrepared(cursor,prepared,read.state.rootRef,read.state.roundRefs,read.state)
    return continueWorldviewV2({input,cursor,root:read.root,baseline:read.baseline,captures:read.sourceCaptures,state,prepared,rounds:read.rounds})
  }
  const last=read.rounds[read.rounds.length-1]
  let prepared: Awaited<ReturnType<typeof prepareRound>>
  try {
    await assertFresh(read.root,read.sourceCaptures,true)
    prepared=await prepareRound(read.root,read.baseline,read.sourceCaptures,null,last?{text:await exactText(read.snapshot,last.draftRef),round:last}:undefined,await remainingConsumptionV2(cursor.snapshot,read.root))
  } catch(error) {
    if(cursor.stopped)throw error
    const saved=await retainBestWorldviewDraftV2({cursor,root:read.root,state:read.state,rounds:read.rounds},error instanceof Error?error.message:'新修订已停止。')
    if(saved)return saved
    throw error
  }
  // A prepared handle is ephemeral. Reprepare only an explicitly unissued
  // frame; if bytes/capacity evidence changed, freeze a new contract generation.
  let state: StateV2=read.state
  if(prepared.plan.frameHash!==read.plan.frameHash)state=await savePrepared(cursor,prepared,read.state.rootRef,read.state.roundRefs,read.state)
  else {prepared.plan=read.plan;await ensureActive(cursor)}
  return continueWorldviewV2({input,cursor,root:read.root,baseline:read.baseline,captures:read.sourceCaptures,state,prepared,rounds:read.rounds})
}
/** Candidate edits are an author decision. Count and retain the complete new
 * draft; never send it to the model or erase the AI rounds. */
export async function reviseWorldviewMasterCandidateV2(input:{scope:WorkspaceScope;eventId:number;draft:string}):Promise<string> {
  const event=await db.agentEvents.get(input.eventId)
  if(!event||event.durableRunId==null)throw new Error('候选已不存在。')
  const read=await restoreWorldviewFieldMasterV2(input.scope,event.durableRunId)
  const previous=read.candidates.find(item=>item.event.id===input.eventId)
  if(!previous)throw new Error('候选不属于原运行。')
  const candidate=parseWorldviewFieldCandidateDraftV2(input.draft)
  if(candidate.field!==read.root.task.targetField)throw new Error('作者编辑不能改写其他字段。')
  const observation=observeAuthorLengthV1({plan:read.root.lengthPlan,text:worldviewTargetTextV2(candidate.value),representation:'plain-text',candidateKind:'complete-replacement',
    baseline:{text:worldviewTargetTextV2(read.baseline.values[candidate.field]),representation:'plain-text'}})
  const cursor=new CursorV2(input.scope,read.snapshot)
  const draftRef=await cursor.record('tool-result',input.draft)
  const {candidateHash:_old,...body}=previous.payload
  const payload={...body,worldviewFieldV2:{...body.worldviewFieldV2!,draftRef,lengthObservation:observation,disposition:'author-edited' as const,reason:'作者已编辑；显示实测字数，采用仍由作者决定。'}}
  const candidateHash=await hashCanonicalValue({draft:input.draft,payload})
  const encoded=JSON.stringify({...payload,candidateHash})
  await cursor.write(async expected=>withAgentRunMutationLockV1(expected.run.id,()=>db.transaction('rw',
    agentRunScopeTransactionTablesV1(expected.run.id,db.agentRuns,db.agentRunEvents,db.agentEvents),async()=>{
      let snapshot=await readVerifiedAgentRunInTransactionV1(input.scope,expected.run.id)
      const actual=await db.agentEvents.get(input.eventId)
      if(snapshot.projection.lastSequence!==expected.projection.lastSequence||actual?.payload!==event.payload||actual.content!==event.content)throw new Error('候选被其他页面修改；不覆盖。')
      snapshot=await appendPrivilegedAgentRunEventInTransactionV1(snapshot,localEvent(snapshot,'candidate.revised',{stepId:stepId(read.root),attempt:1,
        previousCandidateHash:previous.payload.candidateHash!,candidateHash}))
      await db.agentEvents.update(input.eventId,{content:input.draft,payload:encoded})
      return {snapshot,value:undefined}
    })))
  return encoded
}
export async function adoptWorldviewMasterCandidateV2(input:MasterAgentCandidateAdoptionRefV1):Promise<MasterAgentCandidateAdoptionResultV1> {
  const read=await restoreWorldviewFieldMasterV2(input.scope,input.runId)
  const candidate=read.candidates.find(item=>item.event.id===input.candidateEventId)
  if(!candidate||input.worldGroupId!==undefined&&input.worldGroupId!==read.root.worldGroupId)throw new Error('作者采用目标不匹配。')
  const step=read.snapshot.projection.steps[stepId(read.root)]
  if(step?.adoptionHash)return {message:'该候选已采用。',adoptionHash:step.adoptionHash,snapshot:read.snapshot}
  const metadata=candidate.payload.worldviewFieldV2!
  if(metadata.disposition==='needs-attention')throw new Error(`该 AI 稿仍需处理：${metadata.reason}。可编辑后明确采用；不会自动发起模型调用。`)
  await assertFresh(read.root,read.sourceCaptures,false)
  const intentHash=await hashCanonicalValue({version:'worldview-field-adoption-v2',runId:input.runId,candidateHash:candidate.payload.candidateHash,
    rootRef:metadata.rootRef,draftRef:metadata.draftRef,lengthObservation:metadata.lengthObservation,authorEdited:metadata.disposition==='author-edited'})
  const snapshot=await withAgentRunMutationLockV1(input.runId,()=>db.transaction('rw',
    agentRunScopeTransactionTablesV1(input.runId,...adoptionTransactionTablesV1('worldviews',undefined,{callerOwned:true}),
      db.agentRuns,db.agentRunEvents,db.agentRunArtifacts,db.agentRunCheckpoints,db.agentEvents,db.agentConversations,
      ...worldviewFieldCaptureTransactionTablesV2()),async()=>{
      let current=await Dexie.Promise.resolve(readVerifiedAgentRunInTransactionV1(input.scope,input.runId))
      const actual=await db.agentEvents.get(input.candidateEventId)
      if(current.projection.lastSequence!==read.snapshot.projection.lastSequence||actual?.payload!==candidate.event.payload||actual.content!==candidate.draft)throw new Error('作者确认前候选或 Run 已变化。')
      current=await Dexie.Promise.resolve(appendPrivilegedAgentRunEventInTransactionV1(current,localEvent(current,'confirmation.recorded',{
        stepId:stepId(read.root),candidateHash:candidate.payload.candidateHash!,decision:'adopt'})))
      current=await Dexie.Promise.resolve(appendPrivilegedAgentRunEventInTransactionV1(current,localEvent(current,'adoption.started',{
        stepId:stepId(read.root),candidateHash:candidate.payload.candidateHash!,intentHash})))
      const transaction=Dexie.currentTransaction
      if(!transaction?.active||transaction.mode!=='readwrite')throw new Error('缺少同一原生采用事务。')
      await Dexie.Promise.resolve(assertFresh(read.root,read.sourceCaptures,false))
      await Dexie.Promise.resolve(adoptRestoredWorldviewFieldCandidateV2({projectId:input.scope.projectId,scope:input.scope,worldGroupId:read.root.worldGroupId,
        snapshot:read.baseline,targetField:read.root.task.targetField,draft:candidate.draft,transaction}))
      if(!transaction.active||Dexie.currentTransaction!==transaction)throw new Error('采用未留在原事务。')
      const adoptionHash=await Dexie.waitFor(hashCanonicalValue({intentHash,draftHash:metadata.draftRef.contentHash}))
      current=await Dexie.Promise.resolve(appendPrivilegedAgentRunEventInTransactionV1(current,localEvent(current,'adoption.committed',{
        stepId:stepId(read.root),candidateHash:candidate.payload.candidateHash!,adoptionHash})))
      current=await Dexie.Promise.resolve(appendPrivilegedAgentRunEventInTransactionV1(current,localEvent(current,'step.succeeded',{stepId:stepId(read.root),attempt:1,outputHash:adoptionHash})))
      await Dexie.Promise.resolve(appendAgentEvent({scope:input.scope,projectId:input.scope.projectId,conversationId:read.root.conversationId,durableRunId:input.runId,
        kind:'confirmation',content:'作者已采用世界基座候选。',payload:{candidateEventId:input.candidateEventId,decision:'adopted',candidateHash:candidate.payload.candidateHash}}))
      if(!transaction.active||Dexie.currentTransaction!==transaction)throw new Error('确认日志未留在原采用事务。')
      return current
    }))
  return {message:'已沿原字段注册表采用世界基座候选。',adoptionHash:snapshot.projection.steps[stepId(read.root)].adoptionHash!,snapshot}
}
export async function rejectWorldviewMasterCandidateV2(input:MasterAgentCandidateAdoptionRefV1):Promise<AgentRunSnapshotV1> {
  const read=await restoreWorldviewFieldMasterV2(input.scope,input.runId)
  const candidate=read.candidates.find(item=>item.event.id===input.candidateEventId)
  if(!candidate)throw new Error('候选不存在或不属于本运行。')
  return withAgentRunMutationLockV1(input.runId,()=>db.transaction('rw',agentRunScopeTransactionTablesV1(input.runId,
    db.agentRuns,db.agentRunEvents,db.agentConversations,db.agentEvents),async()=>{
      let snapshot=await readVerifiedAgentRunInTransactionV1(input.scope,input.runId)
      if(snapshot.projection.lastSequence!==read.snapshot.projection.lastSequence)throw new Error('候选已变化。')
      snapshot=await appendPrivilegedAgentRunEventInTransactionV1(snapshot,localEvent(snapshot,'confirmation.recorded',{stepId:stepId(read.root),candidateHash:candidate.payload.candidateHash!,decision:'reject'}))
      await appendAgentEvent({scope:input.scope,projectId:input.scope.projectId,conversationId:read.root.conversationId,durableRunId:input.runId,
        kind:'confirmation',content:'作者已拒绝世界基座候选。',payload:{candidateEventId:input.candidateEventId,decision:'rejected'}})
      return appendPrivilegedAgentRunEventInTransactionV1(snapshot,localEvent(snapshot,'run.cancelled',{reason:'author-rejected-worldview-field-v2'}))
    }))
}
export async function verifyWorldviewMasterV2(input:{scope:WorkspaceScope;runId:number;now?:number}):Promise<MasterAgentVerificationResultV1> {
  const read=await restoreWorldviewFieldMasterV2(input.scope,input.runId)
  if(read.snapshot.projection.state==='completed')return {accepted:true,codes:[],snapshot:read.snapshot}
  const step=read.snapshot.projection.steps[stepId(read.root)],candidate=read.candidates[0]
  if(!candidate||!step||step.status!=='succeeded'||!step.adoptionHash)return {accepted:false,codes:['run-not-ready'],snapshot:read.snapshot}
  const row=(await readOwnedRows<Worldview>(input.scope,'worldviews',{owner:'world'})).find(item=>(item.worldGroupId??null)===read.root.worldGroupId)
  if(!worldviewFieldCandidateMatchesRowV1(parseWorldviewFieldCandidateDraftV2(candidate.draft),row))return {accepted:false,codes:['worldview-post-state-mismatch'],snapshot:read.snapshot}
  const cursor=new CursorV2(input.scope,read.snapshot)
  await cursor.append('verification.started',{verifierSetVersion:VERIFIER})
  const current=cursor.snapshot
  const receipt=await createVerificationReceiptV1({version:1,runId:input.runId,generation:current.projection.generation,contractHash:current.projection.contractHash,
    contextManifestHashes:[...new Set(current.events.filter(event=>event.type==='context.assembled').map(event=>event.payload.manifestHash))],
    candidateHashes:[candidate.payload.candidateHash!],adoptionEventIds:[],postStateHash:await hashCanonicalValue({field:read.root.task.targetField,value:parseWorldviewFieldCandidateDraftV2(candidate.draft).value}),
    verifierSetVersion:VERIFIER,criteria:current.contract.acceptance.map(criterion=>({id:criterion.id,status:'passed' as const,evidenceRefs:[`candidate:${candidate.payload.candidateHash}`,`adoption:${step.adoptionHash}`]})),acceptedAt:input.now??Date.now()})
  await cursor.append('verification.accepted',{receiptHash:receipt.receiptHash})
  return {accepted:true,codes:[],snapshot:cursor.snapshot,receipt}
}
/** Adopting business state + ledger is atomic. Recovery here only finishes the
 * independent terminal receipt; it never performs a generation request. */
export async function recoverWorldviewMasterAdoptionsV2(scope:WorkspaceScope) {
  const result:{recoveredRunIds:number[];failed:Array<{runId:number;message:string}>}={recoveredRunIds:[],failed:[]}
  for(const row of await readOwnedRows<import('../../types/agent-run').AgentRunRecord>(scope,'agentRuns',{owner:'work'})) {
    if(row.id==null||row.status!=='running')continue
    try {const snapshot=await readAgentRunV1(scope,row.id);if(!isWorldviewFieldRunV2(snapshot)||isWorldviewImportedHistoryV2(snapshot))continue
      if(Object.values(snapshot.projection.steps).some(step=>step.adoptionHash)){await verifyWorldviewMasterV2({scope,runId:row.id});result.recoveredRunIds.push(row.id)}
    }catch(error){result.failed.push({runId:row.id,message:error instanceof Error?error.message:'采用终验恢复失败。'})}
  }
  return result
}

async function ensureActive(cursor:CursorV2):Promise<void> {
  const step=bindingFor(cursor.snapshot).stepId
  if(!cursor.snapshot.projection.steps[step])await cursor.append('step.scheduled',{stepId:step})
  if(cursor.snapshot.projection.steps[step].status==='scheduled')await cursor.append('step.started',{stepId:step,attempt:1})
}

function parseBaselineCapture(raw:string):WorldviewFieldCopilotSnapshot {
  const row=JSON.parse(raw) as Omit<WorldviewFieldCopilotSnapshot,'serialized'>
  assertWorldviewExactKeysV2(row,['id','ragDocumentId','updatedAt','values','foundationState'],'worldview full baseline')
  const body={id:row.id,ragDocumentId:row.ragDocumentId,updatedAt:row.updatedAt,values:row.values}
  return {...body,serialized:JSON.stringify(body),foundationState:row.foundationState}
}

async function proveRoundWire(snapshot:AgentRunSnapshotV1,root:WorldviewFieldRootV2,round:WorldviewFieldRoundV2):Promise<void> {
  const plan=JSON.parse(await exactText(snapshot,round.planRef)) as WorldviewFieldPlanV2
  const wire=JSON.parse(await exactText(snapshot,round.wireRef)) as ReturnType<typeof readPreparedRequestFrameV2>
  const frame=JSON.parse(await exactText(snapshot,round.frameRef)) as {version:string;planHash:string;wireRef:WorldviewExactRefV2;request:WorldviewFieldPlanV2['request'];lengthPlan:TaskLengthPlanV1}
  const raw=await proveRaw(snapshot,root,round.rawRef,round.callId,round.planHash)
  const call=JSON.parse(await exactText(snapshot,round.callRef)) as {version:string;runId:number;generation:number;contractHash:string;
    rootHash:string;planHash:string;frameHash:string;callId:string;nativeRequest:RawV2['nativeRequest'];contextManifestHash:string}
  const {planHash,...body}=plan
  if(plan.version!=='worldview-field-plan-v2'||await hashCanonicalValue(body)!==planHash||planHash!==round.planHash
    ||plan.rootHash!==root.rootHash||canonicalStringify(plan.lengthPlan)!==canonicalStringify(root.lengthPlan)
    ||await hashCanonicalValue(wire)!==plan.frameHash||await sha256Text(wire.wireBody)!==plan.request.wireBodyHash
    ||wire.wireBodyHash!==plan.request.wireBodyHash||await hashCanonicalValue(wire.messages)!==plan.request.messagesHash
    ||await hashCanonicalValue(wire.options)!==plan.request.optionsHash||frame.version!=='worldview-field-frame-v2'
    ||frame.planHash!==planHash||canonicalStringify(frame.wireRef)!==canonicalStringify(round.wireRef)
    ||canonicalStringify(frame.request)!==canonicalStringify(plan.request)||canonicalStringify(frame.lengthPlan)!==canonicalStringify(root.lengthPlan)
    ||call.version!=='worldview-field-call-v2'||call.runId!==snapshot.run.id||call.generation!==raw.generation
    ||call.contractHash!==raw.contractHash||call.rootHash!==root.rootHash||call.planHash!==planHash||call.frameHash!==plan.frameHash
    ||call.callId!==round.callId||raw.frameHash!==plan.frameHash||canonicalStringify(call.nativeRequest)!==canonicalStringify(raw.nativeRequest)
    ||await hashCanonicalValue({runId:snapshot.run.id,generation:raw.generation,rootHash:root.rootHash,planHash,frameHash:plan.frameHash})!==round.callId
    ||raw.nativeRequest!==null&&raw.nativeRequest.requestHash!==plan.request.wireBodyHash
    ||!snapshot.events.some(event=>event.type==='context.assembled'&&event.payload.manifestHash===call.contextManifestHash
      &&event.generation===raw.generation&&event.contractHash===raw.contractHash))throw new Error('准确稿件缺少同一 Root/计划/实际 wire/真实 call 证据。')
}
export async function inspectWorldviewRoundV2(input:{scope:WorkspaceScope;runId:number;roundRef:WorldviewExactRefV2}) {
  const read=await readState(input.scope,input.runId)
  const round=JSON.parse(await exactText(read.snapshot,input.roundRef)) as WorldviewFieldRoundV2
  await proveRoundWire(read.snapshot,read.root,round)
  return round
}

function bindingFor(snapshot:AgentRunSnapshotV1) {
  if(!isWorldviewFieldRunV2(snapshot))throw new Error('缺少准确世界基座 V2 冻结合同。')
  return snapshot.contract.executionBindings[0]
}

export interface EndableWorldviewRunV2 { runId: number; expectedLastSequence: number }
export async function findEndableWorldviewRunV2(input:{scope:WorkspaceScope;conversationId:number}):Promise<EndableWorldviewRunV2|null> {
  const rows=(await readOwnedRows<import('../../types/agent-run').AgentRunRecord>(input.scope,'agentRuns',{owner:'work'}))
    .filter(row=>row.id!=null&&row.conversationId===input.conversationId&&['planned','running','paused','recovering'].includes(row.status))
    .sort((a,b)=>b.updatedAt-a.updatedAt)
  for(const row of rows) {
    const snapshot=await readAgentRunV1(input.scope,row.id!)
    if(!isWorldviewFieldRunV2(snapshot)||isWorldviewImportedHistoryV2(snapshot)
      ||Object.values(snapshot.projection.steps).some(step=>step.adoptionHash))continue
    return {runId:snapshot.run.id,expectedLastSequence:snapshot.projection.lastSequence}
  }
  return null
}
/** An explicit author end is metadata-only. The same ifAvailable target lock
 * proves no other page is still dispatching; CAS prevents cancelling changed work.
 * Full sources/raw/drafts/receipts stay untouched, including unknown requests. */
export async function endWorldviewMasterRunV2(input:{scope:WorkspaceScope;runId:number;conversationId:number;
  worldGroupId:number|null;expectedLastSequence:number}):Promise<AgentRunSnapshotV1> {
  const before=await readAgentRunV1(input.scope,input.runId)
  if(isWorldviewImportedHistoryV2(before))throw new Error('导入的冻结世界基座历史只读；不能结束或重新授权旧运行。')
  if(!isWorldviewFieldRunV2(before)||isWorldviewImportedHistoryV2(before)
    ||before.run.conversationId!==input.conversationId||before.run.workId!==input.scope.workId
    ||before.run.productRuntimeSessionId!=null||(before.run.worldGroupId??null)!==input.worldGroupId
    ||!Number.isSafeInteger(input.expectedLastSequence)||input.expectedLastSequence!==before.projection.lastSequence
    ||!['planned','running','paused','recovering'].includes(before.projection.state)
    ||Object.values(before.projection.steps).some(step=>step.adoptionHash))throw new Error('该原任务不能按当前确认结束；请刷新后确认准确运行。')
  const target=before.contract.executionBindings[0].writeTargets
  const field=target.length===1&&target[0].table==='worldviews'&&target[0].fields.length===1?target[0].fields[0]:null
  if(!field||!WORLDVIEW_GENERATABLE_FIELD_SPECS.some(spec=>spec.field===field))throw new Error('原任务缺少准确字段目标。')
  return targetLock(input.scope,field,input.worldGroupId,()=>withAgentRunMutationLockV1(input.runId,()=>db.transaction('rw',
    agentRunScopeTransactionTablesV1(input.runId,db.agentRuns,db.agentRunEvents,db.agentConversations,db.agentEvents),async()=>{
      let snapshot=await readVerifiedAgentRunInTransactionV1(input.scope,input.runId)
      if(!isWorldviewFieldRunV2(snapshot)||isWorldviewImportedHistoryV2(snapshot)
        ||snapshot.run.conversationId!==input.conversationId||snapshot.projection.lastSequence!==input.expectedLastSequence
        ||!['planned','running','paused','recovering'].includes(snapshot.projection.state)
        ||Object.values(snapshot.projection.steps).some(step=>step.adoptionHash))throw new Error('原任务已推进或停止，未结束新的工作；请刷新后重新确认。')
      snapshot=await appendPrivilegedAgentRunEventInTransactionV1(snapshot,localEvent(snapshot,'run.cancelled',{reason:'author-ended-worldview-field-v2'}))
      await appendAgentEvent({scope:input.scope,projectId:input.scope.projectId,conversationId:input.conversationId,durableRunId:input.runId,
        kind:'message',role:'assistant',content:'作者已明确结束此未完成任务；原答和记录保留，未知请求未重发。',payload:{type:'worldview-field-author-ended-v2',runId:input.runId}})
      return snapshot
    })))
}

/** Existing importer emits these explicit lifecycle events for nonportable
 * checkpoints and cloned completed receipts. Numbers alone confer no authority. */
export function isWorldviewImportedHistoryV2(snapshot:AgentRunSnapshotV1):boolean {
  return snapshot.events.some(event=>event.type==='run.cancelled'&&event.payload.reason==='project-import-nonportable-checkpoint'
    ||event.type==='verification.staled'&&event.payload.reason==='project-import-scope-rebound')
}
/** In-memory conversation projection only. The original imported candidate,
 * raw artifacts, checkpoint and hashes remain immutable in registered tables. */
export async function projectWorldviewImportedHistoryV2(scope:WorkspaceScope|undefined,events:AgentEvent[]):Promise<AgentEvent[]> {
  if(!scope)return events
  const imported=new Map<number,boolean>()
  const result:AgentEvent[]=[]
  for(const event of events) {
    let exact=false
    try {exact=JSON.parse(event.payload).skillId===WORLDVIEW_FIELD_SKILL_V2}catch{/* Other legacy events retain their existing view. */}
    if(event.kind!=='candidate'||!exact||event.durableRunId==null){result.push(event);continue}
    if(!imported.has(event.durableRunId)) {
      try {const snapshot=await readAgentRunV1(scope,event.durableRunId);imported.set(event.durableRunId,isWorldviewImportedHistoryV2(snapshot))}
      catch {imported.set(event.durableRunId,true)}
    }
    result.push(imported.get(event.durableRunId)?{...event,kind:'message',role:'assistant',content:`【冻结历史候选，仅可查看；需要执行时请明确开始新任务】\n${event.content}`}:event)
  }
  return result
}

/** Prepared planned Runs are recoverable before first POST. Legacy finder does
 * not include planned; this exact branch never schedules an unknown result. */
export async function findPreparedWorldviewResumeV2(input:{scope:WorkspaceScope;conversationId:number}):Promise<number|null> {
  const rows=(await readOwnedRows<import('../../types/agent-run').AgentRunRecord>(input.scope,'agentRuns',{owner:'work'}))
    .filter(row=>row.id!=null&&row.conversationId===input.conversationId&&row.status==='planned').sort((a,b)=>b.updatedAt-a.updatedAt)
  for(const row of rows) {
    const snapshot=await readAgentRunV1(input.scope,row.id!)
    if(!isWorldviewFieldRunV2(snapshot)||isWorldviewImportedHistoryV2(snapshot))continue
    await readState(input.scope,row.id!);return row.id!
  }
  return null
}

/** Only a genuine own-key request constraint reaches here. Forecasts, config
 * defaults, Skill metadata and author word goals never become consumption caps. */
async function remainingConsumptionV2(snapshot:AgentRunSnapshotV1,root:WorldviewFieldRootV2):Promise<number|undefined> {
  const cap=root.task.worldviewFieldPromptV2.request.maxTokens
  if(cap===undefined)return undefined
  const evidence=await budgetEvidenceFor(snapshot)
  if(evidence.calls===0)return cap
  if(evidence.observedOutputTokens===null)throw new Error('服务未报告实际输出用量，不能保证作者明确消费约束；保留原稿，不新增调用。')
  const remaining=cap-evidence.observedOutputTokens
  if(remaining<1)throw new Error('已达到作者明确输出消费约束；保留全部稿件，不继续字数修订。')
  return remaining
}

export interface WorldviewReceivedRunV2 { runId: number; field: string }
export interface WorldviewReceivedContentV2 extends WorldviewReceivedRunV2 {
  text: string
  completion: PublicAIResponseV2['completion']
  kind: 'response' | 'prefix'
}

/** Discover only metadata here. Public text is read on the author's explicit
 * action, including after an author-ended run; this never resumes a request. */
export async function findWorldviewReceivedRunV2(input: {
  scope: WorkspaceScope; conversationId: number; worldGroupId: number | null
}): Promise<WorldviewReceivedRunV2 | null> {
  const rows = (await readOwnedRows<import('../../types/agent-run').AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => row.id != null && row.conversationId === input.conversationId
      && (row.worldGroupId ?? null) === input.worldGroupId && row.status !== 'completed')
    .sort((a, b) => b.updatedAt - a.updatedAt || b.id! - a.id!)
  for (const row of rows) {
    const snapshot = await readAgentRunV1(input.scope, row.id!)
    if (!isWorldviewFieldRunV2(snapshot) || isWorldviewImportedHistoryV2(snapshot)
      || snapshot.events.some(event => event.type === 'candidate.persisted')
      || !snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response')) continue
    const targets = snapshot.contract.executionBindings[0].writeTargets
    const field = targets.length === 1 && targets[0].table === 'worldviews' && targets[0].fields.length === 1 ? targets[0].fields[0] : null
    if (field && WORLDVIEW_GENERATABLE_FIELD_SPECS.some(spec => spec.field === field)) return { runId: snapshot.run.id, field }
  }
  return null
}

/** Return public model text only, proven through this owned Root/current call
 * and immutable artifact membership. Wire, headers and hidden reasoning never
 * leave this reader; bad JSON is not promoted to a candidate. */
export async function readWorldviewReceivedContentV2(input: {
  scope: WorkspaceScope; conversationId: number; worldGroupId: number | null; runId: number; field: string
}): Promise<WorldviewReceivedContentV2 | null> {
  const read = await readState(input.scope, input.runId)
  if (read.root.conversationId !== input.conversationId || read.root.worldGroupId !== input.worldGroupId
    || read.root.task.targetField !== input.field) throw new Error('不能跨原会谈、世界或字段查看已收到的内容。')
  if (!read.state.callRef) return null
  const call = JSON.parse(await exactText(read.snapshot, read.state.callRef)) as {
    version: string; runId: number; generation: number; contractHash: string; rootHash: string; planHash: string
    frameHash: string; callId: string; contextManifestHash: string; nativeRequest: RawV2['nativeRequest']
  }
  assertWorldviewExactKeysV2(call, ['version', 'runId', 'generation', 'contractHash', 'rootHash', 'planHash', 'frameHash', 'callId', 'contextManifestHash', 'nativeRequest'], 'worldview public call')
  if (call.version !== 'worldview-field-call-v2' || call.runId !== input.runId || call.rootHash !== read.root.rootHash
    || call.planHash !== read.plan.planHash || call.frameHash !== read.plan.frameHash
    || call.callId !== await hashCanonicalValue({ runId: input.runId, generation: call.generation,
      rootHash: call.rootHash, planHash: call.planHash, frameHash: call.frameHash })
    || read.snapshot.events.filter(event => event.type === 'model.requested' && event.payload.bindingHash === call.callId
      && event.generation === call.generation && event.contractHash === call.contractHash).length !== 1
    || !read.snapshot.events.some(event => event.type === 'context.assembled' && event.payload.manifestHash === call.contextManifestHash
      && event.generation === call.generation && event.contractHash === call.contractHash)) throw new Error('已收到的内容缺少原 Root 与真实调用证据。')
  const events = read.snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === 'raw-response' && event.payload.stepId === stepId(read.root)
    && event.generation === call.generation && event.contractHash === call.contractHash)
  for (const event of [...events].reverse()) {
    if (event.type !== 'evidence.artifact.recorded') continue
    const raw = JSON.parse(await exactText(read.snapshot, event.payload)) as RawV2
    if (raw.version !== 'worldview-field-response-v2' || raw.callId !== call.callId) continue
    await proveRawEnvelopeV2(read.snapshot, read.root, event.payload, call.callId, call.planHash)
    if (raw.generation !== call.generation || raw.contractHash !== call.contractHash || raw.frameHash !== call.frameHash
      || canonicalStringify(raw.nativeRequest) !== canonicalStringify(call.nativeRequest)
      || typeof raw.response.text !== 'string' || !['complete', 'incomplete', 'failed', 'unknown'].includes(raw.response.completion)) throw new Error('已收到的内容与原调用不一致。')
    return { runId: input.runId, field: input.field, text: raw.response.text, completion: raw.response.completion, kind: 'response' }
  }
  let text = '', previous: string | null = null, count = 0
  for (const event of events) {
    if (event.type !== 'evidence.artifact.recorded') continue
    const delta = JSON.parse(await exactText(read.snapshot, event.payload)) as { version: string; callId: string; previousDeltaHash: string | null; text: string }
    if (delta.version !== 'worldview-field-delta-v2' || delta.callId !== call.callId) continue
    assertWorldviewExactKeysV2(delta, ['version', 'callId', 'previousDeltaHash', 'text'], 'worldview public delta')
    if (typeof delta.text !== 'string' || delta.previousDeltaHash !== previous) throw new Error('已收到的公开片段链不完整。')
    text += delta.text; previous = event.payload.contentHash; count += 1
  }
  return count ? { runId: input.runId, field: input.field, text, completion: 'unknown', kind: 'prefix' } : null
}

/** Sole registered model caller. Uses the exact prepared handle and actual
 * route; neither reparses capacity defaults nor prepares a second request. */
async function executePreparedWorldviewFieldV2(input: {
  binding: import('../../types/agent-run').AgentRunFormalAIEntryBindingV1
  skill: import('../skill-registry').AgentSkillDefinitionV1
  resolution: import('../../ai/client').AIRequestConfigResolution
  configOverrides?: Pick<import('../../types').AIConfig, 'temperature'>
  messages: ChatMessage[]; options: import('../../ai/client').ChatRequestOptions
  bound: import('../../ai/client').BoundPreparedAIRequestV2
  signal?: AbortSignal; result: ChatResult; projectId: number
}): Promise<string> {
  return executeFrozenFormalAIEntryV1('world.worldview-field.v2', input.binding, input.skill,
    'src/lib/agent/run/worldview-field-v2-durable.ts', input.messages, input.resolution.config,
    { category: 'agent.world-origin.worldview-field.v2', projectId: input.projectId,
      ...(input.configOverrides ? { configOverrides: input.configOverrides } : {}),
      transportRetryPolicy: 'none', contextOverflowPolicy: 'reject' }, input.signal, input.result,
    { ...input.options, preparedRequestV2: input.bound }, input.resolution)
}
