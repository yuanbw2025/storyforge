import { assembleContext } from '../registry/assemble-context'
import type {
  GameProductType,
  GameProductionBriefV3,
  GameProductionMediaProfileV1,
  GameProductionScaleV1,
  GameProductionSourceOptionsV1,
  GameProductionSourceSelectionV1,
  GameStartingPointSuggestionV1,
  ProductWorldSourceSelectionV1,
  WorkspaceScope,
  WorldReferenceV1,
} from '../types'
import { resolveScope } from '../world-engine/scope'
import { hashGameProductionValueV2 } from './hash'
import { parseGameProductionBriefV3 } from './contracts'
import {
  compileTtrpgProductionBriefV2,
  type TtrpgProductionBriefDraftInputV2,
  unresolvedTtrpgProductionBriefDecisionsV2,
} from '../ttrpg/production-brief'

interface OpportunityRow {
  resourceKey: string
  label: string
  summary: string
  kind: string | null
}

interface ConsultationSourceV1 {
  worldReference: WorldReferenceV1
  release: { version: number; label: string; contentHash: string }
  opportunities: {
    storySources: OpportunityRow[]
    characters: OpportunityRow[]
    storyArcs: OpportunityRow[]
    historicalTimelineEvents: OpportunityRow[]
  }
  selectionOptions: GameProductionSourceOptionsV1
  selectionRelations: Array<{
    resourceKey: string
    fromCharacterResourceKey: string
    toCharacterResourceKey: string
  }>
  selectionCatalog: GameProductionSourceSelectionV1
}

function stableSlug(value: string): string {
  return value.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 80) || 'option'
}

function suggestion(input: Omit<GameStartingPointSuggestionV1, 'suggestionKey'>): GameStartingPointSuggestionV1 {
  const sourceDiscriminator = input.sourceRefs.length ? `:${stableSlug(input.sourceRefs.join('-'))}` : ''
  return { suggestionKey: `${input.kind}:${stableSlug(input.title)}${sourceDiscriminator}`, ...input }
}

function productFit(kind: GameStartingPointSuggestionV1['kind']): GameProductType[] {
  if (kind === 'character') return ['character-interaction', 'avg', 'storygame', 'ttrpg']
  if (kind === 'history') return ['narrative-simulation', 'text-adventure', 'ttrpg', 'storygame']
  if (kind === 'branch') return ['text-adventure', 'text-open-world', 'ttrpg', 'storygame']
  if (kind === 'custom') return ['storygame', 'text-adventure', 'avg', 'ttrpg']
  return ['storygame', 'avg', 'text-adventure', 'ttrpg']
}

export interface GameConsultationSuggestionSetV1 {
  schema: 'storyforge.game-starting-point-suggestions'
  version: 1
  worldContentHash: string
  suggestions: GameStartingPointSuggestionV1[]
  sourceOptions: GameProductionSourceOptionsV1
  selectionDefaults: Record<string, GameProductionSourceSelectionV1>
  suggestionSetHash: string
}

const SCALE_DEFAULTS: Record<GameProductionScaleV1['scope'], Omit<GameProductionScaleV1, 'scope'>> = {
  scene: { targetPlayMinutes: 20, targetWordCount: 3_000, targetEndingCount: 2 },
  'short-arc': { targetPlayMinutes: 60, targetWordCount: 10_000, targetEndingCount: 3 },
  chapter: { targetPlayMinutes: 120, targetWordCount: 20_000, targetEndingCount: 3 },
  'multi-chapter': { targetPlayMinutes: 300, targetWordCount: 50_000, targetEndingCount: 4 },
  campaign: { targetPlayMinutes: 900, targetWordCount: 120_000, targetEndingCount: 5 },
}

function productRoleBindings(
  productType: GameProductType,
  catalog: ConsultationSourceV1['selectionCatalog'],
): Record<string, string[]> {
  if (productType === 'storygame') {
    return { story: catalog.storyResourceKeys }
  }
  if (productType === 'character-interaction') {
    return {
      participants: catalog.characterResourceKeys,
      context: [...catalog.storyResourceKeys, ...catalog.storyArcResourceKeys],
    }
  }
  if (productType === 'text-adventure') {
    return {
      locations: catalog.importantLocationResourceKeys,
      items: catalog.artifactResourceKeys,
      quests: catalog.storyArcResourceKeys,
    }
  }
  if (productType === 'avg') {
    return {
      story: [...catalog.storyResourceKeys, ...catalog.storyArcResourceKeys],
      characters: catalog.characterResourceKeys,
      locations: catalog.importantLocationResourceKeys,
    }
  }
  if (productType === 'narrative-simulation') {
    return {
      issues: catalog.storyArcResourceKeys,
      factions: catalog.codexEntryResourceKeys,
    }
  }
  if (productType === 'ttrpg') {
    return {
      participants: catalog.characterResourceKeys,
      locations: catalog.importantLocationResourceKeys,
      quests: catalog.storyArcResourceKeys,
    }
  }
  return {
    regions: catalog.importantLocationResourceKeys,
    factions: catalog.codexEntryResourceKeys,
    quests: catalog.storyArcResourceKeys,
  }
}

/** The chosen starting point must constrain the actual semantic resource set. */
function selectionForStartingPoint(
  source: ConsultationSourceV1,
  selected: GameStartingPointSuggestionV1,
): ConsultationSourceV1['selectionCatalog'] {
  const refs = new Set([...selected.sourceRefs, ...selected.protagonistRefs])
  const next = structuredClone(source.selectionCatalog)
  const optionFields: Array<[keyof GameProductionSourceOptionsV1, keyof GameProductionSourceSelectionV1]> = [
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
] as const satisfies readonly (keyof GameProductionSourceSelectionV1)[]

function editableSelection(
  catalog: ConsultationSourceV1['selectionCatalog'],
): GameProductionSourceSelectionV1 {
  return Object.fromEntries(
    AUTHOR_SELECTION_FIELDS.map(field => [field, [...catalog[field]]]),
  ) as unknown as GameProductionSourceSelectionV1
}

function normalizeAuthorSelection(input: {
  source: ConsultationSourceV1
  selected: GameStartingPointSuggestionV1
  authorSelection?: GameProductionSourceSelectionV1
}): ConsultationSourceV1['selectionCatalog'] {
  const startingSelection = selectionForStartingPoint(input.source, input.selected)
  if (!input.authorSelection) return startingSelection
  const next = structuredClone(startingSelection)
  for (const field of AUTHOR_SELECTION_FIELDS) {
    const submitted = input.authorSelection[field]
    if (!Array.isArray(submitted)) throw new Error(`[game-production] 冻结素材选择缺少 ${field}`)
    if (submitted.some(value => typeof value !== 'string' || !value.startsWith('world-release:'))) {
      throw new Error(`[game-production] 冻结素材选择 ${field} 包含非法世界资源 key`)
    }
    if (new Set(submitted).size !== submitted.length) {
      throw new Error(`[game-production] 冻结素材选择 ${field} 包含重复世界资源 key`)
    }
    const allowed = new Set(input.source.selectionCatalog[field])
    if (submitted.some(value => !allowed.has(value))) {
      throw new Error(`[game-production] 冻结素材选择 ${field} 包含不属于当前 WorldRelease 的资源`)
    }
    next[field] = [...submitted].sort()
  }
  return next
}

function mediaProfile(input: {
  productType: GameProductType
  visualLevel: GameProductionMediaProfileV1['visualLevel']
  audioLevel: GameProductionMediaProfileV1['audioLevel']
}): GameProductionMediaProfileV1 {
  // AVG and the governed TTRPG tabletop both bind presentation assets.
  const presentationEnabled = input.productType === 'avg' || input.productType === 'ttrpg'
  const images = !presentationEnabled || input.visualLevel === 'none' ? 0 : input.visualLevel === 'key-scenes' ? 2 : 8
  const music = !presentationEnabled || input.audioLevel === 'none' ? 0 : 1
  const sfx = !presentationEnabled || input.audioLevel === 'none' ? 0 : input.audioLevel === 'music-sfx' ? 3 : 8
  const requiredMediaKinds: GameProductionMediaProfileV1['requiredMediaKinds'] = []
  if (images > 0) requiredMediaKinds.push('background')
  if ((input.productType === 'avg' || input.productType === 'ttrpg') && images > 0) requiredMediaKinds.push('character-pose')
  if (music > 0) requiredMediaKinds.push('bgm')
  if (sfx > 0) requiredMediaKinds.push('sfx')
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
}) {
  const basis = {
    requirementKey: input.requirementKey,
    mediaClass: input.mediaClass,
    operation: 'generate',
    adapterFamily: input.mediaClass === 'text' ? 'configured-text' : 'configured-media',
    minimumCapabilityVersion: '1',
    allowedDataClasses: ['world-selection'],
    maximumRequestCost: null,
    maximumTotalCost: null,
    rightsPolicyVersion: 'storyforge-rights-v1',
    required: input.required,
  }
  return { ...basis, capabilityHash: await hashGameProductionValueV2(basis) }
}

/**
 * Registered-context-only starting point suggestions. It makes no production
 * call and writes no Build; the user still chooses or supplies a custom start.
 */
export async function suggestGameStartingPoints(input: {
  scope: WorkspaceScope
  worldReleaseId: number
}): Promise<GameConsultationSuggestionSetV1> {
  const scope = await resolveScope({ scope: input.scope })
  let assembled: Awaited<ReturnType<typeof assembleContext>>
  try {
    assembled = await assembleContext({
      projectId: scope.projectId,
      scope,
      sourceKeys: ['game-production.consultation-source'],
      gameWorldReleaseId: input.worldReleaseId,
    })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`[game-production] WorldRelease 已被篡改、不属于当前作用域或不符合纯语义契约：${detail}`)
  }
  const segment = assembled.segments.find(item => item.label === '游戏生产会谈来源')
  if (!segment) throw new Error('[game-production] 会谈来源未进入登记上下文')
  const source = JSON.parse(segment.content) as ConsultationSourceV1
  const result: GameStartingPointSuggestionV1[] = []
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
    schema: 'storyforge.game-starting-point-suggestions' as const,
    version: 1 as const,
    worldContentHash: source.release.contentHash,
    suggestions,
    sourceOptions: source.selectionOptions,
    selectionDefaults,
  }
  return { ...base, suggestionSetHash: await hashGameProductionValueV2(base) }
}

/**
 * Build a strict, reviewable Brief from user-facing choices. This is a
 * deterministic form compiler: it makes no model/provider call and does not
 * authorize production.
 */
export async function draftGameProductionBriefV3(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  suggestionKey: string
  productType: GameProductType
  qualityProfile?: GameProductionBriefV3['qualityProfile']
  scale?: GameProductionScaleV1['scope']
  visualLevel?: GameProductionMediaProfileV1['visualLevel']
  audioLevel?: GameProductionMediaProfileV1['audioLevel']
  playerRole?: string
  openingSituation?: string
  coreExperience?: string[]
  tone?: string[]
  requiredFacts?: string[]
  forbiddenChanges?: string[]
  contentBoundaries?: string[]
  confirmTtrpgDefaultMappings?: boolean
  ttrpg?: TtrpgProductionBriefDraftInputV2
  sourceSelection?: GameProductionSourceSelectionV1
}): Promise<GameProductionBriefV3> {
  const scope = await resolveScope({ scope: input.scope })
  const suggestions = await suggestGameStartingPoints({ scope, worldReleaseId: input.worldReleaseId })
  const selected = suggestions.suggestions.find(item => item.suggestionKey === input.suggestionKey)
  if (!selected) throw new Error('[game-production] 起点建议不属于当前冻结 WorldRelease')
  const assembled = await assembleContext({
    projectId: scope.projectId,
    scope,
    sourceKeys: ['game-production.consultation-source'],
    gameWorldReleaseId: input.worldReleaseId,
  })
  const segment = assembled.segments.find(item => item.label === '游戏生产会谈来源')
  if (!segment) throw new Error('[game-production] 会谈来源未进入登记上下文')
  const source = JSON.parse(segment.content) as ConsultationSourceV1
  if (source.release.contentHash !== suggestions.worldContentHash) {
    throw new Error('[game-production] 会谈期间 WorldRelease 来源发生变化')
  }
  const selectedScale = input.scale ?? selected.scale
  const qualityProfile = input.qualityProfile ?? 'prototype'
  const scale = { scope: selectedScale, ...SCALE_DEFAULTS[selectedScale] }
  const media = mediaProfile({
    productType: input.productType,
    visualLevel: input.visualLevel ?? 'key-scenes',
    audioLevel: input.audioLevel ?? 'none',
  })
  const selectedCatalog = normalizeAuthorSelection({
    source, selected, authorSelection: input.sourceSelection,
  })
  const roleBindings = productRoleBindings(input.productType, selectedCatalog)
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
  const requirements = [await capabilityRequirement({
    // The built-in deterministic compiler provides a no-provider vertical
    // slice. External text generation is an optional quality upgrade and may
    // never become an implicit prerequisite for an authorized local Build.
    requirementKey: 'text.runtime-package', mediaClass: 'text', required: false,
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
    if ((selection.roleBindings.locations?.length ?? 0) === 0) unresolvedDecisionKeys.push('ttrpg-starting-location')
    unresolvedDecisionKeys.push(...unresolvedTtrpgProductionBriefDecisionsV2(ttrpg!))
  }
  return parseGameProductionBriefV3({
    schema: 'storyforge.game-production-brief', version: 3,
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
    productionBudget: {
      maximumModelCalls: 16, maximumInputTokens: 180_000, maximumOutputTokens: 60_000,
      maximumCostUsd: null, maximumMediaCalls: Math.max(1, media.imageCount + media.musicTrackCount + media.sfxCount),
      maximumDurationMs: 3_600_000, maximumStorageBytes: 200_000_000,
    },
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
      requiredGateIds: ['runtime.package.valid', 'runtime.playable', 'narrative.graph.valid', 'rights.complete'],
      minimumMediaCoverage: media.requiredMediaKinds.length
        ? qualityProfile === 'commercial-candidate' ? 1 : 0.5
        : 0,
      allowSoftWaivers: true,
    },
    unresolvedDecisionKeys,
    ...(ttrpg ? { ttrpg } : {}),
    ...(input.productType === 'ttrpg' ? {
      authorConfirmations: { ttrpgDefaultRuleMappings: input.confirmTtrpgDefaultMappings === true },
    } : {}),
  })
}
