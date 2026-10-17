import type { TtrpgSituationTemplateV1 } from './open-contract'

export const TTRPG_SITUATION_GENERATION_HOMOGENEITY_THRESHOLD_V1 = 0.8
export const TTRPG_SITUATION_GENERATION_HISTORY_LIMIT_V1 = 8
export const TTRPG_SITUATION_GENERATION_COOLDOWN_WORLD_TURNS_V1 = 3

export interface TtrpgSituationPersonalizationReferenceV1 {
  factKey: string
  actorScope?: readonly string[]
  actorKeys?: readonly string[]
  knownByActorKeys?: readonly string[]
  knownBy?: readonly string[]
  kind?: 'choice' | 'identity' | 'commitment' | 'other'
  source?: string
}

/**
 * Generation metadata stays next to a candidate and is never written into the
 * frozen campaign template. It makes the A3 proof explicit at the proposal
 * boundary.
 */
export type TtrpgSituationGenerationCandidateV1 = TtrpgSituationTemplateV1 & {
  personalizationRefs?: readonly TtrpgSituationPersonalizationReferenceV1[]
  personalizedReferences?: readonly TtrpgSituationPersonalizationReferenceV1[]
  personalization?: readonly TtrpgSituationPersonalizationReferenceV1[]
  dependencyGraph?: Readonly<Record<string, readonly string[]>>
  dependencies?: Readonly<Record<string, readonly string[]>>
}

export interface TtrpgSituationGenerationHistoryItemV1 {
  template: TtrpgSituationTemplateV1
  status?: 'accepted' | 'rejected' | 'pending'
  accepted?: boolean
  rejected?: boolean
  resolvedAtWorldTurn?: number
}

export type TtrpgSituationGenerationHistoryEntryV1 =
  | TtrpgSituationTemplateV1
  | TtrpgSituationGenerationHistoryItemV1

export interface TtrpgSituationGenerationInputV1 {
  candidate: TtrpgSituationGenerationCandidateV1
  recentSituations?: readonly TtrpgSituationGenerationHistoryEntryV1[]
  recentCandidates?: readonly TtrpgSituationGenerationHistoryEntryV1[]
  recentTemplates?: readonly TtrpgSituationGenerationHistoryEntryV1[]
  history?: readonly TtrpgSituationGenerationHistoryEntryV1[]
  worldTurn?: number
  cooldownUntilWorldTurn?: Readonly<Record<string, number>>
  cooldownUntilWorldTurnByTemplate?: Readonly<Record<string, number>>
  lastResolvedWorldTurnByTemplate?: Readonly<Record<string, number>>
  playerFactKeys?: readonly string[]
  personalizedFactKeys?: readonly string[]
  personalizationFactKeys?: readonly string[]
  playerActorKeys?: readonly string[]
  actorScope?: readonly string[]
  personalizationRefs?: readonly TtrpgSituationPersonalizationReferenceV1[]
}

export interface TtrpgSituationWeightedJaccardComparisonV1 {
  candidateTemplateKey: string
  comparedTemplateKey: string
  /** Alias kept in the comparison object for diagnostics and receipts. */
  templateKey: string
  candidateMotive: TtrpgSituationTemplateV1['motive']
  comparedMotive: TtrpgSituationTemplateV1['motive']
  sameMotive: boolean
  obstacleKindSimilarity: number
  suggestedActionSimilarity: number
  threshold: number
  isHomogeneous: boolean
  candidateObstacleKinds: string[]
  comparedObstacleKinds: string[]
  candidateSuggestedActionKeys: string[]
  comparedSuggestedActionKeys: string[]
}

export interface TtrpgSituationDependencyCheckV1 {
  passed: boolean
  hasDependency: boolean
  cycles: string[][]
  failures: Array<'missing-dependency' | 'cycle'>
}

export interface TtrpgSituationPersonalizationCheckV1 {
  passed: boolean
  references: TtrpgSituationPersonalizationReferenceV1[]
  matchedReferences: TtrpgSituationPersonalizationReferenceV1[]
  failures: Array<
    | 'missing-player-fact'
    | 'missing-actor-scope'
    | 'known-by-outside-actor-scope'
    | 'unscoped-reference'
  >
}

export interface TtrpgSituationCooldownCheckV1 {
  passed: boolean
  worldTurn: number
  cooldownUntilWorldTurn: number | null
  cooldownWorldTurns: number
  nextCooldownUntilWorldTurn: number
}

export interface TtrpgSituationGenerationRejectionV1 {
  code: 'A1' | 'A2' | 'A3' | 'cooldown'
  reason: string
  comparison?: TtrpgSituationWeightedJaccardComparisonV1
  cycle?: string[]
}

export interface TtrpgSituationGenerationResultV1 {
  accepted: boolean
  rejected: boolean
  templateKey: string
  a1: {
    passed: boolean
    threshold: number
    comparedCount: number
    comparisons: TtrpgSituationWeightedJaccardComparisonV1[]
  }
  a2: TtrpgSituationDependencyCheckV1
  a3: TtrpgSituationPersonalizationCheckV1
  cooldown: TtrpgSituationCooldownCheckV1
  rejections: TtrpgSituationGenerationRejectionV1[]
  reasons: string[]
}

type CandidateRecord = Record<string, unknown>
const hasOwn = (value: CandidateRecord, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key)

function record(value: unknown): CandidateRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as CandidateRecord
    : {}
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)]
}

function countValues(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return counts
}

/**
 * Weighted Jaccard for multisets. Empty multisets are identical (1); an empty
 * multiset compared with a non-empty one is dissimilar (0).
 */
export function calculateWeightedJaccardV1(
  valuesA: readonly string[],
  valuesB: readonly string[],
): number {
  const countsA = countValues(valuesA)
  const countsB = countValues(valuesB)
  const keys = new Set([...countsA.keys(), ...countsB.keys()])
  if (keys.size === 0) return 1

  let minimum = 0
  let maximum = 0
  for (const key of keys) {
    const countA = countsA.get(key) ?? 0
    const countB = countsB.get(key) ?? 0
    minimum += Math.min(countA, countB)
    maximum += Math.max(countA, countB)
  }
  return maximum === 0 ? 1 : minimum / maximum
}

export function weightedJaccardV1(
  valuesA: readonly string[],
  valuesB: readonly string[],
): number {
  return calculateWeightedJaccardV1(valuesA, valuesB)
}

function obstacleKinds(template: TtrpgSituationTemplateV1): string[] {
  return template.obstacles.flatMap(obstacle => [obstacle.kind])
}

function suggestedActionKeys(template: TtrpgSituationTemplateV1): string[] {
  return template.interventionPoints.flatMap(point => point.suggestedActionKeys)
}

function comparisonFor(
  candidate: TtrpgSituationTemplateV1,
  compared: TtrpgSituationTemplateV1,
  threshold: number,
): TtrpgSituationWeightedJaccardComparisonV1 {
  const candidateObstacleKinds = obstacleKinds(candidate)
  const comparedObstacleKinds = obstacleKinds(compared)
  const candidateSuggestedActionKeys = suggestedActionKeys(candidate)
  const comparedSuggestedActionKeys = suggestedActionKeys(compared)
  const obstacleKindSimilarity = calculateWeightedJaccardV1(candidateObstacleKinds, comparedObstacleKinds)
  const suggestedActionSimilarity = calculateWeightedJaccardV1(
    candidateSuggestedActionKeys,
    comparedSuggestedActionKeys,
  )
  const sameMotive = candidate.motive === compared.motive
  return {
    candidateTemplateKey: candidate.templateKey,
    comparedTemplateKey: compared.templateKey,
    templateKey: compared.templateKey,
    candidateMotive: candidate.motive,
    comparedMotive: compared.motive,
    sameMotive,
    obstacleKindSimilarity,
    suggestedActionSimilarity,
    threshold,
    isHomogeneous: sameMotive
      && obstacleKindSimilarity >= threshold
      && suggestedActionSimilarity >= threshold,
    candidateObstacleKinds,
    comparedObstacleKinds,
    candidateSuggestedActionKeys,
    comparedSuggestedActionKeys,
  }
}

function templateFromHistory(
  entry: TtrpgSituationGenerationHistoryEntryV1,
): TtrpgSituationTemplateV1 {
  const row = record(entry)
  const nested = row.template ?? row.candidate
  return nested !== undefined ? nested as TtrpgSituationTemplateV1 : entry as TtrpgSituationTemplateV1
}

function historyEntryRejected(entry: TtrpgSituationGenerationHistoryEntryV1): boolean {
  const row = record(entry)
  return row.rejected === true
    || row.accepted === false
    || row.status === 'rejected'
}

function generationHistory(
  input: TtrpgSituationGenerationInputV1,
): TtrpgSituationGenerationHistoryEntryV1[] {
  const history = input.recentSituations
    ?? input.recentCandidates
    ?? input.recentTemplates
    ?? input.history
    ?? []
  return history
    .filter(entry => !historyEntryRejected(entry))
    .slice(-TTRPG_SITUATION_GENERATION_HISTORY_LIMIT_V1)
}

function candidateTemplate(
  candidate: TtrpgSituationGenerationCandidateV1,
): TtrpgSituationTemplateV1 {
  const row = record(candidate)
  return row.template !== undefined
    ? row.template as TtrpgSituationTemplateV1
    : candidate
}

function candidateMetadata(candidate: TtrpgSituationGenerationCandidateV1): CandidateRecord {
  const row = record(candidate)
  const nested = row.template
  return nested !== undefined ? record(candidate) : row
}

function stringArrayRecord(value: unknown): Record<string, string[]> {
  const row = record(value)
  const result: Record<string, string[]> = {}
  for (const [key, dependencies] of Object.entries(row)) {
    result[key] = stringArray(dependencies)
  }
  return result
}

function addDependencyGraph(
  target: Map<string, string[]>,
  value: unknown,
): void {
  for (const [key, dependencies] of Object.entries(stringArrayRecord(value))) {
    target.set(key, uniqueStrings(dependencies))
  }
}

function situationDependencyGraph(value: unknown): Map<string, string[]> {
  const row = record(value)
  const graph = new Map<string, string[]>()
  addDependencyGraph(graph, row.dependencyGraph)
  addDependencyGraph(graph, row.dependencies)

  const obstacles = Array.isArray(row.obstacles) ? row.obstacles : []
  for (const obstacleValue of obstacles) {
    const obstacle = record(obstacleValue)
    if (typeof obstacle.obstacleKey === 'string') {
      graph.set(obstacle.obstacleKey, uniqueStrings(stringArray(obstacle.dependsOn)))
    }
  }

  const driver = record(row.driver ?? row.driverBinding)
  if (hasOwn(driver, 'dependsOn')) {
    const key = typeof driver.driverKey === 'string'
      ? driver.driverKey
      : typeof driver.key === 'string' ? driver.key : 'driver'
    graph.set(key, uniqueStrings(stringArray(driver.dependsOn)))
  }

  const evidence = Array.isArray(row.evidence) ? row.evidence : []
  for (const evidenceValue of evidence) {
    const evidenceRow = record(evidenceValue)
    const evidenceKey = typeof evidenceRow.clueRef === 'string'
      ? evidenceRow.clueRef
      : typeof evidenceRow.evidenceKey === 'string'
        ? evidenceRow.evidenceKey
        : typeof evidenceRow.key === 'string' ? evidenceRow.key : null
    if (hasOwn(evidenceRow, 'dependsOn') && evidenceKey !== null) {
      graph.set(evidenceKey, uniqueStrings(stringArray(evidenceRow.dependsOn)))
    }
  }
  return graph
}

function completeGraph(graph: Map<string, string[]>): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [key, dependencies] of graph) result.set(key, [...dependencies])
  for (const dependencies of graph.values()) {
    for (const dependency of dependencies) {
      if (!result.has(dependency)) result.set(dependency, [])
    }
  }
  return result
}

/**
 * Returns deterministic cycle paths. A path repeats its first node at the end.
 * The input may be a situation candidate or an explicit dependency map.
 */
export function detectTtrpgSituationDependencyCyclesV1(value: unknown): string[][] {
  const graph = completeGraph(situationDependencyGraph(value))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []
  const cycles: string[][] = []
  const cycleKeys = new Set<string>()

  function visit(key: string): void {
    if (visiting.has(key)) {
      const start = stack.indexOf(key)
      const cycle = [...stack.slice(start), key]
      const cycleKey = cycle.join('>')
      if (!cycleKeys.has(cycleKey)) {
        cycleKeys.add(cycleKey)
        cycles.push(cycle)
      }
      return
    }
    if (visited.has(key)) return
    visiting.add(key)
    stack.push(key)
    for (const dependency of [...(graph.get(key) ?? [])].sort()) visit(dependency)
    stack.pop()
    visiting.delete(key)
    visited.add(key)
  }

  for (const key of [...graph.keys()].sort()) visit(key)
  return cycles
}

export function checkTtrpgSituationDependenciesV1(
  value: unknown,
): TtrpgSituationDependencyCheckV1 {
  const row = record(value)
  const obstacles = Array.isArray(row.obstacles) ? row.obstacles : []
  const hasDependency = obstacles.some(obstacleValue =>
    stringArray(record(obstacleValue).dependsOn).length > 0)
  const cycles = detectTtrpgSituationDependencyCyclesV1(value)
  const failures: TtrpgSituationDependencyCheckV1['failures'] = []
  if (!hasDependency) failures.push('missing-dependency')
  if (cycles.length > 0) failures.push('cycle')
  return { passed: failures.length === 0, hasDependency, cycles, failures }
}

function referenceFromValue(value: unknown): TtrpgSituationPersonalizationReferenceV1 | null {
  const row = record(value)
  if (typeof row.factKey !== 'string' || row.factKey.length === 0) return null
  const actorScope = stringArray(row.actorScope ?? row.actorKeys)
  const knownByActorKeys = stringArray(row.knownByActorKeys ?? row.knownBy)
  return {
    factKey: row.factKey,
    actorScope: uniqueStrings(actorScope),
    knownByActorKeys: uniqueStrings(knownByActorKeys),
    ...(typeof row.kind === 'string' ? { kind: row.kind as TtrpgSituationPersonalizationReferenceV1['kind'] } : {}),
    ...(typeof row.source === 'string' ? { source: row.source } : {}),
  }
}

function explicitPersonalizationReferences(
  candidate: TtrpgSituationGenerationCandidateV1,
  inputReferences: readonly TtrpgSituationPersonalizationReferenceV1[] | undefined,
): TtrpgSituationPersonalizationReferenceV1[] {
  const candidateRow = candidateMetadata(candidate)
  const explicitValues = inputReferences
    ?? (Array.isArray(candidateRow.personalizationRefs) ? candidateRow.personalizationRefs : undefined)
    ?? (Array.isArray(candidateRow.personalizedReferences) ? candidateRow.personalizedReferences : undefined)
    ?? (Array.isArray(candidateRow.personalization) ? candidateRow.personalization : undefined)
    ?? []
  const references = explicitValues.flatMap(value => {
    const reference = referenceFromValue(value)
    return reference === null ? [] : [reference]
  })

  const template = candidateTemplate(candidate)
  for (const evidence of template.evidence) {
    const knownByActorKeys = uniqueStrings(evidence.knownByActorKeys)
    const actorScope = uniqueStrings([
      ...knownByActorKeys,
      ...evidence.discoveryPolicy.recipientActorKeys,
    ])
    for (const factKey of evidence.sourceFactRefs) {
      references.push({
        factKey,
        actorScope,
        knownByActorKeys,
        source: `evidence:${evidence.clueRef}`,
      })
    }
  }
  return references
}

function playerFactKeys(input: TtrpgSituationGenerationInputV1): Set<string> {
  return new Set(
    input.playerFactKeys
      ?? input.personalizedFactKeys
      ?? input.personalizationFactKeys
      ?? [],
  )
}

export function checkTtrpgSituationPersonalizationV1(
  input: Pick<
    TtrpgSituationGenerationInputV1,
    'candidate' | 'playerFactKeys' | 'personalizedFactKeys' | 'personalizationFactKeys'
      | 'playerActorKeys' | 'actorScope' | 'personalizationRefs'
  >,
): TtrpgSituationPersonalizationCheckV1 {
  const references = explicitPersonalizationReferences(input.candidate, input.personalizationRefs)
  const factKeys = playerFactKeys(input)
  const allowedActors = input.playerActorKeys ?? input.actorScope
  const allowedActorSet = allowedActors === undefined ? null : new Set(allowedActors)
  const matchedReferences: TtrpgSituationPersonalizationReferenceV1[] = []
  const failures = new Set<TtrpgSituationPersonalizationCheckV1['failures'][number]>()

  for (const reference of references) {
    const actorScope = uniqueStrings([
      ...(reference.actorScope ?? []),
      ...(reference.actorKeys ?? []),
    ])
    const knownByActorKeys = uniqueStrings([
      ...(reference.knownByActorKeys ?? []),
      ...(reference.knownBy ?? []),
    ])
    const scopedActors = uniqueStrings([...actorScope, ...knownByActorKeys])
    if (!factKeys.has(reference.factKey)) continue
    if (scopedActors.length === 0) {
      failures.add('unscoped-reference')
      continue
    }
    if (allowedActorSet !== null && scopedActors.some(actorKey => !allowedActorSet.has(actorKey))) {
      failures.add('known-by-outside-actor-scope')
      continue
    }
    matchedReferences.push({
      ...reference,
      actorScope,
      knownByActorKeys,
    })
  }

  if (factKeys.size === 0 || matchedReferences.length === 0) failures.add('missing-player-fact')
  if (references.length > 0
    && references.every(reference =>
      !factKeys.has(reference.factKey)
      || uniqueStrings([
        ...(reference.actorScope ?? []),
        ...(reference.actorKeys ?? []),
        ...(reference.knownByActorKeys ?? []),
        ...(reference.knownBy ?? []),
      ]).length === 0)) {
    failures.add('missing-actor-scope')
  }

  return {
    passed: failures.size === 0,
    references,
    matchedReferences,
    failures: [...failures],
  }
}

function numberMap(
  value: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> {
  return value ?? {}
}

function cooldownFor(
  input: TtrpgSituationGenerationInputV1,
  templateKey: string,
  history: readonly TtrpgSituationGenerationHistoryEntryV1[],
): number | null {
  const configured = numberMap(
    input.cooldownUntilWorldTurn ?? input.cooldownUntilWorldTurnByTemplate,
  )[templateKey]
  const lastResolved = numberMap(input.lastResolvedWorldTurnByTemplate)[templateKey]
  const historyResolved = history
    .map(entry => {
      const row = record(entry)
      return templateFromHistory(entry).templateKey === templateKey
        && typeof row.resolvedAtWorldTurn === 'number'
        ? row.resolvedAtWorldTurn
        : null
    })
    .filter((turn): turn is number => turn !== null)
  const resolvedTurns = [
    ...historyResolved,
    ...(Number.isSafeInteger(lastResolved) ? [lastResolved] : []),
  ]
  const latestResolved = resolvedTurns.length > 0 ? Math.max(...resolvedTurns) : null
  const derived = latestResolved === null
    ? null
    : latestResolved + TTRPG_SITUATION_GENERATION_COOLDOWN_WORLD_TURNS_V1
  return configured === undefined ? derived : Math.max(configured, derived ?? configured)
}

export function getTtrpgSituationCooldownUntilWorldTurnV1(worldTurn: number): number {
  return worldTurn + TTRPG_SITUATION_GENERATION_COOLDOWN_WORLD_TURNS_V1
}

export function checkTtrpgSituationCooldownV1(
  input: Pick<
    TtrpgSituationGenerationInputV1,
    'candidate' | 'worldTurn' | 'cooldownUntilWorldTurn' | 'cooldownUntilWorldTurnByTemplate'
      | 'lastResolvedWorldTurnByTemplate' | 'recentSituations' | 'recentCandidates' | 'recentTemplates' | 'history'
  >,
): TtrpgSituationCooldownCheckV1 {
  const worldTurn = input.worldTurn ?? 0
  const template = candidateTemplate(input.candidate)
  const history = [
    ...(input.recentSituations ?? []),
    ...(input.recentCandidates ?? []),
    ...(input.recentTemplates ?? []),
    ...(input.history ?? []),
  ]
  const cooldownUntilWorldTurn = cooldownFor(input, template.templateKey, history)
  return {
    passed: cooldownUntilWorldTurn === null || worldTurn >= cooldownUntilWorldTurn,
    worldTurn,
    cooldownUntilWorldTurn,
    cooldownWorldTurns: TTRPG_SITUATION_GENERATION_COOLDOWN_WORLD_TURNS_V1,
    nextCooldownUntilWorldTurn: getTtrpgSituationCooldownUntilWorldTurnV1(worldTurn),
  }
}

export function evaluateTtrpgSituationGenerationV1(
  input: TtrpgSituationGenerationInputV1,
): TtrpgSituationGenerationResultV1 {
  const candidate = candidateTemplate(input.candidate)
  const threshold = TTRPG_SITUATION_GENERATION_HOMOGENEITY_THRESHOLD_V1
  const comparisons = generationHistory(input)
    .map(entry => comparisonFor(candidate, templateFromHistory(entry), threshold))
  const homogeneousComparisons = comparisons.filter(comparison => comparison.isHomogeneous)
  const a1 = {
    passed: homogeneousComparisons.length === 0,
    threshold,
    comparedCount: comparisons.length,
    comparisons,
  }
  const a2 = checkTtrpgSituationDependenciesV1(input.candidate)
  const a3 = checkTtrpgSituationPersonalizationV1(input)
  const cooldown = checkTtrpgSituationCooldownV1(input)
  const rejections: TtrpgSituationGenerationRejectionV1[] = []

  for (const comparison of homogeneousComparisons) {
    rejections.push({
      code: 'A1',
      comparison,
      reason: `A1 同质化拒绝：比较对象 ${comparison.comparedTemplateKey}，障碍 kind 加权 Jaccard=${comparison.obstacleKindSimilarity.toFixed(2)}，介入 action 加权 Jaccard=${comparison.suggestedActionSimilarity.toFixed(2)}，阈值=${threshold.toFixed(2)}`,
    })
  }
  if (!a2.passed) {
    for (const cycle of a2.cycles) {
      rejections.push({
        code: 'A2',
        cycle,
        reason: `A2 因果依赖环拒绝：${cycle.join(' -> ')}`,
      })
    }
    if (a2.failures.includes('missing-dependency')) {
      rejections.push({
        code: 'A2',
        reason: 'A2 因果依赖拒绝：obstacles.dependsOn 至少需要一条非空边',
      })
    }
  }
  if (!a3.passed) {
    rejections.push({
      code: 'A3',
      reason: `A3 个性化引用拒绝：${a3.failures.join(',') || '缺少显式 player fact 与 actor scope'}`,
    })
  }
  if (!cooldown.passed) {
    rejections.push({
      code: 'cooldown',
      reason: `冷却拒绝：${candidate.templateKey} 在 worldTurn ${cooldown.worldTurn} 前不可再次生成（冷却至 ${cooldown.cooldownUntilWorldTurn}）`,
    })
  }

  const accepted = rejections.length === 0
  return {
    accepted,
    rejected: !accepted,
    templateKey: candidate.templateKey,
    a1,
    a2,
    a3,
    cooldown,
    rejections,
    reasons: rejections.map(rejection => rejection.reason),
  }
}

export function validateTtrpgSituationGenerationCandidateV1(
  input: TtrpgSituationGenerationInputV1,
): TtrpgSituationGenerationResultV1 {
  return evaluateTtrpgSituationGenerationV1(input)
}

export function checkTtrpgSituationGenerationV1(
  input: TtrpgSituationGenerationInputV1,
): TtrpgSituationGenerationResultV1 {
  return evaluateTtrpgSituationGenerationV1(input)
}
