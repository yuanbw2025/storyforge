import type {
  AdaptationBriefV1,
  AdaptationCausalEdgeV1,
  AdaptationDecisionV1,
  AdaptationPlanV1,
  AdaptationProject,
  AdaptationSourceFactV1,
  ComicTargetSpecV1,
  ComicGlobalVisualBibleV1,
  MotionDramaTargetSpecV1,
  ScreenplayTargetSpecV1,
  Work,
} from '../types'
import { effectiveWorkKind } from '../workspace/work-kind'

const MAX_BRIEF_BYTES = 64_000
const MAX_PLAN_BYTES = 128_000
const STABLE_KEY = /^[a-z0-9][a-z0-9._-]{0,95}$/i

function assertText(value: unknown, label: string, max = 4_000): asserts value is string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`[adaptation] ${label} 必须是至多 ${max} 字符的文本`)
}

function assertTextArray(value: unknown, label: string, maxItems = 200): asserts value is string[] {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`[adaptation] ${label} 必须是至多 ${maxItems} 项的文本数组`)
  value.forEach((item, index) => assertText(item, `${label}[${index}]`, 2_000))
}

function assertExactKeys(value: unknown, label: string, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[adaptation] ${label} 必须是对象`)
  const keys = Object.keys(value)
  const unknown = keys.filter(key => !allowed.includes(key))
  const missing = allowed.filter(key => key !== 'id' && !keys.includes(key))
  if (unknown.length) throw new Error(`[adaptation] ${label} 含未知字段：${unknown.join('、')}`)
  if (missing.length) throw new Error(`[adaptation] ${label} 缺少字段：${missing.join('、')}`)
}

function assertStableKey(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !STABLE_KEY.test(value)) throw new Error(`[adaptation] ${label} stableKey 非法`)
}

function assertUniquePortableKeys(value: unknown, label: string, allowEmpty = true): asserts value is string[] {
  assertTextArray(value, label, 500)
  if (!allowEmpty && value.length === 0) throw new Error(`[adaptation] ${label} 不得为空`)
  if (value.some(item => !STABLE_KEY.test(item))) throw new Error(`[adaptation] ${label} 含非法稳定 key`)
  if (new Set(value).size !== value.length) throw new Error(`[adaptation] ${label} 含重复项`)
}

const SHARED_ANALYSIS_KEYS = [
  'id', 'projectId', 'workId', 'adaptationProjectId', 'manifestVersion',
  'stableKey', 'authorStatus', 'createdAt', 'updatedAt',
] as const

function assertSharedAnalysisEnvelope(
  value: Record<string, unknown>,
  label: string,
): void {
  for (const key of ['projectId', 'workId', 'adaptationProjectId', 'manifestVersion', 'createdAt', 'updatedAt'] as const) {
    if (!Number.isInteger(value[key]) || Number(value[key]) <= 0) throw new Error(`[adaptation] ${label}.${key} 必须为正整数`)
  }
  if (value.id != null && (!Number.isInteger(value.id) || Number(value.id) <= 0)) throw new Error(`[adaptation] ${label}.id 非法`)
  assertStableKey(value.stableKey, `${label}.stableKey`)
  if (value.authorStatus !== 'confirmed' && value.authorStatus !== 'rejected') throw new Error(`[adaptation] ${label}.authorStatus 非法`)
}

export function assertAdaptationSourceFactV1(value: unknown): asserts value is AdaptationSourceFactV1 {
  assertExactKeys(value, 'SourceFact', [...SHARED_ANALYSIS_KEYS, 'kind', 'statement', 'subjectKeys', 'sourceUnitKeys', 'confidence'])
  assertSharedAnalysisEnvelope(value, 'SourceFact')
  if (!['event', 'character-state', 'relationship', 'location', 'object', 'motif'].includes(String(value.kind))) {
    throw new Error('[adaptation] SourceFact.kind 非法')
  }
  assertText(value.statement, 'SourceFact.statement', 8_000)
  if (!value.statement.trim()) throw new Error('[adaptation] SourceFact.statement 不得为空')
  assertUniquePortableKeys(value.subjectKeys, 'SourceFact.subjectKeys')
  assertUniquePortableKeys(value.sourceUnitKeys, 'SourceFact.sourceUnitKeys', false)
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new Error('[adaptation] SourceFact.confidence 必须在 0～1')
  }
}

export function assertAdaptationCausalEdgeV1(value: unknown): asserts value is AdaptationCausalEdgeV1 {
  assertExactKeys(value, 'CausalEdge', [...SHARED_ANALYSIS_KEYS, 'fromFactKey', 'toFactKey', 'relation', 'rationale', 'sourceUnitKeys'])
  assertSharedAnalysisEnvelope(value, 'CausalEdge')
  assertStableKey(value.fromFactKey, 'CausalEdge.fromFactKey')
  assertStableKey(value.toFactKey, 'CausalEdge.toFactKey')
  if (value.fromFactKey === value.toFactKey) throw new Error('[adaptation] CausalEdge 不得自环')
  if (!['cause', 'enables', 'motivates', 'reveals', 'prevents'].includes(String(value.relation))) throw new Error('[adaptation] CausalEdge.relation 非法')
  assertText(value.rationale, 'CausalEdge.rationale', 8_000)
  if (!value.rationale.trim()) throw new Error('[adaptation] CausalEdge.rationale 不得为空')
  assertUniquePortableKeys(value.sourceUnitKeys, 'CausalEdge.sourceUnitKeys', false)
}

export function assertAdaptationDecisionV1(value: unknown): asserts value is AdaptationDecisionV1 {
  assertExactKeys(value, 'Decision', [...SHARED_ANALYSIS_KEYS, 'action', 'sourceFactKeys', 'targetKeys', 'rationale'])
  assertSharedAnalysisEnvelope(value, 'Decision')
  if (!['keep', 'cut', 'merge', 'reorder', 'externalize', 'add'].includes(String(value.action))) throw new Error('[adaptation] Decision.action 非法')
  assertUniquePortableKeys(value.sourceFactKeys, 'Decision.sourceFactKeys', value.action === 'add')
  assertUniquePortableKeys(value.targetKeys, 'Decision.targetKeys')
  assertText(value.rationale, 'Decision.rationale', 8_000)
  if (!value.rationale.trim()) throw new Error('[adaptation] Decision.rationale 不得为空')
}

function assertPortableStructuredContent(value: unknown, label: string): void {
  const visit = (item: unknown, path: string) => {
    if (Array.isArray(item)) return item.forEach((entry, index) => visit(entry, `${path}[${index}]`))
    if (!item || typeof item !== 'object') return
    for (const [key, entry] of Object.entries(item as Record<string, unknown>)) {
      if (/^(id|projectId|worldId|workId|chapterId|outlineNodeId|characterId)$/i.test(key)) {
        throw new Error(`[adaptation] ${label} 不得嵌入本地 ID：${path}.${key}`)
      }
      visit(entry, `${path}.${key}`)
    }
  }
  visit(value, label)
}

export function assertAdaptationBriefV1(value: AdaptationBriefV1): void {
  if (!value || value.version !== 1) throw new Error('[adaptation] Brief 版本必须为 1')
  for (const [key, field] of Object.entries(value)) {
    if (key === 'version') continue
    if (Array.isArray(field)) assertTextArray(field, `Brief.${key}`)
    else assertText(field, `Brief.${key}`)
  }
  assertPortableStructuredContent(value, 'Brief')
  if (JSON.stringify(value).length > MAX_BRIEF_BYTES) throw new Error('[adaptation] Brief 超过体积上限')
}

export function assertAdaptationPlanV1(value: AdaptationPlanV1): void {
  if (!value || value.version !== 1) throw new Error('[adaptation] Plan 版本必须为 1')
  assertText(value.premise, 'Plan.premise', 8_000)
  assertTextArray(value.globalAssumptions, 'Plan.globalAssumptions')
  if (!Array.isArray(value.sections) || value.sections.length === 0 || value.sections.length > 500) {
    throw new Error('[adaptation] Plan.sections 必须包含 1～500 个结构段')
  }
  const keys = new Set<string>()
  value.sections.forEach((section, index) => {
    if (!section || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(section.stableKey)) throw new Error(`[adaptation] Plan.sections[${index}].stableKey 非法`)
    if (keys.has(section.stableKey)) throw new Error(`[adaptation] Plan stableKey 重复：${section.stableKey}`)
    keys.add(section.stableKey)
    assertText(section.title, `Plan.sections[${index}].title`, 500)
    assertText(section.summary, `Plan.sections[${index}].summary`, 8_000)
    if (!Number.isInteger(section.order) || section.order < 0) throw new Error('[adaptation] Plan section order 非法')
    if (section.episodeNumber != null && (!Number.isInteger(section.episodeNumber) || section.episodeNumber <= 0)) throw new Error('[adaptation] Plan episodeNumber 非法')
    assertTextArray(section.sourceUnitKeys, `Plan.sections[${index}].sourceUnitKeys`, 500)
  })
  assertPortableStructuredContent(value, 'Plan')
  if (JSON.stringify(value).length > MAX_PLAN_BYTES) throw new Error('[adaptation] Plan 超过体积上限')
}

export function assertScreenplayTargetSpecV1(spec: ScreenplayTargetSpecV1): void {
  if (!['film', 'series', 'short-drama'].includes(spec.format)) throw new Error('[adaptation] 不支持的剧本类型')
  if (spec.language !== 'zh-CN') throw new Error('[adaptation] 剧本 V1 仅支持 zh-CN')
  if (spec.format === 'film' ? spec.episodeCount !== null : !Number.isInteger(spec.episodeCount) || (spec.episodeCount ?? 0) <= 0) {
    throw new Error('[adaptation] 电影 episodeCount 必须为空；分集剧本必须为正整数')
  }
  if (!Number.isFinite(spec.targetMinutesPerEpisode) || spec.targetMinutesPerEpisode <= 0 || spec.targetMinutesPerEpisode > 300) {
    throw new Error('[adaptation] 单集目标时长必须在 0～300 分钟之间')
  }
  if (!['low', 'balanced', 'high'].includes(spec.dialogueDensity)) throw new Error('[adaptation] 对白密度非法')
  if (!['contained', 'standard', 'large'].includes(spec.productionScale)) throw new Error('[adaptation] 制作规模非法')
  const formats = new Set(spec.exportDefaults)
  if (formats.size !== spec.exportDefaults.length || [...formats].some(value => !['fountain', 'fdx', 'pdf'].includes(value))) {
    throw new Error('[adaptation] 剧本导出默认值非法或重复')
  }
  Object.entries(spec.titlePage).forEach(([key, value]) => assertText(value, `titlePage.${key}`, 1_000))
}

export function assertComicTargetSpecV1(spec: ComicTargetSpecV1): void {
  if (spec.format !== 'page-comic') throw new Error('[adaptation] 漫画 V1 仅支持 page-comic')
  if (!['ltr', 'rtl'].includes(spec.readingDirection)) throw new Error('[adaptation] 漫画阅读方向非法')
  if (!Number.isInteger(spec.chapterCount) || spec.chapterCount <= 0 || spec.chapterCount > 500) throw new Error('[adaptation] 漫画章节数非法')
  if (!Number.isInteger(spec.targetPagesPerChapter) || spec.targetPagesPerChapter <= 0 || spec.targetPagesPerChapter > 500) throw new Error('[adaptation] 每章目标页数非法')
  if (!Number.isFinite(spec.pageSize.width) || !Number.isFinite(spec.pageSize.height) || spec.pageSize.width <= 0 || spec.pageSize.height <= 0) throw new Error('[adaptation] 漫画页面尺寸非法')
  if (!['px', 'mm'].includes(spec.pageSize.unit) || spec.pageSize.bleed < 0) throw new Error('[adaptation] 漫画页面单位或出血非法')
  if (![2, 3, 4].includes(spec.renderCandidatesPerPanel)) throw new Error('[adaptation] 每格候选数只能是 2、3 或 4')
  if (!['color', 'grayscale', 'monochrome'].includes(spec.colorMode)) throw new Error('[adaptation] 漫画色彩模式非法')
  assertText(spec.audience, 'comic.audience', 1_000)
  assertText(spec.artStyleBrief, 'comic.artStyleBrief', 8_000)
}

export function assertMotionDramaTargetSpecV1(spec: MotionDramaTargetSpecV1): void {
  if (spec.format !== 'motion-drama' || spec.language !== 'zh-CN') throw new Error('[adaptation] 漫剧 V1 仅支持 zh-CN motion-drama')
  if (!Number.isInteger(spec.episodeCount) || spec.episodeCount < 1 || spec.episodeCount > 200) throw new Error('[adaptation] 漫剧集数必须是 1～200 的整数')
  if (!Number.isInteger(spec.targetSecondsPerEpisode) || spec.targetSecondsPerEpisode < 15 || spec.targetSecondsPerEpisode > 600) throw new Error('[adaptation] 漫剧单集时长必须是 15～600 秒的整数')
  if (!['9:16', '16:9', '1:1'].includes(spec.aspectRatio)) throw new Error('[adaptation] 漫剧画幅非法')
  if (!['animated-comic', 'illustrated-motion', 'hybrid'].includes(spec.narrativeMode)) throw new Error('[adaptation] 漫剧叙事模式非法')
  if (!['low', 'balanced', 'high'].includes(spec.dialogueDensity)) throw new Error('[adaptation] 漫剧对白密度非法')
  if (!Array.isArray(spec.providerTargets) || !spec.providerTargets.length || new Set(spec.providerTargets).size !== spec.providerTargets.length || spec.providerTargets.some(value => !['seedance', 'runway', 'ltx', 'generic'].includes(value))) throw new Error('[adaptation] 漫剧目标工具非法或重复')
  assertText(spec.audience, 'motionDrama.audience', 1_000)
  assertText(spec.rating, 'motionDrama.rating', 200)
  assertText(spec.artDirection, 'motionDrama.artDirection', 8_000)
}

export function assertComicGlobalVisualBibleV1(value: ComicGlobalVisualBibleV1): void {
  if (!value || value.version !== 1) throw new Error('[adaptation] 漫画视觉圣经版本非法')
  assertText(value.artDirection, 'visualBible.artDirection', 8_000)
  assertText(value.linework, 'visualBible.linework', 4_000)
  assertText(value.lighting, 'visualBible.lighting', 4_000)
  assertText(value.periodAndMaterials, 'visualBible.periodAndMaterials', 4_000)
  for (const [label, values] of [['palette', value.palette], ['cameraLanguage', value.cameraLanguage], ['prohibitedDepictions', value.prohibitedDepictions]] as const) {
    if (!Array.isArray(values) || values.length > 100 || values.some(item => typeof item !== 'string' || !item.trim() || item.length > 1_000)) throw new Error(`[adaptation] visualBible.${label} 非法`)
  }
}

export function assertAdaptationProjectInvariant(root: AdaptationProject, targetWork?: Work, sourceWork?: Work | null): void {
  if (root.medium === 'screenplay') assertScreenplayTargetSpecV1(root.targetSpec)
  else if (root.medium === 'comic') assertComicTargetSpecV1(root.targetSpec)
  else assertMotionDramaTargetSpecV1(root.targetSpec)
  if (!Number.isInteger(root.activeSourceManifestVersion) || root.activeSourceManifestVersion <= 0) throw new Error('[adaptation] active manifest 版本非法')
  if (!/^[a-f0-9]{64}$/i.test(root.activeSourceManifestHash)) throw new Error('[adaptation] manifest hash 非法')
  if (!Number.isInteger(root.revision) || root.revision <= 0) throw new Error('[adaptation] revision 非法')
  if (root.lineageMode === 'linked' && root.sourceWorkId == null && sourceWork !== null) throw new Error('[adaptation] linked 改编创建时必须有来源 Work')
  if (root.lineageMode === 'detached' && (root.sourceWorkId != null || root.sourceOutlineRootId != null || root.sourceStartChapterId != null || root.sourceEndChapterId != null)) {
    throw new Error('[adaptation] detached 改编不得保留本地来源引用')
  }
  if (root.sourceSelectionMode === 'entire-work' || root.sourceSelectionMode === 'chapters') {
    if (root.sourceOutlineRootId != null || root.sourceStartChapterId != null || root.sourceEndChapterId != null) throw new Error('[adaptation] 来源选择字段组合非法')
  } else if (root.sourceSelectionMode === 'outline-subtree') {
    if (root.lineageMode === 'linked' && root.sourceWorkId != null && root.sourceOutlineRootId == null) throw new Error('[adaptation] outline-subtree 缺少根节点')
    if (root.sourceStartChapterId != null || root.sourceEndChapterId != null) throw new Error('[adaptation] outline-subtree 来源字段冲突')
  } else if (root.sourceSelectionMode === 'chapter-range') {
    const missingEndpoint = root.sourceStartChapterId == null || root.sourceEndChapterId == null
    if (root.lineageMode === 'linked' && root.sourceWorkId != null && missingEndpoint) throw new Error('[adaptation] chapter-range 缺少起止章节')
    if (root.sourceOutlineRootId != null) throw new Error('[adaptation] chapter-range 来源字段冲突')
  } else {
    throw new Error('[adaptation] 未知来源选择模式')
  }
  if (root.brief) assertAdaptationBriefV1(root.brief)
  if (root.plan) assertAdaptationPlanV1(root.plan)
  if (targetWork && (targetWork.id !== root.workId || effectiveWorkKind(targetWork) !== root.medium)) throw new Error('[adaptation] medium 与目标 Work kind 不匹配')
  if (sourceWork && (sourceWork.id !== root.sourceWorkId || effectiveWorkKind(sourceWork) !== 'novel')) throw new Error('[adaptation] 来源 Work 必须是小说')
}
