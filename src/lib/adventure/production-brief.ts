import type {
  ProductProductionMediaProfileV1,
  ProductProductionScaleV1,
  TextAdventureProductionBriefV1,
} from '../types'

const REQUIRED_RESOURCE_ROLES: TextAdventureProductionBriefV1['character']['resourceRoles'] = [
  'health', 'mana', 'stamina', 'experience', 'skill-points', 'currency', 'clock',
]

function fail(message: string): never {
  throw new Error(`[text-adventure-production-brief] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = [...keys].sort()
  const actual = Object.keys(value).sort()
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) {
    fail(`${label} 字段不精确:${actual.join(',')}`)
  }
}

function text(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 无效`)
  return Number(value)
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} 必须是 boolean`)
  return value
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} 枚举无效`)
  return value as T
}

function textArray(value: unknown, label: string, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${label} 数量无效`)
  const parsed = value.map((item, index) => text(item, `${label}[${index}]`, 120))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return parsed
}

export function parseTextAdventureProductionBriefV1(value: unknown): TextAdventureProductionBriefV1 {
  const row = record(value, 'textAdventure')
  exactKeys(row, [
    'schema', 'version', 'creationMode', 'sourceTreatment', 'narrative', 'character',
    'experience', 'media', 'confirmations',
  ], 'textAdventure')
  if (row.schema !== 'storyforge.text-adventure-production-brief' || row.version !== 1) {
    fail('schema/version 无效')
  }
  const narrative = record(row.narrative, 'narrative')
  exactKeys(narrative, [
    'structure', 'targetRegionCount', 'targetAreaCount', 'targetLocationCount', 'targetSceneCount',
    'mainQuestCount', 'targetSideQuestCount', 'targetAmbientEventCount', 'targetEndingCount',
    'minimumDistinctRoutes', 'choiceDensity', 'failForward',
  ], 'narrative')
  const parsedNarrative: TextAdventureProductionBriefV1['narrative'] = {
    structure: enumValue(narrative.structure, ['trunk-convergent-storylets'], 'narrative.structure'),
    targetRegionCount: integer(narrative.targetRegionCount, 'narrative.targetRegionCount', 1, 8),
    targetAreaCount: integer(narrative.targetAreaCount, 'narrative.targetAreaCount', 1, 24),
    targetLocationCount: integer(narrative.targetLocationCount, 'narrative.targetLocationCount', 2, 48),
    targetSceneCount: integer(narrative.targetSceneCount, 'narrative.targetSceneCount', 3, 80),
    mainQuestCount: integer(narrative.mainQuestCount, 'narrative.mainQuestCount', 1, 1) as 1,
    targetSideQuestCount: integer(narrative.targetSideQuestCount, 'narrative.targetSideQuestCount', 0, 16),
    targetAmbientEventCount: integer(narrative.targetAmbientEventCount, 'narrative.targetAmbientEventCount', 1, 32),
    targetEndingCount: integer(narrative.targetEndingCount, 'narrative.targetEndingCount', 2, 8),
    minimumDistinctRoutes: integer(narrative.minimumDistinctRoutes, 'narrative.minimumDistinctRoutes', 1, 8),
    choiceDensity: enumValue(narrative.choiceDensity, ['focused', 'balanced', 'dense'], 'narrative.choiceDensity'),
    failForward: boolean(narrative.failForward, 'narrative.failForward'),
  }
  if (parsedNarrative.targetAreaCount < parsedNarrative.targetRegionCount
    || parsedNarrative.targetLocationCount < parsedNarrative.targetAreaCount
    || parsedNarrative.targetSceneCount < parsedNarrative.targetLocationCount) {
    fail('空间数量必须满足大区域 ≤ 区域 ≤ 地点 ≤ 场景')
  }
  if (parsedNarrative.minimumDistinctRoutes > parsedNarrative.targetEndingCount) {
    fail('有效路线数不能超过结局数')
  }

  const character = record(row.character, 'character')
  exactKeys(character, [
    'preset', 'statLabels', 'skillLabels', 'resourceRoles', 'equipmentSlotLabels', 'progressionEnabled',
  ], 'character')
  if (!Array.isArray(character.resourceRoles)) fail('character.resourceRoles 必须是数组')
  const resourceRoles = character.resourceRoles.map((item, index) => enumValue(
    item, REQUIRED_RESOURCE_ROLES, `character.resourceRoles[${index}]`,
  ))
  if (resourceRoles.join(',') !== REQUIRED_RESOURCE_ROLES.join(',')) {
    fail('角色资源必须完整且按权威顺序登记')
  }
  const parsedCharacter: TextAdventureProductionBriefV1['character'] = {
    preset: enumValue(character.preset, ['general-adventure-rpg'], 'character.preset'),
    statLabels: textArray(character.statLabels, 'character.statLabels', 4, 12),
    skillLabels: textArray(character.skillLabels, 'character.skillLabels', 2, 16),
    resourceRoles,
    equipmentSlotLabels: textArray(character.equipmentSlotLabels, 'character.equipmentSlotLabels', 2, 12),
    progressionEnabled: boolean(character.progressionEnabled, 'character.progressionEnabled'),
  }

  const experience = record(row.experience, 'experience')
  exactKeys(experience, [
    'perspective', 'consequenceVisibility', 'contentExpansion', 'emotionalTarget', 'endingCauseRecap',
  ], 'experience')
  const media = record(row.media, 'media')
  exactKeys(media, [
    'mode', 'characterAnchorsRequired', 'reviewBeforePublish', 'runtimeGeneration',
  ], 'media')
  const confirmations = record(row.confirmations, 'confirmations')
  exactKeys(confirmations, [
    'worldCanonBoundary', 'deterministicStateAuthority', 'genericCoreBoundary', 'mediaRights',
  ], 'confirmations')
  return {
    schema: 'storyforge.text-adventure-production-brief',
    version: 1,
    creationMode: enumValue(row.creationMode, ['quick', 'advanced'], 'creationMode'),
    sourceTreatment: enumValue(row.sourceTreatment, ['expand-sparse', 'adapt-rich', 'author-outline'], 'sourceTreatment'),
    narrative: parsedNarrative,
    character: parsedCharacter,
    experience: {
      perspective: enumValue(experience.perspective, ['second-person', 'first-person'], 'experience.perspective'),
      consequenceVisibility: enumValue(experience.consequenceVisibility, ['explicit', 'partial', 'hidden'], 'experience.consequenceVisibility'),
      contentExpansion: enumValue(experience.contentExpansion, ['required', 'preserve-source-depth'], 'experience.contentExpansion'),
      emotionalTarget: text(experience.emotionalTarget, 'experience.emotionalTarget', 1000),
      endingCauseRecap: boolean(experience.endingCauseRecap, 'experience.endingCauseRecap'),
    },
    media: {
      mode: enumValue(media.mode, ['text-only', 'key-illustrations', 'rich-illustrations'], 'media.mode'),
      characterAnchorsRequired: boolean(media.characterAnchorsRequired, 'media.characterAnchorsRequired'),
      reviewBeforePublish: boolean(media.reviewBeforePublish, 'media.reviewBeforePublish'),
      runtimeGeneration: enumValue(media.runtimeGeneration, ['disabled'], 'media.runtimeGeneration'),
    },
    confirmations: {
      worldCanonBoundary: boolean(confirmations.worldCanonBoundary, 'confirmations.worldCanonBoundary'),
      deterministicStateAuthority: boolean(confirmations.deterministicStateAuthority, 'confirmations.deterministicStateAuthority'),
      genericCoreBoundary: boolean(confirmations.genericCoreBoundary, 'confirmations.genericCoreBoundary'),
      mediaRights: boolean(confirmations.mediaRights, 'confirmations.mediaRights'),
    },
  }
}

const SIZE_PRESETS: Record<ProductProductionScaleV1['scope'], Pick<
  TextAdventureProductionBriefV1['narrative'],
  'targetRegionCount' | 'targetAreaCount' | 'targetLocationCount' | 'targetSceneCount'
  | 'targetSideQuestCount' | 'targetAmbientEventCount'
>> = {
  scene: { targetRegionCount: 1, targetAreaCount: 2, targetLocationCount: 3, targetSceneCount: 4, targetSideQuestCount: 1, targetAmbientEventCount: 2 },
  'short-arc': { targetRegionCount: 2, targetAreaCount: 4, targetLocationCount: 8, targetSceneCount: 12, targetSideQuestCount: 3, targetAmbientEventCount: 4 },
  chapter: { targetRegionCount: 3, targetAreaCount: 6, targetLocationCount: 12, targetSceneCount: 18, targetSideQuestCount: 4, targetAmbientEventCount: 6 },
  'multi-chapter': { targetRegionCount: 4, targetAreaCount: 8, targetLocationCount: 16, targetSceneCount: 24, targetSideQuestCount: 6, targetAmbientEventCount: 8 },
  campaign: { targetRegionCount: 5, targetAreaCount: 10, targetLocationCount: 20, targetSceneCount: 32, targetSideQuestCount: 8, targetAmbientEventCount: 12 },
}

export interface TextAdventureProductionBriefDraftV1 {
  creationMode?: TextAdventureProductionBriefV1['creationMode']
  sourceTreatment?: TextAdventureProductionBriefV1['sourceTreatment']
  targetRegionCount?: number
  targetAreaCount?: number
  targetLocationCount?: number
  targetSceneCount?: number
  targetSideQuestCount?: number
  targetAmbientEventCount?: number
  minimumDistinctRoutes?: number
  choiceDensity?: TextAdventureProductionBriefV1['narrative']['choiceDensity']
  emotionalTarget?: string
  consequenceVisibility?: TextAdventureProductionBriefV1['experience']['consequenceVisibility']
  perspective?: TextAdventureProductionBriefV1['experience']['perspective']
  confirmAll?: boolean
}

export function createDefaultTextAdventureProductionBriefDraftV1(
  scope: ProductProductionScaleV1['scope'] = 'short-arc',
): TextAdventureProductionBriefDraftV1 {
  const preset = SIZE_PRESETS[scope]
  return {
    creationMode: 'quick',
    sourceTreatment: 'expand-sparse',
    ...preset,
    minimumDistinctRoutes: 2,
    choiceDensity: 'balanced',
    emotionalTarget: '在完整起承转合中形成至少一次明确的情绪转折，并让结局回应玩家行动。',
    consequenceVisibility: 'explicit',
    perspective: 'second-person',
    confirmAll: false,
  }
}

export function compileTextAdventureProductionBriefV1(input: {
  scale: ProductProductionScaleV1
  media: ProductProductionMediaProfileV1
  draft?: TextAdventureProductionBriefDraftV1
}): TextAdventureProductionBriefV1 {
  if (input.scale.targetPlayMinutes > 120 || ['multi-chapter', 'campaign'].includes(input.scale.scope)) {
    fail('当前文字冒险正式生产只接受 15–120 分钟的有限篇幅')
  }
  const preset = SIZE_PRESETS[input.scale.scope]
  const visualMode = input.media.visualLevel === 'none'
    ? 'text-only' : input.media.visualLevel === 'illustrated' ? 'rich-illustrations' : 'key-illustrations'
  const confirmed = input.draft?.confirmAll === true
  return parseTextAdventureProductionBriefV1({
    schema: 'storyforge.text-adventure-production-brief', version: 1,
    creationMode: input.draft?.creationMode ?? 'quick',
    sourceTreatment: input.draft?.sourceTreatment ?? 'expand-sparse',
    narrative: {
      structure: 'trunk-convergent-storylets',
      targetRegionCount: input.draft?.targetRegionCount ?? preset.targetRegionCount,
      targetAreaCount: input.draft?.targetAreaCount ?? preset.targetAreaCount,
      targetLocationCount: input.draft?.targetLocationCount ?? preset.targetLocationCount,
      targetSceneCount: input.draft?.targetSceneCount ?? preset.targetSceneCount,
      mainQuestCount: 1,
      targetSideQuestCount: input.draft?.targetSideQuestCount ?? preset.targetSideQuestCount,
      targetAmbientEventCount: input.draft?.targetAmbientEventCount ?? preset.targetAmbientEventCount,
      targetEndingCount: input.scale.targetEndingCount,
      minimumDistinctRoutes: input.draft?.minimumDistinctRoutes ?? Math.min(2, input.scale.targetEndingCount),
      choiceDensity: input.draft?.choiceDensity ?? 'balanced',
      failForward: true,
    },
    character: {
      preset: 'general-adventure-rpg',
      statLabels: ['生命上限', '法力上限', '攻击', '防御', '敏捷', '感知'],
      skillLabels: ['探索', '交涉', '技艺', '意志'],
      resourceRoles: REQUIRED_RESOURCE_ROLES,
      equipmentSlotLabels: ['武器', '身体', '饰品'],
      progressionEnabled: true,
    },
    experience: {
      perspective: input.draft?.perspective ?? 'second-person',
      consequenceVisibility: input.draft?.consequenceVisibility ?? 'explicit',
      contentExpansion: input.draft?.sourceTreatment === 'adapt-rich' ? 'preserve-source-depth' : 'required',
      emotionalTarget: input.draft?.emotionalTarget?.trim() || '在完整起承转合中形成至少一次明确的情绪转折，并让结局回应玩家行动。',
      endingCauseRecap: true,
    },
    media: {
      mode: visualMode, characterAnchorsRequired: visualMode !== 'text-only',
      reviewBeforePublish: true, runtimeGeneration: 'disabled',
    },
    confirmations: {
      worldCanonBoundary: confirmed, deterministicStateAuthority: confirmed,
      genericCoreBoundary: confirmed, mediaRights: confirmed,
    },
  })
}

export function unresolvedTextAdventureProductionBriefDecisionsV1(
  brief: TextAdventureProductionBriefV1,
): string[] {
  return Object.values(brief.confirmations).every(Boolean)
    ? [] : ['text-adventure-boundary-confirmation']
}
