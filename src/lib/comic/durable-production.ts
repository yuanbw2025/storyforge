import { chat } from '../ai/client'
import type {
  AdaptationBriefV1,
  AIConfig,
  ChatMessage,
  ComicImageRequestCandidateV1,
  ComicPagePlanCandidateV1,
  ComicPanelPlanCandidateV1,
  ComicRepairRequestCandidateV1,
  ComicReviewIssueCandidateV1,
  ComicScriptBeatCandidateV1,
  ComicVisualBibleCandidateV1,
  WorkspaceScope,
} from '../types'
import type { AdaptationCausalEdgeCandidateV1, AdaptationDecisionCandidateV1, AdaptationSourceFactCandidateV1 } from '../adaptation/analysis'
import { adoptAdaptationCausalEdgesV1, adoptAdaptationDecisionsV1, adoptAdaptationSourceFactsV1 } from '../adaptation/analysis'
import { assertAdaptationBriefV1 } from '../adaptation/contracts'
import { confirmAdaptationBrief, inspectAdaptationFreshness, saveAdaptationBriefDraft } from '../adaptation/source-manifest'
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
import {
  adoptComicImageRequestV1,
  adoptComicPagePlansV1,
  adoptComicPanelPlansV1,
  adoptComicRepairRequestV1,
  adoptComicReviewIssuesV1,
  adoptComicScriptBeatsV1,
  adoptComicVisualBibleV1,
} from './production'
import {
  assertComicCandidateBatchV1,
  assertComicImageRequestCandidateV1,
  assertComicPagePlanCandidateV1,
  assertComicPanelPlanCandidateV1,
  assertComicRepairRequestCandidateV1,
  assertComicReviewIssueCandidateV1,
  assertComicScriptBeatCandidateV1,
  assertComicVisualBibleCandidateV1,
} from './production-contracts'

export const COMIC_PROFESSIONAL_STAGES_V1 = [
  'source-analysis', 'causal-graph', 'adaptation-brief', 'decision-pass', 'script-adaptation', 'page-rhythm',
  'panel-plan', 'visual-bible', 'image-request', 'visual-continuity-review', 'targeted-repair', 'page-review',
] as const
export type ComicProfessionalStageV1 = typeof COMIC_PROFESSIONAL_STAGES_V1[number]
export type ComicProfessionalPayloadV1 = AdaptationSourceFactCandidateV1[] | AdaptationCausalEdgeCandidateV1[] | AdaptationBriefV1
  | AdaptationDecisionCandidateV1[] | ComicScriptBeatCandidateV1[] | ComicPagePlanCandidateV1[] | ComicPanelPlanCandidateV1[]
  | ComicVisualBibleCandidateV1 | ComicImageRequestCandidateV1 | ComicReviewIssueCandidateV1[] | ComicRepairRequestCandidateV1

export interface ComicProfessionalCandidateV1 {
  version: 1
  kind: 'comic-professional-candidate'
  portable: false
  stage: ComicProfessionalStageV1
  projectId: number
  worldId: number
  workId: number
  adaptationProjectId: number
  adaptationRevision: number
  sourceManifestVersion: number
  sourceManifestHash: string
  sourceUnitKeys: string[]
  targetPageKeys: string[]
  targetPanelKeys: string[]
  targetIssueKeys: string[]
  targetPanelRevisions: Record<string, number>
  contextManifestHash: string
  promptHash: string
  modelOutputHash: string
  payload: ComicProfessionalPayloadV1
  payloadHash: string
  candidateHash: string
}

interface ComicProfessionalIntentV1 {
  version: 1
  kind: 'comic-professional-intent'
  candidate: ComicProfessionalCandidateV1
  authorPayload: ComicProfessionalPayloadV1
  authorPayloadHash: string
  authorVisualInspectionConfirmed: boolean
  intentHash: string
}

const STAGES = {
  'source-analysis': { skillId: 'adaptation.source-analysis', role: '改编资料编辑' },
  'causal-graph': { skillId: 'adaptation.causal-graph', role: '故事因果分析师' },
  'adaptation-brief': { skillId: 'comic.adaptation-brief', role: '漫画改编编辑' },
  'decision-pass': { skillId: 'comic.decision-pass', role: '漫画改编编辑' },
  'script-adaptation': { skillId: 'comic.script-adaptation', role: '漫画脚本师' },
  'page-rhythm': { skillId: 'comic.page-rhythm', role: '分页节奏编辑' },
  'panel-plan': { skillId: 'comic.panel-plan', role: '分镜师' },
  'visual-bible': { skillId: 'comic.visual-bible', role: '美术设定总监' },
  'image-request': { skillId: 'comic.image-request', role: '图像请求编排师' },
  'visual-continuity-review': { skillId: 'comic.visual-continuity-review', role: '媒资证据与视觉连续性监修' },
  'targeted-repair': { skillId: 'comic.targeted-repair', role: '单格修复编排师' },
  'page-review': { skillId: 'comic.page-review', role: '漫画页审编辑' },
} as const

const COMIC_MODEL_TIMEOUT_MS = 180_000

const FACT_KEYS = ['stableKey', 'kind', 'statement', 'subjectKeys', 'sourceUnitKeys', 'confidence'] as const
const EDGE_KEYS = ['stableKey', 'fromFactKey', 'toFactKey', 'relation', 'rationale', 'sourceUnitKeys'] as const
const DECISION_KEYS = ['stableKey', 'action', 'sourceFactKeys', 'targetKeys', 'rationale'] as const
const BRIEF_KEYS = ['version', 'coreTheme', 'dominantEmotion', 'mustKeep', 'mayCut', 'mayMerge', 'mayReorder', 'allowedAdditions', 'audience', 'rating', 'targetScale', 'narrativePerspective', 'timeBudget', 'costLimit', 'deviationNotes', 'unresolvedQuestions', 'assumptions'] as const

function exact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[comic-run] ${label} 必须是对象`)
  const actual = Object.keys(value)
  const unknown = actual.filter(key => !keys.includes(key)); const missing = keys.filter(key => !actual.includes(key))
  if (unknown.length || missing.length) throw new Error(`[comic-run] ${label} 字段不在闭集（未知：${unknown.join('、') || '无'}；缺少：${missing.join('、') || '无'}）`)
}
function stable(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value)) throw new Error(`[comic-run] ${label} 非法`)
}
function strings(value: unknown, label: string, empty = false): asserts value is string[] {
  if (!Array.isArray(value) || (!empty && !value.length) || new Set(value).size !== value.length || value.some(row => typeof row !== 'string' || !row.trim())) throw new Error(`[comic-run] ${label} 非法`)
}
function stableStrings(value: unknown, label: string, empty = false): asserts value is string[] {
  strings(value, label, empty)
  value.forEach((row, index) => stable(row, `${label}[${index}]`))
}
function parseFact(value: unknown): asserts value is AdaptationSourceFactCandidateV1 {
  exact(value, FACT_KEYS, 'SourceFact'); stable(value.stableKey, 'SourceFact.stableKey'); stableStrings(value.subjectKeys, 'SourceFact.subjectKeys', true); stableStrings(value.sourceUnitKeys, 'SourceFact.sourceUnitKeys')
  if (!['event', 'character-state', 'relationship', 'location', 'object', 'motif'].includes(value.kind) || typeof value.statement !== 'string' || !value.statement.trim() || typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) throw new Error('[comic-run] SourceFact 非法')
}
function parseEdge(value: unknown): asserts value is AdaptationCausalEdgeCandidateV1 {
  exact(value, EDGE_KEYS, 'CausalEdge'); stable(value.stableKey, 'CausalEdge.stableKey'); stable(value.fromFactKey, 'fromFactKey'); stable(value.toFactKey, 'toFactKey'); stableStrings(value.sourceUnitKeys, 'sourceUnitKeys')
  if (value.fromFactKey === value.toFactKey) throw new Error('[comic-run] CausalEdge 不得自环')
  if (!['cause', 'enables', 'motivates', 'reveals', 'prevents'].includes(value.relation)) throw new Error('[comic-run] CausalEdge.relation 必须使用登记枚举')
  if (typeof value.rationale !== 'string' || !value.rationale.trim()) throw new Error('[comic-run] CausalEdge.rationale 必须是非空字符串')
}
function parseDecision(value: unknown): asserts value is AdaptationDecisionCandidateV1 {
  exact(value, DECISION_KEYS, 'Decision'); stable(value.stableKey, 'Decision.stableKey'); stableStrings(value.sourceFactKeys, 'sourceFactKeys', value.action === 'add'); stableStrings(value.targetKeys, 'targetKeys', true)
  if (!['keep', 'cut', 'merge', 'reorder', 'externalize', 'add'].includes(value.action) || typeof value.rationale !== 'string' || !value.rationale.trim()) throw new Error('[comic-run] Decision 非法')
}
function parseJson(raw: string): unknown {
  try { return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()) }
  catch { throw new Error('[comic-run] 模型输出不是严格 JSON') }
}

export function parseComicProfessionalPayloadV1(stage: ComicProfessionalStageV1, value: unknown): ComicProfessionalPayloadV1 {
  if (stage === 'source-analysis') { assertComicCandidateBatchV1(value, parseFact, 'SourceFact', 500); return structuredClone(value) }
  if (stage === 'causal-graph') { assertComicCandidateBatchV1(value, parseEdge, 'CausalEdge', 1_000); return structuredClone(value) }
  if (stage === 'adaptation-brief') { exact(value, BRIEF_KEYS, 'Brief'); assertAdaptationBriefV1(value as AdaptationBriefV1); return structuredClone(value as AdaptationBriefV1) }
  if (stage === 'decision-pass') { assertComicCandidateBatchV1(value, parseDecision, 'Decision', 1_000); return structuredClone(value) }
  if (stage === 'script-adaptation') { assertComicCandidateBatchV1(value, assertComicScriptBeatCandidateV1, 'script beat', 1_000); return structuredClone(value) }
  if (stage === 'page-rhythm') { assertComicCandidateBatchV1(value, assertComicPagePlanCandidateV1, 'page plan', 1_000); return structuredClone(value) }
  if (stage === 'panel-plan') { assertComicCandidateBatchV1(value, assertComicPanelPlanCandidateV1, 'panel plan', 20_000); return structuredClone(value) }
  if (stage === 'visual-bible') { assertComicVisualBibleCandidateV1(value); return structuredClone(value) }
  if (stage === 'image-request') { assertComicImageRequestCandidateV1(value); return structuredClone(value) }
  if (stage === 'targeted-repair') { assertComicRepairRequestCandidateV1(value); return structuredClone(value) }
  assertComicCandidateBatchV1(value, assertComicReviewIssueCandidateV1, 'review issue', 2_000, true); return structuredClone(value)
}

export function comicProfessionalInstructionV1(stage: ComicProfessionalStageV1): string {
  const byStage: Record<ComicProfessionalStageV1, string> = {
    'source-analysis': `逐项提取冻结来源事实，输出非空 JSON 数组。每项字段严格且仅为 ${FACT_KEYS.join(', ')}。stableKey 是本候选新建且全数组唯一；kind 只能是 event/character-state/relationship/location/object/motif；statement 是非空字符串；subjectKeys 是不重复的稳定语义 key 数组，可为空，每个 key 必须匹配 ^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$，中文人物名要转换为如 linxi 的 ASCII key；sourceUnitKeys 是不重复且非空的数组，只能逐字复制本次“唯一来源单元”，不得引用其它章节、标题或摘要 key；confidence 是 0 到 1 的 JSON 数字。不要输出 certainty、timeAnchor、database id 或其它字段。`,
    'causal-graph': `只为上下文中已确认事实建立有向因果边，输出非空 JSON 数组。每项字段严格且仅为 ${EDGE_KEYS.join(', ')}。stableKey 是本候选新建且全数组唯一；fromFactKey/toFactKey 必须逐字复制两个不同的已确认 fact stableKey；relation 必须逐字取 cause/enables/motivates/reveals/prevents 之一，禁止 causes/caused-by/leads-to 等近义词；rationale 是非空字符串；sourceUnitKeys 是不重复的登记来源 key 数组且不得为空。形状示意为 [{"stableKey":"edge_001","fromFactKey":"fact_a","toFactKey":"fact_b","relation":"cause","rationale":"明确因果理由","sourceUnitKeys":["asu_context_key"]}]，示意 key 必须替换为上下文真实 key。禁止自环、时间相邻伪因果和不存在的 fact key。`,
    'adaptation-brief': `输出一个漫画改编合同 JSON 对象，字段严格且仅为 ${BRIEF_KEYS.join(', ')}。version 必须是 JSON 数字 1；mustKeep/mayCut/mayMerge/mayReorder/allowedAdditions/unresolvedQuestions/assumptions 必须是字符串数组，可为空；其余字段必须是字符串，可用空字符串表示暂缺。锁定主题、读者、目标页数、禁改项、可新增桥接和制作限制，不得增加 fidelity、format、notes 等字段。`,
    'decision-pass': `输出非空改编决定 JSON 数组，每项字段严格且仅为 ${DECISION_KEYS.join(', ')}。stableKey 是本候选新建且全数组唯一；action 只能是 keep/cut/merge/reorder/externalize/add；sourceFactKeys 必须是不重复的已确认 fact stableKey 数组，只有 action=add 时可为空；targetKeys 必须是稳定 key 字符串数组，可为空；rationale 是非空字符串。用少量完整决定覆盖核心因果链，不要逐句机械生成或重复 stableKey。`,
    'script-adaptation': '把已确认决定转成可画的视觉节拍，输出非空 JSON 数组。每项字段严格且仅为 stableKey, sectionKey, chapterNumber, order, narrativeFunction, visualAction, dialogueIntent, emotion, causalFactKeys, decisionKeys, sourceUnitKeys, estimatedPanels。stableKey/sectionKey 是合法稳定 key；stableKey 全数组唯一；chapterNumber 是 1 到目标章节数的整数；order 从 0 全局连续；narrativeFunction 只能是 establish/develop/reveal/reaction/turn/climax/resolution/transition；visualAction 与 emotion 是非空字符串，dialogueIntent 是字符串；causalFactKeys、decisionKeys、sourceUnitKeys 都是不重复且非空的上下文 key 数组；estimatedPanels 是 1 到 30 的整数。每个节拍只描述可画动作和状态变化，不写图片 Prompt。',
    'page-rhythm': '按目标漫画画像输出完整 PagePlan JSON 数组，数组长度必须等于 chapterCount × targetPagesPerChapter。每项字段严格且仅为 stableKey, chapterNumber, pageNumber, order, goal, beatKeys, endReveal, pageTurn, expectedPanelCount, textBudget。stableKey 全数组唯一；order 从 0 全局连续，pageNumber 必须等于 order+1；chapterNumber 是有效整数；goal 是非空字符串；beatKeys 是不重复且非空的已确认 beat stableKey 数组；endReveal 是字符串；pageTurn 只能是 none/setup/reveal-after-turn/cliffhanger；expectedPanelCount 是 1 到 9 的整数；textBudget 是 0 到 2000 的整数。让全部已确认节拍获得页面归属，页末揭示与翻页策略服务悬念。',
    'panel-plan': '覆盖每个已确认 PagePlan 输出一个扁平 PanelPlan JSON 数组；每页候选数必须恰好等于该页 expectedPanelCount。每项字段严格且仅为 pagePlanKey, stableKey, order, nextPanelKey, frame, narrativeFunction, moment, shot, subjectStates, protectedAreas, continuityRefs, lettering, sourceUnitKeys。pagePlanKey 必须逐字复制 PagePlan stableKey；stableKey 全数组唯一；每页 order 从 0 连续，nextPanelKey 必须是同页下一格 stableKey，末格必须为 null。frame 严格为 {x,y,width,height} 四个 0..1 数字，宽高至少 0.04、不得越界或互相重叠；优先使用简单清晰的纵向分带版式，同行严格服从目标 LTR/RTL。narrativeFunction 与 moment 是非空字符串且每格只冻结一个可画瞬间。shot 严格为 {size,angle,movement,composition}：size 只能 extreme-wide/wide/full/medium/close-up/extreme-close-up/insert，angle 只能 eye-level/high/low/overhead/dutch，movement 只能 static/pan/tilt/track/zoom/handheld，composition 是字符串。subjectStates 每项严格为 {subjectKey,costume,condition,props,position}；protectedAreas 每项严格为归一化 frame；continuityRefs 每项严格为 {subjectKey,note}；同格 subjectKey 不重复。lettering 可为空；非空时每项严格为 {id,kind,text,frame,direction,fontFamily,fontSize,textColor,fillColor,strokeColor,strokeWidth,tail,zIndex}，kind 只能 speech/thought/caption/sfx，direction 只能 horizontal/vertical，fontFamily 只能 storyforge-sans/storyforge-serif，三种颜色用 #RRGGBB，fontSize 6..144，strokeWidth 0..20，tail 为 null 或 {x,y}，zIndex 为非负整数，id 全格唯一。sourceUnitKeys 是不重复且非空的登记来源 key 数组。',
    'visual-bible': '输出严格 JSON 对象 {global,subjects}，不得有其它顶层字段。global 严格且仅含 version, artDirection, linework, palette, lighting, periodAndMaterials, cameraLanguage, prohibitedDepictions：version 是数字 1；artDirection/linework/lighting/periodAndMaterials 是非空字符串；palette/cameraLanguage 是非空字符串数组；prohibitedDepictions 是字符串数组且可为空。subjects 是非空数组，必须覆盖所有 panel subjectStates 和 continuityRefs 引用；每项严格且仅含 stableKey, kind, label, design, sourceUnitKeys，stableKey 与 panel subjectKey 逐字一致且全数组唯一，kind 只能 character/location/prop/style，label 非空，sourceUnitKeys 为不重复且非空的登记来源 key。design 严格且仅含 description, silhouette, facialFeatures, hairAndCostume, palette, materials, distinguishingMarks, prohibitedChanges；前四项是字符串，后四项是字符串数组。固定身份、轮廓、服装道具、材质、色彩和禁止漂移项。',
    'image-request': '只为唯一目标格编译一个图片请求 JSON 对象，字段严格且仅为 panelKey, expectedPanelRevision, visualPrompt, negativePrompt, referenceSubjectKeys, protectedAreas。panelKey 和 expectedPanelRevision 必须逐字使用目标格当前 key 与整数 revision；visualPrompt/negativePrompt 是非空字符串；referenceSubjectKeys 是不重复的已登记 visual subject key 数组；protectedAreas 是归一化 {x,y,width,height} 数组。visualPrompt 只描述一个冻结瞬间、构图、镜头与 subject 状态；visualPrompt 与 negativePrompt 合并后必须明确包含英文 no text、no speech balloons、no watermark，文字由本地排字层完成。',
    'visual-continuity-review': '当前聊天通道不传图片像素：只审查目标页面所选媒资的角色状态合同、参考图实际传输、权利、provider 回执与 Blob 元数据，不得声称看见了人物外观、构图或光线。输出 issue 数组，严格含 stableKey, category, severity, pageKey, panelKey, subjectKey, assetKey, evidence, problem, suggestion, sourceUnitKeys；category 仅 continuity/rights/media-integrity，无机器证据问题输出 []。像素层视觉判断由作者查看实际成图后另行确认。',
    'targeted-repair': '只为一个目标格及所选开放问题输出一个修复请求 JSON 对象，字段严格且仅为 panelKey, expectedPanelRevision, visualPrompt, negativePrompt, referenceSubjectKeys, protectedAreas, issueKeys, preserveSubjectKeys, repairMode。panelKey/revision/issueKeys 必须逐字复制唯一目标；referenceSubjectKeys 与 preserveSubjectKeys 为不重复稳定 key 数组；protectedAreas 为归一化 frame 数组；visualPrompt 与 negativePrompt 合并后必须包含 no text、no speech balloons、no watermark。当前 provider 未登记 edit/inpaint，repairMode 必须是 full-regenerate。',
    'page-review': '只审查唯一目标页的叙事、阅读顺序和排字，输出 JSON issue 数组。无问题必须输出 []；有问题时每项字段严格且仅为 stableKey, category, severity, pageKey, panelKey, subjectKey, assetKey, evidence, problem, suggestion, sourceUnitKeys。stableKey 全数组唯一；category 只能 narrative/reading-order/lettering；severity 只能 critical/major/minor；pageKey 必须是目标页 key；panelKey 为该页 panel key 或 null；subjectKey/assetKey 必须为 null；evidence/problem/suggestion 是非空字符串；sourceUnitKeys 是登记来源 key 数组，可为空。不得凭空生成目标页之外的 key。',
  }
  return byStage[stage]
}

async function rootFor(scope: WorkspaceScope, adaptationProjectId: number) {
  const root = await db.adaptationProjects.get(adaptationProjectId)
  if (!root?.id || root.medium !== 'comic' || root.projectId !== scope.projectId || root.worldId !== scope.worldId || root.workId !== scope.workId) throw new Error('[comic-run] 漫画改编不存在或越界')
  return root
}
async function selectTargets(input: { scope: WorkspaceScope; adaptationProjectId: number; sourceUnitKeys?: string[]; targetPageKeys?: string[]; targetPanelKeys?: string[]; targetIssueKeys?: string[] }) {
  const root = await rootFor(input.scope, input.adaptationProjectId)
  const units = await db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([root.id!, root.activeSourceManifestVersion]).sortBy('order')
  const unitKeys = new Set(units.map(row => row.sourceUnitKey)); const sourceUnitKeys = [...new Set(input.sourceUnitKeys?.length ? input.sourceUnitKeys : units.map(row => row.sourceUnitKey))]
  if (!sourceUnitKeys.length || sourceUnitKeys.some(key => !unitKeys.has(key))) throw new Error('[comic-run] 来源选择越过当前 manifest')
  const pages = await db.comicPages.where('adaptationProjectId').equals(root.id!).toArray(); const pageKeys = [...new Set(input.targetPageKeys ?? [])]
  const targetPages = pages.filter(row => pageKeys.includes(row.stableKey)); if (targetPages.length !== pageKeys.length) throw new Error('[comic-run] 目标页面不存在或重复')
  const pageIds = pages.flatMap(row => row.id == null ? [] : [row.id]); const panels = pageIds.length ? await db.comicPanels.where('pageId').anyOf(pageIds).toArray() : []
  const panelKeys = [...new Set(input.targetPanelKeys ?? [])]; const targetPanels = panels.filter(row => panelKeys.includes(row.stableKey)); if (targetPanels.length !== panelKeys.length) throw new Error('[comic-run] 目标格不存在或重复')
  const issues = await db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals([root.id!, root.activeSourceManifestVersion]).toArray(); const issueKeys = [...new Set(input.targetIssueKeys ?? [])]
  const targetIssues = issues.filter(row => issueKeys.includes(row.stableKey) && row.status === 'open'); if (targetIssues.length !== issueKeys.length) throw new Error('[comic-run] 目标开放问题不存在或重复')
  return { root, sourceUnitKeys, pages, panels, targetPages, targetPanels, targetIssues }
}

function requireStage(stage: ComicProfessionalStageV1, root: Awaited<ReturnType<typeof rootFor>>, counts: Record<string, number>, target: { pages: number; panels: number; issues: number }) {
  if (stage !== 'source-analysis' && !counts.facts) throw new Error('[comic-run] 请先确认来源事实')
  if (stage === 'adaptation-brief' && !counts.edges) throw new Error('[comic-run] 请先确认因果图')
  if (!['source-analysis', 'causal-graph', 'adaptation-brief'].includes(stage) && root.briefSourceManifestVersion !== root.activeSourceManifestVersion) throw new Error('[comic-run] 请先确认当前 Brief')
  if (['script-adaptation', 'page-rhythm', 'panel-plan', 'visual-bible', 'image-request', 'visual-continuity-review', 'targeted-repair', 'page-review'].includes(stage) && !counts.decisions) throw new Error('[comic-run] 请先确认改编决定')
  if (['page-rhythm', 'panel-plan', 'visual-bible', 'image-request', 'visual-continuity-review', 'targeted-repair', 'page-review'].includes(stage) && !counts.beats) throw new Error('[comic-run] 请先确认漫画脚本节拍')
  if (['panel-plan', 'visual-bible', 'image-request', 'visual-continuity-review', 'targeted-repair', 'page-review'].includes(stage) && !counts.plans) throw new Error('[comic-run] 请先确认分页节奏')
  if (['image-request', 'visual-continuity-review', 'targeted-repair', 'page-review'].includes(stage) && (!counts.pages || !counts.subjects)) throw new Error('[comic-run] 请先确认页格与视觉圣经')
  if (stage === 'image-request' && target.panels !== 1) throw new Error('[comic-run] 图片请求必须且只能选择一格')
  if (stage === 'targeted-repair' && (target.panels !== 1 || !target.issues)) throw new Error('[comic-run] 定点修复必须选择一格及其开放问题')
  if (['visual-continuity-review', 'page-review'].includes(stage) && !target.pages) throw new Error('[comic-run] 审查必须选择目标页')
}

function runContract(scope: WorkspaceScope, stage: ComicProfessionalStageV1) {
  const config = STAGES[stage]; const skill = getAgentSkillV1(config.skillId); const stepId = `comic-professional:${stage}`
  return {
    version: 1 as const, objective: `${config.role}执行漫画专业生产阶段 ${stage}，产出候选并等待作者确认`, workflowKind: 'plan-execute' as const,
    scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: { contextSourceKeys: [...skill.contextSourceKeys], writeTargets: skill.writeTargets.map(row => ({ table: row.table, fields: [...row.fields], mode: 'author-confirmed' as const })) },
    executionBindings: [{ stepId, ...createAgentSkillExecutionBindingV1(skill) }],
    budget: { maxModelCalls: 2, maxToolCalls: 0, maxInputTokens: 48_000, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 2, maxProtocolErrors: 1 },
    acceptance: [{ id: `${stepId}.candidate`, kind: 'output-present' as const, required: true }, { id: `${stepId}.author`, kind: 'author-confirmed' as const, required: true }, { id: `${stepId}.post-state`, kind: 'post-state-matches' as const, required: true }],
    verificationPlan: [{ id: `${stepId}.terminal`, kind: 'terminal' as const, verifier: `comic-${stage}-terminal-v1`, criterionIds: [`${stepId}.candidate`, `${stepId}.author`, `${stepId}.post-state`] }],
    failurePolicy: { onProtocolError: 'retry' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const },
  }
}
async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: any) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as any)
}

export async function generateComicProfessionalCandidateV1(input: { scope: WorkspaceScope; adaptationProjectId: number; stage: ComicProfessionalStageV1; sourceUnitKeys?: string[]; targetPageKeys?: string[]; targetPanelKeys?: string[]; targetIssueKeys?: string[]; authorInstruction?: string; aiConfig?: AIConfig; runAI?: (messages: ChatMessage[]) => Promise<string> }): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ComicProfessionalCandidateV1 }> {
  if (!input.aiConfig && !input.runAI) throw new Error('[comic-run] 缺少 AI 配置')
  const selected = await selectTargets(input); if ((await inspectAdaptationFreshness(selected.root.id!)).status !== 'unchanged') throw new Error('[comic-run] 来源已变化或缺失，请先同步')
  const key = [selected.root.id!, selected.root.activeSourceManifestVersion] as [number, number]
  const [factRows, edgeRows, decisionRows, beatRows, planRows, pageCount, subjectRows] = await Promise.all([
    db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').toArray(),
    db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').toArray(),
    db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').toArray(),
    db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(),
    db.comicPages.where('adaptationProjectId').equals(selected.root.id!).count(), db.comicVisualSubjects.where('adaptationProjectId').equals(selected.root.id!).toArray(),
  ])
  requireStage(input.stage, selected.root, { facts: factRows.length, edges: edgeRows.length, decisions: decisionRows.length, beats: beatRows.length, plans: planRows.length, pages: pageCount, subjects: subjectRows.length }, { pages: selected.targetPages.length, panels: selected.targetPanels.length, issues: selected.targetIssues.length })
  const config = STAGES[input.stage]; const skill = getAgentSkillV1(config.skillId); const stepId = `comic-professional:${input.stage}`
  let snapshot = await createAgentRunV1({ scope: input.scope, worldGroupId: null, contract: runContract(input.scope, input.stage) })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId }); snapshot = await append(input.scope, snapshot, 'step.started', { stepId, attempt: 1 })
  const inferredTargetPages = selected.targetPages.length ? selected.targetPages : selected.targetPanels.length ? selected.pages.filter(page => selected.targetPanels.some(panel => panel.pageId === page.id)) : ['visual-bible', 'image-request', 'visual-continuity-review', 'targeted-repair', 'page-review'].includes(input.stage) ? selected.pages : []
  const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope, sourceKeys: [...skill.contextSourceKeys], adaptationProjectId: selected.root.id!, adaptationSourceManifestVersion: selected.root.activeSourceManifestVersion, adaptationSourceUnitKeys: selected.sourceUnitKeys, comicPageIds: inferredTargetPages.flatMap(row => row.id == null ? [] : [row.id]), provider: input.aiConfig?.provider, model: input.aiConfig?.model, inputBudgetMaxTokens: 48_000 })
  let activeContextManifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId, attempt: 1, projectId: input.scope.projectId, worldGroupId: null, declaredSourceKeys: [...skill.contextSourceKeys], assembled, readerVersion: `comic-${input.stage}-context-v1` })
  snapshot = await append(input.scope, snapshot, 'context.assembled', { stepId, attempt: 1, manifestHash: activeContextManifest.manifestHash })
  const targetKeys = [...selected.targetPages.map(row => row.stableKey), ...selected.targetPanels.map(row => row.stableKey), ...selected.targetIssues.map(row => row.stableKey)]
  const panelSubjectKeys = [...new Set(selected.panels.flatMap(panel => [...(panel.subjectStates ?? []), ...(panel.continuityRefs ?? [])].map(row => row.subjectKey)))]
  const referenceClosure = [
    ['causal-graph', 'decision-pass', 'script-adaptation'].includes(input.stage) ? `允许 fact stableKey 闭集：${factRows.map(row => row.stableKey).join(', ')}` : '',
    input.stage === 'script-adaptation' ? `允许 decision stableKey 闭集：${decisionRows.map(row => row.stableKey).join(', ')}` : '',
    input.stage === 'page-rhythm' ? `允许 beat stableKey 闭集：${beatRows.map(row => row.stableKey).join(', ')}` : '',
    input.stage === 'panel-plan' ? `PagePlan 闭集与目标格数：${planRows.map(row => `${row.stableKey}=${row.expectedPanelCount}`).join(', ')}` : '',
    input.stage === 'visual-bible' ? `必须逐字覆盖的 panel subjectKey 闭集：${panelSubjectKeys.join(', ')}` : '',
    ['image-request', 'targeted-repair'].includes(input.stage) ? `允许 visual subject stableKey 闭集：${subjectRows.map(row => row.stableKey).join(', ')}` : '',
  ].filter(Boolean).join('\n')
  const system = [`你是${config.role}。只完成当前职责，不替后续岗位生成或采纳。`, '严格区分来源事实、作者确认决定与提案；不得把新增桥接伪装成原文。', '只输出一个严格 JSON 值，不要 Markdown、解释、注释或代码围栏。候选自身新建的 stableKey 必须全批次唯一并匹配 ^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$；所有引用字段只能逐字使用登记上下文中的 key 或当前批次明确创建的目标 key。数组不得含重复项；数字必须是 JSON number；可空定位字段必须显式写 null，绝不输出 undefined；不得输出数据库数字 ID。', `目标漫画画像：${JSON.stringify(selected.root.targetSpec)}`, input.stage === 'source-analysis' ? `唯一来源单元：${selected.sourceUnitKeys.join(', ')}` : '', referenceClosure, targetKeys.length ? `唯一目标：${targetKeys.join(', ')}` : '', input.authorInstruction?.trim() ? `作者附加要求：${input.authorInstruction.trim()}` : '', `登记上下文：\n${assembled.text}`].filter(Boolean).join('\n\n')
  const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: comicProfessionalInstructionV1(input.stage) }]
  const attemptedMessages: ChatMessage[][] = [messages]
  const invoke = async (attemptMessages: ChatMessage[], attempt: number): Promise<string> => {
    snapshot = await append(input.scope, snapshot, 'model.requested', { stepId, attempt, bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]) })
    let output: string
    try { output = await (input.runAI ? input.runAI(attemptMessages) : chat(attemptMessages, input.aiConfig!, { category: `comic.${input.stage}`, projectId: input.scope.projectId, configOverrides: { maxTokens: skill.maxOutputTokens }, contextOverflowPolicy: 'reject' }, AbortSignal.timeout(COMIC_MODEL_TIMEOUT_MS))) }
    catch (error) {
      await append(input.scope, snapshot, 'run.paused', { reason: `comic-${input.stage}-model-outcome-unknown`, recoverable: false })
      if (error instanceof DOMException && error.name === 'TimeoutError') throw new Error(`[comic-run] 模型 ${COMIC_MODEL_TIMEOUT_MS / 1_000} 秒未返回；本次运行已暂停，可重试或使用作者兜底。`)
      throw error
    }
    snapshot = await append(input.scope, snapshot, 'model.responded', { stepId, attempt, outputHash: await hashCanonicalValue({ raw: output }) })
    return output
  }
  const parseForRun = (output: string): ComicProfessionalPayloadV1 => {
    const parsed = parseComicProfessionalPayloadV1(input.stage, parseJson(output))
    if (input.stage === 'source-analysis') {
      const allowed = new Set(selected.sourceUnitKeys)
      const invalid = (parsed as AdaptationSourceFactCandidateV1[]).flatMap(row => row.sourceUnitKeys.filter(key => !allowed.has(key)))
      if (invalid.length) throw new Error(`[comic-run] SourceFact 引用了未选择的来源单元：${[...new Set(invalid)].join('、')}`)
    }
    return parsed
  }
  let attempt = 1; let raw = await invoke(messages, attempt); let payload: ComicProfessionalPayloadV1
  try { payload = parseForRun(raw) }
  catch (firstError) {
    snapshot = await append(input.scope, snapshot, 'step.failed', { stepId, attempt, code: `comic-${input.stage}-protocol-failed`, retryable: true, category: 'protocol', action: 'retry' })
    attempt = 2; snapshot = await append(input.scope, snapshot, 'step.started', { stepId, attempt })
    activeContextManifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId, attempt, projectId: input.scope.projectId, worldGroupId: null, declaredSourceKeys: [...skill.contextSourceKeys], assembled, readerVersion: `comic-${input.stage}-context-v1` })
    snapshot = await append(input.scope, snapshot, 'context.assembled', { stepId, attempt, manifestHash: activeContextManifest.manifestHash })
    const repairMessages: ChatMessage[] = [
      { role: 'system', content: '你是 JSON 协议修复器。只修复上次候选的结构、字段、类型、枚举和引用格式；保留原有创作含义，不增加新事实，不解释。只输出一个修复后的严格 JSON 值。' },
      { role: 'user', content: `目标阶段：${input.stage}\n协议：${comicProfessionalInstructionV1(input.stage)}\n解析错误：${firstError instanceof Error ? firstError.message : String(firstError)}\n上次输出：\n${raw.slice(0, 160_000)}` },
    ]
    attemptedMessages.push(repairMessages); raw = await invoke(repairMessages, attempt)
    try { payload = parseForRun(raw) }
    catch (error) { snapshot = await append(input.scope, snapshot, 'step.failed', { stepId, attempt, code: `comic-${input.stage}-protocol-failed`, retryable: false, category: 'protocol', action: 'fail' }); await append(input.scope, snapshot, 'run.failed', { code: `comic-${input.stage}-protocol-failed`, retryable: false }); throw error }
  }
  const revisionTargets = ['visual-continuity-review', 'page-review'].includes(input.stage) ? selected.panels.filter(panel => selected.targetPages.some(page => page.id === panel.pageId)) : selected.targetPanels
  const body = { version: 1 as const, kind: 'comic-professional-candidate' as const, portable: false as const, stage: input.stage, projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId, adaptationProjectId: selected.root.id!, adaptationRevision: selected.root.revision, sourceManifestVersion: selected.root.activeSourceManifestVersion, sourceManifestHash: selected.root.activeSourceManifestHash, sourceUnitKeys: selected.sourceUnitKeys, targetPageKeys: selected.targetPages.map(row => row.stableKey), targetPanelKeys: revisionTargets.map(row => row.stableKey), targetIssueKeys: selected.targetIssues.map(row => row.stableKey), targetPanelRevisions: Object.fromEntries(revisionTargets.map(row => [row.stableKey, row.revision])), contextManifestHash: activeContextManifest.manifestHash, promptHash: await hashCanonicalValue(attemptedMessages), modelOutputHash: await hashCanonicalValue({ raw }), payload, payloadHash: await hashCanonicalValue(payload) }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate }); snapshot = saved.snapshot
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId, attempt, candidateHash: candidate.candidateHash, requiresConfirmation: true })
  return { snapshot, candidate }
}

async function parseCandidate(value: unknown): Promise<ComicProfessionalCandidateV1> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('[comic-run] 候选检查点无效')
  const row = value as ComicProfessionalCandidateV1
  if (row.version !== 1 || row.kind !== 'comic-professional-candidate' || row.portable !== false || !COMIC_PROFESSIONAL_STAGES_V1.includes(row.stage)) throw new Error('[comic-run] 候选类型无效')
  parseComicProfessionalPayloadV1(row.stage, row.payload); if (await hashCanonicalValue(row.payload) !== row.payloadHash) throw new Error('[comic-run] 候选 payload hash 不匹配')
  const { candidateHash: _candidateHash, ...body } = row; if (await hashCanonicalValue(body) !== row.candidateHash) throw new Error('[comic-run] 候选 hash 不匹配')
  return row
}
async function latest(scope: WorkspaceScope, runId: number): Promise<{ candidate: ComicProfessionalCandidateV1; intent: ComicProfessionalIntentV1 | null }> {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId); if (!checkpoint) throw new Error('[comic-run] 运行缺少可验证检查点')
  const value = checkpoint.resumePayload as any
  if (value?.kind === 'comic-professional-intent') { const candidate = await parseCandidate(value.candidate); const authorPayload = parseComicProfessionalPayloadV1(candidate.stage, value.authorPayload); if (await hashCanonicalValue(authorPayload) !== value.authorPayloadHash) throw new Error('[comic-run] 作者 payload hash 不匹配'); if (typeof value.authorVisualInspectionConfirmed !== 'boolean') throw new Error('[comic-run] 作者视觉确认依据缺失'); const { intentHash: _intentHash, ...body } = value; if (await hashCanonicalValue(body) !== value.intentHash) throw new Error('[comic-run] 采纳意图 hash 不匹配'); return { candidate, intent: value as ComicProfessionalIntentV1 } }
  return { candidate: await parseCandidate(value), intent: null }
}
async function assertFresh(scope: WorkspaceScope, candidate: ComicProfessionalCandidateV1) {
  const root = await rootFor(scope, candidate.adaptationProjectId); if (root.revision !== candidate.adaptationRevision || root.activeSourceManifestVersion !== candidate.sourceManifestVersion || root.activeSourceManifestHash !== candidate.sourceManifestHash || (await inspectAdaptationFreshness(root.id!)).status !== 'unchanged') throw new Error('[comic-run] 改编根或来源已变化，候选 stale')
  const pages = await db.comicPages.where('adaptationProjectId').equals(root.id!).toArray(); const pageIds = pages.flatMap(row => row.id == null ? [] : [row.id]); const panels = pageIds.length ? await db.comicPanels.where('pageId').anyOf(pageIds).filter(row => candidate.targetPanelKeys.includes(row.stableKey)).toArray() : []
  if (panels.length !== candidate.targetPanelKeys.length || panels.some(row => candidate.targetPanelRevisions[row.stableKey] !== row.revision)) throw new Error('[comic-run] 目标格已变化，候选 stale')
  return root
}
async function writeFormal(scope: WorkspaceScope, intent: ComicProfessionalIntentV1) {
  const candidate = intent.candidate; const root = await assertFresh(scope, candidate); const payload = intent.authorPayload
  if (candidate.stage === 'source-analysis') return adoptAdaptationSourceFactsV1({ scope, adaptationProjectId: root.id!, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, items: (payload as AdaptationSourceFactCandidateV1[]).map(row => ({ candidate: row, authorStatus: 'confirmed' })), replaceExisting: false })
  if (candidate.stage === 'causal-graph') return adoptAdaptationCausalEdgesV1({ scope, adaptationProjectId: root.id!, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, items: (payload as AdaptationCausalEdgeCandidateV1[]).map(row => ({ candidate: row, authorStatus: 'confirmed' })) })
  if (candidate.stage === 'adaptation-brief') { const saved = await saveAdaptationBriefDraft({ adaptationProjectId: root.id!, brief: payload as AdaptationBriefV1, expectedRevision: root.revision }); return confirmAdaptationBrief({ adaptationProjectId: root.id!, expectedRevision: saved.revision }) }
  if (candidate.stage === 'decision-pass') return adoptAdaptationDecisionsV1({ scope, adaptationProjectId: root.id!, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, items: (payload as AdaptationDecisionCandidateV1[]).map(row => ({ candidate: row, authorStatus: 'confirmed' })) })
  if (candidate.stage === 'script-adaptation') return adoptComicScriptBeatsV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidates: payload as ComicScriptBeatCandidateV1[] })
  if (candidate.stage === 'page-rhythm') return adoptComicPagePlansV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidates: payload as ComicPagePlanCandidateV1[] })
  if (candidate.stage === 'panel-plan') return adoptComicPanelPlansV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidates: payload as ComicPanelPlanCandidateV1[] })
  if (candidate.stage === 'visual-bible') return adoptComicVisualBibleV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, candidate: payload as ComicVisualBibleCandidateV1 })
  if (candidate.stage === 'image-request') return adoptComicImageRequestV1({ scope, expectedAdaptationRevision: root.revision, candidate: payload as ComicImageRequestCandidateV1 })
  if (candidate.stage === 'targeted-repair') return adoptComicRepairRequestV1({ scope, expectedAdaptationRevision: root.revision, candidate: payload as ComicRepairRequestCandidateV1 })
  return adoptComicReviewIssuesV1({ scope, expectedAdaptationRevision: root.revision, sourceManifestVersion: root.activeSourceManifestVersion, reviewKind: candidate.stage === 'page-review' ? 'page' : 'visual', targetPageKeys: candidate.targetPageKeys, expectedPanelRevisions: candidate.targetPanelRevisions, candidates: payload as ComicReviewIssueCandidateV1[], visualInspectionConfirmed: intent.authorVisualInspectionConfirmed })
}
async function postStateHash(candidate: ComicProfessionalCandidateV1): Promise<string> {
  const key = [candidate.adaptationProjectId, candidate.sourceManifestVersion] as [number, number]
  if (candidate.stage === 'source-analysis') return hashCanonicalValue(await db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
  if (candidate.stage === 'causal-graph') return hashCanonicalValue(await db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
  if (candidate.stage === 'decision-pass') return hashCanonicalValue(await db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
  if (candidate.stage === 'script-adaptation') return hashCanonicalValue(await db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
  if (candidate.stage === 'page-rhythm') return hashCanonicalValue(await db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
  if (candidate.stage === 'panel-plan' || candidate.stage === 'image-request' || candidate.stage === 'targeted-repair') return hashCanonicalValue(await db.comicPanels.where('workId').equals(candidate.workId).toArray())
  if (candidate.stage === 'visual-bible') return hashCanonicalValue({ root: await db.adaptationProjects.get(candidate.adaptationProjectId), subjects: await db.comicVisualSubjects.where('adaptationProjectId').equals(candidate.adaptationProjectId).toArray() })
  if (candidate.stage === 'adaptation-brief') return hashCanonicalValue((await db.adaptationProjects.get(candidate.adaptationProjectId))?.brief)
  return hashCanonicalValue(await db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).toArray())
}

function fields(row: Record<string, any>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map(key => [key, structuredClone(row[key])]))
}
async function rowsMatch(rows: Array<Record<string, any>>, payload: Array<Record<string, any>>, keys: readonly string[]): Promise<boolean> {
  const byKey = new Map(rows.map(row => [row.stableKey, row])); const actual = payload.map(row => byKey.get(row.stableKey)).filter(Boolean) as Array<Record<string, any>>
  return actual.length === payload.length && await hashCanonicalValue(actual.map(row => fields(row, keys))) === await hashCanonicalValue(payload.map(row => fields(row, keys)))
}
/** Narrows the crash window where the domain transaction committed before the run event did. */
async function formalAlreadyApplied(candidate: ComicProfessionalCandidateV1, payload: ComicProfessionalPayloadV1): Promise<boolean> {
  const root = await db.adaptationProjects.get(candidate.adaptationProjectId); if (!root) return false
  const key = [candidate.adaptationProjectId, candidate.sourceManifestVersion] as [number, number]
  if (candidate.stage === 'source-analysis') return root.revision === candidate.adaptationRevision + 1 && rowsMatch(await db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload as any[], FACT_KEYS)
  if (candidate.stage === 'causal-graph') return root.revision === candidate.adaptationRevision + 1 && rowsMatch(await db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload as any[], EDGE_KEYS)
  if (candidate.stage === 'adaptation-brief') return root.revision === candidate.adaptationRevision + 2 && root.briefSourceManifestVersion === candidate.sourceManifestVersion && await hashCanonicalValue(root.brief) === await hashCanonicalValue(payload)
  if (candidate.stage === 'decision-pass') return root.revision === candidate.adaptationRevision + 1 && rowsMatch(await db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload as any[], DECISION_KEYS)
  if (candidate.stage === 'script-adaptation') return root.revision === candidate.adaptationRevision + 1 && rowsMatch(await db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload as any[], ['stableKey', 'sectionKey', 'chapterNumber', 'order', 'narrativeFunction', 'visualAction', 'dialogueIntent', 'emotion', 'causalFactKeys', 'decisionKeys', 'sourceUnitKeys', 'estimatedPanels'])
  if (candidate.stage === 'page-rhythm') return root.revision === candidate.adaptationRevision + 1 && rowsMatch(await db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload as any[], ['stableKey', 'chapterNumber', 'pageNumber', 'order', 'goal', 'beatKeys', 'endReveal', 'pageTurn', 'expectedPanelCount', 'textBudget'])
  if (candidate.stage === 'panel-plan') {
    if (root.revision !== candidate.adaptationRevision + 1) return false
    const pages = await db.comicPages.where('adaptationProjectId').equals(root.id!).toArray(); const panels = pages.length ? await db.comicPanels.where('pageId').anyOf(pages.map(row => row.id!)).toArray() : []
    return rowsMatch(panels, payload as any[], ['stableKey', 'order', 'nextPanelKey', 'frame', 'narrativeFunction', 'moment', 'shot', 'subjectStates', 'protectedAreas', 'continuityRefs', 'lettering'])
  }
  if (candidate.stage === 'visual-bible') {
    const body = payload as ComicVisualBibleCandidateV1; if (root.revision !== candidate.adaptationRevision + 1 || await hashCanonicalValue(root.visualBible) !== await hashCanonicalValue(body.global)) return false
    return rowsMatch(await db.comicVisualSubjects.where('adaptationProjectId').equals(root.id!).toArray(), body.subjects as any[], ['stableKey', 'kind', 'label', 'design'])
  }
  if (candidate.stage === 'image-request' || candidate.stage === 'targeted-repair') {
    if (root.revision !== candidate.adaptationRevision) return false
    const body = payload as ComicImageRequestCandidateV1; const panel = await db.comicPanels.where('[workId+stableKey]').equals([candidate.workId, body.panelKey]).first()
    return Boolean(panel && panel.revision === body.expectedPanelRevision + 1 && panel.visualPrompt === body.visualPrompt.trim() && panel.negativePrompt === body.negativePrompt.trim() && await hashCanonicalValue(panel.protectedAreas ?? []) === await hashCanonicalValue(body.protectedAreas))
  }
  if (root.revision !== candidate.adaptationRevision + 1) return false
  const pages = await db.comicPages.where('adaptationProjectId').equals(root.id!).filter(row => candidate.targetPageKeys.includes(row.stableKey)).toArray(); const panels = pages.length ? await db.comicPanels.where('pageId').anyOf(pages.map(row => row.id!)).toArray() : []
  const reviewField = candidate.stage === 'page-review' ? 'narrativeReviewRevision' : 'visualReviewRevision'
  if (panels.some(panel => panel[reviewField] !== panel.revision || (candidate.stage === 'visual-continuity-review' && (panel.visualReviewBasis !== 'author-visual' || !panel.visualReviewedAt)))) return false
  return rowsMatch(await db.comicReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).toArray(), payload as any[], ['stableKey', 'category', 'severity', 'pageKey', 'panelKey', 'subjectKey', 'assetKey', 'evidence', 'problem', 'suggestion', 'sourceUnitKeys'])
}

export async function adoptComicProfessionalCandidateV1(input: { scope: WorkspaceScope; runId: number; authorPayload?: ComicProfessionalPayloadV1; authorVisualInspectionConfirmed?: boolean; onDurableBoundary?: (boundary: 'adoption.started' | 'formal.written' | 'adoption.committed' | 'verification.accepted', snapshot: AgentRunSnapshotV1) => void | Promise<void> }): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ComicProfessionalCandidateV1; receiptHash: string }> {
  let snapshot = await readAgentRunV1(input.scope, input.runId); const state = await latest(input.scope, input.runId); const candidate = state.candidate; const stepId = `comic-professional:${candidate.stage}`; let intent = state.intent
  if (candidate.projectId !== input.scope.projectId || candidate.worldId !== input.scope.worldId || candidate.workId !== input.scope.workId) throw new Error('[comic-run] 候选越过当前 Work')
  if (snapshot.projection.state === 'completed' && snapshot.projection.terminalReceiptHash) return { snapshot, candidate, receiptHash: snapshot.projection.terminalReceiptHash }
  if (snapshot.projection.state === 'awaiting_confirmation') { await assertFresh(input.scope, candidate); if (candidate.stage === 'visual-continuity-review' && !input.authorVisualInspectionConfirmed) throw new Error('[comic-run] 请先查看目标页实际成图并明确确认视觉检查'); const authorPayload = parseComicProfessionalPayloadV1(candidate.stage, input.authorPayload ?? candidate.payload); const body = { version: 1 as const, kind: 'comic-professional-intent' as const, candidate, authorPayload, authorPayloadHash: await hashCanonicalValue(authorPayload), authorVisualInspectionConfirmed: candidate.stage === 'visual-continuity-review' && input.authorVisualInspectionConfirmed === true }; intent = { ...body, intentHash: await hashCanonicalValue(body) }; const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: intent }); snapshot = saved.snapshot; snapshot = await append(input.scope, snapshot, 'confirmation.recorded', { stepId, candidateHash: candidate.candidateHash, decision: 'adopt' }); snapshot = await append(input.scope, snapshot, 'adoption.started', { stepId, candidateHash: candidate.candidateHash, intentHash: intent.intentHash }); await input.onDurableBoundary?.('adoption.started', snapshot) }
  if (!intent) throw new Error('[comic-run] 候选不在可采纳状态')
  let adoptionHash = snapshot.projection.steps[stepId]?.adoptionHash
  if (!adoptionHash) { if (!await formalAlreadyApplied(candidate, intent.authorPayload)) await writeFormal(input.scope, intent); await input.onDurableBoundary?.('formal.written', snapshot); const stateHash = await postStateHash(candidate); adoptionHash = await hashCanonicalValue({ intentHash: intent.intentHash, stateHash }); snapshot = await append(input.scope, snapshot, 'adoption.committed', { stepId, candidateHash: candidate.candidateHash, adoptionHash }); await input.onDurableBoundary?.('adoption.committed', snapshot) }
  const stateHash = await postStateHash(candidate); if (snapshot.projection.steps[stepId]?.status === 'running') snapshot = await append(input.scope, snapshot, 'step.succeeded', { stepId, attempt: 1, outputHash: adoptionHash }); if (snapshot.projection.state === 'running') snapshot = await append(input.scope, snapshot, 'verification.started', { verifierSetVersion: `comic-${candidate.stage}-terminal-v1` })
  const receipt = await createVerificationReceiptV1({ version: 1, runId: snapshot.run.id, generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash, contextManifestHashes: [candidate.contextManifestHash], candidateHashes: [candidate.candidateHash], adoptionEventIds: [], postStateHash: stateHash, verifierSetVersion: `comic-${candidate.stage}-terminal-v1`, criteria: [{ id: `${stepId}.candidate`, status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] }, { id: `${stepId}.author`, status: 'passed', evidenceRefs: [`intent:${intent.intentHash}`] }, { id: `${stepId}.post-state`, status: 'passed', evidenceRefs: [`post-state:${stateHash}`] }], acceptedAt: Date.now() })
  snapshot = await append(input.scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash }); await input.onDurableBoundary?.('verification.accepted', snapshot); return { snapshot, candidate, receiptHash: receipt.receiptHash }
}

export async function readPendingComicProfessionalCandidateV1(scope: WorkspaceScope): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ComicProfessionalCandidateV1 } | null> {
  const rows = (await readOwnedRows<any>(scope, 'agentRuns', { owner: 'work' })).filter(row => ['awaiting_confirmation', 'running'].includes(row.status) && row.contractJson?.includes('comic-professional:')).sort((a, b) => (b.id ?? 0) - (a.id ?? 0))
  for (const row of rows) { if (!row.id) continue; try { let snapshot = await readAgentRunV1(scope, row.id); const state = await latest(scope, row.id); if (state.intent) continue; const candidate = state.candidate; const stepId = `comic-professional:${candidate.stage}`; if (!snapshot.projection.steps[stepId]?.candidateHash && snapshot.projection.steps[stepId]?.status === 'running') snapshot = await append(scope, snapshot, 'candidate.persisted', { stepId, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: true }); if (snapshot.projection.state === 'awaiting_confirmation') return { snapshot, candidate } } catch { /* ignore damaged candidates */ } }
  return null
}
export async function rejectComicProfessionalCandidateV1(scope: WorkspaceScope, runId: number): Promise<void> {
  let snapshot = await readAgentRunV1(scope, runId); const state = await latest(scope, runId); if (state.intent || snapshot.projection.state !== 'awaiting_confirmation') throw new Error('[comic-run] 候选不在等待确认状态'); const stepId = `comic-professional:${state.candidate.stage}`; snapshot = await append(scope, snapshot, 'confirmation.recorded', { stepId, candidateHash: state.candidate.candidateHash, decision: 'reject' }); await append(scope, snapshot, 'run.cancelled', { reason: `author-rejected-comic-${state.candidate.stage}` })
}
