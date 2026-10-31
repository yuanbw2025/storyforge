import { recordCreationModelRequestV1, recordCreationModelResponseV1, recordUnavailableCreationResponseV1 } from '../agent/run/creation-response-evidence'
import { chat, type ChatResult } from '../ai/client'
import type { AgentRunRecord, AgentEvent, AgentConversation, AIConfig, ChatMessage, MotionDramaPromptStageV1, WorkspaceScope } from '../types'
import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { beginAgentRunRecoveryV1, completeAgentRunRecoveryV1, createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { hashCanonicalValue } from '../agent/run/hash'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import { agentRunScopeTransactionTablesV1, appendAgentRunEventWithSettlementInTransactionV1, readVerifiedAgentRunInTransactionV1, withAgentRunMutationLockV1 } from '../agent/run/event-store'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { readOwnedRows } from '../workspace/scope'
import { appendAgentEvent, getOrCreateAgentConversation } from '../agent/conversations'
import { assertExactRunArtifactBodySafeV1 } from '../memory/evidence-policy'
import { inspectAdaptationFreshness } from '../adaptation/source-manifest'
import { parseScreenplayModelJsonV1 } from '../screenplay/model-json'
import { parseMotionDramaCandidatePayloadV1 } from './contracts'
import { resolveMotionDramaPromptV1 } from './prompts'
import { adoptMotionDramaCandidateV1, requireMotionDramaRootsV1, type MotionDramaCandidatePayloadV1 } from './service'

export interface MotionDramaProfessionalCandidateV1 {
  version: 1
  kind: 'motion-drama-professional-candidate'
  portable: false
  stage: MotionDramaPromptStageV1
  projectId: number
  worldId: number
  workId: number
  adaptationProjectId: number
  adaptationRevision: number
  productionRevision: number
  episodeNumber: number
  sourceManifestVersion: number
  sourceManifestHash: string
  sourceUnitKeys: string[]
  contextManifestHash: string
  promptHash: string
  promptVersionHash: string
  modelOutputHash: string
  payload: MotionDramaCandidatePayloadV1
  payloadHash: string
  candidateHash: string
}

interface MotionDramaProfessionalIntentV1 {
  version: 1
  kind: 'motion-drama-professional-intent'
  candidate: MotionDramaProfessionalCandidateV1
  authorPayload: MotionDramaCandidatePayloadV1
  authorPayloadHash: string
  intentHash: string
}

const STAGES: Record<MotionDramaPromptStageV1, { skillId: string; role: string; category: string }> = {
  'series-bible': { skillId: 'motion-drama.series-bible', role: '系列开发制片人', category: 'motion-drama.series-bible' },
  'asset-bible': { skillId: 'motion-drama.asset-bible', role: '美术与声音设定主管', category: 'motion-drama.asset-bible' },
  'episode-outline': { skillId: 'motion-drama.episode-outline', role: '短剧统筹编剧', category: 'motion-drama.episode-outline' },
  'episode-script': { skillId: 'motion-drama.episode-script', role: '漫剧分场编剧', category: 'motion-drama.episode-script' },
  'shot-design': { skillId: 'motion-drama.shot-design', role: '分镜导演', category: 'motion-drama.shot-design' },
  'image-prompts': { skillId: 'motion-drama.image-prompts', role: '关键帧提示词设计师', category: 'motion-drama.image-prompts' },
  'video-prompts': { skillId: 'motion-drama.video-prompts', role: '视频运动提示词设计师', category: 'motion-drama.video-prompts' },
  'quality-review': { skillId: 'motion-drama.quality-review', role: '总导演与连续性主管', category: 'motion-drama.quality-review' },
}

function stepId(stage: MotionDramaPromptStageV1): string { return `motion-drama:${stage}` }

function contract(scope: WorkspaceScope, stage: MotionDramaPromptStageV1) {
  const config = STAGES[stage]; const skill = getAgentSkillV1(config.skillId); const step = stepId(stage)
  return {
    version: 1 as const, objective: `${config.role}完成漫剧前期生产阶段 ${stage}，只产出待作者确认候选`, workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: { contextSourceKeys: [...skill.contextSourceKeys], writeTargets: skill.writeTargets.map(target => ({ table: target.table, fields: [...target.fields], mode: 'author-confirmed' as const })) },
    executionBindings: [{ stepId: step, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: { maxModelCalls: 2, maxToolCalls: 0, maxInputTokens: 64_000, maxOutputTokens: skill.maxOutputTokens * 2, maxAttemptsPerStep: 2, maxProtocolErrors: 1 },
    acceptance: [
      { id: `${step}.candidate`, kind: 'output-present' as const, required: true },
      { id: `${step}.author`, kind: 'author-confirmed' as const, required: true },
      { id: `${step}.post-state`, kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{ id: `${step}.terminal`, kind: 'terminal' as const, verifier: `motion-drama-${stage}-terminal-v1`, criterionIds: [`${step}.candidate`, `${step}.author`, `${step}.post-state`] }],
    failurePolicy: { onProtocolError: 'retry' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const },
  }
}

async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: any): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as any)
}


class TaskStoppedWaitingError extends Error {
  constructor() { super('作者已停止等待本任务，不会再派发新的模型请求。'); this.name = 'TaskStoppedWaitingError' }
}
class TaskSourceChangedError extends Error {
  constructor() { super('来源、目标或当前生产版本已变化，本次调用未派发，请检查后重新明确开始。'); this.name = 'TaskSourceChangedError' }
}
interface TaskWaitControlV1 {
  version: 1
  kind: 'motion-drama-task-control'
  action: 'stop-waiting'
  generation: number
  throughSequence: number
  stepId: string
}

function taskStage(snapshot: AgentRunSnapshotV1): MotionDramaPromptStageV1 {
  const bindings = snapshot.contract.executionBindings ?? []
  if (bindings.length !== 1 || !bindings[0].stepId.startsWith('motion-drama:')) throw new Error('[motion-drama-task] 运行不是唯一的本产品专业任务')
  const stage = bindings[0].stepId.slice('motion-drama:'.length) as MotionDramaPromptStageV1
  if (!Object.prototype.hasOwnProperty.call(STAGES, stage) || bindings[0].skillId !== STAGES[stage].skillId) throw new Error('[motion-drama-task] 任务岗位或 Skill 绑定无效')
  return stage
}

async function taskChannelEvents(scope: WorkspaceScope): Promise<AgentEvent[]> {
  const conversations = (await readOwnedRows<AgentConversation>(scope, 'agentConversations', { owner: 'work' })).filter(row => row.purpose === 'motion-drama-tasks')
  const ids = new Set(conversations.map(row => row.id))
  return (await readOwnedRows<AgentEvent>(scope, 'agentEvents', { owner: 'work' })).filter(row => ids.has(row.conversationId))
}

function taskWaitControl(snapshot: AgentRunSnapshotV1, events: readonly AgentEvent[]): { event: AgentEvent; payload: TaskWaitControlV1 } | null {
  const stage = taskStage(snapshot)
  const expectedStepId = `motion-drama:${stage}`
  const controls: Array<{ event: AgentEvent; payload: TaskWaitControlV1 }> = []
  for (const event of events) {
    if (event.durableRunId !== snapshot.run.id || event.kind !== 'task') continue
    let value: unknown
    try { value = JSON.parse(event.payload) } catch { throw new Error('[motion-drama-task] 停止等待记录损坏，不能据此自动推进') }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[motion-drama-task] 停止等待记录结构无效')
    const row = value as Record<string, unknown>
    const keys = ['version', 'kind', 'action', 'generation', 'throughSequence', 'stepId']
    if (Object.keys(row).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(row, key))
      || event.role !== 'user' || row.version !== 1 || row.kind !== 'motion-drama-task-control' || row.action !== 'stop-waiting'
      || !Number.isSafeInteger(row.generation) || Number(row.generation) < 1 || Number(row.generation) > snapshot.projection.generation
      || !Number.isSafeInteger(row.throughSequence) || Number(row.throughSequence) < 1 || Number(row.throughSequence) > snapshot.projection.lastSequence
      || typeof row.stepId !== 'string' || !row.stepId.startsWith('motion-drama:')) throw new Error('[motion-drama-task] 停止等待记录字段无效')
    const prefix = snapshot.events.find(item => item.sequence === row.throughSequence)
    if (!prefix || prefix.generation !== row.generation) throw new Error('[motion-drama-task] 停止等待记录没有对应运行前缀')
    if (row.generation !== snapshot.projection.generation) continue
    if (row.stepId !== expectedStepId) throw new Error('[motion-drama-task] 停止等待记录越过当前岗位')
    controls.push({ event, payload: row as unknown as TaskWaitControlV1 })
  }
  return controls.sort((a, b) => (a.event.id ?? 0) - (b.event.id ?? 0))[0] ?? null
}

async function assertTaskHasNoFrozenAdoption(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1): Promise<void> {
  if (snapshot.events.some(event => event.generation === snapshot.projection.generation && (
    event.type === 'adoption.started' || event.type === 'adoption.committed'
    || (event.type === 'confirmation.recorded' && event.payload.decision === 'adopt')
  ))) throw new Error('[motion-drama-task] 已冻结作者采纳意图，请继续核验采纳，不能停止并丢弃')
  if (snapshot.projection.lastCheckpointHash) {
    const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, snapshot.run.id)
    const payload = checkpoint?.resumePayload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('[motion-drama-task] 无法核验现有检查点，不能丢弃潜在作者意图')
    const kind = (payload as { kind?: unknown }).kind
    if (kind === 'motion-drama-professional-intent') throw new Error('[motion-drama-task] 已冻结作者采纳意图，请继续完成采纳')
    if (kind !== 'motion-drama-professional-candidate') throw new Error('[motion-drama-task] 当前检查点类型不允许停止等待')
  }
}

/** Product UI policy only. Does not claim remote cancellation or mutate the Run. */
export async function stopWaitingMotionDramaTaskV1(scope: WorkspaceScope, runId: number, expected: { generation: number; lastSequence: number }): Promise<AgentEvent> {
  const captured = { scope: { ...scope }, runId, generation: expected.generation, lastSequence: expected.lastSequence }
  if (!Number.isSafeInteger(captured.generation) || captured.generation < 1 || !Number.isSafeInteger(captured.lastSequence) || captured.lastSequence < 1) throw new Error('[motion-drama-task] 停止等待缺少准确运行前缀')
  const initial = await readAgentRunV1(captured.scope, captured.runId)
  taskStage(initial)
  const existing = taskWaitControl(initial, await taskChannelEvents(captured.scope))
  if (existing?.payload.generation === captured.generation) return existing.event
  await assertTaskHasNoFrozenAdoption(captured.scope, initial)
  return withAgentRunMutationLockV1(captured.runId, () => db.transaction('rw', agentRunScopeTransactionTablesV1(captured.runId,
    db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, db.agentConversations, db.agentEvents,
  ), async () => {
    const current = await readVerifiedAgentRunInTransactionV1(captured.scope, captured.runId)
    const stage = taskStage(current)
    const prior = taskWaitControl(current, await taskChannelEvents(captured.scope))
    if (prior?.payload.generation === captured.generation) return prior.event
    if (current.projection.generation !== captured.generation || current.projection.lastSequence !== captured.lastSequence) throw new Error('[motion-drama-task] 任务已推进，请刷新后明确操作')
    if (!['planned', 'running', 'paused', 'awaiting_confirmation'].includes(current.projection.state)) throw new Error('[motion-drama-task] 任务已结束或不能停止等待')
    await assertTaskHasNoFrozenAdoption(captured.scope, current)
    const payload: TaskWaitControlV1 = { version: 1, kind: 'motion-drama-task-control', action: 'stop-waiting', generation: current.projection.generation, throughSequence: current.projection.lastSequence, stepId: `motion-drama:${stage}` }
    const conversation = await getOrCreateAgentConversation({ projectId: captured.scope.projectId, scope: captured.scope, worldGroupId: null, purpose: 'motion-drama-tasks', title: '漫剧素材任务记录' })
    return appendAgentEvent({ projectId: captured.scope.projectId, scope: captured.scope, conversationId: conversation.id!, durableRunId: captured.runId, kind: 'task', role: 'user', content: '作者停止等待并禁止后续自动模型调用；无法撤销已经派发的供应商请求，原运行和晚到证据继续保留。', payload })
  }))
}

async function authorizeMotionModelRequest(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, stage: MotionDramaPromptStageV1, attempt: number, contextManifestHash: string, expectedRoot: Awaited<ReturnType<typeof requireMotionDramaRootsV1>>['adaptation'], expectedProduction: Awaited<ReturnType<typeof requireMotionDramaRootsV1>>['production']): Promise<AgentRunSnapshotV1> {

  const captured = {
    scope: { ...scope }, runId: snapshot.run.id, generation: snapshot.projection.generation,
    lastSequence: snapshot.projection.lastSequence, contractHash: snapshot.projection.contractHash,
    stage, stepId: `motion-drama:${stage}`, attempt, contextManifestHash,
    rootId: expectedRoot.id!, rootRevision: expectedRoot.revision,
    sourceVersion: expectedRoot.activeSourceManifestVersion, sourceHash: expectedRoot.activeSourceManifestHash,
    productionId: expectedProduction.id, productionRevision: expectedProduction.revision, episodeNumber: expectedProduction.currentEpisodeNumber,
  }
  const bindingHash = await hashCanonicalValue(snapshot.contract.executionBindings?.[0])
  return withAgentRunMutationLockV1(captured.runId, () => db.transaction('rw', agentRunScopeTransactionTablesV1(captured.runId,
    db.agentRuns, db.agentRunEvents, db.agentConversations, db.agentEvents,
    // This is the existing inspectAdaptationFreshness read closure, not a
    // second source resolver or a full workspace table inventory.
    db.adaptationProjects, db.adaptationSourceUnits, db.outlineNodes, db.chapters, db.storyCores,
    db.motionDramaProductions,
  ), async () => {
    const current = await readVerifiedAgentRunInTransactionV1(captured.scope, captured.runId)
    if (current.projection.generation !== captured.generation || current.projection.lastSequence !== captured.lastSequence
      || current.projection.contractHash !== captured.contractHash || taskStage(current) !== captured.stage) throw new Error('[motion-drama-task] 请求授权所依据的运行前缀已变化')
    if (taskWaitControl(current, await taskChannelEvents(captured.scope))) throw new TaskStoppedWaitingError()
    const root = await db.adaptationProjects.get(captured.rootId)
    if (!root || root.medium !== 'motion-drama' || root.projectId !== captured.scope.projectId || root.worldId !== captured.scope.worldId
      || root.workId !== captured.scope.workId || root.revision !== captured.rootRevision
      || root.activeSourceManifestVersion !== captured.sourceVersion || root.activeSourceManifestHash !== captured.sourceHash) throw new TaskSourceChangedError()
    const production = await db.motionDramaProductions.get(captured.productionId)
    if (!production || production.projectId !== captured.scope.projectId || production.worldId !== captured.scope.worldId
      || production.workId !== captured.scope.workId || production.adaptationProjectId !== captured.rootId
      || production.revision !== captured.productionRevision || production.currentEpisodeNumber !== captured.episodeNumber) throw new TaskSourceChangedError()
    if ((await inspectAdaptationFreshness(captured.rootId)).status !== 'unchanged') throw new TaskSourceChangedError()
    // The existing Motion repair reuses its original frozen context. Verify
    // its exact recorded hash instead of manufacturing a new manifest.
    if (!current.events.some(event => event.type === 'context.assembled' && event.payload.stepId === captured.stepId && event.payload.manifestHash === captured.contextManifestHash)) throw new Error('[motion-drama-task] 请求没有对应冻结上下文')
    const event = parseAgentRunEventV1({ version: 1, runId: captured.runId, sequence: current.projection.lastSequence + 1,
      generation: current.projection.generation, projectId: current.run.projectId, worldGroupId: current.run.worldGroupId ?? null,
      contractHash: current.run.contractHash, type: 'model.requested', createdAt: Date.now(), payload: { stepId: captured.stepId, attempt: captured.attempt, bindingHash } })
    return appendAgentRunEventWithSettlementInTransactionV1({ snapshot: current, event, scope: captured.scope, workspaceDirty: true })
  }))
}

async function recordMotionGenerationFailure(scope: WorkspaceScope, runId: number, stage: MotionDramaPromptStageV1, phase: string, error: unknown, responseObserved: boolean, expected: { generation: number; contractHash: string }, responseEvidence?: { observation: unknown; persistenceFailures: readonly unknown[] }): Promise<unknown> {
  const failures: unknown[] = [...(responseEvidence?.persistenceFailures ?? [])]
  let message = error instanceof Error ? error.message : String(error)
  let name = error instanceof Error ? error.name : 'Error'
  let detailOmitted = false
  try {
    // Validation only: the stored record below is a product Agent error event.
    assertExactRunArtifactBodySafeV1({ artifactKind: 'tool-result', body: { message } })
  } catch {
    message = '错误详情命中运行证据安全规则，未持久化敏感文本。'
    detailOmitted = true
  }
  try { assertExactRunArtifactBodySafeV1({ artifactKind: 'tool-result', body: { name } }) }
  catch { name = 'Error'; detailOmitted = true }
  try {
    await withAgentRunMutationLockV1(runId, () => db.transaction('rw', agentRunScopeTransactionTablesV1(runId,
      db.agentRuns, db.agentRunEvents, db.agentConversations, db.agentEvents,
    ), async () => {
      const current = await readVerifiedAgentRunInTransactionV1(scope, runId)
      if (taskStage(current) !== stage || current.projection.generation !== expected.generation || current.projection.contractHash !== expected.contractHash) throw new Error('[motion-drama-task] 原任务代际或契约已变化，不能追加旧诊断')
      const conversation = await getOrCreateAgentConversation({ projectId: scope.projectId, scope, worldGroupId: null, purpose: 'motion-drama-tasks', title: '漫剧素材任务记录' })
      await appendAgentEvent({ projectId: scope.projectId, scope, conversationId: conversation.id!, durableRunId: runId, kind: 'error', role: 'system', content: message, payload: { version: 1, kind: 'motion-drama-task-error', stage, phase, name, message, detailOmitted } })
    }))
  } catch (cause) { failures.push(cause) }
  try {
    const current = await readAgentRunV1(scope, runId)
    if (taskStage(current) !== stage || current.projection.generation !== expected.generation || current.projection.contractHash !== expected.contractHash) throw new Error('[motion-drama-task] 原任务代际或契约已变化，不能结束另一运行前缀')
    if (['planned', 'running'].includes(current.projection.state)) {
      let hasCandidate = false
      try { hasCandidate = Boolean((await latest(scope, runId)).candidate) } catch { /* Missing or damaged candidates are not resume authority. */ }
      const requests = current.events.filter(event => event.type === 'model.requested').length
      const responses = current.events.filter(event => event.type === 'model.responded').length
      if (error instanceof TaskStoppedWaitingError && requests === 0) {
        await append(scope, current, 'run.cancelled', { reason: 'author-stopped-before-model-dispatch' })
      } else if (hasCandidate || current.projection.lastCheckpointHash || error instanceof TaskStoppedWaitingError || error instanceof TaskSourceChangedError || (requests > responses && !responseObserved)) {
        await append(scope, current, 'run.paused', { reason: `motion-drama-${stage}-${hasCandidate ? 'candidate-persistence-interrupted' : current.projection.lastCheckpointHash ? 'checkpoint-verification-unavailable' : error instanceof TaskStoppedWaitingError ? 'author-stopped-waiting' : error instanceof TaskSourceChangedError ? 'source-stale' : 'model-outcome-unknown'}`, recoverable: hasCandidate })
      } else {
        await append(scope, current, 'run.failed', { code: `motion-drama-${stage}-${phase}-failed`, retryable: false })
      }
    }
  } catch (cause) { failures.push(cause) }
  if (failures.length) {
    throw Object.assign(new Error(`${message}；任务诊断或状态未能完整保存，请保留当前页面并检查存储。`), { cause: error, persistenceFailures: failures, ...(responseEvidence ? { observation: responseEvidence.observation } : {}) })
  }
  // Classify and persist with the original error above. Only the UI-facing
  // wrapper is sanitized; its cause keeps the original type/status evidence.
  return detailOmitted ? Object.assign(new Error(message), { name, cause: error }) : error
}

function protocol(stage: MotionDramaPromptStageV1): string {
  if (stage === 'series-bible') return '输出单个对象，字段严格且仅为：version,titlePromise,logline,coreTheme,emotionalPromise,audiencePromise,storyEngine,worldRules,seasonArc,protagonistArc,relationshipArcs,episodeArchitecture,hookPatterns,visualLanguage,soundLanguage,continuityRules,productionConstraints。version 为数字 1。'
  if (stage === 'asset-bible') return '输出数组。每项字段严格且仅为：stableKey,kind,label,identity,appearance,palette,materials,continuityLocks,prohibitedChanges,basePrompt,negativePrompt,referenceBrief,sourceUnitKeys。kind 只能是 character,costume,location,prop,style,voice,sound。'
  if (stage === 'episode-outline') return '输出单个对象，字段严格且仅为：stableKey,episodeNumber,title,logline,synopsis,openingHook,beats,endHook,continuityIn,continuityOut,sourceUnitKeys。beats 每项严格为 stableKey,order,function,visibleAction,conflict,turn,targetSeconds,sourceUnitKeys；function 只能是 hook,setup,pressure,reveal,reversal,climax,cliffhanger,resolution。'
  if (stage === 'episode-script') return '输出场景数组。每项字段严格且仅为：stableKey,episodeNumber,sceneNumber,order,heading,location,timeOfDay,dramaticPurpose,entryState,exitState,visibleAction,dialogue,narration,soundCues,emotionalTurn,estimatedSeconds,characterKeys,sourceUnitKeys。dialogue 每项严格为 speakerKey,text,delivery,estimatedSeconds；soundCues 每项严格为 kind,cue,timing,subjectKey。'
  if (stage === 'shot-design') return '输出分镜数组。每项字段严格且仅为：stableKey,episodeNumber,sceneKey,shotNumber,order,narrativeFunction,targetSeconds,shotSize,cameraAngle,cameraMovement,composition,visibleAction,performance,lighting,transitionIn,transitionOut,dialogue,narration,soundPlan,subjectKeys,sourceUnitKeys,imagePrompt,negativeImagePrompt,firstFramePrompt,keyFramePrompt,lastFramePrompt,videoPrompt,negativeVideoPrompt。七个 prompt 字段本阶段全部写空字符串。soundPlan 形状同 soundCues。'
  if (stage === 'image-prompts') return '输出与当前集全部镜头一一对应的数组。每项字段严格且仅为：shotKey,expectedRevision,imagePrompt,negativeImagePrompt,firstFramePrompt,keyFramePrompt,lastFramePrompt。所有文本非空，expectedRevision 精确复制当前镜头 revision。'
  if (stage === 'video-prompts') return '输出与当前集全部镜头一一对应的数组。每项字段严格且仅为：shotKey,expectedRevision,videoPrompt,negativeVideoPrompt。所有文本非空，expectedRevision 精确复制当前镜头 revision。'
  return '输出问题数组，允许空数组。每项字段严格且仅为：stableKey,episodeNumber,sceneKey,shotKey,subjectKey,category,severity,evidence,problem,suggestion。sceneKey/shotKey/subjectKey 无法定位时必须为 null；category 只能是 story,continuity,visual,motion,prompt,sound,rights,provider-capability；severity 只能是 critical,major,minor。'
}

function messagesFor(stage: MotionDramaPromptStageV1, profession: string, resolvedInstruction: string, context: string, target: unknown, episodeNumber: number, authorInstruction: string): ChatMessage[] {
  return [
    { role: 'system', content: `你当前岗位：${profession}。\n${resolvedInstruction}\n\n${protocol(stage)}` },
    { role: 'user', content: [`目标规格：${JSON.stringify(target)}`, `当前只处理第 ${episodeNumber} 集。系列圣经和物料圣经虽跨集复用，仍基于本次冻结来源。`, authorInstruction.trim() ? `作者附加要求：${authorInstruction.trim()}` : '', `登记上下文：\n${context}`].filter(Boolean).join('\n\n') },
  ]
}

async function prerequisites(scope: WorkspaceScope, stage: MotionDramaPromptStageV1, episodeNumber: number) {
  const roots = await requireMotionDramaRootsV1(scope, true)
  if (roots.adaptation.sourceCoverage !== 'full-text') throw new Error('[motion-drama-run] 请先在小说工作台完成正文，再显式同步完整小说来源')
  const [bibleCount, assetCount, episode, sceneCount, shots, packCount] = await Promise.all([
    db.motionDramaSeriesBibles.where('adaptationProjectId').equals(roots.adaptation.id).count(),
    db.motionDramaAssetSubjects.where('adaptationProjectId').equals(roots.adaptation.id).count(),
    db.motionDramaEpisodes.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === episodeNumber).first(),
    db.motionDramaScriptScenes.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === episodeNumber).count(),
    db.motionDramaShots.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === episodeNumber).toArray(),
    db.motionDramaPromptPacks.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === episodeNumber).count(),
  ])
  if (stage !== 'series-bible' && bibleCount === 0) throw new Error('[motion-drama-run] 请先确认系列圣经')
  if (['episode-outline', 'episode-script', 'shot-design', 'image-prompts', 'video-prompts', 'quality-review'].includes(stage) && assetCount === 0) throw new Error('[motion-drama-run] 请先确认物料圣经')
  if (['episode-script', 'shot-design', 'image-prompts', 'video-prompts', 'quality-review'].includes(stage) && !episode) throw new Error('[motion-drama-run] 请先确认当前集节拍')
  if (['shot-design', 'image-prompts', 'video-prompts', 'quality-review'].includes(stage) && sceneCount === 0) throw new Error('[motion-drama-run] 请先确认当前集漫剧剧本')
  if (['image-prompts', 'video-prompts', 'quality-review'].includes(stage) && shots.length === 0) throw new Error('[motion-drama-run] 请先确认当前集分镜')
  if (stage === 'video-prompts' && shots.some(shot => !shot.imagePrompt.trim())) throw new Error('[motion-drama-run] 请先完成全部镜头的画面 Prompt IR')
  if (stage === 'quality-review' && (!packCount || shots.some(shot => !shot.videoPrompt.trim()))) throw new Error('[motion-drama-run] 请先完成视频 Prompt IR 并编译至少一个工具适配包')
  const units = await db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([roots.adaptation.id, roots.adaptation.activeSourceManifestVersion]).sortBy('order')
  if (!units.length) throw new Error('[motion-drama-run] 当前冻结来源为空')
  return { ...roots, sourceUnitKeys: units.map(row => row.sourceUnitKey) }
}

export async function generateMotionDramaCandidateV1(input: { scope: WorkspaceScope; stage: MotionDramaPromptStageV1; episodeNumber: number; authorInstruction?: string; aiConfig?: AIConfig; runAI?: (messages: ChatMessage[]) => Promise<string>; onTaskCreated?: (task: Readonly<{ runId: number; generation: number; lastSequence: number }>) => void | Promise<void>; signal?: AbortSignal }): Promise<{ snapshot: AgentRunSnapshotV1; candidate: MotionDramaProfessionalCandidateV1 }> {
  const callbackReceiver = input
  const runAI = input.runAI
  const onTaskCreated = input.onTaskCreated
  input = { ...input, scope: { ...input.scope }, aiConfig: input.aiConfig ? { ...input.aiConfig } : undefined }
  if (!input.aiConfig && !input.runAI) throw new Error('[motion-drama-run] 缺少 AI 配置')
  const roots = await prerequisites(input.scope, input.stage, input.episodeNumber)
  if (roots.production.currentEpisodeNumber !== input.episodeNumber) throw new Error('[motion-drama-run] 当前集已变化，请刷新')
  const config = STAGES[input.stage]; const skill = getAgentSkillV1(config.skillId); const step = stepId(input.stage)
  let snapshot = await createAgentRunV1({ scope: roots.scope, worldGroupId: null, contract: contract(roots.scope, input.stage) })
  let phase = 'preparation'
  let responseObserved = false
  let unavailableResponse: Awaited<ReturnType<typeof recordUnavailableCreationResponseV1>> | undefined
  try {
  await onTaskCreated?.call(callbackReceiver, Object.freeze({ runId: snapshot.run.id, generation: snapshot.projection.generation, lastSequence: snapshot.projection.lastSequence }))
  snapshot = await append(roots.scope, snapshot, 'step.scheduled', { stepId: step })
  snapshot = await append(roots.scope, snapshot, 'step.started', { stepId: step, attempt: 1 })
  const assembled = await assembleContext({ projectId: roots.scope.projectId, scope: roots.scope, sourceKeys: [...skill.contextSourceKeys], adaptationProjectId: roots.adaptation.id, adaptationSourceManifestVersion: roots.adaptation.activeSourceManifestVersion, adaptationSourceUnitKeys: roots.sourceUnitKeys, provider: input.aiConfig?.provider, model: input.aiConfig?.model, inputBudgetMaxTokens: 64_000 })
  const contextManifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: step, attempt: 1, projectId: roots.scope.projectId, worldGroupId: null, declaredSourceKeys: [...skill.contextSourceKeys], assembled, readerVersion: `motion-drama-${input.stage}-context-v1` })
  snapshot = await append(roots.scope, snapshot, 'context.assembled', { stepId: step, attempt: 1, manifestHash: contextManifest.manifestHash })
  const resolvedPrompt = await resolveMotionDramaPromptV1(roots.scope, input.stage, input.episodeNumber)
  const baseMessages = messagesFor(input.stage, resolvedPrompt.definition.profession, resolvedPrompt.instruction, assembled.text, roots.adaptation.targetSpec, input.episodeNumber, input.authorInstruction ?? '')
  const runModel = async (messages: ChatMessage[], attempt: number) => {
    phase = 'request'; responseObserved = false
    const prepared = await recordCreationModelRequestV1({ scope: roots.scope, snapshot, stepId: step, attempt,
      contextManifestHash: contextManifest.manifestHash, messages })
    snapshot = prepared.snapshot
    snapshot = await authorizeMotionModelRequest(roots.scope, snapshot, input.stage, attempt, contextManifest.manifestHash, roots.adaptation, roots.production)
    const result: ChatResult = {}
    let output: string
    try { output = await (runAI ? runAI.call(callbackReceiver, messages) : chat(messages, input.aiConfig!, { category: config.category, projectId: roots.scope.projectId, configOverrides: { maxTokens: skill.maxOutputTokens }, contextOverflowPolicy: 'reject' }, input.signal, result)) }
    catch (error) {
      const failed = await recordUnavailableCreationResponseV1({ snapshot, request: prepared.request, result, error })
      unavailableResponse = failed
      snapshot = failed.snapshot
      throw failed.error
    }
    responseObserved = true; phase = 'response-persistence'
    snapshot = await recordCreationModelResponseV1({ snapshot, request: prepared.request, raw: output, result })
    snapshot = await append(roots.scope, snapshot, 'model.responded', { stepId: step, attempt, outputHash: await hashCanonicalValue({ raw: output }) })
    phase = 'protocol'
    return output
  }
  let finalMessages = baseMessages; let finalAttempt = 1; let raw = await runModel(baseMessages, 1); let payload: MotionDramaCandidatePayloadV1
  try { payload = parseMotionDramaCandidatePayloadV1(input.stage, parseScreenplayModelJsonV1(raw)) as MotionDramaCandidatePayloadV1 }
  catch (firstError) {
    const issue = firstError instanceof Error ? firstError.message : String(firstError)
    snapshot = await append(roots.scope, snapshot, 'step.failed', { stepId: step, attempt: 1, code: `motion-drama-${input.stage}-repairable-protocol`, retryable: true, category: 'protocol', action: 'retry' })
    snapshot = await append(roots.scope, snapshot, 'step.started', { stepId: step, attempt: 2 }); finalAttempt = 2
    finalMessages = [...baseMessages, { role: 'user', content: `上一次输出未通过严格协议。只修复协议，不改变创作意图；重新输出一个完整 JSON 值。\n校验错误：${issue.slice(0, 1200)}\n待修复输出：${raw.slice(0, 120000)}\n再次检查字段闭集、ASCII stableKey、引用 key、集号、连续 order、秒数和非空要求。不要解释。` }]
    raw = await runModel(finalMessages, 2)
    try { payload = parseMotionDramaCandidatePayloadV1(input.stage, parseScreenplayModelJsonV1(raw)) as MotionDramaCandidatePayloadV1 }
    catch (cause) {
      snapshot = await append(roots.scope, snapshot, 'step.failed', { stepId: step, attempt: 2, code: `motion-drama-${input.stage}-protocol-failed`, retryable: false, category: 'protocol', action: 'fail' })
      await append(roots.scope, snapshot, 'run.failed', { code: `motion-drama-${input.stage}-protocol-failed`, retryable: false }); throw cause
    }
  }
  phase = 'candidate-persistence'
  const body = { version: 1 as const, kind: 'motion-drama-professional-candidate' as const, portable: false as const, stage: input.stage, projectId: roots.scope.projectId, worldId: roots.scope.worldId, workId: roots.scope.workId, adaptationProjectId: roots.adaptation.id, adaptationRevision: roots.adaptation.revision, productionRevision: roots.production.revision, episodeNumber: input.episodeNumber, sourceManifestVersion: roots.adaptation.activeSourceManifestVersion, sourceManifestHash: roots.adaptation.activeSourceManifestHash, sourceUnitKeys: roots.sourceUnitKeys, contextManifestHash: contextManifest.manifestHash, promptHash: await hashCanonicalValue(finalMessages), promptVersionHash: resolvedPrompt.contentHash, modelOutputHash: await hashCanonicalValue({ raw }), payload, payloadHash: await hashCanonicalValue(payload) }
  const candidate: MotionDramaProfessionalCandidateV1 = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({ scope: roots.scope, runId: snapshot.run.id, resumePayload: candidate }); snapshot = saved.snapshot
  snapshot = await append(roots.scope, snapshot, 'candidate.persisted', { stepId: step, attempt: finalAttempt, candidateHash: candidate.candidateHash, requiresConfirmation: true })
  return { snapshot, candidate }
  } catch (error) {
    throw await recordMotionGenerationFailure(roots.scope, snapshot.run.id, input.stage, phase, error, responseObserved, { generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash }, unavailableResponse)
  }
}

async function parseCandidate(value: unknown): Promise<MotionDramaProfessionalCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[motion-drama-run] 候选检查点无效')
  const row = value as MotionDramaProfessionalCandidateV1
  if (row.version !== 1 || row.kind !== 'motion-drama-professional-candidate' || row.portable !== false || !Object.prototype.hasOwnProperty.call(STAGES, row.stage)) throw new Error('[motion-drama-run] 候选身份无效')
  row.payload = parseMotionDramaCandidatePayloadV1(row.stage, row.payload) as MotionDramaCandidatePayloadV1
  if (await hashCanonicalValue(row.payload) !== row.payloadHash) throw new Error('[motion-drama-run] 候选 payload hash 不匹配')
  const { candidateHash: _hash, ...body } = row
  if (await hashCanonicalValue(body) !== row.candidateHash) throw new Error('[motion-drama-run] 候选 hash 不匹配')
  return row
}

async function latest(scope: WorkspaceScope, runId: number): Promise<{ candidate: MotionDramaProfessionalCandidateV1; intent: MotionDramaProfessionalIntentV1 | null }> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('[motion-drama-run] 运行缺少可验证检查点')
  const value = checkpoint.resumePayload as any
  if (value?.kind === 'motion-drama-professional-intent') {
    const candidate = await parseCandidate(value.candidate); const authorPayload = parseMotionDramaCandidatePayloadV1(candidate.stage, value.authorPayload) as MotionDramaCandidatePayloadV1
    if (await hashCanonicalValue(authorPayload) !== value.authorPayloadHash) throw new Error('[motion-drama-run] 作者 payload hash 不匹配')
    const { intentHash: _hash, ...body } = value
    if (await hashCanonicalValue(body) !== value.intentHash) throw new Error('[motion-drama-run] 采纳意图 hash 不匹配')
    return { candidate, intent: value as MotionDramaProfessionalIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}


export interface MotionDramaTaskV1 {
  id: number
  stage: MotionDramaPromptStageV1 | null
  status: AgentRunSnapshotV1['projection']['state'] | 'unverified'
  verified: boolean
  generation: number
  lastSequence: number
  requestedAttempts: number
  respondedAttempts: number
  hasUnresolvedRequest: boolean
  candidateState: 'missing' | 'available' | 'intent' | 'unchecked' | 'unverified'
  stoppedWaiting: boolean
  controlVerified: boolean
  resuming: boolean
  canStopWaiting: boolean
  canRecoverCandidate: boolean
  diagnostics: string[]
  rawResponseReferences: string[]
}

interface MotionDramaTaskDetailV1 {
  task: MotionDramaTaskV1
  snapshot: AgentRunSnapshotV1
  candidate?: MotionDramaProfessionalCandidateV1
  authorPayload?: MotionDramaCandidatePayloadV1
}

async function inspectTask(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, channelEvents: readonly AgentEvent[], verifyCandidate = true): Promise<MotionDramaTaskDetailV1> {
  const stage = taskStage(snapshot)
  const requests = snapshot.events.filter(event => event.type === 'model.requested').length
  const responses = snapshot.events.filter(event => event.type === 'model.responded').length
  const task: MotionDramaTaskV1 = {
    id: snapshot.run.id, stage, status: snapshot.projection.state, verified: true,
    generation: snapshot.projection.generation, lastSequence: snapshot.projection.lastSequence,
    requestedAttempts: requests, respondedAttempts: responses, hasUnresolvedRequest: requests > responses,
    candidateState: snapshot.projection.lastCheckpointHash ? 'unchecked' : 'missing', stoppedWaiting: false, controlVerified: true,
    resuming: false, canStopWaiting: false, canRecoverCandidate: false, diagnostics: [],
    rawResponseReferences: snapshot.events.flatMap(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response' ? [event.payload.contentHash] : []),
  }
  try { task.stoppedWaiting = Boolean(taskWaitControl(snapshot, channelEvents)) }
  catch (error) { task.controlVerified = false; task.diagnostics.push(error instanceof Error ? error.message : String(error)) }
  for (const event of channelEvents) {
    if (event.durableRunId !== snapshot.run.id || event.kind !== 'error') continue
    try {
      const payload = JSON.parse(event.payload) as Record<string, unknown>
      if (payload.version === 1 && payload.kind === 'motion-drama-task-error' && payload.stage === stage && typeof payload.message === 'string') task.diagnostics.push(payload.message)
    } catch { task.diagnostics.push('任务诊断记录损坏，原运行证据仍保留。') }
  }
  if (!task.diagnostics.length) {
    const failure = [...snapshot.events].reverse().find(event => event.type === 'run.failed' || event.type === 'run.paused' || event.type === 'step.failed')
    if (failure?.type === 'run.paused') task.diagnostics.push(failure.payload.reason)
    else if (failure?.type === 'run.failed' || failure?.type === 'step.failed') task.diagnostics.push(failure.payload.code)
  }
  const detail: MotionDramaTaskDetailV1 = { task, snapshot }
  const hasAdoption = snapshot.events.some(event => event.generation === snapshot.projection.generation && (
    event.type === 'adoption.started' || event.type === 'adoption.committed' || (event.type === 'confirmation.recorded' && event.payload.decision === 'adopt')
  ))
  if (verifyCandidate && (snapshot.projection.lastCheckpointHash || Object.values(snapshot.projection.steps).some(step => step.candidateHash))) {
    try {
      const state = await latest(scope, snapshot.run.id)
      const candidate = state.candidate
      const current = await readAgentRunV1(scope, snapshot.run.id)
      if (current.projection.generation !== snapshot.projection.generation || current.projection.lastSequence !== snapshot.projection.lastSequence || current.projection.contractHash !== snapshot.projection.contractHash) throw new Error('[motion-drama-task] 运行证据已推进，请刷新后查看候选')
      if (candidate.projectId !== scope.projectId || candidate.worldId !== scope.worldId || candidate.workId !== scope.workId || candidate.stage !== stage) throw new Error('[motion-drama-task] 候选越过当前 Work 或岗位')
      detail.candidate = candidate
      if (state.intent) detail.authorPayload = state.intent.authorPayload
      task.candidateState = state.intent ? 'intent' : 'available'
      task.resuming = Boolean(state.intent) && ['running', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)
      const step = snapshot.projection.steps[`motion-drama:${stage}`]
      task.canRecoverCandidate = !state.intent && !step?.candidateHash && step?.status === 'running' && ['running', 'paused', 'recovering'].includes(snapshot.projection.state) && task.controlVerified
    } catch (error) {
      task.candidateState = 'unverified'
      task.diagnostics.push(error instanceof Error ? error.message : String(error))
    }
  }
  task.canStopWaiting = task.controlVerified && !task.stoppedWaiting && !hasAdoption && task.candidateState !== 'intent' && task.candidateState !== 'unverified'
    && ['planned', 'running', 'paused', 'awaiting_confirmation'].includes(snapshot.projection.state)
  return detail
}

/** Read-only inspection: never repairs events or dispatches a model. */
export async function readMotionDramaTaskV1(scope: WorkspaceScope, runId: number): Promise<MotionDramaTaskDetailV1> {
  const capturedScope = { ...scope }
  const snapshot = await readAgentRunV1(capturedScope, runId)
  return inspectTask(capturedScope, snapshot, await taskChannelEvents(capturedScope))
}

async function postState(stage: MotionDramaPromptStageV1, candidate: MotionDramaProfessionalCandidateV1): Promise<unknown> {
  const id = candidate.adaptationProjectId; const episode = candidate.episodeNumber
  if (stage === 'series-bible') return db.motionDramaSeriesBibles.where('adaptationProjectId').equals(id).last()
  if (stage === 'asset-bible') return db.motionDramaAssetSubjects.where('adaptationProjectId').equals(id).sortBy('stableKey')
  if (stage === 'episode-outline') return db.motionDramaEpisodes.where('adaptationProjectId').equals(id).filter(row => row.episodeNumber === episode).first()
  if (stage === 'episode-script') return db.motionDramaScriptScenes.where('adaptationProjectId').equals(id).filter(row => row.episodeNumber === episode).sortBy('order')
  if (stage === 'shot-design' || stage === 'image-prompts' || stage === 'video-prompts') return db.motionDramaShots.where('adaptationProjectId').equals(id).filter(row => row.episodeNumber === episode).sortBy('order')
  return db.motionDramaReviewIssues.where('adaptationProjectId').equals(id).filter(row => row.episodeNumber === episode).sortBy('stableKey')
}

const ASSET_FIELDS = ['stableKey', 'kind', 'label', 'identity', 'appearance', 'palette', 'materials', 'continuityLocks', 'prohibitedChanges', 'basePrompt', 'negativePrompt', 'referenceBrief', 'sourceUnitKeys'] as const
const EPISODE_FIELDS = ['stableKey', 'episodeNumber', 'title', 'logline', 'synopsis', 'openingHook', 'beats', 'endHook', 'continuityIn', 'continuityOut', 'sourceUnitKeys'] as const
const SCENE_FIELDS = ['stableKey', 'episodeNumber', 'sceneNumber', 'order', 'heading', 'location', 'timeOfDay', 'dramaticPurpose', 'entryState', 'exitState', 'visibleAction', 'dialogue', 'narration', 'soundCues', 'emotionalTurn', 'estimatedSeconds', 'characterKeys', 'sourceUnitKeys'] as const
const SHOT_FIELDS = ['stableKey', 'episodeNumber', 'sceneKey', 'shotNumber', 'order', 'narrativeFunction', 'targetSeconds', 'shotSize', 'cameraAngle', 'cameraMovement', 'composition', 'visibleAction', 'performance', 'lighting', 'transitionIn', 'transitionOut', 'dialogue', 'narration', 'soundPlan', 'subjectKeys', 'sourceUnitKeys', 'imagePrompt', 'negativeImagePrompt', 'firstFramePrompt', 'keyFramePrompt', 'lastFramePrompt', 'videoPrompt', 'negativeVideoPrompt'] as const
const ISSUE_FIELDS = ['stableKey', 'episodeNumber', 'sceneKey', 'shotKey', 'subjectKey', 'category', 'severity', 'evidence', 'problem', 'suggestion'] as const

function selectFields(row: Record<string, any>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field, structuredClone(row[field])]))
}

async function formalAlreadyApplied(candidate: MotionDramaProfessionalCandidateV1, payload: MotionDramaCandidatePayloadV1): Promise<boolean> {
  const production = await db.motionDramaProductions.where('workId').equals(candidate.workId).first()
  if (production?.revision !== candidate.productionRevision + 1) return false
  const id = candidate.adaptationProjectId; const episode = candidate.episodeNumber
  if (candidate.stage === 'series-bible') {
    const row = await db.motionDramaSeriesBibles.where('adaptationProjectId').equals(id).last()
    return Boolean(row && await hashCanonicalValue(row.bible) === await hashCanonicalValue(payload))
  }
  if (candidate.stage === 'asset-bible') {
    const rows = await db.motionDramaAssetSubjects.where('adaptationProjectId').equals(id).toArray()
    const expected = payload as Array<Record<string, any>>; const byKey = new Map(rows.map(row => [row.stableKey, row]))
    return expected.every(item => byKey.has(item.stableKey)) && await hashCanonicalValue(expected.map(item => selectFields(item, ASSET_FIELDS)).sort((a, b) => String(a.stableKey).localeCompare(String(b.stableKey)))) === await hashCanonicalValue(expected.map(item => selectFields(byKey.get(item.stableKey)!, ASSET_FIELDS)).sort((a, b) => String(a.stableKey).localeCompare(String(b.stableKey))))
  }
  if (candidate.stage === 'episode-outline') {
    const row = await db.motionDramaEpisodes.where('adaptationProjectId').equals(id).filter(item => item.episodeNumber === episode).first()
    return Boolean(row && await hashCanonicalValue(selectFields(row, EPISODE_FIELDS)) === await hashCanonicalValue(selectFields(payload as Record<string, any>, EPISODE_FIELDS)))
  }
  if (candidate.stage === 'episode-script') {
    const rows = await db.motionDramaScriptScenes.where('adaptationProjectId').equals(id).filter(item => item.episodeNumber === episode).sortBy('order')
    return await hashCanonicalValue(rows.map(row => selectFields(row, SCENE_FIELDS))) === await hashCanonicalValue((payload as Array<Record<string, any>>).map(row => selectFields(row, SCENE_FIELDS)))
  }
  if (candidate.stage === 'shot-design') {
    const rows = await db.motionDramaShots.where('adaptationProjectId').equals(id).filter(item => item.episodeNumber === episode).sortBy('order')
    return await hashCanonicalValue(rows.map(row => selectFields(row, SHOT_FIELDS))) === await hashCanonicalValue((payload as Array<Record<string, any>>).map(row => selectFields(row, SHOT_FIELDS)))
  }
  if (candidate.stage === 'image-prompts' || candidate.stage === 'video-prompts') {
    const rows = await db.motionDramaShots.where('adaptationProjectId').equals(id).filter(item => item.episodeNumber === episode).toArray(); const byKey = new Map(rows.map(row => [row.stableKey, row]))
    return (payload as Array<Record<string, any>>).every(item => {
      const row = byKey.get(String(item.shotKey)); if (!row || row.revision !== Number(item.expectedRevision) + 1) return false
      const fields = candidate.stage === 'image-prompts' ? ['imagePrompt', 'negativeImagePrompt', 'firstFramePrompt', 'keyFramePrompt', 'lastFramePrompt'] : ['videoPrompt', 'negativeVideoPrompt']
      return fields.every(field => row[field as keyof typeof row] === item[field])
    })
  }
  const rows = await db.motionDramaReviewIssues.where('adaptationProjectId').equals(id).filter(item => item.episodeNumber === episode).sortBy('stableKey')
  return await hashCanonicalValue(rows.map(row => selectFields(row, ISSUE_FIELDS))) === await hashCanonicalValue((payload as Array<Record<string, any>>).sort((a, b) => String(a.stableKey).localeCompare(String(b.stableKey))).map(row => selectFields(row, ISSUE_FIELDS)))
}

async function candidateFresh(scope: WorkspaceScope, candidate: MotionDramaProfessionalCandidateV1): Promise<void> {
  const roots = await requireMotionDramaRootsV1(scope)
  if (roots.adaptation.id !== candidate.adaptationProjectId || roots.adaptation.revision !== candidate.adaptationRevision || roots.production.revision !== candidate.productionRevision || roots.production.currentEpisodeNumber !== candidate.episodeNumber || roots.adaptation.activeSourceManifestVersion !== candidate.sourceManifestVersion || roots.adaptation.activeSourceManifestHash !== candidate.sourceManifestHash || (await inspectAdaptationFreshness(roots.adaptation.id)).status !== 'unchanged') throw new Error('[motion-drama-run] 来源、生产内容或当前集已变化，候选 stale')
}

export async function adoptMotionDramaProfessionalCandidateV1(input: { scope: WorkspaceScope; runId: number; authorPayload?: unknown }): Promise<{ snapshot: AgentRunSnapshotV1; candidate: MotionDramaProfessionalCandidateV1; receiptHash: string }> {
  const scope = { ...input.scope }; const runId = input.runId
  let snapshot = await readAgentRunV1(scope, runId); const state = await latest(scope, runId); const candidate = state.candidate; const step = stepId(candidate.stage); let intent = state.intent
  if (candidate.projectId !== scope.projectId || candidate.worldId !== scope.worldId || candidate.workId !== scope.workId) throw new Error('[motion-drama-run] 候选越过当前 Work')
  const current = await readAgentRunV1(scope, runId)
  if (current.projection.generation !== snapshot.projection.generation || current.projection.lastSequence !== snapshot.projection.lastSequence || current.projection.contractHash !== snapshot.projection.contractHash) throw new Error('[motion-drama-run] 运行前缀已变化，请刷新后核验原采纳')
  if (taskStage(snapshot) !== candidate.stage || snapshot.projection.steps[step]?.candidateHash !== candidate.candidateHash) throw new Error('[motion-drama-run] 原候选与当前任务岗位或步骤不一致')
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  // A nonportable imported intent is evidence, never fresh write authority.
  // This preflight does not make the existing domain/receipt crash window atomic.
  if (!['awaiting_confirmation', 'running', 'verifying'].includes(snapshot.projection.state)) throw new Error('[motion-drama-run] 当前运行已结束或不可执行，保留原意图仅供核验')
  const roots = await requireMotionDramaRootsV1(scope)
  if (roots.adaptation.id !== candidate.adaptationProjectId) throw new Error('[motion-drama-run] 原候选的改编定位与当前 Work 不一致')
  if (snapshot.projection.state === 'awaiting_confirmation' && !intent) {
    await candidateFresh(scope, candidate)
    const authorPayload = parseMotionDramaCandidatePayloadV1(candidate.stage, input.authorPayload ?? candidate.payload) as MotionDramaCandidatePayloadV1
    const body = { version: 1 as const, kind: 'motion-drama-professional-intent' as const, candidate, authorPayload, authorPayloadHash: await hashCanonicalValue(authorPayload) }
    intent = { ...body, intentHash: await hashCanonicalValue(body) }
    const saved = await createAgentRunCheckpointV1({ scope: scope, runId: snapshot.run.id, resumePayload: intent }); snapshot = saved.snapshot
    snapshot = await append(scope, snapshot, 'confirmation.recorded', { stepId: step, candidateHash: candidate.candidateHash, decision: 'adopt' })
    snapshot = await append(scope, snapshot, 'adoption.started', { stepId: step, candidateHash: candidate.candidateHash, intentHash: intent.intentHash })
  }
  if (!intent) throw new Error('[motion-drama-run] 候选不在可采纳状态')
  // Resume from the frozen author intent even if interruption happened between
  // checkpoint, confirmation and adoption events. Never replace author edits.
  if (snapshot.projection.state === 'awaiting_confirmation') snapshot = await append(scope, snapshot, 'confirmation.recorded', { stepId: step, candidateHash: candidate.candidateHash, decision: 'adopt' })
  if (!snapshot.events.some(event => event.type === 'adoption.started')) snapshot = await append(scope, snapshot, 'adoption.started', { stepId: step, candidateHash: candidate.candidateHash, intentHash: intent.intentHash })
  let adoptionHash = snapshot.projection.steps[step]?.adoptionHash
  if (!adoptionHash) {
    const roots = await requireMotionDramaRootsV1(scope)
    if (roots.production.revision === candidate.productionRevision) await adoptMotionDramaCandidateV1({ scope: scope, stage: candidate.stage, payload: intent.authorPayload, expectedAdaptationRevision: candidate.adaptationRevision, expectedProductionRevision: candidate.productionRevision, episodeNumber: candidate.episodeNumber })
    else if (!await formalAlreadyApplied(candidate, intent.authorPayload)) throw new Error('[motion-drama-run] 采纳恢复发现并发修改，无法判定正式写入')
    const stateHash = await hashCanonicalValue(await postState(candidate.stage, candidate)); adoptionHash = await hashCanonicalValue({ intentHash: intent.intentHash, stateHash })
    snapshot = await append(scope, snapshot, 'adoption.committed', { stepId: step, candidateHash: candidate.candidateHash, adoptionHash })
  }
  const stateHash = await hashCanonicalValue(await postState(candidate.stage, candidate))
  if (snapshot.projection.steps[step]?.status === 'running') snapshot = await append(scope, snapshot, 'step.succeeded', { stepId: step, attempt: snapshot.projection.steps[step]?.attempt ?? 1, outputHash: adoptionHash })
  if (snapshot.projection.state === 'running') snapshot = await append(scope, snapshot, 'verification.started', { verifierSetVersion: `motion-drama-${candidate.stage}-terminal-v1` })
  const receipt = await createVerificationReceiptV1({ version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash, contextManifestHashes: [candidate.contextManifestHash], candidateHashes: [candidate.candidateHash], adoptionEventIds: [], postStateHash: stateHash, verifierSetVersion: `motion-drama-${candidate.stage}-terminal-v1`, criteria: [
    { id: `${step}.candidate`, status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
    { id: `${step}.author`, status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
    { id: `${step}.post-state`, status: 'passed', evidenceRefs: [`post-state:${stateHash}`] },
  ], acceptedAt: Date.now() })
  snapshot = await append(scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function readPendingMotionDramaCandidateV1(scope: WorkspaceScope): Promise<{ snapshot: AgentRunSnapshotV1; candidate: MotionDramaProfessionalCandidateV1; authorPayload?: MotionDramaCandidatePayloadV1; resuming?: boolean } | null> {
  const capturedScope = { ...scope }
  const tasks = (await listMotionMaterialTasks(capturedScope)).sort((a, b) => Number(b.resuming) - Number(a.resuming) || b.id - a.id)
  for (const task of tasks) {
    if (!task.verified || (!task.resuming && (!task.controlVerified || task.stoppedWaiting || task.status !== 'awaiting_confirmation'))) continue
    try {
      const detail = await readMotionDramaTaskV1(capturedScope, task.id)
      if (!detail.candidate) continue
      if (detail.task.resuming) return { snapshot: detail.snapshot, candidate: detail.candidate, authorPayload: detail.authorPayload, resuming: true }
      if (detail.task.controlVerified && !detail.task.stoppedWaiting && detail.task.status === 'awaiting_confirmation') return { snapshot: detail.snapshot, candidate: detail.candidate }
    } catch { /* Read-only history retains the task even without a candidate. */ }
  }
  return null
}

export async function rejectMotionDramaProfessionalCandidateV1(scope: WorkspaceScope, runId: number): Promise<void> {
  let snapshot = await readAgentRunV1(scope, runId); const state = await latest(scope, runId)
  if (state.intent || snapshot.projection.state !== 'awaiting_confirmation') throw new Error('[motion-drama-run] 候选不在等待确认状态')
  const step = stepId(state.candidate.stage)
  snapshot = await append(scope, snapshot, 'confirmation.recorded', { stepId: step, candidateHash: state.candidate.candidateHash, decision: 'reject' })
  await append(scope, snapshot, 'run.cancelled', { reason: `author-rejected-motion-drama-${state.candidate.stage}` })
}

/** Task history does not depend on the existence or validity of a candidate. */
export async function listMotionMaterialTasks(scope: WorkspaceScope): Promise<MotionDramaTaskV1[]> {
  const capturedScope = { ...scope }
  const rows = (await readOwnedRows<AgentRunRecord>(capturedScope, 'agentRuns', { owner: 'work' })).filter(row => row.contractJson.includes('motion-drama:'))
  const channelEvents = await taskChannelEvents(capturedScope)
  const tasks: MotionDramaTaskV1[] = []
  for (const row of rows) {
    if (!row.id) continue
    try {
      const snapshot = await readAgentRunV1(capturedScope, row.id)
      const terminal = ['completed', 'cancelled', 'failed'].includes(snapshot.projection.state)
      tasks.push((await inspectTask(capturedScope, snapshot, channelEvents, !terminal)).task)
    } catch (error) {
      tasks.push({ id: row.id, stage: null, status: 'unverified', verified: false,
        generation: row.generation, lastSequence: row.lastSequence, requestedAttempts: 0, respondedAttempts: 0,
        hasUnresolvedRequest: false, candidateState: 'unverified', stoppedWaiting: false, controlVerified: false,
        resuming: false, canStopWaiting: false, canRecoverCandidate: false,
        diagnostics: [error instanceof Error ? error.message : String(error)], rawResponseReferences: [] })
    }
  }
  return tasks.sort((a, b) => b.id - a.id)
}

/** Explicit, zero-model recovery of an already verified candidate checkpoint. */
export async function recoverMotionDramaCandidateV1(scope: WorkspaceScope, runId: number, expected: { generation: number; lastSequence: number; candidateHash: string }): Promise<{ snapshot: AgentRunSnapshotV1; candidate: MotionDramaProfessionalCandidateV1 }> {
  const captured = { scope: { ...scope }, runId, generation: expected.generation, lastSequence: expected.lastSequence, candidateHash: expected.candidateHash }
  if (!/^[a-f0-9]{64}$/.test(captured.candidateHash)) throw new Error('[motion-drama-task] 缺少准确候选 hash')
  const verified = await readLatestVerifiedAgentRunCheckpointV1(captured.scope, captured.runId)
  if (!verified) throw new Error('[motion-drama-task] 没有已保存的候选，不能通过恢复重新调用模型')
  const candidate = await parseCandidate(verified.resumePayload)
  let snapshot = verified.snapshot
  const stage = taskStage(snapshot)
  const step = `motion-drama:${stage}`
  if (candidate.projectId !== captured.scope.projectId || candidate.worldId !== captured.scope.worldId || candidate.workId !== captured.scope.workId
    || candidate.stage !== stage || candidate.candidateHash !== captured.candidateHash || snapshot.projection.generation !== captured.generation) throw new Error('[motion-drama-task] 恢复候选或作用域已变化')
  if (snapshot.projection.state === 'awaiting_confirmation' && snapshot.projection.steps[step]?.candidateHash === captured.candidateHash) return { snapshot, candidate }
  if (snapshot.projection.lastSequence !== captured.lastSequence || !['running', 'paused', 'recovering'].includes(snapshot.projection.state)) throw new Error('[motion-drama-task] 任务已推进，请刷新恢复入口')
  await assertTaskHasNoFrozenAdoption(captured.scope, snapshot)
  await candidateFresh(captured.scope, candidate)
  const checkpointHash = verified.checkpoint.checkpointHash
  if (snapshot.projection.state === 'paused' || snapshot.projection.state === 'recovering') {
    const plan = await beginAgentRunRecoveryV1({ scope: captured.scope, runId: captured.runId, expectedLastSequence: snapshot.projection.lastSequence })
    if (plan.checkpointHash !== checkpointHash) throw new Error('[motion-drama-task] 恢复检查点已变化')
    snapshot = await completeAgentRunRecoveryV1({ scope: captured.scope, runId: captured.runId, checkpointHash, expectedLastSequence: plan.snapshot.projection.lastSequence })
  }
  const expectedSequence = snapshot.projection.lastSequence
  return withAgentRunMutationLockV1(captured.runId, () => db.transaction('rw', agentRunScopeTransactionTablesV1(captured.runId,
    db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, db.agentConversations, db.agentEvents,
    db.adaptationProjects, db.adaptationSourceUnits, db.outlineNodes, db.chapters, db.storyCores,
    db.motionDramaProductions,
  ), async () => {
    const current = await readVerifiedAgentRunInTransactionV1(captured.scope, captured.runId)
    const latestCheckpoint = await readLatestVerifiedAgentRunCheckpointV1(captured.scope, captured.runId)
    if (taskStage(current) !== stage || current.projection.generation !== captured.generation || !latestCheckpoint || latestCheckpoint.checkpoint.checkpointHash !== checkpointHash) throw new Error('[motion-drama-task] 恢复依据已变化')
    taskWaitControl(current, await taskChannelEvents(captured.scope))
    if (current.projection.state === 'awaiting_confirmation' && current.projection.steps[step]?.candidateHash === candidate.candidateHash) return { snapshot: current, candidate }
    if (current.projection.lastSequence !== expectedSequence || current.projection.state !== 'running') throw new Error('[motion-drama-task] 恢复运行已被其它操作推进')
    await assertTaskHasNoFrozenAdoption(captured.scope, current)
    await candidateFresh(captured.scope, candidate)
    const activeStep = current.projection.steps[step]
    if (!activeStep || activeStep.status !== 'running' || activeStep.candidateHash) throw new Error('[motion-drama-task] 岗位不是可恢复候选状态')
    const event = parseAgentRunEventV1({ version: 1, runId: captured.runId, sequence: current.projection.lastSequence + 1,
      generation: current.projection.generation, projectId: current.run.projectId, worldGroupId: current.run.worldGroupId ?? null,
      contractHash: current.run.contractHash, type: 'candidate.persisted', createdAt: Date.now(), payload: { stepId: step, attempt: activeStep.attempt, candidateHash: candidate.candidateHash, requiresConfirmation: true } })
    return { snapshot: await appendAgentRunEventWithSettlementInTransactionV1({ snapshot: current, event, scope: captured.scope, workspaceDirty: true }), candidate }
  }))
}
