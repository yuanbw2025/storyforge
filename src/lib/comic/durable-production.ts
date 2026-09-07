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

const FACT_KEYS = ['stableKey', 'kind', 'statement', 'subjectKeys', 'sourceUnitKeys', 'confidence'] as const
const EDGE_KEYS = ['stableKey', 'fromFactKey', 'toFactKey', 'relation', 'rationale', 'sourceUnitKeys'] as const
const DECISION_KEYS = ['stableKey', 'action', 'sourceFactKeys', 'targetKeys', 'rationale'] as const
const BRIEF_KEYS = ['version', 'coreTheme', 'dominantEmotion', 'mustKeep', 'mayCut', 'mayMerge', 'mayReorder', 'allowedAdditions', 'audience', 'rating', 'targetScale', 'narrativePerspective', 'timeBudget', 'costLimit', 'deviationNotes', 'unresolvedQuestions', 'assumptions'] as const

function exact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[comic-run] ${label} 必须是对象`)
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`[comic-run] ${label} 字段不在闭集`)
}
function stable(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value)) throw new Error(`[comic-run] ${label} 非法`)
}
function strings(value: unknown, label: string, empty = false): asserts value is string[] {
  if (!Array.isArray(value) || (!empty && !value.length) || new Set(value).size !== value.length || value.some(row => typeof row !== 'string' || !row.trim())) throw new Error(`[comic-run] ${label} 非法`)
}
function parseFact(value: unknown): asserts value is AdaptationSourceFactCandidateV1 {
  exact(value, FACT_KEYS, 'SourceFact'); stable(value.stableKey, 'SourceFact.stableKey'); strings(value.subjectKeys, 'SourceFact.subjectKeys', true); strings(value.sourceUnitKeys, 'SourceFact.sourceUnitKeys')
  if (!['event', 'character-state', 'relationship', 'location', 'object', 'motif'].includes(value.kind) || typeof value.statement !== 'string' || !value.statement.trim() || typeof value.confidence !== 'number' || value.confidence < 0 || value.confidence > 1) throw new Error('[comic-run] SourceFact 非法')
}
function parseEdge(value: unknown): asserts value is AdaptationCausalEdgeCandidateV1 {
  exact(value, EDGE_KEYS, 'CausalEdge'); stable(value.stableKey, 'CausalEdge.stableKey'); stable(value.fromFactKey, 'fromFactKey'); stable(value.toFactKey, 'toFactKey'); strings(value.sourceUnitKeys, 'sourceUnitKeys')
  if (value.fromFactKey === value.toFactKey || !['cause', 'enables', 'motivates', 'reveals', 'prevents'].includes(value.relation) || typeof value.rationale !== 'string' || !value.rationale.trim()) throw new Error('[comic-run] CausalEdge 非法')
}
function parseDecision(value: unknown): asserts value is AdaptationDecisionCandidateV1 {
  exact(value, DECISION_KEYS, 'Decision'); stable(value.stableKey, 'Decision.stableKey'); strings(value.sourceFactKeys, 'sourceFactKeys', value.action === 'add'); strings(value.targetKeys, 'targetKeys', true)
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

function instructions(stage: ComicProfessionalStageV1): string {
  const byStage: Record<ComicProfessionalStageV1, string> = {
    'source-analysis': `逐项提取冻结来源事实。输出数组，每项仅含 ${FACT_KEYS.join(', ')}；每项必须有 sourceUnitKeys 证据。`,
    'causal-graph': `只为已确认事实建立有向因果边。输出数组，每项仅含 ${EDGE_KEYS.join(', ')}；禁止自环、时间相邻伪因果。`,
    'adaptation-brief': `输出漫画改编合同对象，字段严格仅为 ${BRIEF_KEYS.join(', ')}；锁定主题、读者、篇幅、禁改项和自由度。`,
    'decision-pass': `逐项输出改编决定数组，每项仅含 ${DECISION_KEYS.join(', ')}；action 仅 keep/cut/merge/reorder/externalize/add。`,
    'script-adaptation': '把已确认决定转成可画的视觉节拍数组。每项严格含 stableKey, sectionKey, chapterNumber, order, narrativeFunction, visualAction, dialogueIntent, emotion, causalFactKeys, decisionKeys, sourceUnitKeys, estimatedPanels。一个节拍必须有可画动作与状态变化。',
    'page-rhythm': '按目标总页数输出完整 PagePlan 数组。每项严格含 stableKey, chapterNumber, pageNumber, order, goal, beatKeys, endReveal, pageTurn, expectedPanelCount, textBudget。pageNumber/order 连续；正反页翻页点服务揭示与悬念。',
    'panel-plan': '覆盖每个 PagePlan 输出 PanelPlan 数组。每项严格含 pagePlanKey, stableKey, order, nextPanelKey, frame, narrativeFunction, moment, shot, subjectStates, protectedAreas, continuityRefs, lettering, sourceUnitKeys。每格只冻结一个可画瞬间；nextPanelKey 显式形成阅读链；frame 归一化且不重叠；台词服从页面文字预算。',
    'visual-bible': '输出 {global,subjects}。global 严格含 version, artDirection, linework, palette, lighting, periodAndMaterials, cameraLanguage, prohibitedDepictions；subject 严格含 stableKey, kind, label, design, sourceUnitKeys，覆盖所有页格 subject 引用并写不可变特征。',
    'image-request': '只编译一个目标格的图片请求。严格含 panelKey, expectedPanelRevision, visualPrompt, negativePrompt, referenceSubjectKeys, protectedAreas。prompt 描述单一瞬间、构图、镜头和状态；必须明确 no text、no speech balloons、no watermark，文字由本地排字层完成。',
    'visual-continuity-review': '当前聊天通道不传图片像素：只审查目标页面所选媒资的角色状态合同、参考图实际传输、权利、provider 回执与 Blob 元数据，不得声称看见了人物外观、构图或光线。输出 issue 数组，严格含 stableKey, category, severity, pageKey, panelKey, subjectKey, assetKey, evidence, problem, suggestion, sourceUnitKeys；category 仅 continuity/rights/media-integrity，无机器证据问题输出 []。像素层视觉判断由作者查看实际成图后另行确认。',
    'targeted-repair': '只为一个目标格及所选开放问题编译修复请求。严格含 panelKey, expectedPanelRevision, visualPrompt, negativePrompt, referenceSubjectKeys, protectedAreas, issueKeys, preserveSubjectKeys, repairMode。当前 provider 未登记 edit/inpaint 时 repairMode 必须为 full-regenerate。',
    'page-review': '只做目标页的叙事、阅读顺序和排字审查。输出 issue 数组，字段同视觉审查；category 仅 narrative/reading-order/lettering，无问题输出 []。',
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
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 48_000, maxOutputTokens: skill.maxOutputTokens, maxAttemptsPerStep: 1, maxProtocolErrors: 0 },
    acceptance: [{ id: `${stepId}.candidate`, kind: 'output-present' as const, required: true }, { id: `${stepId}.author`, kind: 'author-confirmed' as const, required: true }, { id: `${stepId}.post-state`, kind: 'post-state-matches' as const, required: true }],
    verificationPlan: [{ id: `${stepId}.terminal`, kind: 'terminal' as const, verifier: `comic-${stage}-terminal-v1`, criterionIds: [`${stepId}.candidate`, `${stepId}.author`, `${stepId}.post-state`] }],
    failurePolicy: { onProtocolError: 'fail' as const, onVerificationFailure: 'fail' as const, onStaleInput: 'pause-for-author' as const },
  }
}
async function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: any) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence } as any)
}

export async function generateComicProfessionalCandidateV1(input: { scope: WorkspaceScope; adaptationProjectId: number; stage: ComicProfessionalStageV1; sourceUnitKeys?: string[]; targetPageKeys?: string[]; targetPanelKeys?: string[]; targetIssueKeys?: string[]; authorInstruction?: string; aiConfig?: AIConfig; runAI?: (messages: ChatMessage[]) => Promise<string> }): Promise<{ snapshot: AgentRunSnapshotV1; candidate: ComicProfessionalCandidateV1 }> {
  if (!input.aiConfig && !input.runAI) throw new Error('[comic-run] 缺少 AI 配置')
  const selected = await selectTargets(input); if ((await inspectAdaptationFreshness(selected.root.id!)).status !== 'unchanged') throw new Error('[comic-run] 来源已变化或缺失，请先同步')
  const key = [selected.root.id!, selected.root.activeSourceManifestVersion] as [number, number]
  const [facts, edges, decisions, beats, plans, pages, subjects] = await Promise.all([
    db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').count(),
    db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').count(),
    db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).filter(row => row.authorStatus === 'confirmed').count(),
    db.comicScriptBeats.where('[adaptationProjectId+manifestVersion]').equals(key).count(), db.comicPagePlans.where('[adaptationProjectId+manifestVersion]').equals(key).count(),
    db.comicPages.where('adaptationProjectId').equals(selected.root.id!).count(), db.comicVisualSubjects.where('adaptationProjectId').equals(selected.root.id!).count(),
  ])
  requireStage(input.stage, selected.root, { facts, edges, decisions, beats, plans, pages, subjects }, { pages: selected.targetPages.length, panels: selected.targetPanels.length, issues: selected.targetIssues.length })
  const config = STAGES[input.stage]; const skill = getAgentSkillV1(config.skillId); const stepId = `comic-professional:${input.stage}`
  let snapshot = await createAgentRunV1({ scope: input.scope, worldGroupId: null, contract: runContract(input.scope, input.stage) })
  snapshot = await append(input.scope, snapshot, 'step.scheduled', { stepId }); snapshot = await append(input.scope, snapshot, 'step.started', { stepId, attempt: 1 })
  const inferredTargetPages = selected.targetPages.length ? selected.targetPages : selected.targetPanels.length ? selected.pages.filter(page => selected.targetPanels.some(panel => panel.pageId === page.id)) : ['visual-bible', 'image-request', 'visual-continuity-review', 'targeted-repair', 'page-review'].includes(input.stage) ? selected.pages : []
  const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope, sourceKeys: [...skill.contextSourceKeys], adaptationProjectId: selected.root.id!, adaptationSourceManifestVersion: selected.root.activeSourceManifestVersion, adaptationSourceUnitKeys: selected.sourceUnitKeys, comicPageIds: inferredTargetPages.flatMap(row => row.id == null ? [] : [row.id]), provider: input.aiConfig?.provider, model: input.aiConfig?.model, inputBudgetMaxTokens: 48_000 })
  const contextManifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId, attempt: 1, projectId: input.scope.projectId, worldGroupId: null, declaredSourceKeys: [...skill.contextSourceKeys], assembled, readerVersion: `comic-${input.stage}-context-v1` })
  snapshot = await append(input.scope, snapshot, 'context.assembled', { stepId, attempt: 1, manifestHash: contextManifest.manifestHash })
  const targetKeys = [...selected.targetPages.map(row => row.stableKey), ...selected.targetPanels.map(row => row.stableKey), ...selected.targetIssues.map(row => row.stableKey)]
  const system = [`你是${config.role}。只完成当前职责，不替后续岗位生成或采纳。`, '严格区分来源事实、作者确认决定与提案；不得把新增桥接伪装成原文。', '只输出一个严格 JSON 值，不要 Markdown、解释、注释或代码围栏。稳定引用只用上下文 key，不输出数据库数字 ID。', `目标漫画画像：${JSON.stringify(selected.root.targetSpec)}`, targetKeys.length ? `唯一目标：${targetKeys.join(', ')}` : '', input.authorInstruction?.trim() ? `作者附加要求：${input.authorInstruction.trim()}` : '', `登记上下文：\n${assembled.text}`].filter(Boolean).join('\n\n')
  const messages: ChatMessage[] = [{ role: 'system', content: system }, { role: 'user', content: instructions(input.stage) }]
  snapshot = await append(input.scope, snapshot, 'model.requested', { stepId, attempt: 1, bindingHash: await hashCanonicalValue(snapshot.contract.executionBindings?.[0]) })
  let raw: string
  try { raw = await (input.runAI ? input.runAI(messages) : chat(messages, input.aiConfig!, { category: `comic.${input.stage}`, projectId: input.scope.projectId, configOverrides: { maxTokens: skill.maxOutputTokens }, contextOverflowPolicy: 'reject' })) }
  catch (error) { await append(input.scope, snapshot, 'run.paused', { reason: `comic-${input.stage}-model-outcome-unknown`, recoverable: false }); throw error }
  snapshot = await append(input.scope, snapshot, 'model.responded', { stepId, attempt: 1, outputHash: await hashCanonicalValue({ raw }) })
  let payload: ComicProfessionalPayloadV1
  try { payload = parseComicProfessionalPayloadV1(input.stage, parseJson(raw)) } catch (error) { snapshot = await append(input.scope, snapshot, 'step.failed', { stepId, attempt: 1, code: `comic-${input.stage}-protocol-failed`, retryable: false, category: 'protocol', action: 'fail' }); await append(input.scope, snapshot, 'run.failed', { code: `comic-${input.stage}-protocol-failed`, retryable: false }); throw error }
  const revisionTargets = ['visual-continuity-review', 'page-review'].includes(input.stage) ? selected.panels.filter(panel => selected.targetPages.some(page => page.id === panel.pageId)) : selected.targetPanels
  const body = { version: 1 as const, kind: 'comic-professional-candidate' as const, portable: false as const, stage: input.stage, projectId: input.scope.projectId, worldId: input.scope.worldId, workId: input.scope.workId, adaptationProjectId: selected.root.id!, adaptationRevision: selected.root.revision, sourceManifestVersion: selected.root.activeSourceManifestVersion, sourceManifestHash: selected.root.activeSourceManifestHash, sourceUnitKeys: selected.sourceUnitKeys, targetPageKeys: selected.targetPages.map(row => row.stableKey), targetPanelKeys: revisionTargets.map(row => row.stableKey), targetIssueKeys: selected.targetIssues.map(row => row.stableKey), targetPanelRevisions: Object.fromEntries(revisionTargets.map(row => [row.stableKey, row.revision])), contextManifestHash: contextManifest.manifestHash, promptHash: await hashCanonicalValue(messages), modelOutputHash: await hashCanonicalValue({ raw }), payload, payloadHash: await hashCanonicalValue(payload) }
  const candidate = { ...body, candidateHash: await hashCanonicalValue(body) }
  const saved = await createAgentRunCheckpointV1({ scope: input.scope, runId: snapshot.run.id, resumePayload: candidate }); snapshot = saved.snapshot
  snapshot = await append(input.scope, snapshot, 'candidate.persisted', { stepId, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: true })
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
