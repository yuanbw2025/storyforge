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

function array(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail(`${label} 数量无效`)
  }
  return value
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
  const skillPoints = resources.find(item => item.role === 'skill-points')
  if (!skillPoints || skillPoints.minimum !== 0) {
    fail('skill-points minimum 必须为 0，确保成长点数能够完整分配')
  }
  if (new Set(resources.map(item => item.key)).size !== resources.length
    || new Set(resources.map(item => item.role)).size !== resources.length) fail('resource key/role 重复')

  const abilityTitlesByRole = (role: 'stat' | 'skill') => abilities
    .filter(item => item.role === role)
    .map(item => item.title)
  const statTitles = abilityTitlesByRole('stat')
  const skillTitles = abilityTitlesByRole('skill')
  if (new Set(statTitles).size !== statTitles.length || new Set(skillTitles).size !== skillTitles.length) {
    fail('同一能力角色内的 title 不允许重复')
  }
  const missingStatLabels = brief.character.statLabels.filter(label => !statTitles.includes(label))
  if (missingStatLabels.length) {
    fail(`systems 缺少 Brief 要求的 stat 标签:${missingStatLabels.join('、')}`)
  }
  const missingSkillLabels = brief.character.skillLabels.filter(label => !skillTitles.includes(label))
  if (missingSkillLabels.length) {
    fail(`systems 缺少 Brief 要求的 skill 标签:${missingSkillLabels.join('、')}`)
  }
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
  if (new Set(equipmentSlots.map(item => item.title)).size !== equipmentSlots.length) {
    fail('equipmentSlot title 不允许重复')
  }
  const missingEquipmentSlotLabels = brief.character.equipmentSlotLabels
    .filter(label => !equipmentSlots.some(slot => slot.title === label))
  if (missingEquipmentSlotLabels.length) {
    fail(`systems 缺少 Brief 要求的装备槽:${missingEquipmentSlotLabels.join('、')}`)
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

export interface TextAdventureQuestBundleArtifactV2 {
  schema: 'storyforge.text-adventure-quest-bundle-artifact'
  version: 2
  bundleKind: 'side' | 'ambient'
  entries: Array<{
    key: string
    title: string
    description: string
    hook: string
    stages: Array<{
      key: string
      title: string
      objective: string
      locationOrdinal: number
      actionKind: 'inspect' | 'attempt' | 'use' | 'quest-action'
      abilityKey: string
      difficulty: number
      successText: string
      costlySuccessText: string
      failureText: string
      timeCostMinutes: number
    }>
    rewardExperience: number
    rewardCurrency: number
  }>
}

export const TEXT_ADVENTURE_QUALITY_REVIEW_SCORE_KEYS_V1 = [
  'causality', 'playerAgency', 'routeDifferentiation', 'pacing', 'setupPayoff',
  'characterMotivation', 'emotionalImpact',
] as const

export type TextAdventureQualityReviewScoreKeyV1 =
  typeof TEXT_ADVENTURE_QUALITY_REVIEW_SCORE_KEYS_V1[number]

export const TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1 = [
  'structure', 'act-1', 'act-2', 'act-3',
] as const

export type TextAdventureQualityReviewScopeV1 =
  typeof TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1[number]

export const TEXT_ADVENTURE_QUALITY_REVIEW_SCORE_KEYS_BY_SCOPE_V1 = {
  structure: ['causality', 'routeDifferentiation', 'setupPayoff', 'characterMotivation'],
  'act-1': [
    'causality', 'playerAgency', 'routeDifferentiation', 'pacing',
    'characterMotivation', 'emotionalImpact',
  ],
  'act-2': [
    'causality', 'playerAgency', 'routeDifferentiation', 'pacing',
    'characterMotivation', 'emotionalImpact',
  ],
  'act-3': [
    'causality', 'playerAgency', 'routeDifferentiation', 'pacing',
    'characterMotivation', 'emotionalImpact',
  ],
} as const satisfies Record<TextAdventureQualityReviewScopeV1, readonly TextAdventureQualityReviewScoreKeyV1[]>

export type TextAdventureQualityReviewArtifactKeyV1 =
  | 'content.story-bible' | 'content.cast-bible' | 'content.adventure-architecture'
  | 'content.narrative-arc-plan' | 'content.ending-route-plan'
  | 'content.main-quest-plan' | 'content.quest-script'
  | 'content.scene-script.act-1' | 'content.scene-script.act-2' | 'content.scene-script.act-3'
  | 'content.dialogue-pass.act-1' | 'content.dialogue-pass.act-2' | 'content.dialogue-pass.act-3'
  | 'content.narrative' | 'content.product-module'
  | 'content.adventure-side-quests' | 'content.adventure-ambient-events'

export interface TextAdventureQualityReviewIssueV1 {
  severity: 'warning' | 'blocking'
  artifactKey: TextAdventureQualityReviewArtifactKeyV1
  detail: string
  recommendation: string
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
  issues: TextAdventureQualityReviewIssueV1[]
  passed: boolean
}

/**
 * Private per-scope evidence produced by the four independent Continuity
 * Editor Runs. The public review contract above intentionally remains stable;
 * a deterministic task aggregates these bounded scorecards after all Runs
 * have durable receipts.
 */
export interface TextAdventureQualityReviewBatchArtifactV1 {
  schema: 'storyforge.text-adventure-quality-review-batch-artifact'
  version: 1
  scope: TextAdventureQualityReviewScopeV1
  scores: Partial<Record<TextAdventureQualityReviewScoreKeyV1, number>>
  issues: TextAdventureQualityReviewIssueV1[]
  passed: boolean
}

/**
 * Each supplemental stage compiles into one deterministic action. Validate
 * the player-facing stage against its own location instead of forcing a real
 * multi-stage side quest into a single-location summary.
 */
export function validateTextAdventureQuestBundleLocationAnchorsV2(
  bundle: TextAdventureQuestBundleArtifactV2,
  locationTitles: readonly string[],
): string[] {
  if (!locationTitles.length) return ['地点清单为空，无法核验任务发生地']
  const issues: string[] = []
  bundle.entries.forEach((entry, index) => {
    entry.stages.forEach((stage, stageIndex) => {
      const assignedTitle = locationTitles[stage.locationOrdinal - 1]
      if (!assignedTitle) {
        issues.push(`${bundle.bundleKind}[${index}].stages[${stageIndex}] locationOrdinal=${stage.locationOrdinal} 超出地点清单上限 ${locationTitles.length}`)
        return
      }
      const actionSurface = [stage.title, stage.objective, stage.successText, stage.costlySuccessText, stage.failureText].join('\n')
      if (!actionSurface.includes(assignedTitle)) {
        issues.push(`${bundle.bundleKind}[${index}].stages[${stageIndex}] 未在阶段目标或结算文本中明确发生地「${assignedTitle}」`)
      }
      // Outcomes may legitimately point toward the next registered place. Only
      // the stage title/objective are authoritative for where this action is
      // performed; treating every future-place mention as a conflict would
      // reject valid fail-forward transitions.
      const decisiveSurface = [stage.title, stage.objective].join('\n')
      const conflictingTitles = locationTitles.filter((title, titleIndex) => (
        titleIndex !== stage.locationOrdinal - 1
        && title !== assignedTitle
        && !assignedTitle.includes(title)
        && decisiveSurface.includes(title)
      ))
      if (conflictingTitles.length) {
        issues.push(`${bundle.bundleKind}[${index}].stages[${stageIndex}] 绑定「${assignedTitle}」却把行动写在「${[...new Set(conflictingTitles)].join('、')}」`)
      }
    })
  })
  return issues
}

export const TEXT_ADVENTURE_QUALITY_REVIEW_ARTIFACT_KEYS_V1: readonly TextAdventureQualityReviewArtifactKeyV1[] = [
  'content.story-bible', 'content.cast-bible', 'content.adventure-architecture',
  'content.narrative-arc-plan', 'content.ending-route-plan',
  'content.main-quest-plan', 'content.quest-script',
  'content.scene-script.act-1', 'content.scene-script.act-2', 'content.scene-script.act-3',
  'content.dialogue-pass.act-1', 'content.dialogue-pass.act-2', 'content.dialogue-pass.act-3',
  'content.narrative', 'content.product-module',
  'content.adventure-side-quests', 'content.adventure-ambient-events',
]

function parseTextAdventureQualityReviewIssuesV1(
  value: unknown,
  label: string,
  maximum = 100,
): TextAdventureQualityReviewIssueV1[] {
  if (!Array.isArray(value)) fail(`${label} 必须是数组`)
  const normalizeArtifactKey = (value: unknown, issueLabel: string) => {
    if (typeof value !== 'string') {
      return enumValue(value, TEXT_ADVENTURE_QUALITY_REVIEW_ARTIFACT_KEYS_V1, issueLabel)
    }
    // One OpenAI-compatible reviewer used this exact near-synonym for the
    // registered narrative-arc owner. It has a single unambiguous target and
    // changes no field/state authority, so normalize only this observed alias;
    // all other unknown roots continue to fail closed below.
    const exactAliases: Readonly<Record<string, TextAdventureQualityReviewArtifactKeyV1>> = {
      'content.adventure-arc-plan': 'content.narrative-arc-plan',
    }
    const aliased = exactAliases[value] ?? value
    // Reviewers sometimes append a field address (for example
    // `content.narrative.choices`) even though the contract asks for the
    // owning artifact key. A field address does not create a new artifact or
    // change repair ownership, so deterministically collapse only a path that
    // is rooted in one of the registered artifact keys. Unknown roots remain
    // fail-closed.
    const owner = [...TEXT_ADVENTURE_QUALITY_REVIEW_ARTIFACT_KEYS_V1]
      .sort((left, right) => right.length - left.length)
      .find(key => aliased === key || aliased.startsWith(`${key}.`) || aliased.startsWith(`${key}[`))
    return enumValue(owner ?? aliased, TEXT_ADVENTURE_QUALITY_REVIEW_ARTIFACT_KEYS_V1, issueLabel)
  }
  const issues = value.map((item, index) => {
    const issue = record(item, `${label}[${index}]`)
    exactKeys(issue, ['severity', 'artifactKey', 'detail', 'recommendation'], `${label}[${index}]`)
    return {
      severity: enumValue(issue.severity, ['warning', 'blocking'], `${label}[${index}].severity`),
      artifactKey: normalizeArtifactKey(issue.artifactKey, `${label}[${index}].artifactKey`),
      detail: text(issue.detail, `${label}[${index}].detail`, 2_000),
      recommendation: text(issue.recommendation, `${label}[${index}].recommendation`, 2_000),
    }
  })
  if (issues.length > maximum) fail(`${label} 超出上限`)
  return issues
}

export function parseTextAdventureQualityReviewArtifactV1(
  value: unknown,
): TextAdventureQualityReviewArtifactV1 {
  const row = record(value, 'qualityReview')
  exactKeys(row, ['schema', 'version', 'scores', 'issues', 'passed'], 'qualityReview')
  if (row.schema !== 'storyforge.text-adventure-quality-review-artifact' || row.version !== 1) {
    fail('qualityReview schema 无效')
  }
  const scores = record(row.scores, 'qualityReview.scores')
  exactKeys(scores, TEXT_ADVENTURE_QUALITY_REVIEW_SCORE_KEYS_V1, 'qualityReview.scores')
  const parsedScores = Object.fromEntries(TEXT_ADVENTURE_QUALITY_REVIEW_SCORE_KEYS_V1.map(scoreKey => [
    scoreKey, integer(scores[scoreKey], `qualityReview.scores.${scoreKey}`, 1, 5),
  ])) as unknown as TextAdventureQualityReviewArtifactV1['scores']
  const issues = parseTextAdventureQualityReviewIssuesV1(row.issues, 'qualityReview.issues')
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

export function parseTextAdventureQualityReviewBatchArtifactV1(
  value: unknown,
  expectedScope?: TextAdventureQualityReviewScopeV1,
): TextAdventureQualityReviewBatchArtifactV1 {
  const row = record(value, 'qualityReviewBatch')
  // `passed` is a derived verdict rather than model-owned evidence. Accept
  // legacy candidates that still include it, but do not reject an otherwise
  // complete review merely because the provider omitted the redundant field.
  // Unknown fields remain fail-closed in both shapes.
  const hasPassed = Object.prototype.hasOwnProperty.call(row, 'passed')
  exactKeys(
    row,
    hasPassed
      ? ['schema', 'version', 'scope', 'scores', 'issues', 'passed']
      : ['schema', 'version', 'scope', 'scores', 'issues'],
    'qualityReviewBatch',
  )
  const scope = enumValue(
    row.scope,
    TEXT_ADVENTURE_QUALITY_REVIEW_SCOPES_V1,
    'qualityReviewBatch.scope',
  )
  if (row.schema !== 'storyforge.text-adventure-quality-review-batch-artifact' || row.version !== 1) {
    fail('qualityReviewBatch schema 无效')
  }
  if (expectedScope && scope !== expectedScope) {
    fail(`qualityReviewBatch.scope 与任务不一致:${scope}/${expectedScope}`)
  }
  const scores = record(row.scores, 'qualityReviewBatch.scores')
  const scoreKeys = TEXT_ADVENTURE_QUALITY_REVIEW_SCORE_KEYS_BY_SCOPE_V1[scope]
  exactKeys(scores, scoreKeys, 'qualityReviewBatch.scores')
  const parsedScores = Object.fromEntries(scoreKeys.map(scoreKey => [
    scoreKey, integer(scores[scoreKey], `qualityReviewBatch.scores.${scoreKey}`, 1, 5),
  ])) as TextAdventureQualityReviewBatchArtifactV1['scores']
  const issues = parseTextAdventureQualityReviewIssuesV1(row.issues, 'qualityReviewBatch.issues', 20)
  if (hasPassed) bool(row.passed, 'qualityReviewBatch.passed')
  const expectedPassed = !issues.some(issue => issue.severity === 'blocking')
    && Object.values(parsedScores).every(score => score >= 3)
  return {
    schema: 'storyforge.text-adventure-quality-review-batch-artifact',
    version: 1,
    scope,
    scores: parsedScores,
    issues,
    passed: expectedPassed,
  }
}

export function parseTextAdventureQuestBundleArtifactV2(
  value: unknown,
  expectedKind: TextAdventureQuestBundleArtifactV2['bundleKind'],
  expectedCount: number,
  locationTitles: readonly string[] = [],
  allowedAbilityKeys: readonly string[] = [],
): TextAdventureQuestBundleArtifactV2 {
  const row = record(value, `${expectedKind}Bundle`)
  exactKeys(row, ['schema', 'version', 'bundleKind', 'entries'], `${expectedKind}Bundle`)
  if (row.schema !== 'storyforge.text-adventure-quest-bundle-artifact' || row.version !== 2
    || row.bundleKind !== expectedKind || !Array.isArray(row.entries)) fail(`${expectedKind}Bundle schema/kind 无效`)
  if (row.entries.length < expectedCount || row.entries.length > Math.max(expectedCount, 32)) {
    fail(`${expectedKind}Bundle 条目少于 Brief 目标:${expectedCount}`)
  }
  const entries = row.entries.map((value, index) => {
    const item = record(value, `${expectedKind}[${index}]`)
    exactKeys(item, [
      'key', 'title', 'description', 'hook', 'stages', 'rewardExperience', 'rewardCurrency',
    ], `${expectedKind}[${index}]`)
    const stages = array(
      item.stages,
      `${expectedKind}[${index}].stages`,
      expectedKind === 'side' ? 2 : 1,
      expectedKind === 'side' ? 4 : 1,
    ).map((value, stageIndex) => {
      const stage = record(value, `${expectedKind}[${index}].stages[${stageIndex}]`)
      exactKeys(stage, [
        'key', 'title', 'objective', 'locationOrdinal', 'actionKind', 'abilityKey', 'difficulty',
        'successText', 'costlySuccessText', 'failureText', 'timeCostMinutes',
      ], `${expectedKind}[${index}].stages[${stageIndex}]`)
      return {
        key: key(stage.key, `${expectedKind}[${index}].stages[${stageIndex}].key`),
        title: text(stage.title, `${expectedKind}[${index}].stages[${stageIndex}].title`, 300),
        objective: text(stage.objective, `${expectedKind}[${index}].stages[${stageIndex}].objective`, 2_000),
        locationOrdinal: integer(stage.locationOrdinal, `${expectedKind}[${index}].stages[${stageIndex}].locationOrdinal`, 1, 48),
        actionKind: enumValue(
          stage.actionKind,
          ['inspect', 'attempt', 'use', 'quest-action'],
          `${expectedKind}[${index}].stages[${stageIndex}].actionKind`,
        ),
        abilityKey: key(stage.abilityKey, `${expectedKind}[${index}].stages[${stageIndex}].abilityKey`),
        difficulty: integer(stage.difficulty, `${expectedKind}[${index}].stages[${stageIndex}].difficulty`, 2, 30),
        successText: text(stage.successText, `${expectedKind}[${index}].stages[${stageIndex}].successText`, 8_000),
        costlySuccessText: text(stage.costlySuccessText, `${expectedKind}[${index}].stages[${stageIndex}].costlySuccessText`, 8_000),
        failureText: text(stage.failureText, `${expectedKind}[${index}].stages[${stageIndex}].failureText`, 8_000),
        timeCostMinutes: integer(stage.timeCostMinutes, `${expectedKind}[${index}].stages[${stageIndex}].timeCostMinutes`, 1, 120),
      }
    })
    if (new Set(stages.map(stage => stage.key)).size !== stages.length) {
      fail(`${expectedKind}[${index}].stages key 重复`)
    }
    if (expectedKind === 'side' && locationTitles.length > 1
      && new Set(stages.map(stage => stage.locationOrdinal)).size < 2) {
      fail(`${expectedKind}[${index}] 多阶段支线至少跨越两个登记地点`)
    }
    return {
      key: key(item.key, `${expectedKind}[${index}].key`), title: text(item.title, `${expectedKind}[${index}].title`, 300),
      description: text(item.description, `${expectedKind}[${index}].description`),
      hook: text(item.hook, `${expectedKind}[${index}].hook`, 2_000),
      stages,
      rewardExperience: integer(item.rewardExperience, `${expectedKind}[${index}].rewardExperience`, 0, 100_000),
      rewardCurrency: integer(item.rewardCurrency, `${expectedKind}[${index}].rewardCurrency`, 0, 100_000),
    }
  })
  if (new Set(entries.map(item => item.key)).size !== entries.length) fail(`${expectedKind}Bundle key 重复`)
  if (allowedAbilityKeys.length) {
    const allowed = new Set(allowedAbilityKeys)
    const invalid = entries.flatMap(entry => entry.stages.filter(stage => !allowed.has(stage.abilityKey)))
    if (invalid.length) {
      fail(`${expectedKind}Bundle abilityKey 未登记:${invalid.map(stage => stage.abilityKey).join(',')}`)
    }
  }
  const result: TextAdventureQuestBundleArtifactV2 = {
    schema: 'storyforge.text-adventure-quest-bundle-artifact', version: 2, bundleKind: expectedKind, entries,
  }
  if (locationTitles.length) {
    const locationIssues = validateTextAdventureQuestBundleLocationAnchorsV2(result, locationTitles)
    if (locationIssues.length) fail(`${expectedKind}Bundle 地点锚点无效:${locationIssues.join('；')}`)
  }
  return result
}
