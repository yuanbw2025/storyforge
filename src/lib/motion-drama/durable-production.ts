import { chat } from '../ai/client'
import type { AIConfig, ChatMessage, MotionDramaPromptStageV1, WorkspaceScope } from '../types'
import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { hashCanonicalValue } from '../agent/run/hash'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { readOwnedRows } from '../workspace/scope'
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

export async function generateMotionDramaCandidateV1(input: { scope: WorkspaceScope; stage: MotionDramaPromptStageV1; episodeNumber: number; authorInstruction?: string; aiConfig?: AIConfig; runAI?: (messages: ChatMessage[]) => Promise<string>; signal?: AbortSignal }): Promise<{ snapshot: AgentRunSnapshotV1; candidate: MotionDramaProfessionalCandidateV1 }> {
  if (!input.aiConfig && !input.runAI) throw new Error('[motion-drama-run] 缺少 AI 配置')
  const roots = await prerequisites(input.scope, input.stage, input.episodeNumber)
  if (roots.production.currentEpisodeNumber !== input.episodeNumber) throw new Error('[motion-drama-run] 当前集已变化，请刷新')
  const config = STAGES[input.stage]; const skill = getAgentSkillV1(config.skillId); const step = stepId(input.stage)
  let snapshot = await createAgentRunV1({ scope: roots.scope, worldGroupId: null, contract: contract(roots.scope, input.stage) })
  snapshot = await append(roots.scope, snapshot, 'step.scheduled', { stepId: step })
  snapshot = await append(roots.scope, snapshot, 'step.started', { stepId: step, attempt: 1 })
  const assembled = await assembleContext({ projectId: roots.scope.projectId, scope: roots.scope, sourceKeys: [...skill.contextSourceKeys], adaptationProjectId: roots.adaptation.id, adaptationSourceManifestVersion: roots.adaptation.activeSourceManifestVersion, adaptationSourceUnitKeys: roots.sourceUnitKeys, provider: input.aiConfig?.provider, model: input.aiConfig?.model, inputBudgetMaxTokens: 64_000 })
  const contextManifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: step, attempt: 1, projectId: roots.scope.projectId, worldGroupId: null, declaredSourceKeys: [...skill.contextSourceKeys], assembled, readerVersion: `motion-drama-${input.stage}-context-v1` })
  snapshot = await append(roots.scope, snapshot, 'context.assembled', { stepId: step, attempt: 1, manifestHash: contextManifest.manifestHash })
  const resolvedPrompt = await resolveMotionDramaPromptV1(roots.scope, input.stage, input.episodeNumber)
  const baseMessages = messagesFor(input.stage, resolvedPrompt.definition.profession, resolvedPrompt.instruction, assembled.text, roots.adaptation.targetSpec, input.episodeNumber, input.authorInstruction ?? '')
  const runModel = async (messages: ChatMessage[], attempt: number) => {
    snapshot = await append(roots.scope, snapshot, 'model.requested', { stepId: step, attempt, bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]) })
    try {
      const output = await (input.runAI ? input.runAI(messages) : chat(messages, input.aiConfig!, { category: config.category, projectId: roots.scope.projectId, configOverrides: { maxTokens: skill.maxOutputTokens }, contextOverflowPolicy: 'reject' }, input.signal))
      snapshot = await append(roots.scope, snapshot, 'model.responded', { stepId: step, attempt, outputHash: await hashCanonicalValue({ raw: output }) })
      return output
    } catch (cause) {
      await append(roots.scope, snapshot, 'run.paused', { reason: `motion-drama-${input.stage}-model-outcome-unknown`, recoverable: false })
      throw cause
    }
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
  const body = { version: 1 as const, kind: 'motion-drama-professional-candidate' as const, portable: false as const, stage: input.stage, projectId: roots.scope.projectId, worldId: roots.scope.worldId, workId: roots.scope.workId, adaptationProjectId: roots.adaptation.id, adaptationRevision: roots.adaptation.revision, productionRevision: roots.production.revision, episodeNumber: input.episodeNumber, sourceManifestVersion: roots.adaptation.activeSourceManifestVersion, sourceManifestHash: roots.adaptation.activeSourceManifestHash, sourceUnitKeys: roots.sourceUnitKeys, contextManifestHash: contextManifest.manifestHash, promptHash: await hashCanonicalValue(finalMessages), promptVersionHash: resolvedPrompt.contentHash, modelOutputHash: await hashCanonicalValue({ raw }), payload, payloadHash: await hashCanonicalValue(payload) }
  const candidate: MotionDramaProfessionalCandidateV1 = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({ scope: roots.scope, runId: snapshot.run.id, resumePayload: candidate }); snapshot = saved.snapshot
  snapshot = await append(roots.scope, snapshot, 'candidate.persisted', { stepId: step, attempt: finalAttempt, candidateHash: candidate.candidateHash, requiresConfirmation: true })
  return { snapshot, candidate }
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
  let snapshot = await readAgentRunV1(input.scope, input.runId); const state = await latest(input.scope, input.runId); const candidate = state.candidate; const step = stepId(candidate.stage); let intent = state.intent
  if (candidate.projectId !== input.scope.projectId || candidate.worldId !== input.scope.worldId || candidate.workId !== input.scope.workId) throw new Error('[motion-drama-run] 候选越过当前 Work')
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    await candidateFresh(input.scope, candidate)
    const authorPayload = parseMotionDramaCandidatePayloadV1(candidate.stage, input.authorPayload ?? candidate.payload) as MotionDramaCandidatePayloadV1
    const body = { version: 1 as const, kind: 'motion-drama-professional-intent' as const, candidate, authorPayload, authorPayloadHash: await hashCanonicalValue(authorPayload) }
    intent = { ...body, intentHash: await hashCanonicalValue(body) }
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent }); snapshot = saved.snapshot
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', { stepId: step, candidateHash: candidate.candidateHash, decision: 'adopt' })
    snapshot = await append(input.scope, snapshot, 'adoption.started', { stepId: step, candidateHash: candidate.candidateHash, intentHash: intent.intentHash })
  }
  if (!intent) throw new Error('[motion-drama-run] 候选不在可采纳状态')
  let adoptionHash = snapshot.projection.steps[step]?.adoptionHash
  if (!adoptionHash) {
    const roots = await requireMotionDramaRootsV1(input.scope)
    if (roots.production.revision === candidate.productionRevision) await adoptMotionDramaCandidateV1({ scope: input.scope, stage: candidate.stage, payload: intent.authorPayload, expectedAdaptationRevision: candidate.adaptationRevision, expectedProductionRevision: candidate.productionRevision, episodeNumber: candidate.episodeNumber })
    else if (!await formalAlreadyApplied(candidate, intent.authorPayload)) throw new Error('[motion-drama-run] 采纳恢复发现并发修改，无法判定正式写入')
    const stateHash = await hashCanonicalValue(await postState(candidate.stage, candidate)); adoptionHash = await hashCanonicalValue({ intentHash: intent.intentHash, stateHash })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', { stepId: step, candidateHash: candidate.candidateHash, adoptionHash })
  }
  const stateHash = await hashCanonicalValue(await postState(candidate.stage, candidate))
  if (snapshot.projection.steps[step]?.status === 'running') snapshot = await append(input.scope, snapshot, 'step.succeeded', { stepId: step, attempt: snapshot.projection.steps[step]?.attempt ?? 1, outputHash: adoptionHash })
  if (snapshot.projection.state === 'running') snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: `motion-drama-${candidate.stage}-terminal-v1` })
  const receipt = await createVerificationReceiptV1({ version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash, contextManifestHashes: [candidate.contextManifestHash], candidateHashes: [candidate.candidateHash], adoptionEventIds: [], postStateHash: stateHash, verifierSetVersion: `motion-drama-${candidate.stage}-terminal-v1`, criteria: [
    { id: `${step}.candidate`, status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
    { id: `${step}.author`, status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
    { id: `${step}.post-state`, status: 'passed', evidenceRefs: [`post-state:${stateHash}`] },
  ], acceptedAt: Date.now() })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function readPendingMotionDramaCandidateV1(scope: WorkspaceScope): Promise<{ snapshot: AgentRunSnapshotV1; candidate: MotionDramaProfessionalCandidateV1 } | null> {
  const runs = (await readOwnedRows<any>(scope, 'agentRuns', { owner: 'work' })).filter(row => ['awaiting_confirmation', 'running'].includes(row.status) && row.contractJson?.includes('motion-drama:')).sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
  for (const run of runs) {
    if (!run.id) continue
    try {
      let snapshot = await readAgentRunV1(scope, run.id); const state = await latest(scope, run.id); if (state.intent) continue; const step = stepId(state.candidate.stage)
      if (!snapshot.projection.steps[step]?.candidateHash && snapshot.projection.steps[step]?.status === 'running') snapshot = await append(scope, snapshot, 'candidate.persisted', { stepId: step, attempt: snapshot.projection.steps[step]?.attempt ?? 1, candidateHash: state.candidate.candidateHash, requiresConfirmation: true })
      if (snapshot.projection.state === 'awaiting_confirmation') return { snapshot, candidate: state.candidate }
    } catch { /* damaged and stale runs are not presented as candidates */ }
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
