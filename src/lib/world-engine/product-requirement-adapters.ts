import type {
  ContextResourceKind,
  WorldCapabilityArea,
} from '../registry/types'
import type {
  GameProductType,
  GameProductionSourceSelectionV1,
  WorldRequirementRuleV1,
} from '../types'
import type { WorldRequirementAdapterV1 } from './product-source-contracts'

function selector(input: {
  areas: WorldCapabilityArea[]
  resourceKinds?: string[]
  contextKinds: ContextResourceKind[]
  query?: string | null
}): WorldRequirementRuleV1['selector'] {
  return {
    areas: input.areas,
    resourceKinds: input.resourceKinds ?? [],
    contextKinds: input.contextKinds,
    query: input.query ?? null,
  }
}

export interface TtrpgWorldRequirementGoalV1 {
  allowCrossWorld: boolean
  useManuscriptContinuity: boolean
  investigationHeavy: boolean
}

export const TTRPG_WORLD_REQUIREMENT_ADAPTER_V1: WorldRequirementAdapterV1<TtrpgWorldRequirementGoalV1> = {
  adapterId: 'storyforge.ttrpg.world-requirements',
  adapterVersion: 1,
  productType: 'ttrpg',
  contextTaskKind: 'agent-outline',
  resolve: goal => [
    {
      key: 'world-grounding', label: '世界基础与规则', level: 'stable-required', minimumResources: 1,
      selector: selector({ areas: ['foundation', 'entities'], contextKinds: ['world', 'worldview-field', 'location', 'fact'] }),
      condition: null,
    },
    {
      key: 'playable-cast', label: '可用角色', level: 'stable-required', minimumResources: 1,
      selector: selector({ areas: ['characters'], resourceKinds: ['character'], contextKinds: ['character'] }),
      condition: null,
    },
    {
      key: 'cast-story-roles', label: '角色在作品中的身份与弧光', level: 'recommended', minimumResources: 1,
      selector: selector({ areas: ['characters'], resourceKinds: ['work-character-binding'], contextKinds: ['character'] }),
      condition: null,
    },
    {
      key: 'story-and-fronts', label: '故事、主支线与结构', level: 'recommended', minimumResources: 1,
      selector: selector({
        areas: ['story', 'storylines', 'outline', 'detailed-outline'],
        contextKinds: ['story-core-field', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'foreshadow'],
      }),
      condition: null,
    },
    {
      key: 'investigation-evidence', label: '调查事实与地点', level: 'conditional', minimumResources: 1,
      selector: selector({
        areas: ['entities', 'story'],
        contextKinds: ['codex-entry', 'location', 'fact', 'foreshadow'],
        query: goal.investigationHeavy ? null : 'inactive-investigation',
      }),
      condition: { key: 'investigationHeavy', active: goal.investigationHeavy, reason: '调查型跑团需要事实、线索与地点证据' },
    },
    {
      key: 'cross-world-travel', label: '多世界连接', level: 'conditional', minimumResources: 1,
      selector: selector({ areas: ['multi-world'], contextKinds: ['world', 'world-link'] }),
      condition: { key: 'allowCrossWorld', active: goal.allowCrossWorld, reason: '仅跨世界跑团读取世界关系与通道' },
    },
    {
      key: 'published-manuscript', label: '封存正文连续性', level: 'conditional', minimumResources: 1,
      selector: selector({ areas: ['manuscript'], resourceKinds: ['chapter'], contextKinds: ['chapter'] }),
      condition: { key: 'useManuscriptContinuity', active: goal.useManuscriptContinuity, reason: '仅在用户选择继承正文连续性时读取' },
    },
  ],
}

export interface CharacterInteractionWorldRequirementGoalV1 {
  participantCount: number
  inheritStoryContinuity: boolean
  allowCrossWorld: boolean
}

export const CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V1: WorldRequirementAdapterV1<CharacterInteractionWorldRequirementGoalV1> = {
  adapterId: 'storyforge.character-interaction.world-requirements',
  adapterVersion: 1,
  productType: 'character-interaction',
  contextTaskKind: 'agent-outline',
  resolve: goal => [
    {
      key: 'conversation-cast', label: '聊天角色身份', level: 'stable-required', minimumResources: Math.max(1, goal.participantCount),
      selector: selector({ areas: ['characters'], resourceKinds: ['character'], contextKinds: ['character'] }),
      condition: null,
    },
    {
      key: 'conversation-cast-roles', label: '聊天角色在作品中的身份与弧光', level: 'recommended', minimumResources: 1,
      selector: selector({ areas: ['characters'], resourceKinds: ['work-character-binding'], contextKinds: ['character'] }),
      condition: null,
    },
    {
      key: 'participant-relations', label: '参与角色关系', level: 'conditional', minimumResources: 1,
      selector: selector({ areas: ['relations'], contextKinds: ['character-relation'] }),
      condition: { key: 'multipleParticipants', active: goal.participantCount > 1, reason: '多人聊天必须了解参与角色之间的关系与知识边界' },
    },
    {
      key: 'identity-context', label: '角色所属世界语境', level: 'recommended', minimumResources: 1,
      selector: selector({ areas: ['foundation', 'entities'], contextKinds: ['world', 'worldview-field', 'location', 'codex-entry', 'fact'] }),
      condition: null,
    },
    {
      key: 'story-continuity', label: '既有故事连续性', level: 'conditional', minimumResources: 1,
      selector: selector({
        areas: ['story', 'storylines', 'outline', 'detailed-outline', 'manuscript'],
        contextKinds: ['story-core-field', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter', 'foreshadow'],
      }),
      condition: { key: 'inheritStoryContinuity', active: goal.inheritStoryContinuity, reason: '继承原作时间点时读取故事与正文证据' },
    },
    {
      key: 'cross-world-knowledge', label: '跨世界认知', level: 'conditional', minimumResources: 1,
      selector: selector({ areas: ['multi-world'], contextKinds: ['world', 'world-link'] }),
      condition: { key: 'allowCrossWorld', active: goal.allowCrossWorld, reason: '只有跨世界对话才允许读取世界关系' },
    },
  ],
}

/**
 * Product-neutral input used by the generic Game Production Harness.  The
 * concrete facets are resolved from the author's frozen selection before the
 * adapter is snapshotted; product code never receives a global world wildcard.
 */
export interface GameProductWorldRequirementGoalV1 {
  selectedAreas: WorldCapabilityArea[]
  selectedResourceKinds: string[]
  selectedContextKinds: ContextResourceKind[]
  selectedResourceCount: number
  participantCount: number
  includeSelectedRelations: boolean
  inheritStoryContinuity: boolean
  allowCrossWorld: boolean
}

const PRODUCT_AREAS: Readonly<Record<GameProductType, WorldCapabilityArea[]>> = {
  storygame: ['foundation', 'characters', 'relations', 'story', 'storylines', 'outline', 'detailed-outline', 'manuscript', 'entities'],
  'character-interaction': ['foundation', 'characters', 'relations', 'story', 'storylines', 'entities', 'multi-world'],
  'text-adventure': ['foundation', 'characters', 'relations', 'story', 'storylines', 'outline', 'detailed-outline', 'entities', 'multi-world'],
  avg: ['foundation', 'characters', 'relations', 'story', 'storylines', 'outline', 'detailed-outline', 'manuscript', 'entities'],
  'narrative-simulation': ['foundation', 'characters', 'relations', 'story', 'storylines', 'entities', 'multi-world'],
  'text-open-world': ['foundation', 'characters', 'relations', 'story', 'storylines', 'outline', 'detailed-outline', 'manuscript', 'entities', 'multi-world'],
  ttrpg: ['foundation', 'characters', 'relations', 'story', 'storylines', 'outline', 'detailed-outline', 'manuscript', 'entities', 'multi-world'],
}

const PRODUCT_CONTEXT_KINDS: Readonly<Record<GameProductType, ContextResourceKind[]>> = {
  storygame: ['world', 'worldview-field', 'story-core-field', 'character', 'character-relation', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry', 'fact'],
  'character-interaction': ['world', 'worldview-field', 'character', 'character-relation', 'story-core-field', 'story-arc', 'storyline-progress', 'location', 'codex-entry', 'fact', 'world-link'],
  'text-adventure': ['world', 'worldview-field', 'story-core-field', 'character', 'character-relation', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'foreshadow', 'location', 'codex-entry', 'fact', 'world-link'],
  avg: ['world', 'worldview-field', 'story-core-field', 'character', 'character-relation', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry', 'fact'],
  'narrative-simulation': ['world', 'worldview-field', 'story-core-field', 'character', 'character-relation', 'story-arc', 'storyline-progress', 'foreshadow', 'location', 'codex-entry', 'fact', 'world-link'],
  'text-open-world': ['world', 'worldview-field', 'world-link', 'story-core-field', 'character', 'character-relation', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry', 'fact'],
  ttrpg: ['world', 'worldview-field', 'world-link', 'story-core-field', 'character', 'character-relation', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry', 'fact'],
}

function gameProductRules(
  productType: GameProductType,
  goal: GameProductWorldRequirementGoalV1,
): WorldRequirementRuleV1[] {
  const selectedAreas = goal.selectedAreas.filter(area => PRODUCT_AREAS[productType].includes(area))
  const selectedContextKinds = goal.selectedContextKinds
    .filter(kind => PRODUCT_CONTEXT_KINDS[productType].includes(kind))
  const rules: WorldRequirementRuleV1[] = [{
    key: 'author-selected-world-sources',
    label: '作者冻结的产品世界来源',
    level: 'stable-required',
    minimumResources: Math.max(1, Math.min(goal.selectedResourceCount, 1)),
    selector: selector({
      areas: selectedAreas.length ? selectedAreas : PRODUCT_AREAS[productType],
      resourceKinds: goal.selectedResourceKinds,
      contextKinds: selectedContextKinds.length ? selectedContextKinds : PRODUCT_CONTEXT_KINDS[productType],
    }),
    condition: null,
  }, {
    key: 'world-grounding',
    label: '世界基础与实体语境',
    level: 'recommended',
    minimumResources: 1,
    selector: selector({
      areas: PRODUCT_AREAS[productType].filter(area => ['foundation', 'entities'].includes(area)),
      contextKinds: PRODUCT_CONTEXT_KINDS[productType].filter(kind => ['world', 'worldview-field', 'location', 'codex-entry', 'fact'].includes(kind)),
    }),
    condition: null,
  }]
  if (goal.participantCount > 0) rules.push({
    key: 'product-cast',
    label: '产品参与角色',
    level: productType === 'character-interaction' || productType === 'ttrpg' ? 'stable-required' : 'recommended',
    minimumResources: Math.max(1, goal.participantCount),
    selector: selector({ areas: ['characters'], resourceKinds: ['character'], contextKinds: ['character'] }),
    condition: null,
  })
  if (goal.includeSelectedRelations && PRODUCT_AREAS[productType].includes('relations')
    && PRODUCT_CONTEXT_KINDS[productType].includes('character-relation')) rules.push({
    key: 'participant-relations',
    label: '入选角色间的冻结关系',
    level: 'recommended',
    minimumResources: 1,
    selector: selector({
      areas: ['relations'],
      resourceKinds: ['character-relation'],
      contextKinds: ['character-relation'],
    }),
    condition: null,
  })
  rules.push({
    key: 'story-continuity',
    label: '既有故事连续性',
    level: 'conditional',
    minimumResources: 1,
    selector: selector({
      areas: ['story', 'storylines', 'outline', 'detailed-outline', 'manuscript']
        .filter((area): area is WorldCapabilityArea => PRODUCT_AREAS[productType].includes(area as WorldCapabilityArea)),
      contextKinds: PRODUCT_CONTEXT_KINDS[productType].filter(kind => [
        'story-core-field', 'story-arc', 'storyline-progress', 'outline-node',
        'detailed-outline', 'chapter', 'foreshadow',
      ].includes(kind)),
    }),
    condition: {
      key: 'inheritStoryContinuity',
      active: goal.inheritStoryContinuity,
      reason: '只有产品明确继承原作进度时才把正文与结构作为连续性约束',
    },
  }, {
    key: 'cross-world-links',
    label: '跨世界连接',
    level: 'conditional',
    minimumResources: 1,
    selector: selector({ areas: ['multi-world'], contextKinds: ['world', 'world-link'] }),
    condition: {
      key: 'allowCrossWorld',
      active: goal.allowCrossWorld,
      reason: '只有产品允许跨世界时才读取世界关系与通道',
    },
  })
  return rules
}

/** The one registry entry used by every generic game product. */
export function getGameProductWorldRequirementAdapterV1(
  productType: GameProductType,
): WorldRequirementAdapterV1<GameProductWorldRequirementGoalV1> {
  return {
    adapterId: `storyforge.game-production.${productType}.world-requirements`,
    adapterVersion: 1,
    productType,
    contextTaskKind: 'agent-outline',
    resolve: goal => gameProductRules(productType, goal),
  }
}

export function gameProductAllowedAreasV1(productType: GameProductType): WorldCapabilityArea[] {
  return [...PRODUCT_AREAS[productType]]
}

export function gameProductAllowedContextKindsV1(productType: GameProductType): ContextResourceKind[] {
  return [...PRODUCT_CONTEXT_KINDS[productType]]
}

/** Product-owned projection from the neutral world selection into semantic
 * roles. Keeping it beside the requirement adapter prevents components and
 * consultation services from inventing a second source contract. */
export function compileGameProductWorldRoleBindingsV1(
  productType: GameProductType,
  catalog: GameProductionSourceSelectionV1,
): Record<string, string[]> {
  if (productType === 'storygame') return { story: [...catalog.storyResourceKeys] }
  if (productType === 'character-interaction') return {
    participants: [...catalog.characterResourceKeys],
    context: [...catalog.storyResourceKeys, ...catalog.storyArcResourceKeys],
  }
  if (productType === 'text-adventure') return {
    locations: [...catalog.importantLocationResourceKeys],
    items: [...catalog.artifactResourceKeys],
    quests: [...catalog.storyArcResourceKeys],
  }
  if (productType === 'avg') return {
    story: [...catalog.storyResourceKeys, ...catalog.storyArcResourceKeys],
    characters: [...catalog.characterResourceKeys],
    locations: [...catalog.importantLocationResourceKeys],
  }
  if (productType === 'narrative-simulation') return {
    issues: [...catalog.storyArcResourceKeys],
    factions: [...catalog.codexEntryResourceKeys],
  }
  if (productType === 'ttrpg') return {
    participants: [...catalog.characterResourceKeys],
    locations: [...catalog.importantLocationResourceKeys],
    quests: [...catalog.storyArcResourceKeys],
  }
  return {
    regions: [...catalog.importantLocationResourceKeys],
    factions: [...catalog.codexEntryResourceKeys],
    quests: [...catalog.storyArcResourceKeys],
  }
}
