import type {
  AdventureAbilityRoleV2,
  AdventureResourceRoleV2,
  TextAdventureProductionBriefV1,
} from '../types'

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function fail(message: string): never {
  throw new Error(`[text-adventure-production-artifact] ${message}`)
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

function text(value: unknown, label: string, maximum = 4_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function key(value: unknown, label: string): string {
  const parsed = text(value, label, 200)
  if (!KEY.test(parsed)) fail(`${label} 不是稳定 key`)
  return parsed
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 无效`)
  return Number(value)
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} 必须是布尔值`)
  return value
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    const received = typeof value === 'string' ? JSON.stringify(value.slice(0, 200)) : typeof value
    fail(`${label} 枚举无效 received=${received} allowed=${allowed.join(',')}`)
  }
  return value as T
}

function textArray(value: unknown, label: string, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${label} 数量无效`)
  const parsed = value.map((item, index) => text(item, `${label}[${index}]`, 500))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return parsed
}

export interface TextAdventureArchitectureLocationV1 {
  title: string
  description: string
  tags: string[]
}

export interface TextAdventureArchitectureAreaV1 {
  title: string
  description: string
  locations: TextAdventureArchitectureLocationV1[]
}

export interface TextAdventureArchitectureRegionV1 {
  title: string
  description: string
  areas: TextAdventureArchitectureAreaV1[]
}

export interface TextAdventureArchitectureArtifactV1 {
  schema: 'storyforge.text-adventure-architecture-artifact'
  version: 1
  title: string
  premise: string
  emotionalPromise: string
  themes: string[]
  regions: TextAdventureArchitectureRegionV1[]
  visualBible: {
    style: string
    palette: string[]
    compositionRules: string[]
    characterAnchorNotes: string[]
  }
}

export function parseTextAdventureArchitectureArtifactV1(
  value: unknown,
  brief: TextAdventureProductionBriefV1,
): TextAdventureArchitectureArtifactV1 {
  const row = record(value, 'architecture')
  exactKeys(row, [
    'schema', 'version', 'title', 'premise', 'emotionalPromise', 'themes', 'regions', 'visualBible',
  ], 'architecture')
  if (row.schema !== 'storyforge.text-adventure-architecture-artifact' || row.version !== 1
    || !Array.isArray(row.regions)) fail('architecture schema/regions 无效')
  const regions = row.regions.map((value, regionIndex) => {
    const region = record(value, `regions[${regionIndex}]`)
    exactKeys(region, ['title', 'description', 'areas'], `regions[${regionIndex}]`)
    if (!Array.isArray(region.areas) || region.areas.length < 1 || region.areas.length > 12) {
      fail(`regions[${regionIndex}].areas 数量无效`)
    }
    const areas = region.areas.map((value, areaIndex) => {
      const area = record(value, `regions[${regionIndex}].areas[${areaIndex}]`)
      exactKeys(area, ['title', 'description', 'locations'], `regions[${regionIndex}].areas[${areaIndex}]`)
      if (!Array.isArray(area.locations) || area.locations.length < 1 || area.locations.length > 16) {
        fail(`regions[${regionIndex}].areas[${areaIndex}].locations 数量无效`)
      }
      return {
        title: text(area.title, `regions[${regionIndex}].areas[${areaIndex}].title`, 300),
        description: text(area.description, `regions[${regionIndex}].areas[${areaIndex}].description`),
        locations: area.locations.map((value, locationIndex) => {
          const location = record(value, `location[${locationIndex}]`)
          exactKeys(location, ['title', 'description', 'tags'], `location[${locationIndex}]`)
          return {
            title: text(location.title, `location[${locationIndex}].title`, 300),
            description: text(location.description, `location[${locationIndex}].description`),
            tags: textArray(location.tags, `location[${locationIndex}].tags`, 1, 12),
          }
        }),
      }
    })
    return {
      title: text(region.title, `regions[${regionIndex}].title`, 300),
      description: text(region.description, `regions[${regionIndex}].description`),
      areas,
    }
  })
  const areaCount = regions.reduce((sum, region) => sum + region.areas.length, 0)
  const locationCount = regions.reduce((sum, region) => (
    sum + region.areas.reduce((areaSum, area) => areaSum + area.locations.length, 0)
  ), 0)
  if (regions.length < brief.narrative.targetRegionCount
    || areaCount < brief.narrative.targetAreaCount
    || locationCount < brief.narrative.targetLocationCount) {
    fail(`空间规模不足:regions=${regions.length},areas=${areaCount},locations=${locationCount}`)
  }
  const visualBible = record(row.visualBible, 'visualBible')
  exactKeys(visualBible, ['style', 'palette', 'compositionRules', 'characterAnchorNotes'], 'visualBible')
  return {
    schema: 'storyforge.text-adventure-architecture-artifact', version: 1,
    title: text(row.title, 'title', 300), premise: text(row.premise, 'premise'),
    emotionalPromise: text(row.emotionalPromise, 'emotionalPromise'),
    themes: textArray(row.themes, 'themes', 1, 12), regions,
    visualBible: {
      style: text(visualBible.style, 'visualBible.style', 2_000),
      palette: textArray(visualBible.palette, 'visualBible.palette', 3, 8),
      compositionRules: textArray(visualBible.compositionRules, 'visualBible.compositionRules', 2, 12),
      characterAnchorNotes: textArray(visualBible.characterAnchorNotes, 'visualBible.characterAnchorNotes', 1, 12),
    },
  }
}

export interface TextAdventureSystemsArtifactV1 {
  schema: 'storyforge.text-adventure-systems-artifact'
  version: 1
  abilities: Array<{
    key: string
    title: string
    description: string
    role: AdventureAbilityRoleV2
    initial: number
    minimum: number
    maximum: number
  }>
  resources: Array<{
    key: string
    title: string
    description: string
    role: Exclude<AdventureResourceRoleV2, 'custom'>
    initial: number
    minimum: number
    maximum: number
  }>
  equipmentSlots: Array<{ key: string; title: string; acceptsTags: string[] }>
  starterEquipment: Array<{
    key: string
    title: string
    description: string
    slotKey: string
    tags: string[]
    modifierAbilityKey: string
    modifierDelta: number
  }>
}

export function parseTextAdventureSystemsArtifactV1(
  value: unknown,
  brief: TextAdventureProductionBriefV1,
): TextAdventureSystemsArtifactV1 {
  const row = record(value, 'systems')
  exactKeys(row, ['schema', 'version', 'abilities', 'resources', 'equipmentSlots', 'starterEquipment'], 'systems')
  if (row.schema !== 'storyforge.text-adventure-systems-artifact' || row.version !== 1
    || !Array.isArray(row.abilities) || !Array.isArray(row.resources)
    || !Array.isArray(row.equipmentSlots) || !Array.isArray(row.starterEquipment)) {
    fail('systems schema/数组无效')
  }
  const abilities = row.abilities.map((value, index) => {
    const item = record(value, `abilities[${index}]`)
    exactKeys(item, ['key', 'title', 'description', 'role', 'initial', 'minimum', 'maximum'], `abilities[${index}]`)
    const minimum = integer(item.minimum, `abilities[${index}].minimum`, 0, 10_000)
    const maximum = integer(item.maximum, `abilities[${index}].maximum`, minimum + 1, 10_000)
    const initial = integer(item.initial, `abilities[${index}].initial`, minimum, maximum)
    return {
      key: key(item.key, `abilities[${index}].key`), title: text(item.title, `abilities[${index}].title`, 200),
      description: text(item.description, `abilities[${index}].description`, 1_000),
      role: enumValue(item.role, ['stat', 'skill'], `abilities[${index}].role`), initial, minimum, maximum,
    }
  })
  if (!abilities.some(item => item.role === 'stat') || !abilities.some(item => item.role === 'skill')) {
    fail('systems 必须同时包含 stat 和 skill')
  }
  if (new Set(abilities.map(item => item.key)).size !== abilities.length) fail('ability key 重复')
  const resources = row.resources.map((value, index) => {
    const item = record(value, `resources[${index}]`)
    exactKeys(item, ['key', 'title', 'description', 'role', 'initial', 'minimum', 'maximum'], `resources[${index}]`)
    const minimum = integer(item.minimum, `resources[${index}].minimum`, 0, 10_000_000)
    const maximum = integer(item.maximum, `resources[${index}].maximum`, minimum + 1, 10_000_000)
    const initial = integer(item.initial, `resources[${index}].initial`, minimum, maximum)
    return {
      key: key(item.key, `resources[${index}].key`), title: text(item.title, `resources[${index}].title`, 200),
      description: text(item.description, `resources[${index}].description`, 1_000),
      role: enumValue(item.role, ['health', 'mana', 'stamina', 'experience', 'skill-points', 'currency', 'clock'], `resources[${index}].role`),
      initial, minimum, maximum,
    }
  })
  const roles = new Set(resources.map(item => item.role))
  if (brief.character.resourceRoles.some(role => !roles.has(role))) fail('systems 缺少 Brief 要求的资源角色')
  const health = resources.find(item => item.role === 'health')
  if (!health || health.initial <= health.minimum) {
    fail('health 初始值必须高于下限，确保失败推进能够安全结算代价')
  }
  const clock = resources.find(item => item.role === 'clock')
  if (!clock || clock.initial !== 0 || clock.minimum !== 0) {
    fail('clock 必须以分钟记录开局后经过时间，且 initial/minimum 必须为 0')
  }
  if (new Set(resources.map(item => item.key)).size !== resources.length
    || new Set(resources.map(item => item.role)).size !== resources.length) fail('resource key/role 重复')
  const equipmentSlots = row.equipmentSlots.map((value, index) => {
    const item = record(value, `equipmentSlots[${index}]`)
    exactKeys(item, ['key', 'title', 'acceptsTags'], `equipmentSlots[${index}]`)
    return {
      key: key(item.key, `equipmentSlots[${index}].key`), title: text(item.title, `equipmentSlots[${index}].title`, 200),
      acceptsTags: textArray(item.acceptsTags, `equipmentSlots[${index}].acceptsTags`, 1, 12),
    }
  })
  if (equipmentSlots.length < 2 || new Set(equipmentSlots.map(item => item.key)).size !== equipmentSlots.length) {
    fail('equipmentSlots 数量或 key 无效')
  }
  const slotKeys = new Set(equipmentSlots.map(item => item.key))
  const abilityKeys = new Set(abilities.map(item => item.key))
  const starterEquipment = row.starterEquipment.map((value, index) => {
    const item = record(value, `starterEquipment[${index}]`)
    exactKeys(item, [
      'key', 'title', 'description', 'slotKey', 'tags', 'modifierAbilityKey', 'modifierDelta',
    ], `starterEquipment[${index}]`)
    const parsed = {
      key: key(item.key, `starterEquipment[${index}].key`), title: text(item.title, `starterEquipment[${index}].title`, 200),
      description: text(item.description, `starterEquipment[${index}].description`, 1_000),
      slotKey: key(item.slotKey, `starterEquipment[${index}].slotKey`),
      tags: textArray(item.tags, `starterEquipment[${index}].tags`, 1, 12),
      modifierAbilityKey: key(item.modifierAbilityKey, `starterEquipment[${index}].modifierAbilityKey`),
      modifierDelta: integer(item.modifierDelta, `starterEquipment[${index}].modifierDelta`, 1, 100),
    }
    if (!slotKeys.has(parsed.slotKey) || !abilityKeys.has(parsed.modifierAbilityKey)) {
      fail(`starterEquipment[${index}] 引用不存在槽位或能力`)
    }
    const slot = equipmentSlots.find(candidate => candidate.key === parsed.slotKey)!
    if (!parsed.tags.some(tag => slot.acceptsTags.includes(tag))) fail(`starterEquipment[${index}] 标签与槽位不兼容`)
    return parsed
  })
  if (!starterEquipment.length || new Set(starterEquipment.map(item => item.key)).size !== starterEquipment.length) {
    fail('starterEquipment 必须非空且 key 唯一')
  }
  return {
    schema: 'storyforge.text-adventure-systems-artifact', version: 1,
    abilities, resources, equipmentSlots, starterEquipment,
  }
}

export interface TextAdventureQuestBundleArtifactV1 {
  schema: 'storyforge.text-adventure-quest-bundle-artifact'
  version: 1
  bundleKind: 'side' | 'ambient'
  entries: Array<{
    key: string
    title: string
    description: string
    hook: string
    objective: string
    locationOrdinal: number
    abilityKey: string
    difficulty: number
    successText: string
    costlySuccessText: string
    failureText: string
    rewardExperience: number
    rewardCurrency: number
    timeCostMinutes: number
  }>
}

export interface TextAdventureQualityReviewArtifactV1 {
  schema: 'storyforge.text-adventure-quality-review-artifact'
  version: 1
  scores: {
    causality: number
    playerAgency: number
    routeDifferentiation: number
    pacing: number
    setupPayoff: number
    characterMotivation: number
    emotionalImpact: number
  }
  issues: Array<{
    severity: 'warning' | 'blocking'
    artifactKey: 'content.story-bible' | 'content.cast-bible' | 'content.adventure-architecture'
      | 'content.narrative-arc-plan' | 'content.main-quest-plan' | 'content.quest-script'
      | 'content.scene-script.act-1' | 'content.scene-script.act-2' | 'content.scene-script.act-3'
      | 'content.dialogue-pass.act-1' | 'content.dialogue-pass.act-2' | 'content.dialogue-pass.act-3'
      | 'content.narrative' | 'content.product-module'
      | 'content.adventure-side-quests' | 'content.adventure-ambient-events'
    detail: string
    recommendation: string
  }>
  passed: boolean
}

/**
 * A V1 quest bundle compiles every entry into one action at one location. Keep
 * the player-facing hook aligned with that deterministic location instead of
 * allowing prose about one place to surface as an action somewhere else.
 */
export function validateTextAdventureQuestBundleLocationAnchorsV1(
  bundle: TextAdventureQuestBundleArtifactV1,
  locationTitles: readonly string[],
): string[] {
  if (!locationTitles.length) return ['地点清单为空，无法核验任务发生地']
  const issues: string[] = []
  bundle.entries.forEach((entry, index) => {
    const assignedTitle = locationTitles[entry.locationOrdinal - 1]
    if (!assignedTitle) {
      issues.push(`${bundle.bundleKind}[${index}] locationOrdinal=${entry.locationOrdinal} 超出地点清单上限 ${locationTitles.length}`)
      return
    }
    const actionSurface = [entry.title, entry.description, entry.hook, entry.objective].join('\n')
    if (!actionSurface.includes(assignedTitle)) {
      issues.push(`${bundle.bundleKind}[${index}] 未在标题、描述、钩子或目标中明确发生地「${assignedTitle}」`)
    }
    const conflictingTitles = locationTitles.filter((title, titleIndex) => (
      titleIndex !== entry.locationOrdinal - 1
      && title !== assignedTitle
      && !assignedTitle.includes(title)
      && actionSurface.includes(title)
    ))
    if (conflictingTitles.length) {
      issues.push(`${bundle.bundleKind}[${index}] 绑定「${assignedTitle}」却把行动写在「${[...new Set(conflictingTitles)].join('、')}」`)
    }
  })
  return issues
}

export function parseTextAdventureQualityReviewArtifactV1(
  value: unknown,
): TextAdventureQualityReviewArtifactV1 {
  const row = record(value, 'qualityReview')
  exactKeys(row, ['schema', 'version', 'scores', 'issues', 'passed'], 'qualityReview')
  if (row.schema !== 'storyforge.text-adventure-quality-review-artifact' || row.version !== 1
    || !Array.isArray(row.issues)) fail('qualityReview schema/issues 无效')
  const scores = record(row.scores, 'qualityReview.scores')
  const scoreKeys = [
    'causality', 'playerAgency', 'routeDifferentiation', 'pacing', 'setupPayoff',
    'characterMotivation', 'emotionalImpact',
  ] as const
  exactKeys(scores, scoreKeys, 'qualityReview.scores')
  const parsedScores = Object.fromEntries(scoreKeys.map(scoreKey => [
    scoreKey, integer(scores[scoreKey], `qualityReview.scores.${scoreKey}`, 1, 5),
  ])) as unknown as TextAdventureQualityReviewArtifactV1['scores']
  const artifactKeys: TextAdventureQualityReviewArtifactV1['issues'][number]['artifactKey'][] = [
    'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
    'content.narrative-arc-plan', 'content.main-quest-plan', 'content.quest-script',
    'content.scene-script.act-1', 'content.scene-script.act-2', 'content.scene-script.act-3',
    'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3',
    'content.narrative', 'content.product-module',
    'content.adventure-side-quests', 'content.adventure-ambient-events',
  ]
  const issues = row.issues.map((value, index) => {
    const issue = record(value, `qualityReview.issues[${index}]`)
    exactKeys(issue, ['severity', 'artifactKey', 'detail', 'recommendation'], `qualityReview.issues[${index}]`)
    return {
      severity: enumValue(issue.severity, ['warning', 'blocking'], `qualityReview.issues[${index}].severity`),
      artifactKey: enumValue(issue.artifactKey, artifactKeys, `qualityReview.issues[${index}].artifactKey`),
      detail: text(issue.detail, `qualityReview.issues[${index}].detail`, 2_000),
      recommendation: text(issue.recommendation, `qualityReview.issues[${index}].recommendation`, 2_000),
    }
  })
  if (issues.length > 100) fail('qualityReview.issues 超出上限')
  // `passed` is a deterministic projection of the review evidence, not a
  // model-owned decision. Still require the model field to be a boolean so
  // malformed protocol cannot pass silently, then canonicalize it below.
  bool(row.passed, 'qualityReview.passed')
  const expectedPassed = !issues.some(issue => issue.severity === 'blocking')
    && Object.values(parsedScores).every(score => score >= 3)
  return {
    schema: 'storyforge.text-adventure-quality-review-artifact', version: 1,
    scores: parsedScores, issues, passed: expectedPassed,
  }
}

export function parseTextAdventureQuestBundleArtifactV1(
  value: unknown,
  expectedKind: TextAdventureQuestBundleArtifactV1['bundleKind'],
  expectedCount: number,
  locationTitles: readonly string[] = [],
): TextAdventureQuestBundleArtifactV1 {
  const row = record(value, `${expectedKind}Bundle`)
  exactKeys(row, ['schema', 'version', 'bundleKind', 'entries'], `${expectedKind}Bundle`)
  if (row.schema !== 'storyforge.text-adventure-quest-bundle-artifact' || row.version !== 1
    || row.bundleKind !== expectedKind || !Array.isArray(row.entries)) fail(`${expectedKind}Bundle schema/kind 无效`)
  if (row.entries.length < expectedCount || row.entries.length > Math.max(expectedCount, 32)) {
    fail(`${expectedKind}Bundle 条目少于 Brief 目标:${expectedCount}`)
  }
  const entries = row.entries.map((value, index) => {
    const item = record(value, `${expectedKind}[${index}]`)
    exactKeys(item, [
      'key', 'title', 'description', 'hook', 'objective', 'locationOrdinal', 'abilityKey', 'difficulty',
      'successText', 'costlySuccessText', 'failureText', 'rewardExperience', 'rewardCurrency', 'timeCostMinutes',
    ], `${expectedKind}[${index}]`)
    return {
      key: key(item.key, `${expectedKind}[${index}].key`), title: text(item.title, `${expectedKind}[${index}].title`, 300),
      description: text(item.description, `${expectedKind}[${index}].description`),
      hook: text(item.hook, `${expectedKind}[${index}].hook`, 2_000),
      objective: text(item.objective, `${expectedKind}[${index}].objective`, 2_000),
      locationOrdinal: integer(item.locationOrdinal, `${expectedKind}[${index}].locationOrdinal`, 1, 48),
      abilityKey: key(item.abilityKey, `${expectedKind}[${index}].abilityKey`),
      difficulty: integer(item.difficulty, `${expectedKind}[${index}].difficulty`, 1, 100),
      successText: text(item.successText, `${expectedKind}[${index}].successText`, 8_000),
      costlySuccessText: text(item.costlySuccessText, `${expectedKind}[${index}].costlySuccessText`, 8_000),
      failureText: text(item.failureText, `${expectedKind}[${index}].failureText`, 8_000),
      rewardExperience: integer(item.rewardExperience, `${expectedKind}[${index}].rewardExperience`, 0, 100_000),
      rewardCurrency: integer(item.rewardCurrency, `${expectedKind}[${index}].rewardCurrency`, 0, 100_000),
      timeCostMinutes: integer(item.timeCostMinutes, `${expectedKind}[${index}].timeCostMinutes`, 1, 10_000),
    }
  })
  if (new Set(entries.map(item => item.key)).size !== entries.length) fail(`${expectedKind}Bundle key 重复`)
  const result: TextAdventureQuestBundleArtifactV1 = {
    schema: 'storyforge.text-adventure-quest-bundle-artifact', version: 1, bundleKind: expectedKind, entries,
  }
  if (locationTitles.length) {
    const locationIssues = validateTextAdventureQuestBundleLocationAnchorsV1(result, locationTitles)
    if (locationIssues.length) fail(`${expectedKind}Bundle 地点锚点无效:${locationIssues.join('；')}`)
  }
  return result
}
