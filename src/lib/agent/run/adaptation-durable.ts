import { chat } from '../../ai/client'
import { inspectAdaptationFreshness, confirmAdaptationBrief, confirmAdaptationPlan, saveAdaptationBriefDraft, saveAdaptationPlanDraft } from '../../adaptation/source-manifest'
import { db } from '../../db/schema'
import { assembleContext } from '../../registry/assemble-context'
import type {
  AdaptationBriefV1,
  AdaptationPlanV1,
  AdaptationProject,
  AIConfig,
  ChatMessage,
  ComicPage,
  ComicPanel,
  ScreenplayScene,
  WorkspaceScope,
} from '../../types'
import { readOwnedRows } from '../../workspace/scope'
import { adoptScreenplaySceneBatchV1, type ScreenplayCastResourceV1, type ScreenplaySceneCandidateV1 } from '../../screenplay/adoption'
import { adoptComicStoryboardBatchV1, assertComicStoryboardCandidateV1, type ComicPageCandidateV1 } from '../../comic/adoption'
import { assertAdaptationBriefV1, assertAdaptationPlanV1 } from '../../adaptation/contracts'
import { createAgentSkillExecutionBindingV1 } from '../execution-binding'
import { getAgentSkillV1 } from '../skill-registry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from './checkpoint'
import { createContextManifestFromAssemblyV1 } from './context-manifest'
import {
  appendAgentRunEventV1,
  createAgentRunV1,
  readAgentRunV1,
  type AgentRunSnapshotV1,
} from './event-store'
import { canonicalStringify, hashCanonicalValue } from './hash'
import { createVerificationReceiptV1 } from './verification-receipt'

export type AdaptationCandidateKindV1 = 'brief' | 'plan' | 'comic-plan' | 'screenplay-scenes' | 'comic-storyboard'

type CandidatePayloadByKindV1 = {
  brief: AdaptationBriefV1
  plan: AdaptationPlanV1
  'comic-plan': AdaptationPlanV1
  'screenplay-scenes': ScreenplaySceneCandidateV1[]
  'comic-storyboard': ComicPageCandidateV1[]
}

export interface AdaptationStructuredCandidateV1<K extends AdaptationCandidateKindV1 = AdaptationCandidateKindV1> {
  version: 1
  kind: 'adaptation-structured-candidate'
  portable: false
  artifactKind: K
  projectId: number
  worldId: number
  workId: number
  adaptationProjectId: number
  adaptationRevision: number
  sourceManifestVersion: number
  sourceManifestHash: string
  briefHash: string | null
  planHash: string | null
  visualBibleHash: string | null
  selectedPlanSectionKeys: string[]
  contextManifestHash: string
  contextInputHash: string
  promptHash: string
  modelOutputHash: string
  payload: CandidatePayloadByKindV1[K]
  payloadHash: string
  candidateHash: string
}

interface AdaptationAdoptionIntentV1<K extends AdaptationCandidateKindV1 = AdaptationCandidateKindV1> {
  version: 1
  kind: 'adaptation-adoption-intent'
  portable: false
  candidate: AdaptationStructuredCandidateV1<K>
  authorPayload: CandidatePayloadByKindV1[K]
  authorPayloadHash: string
  castResources: ScreenplayCastResourceV1[]
  allowReplaceReviewed: boolean
  intentHash: string
}

export type AdaptationDurableBoundaryV1 =
  | 'model.requested'
  | 'model.responded'
  | 'candidate.checkpoint'
  | 'candidate.persisted'
  | 'intent.checkpoint'
  | 'confirmation.recorded'
  | 'adoption.started'
  | 'formal.written'
  | 'adoption.committed'
  | 'step.succeeded'
  | 'verification.started'
  | 'verification.accepted'

type RunAI = (messages: ChatMessage[]) => Promise<string>

const ARTIFACT_CONFIG = {
  brief: {
    skillId: 'outline.adaptation-brief',
    stepId: 'adaptation:brief',
    category: 'adaptation.brief',
    verifier: 'adaptation-brief-terminal-v1',
  },
  plan: {
    skillId: 'outline.screenplay-plan',
    stepId: 'adaptation:plan',
    category: 'adaptation.plan',
    verifier: 'adaptation-plan-terminal-v1',
  },
  'comic-plan': {
    skillId: 'outline.comic-plan',
    stepId: 'adaptation:comic-plan',
    category: 'adaptation.comic-plan',
    verifier: 'comic-plan-terminal-v1',
  },
  'screenplay-scenes': {
    skillId: 'prose.screenplay-scenes',
    stepId: 'adaptation:screenplay-scenes',
    category: 'adaptation.screenplay-scenes',
    verifier: 'screenplay-scenes-terminal-v1',
  },
  'comic-storyboard': {
    skillId: 'outline.comic-storyboard',
    stepId: 'adaptation:comic-storyboard',
    category: 'adaptation.comic-storyboard',
    verifier: 'comic-storyboard-terminal-v1',
  },
} as const

const BRIEF_KEYS = [
  'version', 'coreTheme', 'dominantEmotion', 'mustKeep', 'mayCut', 'mayMerge', 'mayReorder',
  'allowedAdditions', 'audience', 'rating', 'targetScale', 'narrativePerspective', 'timeBudget',
  'costLimit', 'deviationNotes', 'unresolvedQuestions', 'assumptions',
] as const
const PLAN_KEYS = ['version', 'premise', 'sections', 'globalAssumptions'] as const
const PLAN_SECTION_KEYS = ['stableKey', 'title', 'summary', 'order', 'episodeNumber', 'sourceUnitKeys'] as const
const SCENE_KEYS = [
  'stableKey', 'planSectionKey', 'episodeNumber', 'sceneNumber', 'intExt', 'location', 'timeOfDay',
  'summary', 'estimatedSeconds', 'sourceUnitKeys', 'blocks',
] as const

function exactKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[adaptation-run] ${label} 必须是对象`)
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`[adaptation-run] ${label} 字段不在允许闭集`)
}

function parseJsonObject(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new Error('[adaptation-run] 模型输出不是严格 JSON')
  }
}

function parseBrief(value: unknown): AdaptationBriefV1 {
  exactKeys(value, BRIEF_KEYS, 'Brief')
  assertAdaptationBriefV1(value as unknown as AdaptationBriefV1)
  return structuredClone(value) as unknown as AdaptationBriefV1
}

function parsePlan(value: unknown): AdaptationPlanV1 {
  exactKeys(value, PLAN_KEYS, 'Plan')
  if (!Array.isArray(value.sections)) throw new Error('[adaptation-run] Plan.sections 必须是数组')
  value.sections.forEach((section, index) => exactKeys(section, PLAN_SECTION_KEYS, `Plan.sections[${index}]`))
  assertAdaptationPlanV1(value as unknown as AdaptationPlanV1)
  return structuredClone(value) as unknown as AdaptationPlanV1
}

function parseSceneBlock(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[adaptation-run] ${label} 必须是对象`)
  const type = (value as Record<string, unknown>).type
  const keys = type === 'character'
    ? ['id', 'type', 'characterResourceKey', 'name', 'extension', 'dualDialogue']
    : ['id', 'type', 'text']
  const required = type === 'character' ? ['id', 'type', 'name'] : keys
  const actual = Object.keys(value)
  if (actual.some(key => !keys.includes(key)) || required.some(key => !actual.includes(key))) throw new Error(`[adaptation-run] ${label} 字段非法`)
}

function parseScenes(value: unknown): ScreenplaySceneCandidateV1[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) throw new Error('[adaptation-run] 剧本候选每批必须包含 1～10 场')
  value.forEach((scene, index) => {
    exactKeys(scene, SCENE_KEYS, `scenes[${index}]`)
    if (!Array.isArray(scene.blocks)) throw new Error(`[adaptation-run] scenes[${index}].blocks 必须是数组`)
    scene.blocks.forEach((block, blockIndex) => parseSceneBlock(block, `scenes[${index}].blocks[${blockIndex}]`))
  })
  return structuredClone(value) as ScreenplaySceneCandidateV1[]
}

function parseComicStoryboard(value: unknown): ComicPageCandidateV1[] {
  assertComicStoryboardCandidateV1(value)
  return structuredClone(value)
}

function parsePayload<K extends AdaptationCandidateKindV1>(kind: K, value: unknown): CandidatePayloadByKindV1[K] {
  if (kind === 'brief') return parseBrief(value) as CandidatePayloadByKindV1[K]
  if (kind === 'plan' || kind === 'comic-plan') return parsePlan(value) as CandidatePayloadByKindV1[K]
  if (kind === 'screenplay-scenes') return parseScenes(value) as CandidatePayloadByKindV1[K]
  return parseComicStoryboard(value) as CandidatePayloadByKindV1[K]
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'],
  payload: any,
): Promise<AgentRunSnapshotV1> {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as any)
}

async function pauseUnsafe(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, reason: string): Promise<void> {
  if (['running', 'awaiting_confirmation', 'verifying'].includes(snapshot.projection.state)) {
    await append(scope, snapshot, 'run.paused', { reason, recoverable: false })
  }
}

function runContract(scope: WorkspaceScope, artifactKind: AdaptationCandidateKindV1) {
  const config = ARTIFACT_CONFIG[artifactKind]
  const skill = getAgentSkillV1(config.skillId)
  return {
    version: 1 as const,
    objective: artifactKind === 'brief'
      ? '根据冻结小说来源生成改编 Brief 候选并等待作者确认'
      : artifactKind === 'plan' || artifactKind === 'comic-plan'
        ? '根据已确认 Brief 与冻结小说来源生成改编结构计划候选并等待作者确认'
        : artifactKind === 'screenplay-scenes'
          ? '根据已确认改编计划与冻结小说来源生成正规剧本场景候选并等待作者确认'
          : '根据已确认漫画计划、视觉圣经与冻结小说来源生成页格分镜候选并等待作者确认',
    workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: {
      contextSourceKeys: [...skill.contextSourceKeys],
      writeTargets: skill.writeTargets.map(target => ({ table: target.table, fields: [...target.fields], mode: 'author-confirmed' as const })),
    },
    executionBindings: [{ stepId: config.stepId, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 48_000,
      maxOutputTokens: skill.maxOutputTokens,
      maxAttemptsPerStep: 1,
      maxProtocolErrors: 0,
    },
    acceptance: [
      { id: `${config.stepId}.candidate`, kind: 'output-present' as const, required: true },
      { id: `${config.stepId}.author`, kind: 'author-confirmed' as const, required: true },
      { id: `${config.stepId}.post-state`, kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{
      id: `${config.stepId}.terminal`,
      kind: 'terminal' as const,
      verifier: config.verifier,
      criterionIds: [`${config.stepId}.candidate`, `${config.stepId}.author`, `${config.stepId}.post-state`],
    }],
    failurePolicy: {
      onProtocolError: 'fail' as const,
      onVerificationFailure: 'fail' as const,
      onStaleInput: 'pause-for-author' as const,
    },
  }
}

async function readRoot(scope: WorkspaceScope, adaptationProjectId: number): Promise<AdaptationProject & { id: number }> {
  const root = await db.adaptationProjects.get(adaptationProjectId)
  if (!root?.id || root.projectId !== scope.projectId || root.worldId !== scope.worldId || root.workId !== scope.workId) {
    throw new Error('[adaptation-run] 改编项目不存在或越过当前 Work')
  }
  return root as AdaptationProject & { id: number }
}

async function sourceKeys(root: AdaptationProject & { id: number }, selectedPlanSectionKeys: readonly string[]): Promise<string[]> {
  const units = await db.adaptationSourceUnits
    .where('[adaptationProjectId+manifestVersion]')
    .equals([root.id, root.activeSourceManifestVersion])
    .sortBy('order')
  const allowed = new Set(units.map(unit => unit.sourceUnitKey))
  if (!selectedPlanSectionKeys.length || !root.plan) return [...allowed]
  const sections = root.plan.sections.filter(section => selectedPlanSectionKeys.includes(section.stableKey))
  if (sections.length !== selectedPlanSectionKeys.length) throw new Error('[adaptation-run] 选定计划段不存在或重复')
  const selected = [...new Set(sections.flatMap(section => section.sourceUnitKeys))]
  if (selected.some(key => !allowed.has(key))) throw new Error('[adaptation-run] 计划引用了当前 manifest 之外的来源')
  return selected.length ? selected : [...allowed]
}

function promptFor<K extends AdaptationCandidateKindV1>(input: {
  kind: K
  root: AdaptationProject
  context: string
  selectedPlanSectionKeys: string[]
  authorInstruction: string
}): ChatMessage[] {
  const common = [
    '你是专业小说改编编辑。只能使用下方登记上下文，不得把摘要当原文，不得虚构来源事实。',
    '只输出单一 JSON 值，不要 Markdown、解释或代码围栏。所有稳定引用必须使用 sourceUnitKey/planSectionKey，不得输出数据库数字 ID。',
    input.authorInstruction.trim() ? `作者附加要求：${input.authorInstruction.trim()}` : '',
    `目标规格：${JSON.stringify(input.root.targetSpec)}`,
    `登记上下文：\n${input.context}`,
  ].filter(Boolean)
  if (input.kind === 'brief') {
    return [{ role: 'system', content: common.join('\n\n') }, { role: 'user', content: `生成 version=1 的改编 Brief。字段必须严格且仅为：${BRIEF_KEYS.join(', ')}。数组字段给出可执行条目；不确定内容放 unresolvedQuestions 或 assumptions。` }]
  }
  if (input.kind === 'plan' || input.kind === 'comic-plan') {
    return [{ role: 'system', content: common.join('\n\n') }, { role: 'user', content: `生成 version=1 的改编 Plan。顶层字段严格且仅为：${PLAN_KEYS.join(', ')}。每个 sections 项字段严格且仅为：${PLAN_SECTION_KEYS.join(', ')}；stableKey 使用可移植英文键；sourceUnitKeys 只能取来源清单中的键。` }]
  }
  if (input.kind === 'screenplay-scenes') {
    return [{ role: 'system', content: common.join('\n\n') }, { role: 'user', content: [
      `为计划段 ${input.selectedPlanSectionKeys.join(', ')} 生成 1～10 场正规剧本场景 JSON 数组。`,
      `每场字段严格且仅为：${SCENE_KEYS.join(', ')}。`,
      'blocks 类型只允许 action、character、parenthetical、dialogue、transition、shot、note。每个 block 有稳定字符串 id；普通 block 只有 id/type/text；character block 可有 characterResourceKey/name/extension/dualDialogue，不得输出 characterId。',
      '对白顺序必须为 character → 可选 parenthetical → dialogue；双人并排对白用相邻的两组 character/dialogue，并在两个人物块标记 dualDialogue=true。',
    ].join('\n') }]
  }
  return [{ role: 'system', content: common.join('\n\n') }, { role: 'user', content: [
    `为计划段 ${input.selectedPlanSectionKeys.join(', ')} 生成 1～12 页漫画分镜 JSON 数组。`,
    '每页字段严格且仅为 stableKey、chapterNumber、summary、panels；每页 1～9 格，页面不得开启格重叠。',
    '每格字段严格且仅为 stableKey、frame、shot、action、visualPrompt、negativePrompt、continuityRefs、lettering、sourceUnitKeys。frame 使用 0～1 归一化 x/y/width/height，相邻格保留至少 0.01 间隙。',
    'shot 仅含 size、angle、movement、composition。continuityRefs 仅可引用视觉圣经中已存在的 subjectKey。sourceUnitKeys 只能取冻结来源 key。',
    'lettering 每项严格包含 id、kind、text、frame、direction、fontFamily、fontSize、textColor、fillColor、strokeColor、strokeWidth、tail、zIndex；kind 仅 speech/thought/caption/sfx，fontFamily 仅 storyforge-sans/storyforge-serif，tail 为 null 或归一化 x/y。',
    '图像 Prompt 必须要求无文字、无气泡、无水印；对白、旁白与拟声仅进入本地 lettering。',
  ].join('\n') }]
}

async function assembleForRun(input: {
  scope: WorkspaceScope
  root: AdaptationProject & { id: number }
  kind: AdaptationCandidateKindV1
  selectedPlanSectionKeys: string[]
  keys: string[]
  aiConfig?: AIConfig
}) {
  const skill = getAgentSkillV1(ARTIFACT_CONFIG[input.kind].skillId)
  return assembleContext({
    projectId: input.scope.projectId,
    scope: input.scope,
    sourceKeys: [...skill.contextSourceKeys],
    adaptationProjectId: input.root.id,
    adaptationSourceManifestVersion: input.root.activeSourceManifestVersion,
    adaptationSourceUnitKeys: input.keys,
    provider: input.aiConfig?.provider,
    model: input.aiConfig?.model,
    inputBudgetMaxTokens: 48_000,
  })
}

export async function generateAdaptationCandidateV1<K extends AdaptationCandidateKindV1>(input: {
  scope: WorkspaceScope
  adaptationProjectId: number
  artifactKind: K
  selectedPlanSectionKeys?: string[]
  authorInstruction?: string
  aiConfig?: AIConfig
  runAI?: RunAI
  onDurableBoundary?: (boundary: AdaptationDurableBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: AdaptationStructuredCandidateV1<K> }> {
  if (!input.aiConfig && !input.runAI) throw new Error('[adaptation-run] 缺少 AI 配置')
  const root = await readRoot(input.scope, input.adaptationProjectId)
  const freshness = await inspectAdaptationFreshness(root.id)
  if (freshness.status !== 'unchanged') throw new Error('[adaptation-run] 来源已变化或缺失，请先重新同步')
  if (input.artifactKind !== 'brief' && (!root.brief || root.briefSourceManifestVersion !== root.activeSourceManifestVersion)) throw new Error('[adaptation-run] 当前来源版本的 Brief 尚未确认')
  if (input.artifactKind === 'plan' && root.medium !== 'screenplay') throw new Error('[adaptation-run] 剧本 Plan 候选只能用于剧本改编')
  if (input.artifactKind === 'comic-plan' && root.medium !== 'comic') throw new Error('[adaptation-run] 漫画 Plan 候选只能用于漫画改编')
  if (input.artifactKind === 'screenplay-scenes') {
    if (root.medium !== 'screenplay') throw new Error('[adaptation-run] 只有剧本改编可生成剧本场景')
    if (!root.plan || root.planSourceManifestVersion !== root.activeSourceManifestVersion) throw new Error('[adaptation-run] 当前来源版本的 Plan 尚未确认')
    if (!['producing', 'review'].includes(root.status)) throw new Error('[adaptation-run] 请先进入剧本生产阶段')
  }
  if (input.artifactKind === 'comic-storyboard') {
    if (root.medium !== 'comic') throw new Error('[adaptation-run] 只有漫画改编可生成漫画分镜')
    if (!root.plan || root.planSourceManifestVersion !== root.activeSourceManifestVersion) throw new Error('[adaptation-run] 当前来源版本的漫画 Plan 尚未确认')
    if (!root.visualBible || root.visualBibleSourceManifestVersion !== root.activeSourceManifestVersion) throw new Error('[adaptation-run] 当前来源版本的视觉圣经尚未确认')
    if (!['producing', 'review'].includes(root.status)) throw new Error('[adaptation-run] 请先进入漫画生产阶段')
  }
  const selectedPlanSectionKeys = [...new Set(input.selectedPlanSectionKeys ?? [])]
  if (['screenplay-scenes', 'comic-storyboard'].includes(input.artifactKind) && !selectedPlanSectionKeys.length) throw new Error('[adaptation-run] 请至少选择一个计划段')
  const keys = await sourceKeys(root, selectedPlanSectionKeys)
  const config = ARTIFACT_CONFIG[input.artifactKind]
  const skill = getAgentSkillV1(config.skillId)
  let snapshot = await createAgentRunV1({ scope: input.scope, worldGroupId: null, contract: runContract(input.scope, input.artifactKind) })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: config.stepId })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: config.stepId, attempt: 1 })
  const assembled = await assembleForRun({ scope: input.scope, root, kind: input.artifactKind, selectedPlanSectionKeys, keys, aiConfig: input.aiConfig })
  const manifest = await createContextManifestFromAssemblyV1({
    runId: snapshot.run.id,
    stepId: config.stepId,
    attempt: 1,
    projectId: input.scope.projectId,
    worldGroupId: null,
    declaredSourceKeys: [...skill.contextSourceKeys],
    assembled,
    readerVersion: `adaptation-${input.artifactKind}-context-v1`,
  })
  snapshot = await append(input.scope, snapshot, 'context.assembled', { stepId: config.stepId, attempt: 1, manifestHash: manifest.manifestHash })
  const messages = promptFor({ kind: input.artifactKind, root, context: assembled.text, selectedPlanSectionKeys, authorInstruction: input.authorInstruction ?? '' })
  snapshot = await append(input.scope, snapshot, 'model.requested', {
    stepId: config.stepId,
    attempt: 1,
    bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]),
  })
  let raw: string
  try {
    await input.onDurableBoundary?.('model.requested', snapshot)
    raw = await (input.runAI
      ? input.runAI(messages)
      : chat(messages, input.aiConfig!, {
          category: config.category,
          projectId: input.scope.projectId,
          configOverrides: { maxTokens: skill.maxOutputTokens },
          contextOverflowPolicy: 'reject',
        }))
  } catch (error) {
    await pauseUnsafe(input.scope, snapshot, `adaptation-${input.artifactKind}-model-outcome-unknown`)
    throw error
  }
  snapshot = await append(input.scope, snapshot, 'model.responded', { stepId: config.stepId, attempt: 1, outputHash: await hashCanonicalValue({ raw }) })
  try {
    await input.onDurableBoundary?.('model.responded', snapshot)
  } catch (error) {
    await pauseUnsafe(input.scope, snapshot, `adaptation-${input.artifactKind}-result-uncheckpointed`)
    throw error
  }
  let payload: CandidatePayloadByKindV1[K]
  try {
    payload = parsePayload(input.artifactKind, parseJsonObject(raw))
  } catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', { stepId: config.stepId, attempt: 1, code: `adaptation-${input.artifactKind}-protocol-failed`, retryable: false, category: 'protocol', action: 'fail' })
    await append(input.scope, snapshot, 'run.failed', { code: `adaptation-${input.artifactKind}-protocol-failed`, retryable: false })
    throw error
  }
  const body = {
    version: 1 as const,
    kind: 'adaptation-structured-candidate' as const,
    portable: false as const,
    artifactKind: input.artifactKind,
    projectId: input.scope.projectId,
    worldId: input.scope.worldId,
    workId: input.scope.workId,
    adaptationProjectId: root.id,
    adaptationRevision: root.revision,
    sourceManifestVersion: root.activeSourceManifestVersion,
    sourceManifestHash: root.activeSourceManifestHash,
    briefHash: root.brief ? await hashCanonicalValue(root.brief) : null,
    planHash: root.plan ? await hashCanonicalValue(root.plan) : null,
    visualBibleHash: root.medium === 'comic' && root.visualBible ? await hashCanonicalValue(root.visualBible) : null,
    selectedPlanSectionKeys,
    contextManifestHash: manifest.manifestHash,
    contextInputHash: await hashCanonicalValue({ text: assembled.text, sourceEvidence: assembled.sourceEvidence }),
    promptHash: await hashCanonicalValue(messages),
    modelOutputHash: await hashCanonicalValue({ raw }),
    payload,
    payloadHash: await hashCanonicalValue(payload),
  }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) } as AdaptationStructuredCandidateV1<K>
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate })
  snapshot = saved.snapshot
  await input.onDurableBoundary?.('candidate.checkpoint', snapshot)
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId: config.stepId, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: true })
  await input.onDurableBoundary?.('candidate.persisted', snapshot)
  return { snapshot, candidate }
}

async function parseCandidate(value: unknown): Promise<AdaptationStructuredCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[adaptation-run] 候选检查点无效')
  const row = value as AdaptationStructuredCandidateV1
  if (row.version !== 1 || row.kind !== 'adaptation-structured-candidate' || row.portable !== false || !Object.prototype.hasOwnProperty.call(ARTIFACT_CONFIG, row.artifactKind)) throw new Error('[adaptation-run] 候选检查点类型无效')
  const payload = parsePayload(row.artifactKind, row.payload)
  if (await hashCanonicalValue(payload) !== row.payloadHash) throw new Error('[adaptation-run] 候选 payload hash 不匹配')
  const { candidateHash: _candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== row.candidateHash) throw new Error('[adaptation-run] 候选 hash 不匹配')
  return row
}

async function latestState(scope: WorkspaceScope, runId: number): Promise<{ candidate: AdaptationStructuredCandidateV1; intent: AdaptationAdoptionIntentV1 | null }> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('[adaptation-run] 运行缺少可验证检查点')
  const value = checkpoint.resumePayload
  if (value && typeof value === 'object' && !Array.isArray(value) && (value as any).kind === 'adaptation-adoption-intent') {
    const intent = value as AdaptationAdoptionIntentV1
    const candidate = await parseCandidate(intent.candidate)
    const authorPayload = parsePayload(candidate.artifactKind, intent.authorPayload)
    if (await hashCanonicalValue(authorPayload) !== intent.authorPayloadHash) throw new Error('[adaptation-run] 作者采纳 payload hash 不匹配')
    const { intentHash: _intentHash, ...body } = intent
    if (await hashCanonicalValue(body) !== intent.intentHash) throw new Error('[adaptation-run] 采纳意图 hash 不匹配')
    return { candidate, intent }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

function targets(scope: WorkspaceScope, candidate: AdaptationStructuredCandidateV1): boolean {
  return candidate.projectId === scope.projectId && candidate.worldId === scope.worldId && candidate.workId === scope.workId
}

export async function readPendingAdaptationCandidateV1(input: {
  scope: WorkspaceScope
  artifactKind?: AdaptationCandidateKindV1
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: AdaptationStructuredCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(input.scope, 'agentRuns', { owner: 'work' }))
    .filter(row => ['awaiting_confirmation', 'running'].includes(row.status) && row.contractJson?.includes('adaptation:'))
    .sort((left, right) => (right.id ?? 0) - (left.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(input.scope, row.id)
      const state = await latestState(input.scope, row.id)
      if (!targets(input.scope, state.candidate) || state.intent || (input.artifactKind && state.candidate.artifactKind !== input.artifactKind)) continue
      const config = ARTIFACT_CONFIG[state.candidate.artifactKind]
      if (!snapshot.projection.steps[config.stepId]?.candidateHash && snapshot.projection.steps[config.stepId]?.status === 'running') {
        snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId: config.stepId, attempt: 1, candidateHash: state.candidate.candidateHash, requiresConfirmation: true })
      }
      if (snapshot.projection.state === 'awaiting_confirmation') return { snapshot, candidate: state.candidate }
    } catch {
      // A damaged or stale run is deliberately not surfaced as a usable candidate.
    }
  }
  return null
}

async function assertCandidateFresh(scope: WorkspaceScope, candidate: AdaptationStructuredCandidateV1): Promise<AdaptationProject & { id: number }> {
  const root = await readRoot(scope, candidate.adaptationProjectId)
  const rootAtExpectedRevision = root.revision === candidate.adaptationRevision
  const briefIntermediate = candidate.artifactKind === 'brief' && root.revision === candidate.adaptationRevision + 1
  const planIntermediate = (candidate.artifactKind === 'plan' || candidate.artifactKind === 'comic-plan') && root.revision === candidate.adaptationRevision + 1
  if (!rootAtExpectedRevision && !briefIntermediate && !planIntermediate) throw new Error('[adaptation-run] 改编根已变化，候选已 stale')
  if (root.activeSourceManifestVersion !== candidate.sourceManifestVersion || root.activeSourceManifestHash !== candidate.sourceManifestHash) throw new Error('[adaptation-run] 来源 manifest 已变化，候选已 stale')
  if ((root.brief ? await hashCanonicalValue(root.brief) : null) !== candidate.briefHash && !briefIntermediate) throw new Error('[adaptation-run] Brief 已变化，候选已 stale')
  if ((root.plan ? await hashCanonicalValue(root.plan) : null) !== candidate.planHash && !planIntermediate) throw new Error('[adaptation-run] Plan 已变化，候选已 stale')
  if ((root.medium === 'comic' && root.visualBible ? await hashCanonicalValue(root.visualBible) : null) !== candidate.visualBibleHash) throw new Error('[adaptation-run] 视觉圣经已变化，候选已 stale')
  if ((await inspectAdaptationFreshness(root.id)).status !== 'unchanged') throw new Error('[adaptation-run] 来源内容已变化或缺失，候选已 stale')
  return root
}

async function writeFormal(scope: WorkspaceScope, intent: AdaptationAdoptionIntentV1): Promise<unknown> {
  const candidate = intent.candidate
  let root = await readRoot(scope, candidate.adaptationProjectId)
  if (candidate.artifactKind === 'brief') {
    const payload = intent.authorPayload as AdaptationBriefV1
    const payloadMatches = canonicalStringify(root.brief) === canonicalStringify(payload)
    if (root.briefSourceManifestVersion === root.activeSourceManifestVersion && payloadMatches) return root
    root = await assertCandidateFresh(scope, candidate)
    if (!payloadMatches) root = await saveAdaptationBriefDraft({ adaptationProjectId: root.id, brief: payload, expectedRevision: root.revision }) as AdaptationProject & { id: number }
    return confirmAdaptationBrief({ adaptationProjectId: root.id, expectedRevision: root.revision })
  }
  if (candidate.artifactKind === 'plan' || candidate.artifactKind === 'comic-plan') {
    const payload = intent.authorPayload as AdaptationPlanV1
    const payloadMatches = canonicalStringify(root.plan) === canonicalStringify(payload)
    if (root.planSourceManifestVersion === root.activeSourceManifestVersion && payloadMatches) return root
    root = await assertCandidateFresh(scope, candidate)
    if (!payloadMatches) root = await saveAdaptationPlanDraft({ adaptationProjectId: root.id, plan: payload, expectedRevision: root.revision }) as AdaptationProject & { id: number }
    return confirmAdaptationPlan({ adaptationProjectId: root.id, expectedRevision: root.revision })
  }
  root = await assertCandidateFresh(scope, candidate)
  if (candidate.artifactKind === 'screenplay-scenes') {
    return adoptScreenplaySceneBatchV1({
      scope,
      adaptationProjectId: root.id,
      expectedAdaptationRevision: root.revision,
      sourceManifestVersion: candidate.sourceManifestVersion,
      expectedPlanHash: candidate.planHash!,
      candidates: intent.authorPayload as ScreenplaySceneCandidateV1[],
      castResources: intent.castResources,
      allowReplaceReviewed: intent.allowReplaceReviewed,
    })
  }
  return adoptComicStoryboardBatchV1({
    scope,
    adaptationProjectId: root.id,
    expectedAdaptationRevision: root.revision,
    sourceManifestVersion: candidate.sourceManifestVersion,
    expectedPlanHash: candidate.planHash!,
    expectedVisualBibleHash: candidate.visualBibleHash!,
    candidates: intent.authorPayload as ComicPageCandidateV1[],
  })
}

async function verifyPostState(scope: WorkspaceScope, intent: AdaptationAdoptionIntentV1): Promise<string> {
  const { candidate } = intent
  const root = await readRoot(scope, candidate.adaptationProjectId)
  if (candidate.artifactKind === 'brief') {
    if (root.briefSourceManifestVersion !== root.activeSourceManifestVersion || canonicalStringify(root.brief) !== canonicalStringify(intent.authorPayload)) throw new Error('[adaptation-run] Brief 正式状态与采纳意图不一致')
    return hashCanonicalValue({ rootRevision: root.revision, brief: root.brief, manifest: root.activeSourceManifestHash })
  }
  if (candidate.artifactKind === 'plan' || candidate.artifactKind === 'comic-plan') {
    if (root.planSourceManifestVersion !== root.activeSourceManifestVersion || canonicalStringify(root.plan) !== canonicalStringify(intent.authorPayload)) throw new Error('[adaptation-run] Plan 正式状态与采纳意图不一致')
    return hashCanonicalValue({ rootRevision: root.revision, plan: root.plan, manifest: root.activeSourceManifestHash })
  }
  if (candidate.artifactKind === 'screenplay-scenes') {
    const expected = intent.authorPayload as ScreenplaySceneCandidateV1[]
    const rows = await db.screenplayScenes.where('adaptationProjectId').equals(root.id).toArray()
    const selected = expected.map(item => rows.find(row => row.stableKey === item.stableKey)).filter(Boolean) as ScreenplayScene[]
    if (selected.length !== expected.length) throw new Error('[adaptation-run] 剧本场景正式状态缺失')
    return hashCanonicalValue(selected.map(scene => ({ stableKey: scene.stableKey, revision: scene.revision, sourceReviewManifestVersion: scene.sourceReviewManifestVersion, blocks: scene.blocks })))
  }
  const expected = intent.authorPayload as ComicPageCandidateV1[]
  const pages = await db.comicPages.where('adaptationProjectId').equals(root.id).toArray()
  const selectedPages = expected.map(item => pages.find(page => page.stableKey === item.stableKey)).filter(Boolean) as ComicPage[]
  if (selectedPages.length !== expected.length) throw new Error('[adaptation-run] 漫画页面正式状态缺失')
  const panels = await db.comicPanels.where('pageId').anyOf(selectedPages.map(page => page.id!)).toArray()
  const expectedPanelKeys = new Set(expected.flatMap(page => page.panels.map(panel => panel.stableKey)))
  const selectedPanels = panels.filter(panel => expectedPanelKeys.has(panel.stableKey)) as ComicPanel[]
  if (selectedPanels.length !== expectedPanelKeys.size) throw new Error('[adaptation-run] 漫画格正式状态缺失')
  return hashCanonicalValue({
    pages: selectedPages.map(page => ({ stableKey: page.stableKey, revision: page.revision, summary: page.summary })),
    panels: selectedPanels.map(panel => ({ stableKey: panel.stableKey, revision: panel.revision, sourceReviewManifestVersion: panel.sourceReviewManifestVersion, lettering: panel.lettering, visualPrompt: panel.visualPrompt })),
  })
}

export async function adoptAdaptationCandidateV1<K extends AdaptationCandidateKindV1>(input: {
  scope: WorkspaceScope
  runId: number
  authorPayload?: CandidatePayloadByKindV1[K]
  castResources?: ScreenplayCastResourceV1[]
  allowReplaceReviewed?: boolean
  onDurableBoundary?: (boundary: AdaptationDurableBoundaryV1, snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: AdaptationStructuredCandidateV1<K>; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const state = await latestState(input.scope, input.runId)
  const candidate = state.candidate as AdaptationStructuredCandidateV1<K>
  if (!targets(input.scope, candidate)) throw new Error('[adaptation-run] 候选越过当前 Work')
  const config = ARTIFACT_CONFIG[candidate.artifactKind]
  let intent = state.intent
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    await assertCandidateFresh(input.scope, candidate)
    if (!intent) {
      const authorPayload = parsePayload(candidate.artifactKind, input.authorPayload ?? candidate.payload)
      const authorPayloadHash = await hashCanonicalValue(authorPayload)
      const body = {
        version: 1 as const,
        kind: 'adaptation-adoption-intent' as const,
        portable: false as const,
        candidate,
        authorPayload,
        authorPayloadHash,
        castResources: structuredClone(input.castResources ?? []),
        allowReplaceReviewed: input.allowReplaceReviewed === true,
      }
      intent = { ...body, intentHash: await hashCanonicalValue(body) }
      const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent })
      snapshot = saved.snapshot
      await input.onDurableBoundary?.('intent.checkpoint', snapshot)
    }
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', { stepId: config.stepId, candidateHash: candidate.candidateHash, decision: 'adopt' })
    await input.onDurableBoundary?.('confirmation.recorded', snapshot)
    snapshot = await append(input.scope, snapshot, 'adoption.started', { stepId: config.stepId, candidateHash: candidate.candidateHash, intentHash: intent.intentHash })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  }
  if (!intent || snapshot.projection.steps[config.stepId]?.confirmation !== 'adopt') throw new Error('[adaptation-run] 候选不在可恢复采纳状态')
  let adoptionHash = snapshot.projection.steps[config.stepId]?.adoptionHash
  if (!adoptionHash) {
    await writeFormal(input.scope, intent)
    await input.onDurableBoundary?.('formal.written', snapshot)
    const postStateHash = await verifyPostState(input.scope, intent)
    adoptionHash = await hashCanonicalValue({ intentHash: intent.intentHash, postStateHash })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', { stepId: config.stepId, candidateHash: candidate.candidateHash, adoptionHash })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  const postStateHash = await verifyPostState(input.scope, intent)
  if (snapshot.projection.steps[config.stepId]?.status === 'running') {
    snapshot = await append(input.scope, snapshot, 'step.succeeded', { stepId: config.stepId, attempt: 1, outputHash: adoptionHash })
    await input.onDurableBoundary?.('step.succeeded', snapshot)
  }
  if (snapshot.projection.state === 'running') {
    snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: config.verifier })
    await input.onDurableBoundary?.('verification.started', snapshot)
  }
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash,
    verifierSetVersion: config.verifier,
    criteria: [
      { id: `${config.stepId}.candidate`, status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: `${config.stepId}.author`, status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: `${config.stepId}.post-state`, status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ],
    acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function rejectAdaptationCandidateV1(input: { scope: WorkspaceScope; runId: number }): Promise<AgentRunSnapshotV1> {
  let snapshot = await readAgentRunV1(input.scope, input.runId)
  const { candidate, intent } = await latestState(input.scope, input.runId)
  if (!targets(input.scope, candidate) || snapshot.projection.state !== 'awaiting_confirmation' || intent) throw new Error('[adaptation-run] 候选不在等待确认状态')
  const stepId = ARTIFACT_CONFIG[candidate.artifactKind].stepId
  snapshot = await append(input.scope, snapshot, 'confirmation.recorded', { stepId, candidateHash: candidate.candidateHash, decision: 'reject' })
  return append(input.scope, snapshot, 'run.cancelled', { reason: `author-rejected-${candidate.artifactKind}` })
}
