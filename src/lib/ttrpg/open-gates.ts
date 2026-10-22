import type {
  RulePackV2,
  TtrpgCampaignContentV2,
  TtrpgOpenCampaignFrontV1,
  TtrpgOpenStageClosurePolicyV1,
  TtrpgPredicateV1,
  TtrpgSituationTemplateV1,
} from './open-contract'
import { closurePolicy } from './open-content-templates'
import { parseTtrpgSituationTemplateV1 } from './situation-engine'
import type { TtrpgSituationInstanceV1 } from './situation-engine'
import { evaluateTtrpgPredicateV1 } from './predicate'
import type { TtrpgPredicateEvaluationContextV1 } from './predicate'
import {
  parseTtrpgPressureClockV1,
  parseTtrpgPressureFrontV1,
} from './pressure-runtime'
import type { TtrpgPressureFrontStateV1 } from './pressure-runtime'
import type { TtrpgSessionFactV1 } from './session-facts'
import { parseTtrpgSessionFactV1 } from './session-facts'
import * as p from './open-contract-parse'

export const TTRPG_OPEN_GATE_KEYS = [
  'exit-exists',
  'hypothesis-formable',
  'telegraph-complete',
  'facts-consistent',
] as const

export type TtrpgOpenGateKeyV1 = typeof TTRPG_OPEN_GATE_KEYS[number]
export type TtrpgOpenGateApplicabilityV1 = 'applicable' | 'not-applicable'
export type TtrpgOpenGateRecoveryV1 = 'none' | 'request-author-review'

export interface TtrpgOpenGateResultV1 {
  applicability: TtrpgOpenGateApplicabilityV1
  passed: boolean | null
  evidence: string[]
  viewerKey: string | null
  stageRevision: string
  evaluationBasisHash: string | null
}

export interface TtrpgOpenRuntimeGateInputV1 {
  campaign?: Partial<TtrpgCampaignContentV2> | null
  openRun?: Record<string, unknown> | null
  predicateContext?: TtrpgPredicateEvaluationContextV1
  viewer?: { actorKey?: string | null; viewerKey?: string | null; audience?: 'player' | 'party' | 'public' }
  viewerKey?: string | null
  actorKey?: string | null
  stage?: { status?: 'active' | 'closed' | 'paused'; revision?: string | number } | null
  stageStatus?: 'active' | 'closed' | 'paused'
  stageRevision?: string | number
  evaluationBasisHash?: string | null
  consecutiveFailures?: Partial<Record<TtrpgOpenGateKeyV1, number>>
  previousGateResults?: Partial<Record<TtrpgOpenGateKeyV1, TtrpgOpenGateResultV1>>
  sessionFacts?: readonly TtrpgSessionFactV1[]
  factGateInputs?: readonly Record<string, unknown>[]
  incrementalFactKeys?: readonly string[]
  [key: string]: unknown
}

export interface TtrpgOpenRuntimeGateEvaluationV1 {
  results: Record<TtrpgOpenGateKeyV1, TtrpgOpenGateResultV1>
  gates: Record<TtrpgOpenGateKeyV1, TtrpgOpenGateResultV1>
  consecutiveFailures: Record<TtrpgOpenGateKeyV1, number>
  recovery: Record<TtrpgOpenGateKeyV1, TtrpgOpenGateRecoveryV1>
  requestAuthorReview: TtrpgOpenGateKeyV1[]
  allApplicablePassed: boolean
  viewerKey: string | null
  stageRevision: string
  evaluationBasisHash: string | null
}

export interface TtrpgOpenEvidenceGraphV1 {
  nodes: {
    evidence: string[]
    obstacles: string[]
    interventionPoints: string[]
  }
  edges: {
    evidenceToObstacle: Array<{ from: string; to: string }>
    obstacleToObstacle: Array<{ from: string; to: string }>
    interventionToObstacle: Array<{ from: string; to: string }>
  }
}

export interface TtrpgOpenPublicationGateV1 {
  gateId: string
  passed: boolean
  evidence: string[]
}

export interface TtrpgOpenPublicationGateReportV1 {
  valid: boolean
  gates: TtrpgOpenPublicationGateV1[]
  errors: string[]
}

export type TtrpgOpenFailureCategoryV1 =
  | 'fact-conflict'
  | 'gate-failed'
  | 'situation-rejected'
  | 'situation-capacity'
  | 'telegraph-missing'
  | 'oracle-scope-violation'
  | 'oracle-budget'
  | 'intent-unclear'
  | 'predicate-unresolvable'
  | 'budget-overflow'
  | 'media-degraded'

export type TtrpgOpenFailureRecoveryV1 =
  | 'reject-candidate'
  | 'regenerate-local'
  | 'request-author-review'
  | 'degrade-to-fallback'
  | 'pause-session'

export interface TtrpgOpenFailureLogV1 {
  sessionId: number
  atSequence: number
  atWorldTurn: number
  category: TtrpgOpenFailureCategoryV1
  violatedRule: string
  relatedRefs: {
    factKeys: string[]
    situationKeys: string[]
    frontKeys: string[]
    triggerKeys: string[]
    oracleKeys: string[]
    slotKeys: string[]
  }
  evidence: string[]
  recovery: TtrpgOpenFailureRecoveryV1
  recoveryAttempt: number
  recoveryMaxAttempts: number
}

export interface TtrpgOpenFailureRecordInputV1 {
  sessionId: number
  atSequence: number
  atWorldTurn: number
  category: TtrpgOpenFailureCategoryV1
  violatedRule: string
  relatedRefs?: Partial<TtrpgOpenFailureLogV1['relatedRefs']>
  evidence?: string[]
  recovery?: TtrpgOpenFailureRecoveryV1
  recoveryAttempt?: number
  recoveryMaxAttempts?: number
  log?: TtrpgOpenFailureLogV1
}

export interface TtrpgOpenFailureBufferV1 {
  failures: TtrpgOpenFailureLogV1[]
  droppedCount: number
}

export interface TtrpgOpenStageClosureDecisionV1 {
  eligible: boolean
  reason: 'trigger' | 'maximum-world-turns' | 'not-eligible'
  triggerKey: string | null
  summaryPrompt: string | null
  maximumReached: boolean
  evidence: string[]
}

const FAILURE_CATEGORIES: readonly TtrpgOpenFailureCategoryV1[] = [
  'fact-conflict',
  'gate-failed',
  'situation-rejected',
  'situation-capacity',
  'telegraph-missing',
  'oracle-scope-violation',
  'oracle-budget',
  'intent-unclear',
  'predicate-unresolvable',
  'budget-overflow',
  'media-degraded',
]

const FAILURE_RECOVERIES: readonly TtrpgOpenFailureRecoveryV1[] = [
  'reject-candidate',
  'regenerate-local',
  'request-author-review',
  'degrade-to-fallback',
  'pause-session',
]

const FAILURE_REF_KEYS = [
  'factKeys',
  'situationKeys',
  'frontKeys',
  'triggerKeys',
  'oracleKeys',
  'slotKeys',
] as const

const PLAYER_PROJECTION_FAILURE_KEYS = new Set([
  'failures',
  'failureLogs',
  'openFailures',
  'openFailureLogs',
])

const EMPTY_REFS: TtrpgOpenFailureLogV1['relatedRefs'] = {
  factKeys: [],
  situationKeys: [],
  frontKeys: [],
  triggerKeys: [],
  oracleKeys: [],
  slotKeys: [],
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`[ttrpg-open-gates] ${label}必须是对象`)
  return value
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function integer(value: unknown, label: string, minimum = 0): number {
  return p.integer(value, label, minimum)
}

function readRecord(root: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = root[key]
  return isRecord(value) ? value : null
}

function firstRecord(...values: unknown[]): Record<string, unknown> {
  for (const value of values) if (isRecord(value)) return value
  return {}
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function gateResult(
  passed: boolean | null,
  evidence: readonly string[],
  viewerKey: string | null,
  stageRevision: string,
  evaluationBasisHash: string | null,
  applicability: TtrpgOpenGateApplicabilityV1 = 'applicable',
): TtrpgOpenGateResultV1 {
  return {
    applicability,
    passed,
    evidence: [...evidence],
    viewerKey,
    stageRevision,
    evaluationBasisHash,
  }
}

function viewerActorKey(root: Record<string, unknown>): string | null {
  const viewer = readRecord(root, 'viewer')
  const value = root.actorKey ?? viewer?.actorKey
  return typeof value === 'string' && value.length > 0 ? value : null
}

function viewerKey(root: Record<string, unknown>): string | null {
  const viewer = readRecord(root, 'viewer')
  const value = root.viewerKey ?? viewer?.viewerKey ?? root.actorKey ?? viewer?.actorKey
  return typeof value === 'string' && value.length > 0 ? value : null
}

function stageStatus(root: Record<string, unknown>): 'active' | 'closed' | 'paused' {
  const stage = readRecord(root, 'stage')
  const value = root.stageStatus ?? stage?.status ?? 'active'
  if (value === 'closed' || value === 'paused') return value
  return 'active'
}

function stageRevision(root: Record<string, unknown>): string {
  const stage = readRecord(root, 'stage')
  const value = root.stageRevision ?? stage?.revision ?? 'stage.0'
  return String(value)
}

function evaluationBasisHash(root: Record<string, unknown>, campaign: Record<string, unknown>): string | null {
  const direct = root.evaluationBasisHash
  if (typeof direct === 'string') return direct
  const run = readRecord(root, 'openRun')
  const runHash = run?.evaluationBasisHash
  if (typeof runHash === 'string') return runHash
  const index = readRecord(campaign, 'frozenWorldPredicateIndex')
  return typeof index?.indexHash === 'string' ? index.indexHash : null
}

function activeSituationRows(root: Record<string, unknown>): TtrpgSituationInstanceV1[] {
  const run = readRecord(root, 'openRun')
  const situations = firstRecord(root.situations, run?.situations)
  return array(situations.active)
    .filter(isRecord)
    .filter(row => row.status === undefined || row.status === 'active')
    .map(row => ({
      situationKey: String(row.situationKey ?? ''),
      templateKey: String(row.templateKey ?? ''),
      status: 'active',
      activatedAtSequence: Number(row.activatedAtSequence ?? 0),
      activatedAtWorldTurn: Number(row.activatedAtWorldTurn ?? 0),
      activationReason: row.activationReason === 'front-escalation' || row.activationReason === 'consequence'
        ? row.activationReason : 'opening',
      whyNowRefs: array(row.whyNowRefs).filter((value): value is string => typeof value === 'string'),
      satisfiedObstacleKeys: array(row.satisfiedObstacleKeys).filter((value): value is string => typeof value === 'string'),
      discoveredEvidenceRefs: array(row.discoveredEvidenceRefs).filter((value): value is string => typeof value === 'string'),
      noInterventionDueWorldTurn: Number(row.noInterventionDueWorldTurn ?? 0),
      resolvedAtSequence: null,
      resolutionKind: null,
    }))
}

function campaignTemplates(campaign: Record<string, unknown>): TtrpgSituationTemplateV1[] {
  return array(campaign.situationTemplates).filter(isRecord) as unknown as TtrpgSituationTemplateV1[]
}

function predicateContext(
  root: Record<string, unknown>,
  campaign: Record<string, unknown>,
  active: readonly TtrpgSituationInstanceV1[],
): TtrpgPredicateEvaluationContextV1 | null {
  const raw = root.predicateContext
  if (!isRecord(raw)) return null
  const run = readRecord(root, 'openRun')
  const pressure = firstRecord(root.pressure, run?.pressure, raw.pressure)
  const templates = campaignTemplates(campaign)
  const rawContext = raw as unknown as TtrpgPredicateEvaluationContextV1
  const rawPressure = isRecord(raw.pressure) ? raw.pressure : {}
  const rawEffectLedger = isRecord(raw.effectLedger) ? raw.effectLedger : {}
  const rawStoryFacts = isRecord(rawEffectLedger.storyFacts) ? rawEffectLedger.storyFacts : {}
  const rawSocialBalances = isRecord(rawEffectLedger.socialBalances) ? rawEffectLedger.socialBalances : {}
  const rawActors = isRecord(raw.actors) ? raw.actors : {}
  const worldTurnValue = typeof root.worldTurn === 'number'
    ? root.worldTurn
    : typeof run?.worldTurn === 'number' ? run.worldTurn : rawContext.worldTurn
  return {
    ...rawContext,
    worldTurn: typeof worldTurnValue === 'number' ? worldTurnValue : 0,
    pressure: {
      ...rawPressure,
      clocks: firstRecord(pressure.clocks, rawPressure.clocks) as TtrpgPredicateEvaluationContextV1['pressure']['clocks'],
      fronts: firstRecord(pressure.fronts, rawPressure.fronts) as TtrpgPredicateEvaluationContextV1['pressure']['fronts'],
    } as TtrpgPredicateEvaluationContextV1['pressure'],
    situations: {
      active: active.map(instance => ({
        templateKey: instance.templateKey,
        discoveredEvidenceRefs: instance.discoveredEvidenceRefs,
      })),
      templates: templates.map(template => ({
        templateKey: template.templateKey,
        evidence: template.evidence.map(evidence => ({
          clueRef: evidence.clueRef,
          audience: evidence.audience,
          knownByActorKeys: evidence.knownByActorKeys,
        })),
      })),
    },
    sessionFacts: Array.isArray(rawContext.sessionFacts) ? rawContext.sessionFacts : [],
    frozenWorldPredicateIndex: rawContext.frozenWorldPredicateIndex
      ?? campaign.frozenWorldPredicateIndex as unknown as TtrpgPredicateEvaluationContextV1['frozenWorldPredicateIndex'],
    effectLedger: {
      storyFacts: rawStoryFacts as TtrpgPredicateEvaluationContextV1['effectLedger']['storyFacts'],
      socialBalances: rawSocialBalances as TtrpgPredicateEvaluationContextV1['effectLedger']['socialBalances'],
    },
    actors: rawActors as TtrpgPredicateEvaluationContextV1['actors'],
    chaos: typeof rawContext.chaos === 'number' ? rawContext.chaos : 0,
  }
}

function predicateValue(
  predicate: TtrpgPredicateV1,
  context: TtrpgPredicateEvaluationContextV1 | null,
): { value: boolean; error: string | null } {
  if (predicate === null || predicate === undefined) return { value: false, error: 'predicate为空' }
  if (!context) return { value: false, error: 'predicateContext缺失' }
  try {
    return { value: evaluateTtrpgPredicateV1(predicate, context), error: null }
  } catch (error) {
    return { value: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function pointVisibleToActor(
  point: TtrpgSituationTemplateV1['interventionPoints'][number],
  actorKey: string | null,
): boolean {
  if (point.visibleTo === 'party' || point.visibleTo === 'public') return true
  return actorKey !== null && point.visibleTo === 'private' && point.knownByActorKeys.includes(actorKey)
}

function evidenceKnownToActor(
  evidence: TtrpgSituationTemplateV1['evidence'][number],
  instance: TtrpgSituationInstanceV1,
  actorKey: string | null,
): boolean {
  if (instance.discoveredEvidenceRefs.includes(evidence.clueRef)) return true
  if (evidence.audience === 'party') return true
  return evidence.audience === 'private'
    && actorKey !== null
    && evidence.knownByActorKeys.includes(actorKey)
}

function evidenceGraph(template: TtrpgSituationTemplateV1): TtrpgOpenEvidenceGraphV1 {
  const evidence = template.evidence.map(item => item.clueRef)
  const obstacles = template.obstacles.map(item => item.obstacleKey)
  const interventionPoints = template.interventionPoints.map(item => item.pointKey)
  return {
    nodes: {
      evidence: [...evidence],
      obstacles: [...obstacles],
      interventionPoints: [...interventionPoints],
    },
    edges: {
      evidenceToObstacle: template.evidence.flatMap(item =>
        item.coversObstacleKeys.map(to => ({ from: item.clueRef, to }))),
      obstacleToObstacle: template.obstacles.flatMap(item =>
        item.dependsOn.map(to => ({ from: item.obstacleKey, to }))),
      interventionToObstacle: template.interventionPoints.flatMap(item =>
        item.targetsObstacleKeys.map(to => ({ from: item.pointKey, to }))),
    },
  }
}

export function buildTtrpgOpenEvidenceGraphV1(
  template: TtrpgSituationTemplateV1,
): TtrpgOpenEvidenceGraphV1 {
  return evidenceGraph(clone(template))
}

export const deriveTtrpgOpenEvidenceGraphV1 = buildTtrpgOpenEvidenceGraphV1

function transitiveDependencies(
  template: TtrpgSituationTemplateV1,
  obstacleKey: string,
): string[] {
  const byKey = new Map(template.obstacles.map(obstacle => [obstacle.obstacleKey, obstacle]))
  const result = new Set<string>()
  const pending = [...(byKey.get(obstacleKey)?.dependsOn ?? [])]
  while (pending.length > 0) {
    const current = pending.shift()!
    if (result.has(current)) continue
    result.add(current)
    pending.push(...(byKey.get(current)?.dependsOn ?? []))
  }
  return [...result]
}

function hypothesisFormable(
  template: TtrpgSituationTemplateV1,
  instance: TtrpgSituationInstanceV1,
  actorKey: string | null,
  context: TtrpgPredicateEvaluationContextV1 | null,
): { passed: boolean; evidence: string[] } {
  const covered = new Set(instance.satisfiedObstacleKeys)
  const knownEvidence = template.evidence.filter(evidence =>
    evidenceKnownToActor(evidence, instance, actorKey))
  for (const evidence of knownEvidence) {
    for (const obstacleKey of evidence.coversObstacleKeys) covered.add(obstacleKey)
  }
  const reasons: string[] = []
  for (const point of template.interventionPoints) {
    if (!pointVisibleToActor(point, actorKey)) continue
    const requires = point.requiresPredicate === null
      ? { value: true, error: null }
      : predicateValue(point.requiresPredicate, context)
    if (!requires.value) continue
    const missing = point.targetsObstacleKeys.flatMap(obstacleKey =>
      transitiveDependencies(template, obstacleKey).filter(dependency => !covered.has(dependency)))
    if (missing.length === 0) {
      reasons.push(`point=${point.pointKey}`)
      return { passed: true, evidence: reasons }
    }
  }
  return {
    passed: false,
    evidence: [
      `knownEvidence=${knownEvidence.length}`,
      `satisfiedObstacles=${instance.satisfiedObstacleKeys.length}`,
      'no-visible-intervention-with-covered-predecessors',
    ],
  }
}

function runtimePressure(
  root: Record<string, unknown>,
  campaign: Record<string, unknown>,
): {
  clocks: Record<string, { value: number }>
  fronts: Record<string, TtrpgPressureFrontStateV1 & { currentStageKey: string | null }>
} {
  const run = readRecord(root, 'openRun')
  const pressure = firstRecord(root.pressure, run?.pressure)
  const campaignClocks = array(campaign.clocks).filter(isRecord).map(parseTtrpgPressureClockV1)
  const campaignFronts = array(campaign.fronts).filter(isRecord).map(parseTtrpgPressureFrontV1)
  const clockSource = firstRecord(pressure.clocks)
  const clocks: Record<string, { value: number }> = {}
  for (const clock of campaignClocks) {
    const key = String(clock.clockKey ?? '')
    const state = readRecord(clockSource, key)
    const value = state && typeof state.value === 'number' ? state.value : Number(clock.initialValue ?? 0)
    clocks[key] = { value }
  }
  const frontSource = firstRecord(pressure.fronts)
  const fronts: Record<string, TtrpgPressureFrontStateV1 & { currentStageKey: string | null }> = {}
  for (const front of campaignFronts) {
    const key = String(front.frontKey ?? '')
    const state = readRecord(frontSource, key)
    fronts[key] = {
      currentStageKey: typeof state?.currentStageKey === 'string' ? state.currentStageKey : null,
      telegraphWorldTurns: firstRecord(state?.telegraphWorldTurns) as Record<string, number>,
      defeated: state?.defeated === true,
    }
  }
  return { clocks, fronts }
}

function gateG1(
  templates: readonly TtrpgSituationTemplateV1[],
  active: readonly TtrpgSituationInstanceV1[],
  actorKey: string | null,
  context: TtrpgPredicateEvaluationContextV1 | null,
): TtrpgOpenGateResultV1 {
  const evidence: string[] = []
  for (const instance of active) {
    const template = templates.find(candidate => candidate.templateKey === instance.templateKey)
    if (!template) {
      evidence.push(`missing-template=${instance.templateKey}`)
      continue
    }
    for (const point of template.interventionPoints) {
      if (!pointVisibleToActor(point, actorKey)) continue
      const predicate = point.requiresPredicate === null
        ? { value: true, error: null }
        : predicateValue(point.requiresPredicate, context)
      if (predicate.value) {
        return gateResult(true, [`situation=${instance.situationKey}`, `point=${point.pointKey}`], actorKey, '', null)
      }
      if (predicate.error) evidence.push(`${point.pointKey}:${predicate.error}`)
    }
  }
  return gateResult(false, [
    ...evidence,
    active.length === 0 ? 'active-situations=0' : 'no-visible-satisfied-intervention',
  ], actorKey, '', null)
}

function gateG2(
  templates: readonly TtrpgSituationTemplateV1[],
  active: readonly TtrpgSituationInstanceV1[],
  actorKey: string | null,
  context: TtrpgPredicateEvaluationContextV1 | null,
): TtrpgOpenGateResultV1 {
  for (const instance of active) {
    const template = templates.find(candidate => candidate.templateKey === instance.templateKey)
    if (!template) continue
    const result = hypothesisFormable(template, instance, actorKey, context)
    if (result.passed) return gateResult(true, [`situation=${instance.situationKey}`, ...result.evidence], actorKey, '', null)
  }
  return gateResult(false, [
    active.length === 0 ? 'active-situations=0' : 'no-formable-hypothesis',
  ], actorKey, '', null)
}

function gateG3(
  root: Record<string, unknown>,
  campaign: Record<string, unknown>,
): TtrpgOpenGateResultV1 {
  const pressure = runtimePressure(root, campaign)
  const worldTurnValue = readRecord(root, 'openRun')?.worldTurn ?? root.worldTurn ?? 0
  const worldTurn = typeof worldTurnValue === 'number' ? worldTurnValue : 0
  const failures: string[] = []
  let imminent = 0
  for (const rawFront of array(campaign.fronts)) {
    if (!isRecord(rawFront)) continue
    const front = rawFront as unknown as TtrpgOpenCampaignFrontV1
    const state = pressure.fronts[front.frontKey]
    if (!state || state.defeated) continue
    const currentIndex = state.currentStageKey === null
      ? -1
      : front.escalationStages.findIndex(stage => stage.stageKey === state.currentStageKey)
    const next = front.escalationStages[currentIndex + 1]
    if (!next) continue
    const clockValue = pressure.clocks[next.clockKey]?.value
    if (clockValue === undefined) {
      failures.push(`${front.frontKey}.${next.stageKey}:missing-clock=${next.clockKey}`)
      continue
    }
    if (clockValue < next.atClockValue - 1) continue
    imminent += 1
    const ready = front.telegraph
      .filter(telegraph => telegraph.beforeStageKey === next.stageKey)
      .some(telegraph => {
        const postedAt = state.telegraphWorldTurns[telegraph.telegraphKey]
        return typeof postedAt === 'number'
          && worldTurn - postedAt >= telegraph.minLeadWorldTurns
      })
    if (!ready) failures.push(`${front.frontKey}.${next.stageKey}:telegraph-not-ready`)
  }
  if (failures.length > 0) return gateResult(false, failures, null, '', null)
  return gateResult(true, [`imminentStages=${imminent}`, 'telegraph-lead-satisfied'], null, '', null)
}

function slotKey(subjectRef: string, predicateKey: string, objectRef: string | null): string {
  return JSON.stringify([subjectRef, predicateKey, objectRef])
}

function activeFactRows(root: Record<string, unknown>): TtrpgSessionFactV1[] {
  const run = readRecord(root, 'openRun')
  const source = root.sessionFacts ?? run?.sessionFacts ?? firstRecord(root.facts, run?.facts).items
  const rows: TtrpgSessionFactV1[] = []
  for (const value of array(source)) {
    if (!isRecord(value) || value.retired === true) continue
    try {
      rows.push(parseTtrpgSessionFactV1(value))
    } catch {
      // Runtime snapshots may intentionally contain only the mechanical fields.
      if (typeof value.subjectRef === 'string' && typeof value.predicateKey === 'string') {
        rows.push(value as unknown as TtrpgSessionFactV1)
      }
    }
  }
  return rows
}

function factConsistencyEvidence(
  facts: readonly TtrpgSessionFactV1[],
  campaign: Record<string, unknown>,
): string[] {
  const errors: string[] = []
  const bySlot = new Map<string, TtrpgSessionFactV1[]>()
  for (const fact of facts) {
    const key = slotKey(fact.subjectRef, fact.predicateKey, fact.objectRef ?? null)
    const bucket = bySlot.get(key) ?? []
    bucket.push(fact)
    bySlot.set(key, bucket)
  }
  const frozen = readRecord(campaign, 'frozenWorldPredicateIndex')
  for (const fact of facts) {
    for (const rawEntry of array(frozen?.entries)) {
      if (!isRecord(rawEntry)) continue
      if (slotKey(String(rawEntry.subjectRef), String(rawEntry.predicateKey), rawEntry.objectRef == null ? null : String(rawEntry.objectRef))
        !== slotKey(fact.subjectRef, fact.predicateKey, fact.objectRef ?? null)) continue
      if (rawEntry.authority === 'invariant' && rawEntry.canonicalValue !== fact.canonicalValue) {
        errors.push(`F1:${fact.factKey ?? fact.subjectRef}:conflicts-with=${String(rawEntry.factKey ?? 'world-fact')}`)
      }
    }
  }
  const canonPredicates = array(campaign.canonInvariantPredicates).filter(isRecord)
  for (const fact of facts) {
    for (const predicate of canonPredicates) {
      if (predicate.op !== 'world-fact') continue
      if (slotKey(String(predicate.subjectRef), String(predicate.predicateKey),
        predicate.objectRef == null ? null : String(predicate.objectRef))
        !== slotKey(fact.subjectRef, fact.predicateKey, fact.objectRef ?? null)) continue
      if (predicate.value !== undefined && predicate.value !== fact.canonicalValue) {
        errors.push(`F2:${fact.factKey ?? fact.subjectRef}:conflicts-with-canon`)
      }
    }
  }
  for (const [key, bucket] of bySlot) {
    for (const fact of bucket) {
      const conflicting = bucket.find(other =>
        other.factKey !== fact.factKey
        && other.canonicalValue !== fact.canonicalValue
        && other.supersedes !== fact.factKey
        && fact.supersedes !== other.factKey)
      if (conflicting) errors.push(`F3:${fact.factKey ?? key}:conflicts-with=${conflicting.factKey ?? key}`)
    }
  }
  const mutuallyExclusive = new Map<string, Set<string>>([
    ['open', new Set(['blocked'])],
    ['blocked', new Set(['open'])],
    ['allied-with', new Set(['hostile-to'])],
    ['hostile-to', new Set(['allied-with'])],
  ])
  for (const fact of facts) {
    if (fact.canonicalValue !== true) continue
    for (const other of facts) {
      if (other === fact || other.canonicalValue !== true) continue
      if (other.subjectRef === fact.subjectRef
        && (other.objectRef ?? null) === (fact.objectRef ?? null)
        && mutuallyExclusive.get(fact.predicateKey)?.has(other.predicateKey)) {
        errors.push(`F3:${fact.factKey ?? fact.subjectRef}:mutually-exclusive=${other.factKey ?? other.subjectRef}`)
      }
    }
  }
  return [...new Set(errors)].sort()
}

function gateG4(
  root: Record<string, unknown>,
  campaign: Record<string, unknown>,
): TtrpgOpenGateResultV1 {
  const facts = activeFactRows(root)
  const errors = factConsistencyEvidence(facts, campaign)
  const mode = facts.length > 500 ? 'incremental' : 'full'
  return gateResult(
    errors.length === 0,
    [`validation=${mode}`, `activeFacts=${facts.length}`, ...errors],
    null,
    '',
    null,
  )
}

function fillGateMetadata(
  result: TtrpgOpenGateResultV1,
  viewer: string | null,
  revision: string,
  basisHash: string | null,
): TtrpgOpenGateResultV1 {
  return {
    ...result,
    viewerKey: result.viewerKey ?? viewer,
    stageRevision: revision,
    evaluationBasisHash: basisHash,
    evidence: [...result.evidence],
  }
}

function notApplicableResult(
  status: 'closed' | 'paused',
  viewer: string | null,
  revision: string,
  basisHash: string | null,
): TtrpgOpenGateResultV1 {
  return gateResult(null, [`stage-${status}`, 'gate-evaluation-not-applicable'], viewer, revision, basisHash, 'not-applicable')
}

function normalizePreviousCount(
  root: Record<string, unknown>,
  key: TtrpgOpenGateKeyV1,
): number {
  const counts = isRecord(root.consecutiveFailures)
    ? root.consecutiveFailures
    : firstRecord(readRecord(root, 'openRun')?.consecutiveFailures)
  const value = counts[key]
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function stageRevisionChanged(
  root: Record<string, unknown>,
  previous: Partial<Record<TtrpgOpenGateKeyV1, TtrpgOpenGateResultV1>> | null,
  revision: string,
): boolean {
  const run = readRecord(root, 'openRun')
  const previousRevision = root.previousStageRevision ?? run?.previousStageRevision
  if (previousRevision !== undefined && String(previousRevision) !== revision) return true
  if (!previous) return false
  return Object.values(previous).some(result => result !== undefined && result.stageRevision !== revision)
}

export function evaluateTtrpgOpenRuntimeGatesV1(
  input: TtrpgOpenRuntimeGateInputV1 | unknown,
): TtrpgOpenRuntimeGateEvaluationV1 {
  const root = record(input, 'runtimeGates')
  const run = readRecord(root, 'openRun')
  const campaign = firstRecord(root.campaign, run?.campaign, root.content)
  const active = activeSituationRows(root)
  const templates = campaignTemplates(campaign)
  const actorKey = viewerActorKey(root)
  const currentViewerKey = viewerKey(root)
  const revision = stageRevision(root)
  const basisHash = evaluationBasisHash(root, campaign)
  const status = stageStatus(root)
  const context = predicateContext(root, campaign, active)
  const previous = isRecord(root.previousGateResults)
    ? root.previousGateResults as Partial<Record<TtrpgOpenGateKeyV1, TtrpgOpenGateResultV1>>
    : null

  const results = {} as Record<TtrpgOpenGateKeyV1, TtrpgOpenGateResultV1>
  if (status === 'closed' || status === 'paused') {
    for (const key of TTRPG_OPEN_GATE_KEYS) results[key] = notApplicableResult(status, currentViewerKey, revision, basisHash)
  } else {
    results['exit-exists'] = fillGateMetadata(gateG1(templates, active, actorKey, context), currentViewerKey, revision, basisHash)
    results['hypothesis-formable'] = fillGateMetadata(gateG2(templates, active, actorKey, context), currentViewerKey, revision, basisHash)
    results['telegraph-complete'] = fillGateMetadata(gateG3(root, campaign), currentViewerKey, revision, basisHash)
    results['facts-consistent'] = fillGateMetadata(gateG4(root, campaign), currentViewerKey, revision, basisHash)
  }

  const counts = {} as Record<TtrpgOpenGateKeyV1, number>
  const recovery = {} as Record<TtrpgOpenGateKeyV1, TtrpgOpenGateRecoveryV1>
  const requestAuthorReview: TtrpgOpenGateKeyV1[] = []
  const resetForNewStage = stageRevisionChanged(root, previous, revision)
  for (const key of TTRPG_OPEN_GATE_KEYS) {
    const result = results[key]
    if (result.applicability === 'not-applicable') {
      counts[key] = normalizePreviousCount(root, key)
      recovery[key] = 'none'
      continue
    }
    if (result.passed === true) {
      counts[key] = 0
      recovery[key] = 'none'
      continue
    }
    const next = resetForNewStage ? 1 : normalizePreviousCount(root, key) + 1
    counts[key] = next
    recovery[key] = next >= 3 ? 'request-author-review' : 'none'
    if (next >= 3) requestAuthorReview.push(key)
  }
  const allApplicablePassed = TTRPG_OPEN_GATE_KEYS.every(key =>
    results[key].applicability === 'not-applicable' || results[key].passed === true)
  const output = {
    results: clone(results),
    gates: clone(results),
    consecutiveFailures: counts,
    recovery,
    requestAuthorReview,
    allApplicablePassed,
    viewerKey: currentViewerKey,
    stageRevision: revision,
    evaluationBasisHash: basisHash,
  }
  return output
}

function publicationParts(
  value: unknown,
  rulePackValue?: unknown,
): { campaign: Record<string, unknown>; rulePack: Record<string, unknown>; narrative: Record<string, unknown> } {
  if (rulePackValue !== undefined) {
    return {
      campaign: record(value, 'campaign'),
      rulePack: record(rulePackValue, 'rulePack'),
      narrative: {},
    }
  }
  const root = record(value, 'publicationGates')
  return {
    campaign: firstRecord(root.campaign, root.content),
    rulePack: firstRecord(root.rulePack, root.rules),
    narrative: firstRecord(root.narrative),
  }
}

function publicationGate(
  gateId: string,
  passed: boolean,
  evidence: readonly string[],
): TtrpgOpenPublicationGateV1 {
  return { gateId, passed, evidence: [...evidence] }
}

function parsePublicationSituation(
  campaign: Record<string, unknown>,
  rulePack: Record<string, unknown>,
  template: unknown,
): TtrpgSituationTemplateV1 {
  return parseTtrpgSituationTemplateV1(template, {
    campaignKey: typeof campaign.campaignKey === 'string' ? campaign.campaignKey : undefined,
    characterTemplates: array(campaign.characterTemplates).filter(isRecord).map(character => ({
      characterKey: String(character.characterKey ?? ''),
      role: character.role === 'npc' ? 'npc' : 'player',
    })),
    clocks: array(campaign.clocks) as TtrpgCampaignContentV2['clocks'],
    fronts: array(campaign.fronts) as TtrpgCampaignContentV2['fronts'],
    situationTemplates: array(campaign.situationTemplates) as TtrpgSituationTemplateV1[],
    effectPlanTemplates: array(campaign.effectPlanTemplates).filter(isRecord).map(plan => ({
      planKey: String(plan.planKey ?? ''),
    })),
    frozenWorldPredicateIndex: campaign.frozenWorldPredicateIndex as TtrpgCampaignContentV2['frozenWorldPredicateIndex'],
    canonInvariantPredicates: array(campaign.canonInvariantPredicates) as TtrpgPredicateV1[],
    actionKeys: array(rulePack.actions).filter(isRecord).map(action => String(action.key ?? '')),
    rulePack: rulePack as unknown as RulePackV2,
  })
}

function checkCanonGate(campaign: Record<string, unknown>): TtrpgOpenPublicationGateV1 {
  const predicates = array(campaign.canonInvariantPredicates)
  const index = readRecord(campaign, 'frozenWorldPredicateIndex')
  const entries = array(index?.entries).filter(isRecord)
  const slots = new Set(entries.map(entry =>
    slotKey(String(entry.subjectRef), String(entry.predicateKey), entry.objectRef == null ? null : String(entry.objectRef))))
  const errors: string[] = []
  const visit = (predicate: unknown): void => {
    if (!isRecord(predicate)) {
      errors.push('predicate-not-object')
      return
    }
    if (predicate.op === 'all' || predicate.op === 'any') {
      for (const child of array(predicate.of)) visit(child)
      return
    }
    if (predicate.op === 'not') {
      visit(predicate.of)
      return
    }
    if (predicate.op !== 'world-fact') {
      errors.push(`unsupported-op=${String(predicate.op)}`)
      return
    }
    const key = slotKey(String(predicate.subjectRef), String(predicate.predicateKey),
      predicate.objectRef == null ? null : String(predicate.objectRef))
    if (!slots.has(key)) errors.push(`unresolved-slot=${key}`)
  }
  predicates.forEach(visit)
  return publicationGate('product.ttrpg.open-canon', predicates.length >= 1 && errors.length === 0, [
    `predicates=${predicates.length}`,
    `frozenIndexEntries=${entries.length}`,
    ...errors,
  ])
}

function checkSituationGate(
  campaign: Record<string, unknown>,
  rulePack: Record<string, unknown>,
): TtrpgOpenPublicationGateV1 {
  const templates = array(campaign.situationTemplates)
  const keys = new Set(templates.filter(isRecord).map(template => String(template.templateKey ?? '')))
  const opening = array(campaign.openingSituationKeys).filter((value): value is string => typeof value === 'string')
  const errors: string[] = []
  for (const template of templates) {
    try {
      parsePublicationSituation(campaign, rulePack, template)
    } catch (error) {
      errors.push(error instanceof Error ? error.message.replace(/^\[ttrpg-situation\] /, '') : String(error))
    }
  }
  if (opening.some(key => !keys.has(key))) errors.push(`openingSituationKeys=${opening.filter(key => !keys.has(key)).join(',')}`)
  return publicationGate('product.ttrpg.open-situation-layer', templates.length >= 3 && opening.length >= 1 && errors.length === 0, [
    `situationTemplates=${templates.length}`,
    `openingSituationKeys=${opening.length}`,
    ...errors,
  ])
}

function checkPressureGate(campaign: Record<string, unknown>): TtrpgOpenPublicationGateV1 {
  const clocks = array(campaign.clocks).filter(isRecord)
  const fronts = array(campaign.fronts).filter(isRecord)
  const errors: string[] = []
  for (const clock of clocks) {
    try {
      parseTtrpgPressureClockV1(clock)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  for (const front of fronts) {
    try {
      parseTtrpgPressureFrontV1(front)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
    const stages = array(front.escalationStages).filter(isRecord)
    const stageKeys = new Set(stages.map(stage => String(stage.stageKey ?? '')))
    const covered = new Set(array(front.telegraph).filter(isRecord).map(telegraph => String(telegraph.beforeStageKey ?? '')))
    if (stages.length < 1) errors.push(`${String(front.frontKey)}:escalationStages=0`)
    for (const stageKey of stageKeys) if (!covered.has(stageKey)) errors.push(`${String(front.frontKey)}:telegraph=${stageKey}`)
    if (array(front.defeatPredicates).length < 1) errors.push(`${String(front.frontKey)}:defeatPredicates=0`)
  }
  return publicationGate('product.ttrpg.open-pressure', clocks.length >= 1 && fronts.length >= 1 && errors.length === 0, [
    `clocks=${clocks.length}`,
    `fronts=${fronts.length}`,
    ...errors,
  ])
}

function checkSafetyGate(campaign: Record<string, unknown>): TtrpgOpenPublicationGateV1 {
  const sessionZero = readRecord(campaign, 'sessionZero')
  const policy = readRecord(campaign, 'companionPolicy')
  const consents = array(sessionZero?.consentChecklist)
  const confirmation = new Set(array(policy?.confirmationRequiredKinds))
  const required = ['irreversible', 'resource-spend', 'party-relation-change', 'secret-reveal']
  const players = array(campaign.characterTemplates).filter(value => isRecord(value) && value.role === 'player').length
  const minimum = typeof policy?.minimumCompanions === 'number' ? policy.minimumCompanions : 0
  const passed = consents.length >= 3
    && typeof sessionZero?.pauseSignal === 'string' && sessionZero.pauseSignal.trim().length > 0
    && policy !== null
    && required.every(key => confirmation.has(key))
    && minimum >= 2
    && players >= minimum + 1
  return publicationGate('product.ttrpg.safety-and-companions', passed, [
    `consent=${consents.length}`,
    `pauseSignal=${typeof sessionZero?.pauseSignal === 'string' && sessionZero.pauseSignal.trim().length > 0}`,
    `minimumCompanions=${minimum}`,
    `players=${players}`,
    `confirmationRequired=${required.filter(key => !confirmation.has(key)).length === 0}`,
  ])
}

function checkClosureGate(campaign: Record<string, unknown>): TtrpgOpenPublicationGateV1 {
  const policy = campaign.stageClosurePolicy
  const errors: string[] = []
  let triggers = 0
  let maximum: number | null = null
  if (policy !== null && policy !== undefined) {
    try {
      const parsed = closurePolicy(policy, 'stageClosurePolicy')
      triggers = parsed.triggers.length
      maximum = parsed.maximumWorldTurns
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return publicationGate('product.ttrpg.open-closure', policy !== null && policy !== undefined
    && triggers >= 1 && maximum !== null && maximum >= 10 && maximum <= 1000 && errors.length === 0, [
    `triggers=${triggers}`,
    `maximumWorldTurns=${maximum ?? 'missing'}`,
    ...errors,
  ])
}

function referencedEffectPlanKeys(campaign: Record<string, unknown>, rulePack: Record<string, unknown>): string[] {
  const refs: string[] = []
  for (const clock of array(campaign.clocks).filter(isRecord)) {
    if (typeof clock.onCompleteEffectPlanRef === 'string') refs.push(clock.onCompleteEffectPlanRef)
  }
  for (const front of array(campaign.fronts).filter(isRecord)) {
    for (const stage of array(front.escalationStages).filter(isRecord)) {
      if (typeof stage.effectPlanRef === 'string') refs.push(stage.effectPlanRef)
    }
  }
  for (const template of array(campaign.situationTemplates).filter(isRecord)) {
    const outcome = readRecord(template, 'noInterventionOutcome')
    if (typeof outcome?.effectPlanRef === 'string') refs.push(outcome.effectPlanRef)
    for (const consequence of array(template.consequences).filter(isRecord)) {
      if (typeof consequence.effectPlanRef === 'string') refs.push(consequence.effectPlanRef)
    }
    for (const evidence of array(template.evidence).filter(isRecord)) {
      const policy = readRecord(evidence, 'discoveryPolicy')
      if (typeof policy?.failForwardEffectPlanRef === 'string') refs.push(policy.failForwardEffectPlanRef)
      if (typeof policy?.costEffectPlanRef === 'string') refs.push(policy.costEffectPlanRef)
    }
  }
  for (const check of array(rulePack.genericChecks).filter(isRecord)) {
    for (const ref of Object.values(firstRecord(check.effectPlanByDegree))) {
      if (typeof ref === 'string') refs.push(ref)
    }
  }
  return refs
}

function checkEffectPlanGate(
  campaign: Record<string, unknown>,
  rulePack: Record<string, unknown>,
): TtrpgOpenPublicationGateV1 {
  const plans = array(campaign.effectPlanTemplates).filter(isRecord)
  const keys = plans.map(plan => String(plan.planKey ?? ''))
  const known = new Set(keys)
  const errors: string[] = []
  if (new Set(keys).size !== keys.length) errors.push('planKey重复')
  for (const plan of plans) {
    const effects = array(plan.effects)
    const alternatives = array(plan.alternatives).filter(isRecord)
    if (effects.length === 0 && alternatives.every(alternative => array(alternative.effects).length === 0)) {
      errors.push(`${String(plan.planKey)}:effects=0`)
    }
  }
  for (const ref of referencedEffectPlanKeys(campaign, rulePack)) if (!known.has(ref)) errors.push(`unresolved=${ref}`)
  return publicationGate('product.ttrpg.open-effect-plans', plans.length >= 1 && errors.length === 0, [
    `effectPlanTemplates=${plans.length}`,
    ...errors,
  ])
}

function checkClockDisjointGate(campaign: Record<string, unknown>): TtrpgOpenPublicationGateV1 {
  const offenders: string[] = []
  for (const plan of array(campaign.effectPlanTemplates).filter(isRecord)) {
    for (const effect of [...array(plan.effects), ...array(plan.alternatives).flatMap(alternative =>
      isRecord(alternative) ? array(alternative.effects) : [])].filter(isRecord)) {
      if (effect.operation === 'clock.advance') offenders.push(String(effect.effectKey ?? 'unknown'))
    }
  }
  return publicationGate('product.ttrpg.open-clock-disjoint', offenders.length === 0, [
    `clockAdvanceEffects=${offenders.length}`,
    ...offenders,
  ])
}

function checkRulesGate(rulePack: Record<string, unknown>): TtrpgOpenPublicationGateV1 {
  const tests = array(rulePack.tests)
  const oracles = array(rulePack.oracles).filter(isRecord)
  const oracleWithoutTests = oracles.filter(oracle => array(oracle.tests).length < 1).map(oracle => String(oracle.oracleKey ?? ''))
  const commercial = isRecord(rulePack.license) && rulePack.license.commercialUse === true
  return publicationGate('product.ttrpg.rules', tests.length >= 1 && commercial && oracles.length >= 1 && oracleWithoutTests.length === 0, [
    `fixtures=${tests.length}`,
    `commercialUse=${commercial}`,
    `oracles=${oracles.length}`,
    `oracleWithoutTests=${oracleWithoutTests.join(',') || 'none'}`,
  ])
}

function checkPlayLoopGate(
  campaign: Record<string, unknown>,
  rulePack: Record<string, unknown>,
): TtrpgOpenPublicationGateV1 {
  const players = array(campaign.characterTemplates)
    .filter((value): value is Record<string, unknown> => isRecord(value) && value.role === 'player')
  const bindings = array(campaign.entityBindings).filter(isRecord)
  const playerBindings = players.filter(player => bindings.some(binding =>
    binding.kind === 'actor' && binding.bindingKey === player.characterKey && typeof binding.initialLocationRef === 'string'))
  const actionCount = array(rulePack.actions).length + array(rulePack.genericChecks).length
  const opening = new Set(array(campaign.openingSituationKeys).filter((value): value is string => typeof value === 'string'))
  const visibleOpening = array(campaign.situationTemplates).filter(isRecord).some(template =>
    opening.has(String(template.templateKey ?? ''))
    && array(template.interventionPoints).some(point =>
      isRecord(point) && (point.visibleTo === 'party' || point.visibleTo === 'public'
        || (point.visibleTo === 'private' && array(point.knownByActorKeys).length > 0))))
  const passed = players.length >= 1 && playerBindings.length === players.length && actionCount >= 1 && visibleOpening
  return publicationGate('product.narrative.play-loop', passed, [
    `players=${players.length}`,
    `playersWithInitialLocation=${playerBindings.length}`,
    `legalActions=${actionCount}`,
    `visibleOpeningSituation=${visibleOpening}`,
  ])
}

export function assertTtrpgOpenPublicationGatesV1(
  value: unknown,
  rulePackValue?: unknown,
): TtrpgOpenPublicationGateReportV1 {
  const { campaign, rulePack } = publicationParts(value, rulePackValue)
  const gates = [
    checkPlayLoopGate(campaign, rulePack),
    checkRulesGate(rulePack),
    checkSituationGate(campaign, rulePack),
    checkPressureGate(campaign),
    checkCanonGate(campaign),
    checkSafetyGate(campaign),
    checkClosureGate(campaign),
    checkEffectPlanGate(campaign, rulePack),
    checkClockDisjointGate(campaign),
  ]
  const errors = gates.filter(gate => !gate.passed).flatMap(gate =>
    gate.evidence.map(evidence => `${gate.gateId}:${evidence}`))
  const report = { valid: errors.length === 0, gates, errors }
  if (!report.valid) {
    throw new Error(`[ttrpg-open-gates] ${errors.join('; ')}`)
  }
  return report
}

function parseFailureRefs(value: unknown, label: string): TtrpgOpenFailureLogV1['relatedRefs'] {
  const row = p.record(value, FAILURE_REF_KEYS, label)
  return {
    factKeys: p.keys(row.factKeys, `${label}.factKeys`),
    situationKeys: p.keys(row.situationKeys, `${label}.situationKeys`),
    frontKeys: p.keys(row.frontKeys, `${label}.frontKeys`),
    triggerKeys: p.keys(row.triggerKeys, `${label}.triggerKeys`),
    oracleKeys: p.keys(row.oracleKeys, `${label}.oracleKeys`),
    slotKeys: p.keys(row.slotKeys, `${label}.slotKeys`),
  }
}

export function parseTtrpgOpenFailureLogV1(value: unknown): TtrpgOpenFailureLogV1 {
  const row = p.record(p.json(value), [
    'sessionId', 'atSequence', 'atWorldTurn', 'category', 'violatedRule',
    'relatedRefs', 'evidence', 'recovery', 'recoveryAttempt', 'recoveryMaxAttempts',
  ], 'openFailureLog')
  const recoveryAttempt = p.integer(row.recoveryAttempt, 'openFailureLog.recoveryAttempt', 0)
  const recoveryMaxAttempts = p.integer(row.recoveryMaxAttempts, 'openFailureLog.recoveryMaxAttempts', 0)
  if (recoveryAttempt > recoveryMaxAttempts) p.fail('openFailureLog.recoveryAttempt不得超过recoveryMaxAttempts')
  return {
    sessionId: p.integer(row.sessionId, 'openFailureLog.sessionId'),
    atSequence: p.integer(row.atSequence, 'openFailureLog.atSequence'),
    atWorldTurn: p.integer(row.atWorldTurn, 'openFailureLog.atWorldTurn'),
    category: p.oneOf(row.category, FAILURE_CATEGORIES, 'openFailureLog.category'),
    violatedRule: p.key(row.violatedRule, 'openFailureLog.violatedRule'),
    relatedRefs: parseFailureRefs(row.relatedRefs, 'openFailureLog.relatedRefs'),
    evidence: p.texts(row.evidence, 'openFailureLog.evidence', 100, 1),
    recovery: p.oneOf(row.recovery, FAILURE_RECOVERIES, 'openFailureLog.recovery'),
    recoveryAttempt,
    recoveryMaxAttempts,
  }
}

export function recordTtrpgOpenFailureV1(
  input: TtrpgOpenFailureRecordInputV1,
): TtrpgOpenFailureLogV1 {
  const source = input.log ?? input
  const refs = source.relatedRefs ?? {}
  const evidence = source.evidence && source.evidence.length > 0
    ? source.evidence
    : [`violatedRule=${source.violatedRule}`]
  return parseTtrpgOpenFailureLogV1({
    sessionId: source.sessionId,
    atSequence: source.atSequence,
    atWorldTurn: source.atWorldTurn,
    category: source.category,
    violatedRule: source.violatedRule,
    relatedRefs: {
      ...EMPTY_REFS,
      ...refs,
    },
    evidence,
    recovery: source.recovery ?? 'reject-candidate',
    recoveryAttempt: source.recoveryAttempt ?? 1,
    recoveryMaxAttempts: source.recoveryMaxAttempts ?? 1,
  })
}

export function appendTtrpgOpenFailureV1(
  existing: readonly TtrpgOpenFailureLogV1[],
  next: TtrpgOpenFailureLogV1,
): TtrpgOpenFailureBufferV1 {
  const parsedExisting = existing.map(parseTtrpgOpenFailureLogV1)
  const parsedNext = parseTtrpgOpenFailureLogV1(next)
  const combined = [...parsedExisting, parsedNext]
  const droppedCount = Math.max(0, combined.length - 200)
  return {
    failures: clone(combined.slice(-200)),
    droppedCount,
  }
}

export const appendTtrpgOpenFailureLogV1 = appendTtrpgOpenFailureV1

function filterPlayerProjectionValue(value: unknown, parentKey: string | null): unknown {
  if (parentKey !== null && PLAYER_PROJECTION_FAILURE_KEYS.has(parentKey)) return undefined
  if (Array.isArray(value)) {
    if (value.every(item => isRecord(item) && typeof item.category === 'string' && typeof item.violatedRule === 'string')) {
      return []
    }
    return value.map(item => filterPlayerProjectionValue(item, null)).filter(item => item !== undefined)
  }
  if (!isRecord(value)) return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const filtered = filterPlayerProjectionValue(child, key)
    if (filtered !== undefined) output[key] = filtered
  }
  return output
}

export function filterTtrpgOpenFailureLogsFromPlayerProjectionV1<T>(value: T): T {
  return filterPlayerProjectionValue(value, null) as T
}

export const filterTtrpgOpenPlayerProjectionV1 = filterTtrpgOpenFailureLogsFromPlayerProjectionV1

export function evaluateTtrpgOpenStageClosureV1(input: {
  stageClosurePolicy?: TtrpgOpenStageClosurePolicyV1
  policy?: TtrpgOpenStageClosurePolicyV1
  campaign?: Pick<TtrpgCampaignContentV2, 'stageClosurePolicy'>
  predicateContext?: TtrpgPredicateEvaluationContextV1
  worldTurn: number
} | unknown): TtrpgOpenStageClosureDecisionV1 {
  const root = record(input, 'stageClosure')
  const policy = root.stageClosurePolicy ?? root.policy ?? readRecord(root, 'campaign')?.stageClosurePolicy
  const parsed = closurePolicy(policy, 'stageClosurePolicy')
  const worldTurn = integer(root.worldTurn, 'worldTurn')
  if (worldTurn >= parsed.maximumWorldTurns) {
    return {
      eligible: true,
      reason: 'maximum-world-turns',
      triggerKey: null,
      summaryPrompt: null,
      maximumReached: true,
      evidence: [`worldTurn=${worldTurn}`, `maximumWorldTurns=${parsed.maximumWorldTurns}`],
    }
  }
  const rawContext = root.predicateContext as TtrpgPredicateEvaluationContextV1 | undefined
  const context = rawContext
    ? { ...rawContext, worldTurn } as TtrpgPredicateEvaluationContextV1
    : undefined
  const errors: string[] = []
  for (const trigger of parsed.triggers) {
    if (!context) {
      errors.push(`${trigger.triggerKey}:predicateContext缺失`)
      continue
    }
    const result = predicateValue(trigger.predicate, context)
    if (result.error) {
      errors.push(`${trigger.triggerKey}:${result.error}`)
      continue
    }
    if (result.value) {
      return {
        eligible: true,
        reason: 'trigger',
        triggerKey: trigger.triggerKey,
        summaryPrompt: trigger.summaryPrompt,
        maximumReached: false,
        evidence: [`trigger=${trigger.triggerKey}`, `worldTurn=${worldTurn}`],
      }
    }
  }
  return {
    eligible: false,
    reason: 'not-eligible',
    triggerKey: null,
    summaryPrompt: null,
    maximumReached: false,
    evidence: [`worldTurn=${worldTurn}`, `maximumWorldTurns=${parsed.maximumWorldTurns}`, ...errors],
  }
}

export function assertTtrpgOpenStageClosureV1(
  input: Parameters<typeof evaluateTtrpgOpenStageClosureV1>[0],
): TtrpgOpenStageClosureDecisionV1 {
  const result = evaluateTtrpgOpenStageClosureV1(input)
  if (!result.eligible) {
    throw new Error(`[ttrpg-open-gates] stage-close未满足:${result.evidence.join('; ')}`)
  }
  return result
}

export const evaluateTtrpgOpenStageClosureTriggerV1 = evaluateTtrpgOpenStageClosureV1
