import { parseChatAuthoringSettingsV1, type ChatAuthoringSettingsV1 } from '../character-interaction/authoring-contract'
import { parseAvgAuthoringSettingsV1, type AvgAuthoringSettingsV1 } from '../avg/authoring-contract'
import type {
  ProductionProductKindV1,
  ProductProductionBriefV3,
  ProductProductionMediaProfileV1,
  ProductProductionScaleV1,
  ProductProductionSourceOptionsV1,
  ProductProductionSourceSelectionV1,
  ProductStartingPointSuggestionV1,
  ProductWorldSourceSelectionV1,
  WorkspaceScope,
  AiTownBriefSettingsV1,
} from '../types'
import { resolveScope } from '../workspace/scope'
import { compileUpperProductWorldRoleBindingsV1 } from '../product/world-requirement-adapters'
import { hashProductProductionValueV2 } from './hash'
import { parseProductProductionBriefV3 } from './contracts'
import { freezeAiTownWorldSourceSelectionV1, loadAiTownWorldSourceCatalogV1 } from '../ai-town/world-source'
import {
  loadProductProductionConsultationSourceV2,
  type ProductProductionConsultationSourceV2,
} from './world-source'
import {
  compileTtrpgProductionBriefV2,
  type TtrpgProductionBriefDraftInputV2,
  unresolvedTtrpgProductionBriefDecisionsV2,
} from '../ttrpg/production-brief'
import {
  compileTextAdventureProductionBriefV1,
  minimumTextAdventureCommercialImageCountV1,
  type TextAdventureProductionBriefDraftV1,
  unresolvedTextAdventureProductionBriefDecisionsV1,
} from '../adventure/production-brief'
import { DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1 } from '../open-world/product-config'

type ConsultationSourceV1 = ProductProductionConsultationSourceV2

function stableSlug(value: string): string {
  return value.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'option'
}

function sourceRefDiscriminator(sourceRefs: readonly string[]): string {
  return sourceRefs.map(sourceRef => {
    const segments = sourceRef.split(':')
    const coordinateHash = segments[segments.length - 1] ?? sourceRef
    return coordinateHash.replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 32)
  }).filter(Boolean).join('-') || 'source'
}

function suggestion(input: Omit<ProductStartingPointSuggestionV1, 'suggestionKey'>): ProductStartingPointSuggestionV1 {
  // World resource keys share a deliberately long release-hash prefix. Using
  // a prefix-truncated slug here therefore collapsed distinct resources onto
  // the same suggestion key. The final segment is the resource coordinate
  // hash, so it is both portable across ID remaps and unique inside a release.
  const sourceDiscriminator = input.sourceRefs.length ? `:${sourceRefDiscriminator(input.sourceRefs)}` : ''
  return { suggestionKey: `${input.kind}:${stableSlug(input.title)}${sourceDiscriminator}`, ...input }
}

function productFit(kind: ProductStartingPointSuggestionV1['kind']): ProductionProductKindV1[] {
  if (kind === 'character') return ['character-interaction', 'ai-town', 'avg', 'text-adventure', 'ttrpg']
  if (kind === 'history') return ['ai-town', 'text-open-world', 'text-adventure', 'ttrpg']
  if (kind === 'branch') return ['text-adventure', 'text-open-world', 'ttrpg']
  if (kind === 'custom') return ['text-adventure', 'avg', 'text-open-world', 'ttrpg']
  return ['ai-town', 'text-adventure', 'avg', 'ttrpg']
}

export interface ProductConsultationSuggestionSetV1 {
  schema: 'storyforge.product-starting-point-suggestions'
  version: 1
  worldContentHash: string
  suggestions: ProductStartingPointSuggestionV1[]
  sourceOptions: ProductProductionSourceOptionsV1
  selectionDefaults: Record<string, ProductProductionSourceSelectionV1>
  suggestionSetHash: string
}

const SCALE_DEFAULTS: Record<ProductProductionScaleV1['scope'], Omit<ProductProductionScaleV1, 'scope'>> = {
  scene: { targetPlayMinutes: 20, targetWordCount: 3_000, targetEndingCount: 2 },
  'short-arc': { targetPlayMinutes: 60, targetWordCount: 10_000, targetEndingCount: 3 },
  chapter: { targetPlayMinutes: 120, targetWordCount: 20_000, targetEndingCount: 3 },
  'multi-chapter': { targetPlayMinutes: 300, targetWordCount: 50_000, targetEndingCount: 4 },
  campaign: { targetPlayMinutes: 900, targetWordCount: 120_000, targetEndingCount: 5 },
}

/** The chosen starting point must constrain the actual semantic resource set. */
function selectionForStartingPoint(
  source: ConsultationSourceV1,
  selected: ProductStartingPointSuggestionV1,
): ConsultationSourceV1['selectionCatalog'] {
  const refs = new Set([...selected.sourceRefs, ...selected.protagonistRefs])
  const next = structuredClone(source.selectionCatalog)
  const optionFields: Array<[keyof ProductProductionSourceOptionsV1, keyof ProductProductionSourceSelectionV1]> = [
    ['storySources', 'storyResourceKeys'],
    ['characters', 'characterResourceKeys'],
    ['importantLocations', 'importantLocationResourceKeys'],
    ['artifacts', 'artifactResourceKeys'],
    ['codexEntries', 'codexEntryResourceKeys'],
    ['storyArcs', 'storyArcResourceKeys'],
  ]
  for (const [optionField, selectionField] of optionFields) {
    const selectedKeys = source.selectionOptions[optionField]
      .map(option => option.resourceKey).filter(key => refs.has(key))
    if (selectedKeys.length) next[selectionField] = selectedKeys.sort()
  }
  return next
}

const AUTHOR_SELECTION_FIELDS = [
  'storyResourceKeys',
  'characterResourceKeys',
  'importantLocationResourceKeys',
  'artifactResourceKeys',
  'codexEntryResourceKeys',
  'storyArcResourceKeys',
] as const satisfies readonly (keyof ProductProductionSourceSelectionV1)[]

function editableSelection(
  catalog: ConsultationSourceV1['selectionCatalog'],
): ProductProductionSourceSelectionV1 {
  return Object.fromEntries(
    AUTHOR_SELECTION_FIELDS.map(field => [field, [...catalog[field]]]),
  ) as unknown as ProductProductionSourceSelectionV1
}

function normalizeAuthorSelection(input: {
  source: ConsultationSourceV1
  selected: ProductStartingPointSuggestionV1
  authorSelection?: ProductProductionSourceSelectionV1
}): ConsultationSourceV1['selectionCatalog'] {
  const startingSelection = selectionForStartingPoint(input.source, input.selected)
  if (!input.authorSelection) return startingSelection
  const next = structuredClone(startingSelection)
  for (const field of AUTHOR_SELECTION_FIELDS) {
    const submitted = input.authorSelection[field]
    if (!Array.isArray(submitted)) throw new Error(`[product-production] 冻结素材选择缺少 ${field}`)
    if (submitted.some(value => typeof value !== 'string' || !value.startsWith('world-release:'))) {
      throw new Error(`[product-production] 冻结素材选择 ${field} 包含非法世界资源 key`)
    }
    if (new Set(submitted).size !== submitted.length) {
      throw new Error(`[product-production] 冻结素材选择 ${field} 包含重复世界资源 key`)
    }
    const allowed = new Set(input.source.selectionCatalog[field])
    if (submitted.some(value => !allowed.has(value))) {
      throw new Error(`[product-production] 冻结素材选择 ${field} 包含不属于当前 WorldRelease 的资源`)
    }
    next[field] = [...submitted].sort()
  }
  return next
}

function mediaProfile(input: {
  productType: ProductionProductKindV1
  visualLevel: ProductProductionMediaProfileV1['visualLevel']
  audioLevel: ProductProductionMediaProfileV1['audioLevel']
  aiTown?: Pick<AiTownBriefSettingsV1,
    'residentTarget' | 'majorLocationTarget' | 'portraits' | 'expressions' | 'locationCards' | 'ambientAudio'>
  qualityProfile: ProductProductionBriefV3['qualityProfile']
}): ProductProductionMediaProfileV1 {
  // Each presentation product owns its own count/profile while sharing the
  // content-addressed media transport and release integrity primitives.
  const presentationEnabled = ['avg', 'ttrpg', 'ai-town', 'text-adventure', 'text-open-world'].includes(input.productType)
  const townImages = input.productType === 'ai-town' && input.visualLevel !== 'none'
    ? (input.aiTown?.locationCards === false ? 0 : input.aiTown?.majorLocationTarget ?? 4)
      + (input.aiTown?.portraits === false ? 0 : input.aiTown?.residentTarget ?? 6)
      + (input.aiTown?.expressions === false ? 0 : input.aiTown?.residentTarget ?? 6)
    : 0
  const textAdventureMode = input.visualLevel === 'none'
    ? 'text-only' : input.visualLevel === 'illustrated' ? 'rich-illustrations' : 'key-illustrations'
  const images = !presentationEnabled || input.visualLevel === 'none' ? 0
    : input.productType === 'ai-town' ? Math.min(28, townImages)
      : input.productType === 'text-adventure' && input.qualityProfile === 'commercial-candidate'
        ? minimumTextAdventureCommercialImageCountV1(textAdventureMode)
      : input.visualLevel === 'key-scenes' ? 2 : 8
  const townAudio = input.productType === 'ai-town' && input.aiTown?.ambientAudio === true && input.audioLevel !== 'none'
  const audioEnabled = input.productType === 'avg' || input.productType === 'ttrpg'
    || input.productType === 'text-open-world'
  const music = !audioEnabled || input.audioLevel === 'none' ? 0 : 1
  const sfx = input.productType === 'ai-town' ? (townAudio ? 1 : 0)
    : !audioEnabled || input.audioLevel === 'none' ? 0 : input.audioLevel === 'music-sfx' ? 3 : 8
  const requiredMediaKinds: ProductProductionMediaProfileV1['requiredMediaKinds'] = []
  if (input.productType === 'ai-town') {
    if (images > 0 && input.aiTown?.locationCards !== false) requiredMediaKinds.push('background')
    if (images > 0 && input.aiTown?.portraits !== false) requiredMediaKinds.push('character-pose')
    if (images > 0 && input.aiTown?.expressions !== false) requiredMediaKinds.push('character-expression')
  } else if (images > 0) {
    requiredMediaKinds.push('background', 'character-pose')
  }
  if (music > 0) requiredMediaKinds.push('bgm')
  if (sfx > 0) requiredMediaKinds.push(townAudio ? 'ambience' : 'sfx')
  return {
    visualLevel: images > 0 ? input.visualLevel : 'none',
    audioLevel: music + sfx > 0 ? input.audioLevel : 'none', imageCount: images,
    musicTrackCount: music, sfxCount: sfx, voiceLineCount: 0, requiredMediaKinds,
  }
}

async function capabilityRequirement(input: {
  requirementKey: string
  mediaClass: 'text' | 'image' | 'music' | 'sfx'
  required: boolean
  allowedDataClasses?: string[]
}) {
  const basis = {
    requirementKey: input.requirementKey,
    mediaClass: input.mediaClass,
    operation: 'generate',
    adapterFamily: input.mediaClass === 'text' ? 'configured-text' : 'configured-media',
    minimumCapabilityVersion: '1',
    allowedDataClasses: input.allowedDataClasses ?? ['world-selection'],
    maximumRequestCost: null,
    maximumTotalCost: null,
    rightsPolicyVersion: 'storyforge-rights-v1',
    required: input.required,
  }
  return { ...basis, capabilityHash: await hashProductProductionValueV2(basis) }
}

/**
 * Registered-context-only starting point suggestions. It makes no production
 * call and writes no Build; the user still chooses or supplies a custom start.
 */
export async function suggestProductStartingPoints(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<ProductConsultationSuggestionSetV1> {
  const scope = await resolveScope({ scope: input.scope })
  let source: ConsultationSourceV1
  try {
    source = await loadProductProductionConsultationSourceV2({ scope, worldReleaseId: input.worldReleaseId })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`[product-production] WorldRelease 已被篡改、不属于当前作用域或不符合纯语义契约：${detail}`)
  }
  const result: ProductStartingPointSuggestionV1[] = []
  const main = source.opportunities.storySources[0]
  if (main) result.push(suggestion({
    kind: 'mainline', title: `从「${main.label}」当前故事开始`,
    rationale: '来源明确、核心人物和冲突通常最完整，适合最快形成可玩纵切。',
    sourceRefs: [main.resourceKey], protagonistRefs: [],
    openingConflict: `围绕「${main.label}」选择一个尚未解决的即时危机作为开场。`,
    recommendedProductTypes: productFit('mainline'), scale: 'chapter',
    risks: ['主线范围容易过大，需要冻结本次只做的章节或短弧。'],
  }))
  const branch = source.opportunities.storyArcs[0]
    ?? source.opportunities.storySources.find(item => item.resourceKey !== main?.resourceKey)
  if (branch) result.push(suggestion({
    kind: 'branch', title: `从支线「${branch.label}」切入`,
    rationale: branch.summary || '支线更适合做成独立目标、探索和不同结局。',
    sourceRefs: [branch.resourceKey],
    protagonistRefs: [], openingConflict: `让玩家在「${branch.label}」最紧迫的节点介入。`,
    recommendedProductTypes: productFit('branch'), scale: 'short-arc',
    risks: ['需要确认支线与主线的时间位置及不可改变的事实。'],
  }))
  else if (main) result.push(suggestion({
    kind: 'branch', title: `从「${main.label}」旁边的一条未展开支线开始`,
    rationale: '保留主线事实，但让玩家从一个较小、可独立收束的目标进入世界。',
    sourceRefs: [main.resourceKey], protagonistRefs: [],
    openingConflict: '选择一个受主线影响、但尚未被正文解决的人物或地点危机。',
    recommendedProductTypes: productFit('branch'), scale: 'short-arc',
    risks: ['需要用户明确这条新支线不能改写哪些主线结果。'],
  }))
  for (const character of source.opportunities.characters.slice(0, 2)) result.push(suggestion({
    kind: 'character', title: `跟随角色「${character.label}」开始`,
    rationale: character.summary || '角色视角适合聚焦关系、秘密和个人选择。',
    sourceRefs: [character.resourceKey], protagonistRefs: [character.resourceKey],
    openingConflict: `从「${character.label}」必须立即做出代价选择的时刻开始。`,
    recommendedProductTypes: productFit('character'), scale: 'short-arc',
    risks: ['必须确认玩家扮演该角色，还是与该角色互动。'],
  }))
  const history = source.opportunities.historicalTimelineEvents[0]
  if (history && result.length < 5) result.push(suggestion({
    kind: 'history', title: `从历史事件「${history.label}」开始`,
    rationale: history.summary || '历史节点适合做成调查、模拟或多视角重演。',
    sourceRefs: [history.resourceKey], protagonistRefs: [],
    openingConflict: `从「${history.label}」发生前最后一个可改变局部结果的时刻开始。`,
    recommendedProductTypes: productFit('history'), scale: 'chapter',
    risks: ['只能改变局部体验；Brief 必须列出不能改写的既定历史。'],
  }))
  result.push(suggestion({
    kind: 'custom', title: '自定义主角与故事起点',
    rationale: '如果现有选项都不符合目标，可以只把冻结世界当作设定基础。',
    sourceRefs: [], protagonistRefs: [], openingConflict: '由用户描述想玩的第一幕和核心冲突。',
    recommendedProductTypes: productFit('custom'), scale: 'scene',
    risks: ['需要补齐主角、起点、规模、必守事实和内容边界后才能开始制作。'],
  }))
  const suggestions = result.slice(0, 6)
  const selectionDefaults = Object.fromEntries(suggestions.map(item => [
    item.suggestionKey,
    editableSelection(selectionForStartingPoint(source, item)),
  ]))
  const base = {
    schema: 'storyforge.product-starting-point-suggestions' as const,
    version: 1 as const,
    worldContentHash: source.release.contentHash,
    suggestions,
    sourceOptions: source.selectionOptions,
    selectionDefaults,
  }
  return { ...base, suggestionSetHash: await hashProductProductionValueV2(base) }
}

/**
 * Build a strict, reviewable Brief from user-facing choices. This is a
 * deterministic form compiler: it makes no model/provider call and does not
 * authorize production.
 */
export async function draftProductProductionBriefV3(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  suggestionKey: string
  productType: ProductionProductKindV1
  qualityProfile?: ProductProductionBriefV3['qualityProfile']
  scale?: ProductProductionScaleV1['scope']
  visualLevel?: ProductProductionMediaProfileV1['visualLevel']
  audioLevel?: ProductProductionMediaProfileV1['audioLevel']
  playerRole?: string
  openingSituation?: string
  coreExperience?: string[]
  tone?: string[]
  requiredFacts?: string[]
  forbiddenChanges?: string[]
  contentBoundaries?: string[]
  confirmTtrpgDefaultMappings?: boolean
  ttrpg?: TtrpgProductionBriefDraftInputV2
  aiTown?: AiTownBriefSettingsV1
  characterChat?: ChatAuthoringSettingsV1
  avg?: AvgAuthoringSettingsV1
  textAdventure?: TextAdventureProductionBriefDraftV1
  sourceSelection?: ProductProductionSourceSelectionV1
}): Promise<ProductProductionBriefV3> {
  const scope = await resolveScope({ scope: input.scope })
  const suggestions = await suggestProductStartingPoints({ scope, worldReleaseId: input.worldReleaseId })
  const selected = suggestions.suggestions.find(item => item.suggestionKey === input.suggestionKey)
  if (!selected) throw new Error('[product-production] 起点建议不属于当前冻结 WorldRelease')
  const source = await loadProductProductionConsultationSourceV2({
    scope,
    worldReleaseId: input.worldReleaseId,
  })
  if (source.release.contentHash !== suggestions.worldContentHash) {
    throw new Error('[product-production] 会谈期间 WorldRelease 来源发生变化')
  }
  const selectedScale = input.scale ?? selected.scale
  const qualityProfile = input.qualityProfile ?? 'prototype'
  const characterChat = input.characterChat ? parseChatAuthoringSettingsV1(input.characterChat) : undefined
  if(characterChat && input.productType !== 'character-interaction') throw new Error('角色聊天方案不能用于其他产品')
  const avg = input.avg ? parseAvgAuthoringSettingsV1(input.avg) : undefined
  if (avg && input.productType !== 'avg') throw new Error('AVG 方案不能用于其他产品')
  const scale = { scope: selectedScale, ...SCALE_DEFAULTS[selectedScale], ...(avg ? { targetPlayMinutes: avg.targetPlayMinutes, targetEndingCount: avg.targetEndingCount } : {}), ...(characterChat ? {targetPlayMinutes: characterChat.targetPlayMinutes} : {}) }
  const selectedCatalog = normalizeAuthorSelection({
    source, selected, authorSelection: input.sourceSelection,
  })
  if (characterChat) {
    const keys = characterChat.characters.map(c => c.sourceKey)
    if (!keys.length || (characterChat.mode === 'single' && keys.length !== 1)) {
      throw new Error('请在角色与场景中选择参与者；单角色模式需要恰好一名角色。')
    }
    const available = new Set(source.selectionOptions.characters.map(c => c.resourceKey))
    if (keys.some(key => !available.has(key))) throw new Error('角色设置包含当前世界版本中不存在的人物，请重新选择。')
    selectedCatalog.characterResourceKeys = keys
  }
  if (input.productType === 'ai-town') {
    const residentTarget = input.aiTown?.residentTarget ?? 6
    const majorLocationTarget = input.aiTown?.majorLocationTarget ?? 4
    if (!Number.isInteger(residentTarget) || residentTarget < 4 || residentTarget > 8) throw new Error('[product-production] AI 小镇居民目标必须是 4..8')
    if (!Number.isInteger(majorLocationTarget) || majorLocationTarget < 4 || majorLocationTarget > 12) throw new Error('[product-production] AI 小镇主要地点目标必须是 4..12')
    selectedCatalog.characterResourceKeys = selectedCatalog.characterResourceKeys.slice(0, residentTarget)
    selectedCatalog.importantLocationResourceKeys = selectedCatalog.importantLocationResourceKeys.slice(0, majorLocationTarget)
    if (selectedCatalog.characterResourceKeys.length < 4) {
      throw new Error('[product-production] AI 小镇首版需要从冻结 WorldRelease 选择至少 4 名角色')
    }
    if (selectedCatalog.storyResourceKeys.length + selectedCatalog.storyArcResourceKeys.length < 1) {
      throw new Error('[product-production] 严格后日谈需要至少一个冻结故事终局/故事弧资源')
    }
  }
  const media = mediaProfile({
    productType: input.productType,
    visualLevel: input.visualLevel ?? 'key-scenes',
    audioLevel: input.audioLevel ?? 'none',
    aiTown: input.productType === 'ai-town' ? {
      residentTarget: selectedCatalog.characterResourceKeys.length,
      majorLocationTarget: input.aiTown?.majorLocationTarget ?? 4,
      portraits: input.aiTown?.portraits ?? true,
      expressions: input.aiTown?.expressions ?? true,
      locationCards: input.aiTown?.locationCards ?? true,
      ambientAudio: input.aiTown?.ambientAudio ?? false,
    } : undefined,
    qualityProfile,
  })
  const roleBindings = compileUpperProductWorldRoleBindingsV1(input.productType, selectedCatalog)
  const selection: ProductWorldSourceSelectionV1 = {
    schema: 'storyforge.product-world-source-selection', version: 1,
    productType: input.productType,
    worldReferenceHash: source.worldReference.referenceHash,
    resourceKeys: [...new Set(Object.values(selectedCatalog).flat())].sort(),
    roleBindings,
  }
  const ttrpg = input.productType === 'ttrpg' ? await compileTtrpgProductionBriefV2({
    scope, selection, worldContentHash: source.release.contentHash,
    title: input.ttrpg?.campaign?.title ?? selected.title,
    premise: input.openingSituation?.trim() || selected.openingConflict,
    tone: input.tone?.length ? input.tone : ['沉浸', '清晰'],
    scale,
    contentBoundaries: input.contentBoundaries?.length ? input.contentBoundaries : ['不生成未授权的露骨或仇恨内容'],
    confirmDefaultMappings: input.confirmTtrpgDefaultMappings === true,
    draft: input.ttrpg,
  }) : null
  const aiTown = input.productType === 'ai-town' ? await (async () => {
    const settings = input.aiTown
    const townCatalog = await loadAiTownWorldSourceCatalogV1({ scope, worldReleaseId: input.worldReleaseId })
    const sourceSelection = await freezeAiTownWorldSourceSelectionV1({
      catalog: townCatalog,
      endingResourceKeys: [...selectedCatalog.storyResourceKeys, ...selectedCatalog.storyArcResourceKeys].sort(),
      residentResourceKeys: [...selectedCatalog.characterResourceKeys].sort(),
      locationResourceKeys: [...selectedCatalog.importantLocationResourceKeys].sort(),
      ruleAndLoreResourceKeys: [...selectedCatalog.codexEntryResourceKeys].sort(),
      artifactResourceKeys: [...selectedCatalog.artifactResourceKeys].sort(),
    })
    return {
      schema: 'storyforge.ai-town-production-brief' as const,
      version: 1 as const,
      sourceSelection,
      player: { role: settings?.playerRole ?? 'new-resident' as const, name: settings?.playerName.trim() || input.playerRole?.trim() || '新居民', homeConcept: settings?.homeConcept.trim() || '一间靠近公共空间、可安全休息的小屋' },
      continuity: { mode: 'strict-post-canon' as const, elapsedDays: settings?.elapsedDays ?? 90, romance: settings?.romance ?? 'off' as const },
      town: { title: settings?.townTitle.trim() || `${selected.title} · 后日谈小镇`, premise: input.openingSituation?.trim() || '原作结束三个月后，人物在新的共同体里重新安顿生活。', majorLocationTarget: settings?.majorLocationTarget ?? 4, residentTarget: selectedCatalog.characterResourceKeys.length },
      clock: { slots: ['morning', 'late-morning', 'noon', 'afternoon', 'evening', 'midnight'] as const, actionsPerDay: settings?.actionsPerDay ?? 3 },
      autonomy: { level: 'observational-high' as const, offlineEnabled: settings?.offlineEnabled ?? true, offlineMaximumDays: settings?.offlineMaximumDays ?? 3 },
      management: { resourceKeys: settings?.resourceKeys ?? ['materials', 'food', 'care'], startingMoney: settings?.startingMoney ?? 200, sharedProjectConcept: settings?.sharedProjectConcept.trim() || '修复一处让居民能够共同生活与相遇的公共设施' },
      safety: { boundaries: [...new Set(input.contentBoundaries?.length ? input.contentBoundaries : ['不生成未授权的露骨或仇恨内容'])], majorChangeConfirmation: true as const, privateMindPlayerAccess: 'none' as const },
      media: { portraits: settings?.portraits ?? true, expressions: settings?.expressions ?? true, locationCards: settings?.locationCards ?? true, map: true as const, ambientAudio: settings?.ambientAudio ?? false },
      authorConfirmed: true,
    }
  })() : null
  const textAdventure = input.productType === 'text-adventure'
    ? compileTextAdventureProductionBriefV1({ scale, media, draft: input.textAdventure })
    : null
  const requirements = [await capabilityRequirement({
    // The built-in deterministic compiler provides a no-provider vertical
    // slice. External text generation is an optional quality upgrade and may
    // never become an implicit prerequisite for an authorized local Build.
    requirementKey: 'text.runtime-package', mediaClass: 'text', required: false,
    allowedDataClasses: [
      'world-selection',
      ...(input.productType === 'text-adventure' && media.imageCount > 0 ? ['product-owned-media'] : []),
    ],
  })]
  if (media.imageCount > 0) requirements.push(await capabilityRequirement({
    requirementKey: 'media.visual', mediaClass: 'image', required: qualityProfile === 'commercial-candidate',
  }))
  if (media.musicTrackCount > 0) requirements.push(await capabilityRequirement({
    requirementKey: 'media.music', mediaClass: 'music', required: qualityProfile === 'commercial-candidate',
  }))
  if (media.sfxCount > 0) requirements.push(await capabilityRequirement({
    requirementKey: 'media.sfx', mediaClass: 'sfx', required: qualityProfile === 'commercial-candidate',
  }))
  const explicitPlayerRole = input.playerRole?.trim() ?? ''
  const explicitOpeningSituation = input.openingSituation?.trim() ?? ''
  const unresolvedDecisionKeys: string[] = []
  if (input.productType === 'character-interaction'
    && selected.protagonistRefs.length === 0
    && !explicitPlayerRole) {
    unresolvedDecisionKeys.push('player-character-or-counterpart')
  }
  if (input.productType === 'text-adventure'
    && (selection.roleBindings.locations?.length ?? 0) === 0
    && !explicitOpeningSituation) {
    unresolvedDecisionKeys.push('adventure-starting-location')
  }
  if (input.productType === 'ttrpg') {
    // An explicit product-authored opening may introduce a campaign location
    // without requiring the author to write runtime design back into the world.
    const authoredOpening = input.ttrpg?.naturalLanguageInstruction?.trim()
      && input.ttrpg.story?.openingScene?.trim()
    if ((selection.roleBindings.locations?.length ?? 0) === 0 && !authoredOpening) {
      unresolvedDecisionKeys.push('ttrpg-starting-location')
    }
    unresolvedDecisionKeys.push(...unresolvedTtrpgProductionBriefDecisionsV2(ttrpg!))
  }
  if (textAdventure) unresolvedDecisionKeys.push(...unresolvedTextAdventureProductionBriefDecisionsV1(textAdventure))
  const textAdventureModelTaskCount = textAdventure
    ? (() => {
        const baseScenesPerAct = Math.floor(textAdventure.narrative.targetSceneCount / 3)
        const extraScenes = textAdventure.narrative.targetSceneCount % 3
        const scenePacketCount = [0, 1, 2].reduce((sum, actIndex) => {
          const sceneCount = baseScenesPerAct + (actIndex < extraScenes ? 1 : 0)
          return sum + (sceneCount <= 1 ? 1 : 2)
        }, 0)
        // Visual QA owns one provider Run per frozen image. Count every Run
        // in the author-visible production envelope instead of treating the
        // whole illustrated release as one hidden model call.
        // Four bounded narrative-quality Runs (structure + three acts) replace
        // the former whole-product review, adding three first-attempt model
        // calls. Keep author-visible Brief authorization aligned with the Plan
        // floor so a newly created Build can admit its complete professional DAG.
        const visualRunCount = media.imageCount > 0 ? Math.max(1, media.imageCount) : 0
        // A real, bounded image-input preflight is its own professional Run.
        // It must be authorized in the Brief before any paid image task exists.
        return 29 + scenePacketCount + visualRunCount + Number(visualRunCount > 0)
      })()
    : 0
  const productionModelCalls = textAdventure
    // The professional pipeline owns one first-attempt Run per specialist and
    // per frozen image review. A live flagship rehearsal exhausted its former
    // envelope before late quality roles began, so the governed default keeps
    // explicit bounded recovery headroom, matching the Plan floor.
    ? Math.max(
        textAdventureModelTaskCount + Math.max(48, Math.ceil(textAdventureModelTaskCount * 1.5)),
        28 + textAdventure.narrative.targetSceneCount + scale.targetEndingCount,
      )
    : 16
  const productionInputTokens = textAdventure
    // Formal production now preserves exact registered context per task. Keep
    // this aligned with the Plan floor so late narrative and quality roles do
    // not fail solely because their governed source packet is larger than the
    // former generic-product estimate.
    ? Math.max(300_000, productionModelCalls * 32_000)
    : 180_000
  const productionOutputTokens = textAdventure
      ? Math.max(
        100_000,
        scale.targetWordCount * 8 + 60_000,
        scale.targetPlayMinutes * 2_000 + 40_000,
        // Provider completion receipts include hidden reasoning. The 200k
        // envelope was exhausted during act prose even though the visible
        // story was still incomplete; 8k per admitted attempt is the measured
        // commercial lifetime floor, not a per-response generation target.
        productionModelCalls * 8_000,
      )
    : 60_000
  const openWorldBudget = DEFAULT_TEXT_OPEN_WORLD_CALIBRATION_V1.aiBudget.production
  const productionBudget = textAdventure
    ? {
        maximumModelCalls: productionModelCalls,
        maximumInputTokens: productionInputTokens,
        maximumOutputTokens: productionOutputTokens,
        maximumCostUsd: null,
        maximumMediaCalls: Math.max(1, media.imageCount + media.musicTrackCount + media.sfxCount),
        maximumDurationMs: 18_000_000,
        maximumStorageBytes: 200_000_000,
      }
    : input.productType === 'text-open-world'
    ? {
        maximumModelCalls: openWorldBudget.maximumCalls,
        maximumInputTokens: openWorldBudget.maximumInputTokens,
        maximumOutputTokens: openWorldBudget.maximumOutputTokens,
        maximumCostUsd: openWorldBudget.maximumEstimatedCostUsd,
        maximumMediaCalls: Math.max(1, media.imageCount + media.musicTrackCount + media.sfxCount),
        maximumDurationMs: 7_200_000,
        maximumStorageBytes: 200_000_000,
      }
    : {
        maximumModelCalls: 16,
        maximumInputTokens: 180_000,
        maximumOutputTokens: 60_000,
        maximumCostUsd: null,
        maximumMediaCalls: Math.max(1, media.imageCount + media.musicTrackCount + media.sfxCount),
        maximumDurationMs: 3_600_000,
        maximumStorageBytes: 200_000_000,
      }
  return parseProductProductionBriefV3({
    schema: 'storyforge.product-production-brief', version: 3,
    ...(avg ? { avg } : {}),
    ...(characterChat ? { characterChat } : {}),
    source: {
      worldReleaseId: input.worldReleaseId, worldContentHash: source.release.contentHash, selection,
      startingPoint: {
        kind: selected.kind, title: selected.title, summary: selected.rationale,
        sourceRefs: selected.sourceRefs, protagonistRefs: selected.protagonistRefs,
        openingConflict: selected.openingConflict,
      },
    },
    intent: {
      productType: input.productType,
      playerRole: explicitPlayerRole || (selected.protagonistRefs.length ? '所选主角' : '世界中的行动者'),
      protagonistRefs: selected.protagonistRefs,
      openingSituation: explicitOpeningSituation || selected.openingConflict,
      coreExperience: [...new Set(input.coreExperience?.length
        ? input.coreExperience : ['有后果的选择', '基于冻结世界事实的叙事'])],
      requiredFacts: [...new Set(input.requiredFacts ?? [])],
      forbiddenChanges: [...new Set(input.forbiddenChanges ?? [])],
      contentBoundaries: [...new Set(input.contentBoundaries?.length ? input.contentBoundaries : ['不生成未授权的露骨或仇恨内容'])],
      tone: [...new Set(input.tone?.length ? input.tone : ['沉浸', '清晰'])],
    },
    scale,
    media,
    consultationBudget: {
      maximumModelCalls: 3, maximumInputTokens: 30_000, maximumOutputTokens: 8_000, maximumCostUsd: null,
    },
    productionBudget,
    qualityProfile,
    capabilityRequirements: requirements,
    externalDataPolicy: {
      allowedDataClasses: ['world-selection'], forbiddenDataClasses: ['api-key', 'private-note'],
      allowReferenceImages: false, allowVoiceScripts: false,
    },
    fallbackPolicy: {
      allowTextOnly: qualityProfile !== 'commercial-candidate', allowExistingProjectMedia: true,
      allowProceduralAudio: qualityProfile !== 'commercial-candidate',
      onRequiredCapabilityMissing: 'pause',
    },
    completionContract: {
      requiresPlayablePreview: true,
      requiredGateIds: [
        'runtime.package.valid', 'runtime.playable', 'narrative.graph.valid', 'rights.complete',
        ...(input.productType === 'text-adventure' ? [
          'product.adventure.world-actions',
          'product.adventure.progression',
          'product.adventure.v2-capabilities',
          'product.adventure.v2-space',
          'product.adventure.v2-character-system',
          'product.adventure.v2-equipment',
          'product.adventure.v2-quest-time-storylets-endings',
          'product.adventure.v2-offline-fallback',
          'product.adventure.v2-production-targets',
          'product.adventure.v2-choice-bridge',
          'product.adventure.v2-fail-forward',
          'product.adventure.v2-media-binding',
          'product.adventure.narrative-depth',
          'product.adventure.content-volume',
          ...(qualityProfile === 'commercial-candidate' ? [
            'product.adventure.recommendation-analysis-complete',
            'product.adventure.recommendation-route-volume',
            'product.adventure.recommendation-total-volume',
            'product.adventure.recommendation-dialogue-and-cast',
            'product.adventure.recommendation-decisions',
            'product.adventure.recommendation-main-quest',
            'product.adventure.recommendation-endings',
            'product.adventure.recommendation-copy',
            'product.adventure.recommendation-media-composition',
          ] : []),
        ] : []),
      ],
      minimumMediaCoverage: media.requiredMediaKinds.length
        ? qualityProfile === 'commercial-candidate' ? 1 : 0.5
        : 0,
      allowSoftWaivers: !(input.productType === 'text-adventure' && qualityProfile === 'commercial-candidate'),
    },
    unresolvedDecisionKeys,
    ...(ttrpg ? { ttrpg } : {}),
    ...(aiTown ? { aiTown } : {}),
    ...(textAdventure ? { textAdventure } : {}),
    ...(input.productType === 'ttrpg' ? {
      authorConfirmations: { ttrpgDefaultRuleMappings: input.confirmTtrpgDefaultMappings === true },
    } : {}),
  })
}
