import { chat } from '../ai/client'
import type {
  AdaptationBriefV1,
  AIConfig,
  ChatMessage,
  ScreenplayBeatCandidateV1,
  ScreenplayReviewIssueCandidateV1,
  ScreenplayRewritePatchCandidateV1,
  ScreenplaySceneCardCandidateV1,
  WorkspaceScope,
} from '../types'
import type {
  AdaptationCausalEdgeCandidateV1,
  AdaptationDecisionCandidateV1,
  AdaptationSourceFactCandidateV1,
} from '../adaptation/analysis'
import {
  adoptAdaptationCausalEdgesV1,
  adoptAdaptationDecisionsV1,
  adoptAdaptationSourceFactsV1,
} from '../adaptation/analysis'
import { confirmAdaptationBrief, inspectAdaptationFreshness, saveAdaptationBriefDraft } from '../adaptation/source-manifest'
import { assertAdaptationBriefV1 } from '../adaptation/contracts'
import { db } from '../db/schema'
import { assembleContext } from '../registry/assemble-context'
import { readOwnedRows } from '../workspace/scope'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import { appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { hashCanonicalValue } from '../agent/run/hash'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import type { ScreenplaySceneCandidateV1 } from './adoption'
import { adoptScreenplaySceneBatchV1 } from './adoption'
import {
  applyScreenplayRewriteV1,
  adoptScreenplayBeatsV1,
  adoptScreenplayReviewIssuesV1,
  adoptScreenplaySceneCardsV1,
  assertSceneCandidateMatchesCardV1,
} from './production'
import {
  assertCandidateBatchV1,
  SCREENPLAY_BEAT_CANDIDATE_KEYS_V1,
  SCREENPLAY_REVIEW_ISSUE_CANDIDATE_KEYS_V1,
  SCREENPLAY_SCENE_CARD_CANDIDATE_KEYS_V1,
  assertScreenplayBeatCandidateV1,
  assertScreenplayReviewIssueCandidateV1,
  assertScreenplayRewritePatchCandidateV1,
  assertScreenplaySceneCardCandidateV1,
} from './production-contracts'

export type ScreenplayProfessionalStageV1 =
  | 'source-analysis'
  | 'causal-graph'
  | 'adaptation-brief'
  | 'decision-pass'
  | 'beat-sheet'
  | 'scene-card'
  | 'scene-draft'
  | 'grounding-review'
  | 'dramaturgy-review'
  | 'targeted-rewrite'

export type ScreenplayProfessionalPayloadV1 =
  | AdaptationSourceFactCandidateV1[]
  | AdaptationCausalEdgeCandidateV1[]
  | AdaptationBriefV1
  | AdaptationDecisionCandidateV1[]
  | ScreenplayBeatCandidateV1[]
  | ScreenplaySceneCardCandidateV1[]
  | ScreenplaySceneCandidateV1
  | ScreenplayReviewIssueCandidateV1[]
  | ScreenplayRewritePatchCandidateV1

export interface ScreenplayProfessionalCandidateV1 {
  version: 1
  kind: 'screenplay-professional-candidate'
  portable: false
  stage: ScreenplayProfessionalStageV1
  projectId: number
  worldId: number
  workId: number
  adaptationProjectId: number
  adaptationRevision: number
  sourceManifestVersion: number
  sourceManifestHash: string
  sourceUnitKeys: string[]
  targetSceneKeys: string[]
  targetIssueKeys: string[]
  targetSceneRevisions: Record<string, number>
  contextManifestHash: string
  promptHash: string
  modelOutputHash: string
  payload: ScreenplayProfessionalPayloadV1
  payloadHash: string
  candidateHash: string
}

interface ScreenplayProfessionalIntentV1 {
  version: 1
  kind: 'screenplay-professional-intent'
  candidate: ScreenplayProfessionalCandidateV1
  authorPayload: ScreenplayProfessionalPayloadV1
  authorPayloadHash: string
  intentHash: string
}

const STAGES = {
  'source-analysis': { skillId: 'adaptation.source-analysis', stepId: 'screenplay-professional:source-analysis', category: 'screenplay.source-analysis', role: '改编资料编辑' },
  'causal-graph': { skillId: 'adaptation.causal-graph', stepId: 'screenplay-professional:causal-graph', category: 'screenplay.causal-graph', role: '故事分析师' },
  'adaptation-brief': { skillId: 'screenplay.adaptation-brief', stepId: 'screenplay-professional:adaptation-brief', category: 'screenplay.adaptation-brief', role: '改编编辑' },
  'decision-pass': { skillId: 'screenplay.decision-pass', stepId: 'screenplay-professional:decision-pass', category: 'screenplay.decision-pass', role: '改编编辑' },
  'beat-sheet': { skillId: 'screenplay.beat-sheet', stepId: 'screenplay-professional:beat-sheet', category: 'screenplay.beat-sheet', role: '结构编剧' },
  'scene-card': { skillId: 'screenplay.scene-card', stepId: 'screenplay-professional:scene-card', category: 'screenplay.scene-card', role: '场景设计师' },
  'scene-draft': { skillId: 'screenplay.scene-draft', stepId: 'screenplay-professional:scene-draft', category: 'screenplay.scene-draft', role: '场景编剧' },
  'grounding-review': { skillId: 'screenplay.grounding-review', stepId: 'screenplay-professional:grounding-review', category: 'screenplay.grounding-review', role: '改编连续性编辑' },
  'dramaturgy-review': { skillId: 'screenplay.dramaturgy-review', stepId: 'screenplay-professional:dramaturgy-review', category: 'screenplay.dramaturgy-review', role: '剧本编辑' },
  'targeted-rewrite': { skillId: 'screenplay.targeted-rewrite', stepId: 'screenplay-professional:targeted-rewrite', category: 'screenplay.targeted-rewrite', role: '修订编剧' },
} as const

const FACT_KEYS = ['stableKey', 'kind', 'statement', 'subjectKeys', 'sourceUnitKeys', 'confidence'] as const
const EDGE_KEYS = ['stableKey', 'fromFactKey', 'toFactKey', 'relation', 'rationale', 'sourceUnitKeys'] as const
const DECISION_KEYS = ['stableKey', 'action', 'sourceFactKeys', 'targetKeys', 'rationale'] as const
const BRIEF_KEYS = ['version', 'coreTheme', 'dominantEmotion', 'mustKeep', 'mayCut', 'mayMerge', 'mayReorder', 'allowedAdditions', 'audience', 'rating', 'targetScale', 'narrativePerspective', 'timeBudget', 'costLimit', 'deviationNotes', 'unresolvedQuestions', 'assumptions'] as const
const SCENE_KEYS = ['stableKey', 'planSectionKey', 'episodeNumber', 'sceneNumber', 'intExt', 'location', 'timeOfDay', 'summary', 'estimatedSeconds', 'sourceUnitKeys', 'blocks'] as const

function exact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[screenplay-run] ${label} 必须是对象`)
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`[screenplay-run] ${label} 字段不在闭集`)
}

function stableKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(value)) throw new Error(`[screenplay-run] ${label} 非法`)
}

function stringArray(value: unknown, label: string, allowEmpty = false): asserts value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.some(item => typeof item !== 'string' || !item.trim()) || new Set(value).size !== value.length) throw new Error(`[screenplay-run] ${label} 非法`)
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()) }
  catch { throw new Error('[screenplay-run] 模型输出不是严格 JSON') }
}

function parseFact(value: unknown): asserts value is AdaptationSourceFactCandidateV1 {
  exact(value, FACT_KEYS, 'SourceFact'); stableKey(value.stableKey, 'SourceFact.stableKey')
  if (!['event', 'character-state', 'relationship', 'location', 'object', 'motif'].includes(value.kind)) throw new Error('[screenplay-run] SourceFact.kind 非法')
  if (typeof value.statement !== 'string' || !value.statement.trim()) throw new Error('[screenplay-run] SourceFact.statement 为空')
  stringArray(value.subjectKeys, 'SourceFact.subjectKeys', true); stringArray(value.sourceUnitKeys, 'SourceFact.sourceUnitKeys')
  if (typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) throw new Error('[screenplay-run] SourceFact.confidence 非法')
}

function parseEdge(value: unknown): asserts value is AdaptationCausalEdgeCandidateV1 {
  exact(value, EDGE_KEYS, 'CausalEdge'); stableKey(value.stableKey, 'CausalEdge.stableKey'); stableKey(value.fromFactKey, 'CausalEdge.fromFactKey'); stableKey(value.toFactKey, 'CausalEdge.toFactKey')
  if (value.fromFactKey === value.toFactKey || !['cause', 'enables', 'motivates', 'reveals', 'prevents'].includes(value.relation)) throw new Error('[screenplay-run] CausalEdge 关系非法')
  if (typeof value.rationale !== 'string' || !value.rationale.trim()) throw new Error('[screenplay-run] CausalEdge.rationale 为空')
  stringArray(value.sourceUnitKeys, 'CausalEdge.sourceUnitKeys')
}

function parseDecision(value: unknown): asserts value is AdaptationDecisionCandidateV1 {
  exact(value, DECISION_KEYS, 'Decision'); stableKey(value.stableKey, 'Decision.stableKey')
  if (!['keep', 'cut', 'merge', 'reorder', 'externalize', 'add'].includes(value.action)) throw new Error('[screenplay-run] Decision.action 非法')
  stringArray(value.sourceFactKeys, 'Decision.sourceFactKeys', value.action === 'add'); stringArray(value.targetKeys, 'Decision.targetKeys', true)
  if (typeof value.rationale !== 'string' || !value.rationale.trim()) throw new Error('[screenplay-run] Decision.rationale 为空')
}

function parseScene(value: unknown): asserts value is ScreenplaySceneCandidateV1 {
  exact(value, SCENE_KEYS, 'SceneDraft'); stableKey(value.stableKey, 'SceneDraft.stableKey'); stableKey(value.planSectionKey, 'SceneDraft.planSectionKey')
  stringArray(value.sourceUnitKeys, 'SceneDraft.sourceUnitKeys')
  if (!Array.isArray(value.blocks)) throw new Error('[screenplay-run] SceneDraft.blocks 非法')
  value.blocks.forEach((block: any) => {
    if (!block || typeof block !== 'object' || Array.isArray(block)) throw new Error('[screenplay-run] SceneDraft block 非法')
    const keys = block.type === 'character' ? ['id', 'type', 'characterResourceKey', 'name', 'extension', 'dualDialogue'] : ['id', 'type', 'text']
    if (Object.keys(block).some(key => !keys.includes(key))) throw new Error('[screenplay-run] SceneDraft block 含未知字段')
  })
}

export function parseScreenplayProfessionalPayloadV1(stage: ScreenplayProfessionalStageV1, value: unknown): ScreenplayProfessionalPayloadV1 {
  if (stage === 'source-analysis') { assertCandidateBatchV1(value, parseFact, 'SourceFact', false, 500); return structuredClone(value) }
  if (stage === 'causal-graph') { assertCandidateBatchV1(value, parseEdge, 'CausalEdge', false, 1_000); return structuredClone(value) }
  if (stage === 'adaptation-brief') { exact(value, BRIEF_KEYS, 'Brief'); assertAdaptationBriefV1(value as AdaptationBriefV1); return structuredClone(value as AdaptationBriefV1) }
  if (stage === 'decision-pass') { assertCandidateBatchV1(value, parseDecision, 'Decision', false, 1_000); return structuredClone(value) }
  if (stage === 'beat-sheet') { assertCandidateBatchV1(value, assertScreenplayBeatCandidateV1, 'Beat', false, 500); return structuredClone(value) }
  if (stage === 'scene-card') { assertCandidateBatchV1(value, assertScreenplaySceneCardCandidateV1, 'SceneCard', false, 2_000); return structuredClone(value) }
  if (stage === 'scene-draft') { parseScene(value); return structuredClone(value) }
  if (stage === 'grounding-review') { assertCandidateBatchV1<ScreenplayReviewIssueCandidateV1>(value, item => assertScreenplayReviewIssueCandidateV1(item, 'grounding'), 'GroundingIssue', true, 1_000); return structuredClone(value) }
  if (stage === 'dramaturgy-review') { assertCandidateBatchV1<ScreenplayReviewIssueCandidateV1>(value, item => assertScreenplayReviewIssueCandidateV1(item, 'dramaturgy'), 'DramaturgyIssue', true, 1_000); return structuredClone(value) }
  assertScreenplayRewritePatchCandidateV1(value); return structuredClone(value)
}

function prompt(stage: ScreenplayProfessionalStageV1, context: string, targetKeys: string[], authorInstruction: string, targetSpec: unknown): ChatMessage[] {
  const config = STAGES[stage]
  const common = [
    `你是${config.role}。只完成当前职责，不替后续岗位写作或采纳。`,
    '严格区分 source fact、作者 confirmed decision 与 proposal。新增桥接内容必须用 add 决策标明，不得伪装成原文。',
    '只输出一个严格 JSON 值，不要 Markdown、解释、注释或代码围栏。稳定引用只用上下文提供的 key，不输出数据库数字 ID。',
    '所有新建 stableKey 必须匹配 ^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$：只用 ASCII 字母、数字、点、下划线或连字符；禁止中文、空格、冒号、斜杠与井号。引用型 key 必须逐字复制上下文原值。',
    '证据不足时少写或输出空审查数组，不得虚构。先在内部静默核对字段闭集、来源引用和目标边界。',
    `目标剧本画像：${JSON.stringify(targetSpec)}`,
    targetKeys.length ? `本步唯一目标：${targetKeys.join(', ')}` : '',
    authorInstruction.trim() ? `作者附加要求：${authorInstruction.trim()}` : '',
    `登记上下文：\n${context}`,
  ].filter(Boolean).join('\n\n')
  const instructions: Record<ScreenplayProfessionalStageV1, string> = {
    'source-analysis': `按冻结来源逐项提取可核对事实。输出 JSON 数组；每项字段严格且仅为 ${FACT_KEYS.join(', ')}。每项形状必须是 {"stableKey":"fact.key","kind":"event","statement":"原文事实","subjectKeys":["character.key"],"sourceUnitKeys":["上下文给出的 sourceUnitKey"],"confidence":1}。kind 只能是 event、character-state、relationship、location、object、motif 之一，禁止输出 action、character、plot、setting、theme 等近义词；confidence 必须是 0～1 的数字。statement 只陈述原文事实；subjectKeys 用可移植语义键；sourceUnitKeys 必须逐字使用上下文提供的 key 且至少一个。不得增加 evidence、quote、reasoning、category、id 等字段。`,
    'causal-graph': `建立有证据的有向因果图。输出 JSON 数组，每项字段严格且仅为 ${EDGE_KEYS.join(', ')}；形状示例 {"stableKey":"edge.key","fromFactKey":"fact.a","toFactKey":"fact.b","relation":"cause","rationale":"因果说明","sourceUnitKeys":["来源 key"]}。relation 只能是 cause、enables、motivates、reveals、prevents 之一；fromFactKey/toFactKey 只引用已确认 fact key，禁止自环和仅有时间相邻的伪因果。不得增加 confidence、evidence、type、id 等字段。`,
    'adaptation-brief': `提出改编合同。输出单个 JSON 对象，字段严格且仅为 ${BRIEF_KEYS.join(', ')}。version 必须是 JSON 数字 1，不是字符串；mustKeep、mayCut、mayMerge、mayReorder、allowedAdditions、unresolvedQuestions、assumptions 必须是字符串数组；其余字段必须是非空字符串。不得增加 format、genre、logline、runtime、episodeCount、reasoning 等字段。锁定主题、受众、长度、禁改项与自由度；假设和未决问题不得伪装成事实。`,
    'decision-pass': `对来源事件逐项作改编决定。输出 JSON 数组；每项字段严格且仅为 ${DECISION_KEYS.join(', ')}，形状示例 {"stableKey":"decision.key","action":"keep","sourceFactKeys":["fact.key"],"targetKeys":[],"rationale":"决定理由"}。action 只能是 keep、cut、merge、reorder、externalize、add 之一；sourceFactKeys 与 targetKeys 必须始终是无重复的字符串数组，除 add 外 sourceFactKeys 至少一个，add 才允许 []。不得增加 title、description、confidence、priority、id 等字段；内心活动优先 externalize 为行动、选择、对白、声音或已批准旁白。`,
    'beat-sheet': '输出 JSON Beat 数组。每项字段严格且仅为 stableKey, sectionKey, sectionTitle, scope, episodeNumber, order, objective, conflict, turn, outcome, causalFactKeys, decisionKeys, sourceUnitKeys, estimatedSeconds。形状示例 {"stableKey":"beat.opening","sectionKey":"act.one","sectionTitle":"第一幕","scope":"act","episodeNumber":1,"order":0,"objective":"目标","conflict":"冲突","turn":"转折","outcome":"结果","causalFactKeys":[],"decisionKeys":["decision.key"],"sourceUnitKeys":["来源 key"],"estimatedSeconds":180}。scope 只能是 act、sequence、episode；episodeNumber/estimatedSeconds 必须是正整数，order 必须是从 0 开始的非负整数；causalFactKeys 可空，decisionKeys/sourceUnitKeys 不可空且只引用上下文 key。电影 episodeNumber 固定 1，总 estimatedSeconds 应接近目标分钟数乘 60。不得增加 act、title、description、duration、id 等字段。',
    'scene-card': '把每个 Beat 展开为一个或多个 Scene Card，输出 JSON 数组。每项字段严格且仅为 stableKey, beatKey, episodeNumber, sceneNumber, order, purpose, conflict, entryState, exitState, visibleAction, informationReveal, sourceUnitKeys, estimatedSeconds。episodeNumber/sceneNumber/estimatedSeconds 为正整数，order 为非负整数；beatKey 与 sourceUnitKeys 逐字引用上下文，数组不得为空。进入/退出状态必须可连续核对，可视动作不能是小说内心说明；总时长与对应 Beat 基本一致。不得增加 heading、location、characters、shots、id 等字段。',
    'scene-draft': `只写目标 Scene Card 的一场 JSON AST 对象，顶层字段严格且仅为 ${SCENE_KEYS.join(', ')}。stableKey、episodeNumber、sceneNumber、estimatedSeconds、sourceUnitKeys 必须沿用 Card；planSectionKey 必须沿用 Card 所属 Beat 的 sectionKey；intExt 只能是 INT、EXT、INT_EXT。blocks 只能是数组：普通块严格为 {"id":"block.key","type":"action","text":"可见动作"}，type 只能为 action、parenthetical、dialogue、transition、shot、note；角色提示块为 {"id":"block.cue","type":"character","name":"角色名"}，可选 extension 只能为 V.O.、O.S.、O.C.、CONT'D，可选 dualDialogue 为布尔值。不得输出 characterId 或其他系统字段。每个 dialogue 前必须先有 character，parenthetical 只能位于 character 与 dialogue 之间，场末不能停在 character。action 只写可见可听可执行内容，不复制来源长对白。`,
    'grounding-review': '只做来源忠实度与连续性审查。输出 JSON ReviewIssue 数组，每项字段严格且仅为 stableKey, category, severity, sceneKey, blockId, evidence, problem, suggestion, sourceUnitKeys。category 必须固定为 grounding；severity 只能是 critical、major、minor；sceneKey 必须等于目标场景 key；blockId 必须是目标场景已有 block id 或 null；sourceUnitKeys 必须是非空且只引用来源 key。不得增加 status、confidence、location、line、title、id 等字段。每项必须给出来源证据；合理且已确认的 add 不得误报，没有问题输出 []。',
    'dramaturgy-review': '只做戏剧审查：场景目的、冲突、动作化、节奏、人物声音与对白功能。输出 JSON ReviewIssue 数组，字段严格且仅为 stableKey, category, severity, sceneKey, blockId, evidence, problem, suggestion, sourceUnitKeys。category 必须固定为 dramaturgy；severity 只能是 critical、major、minor；sceneKey 必须等于目标场景 key；blockId 必须是已有 block id 或 null；sourceUnitKeys 必须是数组且允许 []。不得增加 status、confidence、location、line、title、id 等字段；evidence 引用目标场景文本，不臆造来源问题，没有问题输出 []。',
    'targeted-rewrite': '只修复作者选中的开放问题。输出单个 JSON 对象，字段严格且仅为 sceneKey, expectedSceneRevision, issueKeys, summary, blocks。sceneKey、expectedSceneRevision、issueKeys 必须逐字/逐数沿用登记上下文；blocks 必须给出修订后的整场合法 AST，块形状和排列规则与 scene-draft 完全相同。保持场序、人物事实、来源、未授权台词与结构不变；不得输出 stableKey、status、revision、reasoning 或顺手重写别场。',
  }
  return [{ role: 'system', content: common }, { role: 'user', content: instructions[stage] }]
}

async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: any) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as any)
}

async function rootFor(scope: WorkspaceScope, adaptationProjectId: number) {
  const root = await db.adaptationProjects.get(adaptationProjectId)
  if (!root?.id || root.medium !== 'screenplay' || root.projectId !== scope.projectId || root.worldId !== scope.worldId || root.workId !== scope.workId) throw new Error('[screenplay-run] 剧本改编不存在或越界')
  return root
}

async function selectedContext(input: { scope: WorkspaceScope; adaptationProjectId: number; stage: ScreenplayProfessionalStageV1; sourceUnitKeys?: string[]; targetSceneKeys?: string[]; targetIssueKeys?: string[] }) {
  const root = await rootFor(input.scope, input.adaptationProjectId)
  const units = await db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([root.id!, root.activeSourceManifestVersion]).sortBy('order')
  const unitById = new Map(units.flatMap(unit => unit.id == null ? [] : [[unit.id, unit.sourceUnitKey] as const]))
  const unitKeySet = new Set(units.map(unit => unit.sourceUnitKey))
  const targetSceneKeys = [...new Set(input.targetSceneKeys ?? [])]
  const scenes = targetSceneKeys.length ? await db.screenplayScenes.where('adaptationProjectId').equals(root.id!).filter(scene => targetSceneKeys.includes(scene.stableKey)).toArray() : []
  const issues = input.targetIssueKeys?.length
    ? await db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals([root.id!, root.activeSourceManifestVersion]).filter(issue => input.targetIssueKeys!.includes(issue.stableKey)).toArray()
    : []
  if (issues.length !== new Set(input.targetIssueKeys ?? []).size) throw new Error('[screenplay-run] 目标审查问题不存在或重复')
  const cards = targetSceneKeys.length
    ? await db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals([root.id!, root.activeSourceManifestVersion]).filter(card => targetSceneKeys.includes(card.stableKey)).toArray()
    : []
  if (input.stage === 'scene-draft') {
    if (cards.length !== targetSceneKeys.length || scenes.length) throw new Error('[screenplay-run] 逐场写作目标必须是尚未成稿的当前 Scene Card')
  } else if (['grounding-review', 'dramaturgy-review', 'targeted-rewrite'].includes(input.stage) && scenes.length !== targetSceneKeys.length) {
    throw new Error('[screenplay-run] 审查或修订的目标场景不存在或重复')
  }
  const inferred = [
    ...scenes.flatMap(scene => scene.sourceUnitIds.map(id => unitById.get(id)).filter((key): key is string => Boolean(key))),
    ...cards.flatMap(card => card.sourceUnitKeys),
    ...issues.flatMap(issue => issue.sourceUnitKeys),
  ]
  const sourceUnitKeys = [...new Set(input.sourceUnitKeys?.length ? input.sourceUnitKeys : inferred.length ? inferred : units.map(unit => unit.sourceUnitKey))]
  if (!sourceUnitKeys.length || sourceUnitKeys.some(key => !unitKeySet.has(key))) throw new Error('[screenplay-run] 来源选择越过当前 manifest')
  return { root, sourceUnitKeys, scenes, issues }
}

function assertPrerequisites(stage: ScreenplayProfessionalStageV1, root: Awaited<ReturnType<typeof rootFor>>, counts: { facts: number; edges: number; decisions: number; beats: number; cards: number; scenes: number; issues: number }, targets: { scenes: number; issues: number }) {
  if (stage !== 'source-analysis' && counts.facts === 0) throw new Error('[screenplay-run] 请先完成来源事实分析')
  if (stage === 'adaptation-brief' && counts.edges === 0) throw new Error('[screenplay-run] 请先确认因果图')
  if (['decision-pass', 'beat-sheet', 'scene-card', 'scene-draft', 'grounding-review', 'dramaturgy-review', 'targeted-rewrite'].includes(stage) && root.briefSourceManifestVersion !== root.activeSourceManifestVersion) throw new Error('[screenplay-run] 请先确认当前来源版本的改编 Brief')
  if (['beat-sheet', 'scene-card', 'scene-draft', 'grounding-review', 'dramaturgy-review', 'targeted-rewrite'].includes(stage) && counts.decisions === 0) throw new Error('[screenplay-run] 请先确认改编决定')
  if (['scene-card', 'scene-draft', 'grounding-review', 'dramaturgy-review', 'targeted-rewrite'].includes(stage) && counts.beats === 0) throw new Error('[screenplay-run] 请先确认 Beat Sheet')
  if (['scene-draft', 'grounding-review', 'dramaturgy-review', 'targeted-rewrite'].includes(stage) && counts.cards === 0) throw new Error('[screenplay-run] 请先确认 Scene Cards')
  if (['scene-draft', 'grounding-review', 'dramaturgy-review'].includes(stage) && targets.scenes === 0) throw new Error('[screenplay-run] 本步必须选择目标场景或 Scene Card')
  if (stage === 'targeted-rewrite' && (targets.scenes !== 1 || targets.issues === 0)) throw new Error('[screenplay-run] 定点改写必须选择一场及其开放问题')
}

function contract(scope: WorkspaceScope, stage: ScreenplayProfessionalStageV1) {
  const config = STAGES[stage]; const skill = getAgentSkillV1(config.skillId)
  return {
    version: 1 as const,
    objective: `${config.role}执行剧本专业生产阶段 ${stage}，产出候选并等待作者确认`,
    workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: { contextSourceKeys: [...skill.contextSourceKeys], writeTargets: skill.writeTargets.map(target => ({ table: target.table, fields: [...target.fields], mode: 'author-confirmed' as const })) },
    executionBindings: [{ stepId: config.stepId, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 48_000, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1, maxProtocolErrors: 0 },
    acceptance: [
      { id: `${config.stepId}.candidate`, kind: 'output-present' as const, required: true },
      { id: `${config.stepId}.author`, kind: 'author-confirmed' as const, required: true },
      { id: `${config.stepId}.post-state`, kind: 'post-state-matches' as const, required: true },
    ],
    verificationPlan: [{ id: `${config.stepId}.terminal`, kind: 'terminal' as const, verifier: `screenplay-${stage}-terminal-v1`, criterionIds: [`${config.stepId}.candidate`, `${config.stepId}.author`, `${config.stepId}.post-state`] }],
    failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const },
  }
}

export async function generateScreenplayProfessionalCandidateV1(input: {
  scope: WorkspaceScope
  adaptationProjectId: number
  stage: ScreenplayProfessionalStageV1
  sourceUnitKeys?: string[]
  targetSceneKeys?: string[]
  targetIssueKeys?: string[]
  authorInstruction?: string
  aiConfig?: AIConfig
  runAI?: (messages: ChatMessage[]) => Promise<string>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ScreenplayProfessionalCandidateV1 }> {
  if (!input.aiConfig && !input.runAI) throw new Error('[screenplay-run] 缺少 AI 配置')
  const selected = await selectedContext(input)
  if ((await inspectAdaptationFreshness(selected.root.id!)).status !== 'unchanged') throw new Error('[screenplay-run] 来源已变化或缺失，请先同步')
  const key = [selected.root.id!, selected.root.activeSourceManifestVersion] as [number, number]
  const [facts, edges, decisions, beats, cards, scenes, issues] = await Promise.all([
    db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').count(),
    db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').count(),
    db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').count(),
    db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals(key).count(),
    db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).count(),
    db.screenplayScenes.where('adaptationProjectId').equals(selected.root.id!).count(),
    db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.status === 'open').count(),
  ])
  assertPrerequisites(input.stage, selected.root, { facts, edges, decisions, beats, cards, scenes, issues }, { scenes: input.stage === 'scene-draft' ? (input.targetSceneKeys?.length ?? 0) : selected.scenes.length, issues: selected.issues.length })
  const config = STAGES[input.stage]; const skill = getAgentSkillV1(config.skillId)
  let snapshot = await createAgentRunV1({ scope: input.scope, worldGroupId: null, contract: contract(input.scope, input.stage) })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId: config.stepId })
  snapshot = await append(input.scope, snapshot, 'step.started', { stepId: config.stepId, attempt: 1 })
  const assembled = await assembleContext({
    projectId: input.scope.projectId, scope: input.scope, sourceKeys: [...skill.contextSourceKeys], adaptationProjectId: selected.root.id!,
    adaptationSourceManifestVersion: selected.root.activeSourceManifestVersion, adaptationSourceUnitKeys: selected.sourceUnitKeys,
    screenplaySceneIds: selected.scenes.map(scene => scene.id!), provider: input.aiConfig?.provider, model: input.aiConfig?.model, inputBudgetMaxTokens: 48_000,
  })
  const contextManifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: config.stepId, attempt: 1, projectId: input.scope.projectId, worldGroupId: null, declaredSourceKeys: [...skill.contextSourceKeys], assembled, readerVersion: `screenplay-${input.stage}-context-v1` })
  snapshot = await append(input.scope, snapshot, 'context.assembled', { stepId: config.stepId, attempt: 1, manifestHash: contextManifest.manifestHash })
  const targetKeys = input.stage === 'targeted-rewrite' ? selected.issues.map(issue => issue.stableKey) : [...new Set(input.targetSceneKeys ?? [])]
  const messages = prompt(input.stage, assembled.text, targetKeys, input.authorInstruction ?? '', selected.root.targetSpec)
  snapshot = await append(input.scope, snapshot, 'model.requested', { stepId: config.stepId, attempt: 1, bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]) })
  let raw: string
  try { raw = await (input.runAI ? input.runAI(messages) : chat(messages, input.aiConfig!, { category: config.category, projectId: input.scope.projectId, configOverrides: { maxTokens: skill.maxOutputTokens }, contextOverflowPolicy: 'reject' })) }
  catch (error) { await append(input.scope, snapshot, 'run.paused', { reason: `screenplay-${input.stage}-model-outcome-unknown`, recoverable: false }); throw error }
  snapshot = await append(input.scope, snapshot, 'model.responded', { stepId: config.stepId, attempt: 1, outputHash: await hashCanonicalValue({ raw }) })
  let payload: ScreenplayProfessionalPayloadV1
  try { payload = parseScreenplayProfessionalPayloadV1(input.stage, parseJson(raw)) }
  catch (error) {
    snapshot = await append(input.scope, snapshot, 'step.failed', { stepId: config.stepId, attempt: 1, code: `screenplay-${input.stage}-protocol-failed`, retryable: false, category: 'protocol', action: 'fail' })
    await append(input.scope, snapshot, 'run.failed', { code: `screenplay-${input.stage}-protocol-failed`, retryable: false }); throw error
  }
  const body = {
    version: 1 as const, kind: 'screenplay-professional-candidate' as const, portable: false as const, stage: input.stage,
    projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId, adaptationProjectId: selected.root.id!, adaptationRevision: selected.root.revision,
    sourceManifestVersion: selected.root.activeSourceManifestVersion, sourceManifestHash: selected.root.activeSourceManifestHash, sourceUnitKeys: selected.sourceUnitKeys,
    targetSceneKeys: [...new Set(input.targetSceneKeys ?? [])], targetIssueKeys: [...new Set(input.targetIssueKeys ?? [])],
    targetSceneRevisions: Object.fromEntries([...new Set(input.targetSceneKeys ?? [])].map(key => [key, selected.scenes.find(scene => scene.stableKey === key)?.revision ?? 0])),
    contextManifestHash: contextManifest.manifestHash, promptHash: await hashCanonicalValue(messages), modelOutputHash: await hashCanonicalValue({ raw }), payload, payloadHash: await hashCanonicalValue(payload),
  }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate }); snapshot = saved.snapshot
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId: config.stepId, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: true })
  return { snapshot, candidate }
}

async function parseCandidate(value: unknown): Promise<ScreenplayProfessionalCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[screenplay-run] 候选检查点无效')
  const row = value as ScreenplayProfessionalCandidateV1
  if (row.version !== 1 || row.kind !== 'screenplay-professional-candidate' || row.portable !== false || !Object.prototype.hasOwnProperty.call(STAGES, row.stage)) throw new Error('[screenplay-run] 候选类型无效')
  parseScreenplayProfessionalPayloadV1(row.stage, row.payload)
  if (await hashCanonicalValue(row.payload) !== row.payloadHash) throw new Error('[screenplay-run] 候选 payload hash 不匹配')
  const { candidateHash: _candidateHash, ...body } = row
  if (await hashCanonicalValue(body) !== row.candidateHash) throw new Error('[screenplay-run] 候选 hash 不匹配')
  return row
}

async function latest(scope: WorkspaceScope, runId: number): Promise<{ candidate: ScreenplayProfessionalCandidateV1; intent: ScreenplayProfessionalIntentV1 | null }> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('[screenplay-run] 运行缺少可验证检查点')
  const value = checkpoint.resumePayload as any
  if (value?.kind === 'screenplay-professional-intent') {
    const candidate = await parseCandidate(value.candidate)
    const authorPayload = parseScreenplayProfessionalPayloadV1(candidate.stage, value.authorPayload)
    if (await hashCanonicalValue(authorPayload) !== value.authorPayloadHash) throw new Error('[screenplay-run] 作者 payload hash 不匹配')
    const { intentHash: _intentHash, ...body } = value
    if (await hashCanonicalValue(body) !== value.intentHash) throw new Error('[screenplay-run] 采纳意图 hash 不匹配')
    return { candidate, intent: value as ScreenplayProfessionalIntentV1 }
  }
  return { candidate: await parseCandidate(value), intent: null }
}

async function assertFresh(scope: WorkspaceScope, candidate: ScreenplayProfessionalCandidateV1) {
  const root = await rootFor(scope, candidate.adaptationProjectId)
  if (root.revision !== candidate.adaptationRevision || root.activeSourceManifestVersion !== candidate.sourceManifestVersion || root.activeSourceManifestHash !== candidate.sourceManifestHash) throw new Error('[screenplay-run] 改编根或来源已变化，候选 stale')
  if ((await inspectAdaptationFreshness(root.id!)).status !== 'unchanged') throw new Error('[screenplay-run] 来源内容已变化，候选 stale')
  const scenes = candidate.targetSceneKeys.length ? await db.screenplayScenes.where('adaptationProjectId').equals(root.id!).filter(scene => candidate.targetSceneKeys.includes(scene.stableKey)).toArray() : []
  if (candidate.stage === 'scene-draft') {
    if (scenes.length || candidate.targetSceneKeys.some(key => candidate.targetSceneRevisions[key] !== 0)) throw new Error('[screenplay-run] Scene Card 已成稿，候选 stale')
  } else if (scenes.length !== candidate.targetSceneKeys.length || scenes.some(scene => candidate.targetSceneRevisions[scene.stableKey] !== scene.revision)) throw new Error('[screenplay-run] 目标场景已变化，候选 stale')
  return root
}

async function writeFormal(scope: WorkspaceScope, intent: ScreenplayProfessionalIntentV1): Promise<void> {
  const candidate = intent.candidate; const root = await assertFresh(scope, candidate); const payload = intent.authorPayload
  if (candidate.stage === 'source-analysis') {
    await adoptAdaptationSourceFactsV1({ scope, adaptationProjectId: root.id!, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, items: (payload as AdaptationSourceFactCandidateV1[]).map(item => ({ candidate: item, authorStatus: 'confirmed' })), replaceExisting: false }); return
  }
  if (candidate.stage === 'causal-graph') {
    await adoptAdaptationCausalEdgesV1({ scope, adaptationProjectId: root.id!, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, items: (payload as AdaptationCausalEdgeCandidateV1[]).map(item => ({ candidate: item, authorStatus: 'confirmed' })) }); return
  }
  if (candidate.stage === 'adaptation-brief') {
    const saved = await saveAdaptationBriefDraft({ adaptationProjectId: root.id!, brief: payload as AdaptationBriefV1, expectedRevision: root.revision })
    await confirmAdaptationBrief({ adaptationProjectId: root.id!, expectedRevision: saved.revision }); return
  }
  if (candidate.stage === 'decision-pass') {
    await adoptAdaptationDecisionsV1({ scope, adaptationProjectId: root.id!, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, items: (payload as AdaptationDecisionCandidateV1[]).map(item => ({ candidate: item, authorStatus: 'confirmed' })) }); return
  }
  if (candidate.stage === 'beat-sheet') {
    await adoptScreenplayBeatsV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidates: payload as ScreenplayBeatCandidateV1[] }); return
  }
  if (candidate.stage === 'scene-card') {
    await adoptScreenplaySceneCardsV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidates: payload as ScreenplaySceneCardCandidateV1[] }); return
  }
  if (candidate.stage === 'scene-draft') {
    const scene = payload as ScreenplaySceneCandidateV1
    await assertSceneCandidateMatchesCardV1(scope, scene)
    const expectedPlanHash = await hashCanonicalValue(root.plan)
    await adoptScreenplaySceneBatchV1({ scope, adaptationProjectId: root.id!, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, expectedPlanHash, candidates: [scene] }); return
  }
  if (candidate.stage === 'grounding-review' || candidate.stage === 'dramaturgy-review') {
    await adoptScreenplayReviewIssuesV1({
      scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion,
      category: candidate.stage === 'grounding-review' ? 'grounding' : 'dramaturgy', targetSceneKeys: candidate.targetSceneKeys,
      expectedSceneRevisions: candidate.targetSceneRevisions, candidates: payload as ScreenplayReviewIssueCandidateV1[],
    }); return
  }
  await applyScreenplayRewriteV1({ scope, expectedAdaptationRevision: root.revision, candidate: payload as ScreenplayRewritePatchCandidateV1 })
}

function modelFields<T extends Record<string, any>>(row: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map(key => [key, structuredClone(row[key])]))
}

async function selectedRowsMatch(rows: Array<Record<string, any>>, payload: Array<Record<string, any>>, keys: readonly string[]): Promise<boolean> {
  const byKey = new Map(rows.map(row => [row.stableKey, row]))
  const actual = payload.map(item => byKey.get(item.stableKey)).filter(Boolean) as Array<Record<string, any>>
  return actual.length === payload.length
    && await hashCanonicalValue(actual.map(row => modelFields(row, keys))) === await hashCanonicalValue(payload.map(row => modelFields(row, keys)))
}

/** Detects the narrow crash window after the domain transaction committed but before adoption.committed was appended. */
async function formalAlreadyApplied(scope: WorkspaceScope, intent: ScreenplayProfessionalIntentV1): Promise<boolean> {
  const candidate = intent.candidate
  const root = await rootFor(scope, candidate.adaptationProjectId)
  const payload = intent.authorPayload as any
  const key = [candidate.adaptationProjectId, candidate.sourceManifestVersion] as [number, number]
  if (candidate.stage === 'source-analysis') {
    if (root.revision !== candidate.adaptationRevision + 1) return false
    const rows = await db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).toArray()
    return selectedRowsMatch(rows, payload, FACT_KEYS)
  }
  if (candidate.stage === 'causal-graph') {
    if (root.revision !== candidate.adaptationRevision + 1) return false
    return selectedRowsMatch(await db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload, EDGE_KEYS)
  }
  if (candidate.stage === 'adaptation-brief') {
    return root.revision === candidate.adaptationRevision + 2
      && root.briefSourceManifestVersion === candidate.sourceManifestVersion
      && await hashCanonicalValue(root.brief) === await hashCanonicalValue(payload)
  }
  if (candidate.stage === 'decision-pass') {
    if (root.revision !== candidate.adaptationRevision + 1) return false
    return selectedRowsMatch(await db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload, DECISION_KEYS)
  }
  if (candidate.stage === 'beat-sheet') {
    if (root.revision !== candidate.adaptationRevision + 1) return false
    return selectedRowsMatch(await db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload, SCREENPLAY_BEAT_CANDIDATE_KEYS_V1)
  }
  if (candidate.stage === 'scene-card') {
    if (root.revision !== candidate.adaptationRevision + 1) return false
    return selectedRowsMatch(await db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload, SCREENPLAY_SCENE_CARD_CANDIDATE_KEYS_V1)
  }
  if (candidate.stage === 'scene-draft') {
    if (root.revision !== candidate.adaptationRevision) return false
    const scene = await db.screenplayScenes.where('adaptationProjectId').equals(root.id!).filter(row => row.stableKey === payload.stableKey).first()
    if (!scene || scene.revision !== 1) return false
    const units = await db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).toArray()
    const sourceKeyById = new Map(units.flatMap(unit => unit.id == null ? [] : [[unit.id, unit.sourceUnitKey] as const]))
    const actual = {
      ...modelFields(scene, SCENE_KEYS.filter(field => field !== 'sourceUnitKeys' && field !== 'blocks')),
      sourceUnitKeys: scene.sourceUnitIds.map(id => sourceKeyById.get(id)),
      blocks: scene.blocks.map(block => block.type === 'character'
        ? { id: block.id, type: block.type, name: block.name, ...(block.extension ? { extension: block.extension } : {}), ...(block.dualDialogue ? { dualDialogue: true } : {}) }
        : structuredClone(block)),
    }
    const expected = { ...payload, blocks: payload.blocks.map((block: any) => block.type === 'character' ? { ...block, characterResourceKey: undefined } : block) }
    return await hashCanonicalValue(actual) === await hashCanonicalValue(expected)
  }
  if (candidate.stage === 'grounding-review' || candidate.stage === 'dramaturgy-review') {
    if (root.revision !== candidate.adaptationRevision + 1) return false
    const field = candidate.stage === 'grounding-review' ? 'groundingReviewRevision' : 'dramaturgyReviewRevision'
    const scenes = await db.screenplayScenes.where('adaptationProjectId').equals(root.id!).filter(scene => candidate.targetSceneKeys.includes(scene.stableKey)).toArray()
    if (scenes.length !== candidate.targetSceneKeys.length || scenes.some(scene => scene[field] !== scene.revision)) return false
    return selectedRowsMatch(await db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload, SCREENPLAY_REVIEW_ISSUE_CANDIDATE_KEYS_V1)
  }
  if (root.revision !== candidate.adaptationRevision) return false
  const scene = await db.screenplayScenes.where('adaptationProjectId').equals(root.id!).filter(row => row.stableKey === payload.sceneKey).first()
  if (!scene || scene.revision !== payload.expectedSceneRevision + 1 || scene.summary !== payload.summary || await hashCanonicalValue(scene.blocks) !== await hashCanonicalValue(payload.blocks)) return false
  const issues = await db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).toArray()
  return payload.issueKeys.every((issueKey: string) => issues.some(issue => issue.stableKey === issueKey && issue.status === 'resolved'))
}

async function postStateHash(scope: WorkspaceScope, candidate: ScreenplayProfessionalCandidateV1): Promise<string> {
  const key = [candidate.adaptationProjectId, candidate.sourceManifestVersion] as [number, number]
  if (candidate.stage === 'source-analysis') return hashCanonicalValue(await db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
  if (candidate.stage === 'causal-graph') return hashCanonicalValue(await db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
  if (candidate.stage === 'adaptation-brief') return hashCanonicalValue((await rootFor(scope, candidate.adaptationProjectId)).brief)
  if (candidate.stage === 'decision-pass') return hashCanonicalValue(await db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
  if (candidate.stage === 'beat-sheet') return hashCanonicalValue(await db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
  if (candidate.stage === 'scene-card') return hashCanonicalValue(await db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
  if (candidate.stage === 'scene-draft' || candidate.stage === 'targeted-rewrite') return hashCanonicalValue(await db.screenplayScenes.where('adaptationProjectId').equals(candidate.adaptationProjectId).filter(scene => candidate.targetSceneKeys.includes(scene.stableKey)).toArray())
  return hashCanonicalValue(await db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).filter(issue => candidate.targetSceneKeys.includes(issue.sceneKey)).toArray())
}

export async function adoptScreenplayProfessionalCandidateV1(input: {
  scope: WorkspaceScope
  runId: number
  authorPayload?: ScreenplayProfessionalPayloadV1
  onDurableBoundary?: (boundary: 'adoption.started' | 'formal.written' | 'adoption.committed' | 'verification.accepted', snapshot: AgentRunSnapshotV1) => void | Promise<void>
}): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ScreenplayProfessionalCandidateV1; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId); const state = await latest(input.scope, input.runId); const candidate = state.candidate
  if (candidate.projectId !== input.scope.projectId || candidate.worldId !== input.scope.worldId || candidate.workId !== input.scope.workId) throw new Error('[screenplay-run] 候选越过当前 Work')
  const config = STAGES[candidate.stage]; let intent = state.intent
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  if (snapshot.projection.state === 'awaiting_confirmation') {
    await assertFresh(input.scope, candidate)
    const authorPayload = parseScreenplayProfessionalPayloadV1(candidate.stage, input.authorPayload ?? candidate.payload)
    const body = { version: 1 as const, kind: 'screenplay-professional-intent' as const, candidate, authorPayload, authorPayloadHash: await hashCanonicalValue(authorPayload) }
    intent = { ...body, intentHash: await hashCanonicalValue(body) }
    const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent }); snapshot = saved.snapshot
    snapshot = await append(input.scope, snapshot, 'confirmation.recorded', { stepId: config.stepId, candidateHash: candidate.candidateHash, decision: 'adopt' })
    snapshot = await append(input.scope, snapshot, 'adoption.started', { stepId: config.stepId, candidateHash: candidate.candidateHash, intentHash: intent.intentHash })
    await input.onDurableBoundary?.('adoption.started', snapshot)
  }
  if (!intent) throw new Error('[screenplay-run] 候选不在可采纳状态')
  let adoptionHash = snapshot.projection.steps[config.stepId]?.adoptionHash
  if (!adoptionHash) {
    if (!await formalAlreadyApplied(input.scope, intent)) await writeFormal(input.scope, intent)
    await input.onDurableBoundary?.('formal.written', snapshot)
    const stateHash = await postStateHash(input.scope, candidate); adoptionHash = await hashCanonicalValue({ intentHash: intent.intentHash, stateHash })
    snapshot = await append(input.scope, snapshot, 'adoption.committed', { stepId: config.stepId, candidateHash: candidate.candidateHash, adoptionHash })
    await input.onDurableBoundary?.('adoption.committed', snapshot)
  }
  const stateHash = await postStateHash(input.scope, candidate)
  if (snapshot.projection.steps[config.stepId]?.status === 'running') snapshot = await append(input.scope, snapshot, 'step.succeeded', { stepId: config.stepId, attempt: 1, outputHash: adoptionHash })
  if (snapshot.projection.state === 'running') snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: `screenplay-${candidate.stage}-terminal-v1` })
  const receipt = await createVerificationReceiptV1({
    version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash,
    contextManifestHashes: [candidate.contextManifestHash], candidateHashes: [candidate.candidateHash], adoptionEventIds: [], postStateHash: stateHash,
    verifierSetVersion: `screenplay-${candidate.stage}-terminal-v1`, criteria: [
      { id: `${config.stepId}.candidate`, status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
      { id: `${config.stepId}.author`, status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] },
      { id: `${config.stepId}.post-state`, status: 'passed', evidenceRefs: [`post-state:${stateHash}`] },
    ], acceptedAt: Date.now(),
  })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  await input.onDurableBoundary?.('verification.accepted', snapshot)
  return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function readPendingScreenplayProfessionalCandidateV1(scope: WorkspaceScope): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ScreenplayProfessionalCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(scope, 'agentRuns', { owner: 'work' })).filter(row => ['awaiting_confirmation', 'running'].includes(row.status) && row.contractJson?.includes('screenplay-professional:')).sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
  for (const row of rows) {
    if (!row.id) continue
    try {
      let snapshot = await readAgentRunV1(scope, row.id); const state = await latest(scope, row.id); if (state.intent) continue
      const candidate = state.candidate; const config = STAGES[candidate.stage]
      if (!snapshot.projection.steps[config.stepId]?.candidateHash && snapshot.projection.steps[config.stepId]?.status === 'running') snapshot = await append(scope, snapshot, 'candidate.persisted', { stepId: config.stepId, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: true })
      if (snapshot.projection.state === 'awaiting_confirmation') return { snapshot, candidate }
    } catch { /* damaged/stale runs are not usable candidates */ }
  }
  return null
}

export async function rejectScreenplayProfessionalCandidateV1(scope: WorkspaceScope, runId: number): Promise<void> {
  let snapshot = await readAgentRunV1(scope, runId); const state = await latest(scope, runId)
  if (state.intent || snapshot.projection.state !== 'awaiting_confirmation') throw new Error('[screenplay-run] 候选不在等待确认状态')
  const config = STAGES[state.candidate.stage]
  snapshot = await append(scope, snapshot, 'confirmation.recorded', { stepId: config.stepId, candidateHash: state.candidate.candidateHash, decision: 'reject' })
  await append(scope, snapshot, 'run.cancelled', { reason: `author-rejected-screenplay-${state.candidate.stage}` })
}
