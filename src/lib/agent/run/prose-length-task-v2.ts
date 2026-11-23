import { db } from '../../db/schema'
import type { Chapter, ChatMessage, WorkspaceScope } from '../../types'
import type { TaskLengthPlanV1, ContextMaterialAllocationV2, AgentRunEventTypeV1, AgentRunEventPayloadByTypeV1 } from '../../types/agent-run'
import type { UseAIStreamReturn } from '../../../hooks/useAIStream'
import { useAIConfigStore } from '../../../stores/ai-config'
import { usePromptStore } from '../../../stores/prompt'
import { estimateTokens } from '../../ai/context-budget'
import { readBoundCodexReceiptV1, acknowledgeBoundCodexReceiptV1 } from '../../ai/codex-transport'
import { parseTaskLengthPlanV1 } from '../../ai/author-length-intent'
import { observeAuthorLengthV1, planAuthorLengthRevisionV1, authorLengthRevisionInstructionV1, type AuthorLengthObservationV1 } from '../../ai/author-length-revision'
import { resolveRequestConfig, freezeAIRequestAssessmentContextV2, prepareAIRequestV2, bindPreparedRequestObserversV2,
  readPreparedRequestFrameV2, readPreparedNativeRequestRefV2, type StreamResult, type PublicAIResponseV2 } from '../../ai/client'
import { hashChapterText, normalizeChapterText, sha256Text } from '../../ai/chapter-memory/text-normalization'
import { normalizeProseForEditorV1, plainTextToHtml } from '../../utils/html'
import { assertRecordInScope, readOwnedRows } from '../../workspace/scope'
import { assertWorkspaceContentRevisionFreshV1, parseWorkspaceContentRevisionV1, type WorkspaceContentRevisionVectorV1 } from '../../authoring/content-revision'
import { buildChapterInformationBoundaryV1, parseInformationBoundaryManifestV1, validateProseInformationBoundaryV1, type InformationBoundaryManifestV1 } from '../information-boundary'
import { observeDuplicatedProseFrameV1 } from '../../prose/provider-frame-observation'
import type { ProseGatewayAssemblyV1 } from '../../prose/gateway-context'
import type { ContextGatewayExecutionV1 } from '../../context-gateway/execution'
import { createContextGatewayToolSessionV1, isContextGatewayResourceAllowedV1 } from '../../context-gateway/tool-session'
import { lookupContextResourceMetadataV1 } from '../../context-gateway/resource-metadata'
import { createContextAccessPolicyForExecutionV1 } from '../../context-gateway/skill-policy'
import { getAgentSkillV1 } from '../skill-registry'
import { assertAgentSkillExecutionBindingIntegrityV2, projectFrozenAgentSkillDefinitionV1 } from '../execution-binding'
import { createChapterGenerationNode } from '../../generation/chapter-generation-node'
import { recordAgentRunArtifactV1, readAgentRunArtifactExactV1 } from '../../memory/artifact-store'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, reviseAgentRunContractV1, type AgentRunSnapshotV1 } from './event-store'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { canonicalStringify, hashCanonicalValue } from './hash'
import { parseAgentRunContractV3 } from './contract'
import { buildProseGenerationRunContractV4, isProseGenerationRunV4, beginProseGenerationGatewayStepV1,
  finalizeProseGenerationGatewayStepV2, PROSE_GENERATION_STEP_ID_V1, persistProseGenerationCandidateV1, readLatestProseGenerationCandidateV1,
  type ProseGenerationCandidateV1, type ProseGatewayAttemptV1, type ProseTaskRawResponseV2 } from './prose-generation-durable'

export interface ProseTaskRefV2 { artifactKind: 'source-snapshot' | 'rendered-request' | 'tool-result' | 'raw-response'; contentHash: string; byteLength: number; stepId?: string; attempt?: number }
type FrozenContext = { assembly: Omit<ProseGatewayAssemblyV1, 'contextGatewayExecution'>; execution: Omit<ContextGatewayExecutionV1, 'session'> }
interface Root {
  version: 'prose-length-root-v2'; portable: false; scope: WorkspaceScope; worldGroupId: number | null
  chapterId: number; outlineNodeId: number; operation: 'generate' | 'continue'; chapterTitle: string
  lengthPlan: TaskLengthPlanV1; contentRevision: WorkspaceContentRevisionVectorV1; informationBoundary: InformationBoundaryManifestV1
  perspectiveFromChapter: boolean; sourceTextHash: string; baselineRef: ProseTaskRefV2; contextRef: ProseTaskRefV2; messagesRef: ProseTaskRefV2
  templateHash: string; material: ContextMaterialAllocationV2; temperature: number | null; rootHash: string
}
interface Plan {
  version: 'prose-length-plan-v2'; rootHash: string; previousPlanHash: string | null; round: number
  mode: 'initial' | 'revise-length' | 'continue-incomplete'; priorDraftRef: ProseTaskRefV2 | null
  request: Awaited<ReturnType<typeof prepareAIRequestV2>>['evidence']; frameHash: string; planHash: string
}
interface Round {
  version: 'prose-length-round-v2'; runId: number; generation: number; rootHash: string; planRef: ProseTaskRefV2; frameRef: ProseTaskRefV2
  rawRef: ProseTaskRefV2; draftRef: ProseTaskRefV2; observation: AuthorLengthObservationV1; manifestHash: string
  completion: PublicAIResponseV2['completion']; resultHash: string
}
interface State {
  version: 'prose-length-state-v2'; rootRef: ProseTaskRefV2; planRef: ProseTaskRefV2; frameRef: ProseTaskRefV2
  roundRefs: ProseTaskRefV2[]; callRef: ProseTaskRefV2 | null; pendingStateRef: ProseTaskRefV2 | null; resultRef: ProseTaskRefV2 | null
}
export interface ProseLengthTaskResultV2 {
  runId: number; snapshot: AgentRunSnapshotV1; root: Root; rootRef: ProseTaskRefV2; roundRefs: ProseTaskRefV2[]
  selectedRoundRef: ProseTaskRefV2 | null; draftRef: ProseTaskRefV2 | null; text: string; observation: AuthorLengthObservationV1 | null
  manifestHash: string | null; disposition: 'ready' | 'needs-attention' | 'raw-only'; reason: string
}
export interface ProseTaskCandidateEvidenceV2 {
  version: 'prose-task-candidate-v2'
  rootRef: ProseTaskRefV2
  selectedRoundRef: ProseTaskRefV2
  roundRefs: ProseTaskRefV2[]
  draftRef: ProseTaskRefV2
  lengthPlan: TaskLengthPlanV1
  observation: AuthorLengthObservationV1
  disposition: 'ready' | 'needs-attention' | 'author-edited'
  reason: string
}
export interface StartProseLengthTaskV2 {
  chapterId: number; chapterTitle: string; operation: 'generate' | 'continue'; worldGroupId: number | null
  messages: ChatMessage[]; assembled: ProseGatewayAssemblyV1; lengthPlan: TaskLengthPlanV1
  contentRevision: WorkspaceContentRevisionVectorV1; informationBoundary: InformationBoundaryManifestV1
  temperature?: number; perspectiveFromChapter?: boolean
}
export interface RunProseLengthTaskV2 {
  scope: WorkspaceScope; task?: StartProseLengthTaskV2; runId?: number; ai: Pick<UseAIStreamReturn, 'start'>; signal?: AbortSignal
  onProgress?: (value: { runId: number; rounds: number; words: number; status: string }) => void
}
function exact(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== keys.sort().join('|')) throw new Error(`${label} 字段无效。`)
}
async function refFor(artifactKind: ProseTaskRefV2['artifactKind'], text: string): Promise<ProseTaskRefV2> {
  return { artifactKind, contentHash: await sha256Text(text), byteLength: new TextEncoder().encode(text).byteLength }
}
class ProseCursor {
  stopped = false
  failure: unknown
  constructor(readonly scope: WorkspaceScope, public snapshot: AgentRunSnapshotV1) {}
  async change<T>(operation: (snapshot: AgentRunSnapshotV1) => Promise<{ snapshot: AgentRunSnapshotV1; value: T }>): Promise<T> {
    if (this.stopped) throw new Error('正文证据保存已停止，请回读原运行；不会重发。')
    try { const saved = await operation(this.snapshot); this.snapshot = saved.snapshot; return saved.value }
    catch (error) { this.stopped = true; this.failure = error; throw error }
  }
  record(artifactKind: ProseTaskRefV2['artifactKind'], content: string, step = false): Promise<ProseTaskRefV2> {
    return this.change(async snapshot => {
      const saved = await recordAgentRunArtifactV1({ scope: this.scope, runId: snapshot.run.id, artifactKind, content,
        expectedLastSequence: snapshot.projection.lastSequence, ...(step ? { stepId: PROSE_GENERATION_STEP_ID_V1, attempt: 1 } : {}) })
      return { snapshot: saved.snapshot, value: { artifactKind, contentHash: saved.artifact.contentHash, byteLength: saved.artifact.byteLength,
        ...(step ? { stepId: PROSE_GENERATION_STEP_ID_V1, attempt: 1 } : {}) } }
    })
  }
  append<T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
    return this.change(async snapshot => ({ value: undefined, snapshot: await appendAgentRunEventV1({ scope: this.scope,
      runId: snapshot.run.id, expectedLastSequence: snapshot.projection.lastSequence, type, payload }) }))
  }
  async checkpoint(state: State) {
    const stateRef = await this.record('tool-result', canonicalStringify(state))
    await this.change(async snapshot => ({ value: undefined, snapshot: (await createAgentRunCheckpointV1({ scope: this.scope, runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence, resumePayload: { version: 'prose-length-checkpoint-v2', portable: false, stateRef } })).snapshot }))
  }
}
async function readExact(snapshot: AgentRunSnapshotV1, ref: ProseTaskRefV2) {
  exact(ref, ['artifactKind', 'contentHash', 'byteLength', ...(ref?.stepId === undefined ? [] : ['stepId', 'attempt'])], '正文原件引用')
  if (!snapshot.events.some(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === ref.artifactKind
    && event.payload.contentHash === ref.contentHash && event.payload.byteLength === ref.byteLength
    && event.payload.stepId === ref.stepId && event.payload.attempt === ref.attempt)) throw new Error('正文原件不属于当前作用域运行。')
  const text = await readAgentRunArtifactExactV1({ projectId: snapshot.run.projectId, artifactKind: ref.artifactKind, contentHash: ref.contentHash })
  if (await sha256Text(text) !== ref.contentHash || new TextEncoder().encode(text).byteLength !== ref.byteLength) throw new Error('正文原件 hash 或长度无效。')
  return text
}
async function readBaseline(snapshot: AgentRunSnapshotV1, root: Root) {
  const baseline = JSON.parse(await readExact(snapshot, root.baselineRef)) as { version: string; content: string }
  exact(baseline, ['version', 'content'], '正文冻结原稿')
  if (baseline.version !== 'prose-task-baseline-v2' || typeof baseline.content !== 'string'
    || await hashChapterText(baseline.content) !== root.sourceTextHash) throw new Error('正文冻结原稿与来源指纹不一致。')
  return baseline.content
}
async function observeDraft(snapshot: AgentRunSnapshotV1, root: Root, text: string) {
  return observeAuthorLengthV1({ plan: root.lengthPlan, text, representation: 'plain-text',
    candidateKind: root.operation === 'continue' ? 'additional-fragment' : 'complete-replacement',
    baseline: { text: normalizeChapterText(await readBaseline(snapshot, root)), representation: 'plain-text' } })
}
function category(root: Root) { return root.operation === 'continue' ? 'chapter.continue' : 'chapter.content' }
function skillId(root: Root) { return root.operation === 'continue' ? 'prose.continue.v2' : 'prose.generate.v2' }
async function assertFresh(root: Root, context: FrozenContext, template = true) {
  await assertWorkspaceContentRevisionFreshV1(root.contentRevision, { scope: root.scope, worldGroupId: root.worldGroupId })
  const chapter = await db.chapters.get(root.chapterId), project = await db.projects.get(root.scope.projectId)
  if (!chapter || !await assertRecordInScope(root.scope, 'chapters', chapter, { owner: 'work' }) || chapter.outlineNodeId !== root.outlineNodeId
    || project?.activeWorkId !== root.scope.workId || project.activeWorldId !== root.scope.worldId
    || await hashChapterText(chapter.content ?? '') !== root.sourceTextHash) throw new Error('正文目标、活动作品或原稿已变化。')
  const boundary = await buildChapterInformationBoundaryV1({ scope: root.scope, chapterId: root.chapterId, outlineNodeId: root.outlineNodeId,
    worldGroupId: root.worldGroupId, perspectiveCharacterId: root.informationBoundary.perspectiveCharacterId ?? null })
  if (boundary.manifestHash !== root.informationBoundary.manifestHash) throw new Error('正文信息边界已变化。')
  if (template && await hashCanonicalValue(usePromptStore.getState().getActive(category(root))) !== root.templateHash) throw new Error('本次正文模板已变化，不继续付费修订。')
  const session = await createContextGatewayToolSessionV1({ scope: { ...root.scope, worldGroupId: root.worldGroupId, chapterId: root.chapterId,
    characterId: root.informationBoundary.perspectiveCharacterId ?? null }, policy: createContextAccessPolicyForExecutionV1(getAgentSkillV1(skillId(root), 'prose')), freezeProviderReads: true })
  if (session.scopeFingerprint !== context.execution.contextPacket.scopeFingerprint || session.policyHash !== context.execution.contextPacket.policyHash) throw new Error('正文来源作用域或读取策略已变化。')
  const decisions = [...context.execution.retrievalTrace.mandatory, ...context.execution.retrievalTrace.autoSelected]
  for (const binding of session.providers) {
    const selected = decisions.filter(item => item.sourceKey === binding.source.key)
    const metadata = await lookupContextResourceMetadataV1({ provider: binding.provider, scope: session.scope, resourceKeys: selected.map(item => item.resourceKey) })
    for (const decision of selected) {
      const current = metadata.get(decision.resourceKey)
      if (!isContextGatewayResourceAllowedV1(session, decision.resourceKey) || !current || current.automaticSelectionEnabled === false
        || current.contentHash !== decision.contentHash || current.contentRevision !== decision.revision
        || current.policyHash !== decision.policyHash || current.policyRevision !== decision.policyRevision) throw new Error('正文必读资料或作者读取设置已变化。')
    }
  }
}
async function prepareRound(root: Root, context: FrozenContext, baseMessages: ChatMessage[], previous: Plan | null,
  mode: Plan['mode'], prior: { ref: ProseTaskRefV2; text: string; observation: AuthorLengthObservationV1 } | null) {
  const messages = structuredClone(baseMessages)
  if (prior) messages.push({ role: 'user', content: mode === 'continue-incomplete'
    ? `服务已确认上次正常停笔，下面前缀已保存。只续写尚未完成的正文，不重复前缀；原篇幅计划约束完整任务，不对本片段重新套默认字数。\n【已保存前缀】\n${prior.text}`
    : `${authorLengthRevisionInstructionV1(root.lengthPlan, prior.observation)}\n【上一完整稿】\n${prior.text}` })
  if (!messages.some(message => message.content.includes(context.execution.contextPacket.content))) throw new Error('正文请求缺少完整登记资料。')
  const meta = { category: category(root), ...(root.temperature === null ? {} : { configOverrides: { temperature: root.temperature } }) }
  const resolution = resolveRequestConfig(useAIConfigStore.getState().config, meta)
  const routeGuard = () => {
    const current = resolveRequestConfig(useAIConfigStore.getState().config, meta)
    return canonicalStringify({ ...current, config: { ...current.config, modelCapacity: undefined } })
  }
  const frozenRoute = routeGuard()
  const assertCurrent = () => { if (routeGuard() !== frozenRoute) throw new Error('正文路由或采样参数已变化，不派发原请求。') }
  const prepared = await prepareAIRequestV2({ resolution, assessmentContext: await freezeAIRequestAssessmentContextV2(resolution),
    messages, stream: true, options: {}, contextMaterial: root.material, lengthPlan: root.lengthPlan, explicitConstraints: null })
  if (previous && previous.request.routeHash !== prepared.evidence.routeHash) throw new Error('正文路由已变化；原稿保留，不切模型继续付费。')
  const frame = readPreparedRequestFrameV2(prepared.handle)
  const body = { version: 'prose-length-plan-v2' as const, rootHash: root.rootHash, previousPlanHash: previous?.planHash ?? null,
    round: previous ? previous.round + 1 : 0, mode, priorDraftRef: prior?.ref ?? null, request: prepared.evidence, frameHash: await hashCanonicalValue(frame) }
  return { plan: { ...body, planHash: await hashCanonicalValue(body) }, frame, prepared, resolution, assertCurrent }
}
function contractInput(root: Root, plan: Plan) {
  return { scope: root.scope, worldGroupId: root.worldGroupId, chapterId: root.chapterId, operation: root.operation,
    planHash: plan.planHash, material: root.material, request: plan.request, lengthPlan: root.lengthPlan, sourceTextHash: root.sourceTextHash,
    contentRevisionHash: root.contentRevision.vectorHash, informationBoundaryHash: root.informationBoundary.manifestHash, explicitConstraints: null }
}
async function savePrepared(cursor: ProseCursor, root: Root, rootRef: ProseTaskRefV2, prepared: Awaited<ReturnType<typeof prepareRound>>, previous?: State): Promise<State> {
  const planRef = await cursor.record('tool-result', canonicalStringify(prepared.plan)), frameRef = await cursor.record('rendered-request', canonicalStringify(prepared.frame))
  const state: State = { version: 'prose-length-state-v2', rootRef, planRef, frameRef, roundRefs: [...previous?.roundRefs ?? []], callRef: null, pendingStateRef: null, resultRef: null }
  if (previous) {
    const nextRef = await cursor.record('tool-result', canonicalStringify(state))
    await cursor.checkpoint({ ...previous, pendingStateRef: nextRef })
    await cursor.change(async snapshot => ({ value: undefined, snapshot: await reviseAgentRunContractV1({ scope: cursor.scope, runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence, contract: await buildProseGenerationRunContractV4(contractInput(root, prepared.plan)) }) }))
  }
  await cursor.checkpoint(state)
  return state
}
async function publicPrefix(snapshot: AgentRunSnapshotV1, state: State) {
  const plan = JSON.parse(await readExact(snapshot, state.planRef)) as Plan
  let text = '', head: string | null = null, full: string | null = null
  for (const event of snapshot.events) {
    if (event.generation !== snapshot.projection.generation || event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'raw-response') continue
    const body = JSON.parse(await readExact(snapshot, event.payload as ProseTaskRefV2)) as Record<string, unknown>
    if (body.planHash !== plan.planHash) continue
    if (body.version === 'prose-task-response-v2' && body.requestHash === plan.request.requestHash && body.runId === snapshot.run.id) {
      const raw = body as unknown as ProseTaskRawResponseV2
      if (typeof raw.response.text !== 'string') throw new Error('正文公开原答无效。')
      full = raw.response.text
    } else if (body.version === 'prose-task-delta-v2') {
      exact(body, ['version', 'planHash', 'previousDeltaHash', 'text'], '正文公开前缀')
      if (body.previousDeltaHash !== head || typeof body.text !== 'string') throw new Error('正文前缀顺序不一致。')
      text += body.text; head = event.payload.contentHash
    }
  }
  return full ?? text
}
async function result(cursor: ProseCursor, root: Root, state: State, selected: ProseTaskRefV2 | null,
  disposition: ProseLengthTaskResultV2['disposition'], reason: string, save = true): Promise<ProseLengthTaskResultV2> {
  if (save) {
    state.resultRef = await cursor.record('tool-result', canonicalStringify({ selected, disposition, reason })); await cursor.checkpoint(state)
    if (disposition === 'raw-only' && cursor.snapshot.projection.state === 'running') await cursor.append('run.paused', { reason: 'prose-length-stopped-with-preserved-raw', recoverable: false })
    else if (disposition === 'raw-only' && cursor.snapshot.projection.state === 'planned') await cursor.append('run.cancelled', { reason: 'prose-length-stopped-before-dispatch' })
  }
  const round = selected ? JSON.parse(await readExact(cursor.snapshot, selected)) as Round : null
  return { runId: cursor.snapshot.run.id, snapshot: cursor.snapshot, root, rootRef: state.rootRef, roundRefs: [...state.roundRefs], selectedRoundRef: selected,
    draftRef: round?.draftRef ?? null, text: round ? await readExact(cursor.snapshot, round.draftRef) : await publicPrefix(cursor.snapshot, state), observation: round?.observation ?? null,
    manifestHash: round?.manifestHash ?? null, disposition, reason }
}
async function assertPlanBinding(snapshot: AgentRunSnapshotV1, root: Root, plan: Plan, generation: number) {
  const accepted = snapshot.events.find(event => event.generation === generation && (event.type === 'contract.accepted' || event.type === 'contract.revised'))
  if (!accepted || accepted.type !== 'contract.accepted' && accepted.type !== 'contract.revised') throw new Error('正文原答缺少本代正式合同。')
  if (typeof accepted.payload.contractJson !== 'string') throw new Error('正文原代合同缺少完整快照。')
  const contract = parseAgentRunContractV3(JSON.parse(accepted.payload.contractJson))
  const expected = await hashCanonicalValue({ version: 'prose-prepared-frontier-v4', scope: root.scope, chapterId: root.chapterId,
    worldGroupId: root.worldGroupId, planHash: plan.planHash, requestHash: plan.request.requestHash,
    materialAllocationHash: root.material.allocationHash, lengthPlan: root.lengthPlan, sourceTextHash: root.sourceTextHash,
    contentRevisionHash: root.contentRevision.vectorHash, informationBoundaryHash: root.informationBoundary.manifestHash })
  const binding = contract.executionBindings[0]
  if (contract.executionBindings.length !== 1 || binding.skillId !== skillId(root) || binding.taskRequest?.planHash !== plan.planHash
    || binding.taskRequest.materialAllocationHash !== root.material.allocationHash || contract.budget.allocation?.planHash !== plan.planHash
    || contract.runtimeBindingHash !== expected || contract.scope.chapterIds?.[0] !== root.chapterId) throw new Error('正文计划与本代冻结合同不一致。')
  await assertAgentSkillExecutionBindingIntegrityV2(binding)
  return accepted.contractHash
}
async function roundHistory(snapshot: AgentRunSnapshotV1, root: Root, state: State): Promise<Array<{ ref: ProseTaskRefV2; round: Round }>> {
  const result: Array<{ ref: ProseTaskRefV2; round: Round }> = []
  for (const ref of state.roundRefs) {
    const round = JSON.parse(await readExact(snapshot, ref)) as Round
    const text = await readExact(snapshot, round.draftRef), plan = JSON.parse(await readExact(snapshot, round.planRef)) as Plan
    const raw = JSON.parse(await readExact(snapshot, round.rawRef)) as ProseTaskRawResponseV2
    const frame = JSON.parse(await readExact(snapshot, round.frameRef)) as ReturnType<typeof readPreparedRequestFrameV2>
    const { planHash, ...planBody } = plan
    const contractHash = await assertPlanBinding(snapshot, root, plan, round.generation)
    if (await hashCanonicalValue(planBody) !== planHash || await hashCanonicalValue(frame) !== plan.frameHash
      || await sha256Text(frame.wireBody) !== plan.request.wireBodyHash || await hashCanonicalValue(frame.messages) !== plan.request.messagesHash
      || await hashCanonicalValue(frame.options) !== plan.request.optionsHash || raw.contractHash !== contractHash
      || raw.runId !== snapshot.run.id || raw.wireBodyHash !== plan.request.wireBodyHash
      || !snapshot.events.some(event => event.generation === round.generation && event.type === 'model.responded'
        && event.payload.stepId === PROSE_GENERATION_STEP_ID_V1 && event.payload.outputHash === round.rawRef.contentHash)) throw new Error('正文修订缺少实际请求和原答的同代证据。')
    const prior = plan.priorDraftRef ? await readExact(snapshot, plan.priorDraftRef) : ''
    const derived = normalizeProseForEditorV1(plan.mode === 'continue-incomplete' ? [prior, raw.response.text].filter(Boolean).join('\n') : raw.response.text)
    const observed = await observeDraft(snapshot, root, text)
    if (round.version !== 'prose-length-round-v2' || round.runId !== snapshot.run.id || round.rootHash !== root.rootHash
      || text !== derived || await sha256Text(text) !== round.resultHash || canonicalStringify(observed) !== canonicalStringify(round.observation)
      || raw.planHash !== plan.planHash || raw.requestHash !== plan.request.requestHash || raw.generation !== round.generation || raw.response.completion !== round.completion) throw new Error('正文修订原答、来源或计数证明不一致。')
    result.push({ ref, round })
  }
  return result
}
async function retainBest(cursor: ProseCursor, root: Root, state: State, reason: string) {
  const stored = await roundHistory(cursor.snapshot, root, state)
  const valid = stored.filter(item => item.round.completion === 'complete')
  const selected = valid.reduce<typeof valid[number] | null>((best, next) => !best || root.lengthPlan.mode !== 'explicit'
    || next.round.observation.distance! <= best.round.observation.distance! ? next : best, null)
  return result(cursor, root, state, selected?.ref ?? stored[stored.length - 1]?.ref ?? null, selected ? 'needs-attention' : 'raw-only', reason)
}
async function execute(input: RunProseLengthTaskV2, cursor: ProseCursor, root: Root, context: FrozenContext, baseMessages: ChatMessage[], state: State,
  prepared?: Awaited<ReturnType<typeof prepareRound>>, recovered?: { raw: ProseTaskRawResponseV2; attempt: ProseGatewayAttemptV1 }) {
  while (true) {
    const allHistory = await roundHistory(cursor.snapshot, root, state)
    const compiled = allHistory.find(item => item.round.planRef.contentHash === state.planRef.contentHash)
    const history = allHistory.filter(item => item !== compiled)
    const valid = history.filter(item => item.round.completion === 'complete')
    const best = valid.reduce<typeof valid[number] | null>((best, next) => !best || root.lengthPlan.mode !== 'explicit'
      || next.round.observation.distance! <= best.round.observation.distance! ? next : best, null)
    const plan: Plan = prepared?.plan ?? JSON.parse(await readExact(cursor.snapshot, state.planRef)) as Plan
    let raw: ProseTaskRawResponseV2 | undefined, rawRef: ProseTaskRefV2 | undefined, manifestHash = ''
    let text = ''
    try {
      input.signal?.throwIfAborted()
      const priorText = plan.priorDraftRef ? await readExact(cursor.snapshot, plan.priorDraftRef) : ''
      const observe = async (received: ProseTaskRawResponseV2, attempt: ProseGatewayAttemptV1) => {
        raw = received
        text = normalizeProseForEditorV1(plan.mode === 'continue-incomplete' ? [priorText, raw.response.text].filter(Boolean).join('\n') : raw.response.text)
        const finalized = await cursor.change(async snapshot => {
          const saved = await finalizeProseGenerationGatewayStepV2({ scope: input.scope, snapshot, attempt, raw: received, candidateText: text })
          return { snapshot: saved.snapshot, value: saved }
        })
        rawRef = finalized.rawRef; manifestHash = finalized.manifest.manifestHash
      }
      if (recovered) { await observe(recovered.raw, recovered.attempt); recovered = undefined }
      else {
        if (!prepared) throw new Error('没有已验证的未派发正文请求。')
        const frame = prepared.frame, frozen = prepared.resolution
        let attempt: ProseGatewayAttemptV1 | undefined, deltaHead: string | null = null
        const bound = bindPreparedRequestObserversV2(prepared.prepared.handle, {
          beforeDispatch: async () => {
            input.signal?.throwIfAborted(); prepared!.assertCurrent(); await assertFresh(root, context); prepared!.assertCurrent()
            const actual = await readAgentRunV1(input.scope, cursor.snapshot.run.id)
            if (actual.projection.lastSequence !== cursor.snapshot.projection.lastSequence || !['planned', 'running'].includes(actual.projection.state)) throw new Error('正文运行已变化，不派发原请求。')
            attempt = await cursor.change(async snapshot => {
              const begun = await beginProseGenerationGatewayStepV1({ scope: input.scope, snapshot, worldGroupId: root.worldGroupId,
                chapterId: root.chapterId, outlineNodeId: root.outlineNodeId, assembled: context.assembly, frozenContextV2: context.execution,
                messages: frame.messages, preparedRequestV2: frame, binding: { operation: root.operation, sourceTextHash: root.sourceTextHash,
                  promptHash: plan.request.messagesHash, informationBoundaryHash: root.informationBoundary.manifestHash } })
              return { snapshot: begun.snapshot, value: begun.attempt }
            })
            state.callRef = await cursor.record('tool-result', canonicalStringify({ planHash: plan.planHash, generation: cursor.snapshot.projection.generation, attempt }))
            await cursor.checkpoint(state)
            input.signal?.throwIfAborted(); prepared!.assertCurrent(); await assertFresh(root, context); prepared!.assertCurrent()
          },
          onPublicDelta: async delta => { const ref = await cursor.record('raw-response', canonicalStringify({ version: 'prose-task-delta-v2',
            planHash: plan.planHash, previousDeltaHash: deltaHead, text: delta }), true); deltaHead = ref.contentHash },
          onPublicResponse: async response => {
            if (!attempt) throw new Error('正文原答缺少原请求的执行边界。')
            await observe({ version: 'prose-task-response-v2', runId: cursor.snapshot.run.id, generation: cursor.snapshot.projection.generation,
              contractHash: cursor.snapshot.projection.contractHash, planHash: plan.planHash, requestHash: plan.request.requestHash,
              wireBodyHash: plan.request.wireBodyHash, nativeRequest: readPreparedNativeRequestRefV2(prepared!.prepared.handle), response }, attempt)
            const native = readPreparedNativeRequestRefV2(prepared!.prepared.handle)
            if (native && ['complete', 'incomplete'].includes(response.completion)) {
              const receipt = await readBoundCodexReceiptV1(native)
              if (receipt.status !== 'completed' || receipt.text !== response.text || native.requestHash !== plan.request.wireBodyHash) throw new Error('原生正文原答与本次冻结请求不一致。')
              await acknowledgeBoundCodexReceiptV1({ request: native, rawResponseHash: await sha256Text(response.text), confirmation: 'owner-record-saved-v1' })
            }
          },
        })
        const binding = cursor.snapshot.contract.executionBindings?.[0]
        if (!binding || binding.version !== 2 || !binding.formalEntry) throw new Error('正文缺少冻结正式入口。')
        const streamResult: StreamResult = {}
        const node = createChapterGenerationNode({ operation: root.operation, category: category(root), projectId: root.scope.projectId,
          chapterIdentity: root.chapterId, ai: input.ai, frozenResolution: frozen, streamResult,
          ...(root.temperature === null ? {} : { generationOverrides: { temperature: root.temperature } }),
          preparedRequest: { signal: input.signal, binding: binding.formalEntry, skill: projectFrozenAgentSkillDefinitionV1(binding), options: { preparedRequestV2: bound } } })
        try { await node.run(frame.messages) } catch (error) { if (!raw || cursor.stopped) throw error }
        if (streamResult.completion === 'cancelled') throw new Error('作者已停止正文生成。')
      }
      if (!raw || !rawRef) throw new Error('没有可验证的正文原答，不自动重发。')
      if (!['complete', 'incomplete'].includes(raw.response.completion)) throw new Error('正文结果未确认；原答已保留，不自动重发。')
      if (!text.trim() || observeDuplicatedProseFrameV1(text) || validateProseInformationBoundaryV1(text, root.informationBoundary).length) throw new Error('正文未通过原信息边界或完整内容校验。')
      const observation = await observeDraft(cursor.snapshot, root, text)
      const draftRef = await cursor.record('tool-result', text, true)
      const round: Round = { version: 'prose-length-round-v2', runId: cursor.snapshot.run.id, generation: cursor.snapshot.projection.generation,
        rootHash: root.rootHash, planRef: state.planRef, frameRef: state.frameRef, rawRef, draftRef, observation, manifestHash,
        completion: raw.response.completion, resultHash: await sha256Text(text) }
      if (compiled && (compiled.round.resultHash !== round.resultHash || compiled.round.rawRef.contentHash !== round.rawRef.contentHash)) throw new Error('正文已编译的原答与恢复结果不一致。')
      const roundRef = compiled?.ref ?? await cursor.record('tool-result', canonicalStringify(round), true)
      if (!compiled) { state.roundRefs.push(roundRef); await cursor.checkpoint(state) }
      input.onProgress?.({ runId: cursor.snapshot.run.id, rounds: state.roundRefs.length, words: observation.measuredWords, status: raw.response.completion })
      if (raw.response.completion === 'incomplete') {
        if (history.some(item => item.round.resultHash === round.resultHash) || !raw.response.text.trim()
          || plan.mode === 'continue-incomplete' && priorText.includes(raw.response.text.trim())) return result(cursor, root, state, best?.ref ?? roundRef, best ? 'needs-attention' : 'raw-only', '停笔续接没有内容进展；原件保留。')
        prepared = await prepareRound(root, context, baseMessages, plan, 'continue-incomplete', { ref: draftRef, text, observation })
      } else {
        const decision = planAuthorLengthRevisionV1({ plan: root.lengthPlan, current: { resultHash: round.resultHash, observation },
          priorValidRounds: valid.map(item => ({ resultHash: item.round.resultHash, observation: item.round.observation })),
          completion: 'complete', structuralValid: true, semanticComplete: true, semanticProgress: 'unknown' })
        const selected = best && root.lengthPlan.mode === 'explicit' && best.round.observation.distance! < observation.distance! ? best.ref : roundRef
        if (decision.action !== 'revise-length') return result(cursor, root, state, selected, decision.action === 'ready' ? 'ready' : 'needs-attention',
          decision.action === 'ready' ? '实测篇幅检查已完成；内容与事实仍须作者确认。' : decision.reason)
        prepared = await prepareRound(root, context, baseMessages, plan, 'revise-length', { ref: draftRef, text, observation })
      }
      input.signal?.throwIfAborted(); await assertFresh(root, context)
      state = await savePrepared(cursor, root, state.rootRef, prepared, state)
    } catch (error) {
      if (cursor.stopped) throw cursor.failure ?? error
      const reason = input.signal?.aborted ? '作者已停止；原稿和最佳完整稿保留。' : error instanceof Error ? error.message : '正文修订停止，原件保留。'
      return retainBest(cursor, root, state, reason)
    }
  }
}
export async function readProseLengthTaskV2(scope: WorkspaceScope, runId: number) {
  const snapshot = await readAgentRunV1(scope, runId)
  if (!isProseGenerationRunV4(snapshot) || snapshot.events.some(event => event.type === 'run.cancelled' && event.payload.reason === 'project-import-nonportable-checkpoint'
    || event.type === 'verification.staled' && event.payload.reason === 'project-import-scope-rebound')) throw new Error('不是可执行的原作品正文 V4 运行；导入历史只读。')
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  const payload = checkpoint?.resumePayload as { version: string; portable: false; stateRef: ProseTaskRefV2 }
  exact(payload, ['version', 'portable', 'stateRef'], '正文检查点')
  if (payload.version !== 'prose-length-checkpoint-v2' || payload.portable !== false) throw new Error('正文检查点协议无效。')
  let state = JSON.parse(await readExact(snapshot, payload.stateRef)) as State
  if (state.pendingStateRef) { const next = JSON.parse(await readExact(snapshot, state.pendingStateRef)) as State
    const plan = JSON.parse(await readExact(snapshot, next.planRef)) as Plan
    if (snapshot.contract.budget.allocation?.planHash === plan.planHash) state = next }
  exact(state, ['version', 'rootRef', 'planRef', 'frameRef', 'roundRefs', 'callRef', 'pendingStateRef', 'resultRef'], '正文状态')
  const root = JSON.parse(await readExact(snapshot, state.rootRef)) as Root, { rootHash, ...body } = root
  if (root.version !== 'prose-length-root-v2' || root.portable !== false || await hashCanonicalValue(body) !== rootHash
    || canonicalStringify(scope) !== canonicalStringify(root.scope) || root.chapterId !== snapshot.contract.scope.chapterIds?.[0]) throw new Error('正文 Root 来源或 owner 无效。')
  parseTaskLengthPlanV1(root.lengthPlan); parseWorkspaceContentRevisionV1(root.contentRevision); parseInformationBoundaryManifestV1(root.informationBoundary)
  const context = JSON.parse(await readExact(snapshot, root.contextRef)) as FrozenContext, baseMessages = JSON.parse(await readExact(snapshot, root.messagesRef)) as ChatMessage[]
  const plan = JSON.parse(await readExact(snapshot, state.planRef)) as Plan, { planHash, ...planBody } = plan
  const frame = JSON.parse(await readExact(snapshot, state.frameRef)) as ReturnType<typeof readPreparedRequestFrameV2>
  const binding = snapshot.contract.executionBindings[0]
  await assertAgentSkillExecutionBindingIntegrityV2(binding)
  if (await hashCanonicalValue(planBody) !== planHash || plan.rootHash !== rootHash || planHash !== snapshot.contract.budget.allocation?.planHash
    || binding.taskRequest?.planHash !== planHash || binding.taskRequest.materialAllocationHash !== root.material.allocationHash
    || await hashCanonicalValue(frame) !== plan.frameHash || await sha256Text(frame.wireBody) !== plan.request.wireBodyHash
    || await hashCanonicalValue(frame.messages) !== plan.request.messagesHash) throw new Error('正文当前合同与实际请求不一致。')
  await assertPlanBinding(snapshot, root, plan, snapshot.projection.generation)
  await readBaseline(snapshot, root)
  if (root.material.capturedSourceHashes.length !== 1 || root.material.capturedSourceHashes[0] !== root.contextRef.contentHash
    || canonicalStringify(root.material.selectedSourceHashes) !== canonicalStringify(root.material.capturedSourceHashes)
    || root.material.readPlanHash !== context.execution.selector.selectorHash) throw new Error('正文实际来源分配不一致。')
  const history = await roundHistory(snapshot, root, state)
  return { snapshot, state, root, context, baseMessages, plan, frame, history }
}
async function runProseLengthTaskCoreV2(input: RunProseLengthTaskV2): Promise<ProseLengthTaskResultV2> {
  if (input.runId != null && input.task) throw new Error('恢复不能夹带新的正文任务。')
  const saved = input.runId == null ? null : await readProseLengthTaskV2(input.scope, input.runId)
  const chapterId = saved?.root.chapterId ?? input.task?.chapterId
  if (!chapterId || !navigator.locks?.request) throw new Error('正文任务缺少真实章节或浏览器执行占用能力。')
  return navigator.locks.request(`storyforge:prose-length-v2:${db.name}:${input.scope.projectId}:${input.scope.worldId}:${input.scope.workId}:${chapterId}`,
    { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw new Error('另一页面正在处理本章，不重复付费请求。')
      if (saved) {
        const { root, state, context, baseMessages, plan } = saved, cursor = new ProseCursor(input.scope, saved.snapshot)
        if (state.resultRef) { const selected = JSON.parse(await readExact(cursor.snapshot, state.resultRef)) as { selected: ProseTaskRefV2 | null; disposition: ProseLengthTaskResultV2['disposition']; reason: string }
          return result(cursor, root, state, selected.selected, selected.disposition, selected.reason, false) }
        if (!['planned', 'running'].includes(cursor.snapshot.projection.state)) throw new Error('该正文运行已停止，只能核对原件，不能新增请求。')
        input.onProgress?.({ runId: saved.snapshot.run.id, rounds: state.roundRefs.length,
          words: saved.history[saved.history.length - 1]?.round.observation.measuredWords ?? 0, status: 'restoring' })
        if (state.callRef) {
          const call = JSON.parse(await readExact(cursor.snapshot, state.callRef)) as { planHash: string; generation: number; attempt: ProseGatewayAttemptV1 }
          for (const event of [...cursor.snapshot.events].reverse()) {
            if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'raw-response') continue
            const raw = JSON.parse(await readExact(cursor.snapshot, event.payload as ProseTaskRefV2)) as ProseTaskRawResponseV2
            if (raw.version === 'prose-task-response-v2' && raw.planHash === plan.planHash && raw.generation === call.generation) {
              return execute(input, cursor, root, context, baseMessages, state, undefined, { raw, attempt: call.attempt })
            }
          }
          return retainBest(cursor, root, state, '原请求已登记，但结果未知；不自动重新 POST。')
        }
        if (cursor.snapshot.events.some(event => event.generation === cursor.snapshot.projection.generation && event.type === 'model.requested')) {
          return retainBest(cursor, root, state, '原请求边界未完整保存，保持只读，不重发。')
        }
        await assertFresh(root, context)
        const prior = plan.priorDraftRef ? await readExact(cursor.snapshot, plan.priorDraftRef) : null
        const prepared = await prepareRound(root, context, baseMessages, plan, plan.mode, prior === null ? null : { ref: plan.priorDraftRef!, text: prior,
          observation: await observeDraft(cursor.snapshot, root, prior) })
        const selected = prepared.frame.wireBodyHash === saved.frame.wireBodyHash && canonicalStringify(prepared.prepared.evidence) === canonicalStringify(plan.request)
          ? { ...prepared, plan } : prepared
        const next = selected === prepared ? await savePrepared(cursor, root, state.rootRef, selected, state) : state
        return execute(input, cursor, root, context, baseMessages, next, selected)
      }
      const task = input.task
      if (!task) throw new Error('正文新开始缺少冻结任务。')
      for (const row of await readOwnedRows<import('../../types/agent-run').AgentRunRecord>(input.scope, 'agentRuns', { owner: 'work' })) {
        if (row.id == null || !['planned', 'running', 'paused', 'awaiting_confirmation', 'recovering', 'verifying'].includes(row.status)) continue
        const snapshot = await readAgentRunV1(input.scope, row.id)
        if (isProseGenerationRunV4(snapshot) && snapshot.contract.scope.chapterIds?.includes(task.chapterId)) {
          if (snapshot.projection.state === 'paused' && snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]?.status === 'stale') continue
          throw new Error('本章原运行尚未处理；请恢复或明确结束后再开始。')
        }
      }
      const chapter = await db.chapters.get(task.chapterId) as Chapter | undefined
      if (!chapter || !await assertRecordInScope(input.scope, 'chapters', chapter, { owner: 'work' })) throw new Error('正文目标章节不存在或越界。')
      const { contextGatewayExecution, ...assembly } = task.assembled, { session: _session, ...execution } = contextGatewayExecution
      const context: FrozenContext = { assembly, execution }, contextText = canonicalStringify(context), messagesText = canonicalStringify(task.messages)
      const contextRef = await refFor('source-snapshot', contextText), messagesRef = await refFor('rendered-request', messagesText)
      const baselineText = canonicalStringify({ version: 'prose-task-baseline-v2', content: chapter.content ?? '' })
      const baselineRef = await refFor('source-snapshot', baselineText)
      const materialBody = { version: 'context-material-allocation-v2' as const, authorityHash: await hashCanonicalValue({ scope: input.scope,
        policyHash: execution.contextPacket.policyHash, sourceKeys: task.assembled.included }), capturedSourceHashes: [contextRef.contentHash],
        selectedSourceHashes: [contextRef.contentHash], readPlanHash: execution.selector.selectorHash,
        inputTokenForecast: estimateTokens(execution.contextPacket.content), captureProtocolVersion: 'registered-host-full-v2' as const }
      const material = { ...materialBody, allocationHash: await hashCanonicalValue(materialBody) }
      const body = { version: 'prose-length-root-v2' as const, portable: false as const, scope: structuredClone(input.scope), worldGroupId: task.worldGroupId,
        chapterId: task.chapterId, outlineNodeId: chapter.outlineNodeId, operation: task.operation, chapterTitle: task.chapterTitle,
        lengthPlan: parseTaskLengthPlanV1(task.lengthPlan), contentRevision: structuredClone(task.contentRevision), informationBoundary: structuredClone(task.informationBoundary),
        perspectiveFromChapter: task.perspectiveFromChapter ?? true, sourceTextHash: await hashChapterText(chapter.content ?? ''), baselineRef, contextRef, messagesRef,
        templateHash: await hashCanonicalValue(usePromptStore.getState().getActive(task.operation === 'continue' ? 'chapter.continue' : 'chapter.content')),
        material, temperature: task.temperature ?? null }
      const root: Root = { ...body, rootHash: await hashCanonicalValue(body) }
      await assertFresh(root, context); input.signal?.throwIfAborted()
      const prepared = await prepareRound(root, context, task.messages, null, 'initial', null)
      const cursor = new ProseCursor(input.scope, await createAgentRunV1({ scope: input.scope, worldGroupId: root.worldGroupId,
        contract: await buildProseGenerationRunContractV4(contractInput(root, prepared.plan)) }))
      const rootRef = await cursor.record('source-snapshot', canonicalStringify(root))
      await cursor.record('source-snapshot', contextText); await cursor.record('rendered-request', messagesText)
      await cursor.record('source-snapshot', baselineText)
      const state = await savePrepared(cursor, root, rootRef, prepared)
      input.onProgress?.({ runId: cursor.snapshot.run.id, rounds: 0, words: 0, status: 'prepared' })
      return execute(input, cursor, root, context, task.messages, state, prepared)
    })
}

const activeProseTasks = new Map<number, { scope: WorkspaceScope; controller: AbortController }>()
export function isProseLengthTaskExecutingV2(scope: WorkspaceScope, runId: number): boolean {
  const task = activeProseTasks.get(runId)
  return Boolean(task && task.scope.projectId === scope.projectId && task.scope.worldId === scope.worldId && task.scope.workId === scope.workId)
}
export async function findLatestProseLengthTaskV2(scope: WorkspaceScope, chapterId: number): Promise<number | null> {
  const rows = (await readOwnedRows<import('../../types/agent-run').AgentRunRecord>(scope, 'agentRuns', { owner: 'work' }))
    .sort((left, right) => right.createdAt - left.createdAt || (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    try {
      const contract = parseAgentRunContractV3(JSON.parse(row.contractJson))
      if (row.id != null && contract.scope.chapterIds?.includes(chapterId)
        && contract.executionBindings.length === 1 && ['prose.generate.v2', 'prose.continue.v2'].includes(contract.executionBindings[0].skillId)
        && contract.verificationPlan.some(step => step.verifier === 'prose-generation-terminal-v4-task-length')) return row.id
    } catch { /* Other protocols and unreadable historical rows do not become new execution authority. */ }
  }
  return null
}
export function stopProseLengthTaskV2(scope: WorkspaceScope, runId: number): boolean {
  const task = activeProseTasks.get(runId)
  if (!task || task.scope.projectId !== scope.projectId || task.scope.worldId !== scope.worldId || task.scope.workId !== scope.workId) return false
  task.controller.abort(); return true
}
export async function endProseLengthTaskV2(input: { scope: WorkspaceScope; runId: number; expectedLastSequence: number }) {
  const snapshot = await readAgentRunV1(input.scope, input.runId)
  if (!isProseGenerationRunV4(snapshot)) throw new Error('不是当前作品的正文 V4 运行。')
  if (snapshot.projection.lastSequence !== input.expectedLastSequence) throw new Error('正文任务已推进，请先刷新核对。')
  if (snapshot.projection.steps[PROSE_GENERATION_STEP_ID_V1]?.status === 'awaiting_confirmation') throw new Error('请使用候选的拒绝入口，不丢弃待确认稿。')
  if (['completed', 'cancelled', 'failed'].includes(snapshot.projection.state)) return snapshot
  const chapterId = snapshot.contract.scope.chapterIds?.[0]
  if (!chapterId) throw new Error('正文合同缺少真实章节。')
  return navigator.locks.request(`storyforge:prose-length-v2:${db.name}:${input.scope.projectId}:${input.scope.worldId}:${input.scope.workId}:${chapterId}`,
    { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) throw new Error('原正文任务仍由另一执行页面占用，请先停止原任务。')
      return appendAgentRunEventV1({ scope: input.scope, runId: input.runId, expectedLastSequence: input.expectedLastSequence,
        type: 'run.cancelled', payload: { reason: 'author-ended-prose-length-v2' } })
    })
}
export async function runProseLengthTaskV2(input: RunProseLengthTaskV2): Promise<ProseLengthTaskResultV2> {
  const controller = new AbortController()
  const abort = () => controller.abort(input.signal?.reason)
  if (input.signal?.aborted) abort(); else input.signal?.addEventListener('abort', abort, { once: true })
  let ownedRunId: number | null = null
  try {
    return await runProseLengthTaskCoreV2({ ...input, signal: controller.signal, onProgress: progress => {
      ownedRunId = progress.runId
      activeProseTasks.set(progress.runId, { scope: { ...input.scope }, controller })
      input.onProgress?.(progress)
    } })
  } finally {
    input.signal?.removeEventListener('abort', abort)
    if (ownedRunId !== null && activeProseTasks.get(ownedRunId)?.controller === controller) activeProseTasks.delete(ownedRunId)
  }
}

/** Candidate evidence is checked against the owned task, not model-reported
 * word counts or a mutable disposition flag. The normal adoption writer stays
 * the only chapter writer. */
export async function assertProseTaskCandidateEvidenceV2(input: {
  scope: WorkspaceScope; runId: number; text: string; evidence: ProseTaskCandidateEvidenceV2
}) {
  const read = await readProseLengthTaskV2(input.scope, input.runId), evidence = input.evidence
  exact(evidence, ['version', 'rootRef', 'selectedRoundRef', 'roundRefs', 'draftRef', 'lengthPlan', 'observation', 'disposition', 'reason'], '正文候选篇幅证明')
  if (!read.state.resultRef) throw new Error('正文任务尚未保存候选选择。')
  const saved = JSON.parse(await readExact(read.snapshot, read.state.resultRef)) as {
    selected: ProseTaskRefV2 | null; disposition: ProseLengthTaskResultV2['disposition']; reason: string
  }
  exact(saved, ['selected', 'disposition', 'reason'], '正文任务选择')
  const same = (left: unknown, right: unknown) => canonicalStringify(left) === canonicalStringify(right)
  if (evidence.version !== 'prose-task-candidate-v2' || saved.disposition === 'raw-only' || !saved.selected
    || !same(evidence.rootRef, read.state.rootRef) || !same(evidence.roundRefs, read.state.roundRefs)
    || !same(evidence.selectedRoundRef, saved.selected) || !same(evidence.lengthPlan, read.root.lengthPlan)) throw new Error('正文候选并非原任务选择的完整稿。')
  const round = read.history.find(item => same(item.ref, saved.selected))?.round
  if (!round || round.completion !== 'complete') throw new Error('停笔或未知回答不能升级为完整正文候选。')
  const draft = await readExact(read.snapshot, evidence.draftRef)
  const observation = await observeDraft(read.snapshot, read.root, input.text)
  if (draft !== input.text || !same(observation, evidence.observation)) throw new Error('正文候选正文与实际计数不一致。')
  if (evidence.disposition === 'author-edited') {
    if (evidence.reason !== '作者已编辑；显示实测字数，是否采用由作者决定。') throw new Error('正文作者编辑标记无效。')
  } else if (evidence.disposition !== saved.disposition || evidence.reason !== saved.reason
    || !same(evidence.draftRef, round.draftRef) || draft !== await readExact(read.snapshot, round.draftRef)
    || evidence.disposition === 'ready' && read.root.lengthPlan.mode === 'explicit' && observation.distance !== 0) {
    throw new Error('未满足篇幅的 AI 稿不能伪报达标。')
  }
  return { ...read, round, sourceGeneration: round.generation, observation }
}

export async function reviseProseTaskEvidenceV2(input: {
  scope: WorkspaceScope; runId: number; evidence: ProseTaskCandidateEvidenceV2; previousText: string; text: string
}): Promise<ProseTaskCandidateEvidenceV2> {
  const read = await assertProseTaskCandidateEvidenceV2({ ...input, text: input.previousText })
  const cursor = new ProseCursor(input.scope, read.snapshot)
  const draftRef = await cursor.record('tool-result', input.text)
  return { ...structuredClone(input.evidence), draftRef, observation: await observeDraft(cursor.snapshot, read.root, input.text),
    disposition: 'author-edited', reason: '作者已编辑；显示实测字数，是否采用由作者决定。' }
}

export async function publishProseLengthTaskCandidateV2(input: { scope: WorkspaceScope; result: ProseLengthTaskResultV2 }) {
  const saved = input.result
  if (saved.disposition === 'raw-only' || !saved.selectedRoundRef || !saved.draftRef || !saved.observation || !saved.manifestHash) throw new Error('该正文只有原答记录，没有完整可预览候选。')
  const evidence: ProseTaskCandidateEvidenceV2 = { version: 'prose-task-candidate-v2', rootRef: saved.rootRef,
    selectedRoundRef: saved.selectedRoundRef, roundRefs: saved.roundRefs, draftRef: saved.draftRef,
    lengthPlan: saved.root.lengthPlan, observation: saved.observation, disposition: saved.disposition, reason: saved.reason }
  const read = await assertProseTaskCandidateEvidenceV2({ scope: input.scope, runId: saved.runId, text: saved.text, evidence })
  const existing = await readLatestProseGenerationCandidateV1({ scope: input.scope, chapterId: read.root.chapterId })
  if (existing?.durable.runId === saved.runId) {
    if (!existing.taskLengthV2) throw new Error('原正文候选缺少篇幅证明，不覆盖已有记录。')
    await assertProseTaskCandidateEvidenceV2({ scope: input.scope, runId: saved.runId, text: existing.outputText, evidence: existing.taskLengthV2 })
    return { candidate: existing, snapshot: read.snapshot }
  }
  const outputTextHash = await hashCanonicalValue(saved.text)
  const expected = read.root.operation === 'continue'
    ? [normalizeChapterText(await readBaseline(read.snapshot, read.root)), normalizeProseForEditorV1(saved.text)].filter(Boolean).join('\n')
    : normalizeProseForEditorV1(saved.text)
  const candidate: ProseGenerationCandidateV1 = { version: 1, type: 'prose-generation-candidate', projectId: input.scope.projectId,
    chapterId: read.root.chapterId, chapterTitle: read.root.chapterTitle, worldGroupId: read.root.worldGroupId, operation: read.root.operation,
    sourceTextHash: read.root.sourceTextHash, contentRevision: read.root.contentRevision, outputText: saved.text, outputTextHash,
    gatewayEvidenceVersion: 3, expectedContentHash: await hashChapterText(plainTextToHtml(expected)),
    informationBoundaryHash: read.root.informationBoundary.manifestHash, perspectiveCharacterId: read.root.informationBoundary.perspectiveCharacterId,
    perspectiveFromChapter: read.root.perspectiveFromChapter, taskLengthV2: evidence, createdAt: Date.now(),
    durable: { runId: saved.runId, stepId: PROSE_GENERATION_STEP_ID_V1, attempt: 1,
      contextManifestHash: read.round.manifestHash, candidateHash: outputTextHash } }
  await persistProseGenerationCandidateV1({ scope: input.scope, candidate, recordRunCandidate: true })
  return { candidate, snapshot: await readAgentRunV1(input.scope, saved.runId) }
}
