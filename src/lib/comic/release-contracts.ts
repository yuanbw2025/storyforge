import type { ComicReleaseManifestV1 } from '../types'
import { assertAdaptationBriefV1, assertComicTargetSpecV1 } from '../adaptation/contracts'
import { assertComicPagePlanCandidateV1, assertComicScriptBeatCandidateV1 } from './production-contracts'

const STABLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
function exact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[comic-release] ${label} 必须是对象`)
  const actual = Object.keys(value); if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`[comic-release] ${label} 字段不在闭集`)
}
function rows(value: unknown, label: string): asserts value is any[] { if (!Array.isArray(value)) throw new Error(`[comic-release] ${label} 必须是数组`) }
function unique(rowsValue: any[], label: string): Set<string> {
  const keys = rowsValue.map(row => row?.stableKey); if (keys.some(key => typeof key !== 'string' || !STABLE.test(key)) || new Set(keys).size !== keys.length) throw new Error(`[comic-release] ${label} stableKey 非法或重复`); return new Set(keys)
}
function rejectLocalIds(value: unknown, path = 'manifest'): void {
  if (Array.isArray(value)) return value.forEach((row, index) => rejectLocalIds(row, `${path}[${index}]`))
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) { if (/^(projectId|worldId|workId|adaptationProjectId|pageId|panelId|sourceUnitIds|blobObjectId|characterId)$/.test(key)) throw new Error(`[comic-release] 不得包含本地 ID：${path}.${key}`); rejectLocalIds(child, `${path}.${key}`) }
}

export function assertComicReleaseManifestV1(value: unknown, expectedWorkCode: string, expectedSourceRevision: number): asserts value is ComicReleaseManifestV1 {
  exact(value, ['schema', 'version', 'productKind', 'tier', 'work', 'adaptation', 'sourceUnits', 'facts', 'causalEdges', 'decisions', 'scriptBeats', 'pagePlans', 'pages', 'visualBible', 'visualSubjects', 'reviewIssues', 'assets', 'verification', 'createdAt'], 'manifest')
  if (value.schema !== 'storyforge.comic-release' || value.version !== 1 || value.productKind !== 'comic' || !['storyboard', 'visual'].includes(value.tier)) throw new Error('[comic-release] manifest 身份非法')
  exact(value.work, ['code', 'title', 'description', 'genres'], 'work'); if (value.work.code !== expectedWorkCode || typeof value.work.title !== 'string' || typeof value.work.description !== 'string' || !Array.isArray(value.work.genres)) throw new Error('[comic-release] Work 身份非法')
  exact(value.adaptation, ['revision', 'targetSpec', 'brief', 'sourceManifestVersion', 'sourceManifestHash'], 'adaptation')
  if (value.adaptation.revision !== expectedSourceRevision || !Number.isInteger(value.adaptation.sourceManifestVersion) || value.adaptation.sourceManifestVersion < 1 || !/^[a-f0-9]{64}$/i.test(value.adaptation.sourceManifestHash)) throw new Error('[comic-release] 改编版本非法')
  assertComicTargetSpecV1(value.adaptation.targetSpec); assertAdaptationBriefV1(value.adaptation.brief)
  for (const key of ['sourceUnits', 'facts', 'causalEdges', 'decisions', 'scriptBeats', 'pagePlans', 'pages', 'visualSubjects', 'reviewIssues', 'assets'] as const) rows(value[key], key)
  const sourceKeys = new Set<string>(); for (const unit of value.sourceUnits) { exact(unit, ['sourceUnitKey', 'label', 'order', 'contentHash', 'wordCount'], 'sourceUnit'); if (!/^asu_[A-Za-z0-9_-]{8,64}$/.test(unit.sourceUnitKey) || sourceKeys.has(unit.sourceUnitKey) || !/^[a-f0-9]{64}$/i.test(unit.contentHash)) throw new Error('[comic-release] 来源单元非法或重复'); sourceKeys.add(unit.sourceUnitKey) }
  const factKeys = unique(value.facts, 'facts'); const decisionKeys = unique(value.decisions, 'decisions'); const beatKeys = unique(value.scriptBeats, 'scriptBeats'); const planKeys = unique(value.pagePlans, 'pagePlans'); const pageKeys = unique(value.pages, 'pages'); unique(value.causalEdges, 'causalEdges'); const subjectKeys = unique(value.visualSubjects, 'visualSubjects'); unique(value.reviewIssues, 'reviewIssues')
  for (const beat of value.scriptBeats) { assertComicScriptBeatCandidateV1({ stableKey: beat.stableKey, sectionKey: beat.sectionKey, chapterNumber: beat.chapterNumber, order: beat.order, narrativeFunction: beat.narrativeFunction, visualAction: beat.visualAction, dialogueIntent: beat.dialogueIntent, emotion: beat.emotion, causalFactKeys: beat.causalFactKeys, decisionKeys: beat.decisionKeys, sourceUnitKeys: beat.sourceUnitKeys, estimatedPanels: beat.estimatedPanels }); if (beat.causalFactKeys.some((key: string) => !factKeys.has(key)) || beat.decisionKeys.some((key: string) => !decisionKeys.has(key)) || beat.sourceUnitKeys.some((key: string) => !sourceKeys.has(key))) throw new Error('[comic-release] ScriptBeat 引用越界') }
  for (const plan of value.pagePlans) { assertComicPagePlanCandidateV1({ stableKey: plan.stableKey, chapterNumber: plan.chapterNumber, pageNumber: plan.pageNumber, order: plan.order, goal: plan.goal, beatKeys: plan.beatKeys, endReveal: plan.endReveal, pageTurn: plan.pageTurn, expectedPanelCount: plan.expectedPanelCount, textBudget: plan.textBudget }); if (plan.beatKeys.some((key: string) => !beatKeys.has(key))) throw new Error('[comic-release] PagePlan 引用越界') }
  const panelKeys = new Set<string>(); for (const page of value.pages) { if (!planKeys.has(page.pagePlanKey) || !Array.isArray(page.panels) || page.panels.length === 0) throw new Error('[comic-release] 页面计划或格非法'); for (const panel of page.panels) { if (!STABLE.test(panel.stableKey) || panelKeys.has(panel.stableKey)) throw new Error('[comic-release] panel stableKey 非法或重复'); panelKeys.add(panel.stableKey); if (!Array.isArray(panel.sourceUnitKeys) || panel.sourceUnitKeys.some((key: string) => !sourceKeys.has(key)) || !Array.isArray(panel.continuityRefs) || panel.continuityRefs.some((ref: any) => !subjectKeys.has(ref.subjectKey))) throw new Error('[comic-release] panel 引用越界') } }
  if (pageKeys.size !== value.adaptation.targetSpec.chapterCount * value.adaptation.targetSpec.targetPagesPerChapter) throw new Error('[comic-release] 页面没有覆盖目标规格')
  if (!value.visualBible || value.visualBible.version !== 1) throw new Error('[comic-release] 缺少视觉圣经')
  if (value.tier === 'storyboard' && value.assets.length) throw new Error('[comic-release] 分镜版不得伪装包含视觉成品')
  if (value.tier === 'visual') { const assetKeys = unique(value.assets, 'assets'); const panelAssetKeys = new Set(value.assets.flatMap((asset: any) => asset.panelKey ? [asset.panelKey] : [])); if (assetKeys.size < panelKeys.size || panelAssetKeys.size !== panelKeys.size || [...panelKeys].some(key => !panelAssetKeys.has(key)) || value.assets.some((asset: any) => (asset.panelKey != null && !panelKeys.has(asset.panelKey)) || !/^[a-f0-9]{64}$/i.test(asset.contentHash))) throw new Error('[comic-release] 视觉版必须为每格冻结一个可校验 Blob，并可附带 Subject 参考资产') }
  exact(value.verification, ['blockers', 'warnings', 'reviewedAt'], 'verification'); if (!Array.isArray(value.verification.blockers) || value.verification.blockers.length || !Array.isArray(value.verification.warnings) || !Number.isInteger(value.verification.reviewedAt) || value.verification.reviewedAt !== value.createdAt) throw new Error('[comic-release] verification 非法')
  rejectLocalIds(value)
}
