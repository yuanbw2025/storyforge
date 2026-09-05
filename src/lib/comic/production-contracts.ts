import type {
  ComicImageRequestCandidateV1,
  ComicPagePlanCandidateV1,
  ComicPanelPlanCandidateV1,
  ComicRepairRequestCandidateV1,
  ComicReviewIssueCandidateV1,
  ComicScriptBeatCandidateV1,
  ComicVisualBibleCandidateV1,
} from '../types'
import { assertComicLetteringV1, assertNormalizedFrameV1 } from './contracts'

export const COMIC_SCRIPT_BEAT_KEYS_V1 = ['stableKey', 'sectionKey', 'chapterNumber', 'order', 'narrativeFunction', 'visualAction', 'dialogueIntent', 'emotion', 'causalFactKeys', 'decisionKeys', 'sourceUnitKeys', 'estimatedPanels'] as const
export const COMIC_PAGE_PLAN_KEYS_V1 = ['stableKey', 'chapterNumber', 'pageNumber', 'order', 'goal', 'beatKeys', 'endReveal', 'pageTurn', 'expectedPanelCount', 'textBudget'] as const
export const COMIC_PANEL_PLAN_KEYS_V1 = ['pagePlanKey', 'stableKey', 'order', 'nextPanelKey', 'frame', 'narrativeFunction', 'moment', 'shot', 'subjectStates', 'protectedAreas', 'continuityRefs', 'lettering', 'sourceUnitKeys'] as const
export const COMIC_REVIEW_ISSUE_KEYS_V1 = ['stableKey', 'category', 'severity', 'pageKey', 'panelKey', 'subjectKey', 'assetKey', 'evidence', 'problem', 'suggestion', 'sourceUnitKeys'] as const
export const COMIC_IMAGE_REQUEST_KEYS_V1 = ['panelKey', 'expectedPanelRevision', 'visualPrompt', 'negativePrompt', 'referenceSubjectKeys', 'protectedAreas'] as const

const STABLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/
const FUNCTIONS = ['establish', 'develop', 'reveal', 'reaction', 'turn', 'climax', 'resolution', 'transition']

function exact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[comic-production] ${label} 必须是对象`)
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`[comic-production] ${label} 字段不在闭集`)
}

function text(value: unknown, label: string, max = 8_000, required = true): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`[comic-production] ${label} 非法`)
}

function key(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !STABLE.test(value)) throw new Error(`[comic-production] ${label} stableKey 非法`)
}

function keys(value: unknown, label: string, allowEmpty = false): asserts value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 500 || new Set(value).size !== value.length || value.some(item => typeof item !== 'string' || !STABLE.test(item))) throw new Error(`[comic-production] ${label} 引用非法`)
}

function strings(value: unknown, label: string, allowEmpty = false): asserts value is string[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 500 || value.some(item => typeof item !== 'string' || item.length > 2_000)) throw new Error(`[comic-production] ${label} 字符串数组非法`)
}

export function assertComicCandidateBatchV1<T>(value: unknown, verify: (row: unknown) => asserts row is T, label: string, max: number, allowEmpty = false): asserts value is T[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > max) throw new Error(`[comic-production] ${label} 批次长度非法`)
  value.forEach(verify)
  const stable = value.flatMap((item: any) => typeof item?.stableKey === 'string' ? [item.stableKey] : [])
  if (stable.length && new Set(stable).size !== stable.length) throw new Error(`[comic-production] ${label} stableKey 重复`)
}

export function assertComicScriptBeatCandidateV1(value: unknown): asserts value is ComicScriptBeatCandidateV1 {
  exact(value, COMIC_SCRIPT_BEAT_KEYS_V1, 'script beat')
  key(value.stableKey, 'script beat'); key(value.sectionKey, 'sectionKey')
  if (!Number.isInteger(value.chapterNumber) || value.chapterNumber < 1 || !Number.isInteger(value.order) || value.order < 0 || !Number.isInteger(value.estimatedPanels) || value.estimatedPanels < 1 || value.estimatedPanels > 30 || !FUNCTIONS.includes(value.narrativeFunction)) throw new Error('[comic-production] script beat 数值或叙事功能非法')
  text(value.visualAction, 'visualAction'); text(value.dialogueIntent, 'dialogueIntent', 4_000, false); text(value.emotion, 'emotion', 1_000)
  keys(value.causalFactKeys, 'causalFactKeys'); keys(value.decisionKeys, 'decisionKeys'); keys(value.sourceUnitKeys, 'sourceUnitKeys')
}

export function assertComicPagePlanCandidateV1(value: unknown): asserts value is ComicPagePlanCandidateV1 {
  exact(value, COMIC_PAGE_PLAN_KEYS_V1, 'page plan'); key(value.stableKey, 'page plan')
  if (!Number.isInteger(value.chapterNumber) || value.chapterNumber < 1 || !Number.isInteger(value.pageNumber) || value.pageNumber < 1 || !Number.isInteger(value.order) || value.order < 0 || !Number.isInteger(value.expectedPanelCount) || value.expectedPanelCount < 1 || value.expectedPanelCount > 9 || !Number.isInteger(value.textBudget) || value.textBudget < 0 || value.textBudget > 2_000 || !['none', 'setup', 'reveal-after-turn', 'cliffhanger'].includes(value.pageTurn)) throw new Error('[comic-production] page plan 数值或翻页策略非法')
  text(value.goal, 'page goal'); text(value.endReveal, 'end reveal', 4_000, false); keys(value.beatKeys, 'beatKeys')
}

export function assertComicPanelPlanCandidateV1(value: unknown): asserts value is ComicPanelPlanCandidateV1 {
  exact(value, COMIC_PANEL_PLAN_KEYS_V1, 'panel plan'); key(value.pagePlanKey, 'pagePlanKey'); key(value.stableKey, 'panel')
  if (value.nextPanelKey != null) key(value.nextPanelKey, 'nextPanelKey')
  if (!Number.isInteger(value.order) || value.order < 0 || !value.shot || !['extreme-wide', 'wide', 'full', 'medium', 'close-up', 'extreme-close-up', 'insert'].includes(value.shot.size) || !['eye-level', 'high', 'low', 'overhead', 'dutch'].includes(value.shot.angle) || !['static', 'pan', 'tilt', 'track', 'zoom', 'handheld'].includes(value.shot.movement)) throw new Error('[comic-production] panel 顺序或镜头非法')
  assertNormalizedFrameV1(value.frame, `${value.stableKey}.frame`, .04); text(value.shot.composition, 'composition', 2_000, false); text(value.narrativeFunction, 'narrativeFunction', 1_000); text(value.moment, 'moment')
  if (!Array.isArray(value.subjectStates) || value.subjectStates.length > 100) throw new Error('[comic-production] subjectStates 非法')
  const subjectKeys = new Set<string>()
  for (const state of value.subjectStates) {
    exact(state, ['subjectKey', 'costume', 'condition', 'props', 'position'], 'subject state'); key(state.subjectKey, 'subjectKey')
    if (subjectKeys.has(state.subjectKey)) throw new Error('[comic-production] subject state 重复')
    subjectKeys.add(state.subjectKey); text(state.costume, 'costume', 2_000, false); text(state.condition, 'condition', 2_000, false); strings(state.props, 'props', true); text(state.position, 'position', 2_000, false)
  }
  if (!Array.isArray(value.protectedAreas) || value.protectedAreas.length > 20) throw new Error('[comic-production] protectedAreas 非法')
  value.protectedAreas.forEach((frame, index) => assertNormalizedFrameV1(frame, `protectedAreas[${index}]`, .01))
  if (!Array.isArray(value.continuityRefs) || value.continuityRefs.length > 100 || new Set(value.continuityRefs.map((ref: any) => ref?.subjectKey)).size !== value.continuityRefs.length) throw new Error('[comic-production] continuityRefs 非法')
  value.continuityRefs.forEach((ref: any) => { exact(ref, ['subjectKey', 'note'], 'continuity ref'); key(ref.subjectKey, 'continuity ref'); text(ref.note, 'continuity note', 2_000, false) })
  assertComicLetteringV1(value.lettering); keys(value.sourceUnitKeys, 'sourceUnitKeys')
}

export function assertComicVisualBibleCandidateV1(value: unknown): asserts value is ComicVisualBibleCandidateV1 {
  exact(value, ['global', 'subjects'], 'visual bible')
  exact(value.global, ['version', 'artDirection', 'linework', 'palette', 'lighting', 'periodAndMaterials', 'cameraLanguage', 'prohibitedDepictions'], 'global visual bible')
  if (value.global.version !== 1) throw new Error('[comic-production] visual bible version 非法')
  for (const field of ['artDirection', 'linework', 'lighting', 'periodAndMaterials'] as const) text(value.global[field], field)
  for (const field of ['palette', 'cameraLanguage', 'prohibitedDepictions'] as const) strings(value.global[field], field, field === 'prohibitedDepictions')
  if (!Array.isArray(value.subjects) || !value.subjects.length || value.subjects.length > 200) throw new Error('[comic-production] visual subjects 批次非法')
  const seen = new Set<string>()
  for (const subject of value.subjects) {
    exact(subject, ['stableKey', 'kind', 'label', 'design', 'sourceUnitKeys'], 'visual subject'); key(subject.stableKey, 'visual subject')
    if (seen.has(subject.stableKey) || !['character', 'location', 'prop', 'style'].includes(subject.kind)) throw new Error('[comic-production] visual subject 重复或 kind 非法')
    seen.add(subject.stableKey); text(subject.label, 'subject label', 500); keys(subject.sourceUnitKeys, 'subject sourceUnitKeys')
    exact(subject.design, ['description', 'silhouette', 'facialFeatures', 'hairAndCostume', 'palette', 'materials', 'distinguishingMarks', 'prohibitedChanges'], 'subject design')
    for (const field of ['description', 'silhouette', 'facialFeatures', 'hairAndCostume'] as const) text(subject.design[field], field, 8_000, false)
    for (const field of ['palette', 'materials', 'distinguishingMarks', 'prohibitedChanges'] as const) strings(subject.design[field], field, true)
  }
}

export function assertComicImageRequestCandidateV1(value: unknown): asserts value is ComicImageRequestCandidateV1 {
  exact(value, COMIC_IMAGE_REQUEST_KEYS_V1, 'image request'); key(value.panelKey, 'panelKey')
  if (!Number.isInteger(value.expectedPanelRevision) || value.expectedPanelRevision < 1) throw new Error('[comic-production] image request revision 非法')
  text(value.visualPrompt, 'visualPrompt'); text(value.negativePrompt, 'negativePrompt', 4_000)
  const lower = `${value.visualPrompt} ${value.negativePrompt}`.toLowerCase()
  if (!lower.includes('no text') || !lower.includes('no speech') || !lower.includes('no watermark')) throw new Error('[comic-production] 图片请求必须明确禁止文字、气泡和水印')
  keys(value.referenceSubjectKeys, 'referenceSubjectKeys', true)
  if (!Array.isArray(value.protectedAreas) || value.protectedAreas.length > 20) throw new Error('[comic-production] protectedAreas 非法')
  value.protectedAreas.forEach((frame, index) => assertNormalizedFrameV1(frame, `protectedAreas[${index}]`, .01))
}

export function assertComicReviewIssueCandidateV1(value: unknown): asserts value is ComicReviewIssueCandidateV1 {
  exact(value, COMIC_REVIEW_ISSUE_KEYS_V1, 'review issue'); key(value.stableKey, 'review issue'); key(value.pageKey, 'pageKey')
  for (const field of ['panelKey', 'subjectKey', 'assetKey'] as const) if (value[field] != null) key(value[field], field)
  if (!['narrative', 'reading-order', 'lettering', 'continuity', 'rights', 'media-integrity'].includes(value.category) || !['critical', 'major', 'minor'].includes(value.severity)) throw new Error('[comic-production] review issue 分类非法')
  text(value.evidence, 'evidence'); text(value.problem, 'problem'); text(value.suggestion, 'suggestion'); keys(value.sourceUnitKeys, 'sourceUnitKeys', true)
}

export function assertComicRepairRequestCandidateV1(value: unknown): asserts value is ComicRepairRequestCandidateV1 {
  exact(value, [...COMIC_IMAGE_REQUEST_KEYS_V1, 'issueKeys', 'preserveSubjectKeys', 'repairMode'], 'repair request')
  const base = Object.fromEntries(COMIC_IMAGE_REQUEST_KEYS_V1.map(field => [field, value[field]]))
  assertComicImageRequestCandidateV1(base)
  keys(value.issueKeys, 'issueKeys'); keys(value.preserveSubjectKeys, 'preserveSubjectKeys', true)
  if (!['inpaint', 'image-edit', 'full-regenerate'].includes(value.repairMode)) throw new Error('[comic-production] repairMode 非法')
}
