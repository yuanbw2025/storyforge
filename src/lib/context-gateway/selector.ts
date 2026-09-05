import { hashCanonicalValue } from '../agent/run/hash'
import {
  AGENT_CONTEXT_TASK_KINDS,
  type AgentContextTaskKind,
} from '../agent/context-policy'
import type {
  ContextAccessPolicyV1,
  ContextResourceAuthorityV1,
  ContextResourceDepthV1,
  ContextResourceDescriptorV1,
  ContextResourceKind,
  ContextSufficiencyObligationV1,
  ContextSufficiencyReportV1,
  ContextTimeRangeV1,
  FrozenResourceScopeV1,
} from '../registry/types'
import {
  createContextSufficiencyReportV1,
  isContextResourceDiscoverableV1,
} from './contracts'

export const CONTEXT_SELECTOR_VERSION_V1 = 'context-selector-v1'

export const CONTEXT_SELECTOR_CATEGORIES_V1 = [
  'world', 'character', 'story-planning', 'prose-fact', 'reference',
] as const
export type ContextSelectorCategoryV1 = typeof CONTEXT_SELECTOR_CATEGORIES_V1[number]

export const CONTEXT_SELECTION_REASON_CODES_V1 = [
  'explicit-mandatory',
  'must-read',
  'pinned',
  'mandatory-source',
  'task-core',
  'target-resource',
  'entity-match',
  'story-arc-match',
  'time-neighbor',
  'one-hop-high-risk',
  'early-anchor',
  'recent-change',
  'category-quota',
  'kind-quota',
  'task-relevance',
] as const
export type ContextSelectionReasonCodeV1 = typeof CONTEXT_SELECTION_REASON_CODES_V1[number]

export type ContextSelectionOmissionReasonV1 =
  | 'policy-forbidden'
  | 'scope-conflict'
  | 'candidate-not-explicit'
  | 'budget-exhausted'
  | 'lower-relevance'

export interface ContextSelectorPolicyV1 {
  version: typeof CONTEXT_SELECTOR_VERSION_V1
  selectorPolicyId: string
  taskKind: AgentContextTaskKind
  coreKinds: readonly ContextResourceKind[]
  categoryShares: Readonly<Record<ContextSelectorCategoryV1, number>>
  highRiskRelations: readonly ContextResourceDescriptorV1['relations'][number]['kind'][]
  /** Maximum non-hard resources admitted before bounded tool reads take over. */
  maxAutomaticResources: number
  maxOneHopResources: number
  maxEarlyAnchors: number
  maxRecentChanges: number
}

export interface ContextSelectorInputV1 {
  taskKind: AgentContextTaskKind
  accessPolicy: ContextAccessPolicyV1
  scope: FrozenResourceScopeV1
  descriptors: readonly ContextResourceDescriptorV1[]
  budgetTokens: number
  mandatoryResourceKeys?: readonly string[]
  /** Mandatory whole-resource reads. Unlike original reads, this may bind multiple source refs. */
  mandatoryFullResourceKeys?: readonly string[]
  mandatoryOriginalResourceKeys?: readonly string[]
  targetResourceKeys?: readonly string[]
  entityKeys?: readonly string[]
  storyArcKeys?: readonly string[]
  timeRange?: ContextTimeRangeV1
  query?: string
  readsAllowed: boolean
}

export interface ContextSelectionDecisionV1 {
  resourceKey: string
  sourceKey: string
  kind: ContextResourceKind
  category: ContextSelectorCategoryV1
  depth: ContextResourceDepthV1
  estimatedTokens: number
  hardRequirement: boolean
  reasonCodes: ContextSelectionReasonCodeV1[]
  contentRevision: number | string
  contentHash: string
  policyRevision: number
  policyHash: string
}

export interface ContextSelectionOmissionV1 {
  resourceKey: string
  sourceKey: string
  kind: ContextResourceKind
  estimatedTokens: number
  reasonCode: ContextSelectionOmissionReasonV1
}

export interface ContextSelectionCategoryBudgetV1 {
  category: ContextSelectorCategoryV1
  targetTokens: number
  availableTokens: number
  selectedTokens: number
  availableResourceCount: number
  selectedResourceCount: number
}

export interface ContextSelectorResultV1 {
  version: typeof CONTEXT_SELECTOR_VERSION_V1
  selectorPolicyId: string
  taskKind: AgentContextTaskKind
  budgetTokens: number
  selectedTokens: number
  overBudget: boolean
  selected: ContextSelectionDecisionV1[]
  omitted: ContextSelectionOmissionV1[]
  categoryBudgets: ContextSelectionCategoryBudgetV1[]
  sufficiency: ContextSufficiencyReportV1
  inventoryHash: string
  selectorHash: string
}

export class ContextSelectorError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[context-selector:${code}] ${message}`)
    this.name = 'ContextSelectorError'
  }
}

const CATEGORY_BY_KIND: Readonly<Record<ContextResourceKind, ContextSelectorCategoryV1>> = {
  workspace: 'world',
  world: 'world',
  'worldview-field': 'world',
  'story-core-field': 'story-planning',
  character: 'character',
  'character-relation': 'character',
  'story-arc': 'story-planning',
  'storyline-progress': 'story-planning',
  'outline-node': 'story-planning',
  'detailed-outline': 'story-planning',
  chapter: 'prose-fact',
  foreshadow: 'prose-fact',
  location: 'world',
  'codex-entry': 'world',
  'world-link': 'world',
  fact: 'prose-fact',
  reference: 'reference',
  'narrative-blueprint': 'story-planning',
}

const DEFAULT_HIGH_RISK_RELATIONS: ContextSelectorPolicyV1['highRiskRelations'] = [
  'same-entity', 'appears-in', 'depends-on', 'world-link', 'temporal-neighbor',
]

function shares(input: Partial<Record<ContextSelectorCategoryV1, number>>): Record<ContextSelectorCategoryV1, number> {
  return Object.fromEntries(CONTEXT_SELECTOR_CATEGORIES_V1.map(category => [category, input[category] ?? 0])) as Record<ContextSelectorCategoryV1, number>
}

export const CONTEXT_SELECTOR_POLICIES_V1: Readonly<Record<AgentContextTaskKind, ContextSelectorPolicyV1>> = {
  'agent-world-origin': {
    version: CONTEXT_SELECTOR_VERSION_V1,
    selectorPolicyId: 'selector-world-origin-v2',
    taskKind: 'agent-world-origin',
    coreKinds: ['world', 'worldview-field', 'story-core-field', 'world-link'],
    categoryShares: shares({ world: 0.5, character: 0.12, 'story-planning': 0.22, 'prose-fact': 0.08, reference: 0.08 }),
    highRiskRelations: DEFAULT_HIGH_RISK_RELATIONS,
    maxAutomaticResources: 20,
    maxOneHopResources: 12,
    maxEarlyAnchors: 2,
    maxRecentChanges: 2,
  },
  'agent-character': {
    version: CONTEXT_SELECTOR_VERSION_V1,
    selectorPolicyId: 'selector-character-v2',
    taskKind: 'agent-character',
    coreKinds: ['character', 'character-relation', 'worldview-field', 'story-core-field'],
    categoryShares: shares({ world: 0.24, character: 0.44, 'story-planning': 0.18, 'prose-fact': 0.08, reference: 0.06 }),
    highRiskRelations: DEFAULT_HIGH_RISK_RELATIONS,
    maxAutomaticResources: 28,
    maxOneHopResources: 16,
    maxEarlyAnchors: 2,
    maxRecentChanges: 3,
  },
  'agent-inspiration': {
    version: CONTEXT_SELECTOR_VERSION_V1,
    selectorPolicyId: 'selector-inspiration-v2',
    taskKind: 'agent-inspiration',
    coreKinds: ['reference', 'worldview-field', 'story-core-field'],
    categoryShares: shares({ world: 0.28, character: 0.12, 'story-planning': 0.2, 'prose-fact': 0.1, reference: 0.3 }),
    highRiskRelations: DEFAULT_HIGH_RISK_RELATIONS,
    maxAutomaticResources: 20,
    maxOneHopResources: 8,
    maxEarlyAnchors: 1,
    maxRecentChanges: 2,
  },
  'agent-outline': {
    version: CONTEXT_SELECTOR_VERSION_V1,
    selectorPolicyId: 'selector-outline-v2',
    taskKind: 'agent-outline',
    coreKinds: ['story-core-field', 'story-arc', 'outline-node', 'narrative-blueprint', 'character', 'worldview-field'],
    categoryShares: shares({ world: 0.24, character: 0.22, 'story-planning': 0.34, 'prose-fact': 0.14, reference: 0.06 }),
    highRiskRelations: DEFAULT_HIGH_RISK_RELATIONS,
    maxAutomaticResources: 36,
    maxOneHopResources: 20,
    maxEarlyAnchors: 3,
    maxRecentChanges: 4,
  },
  'agent-prose': {
    version: CONTEXT_SELECTOR_VERSION_V1,
    selectorPolicyId: 'selector-prose-v2',
    taskKind: 'agent-prose',
    coreKinds: ['narrative-blueprint', 'detailed-outline', 'outline-node', 'story-arc', 'character', 'fact', 'foreshadow', 'chapter'],
    categoryShares: shares({ world: 0.18, character: 0.24, 'story-planning': 0.26, 'prose-fact': 0.28, reference: 0.04 }),
    highRiskRelations: DEFAULT_HIGH_RISK_RELATIONS,
    maxAutomaticResources: 48,
    maxOneHopResources: 24,
    maxEarlyAnchors: 4,
    maxRecentChanges: 5,
  },
}

for (const policy of Object.values(CONTEXT_SELECTOR_POLICIES_V1)) {
  Object.freeze(policy.coreKinds)
  Object.freeze(policy.categoryShares)
  Object.freeze(policy.highRiskRelations)
  Object.freeze(policy)
}
Object.freeze(CONTEXT_SELECTOR_POLICIES_V1)

const AUTHORITY_RANK: Readonly<Record<ContextResourceAuthorityV1, number>> = {
  'author-canon': 5,
  'adopted-canon': 4,
  'confirmed-evidence': 3,
  'derived-summary': 2,
  candidate: 1,
}

const PRIORITY_RANK = { 'must-read': 3, pinned: 2, normal: 1 } as const
const FOCUSED_DEPTH_ORDER: readonly Exclude<ContextResourceDepthV1, 'original'>[] = ['focused', 'full', 'summary', 'index']
const DISCOVERY_DEPTH_ORDER: readonly Exclude<ContextResourceDepthV1, 'original'>[] = ['summary', 'index', 'focused', 'full']

function fail(code: string, message: string): never {
  throw new ContextSelectorError(code, message)
}

function sortedKeys(values: readonly string[] | undefined, label: string): string[] {
  const result = [...new Set((values ?? []).map(value => value.trim()))].filter(Boolean).sort()
  if (result.length > 200 || result.some(value => /\s/.test(value))) fail('invalid-key', `${label} 含非法 resource key`)
  return result
}

function compareRevision(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), 'zh-CN', { numeric: true })
}

function compareBoundary(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), 'zh-CN', { numeric: true })
}

function matchesTimeRange(descriptor: ContextResourceDescriptorV1, requested: ContextTimeRangeV1 | undefined): boolean {
  if (!requested) return true
  const actual = descriptor.timeRange
  if (!actual) return false
  if (requested.throughChapterId != null) {
    const chapter = actual.throughChapterId ?? descriptor.scope.chapterId
    if (chapter == null || chapter > requested.throughChapterId) return false
  }
  if (requested.start != null && actual.end != null && compareBoundary(actual.end, requested.start) < 0) return false
  if (requested.end != null && actual.start != null && compareBoundary(actual.start, requested.end) > 0) return false
  return true
}

function scopeConflict(descriptor: ContextResourceDescriptorV1, scope: FrozenResourceScopeV1): boolean {
  if (descriptor.scope.projectId !== scope.projectId) return true
  if (scope.workId != null && descriptor.scope.workId != null && descriptor.scope.workId !== scope.workId) return true
  if (scope.worldGroupId != null && descriptor.scope.worldGroupId != null
    && descriptor.scope.worldGroupId !== scope.worldGroupId) return true
  if (scope.worldId != null && descriptor.scope.worldId != null && descriptor.scope.worldId !== scope.worldId
    && (scope.worldGroupId == null || descriptor.scope.worldGroupId !== scope.worldGroupId)) return true
  return false
}

function searchable(descriptor: ContextResourceDescriptorV1): string {
  return `${descriptor.resourceKey}\n${descriptor.title}\n${descriptor.shortSummary}`.toLocaleLowerCase('zh-CN')
}

function queryScore(descriptor: ContextResourceDescriptorV1, query: string): number {
  const terms = query.toLocaleLowerCase('zh-CN').split(/[\s,，。；;、]+/).filter(term => term.length >= 2)
  if (!terms.length) return 0
  const text = searchable(descriptor)
  return terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0) / terms.length
}

function resourceMatchesKeys(descriptor: ContextResourceDescriptorV1, keys: ReadonlySet<string>): boolean {
  if (!keys.size) return false
  if (keys.has(descriptor.resourceKey)) return true
  return descriptor.relations.some(relation => keys.has(relation.targetResourceKey))
}

function selectDepth(
  descriptor: ContextResourceDescriptorV1,
  policy: ContextAccessPolicyV1,
  focused = false,
): Exclude<ContextResourceDepthV1, 'original'> {
  for (const depth of focused ? FOCUSED_DEPTH_ORDER : DISCOVERY_DEPTH_ORDER) {
    if (policy.allowedDepths.includes(depth) && descriptor.availableDepths.includes(depth)) return depth
  }
  fail('no-readable-depth', `${descriptor.resourceKey} 没有 Policy 允许的非原文读取深度`)
}

function estimatedTokens(descriptor: ContextResourceDescriptorV1, depth: ContextResourceDepthV1): number {
  const estimate = descriptor.tokenEstimate[depth] ?? descriptor.tokenEstimate.index ?? 0
  // Explicit original escalation is governed by the Gateway's total budget and
  // must not silently inherit the lossy per-resource discovery cap.
  if (depth === 'original') return Math.max(0, estimate)
  return Math.max(0, Math.min(estimate, descriptor.tokenCap ?? Number.MAX_SAFE_INTEGER))
}

function category(descriptor: ContextResourceDescriptorV1): ContextSelectorCategoryV1 {
  return CATEGORY_BY_KIND[descriptor.kind]
}

export function contextSelectorCategoryForKindV1(kind: ContextResourceKind): ContextSelectorCategoryV1 {
  return CATEGORY_BY_KIND[kind]
}

function taskRank(descriptor: ContextResourceDescriptorV1, policy: ContextSelectorPolicyV1): number {
  const index = policy.coreKinds.indexOf(descriptor.kind)
  return index < 0 ? 0 : policy.coreKinds.length - index
}

function descriptorComparator(input: {
  selectorPolicy: ContextSelectorPolicyV1
  query: string
  targets: ReadonlySet<string>
  entities: ReadonlySet<string>
  arcs: ReadonlySet<string>
  timeRange?: ContextTimeRangeV1
}): (left: ContextResourceDescriptorV1, right: ContextResourceDescriptorV1) => number {
  const score = (descriptor: ContextResourceDescriptorV1): readonly number[] => [
    PRIORITY_RANK[descriptor.priority],
    input.targets.has(descriptor.resourceKey) ? 1 : 0,
    resourceMatchesKeys(descriptor, input.entities) ? 1 : 0,
    resourceMatchesKeys(descriptor, input.arcs) ? 1 : 0,
    matchesTimeRange(descriptor, input.timeRange) ? 1 : 0,
    taskRank(descriptor, input.selectorPolicy),
    queryScore(descriptor, input.query),
    AUTHORITY_RANK[descriptor.authority],
    descriptor.retrievalWeight ?? 1,
  ]
  return (left, right) => {
    const leftScore = score(left)
    const rightScore = score(right)
    for (let index = 0; index < leftScore.length; index++) {
      if (leftScore[index] !== rightScore[index]) return rightScore[index] - leftScore[index]
    }
    const revision = compareRevision(right.contentRevision, left.contentRevision)
    return revision || left.resourceKey.localeCompare(right.resourceKey)
  }
}

function timeOrder(left: ContextResourceDescriptorV1, right: ContextResourceDescriptorV1): number {
  const leftBoundary = left.timeRange?.start ?? left.timeRange?.end ?? left.scope.chapterId
  const rightBoundary = right.timeRange?.start ?? right.timeRange?.end ?? right.scope.chapterId
  if (leftBoundary == null && rightBoundary != null) return 1
  if (leftBoundary != null && rightBoundary == null) return -1
  if (leftBoundary != null && rightBoundary != null) {
    const compared = compareBoundary(leftBoundary, rightBoundary)
    if (compared) return compared
  }
  return left.resourceKey.localeCompare(right.resourceKey)
}

function normalizedTitle(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN').replace(/[\s·:：/／_-]+/g, '')
}

// A shared display title is only an identity conflict for resources whose name
// identifies a durable entity. Facts, chapters, beats, outlines, and other
// temporal/structural records may legitimately reuse a title while carrying
// different content at different positions in the narrative.
const SAME_NAME_CANON_IDENTITY_KINDS = new Set<ContextResourceKind>([
  'character',
  'location',
  'codex-entry',
  'story-arc',
])

function assertSelectorPolicy(policy: ContextSelectorPolicyV1, taskKind: AgentContextTaskKind): void {
  if (!AGENT_CONTEXT_TASK_KINDS.includes(taskKind) || policy.taskKind !== taskKind
    || policy.version !== CONTEXT_SELECTOR_VERSION_V1 || !policy.selectorPolicyId.trim()) {
    fail('invalid-selector-policy', `task kind ${taskKind} 没有合法 selector policy`)
  }
  const share = CONTEXT_SELECTOR_CATEGORIES_V1.reduce((sum, item) => sum + policy.categoryShares[item], 0)
  if (Math.abs(share - 1) > 0.000_001) fail('invalid-selector-policy', `${policy.selectorPolicyId} category shares 总和必须为 1`)
  if (!Number.isSafeInteger(policy.maxAutomaticResources) || policy.maxAutomaticResources < 1) {
    fail('invalid-selector-policy', `${policy.selectorPolicyId} maxAutomaticResources 非法`)
  }
}

export function getContextSelectorPolicyV1(taskKind: AgentContextTaskKind): ContextSelectorPolicyV1 {
  const policy = CONTEXT_SELECTOR_POLICIES_V1[taskKind]
  assertSelectorPolicy(policy, taskKind)
  return policy
}

export async function selectContextResourcesV1(input: ContextSelectorInputV1): Promise<ContextSelectorResultV1> {
  if (!Number.isSafeInteger(input.budgetTokens) || input.budgetTokens < 1
    || input.budgetTokens > input.accessPolicy.maxRetrievedTokens) {
    fail('invalid-budget', 'selector budget 必须为正整数且不超过 ContextAccessPolicy.maxRetrievedTokens')
  }
  if (input.accessPolicy.selectorPolicyId !== getContextSelectorPolicyV1(input.taskKind).selectorPolicyId) {
    fail('selector-policy-mismatch', 'ContextAccessPolicy.selectorPolicyId 与 task kind 冻结策略不一致')
  }
  const selectorPolicy = getContextSelectorPolicyV1(input.taskKind)
  const mandatoryKeys = sortedKeys(input.mandatoryResourceKeys, 'mandatoryResourceKeys')
  const mandatoryFullKeys = sortedKeys(input.mandatoryFullResourceKeys, 'mandatoryFullResourceKeys')
  const mandatoryOriginalKeys = sortedKeys(input.mandatoryOriginalResourceKeys, 'mandatoryOriginalResourceKeys')
  if (mandatoryFullKeys.some(key => !mandatoryKeys.includes(key))) {
    fail('full-not-mandatory', 'mandatoryFullResourceKeys 必须同时属于 mandatoryResourceKeys')
  }
  if (mandatoryOriginalKeys.some(key => !mandatoryKeys.includes(key))) {
    fail('original-not-mandatory', 'mandatoryOriginalResourceKeys 必须同时属于 mandatoryResourceKeys')
  }
  const mandatoryOriginalSet = new Set(mandatoryOriginalKeys)
  const mandatoryFullSet = new Set(mandatoryFullKeys)
  const targetKeys = sortedKeys(input.targetResourceKeys, 'targetResourceKeys')
  const entityKeys = sortedKeys(input.entityKeys, 'entityKeys')
  const arcKeys = sortedKeys(input.storyArcKeys, 'storyArcKeys')
  const explicitKeys = new Set([...mandatoryKeys, ...targetKeys, ...entityKeys, ...arcKeys])
  const targetSet = new Set(targetKeys)
  const entitySet = new Set(entityKeys)
  const arcSet = new Set(arcKeys)
  const query = input.query?.trim() ?? ''
  const byKey = new Map<string, ContextResourceDescriptorV1>()
  const forbidden: ContextSelectionOmissionV1[] = []
  const seenKeys = new Set<string>()

  for (const descriptor of input.descriptors) {
    if (seenKeys.has(descriptor.resourceKey)) fail('duplicate-resource', `目录重复 ${descriptor.resourceKey}`)
    seenKeys.add(descriptor.resourceKey)
    if (scopeConflict(descriptor, input.scope)) {
      forbidden.push({
        resourceKey: descriptor.resourceKey,
        sourceKey: descriptor.sourceKey,
        kind: descriptor.kind,
        estimatedTokens: descriptor.tokenEstimate.index ?? 0,
        reasonCode: 'scope-conflict',
      })
      continue
    }
    const explicitResourceKey = explicitKeys.has(descriptor.resourceKey) ? descriptor.resourceKey : undefined
    if (!isContextResourceDiscoverableV1({ descriptor, policy: input.accessPolicy, explicitResourceKey })) {
      forbidden.push({
        resourceKey: descriptor.resourceKey,
        sourceKey: descriptor.sourceKey,
        kind: descriptor.kind,
        estimatedTokens: descriptor.tokenEstimate.index ?? 0,
        reasonCode: descriptor.authority === 'candidate' ? 'candidate-not-explicit' : 'policy-forbidden',
      })
      continue
    }
    byKey.set(descriptor.resourceKey, descriptor)
  }

  const comparator = descriptorComparator({
    selectorPolicy,
    query,
    targets: targetSet,
    entities: entitySet,
    arcs: arcSet,
    timeRange: input.timeRange,
  })
  const available = [...byKey.values()].sort(comparator)
  const selected = new Map<string, { descriptor: ContextResourceDescriptorV1; reasons: Set<ContextSelectionReasonCodeV1>; hard: boolean }>()
  const preferred = new Map<string, Set<ContextSelectionReasonCodeV1>>()

  const mark = (descriptor: ContextResourceDescriptorV1 | undefined, reason: ContextSelectionReasonCodeV1, hard = false): void => {
    if (!descriptor) return
    const current = selected.get(descriptor.resourceKey)
    if (current) {
      current.reasons.add(reason)
      current.hard ||= hard
      return
    }
    selected.set(descriptor.resourceKey, { descriptor, reasons: new Set([reason]), hard })
  }
  const prefer = (descriptor: ContextResourceDescriptorV1 | undefined, reason: ContextSelectionReasonCodeV1): void => {
    if (!descriptor) return
    const reasons = preferred.get(descriptor.resourceKey) ?? new Set<ContextSelectionReasonCodeV1>()
    reasons.add(reason)
    preferred.set(descriptor.resourceKey, reasons)
  }

  for (const key of mandatoryKeys) mark(byKey.get(key), 'explicit-mandatory', true)
  for (const descriptor of available) {
    if (descriptor.priority === 'must-read') mark(descriptor, 'must-read', true)
    else if (descriptor.priority === 'pinned') mark(descriptor, 'pinned', true)
    if (targetSet.has(descriptor.resourceKey)) mark(descriptor, 'target-resource', true)
    if (resourceMatchesKeys(descriptor, entitySet)) prefer(descriptor, 'entity-match')
    if (resourceMatchesKeys(descriptor, arcSet)) prefer(descriptor, 'story-arc-match')
    if (input.timeRange && matchesTimeRange(descriptor, input.timeRange)) prefer(descriptor, 'time-neighbor')
  }
  for (const sourceKey of input.accessPolicy.mandatorySourceKeys) {
    const descriptor = available.find(item => item.sourceKey === sourceKey)
    mark(descriptor, 'mandatory-source', true)
  }
  for (const kind of selectorPolicy.coreKinds) {
    mark(available.find(descriptor => descriptor.kind === kind), 'task-core', true)
  }

  const seedKeys = new Set([
    ...selected.keys(),
    ...available
      .filter(descriptor => resourceMatchesKeys(descriptor, entitySet) || resourceMatchesKeys(descriptor, arcSet))
      .map(descriptor => descriptor.resourceKey),
  ])
  let expanded = 0
  for (const seedKey of [...seedKeys].sort()) {
    const seed = byKey.get(seedKey)
    if (!seed) continue
    for (const relation of [...seed.relations].sort((left, right) => (
      left.targetResourceKey.localeCompare(right.targetResourceKey) || left.kind.localeCompare(right.kind)
    ))) {
      if (expanded >= selectorPolicy.maxOneHopResources) break
      if (!selectorPolicy.highRiskRelations.includes(relation.kind)) continue
      const target = byKey.get(relation.targetResourceKey)
      if (!target) continue
      const alreadyExpanded = preferred.get(target.resourceKey)?.has('one-hop-high-risk')
        || selected.get(target.resourceKey)?.reasons.has('one-hop-high-risk')
      if (selected.has(target.resourceKey)) mark(target, 'one-hop-high-risk', false)
      else prefer(target, 'one-hop-high-risk')
      if (!alreadyExpanded) expanded++
    }
  }

  const relevant = available.filter(descriptor => (
    selected.has(descriptor.resourceKey)
    || preferred.has(descriptor.resourceKey)
    || resourceMatchesKeys(descriptor, entitySet)
    || resourceMatchesKeys(descriptor, arcSet)
    || targetSet.has(descriptor.resourceKey)
    || queryScore(descriptor, query) > 0
  ))
  const temporalPool = (relevant.some(item => item.timeRange || item.scope.chapterId)
    ? relevant
    : available.filter(item => item.timeRange || item.scope.chapterId))
  for (const descriptor of [...temporalPool].sort(timeOrder).slice(0, selectorPolicy.maxEarlyAnchors)) {
    prefer(descriptor, 'early-anchor')
  }
  for (const descriptor of [...relevant].sort((left, right) => (
    compareRevision(right.contentRevision, left.contentRevision) || left.resourceKey.localeCompare(right.resourceKey)
  )).slice(0, selectorPolicy.maxRecentChanges)) {
    prefer(descriptor, 'recent-change')
  }

  const decisionFor = (entry: { descriptor: ContextResourceDescriptorV1; reasons: Set<ContextSelectionReasonCodeV1>; hard: boolean }): ContextSelectionDecisionV1 => {
    const focused = [...entry.reasons].some(reason => [
      'explicit-mandatory', 'must-read', 'pinned', 'target-resource',
    ].includes(reason))
    const depth = mandatoryOriginalSet.has(entry.descriptor.resourceKey)
      ? 'original'
      : mandatoryFullSet.has(entry.descriptor.resourceKey)
        ? 'full'
      : selectDepth(entry.descriptor, input.accessPolicy, focused)
    if (depth === 'full' && !entry.descriptor.availableDepths.includes('full')) {
      fail('full-forbidden', `${entry.descriptor.resourceKey} 不支持完整资源读取`)
    }
    if (depth === 'original' && (
      !input.accessPolicy.allowOriginalRead
      || !input.accessPolicy.allowedDepths.includes('original')
      || !entry.descriptor.availableDepths.includes('original')
    )) fail('original-forbidden', `${entry.descriptor.resourceKey} 不允许原文定点读取`)
    return {
      resourceKey: entry.descriptor.resourceKey,
      sourceKey: entry.descriptor.sourceKey,
      kind: entry.descriptor.kind,
      category: category(entry.descriptor),
      depth,
      estimatedTokens: estimatedTokens(entry.descriptor, depth),
      hardRequirement: entry.hard,
      reasonCodes: [...entry.reasons].sort(),
      contentRevision: entry.descriptor.contentRevision,
      contentHash: entry.descriptor.contentHash,
      policyRevision: entry.descriptor.policyRevision,
      policyHash: entry.descriptor.policyHash,
    }
  }

  let selectedTokens = [...selected.values()].reduce((sum, entry) => sum + decisionFor(entry).estimatedTokens, 0)
  const tryMark = (descriptor: ContextResourceDescriptorV1, reason: ContextSelectionReasonCodeV1): boolean => {
    const current = selected.get(descriptor.resourceKey)
    if (current) {
      current.reasons.add(reason)
      return true
    }
    const automaticCount = [...selected.values()].filter(entry => !entry.hard).length
    if (automaticCount >= selectorPolicy.maxAutomaticResources) return false
    const depth = selectDepth(descriptor, input.accessPolicy)
    const tokens = estimatedTokens(descriptor, depth)
    if (selectedTokens + tokens > input.budgetTokens) return false
    mark(descriptor, reason, false)
    selectedTokens += tokens
    return true
  }

  for (const descriptor of available) {
    const reasons = preferred.get(descriptor.resourceKey)
    if (!reasons) continue
    for (const reason of [...reasons].sort()) {
      if (!tryMark(descriptor, reason)) break
    }
  }

  const categoryTargets = Object.fromEntries(CONTEXT_SELECTOR_CATEGORIES_V1.map(item => [
    item,
    Math.floor(input.budgetTokens * selectorPolicy.categoryShares[item]),
  ])) as Record<ContextSelectorCategoryV1, number>
  for (const [kind, minimum] of Object.entries(input.accessPolicy.perKindMinimumTokens ?? {})) {
    const selectorCategory = CATEGORY_BY_KIND[kind as ContextResourceKind]
    categoryTargets[selectorCategory] = Math.max(categoryTargets[selectorCategory], minimum ?? 0)
  }

  for (const [kind, minimum] of Object.entries(input.accessPolicy.perKindMinimumTokens ?? {})
    .sort(([left], [right]) => left.localeCompare(right))) {
    const pool = available.filter(descriptor => descriptor.kind === kind)
    const availableTokens = pool.reduce((sum, descriptor) => (
      sum + estimatedTokens(descriptor, selectDepth(descriptor, input.accessPolicy))
    ), 0)
    const goal = Math.min(availableTokens, minimum ?? 0)
    let delivered = [...selected.values()]
      .filter(entry => entry.descriptor.kind === kind)
      .reduce((sum, entry) => sum + decisionFor(entry).estimatedTokens, 0)
    for (const descriptor of pool) {
      if (delivered >= goal) break
      const before = selectedTokens
      if (tryMark(descriptor, 'kind-quota')) delivered += selectedTokens - before
    }
  }

  for (const selectorCategory of CONTEXT_SELECTOR_CATEGORIES_V1) {
    const pool = available.filter(descriptor => category(descriptor) === selectorCategory)
    const availableTokens = pool.reduce((sum, descriptor) => sum + estimatedTokens(descriptor, selectDepth(descriptor, input.accessPolicy)), 0)
    const goal = pool.length && availableTokens > 0
      ? Math.min(availableTokens, Math.max(1, categoryTargets[selectorCategory]))
      : 0
    let delivered = [...selected.values()]
      .filter(entry => category(entry.descriptor) === selectorCategory)
      .reduce((sum, entry) => sum + decisionFor(entry).estimatedTokens, 0)
    for (const descriptor of pool) {
      if (delivered >= goal) break
      const before = selectedTokens
      if (tryMark(descriptor, 'category-quota')) delivered += selectedTokens - before
    }
  }

  for (const descriptor of available) {
    if (selectedTokens >= input.budgetTokens) break
    if (selected.has(descriptor.resourceKey)) continue
    if (query && queryScore(descriptor, query) === 0 && taskRank(descriptor, selectorPolicy) === 0) continue
    tryMark(descriptor, 'task-relevance')
  }

  const decisions = [...selected.values()].map(decisionFor).sort((left, right) => left.resourceKey.localeCompare(right.resourceKey))
  selectedTokens = decisions.reduce((sum, decision) => sum + decision.estimatedTokens, 0)
  const selectedKeys = new Set(decisions.map(decision => decision.resourceKey))
  const categoryBudgets: ContextSelectionCategoryBudgetV1[] = CONTEXT_SELECTOR_CATEGORIES_V1.map(selectorCategory => {
    const pool = available.filter(descriptor => category(descriptor) === selectorCategory)
    const chosen = decisions.filter(decision => decision.category === selectorCategory)
    const availableTokens = pool.reduce((sum, descriptor) => sum + estimatedTokens(descriptor, selectDepth(descriptor, input.accessPolicy)), 0)
    const rawTarget = categoryTargets[selectorCategory]
    const targetTokens = pool.length && availableTokens > 0
      ? Math.min(availableTokens, Math.max(1, rawTarget))
      : 0
    return {
      category: selectorCategory,
      targetTokens,
      availableTokens,
      selectedTokens: chosen.reduce((sum, decision) => sum + decision.estimatedTokens, 0),
      availableResourceCount: pool.length,
      selectedResourceCount: chosen.length,
    }
  })

  const obligations: ContextSufficiencyObligationV1[] = []
  const scopeConflicts = forbidden.filter(item => item.reasonCode === 'scope-conflict')
  if (scopeConflicts.length) {
    obligations.push({
      id: 'catalog-scope-integrity',
      kind: 'conflict-check',
      required: true,
      status: 'conflicted',
      evidenceResourceKeys: scopeConflicts.map(item => item.resourceKey),
      reasonCode: 'provider-returned-cross-scope-resource',
    })
  }
  for (const key of mandatoryKeys) {
    obligations.push({
      id: `mandatory-resource:${key}`,
      kind: 'entity',
      required: true,
      status: selectedKeys.has(key) ? 'satisfied' : 'missing',
      evidenceResourceKeys: selectedKeys.has(key) ? [key] : [],
      reasonCode: selectedKeys.has(key) ? 'mandatory-resource-delivered' : 'mandatory-resource-missing',
    })
  }
  for (const key of targetKeys) {
    const evidence = selectedKeys.has(key) ? [key] : []
    obligations.push({
      id: `target-resource:${key}`,
      kind: 'entity',
      required: true,
      status: evidence.length ? 'satisfied' : 'missing',
      evidenceResourceKeys: evidence,
      reasonCode: evidence.length ? 'target-resource-delivered' : 'target-resource-missing',
    })
  }
  for (const [prefix, keys, kind] of [
    ['entity', entityKeys, 'entity'],
    ['story-arc', arcKeys, 'entity'],
  ] as const) {
    for (const key of keys) {
      const evidence = available
        .filter(descriptor => resourceMatchesKeys(descriptor, new Set([key])) && selectedKeys.has(descriptor.resourceKey))
        .map(descriptor => descriptor.resourceKey)
      obligations.push({
        id: `${prefix}:${key}`,
        kind,
        required: true,
        status: evidence.length ? 'satisfied' : 'missing',
        evidenceResourceKeys: evidence,
        reasonCode: evidence.length ? `${prefix}-evidence-delivered` : `${prefix}-evidence-missing`,
      })
    }
  }
  if (input.timeRange) {
    const evidence = available
      .filter(descriptor => matchesTimeRange(descriptor, input.timeRange) && selectedKeys.has(descriptor.resourceKey))
      .map(descriptor => descriptor.resourceKey)
    obligations.push({
      id: 'requested-time-boundary',
      kind: 'time-boundary',
      required: true,
      status: evidence.length ? 'satisfied' : 'missing',
      evidenceResourceKeys: evidence,
      reasonCode: evidence.length ? 'time-boundary-delivered' : 'time-boundary-missing',
    })
  }
  for (const descriptor of available.filter(item => item.priority !== 'normal')) {
    obligations.push({
      id: `priority:${descriptor.resourceKey}`,
      kind: 'entity',
      required: true,
      status: selectedKeys.has(descriptor.resourceKey) ? 'satisfied' : 'missing',
      evidenceResourceKeys: selectedKeys.has(descriptor.resourceKey) ? [descriptor.resourceKey] : [],
      reasonCode: selectedKeys.has(descriptor.resourceKey) ? `${descriptor.priority}-delivered` : `${descriptor.priority}-missing`,
    })
  }
  for (const sourceKey of input.accessPolicy.mandatorySourceKeys) {
    const evidence = decisions.filter(decision => decision.sourceKey === sourceKey).map(decision => decision.resourceKey)
    obligations.push({
      id: `mandatory-source:${sourceKey}`,
      kind: 'mandatory-source',
      required: true,
      status: evidence.length ? 'satisfied' : 'missing',
      evidenceResourceKeys: evidence,
      reasonCode: evidence.length ? 'mandatory-source-delivered' : 'mandatory-source-empty',
    })
  }
  for (const kind of selectorPolicy.coreKinds) {
    const present = available.filter(descriptor => descriptor.kind === kind)
    const evidence = decisions.filter(decision => decision.kind === kind).map(decision => decision.resourceKey)
    obligations.push({
      id: `task-core:${kind}`,
      kind: 'resource-kind',
      required: present.length > 0,
      status: present.length === 0 ? 'not-applicable' : evidence.length ? 'satisfied' : 'missing',
      evidenceResourceKeys: evidence,
      reasonCode: present.length === 0 ? 'task-core-not-present' : evidence.length ? 'task-core-delivered' : 'task-core-budget-conflict',
    })
  }
  for (const [kind, minimum] of Object.entries(input.accessPolicy.perKindMinimumTokens ?? {})
    .sort(([left], [right]) => left.localeCompare(right))) {
    const present = available.filter(descriptor => descriptor.kind === kind)
    const evidence = decisions.filter(decision => decision.kind === kind)
    const availableTokens = present.reduce((sum, descriptor) => (
      sum + estimatedTokens(descriptor, selectDepth(descriptor, input.accessPolicy))
    ), 0)
    const deliveredTokens = evidence.reduce((sum, decision) => sum + decision.estimatedTokens, 0)
    const targetTokens = Math.min(availableTokens, minimum ?? 0)
    obligations.push({
      id: `kind-quota:${kind}`,
      kind: 'resource-kind',
      required: present.length > 0 && targetTokens > 0,
      status: present.length === 0 || targetTokens === 0
        ? 'not-applicable'
        : deliveredTokens >= targetTokens
          ? 'satisfied'
          : 'missing',
      evidenceResourceKeys: present.length === 0 || targetTokens === 0 ? [] : evidence.map(item => item.resourceKey),
      reasonCode: present.length === 0 || targetTokens === 0
        ? 'kind-quota-not-present'
        : deliveredTokens >= targetTokens
          ? 'kind-quota-delivered'
          : 'kind-quota-budget-exhausted',
    })
  }
  for (const item of categoryBudgets) {
    obligations.push({
      id: `category-quota:${item.category}`,
      kind: 'resource-kind',
      required: false,
      status: item.availableResourceCount === 0
        ? 'not-applicable'
        : item.selectedTokens >= item.targetTokens
          ? 'satisfied'
          : 'missing',
      evidenceResourceKeys: item.selectedResourceCount
        ? decisions.filter(decision => decision.category === item.category).map(decision => decision.resourceKey)
        : [],
      reasonCode: item.availableResourceCount === 0
        ? 'category-not-present'
        : item.selectedTokens >= item.targetTokens
          ? 'category-quota-delivered'
          : 'category-quota-budget-exhausted',
    })
  }
  if (selectedTokens > input.budgetTokens) {
    obligations.push({
      id: 'hard-selection-budget',
      kind: 'conflict-check',
      required: true,
      status: 'conflicted',
      evidenceResourceKeys: decisions.filter(decision => decision.hardRequirement).map(decision => decision.resourceKey),
      reasonCode: 'mandatory-selection-exceeds-budget',
    })
  }
  const titleGroups = new Map<string, ContextResourceDescriptorV1[]>()
  for (const descriptor of available.filter(item => (
    selectedKeys.has(item.resourceKey)
    && SAME_NAME_CANON_IDENTITY_KINDS.has(item.kind)
  ))) {
    const title = `${descriptor.kind}:${normalizedTitle(descriptor.title)}`
    if (!title) continue
    titleGroups.set(title, [...(titleGroups.get(title) ?? []), descriptor])
  }
  for (const [title, descriptors] of [...titleGroups].sort(([left], [right]) => left.localeCompare(right))) {
    const hashes = new Set(descriptors.map(descriptor => descriptor.contentHash))
    if (descriptors.length < 2 || hashes.size < 2) continue
    obligations.push({
      id: `same-name-conflict:${title}`,
      kind: 'conflict-check',
      required: true,
      status: 'conflicted',
      evidenceResourceKeys: descriptors.map(descriptor => descriptor.resourceKey),
      reasonCode: 'same-name-different-canon',
    })
  }
  if (temporalPool.length) {
    const earlyEvidence = decisions.filter(decision => decision.reasonCodes.includes('early-anchor')).map(decision => decision.resourceKey)
    obligations.push({
      id: 'early-anchor',
      kind: 'time-boundary',
      required: false,
      status: earlyEvidence.length ? 'satisfied' : 'missing',
      evidenceResourceKeys: earlyEvidence,
      reasonCode: earlyEvidence.length ? 'early-anchor-delivered' : 'early-anchor-budget-exhausted',
    })
  }

  const assumptions = CONTEXT_SELECTOR_CATEGORIES_V1
    .filter(item => categoryBudgets.find(budget => budget.category === item)?.availableResourceCount === 0)
    .map(item => `category-empty:${item}`)
  const sufficiency = await createContextSufficiencyReportV1({ obligations, assumptions, readsAllowed: input.readsAllowed })
  const omitted: ContextSelectionOmissionV1[] = [
    ...forbidden,
    ...available.filter(descriptor => !selectedKeys.has(descriptor.resourceKey)).map(descriptor => ({
      resourceKey: descriptor.resourceKey,
      sourceKey: descriptor.sourceKey,
      kind: descriptor.kind,
      estimatedTokens: estimatedTokens(descriptor, selectDepth(descriptor, input.accessPolicy)),
      reasonCode: selectedTokens >= input.budgetTokens ? 'budget-exhausted' as const : 'lower-relevance' as const,
    })),
  ].sort((left, right) => left.resourceKey.localeCompare(right.resourceKey))
  const inventory = available.map(descriptor => ({
    resourceKey: descriptor.resourceKey,
    sourceKey: descriptor.sourceKey,
    kind: descriptor.kind,
    title: descriptor.title,
    shortSummary: descriptor.shortSummary,
    authority: descriptor.authority,
    contentRevision: descriptor.contentRevision,
    contentHash: descriptor.contentHash,
    policyRevision: descriptor.policyRevision,
    policyHash: descriptor.policyHash,
    scope: descriptor.scope,
    relations: descriptor.relations,
    timeRange: descriptor.timeRange ?? null,
    tokenEstimate: descriptor.tokenEstimate,
    availableDepths: descriptor.availableDepths,
    priority: descriptor.priority,
    retrievalWeight: descriptor.retrievalWeight ?? 1,
    tokenCap: descriptor.tokenCap ?? null,
  }))
  const inventoryHash = await hashCanonicalValue(inventory)
  const resultBody = {
    version: CONTEXT_SELECTOR_VERSION_V1 as typeof CONTEXT_SELECTOR_VERSION_V1,
    selectorPolicyId: selectorPolicy.selectorPolicyId,
    taskKind: input.taskKind,
    budgetTokens: input.budgetTokens,
    selectedTokens,
    overBudget: selectedTokens > input.budgetTokens,
    selected: decisions,
    omitted,
    categoryBudgets,
    sufficiency,
    inventoryHash,
  }
  return { ...resultBody, selectorHash: await hashCanonicalValue(resultBody) }
}
