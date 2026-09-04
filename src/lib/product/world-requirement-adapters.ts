import type {
  ContextResourceKind,
  WorldCapabilityArea,
} from '../registry/types'
import type {
  ProductionProductKindV1,
  ProductProductionSourceSelectionV1,
  WorldRequirementRuleV1,
} from '../types'
import type { WorldRequirementAdapterV1 } from './source-contracts'

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

/**
 * Product-neutral input used by the shared upper-product Harness. The
 * concrete facets are resolved from the author's frozen selection before the
 * adapter is snapshotted; product code never receives a global world wildcard.
 */
export interface UpperProductWorldRequirementGoalV1 {
  selectedAreas: WorldCapabilityArea[]
  selectedResourceKinds: string[]
  selectedContextKinds: ContextResourceKind[]
  selectedResourceCount: number
  participantCount: number
  includeSelectedRelations: boolean
  inheritStoryContinuity: boolean
  allowCrossWorld: boolean
}

const PRODUCT_AREAS: Readonly<Record<ProductionProductKindV1, WorldCapabilityArea[]>> = {
  'character-interaction': ['foundation', 'characters', 'relations', 'story', 'storylines', 'entities', 'multi-world'],
  'text-adventure': ['foundation', 'characters', 'relations', 'story', 'storylines', 'outline', 'detailed-outline', 'entities', 'multi-world'],
  avg: ['foundation', 'characters', 'relations', 'story', 'storylines', 'outline', 'detailed-outline', 'manuscript', 'entities'],
  'text-open-world': ['foundation', 'characters', 'relations', 'story', 'storylines', 'outline', 'detailed-outline', 'manuscript', 'entities', 'multi-world'],
  ttrpg: ['foundation', 'characters', 'relations', 'story', 'storylines', 'outline', 'detailed-outline', 'manuscript', 'entities', 'multi-world'],
}

const PRODUCT_CONTEXT_KINDS: Readonly<Record<ProductionProductKindV1, ContextResourceKind[]>> = {
  'character-interaction': ['world', 'worldview-field', 'character', 'character-relation', 'story-core-field', 'story-arc', 'storyline-progress', 'location', 'codex-entry', 'fact', 'world-link'],
  'text-adventure': ['world', 'worldview-field', 'story-core-field', 'character', 'character-relation', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'foreshadow', 'location', 'codex-entry', 'fact', 'world-link'],
  avg: ['world', 'worldview-field', 'story-core-field', 'character', 'character-relation', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry', 'fact'],
  'text-open-world': ['world', 'worldview-field', 'world-link', 'story-core-field', 'character', 'character-relation', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry', 'fact'],
  ttrpg: ['world', 'worldview-field', 'world-link', 'story-core-field', 'character', 'character-relation', 'story-arc', 'storyline-progress', 'outline-node', 'detailed-outline', 'chapter', 'foreshadow', 'location', 'codex-entry', 'fact'],
}

function upperProductRules(
  productType: ProductionProductKindV1,
  goal: UpperProductWorldRequirementGoalV1,
): WorldRequirementRuleV1[] {
  const selectedAreas = goal.selectedAreas.filter(area => PRODUCT_AREAS[productType].includes(area)
    && (area !== 'multi-world' || goal.allowCrossWorld))
  const selectedContextKinds = goal.selectedContextKinds
    .filter(kind => PRODUCT_CONTEXT_KINDS[productType].includes(kind)
      && (kind !== 'world-link' || goal.allowCrossWorld))
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

function createUpperProductWorldRequirementAdapterV1(
  productType: ProductionProductKindV1,
): WorldRequirementAdapterV1<UpperProductWorldRequirementGoalV1> {
  return {
    adapterId: `storyforge.upper-product.${productType}.world-requirements`,
    adapterVersion: 1,
    productType,
    contextTaskKind: 'agent-outline',
    resolve: goal => upperProductRules(productType, goal),
  }
}

export const TTRPG_WORLD_REQUIREMENT_ADAPTER_V1 = createUpperProductWorldRequirementAdapterV1('ttrpg')
export const CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V1 = createUpperProductWorldRequirementAdapterV1('character-interaction')
export const TEXT_ADVENTURE_WORLD_REQUIREMENT_ADAPTER_V1 = createUpperProductWorldRequirementAdapterV1('text-adventure')
export const AVG_WORLD_REQUIREMENT_ADAPTER_V1 = createUpperProductWorldRequirementAdapterV1('avg')
export const TEXT_OPEN_WORLD_REQUIREMENT_ADAPTER_V1 = createUpperProductWorldRequirementAdapterV1('text-open-world')

const UPPER_PRODUCT_WORLD_REQUIREMENT_ADAPTERS_V1: ReadonlyMap<
  ProductionProductKindV1,
  WorldRequirementAdapterV1<UpperProductWorldRequirementGoalV1>
> = new Map([
  ['ttrpg', TTRPG_WORLD_REQUIREMENT_ADAPTER_V1],
  ['character-interaction', CHARACTER_INTERACTION_WORLD_REQUIREMENT_ADAPTER_V1],
  ['text-adventure', TEXT_ADVENTURE_WORLD_REQUIREMENT_ADAPTER_V1],
  ['avg', AVG_WORLD_REQUIREMENT_ADAPTER_V1],
  ['text-open-world', TEXT_OPEN_WORLD_REQUIREMENT_ADAPTER_V1],
])

export function getUpperProductWorldRequirementAdapterV1(
  productType: ProductionProductKindV1,
): WorldRequirementAdapterV1<UpperProductWorldRequirementGoalV1> {
  const adapter = UPPER_PRODUCT_WORLD_REQUIREMENT_ADAPTERS_V1.get(productType)
  if (!adapter) throw new Error(`[product-requirements] 未登记上层产品：${productType}`)
  return adapter
}

export function upperProductAllowedAreasV1(productType: ProductionProductKindV1): WorldCapabilityArea[] {
  return [...PRODUCT_AREAS[productType]]
}

export function upperProductAllowedContextKindsV1(productType: ProductionProductKindV1): ContextResourceKind[] {
  return [...PRODUCT_CONTEXT_KINDS[productType]]
}

/** Product-owned projection from the neutral world selection into semantic
 * roles. Keeping it beside the requirement adapter prevents components and
 * consultation services from inventing a second source contract. */
export function compileUpperProductWorldRoleBindingsV1(
  productType: ProductionProductKindV1,
  catalog: ProductProductionSourceSelectionV1,
): Record<string, string[]> {
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
