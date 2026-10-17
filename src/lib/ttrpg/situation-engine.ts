import { situation as parseSituation } from './open-content-situations'
import { OPEN_FACT_PREDICATES } from './open-contract'
import type {
  RulePackV2,
  TtrpgFrozenWorldPredicateIndexV1,
  TtrpgOpenCampaignClockV1,
  TtrpgOpenCampaignFrontV1,
  TtrpgOpenFactPredicate,
  TtrpgPredicateV1,
  TtrpgSituationTemplateV1,
} from './open-contract'
import type { TtrpgPredicateEvaluationContextV1 } from './predicate'
import { evaluateTtrpgPredicateV1 } from './predicate'
import { parseTtrpgPressureClockV1, parseTtrpgPressureFrontV1 } from './pressure-runtime'

export type TtrpgSituationActivationReasonV1 =
  | 'opening'
  | 'front-escalation'
  | 'consequence'
  | 'session-generation'

export type TtrpgSituationResolutionKindV1 =
  | 'intervened'
  | 'no-intervention'
  | 'front-defeated'
  | 'superseded'

export interface TtrpgSituationInstanceV1 {
  situationKey: string
  templateKey: string
  status: 'active' | 'resolved' | 'expired'
  activatedAtSequence: number
  activatedAtWorldTurn: number
  activationReason: TtrpgSituationActivationReasonV1
  whyNowRefs: string[]
  satisfiedObstacleKeys: string[]
  discoveredEvidenceRefs: string[]
  noInterventionDueWorldTurn: number
  resolvedAtSequence: number | null
  resolutionKind: TtrpgSituationResolutionKindV1 | null
}

export interface TtrpgSituationTemplateContextV1 {
  runtimeEntityReferences?: readonly { entityRef: string; kind: 'actor' | 'location' | 'item' }[]
  campaignKey?: string
  characterTemplates?: readonly { characterKey: string; role: 'player' | 'npc' }[]
  clocks?: readonly TtrpgOpenCampaignClockV1[]
  fronts?: readonly TtrpgOpenCampaignFrontV1[]
  situationTemplates?: readonly TtrpgSituationTemplateV1[]
  effectPlanTemplates?: readonly { planKey: string }[]
  frozenWorldPredicateIndex?: TtrpgFrozenWorldPredicateIndexV1
  canonInvariantPredicates?: readonly TtrpgPredicateV1[]
  sessionFactKeys?: readonly string[]
  actionKeys?: readonly string[]
  rulePack?: Pick<RulePackV2, 'actions'>
}

export interface TtrpgSituationGateResultV1 {
  passed: boolean
  i1: { passed: boolean; reason?: string }
  i2: { passed: boolean; reason?: string }
  i3: { passed: boolean; reason?: string }
  i4: { passed: boolean; reason?: string }
  i5: { passed: boolean; reason?: string }
  i6: { passed: boolean; reason?: string }
  i7: { passed: boolean; reason?: string }
  failures: Array<{ gate: 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7'; reason: string }>
}

export interface TtrpgSituationInstantiationInputV1 {
  template: TtrpgSituationTemplateV1 | unknown
  activatedAtSequence?: number
  activatedAtWorldTurn?: number
  activationReason?: TtrpgSituationActivationReasonV1
  baseSequence?: number
  worldTurn?: number
}

export interface TtrpgSituationProgressInputV1 {
  template: TtrpgSituationTemplateV1 | unknown
  instance: TtrpgSituationInstanceV1
  predicateContext?: TtrpgPredicateEvaluationContextV1
  discoveredEvidenceRefs?: readonly string[]
  satisfiedObstacleKeys?: readonly string[]
}

export interface TtrpgSituationProgressV1 {
  situationKey: string
  templateKey: string
  discoveredEvidenceRefs: string[]
  satisfiedObstacleKeys: string[]
  newlyDiscoveredEvidenceRefs: string[]
  newlySatisfiedObstacleKeys: string[]
  resolved: boolean
  resolutionKind: 'intervened' | null
}

export interface TtrpgSituationConsequenceCandidateV1 {
  sourceSituationKey: string
  templateKey: string
  activationReason: 'consequence'
  effectPlanRef: string
  scope: TtrpgSituationTemplateV1['consequences'][number]['scope']
  ref: string
  audience: TtrpgSituationTemplateV1['consequences'][number]['audience']
}

export interface TtrpgSituationMaintenanceInputV1 {
  template: TtrpgSituationTemplateV1 | unknown
  instance: TtrpgSituationInstanceV1
  worldTurn: number
  resolvedAtSequence?: number
  eventSequence?: number
  baseSequence?: number
  predicateContext?: TtrpgPredicateEvaluationContextV1
  resolutionKind?: TtrpgSituationResolutionKindV1 | null
  activeInstances?: readonly TtrpgSituationInstanceV1[] | Readonly<Record<string, TtrpgSituationInstanceV1>>
  queuedTemplateKeys?: readonly string[]
  templates?: readonly TtrpgSituationTemplateV1[]
  situationTemplates?: readonly TtrpgSituationTemplateV1[]
  cooldownUntilWorldTurn?: Readonly<Record<string, number>>
  templateContext?: TtrpgSituationTemplateContextV1
}

export interface TtrpgSituationQueueDecisionV1 {
  templateKey: string
  action: 'activated' | 'rejected' | 'duplicate' | 'retained'
  reason: string
}

export interface TtrpgSituationMaintenanceV1 {
  transition: 'unchanged' | 'resolved' | 'expired'
  instance: TtrpgSituationInstanceV1
  cooldownUntilWorldTurn: number | null
  consequenceCandidates: TtrpgSituationConsequenceCandidateV1[]
  queuedTemplateKeys: string[]
  nextActivation: TtrpgSituationInstanceV1 | null
  queueDecisions: TtrpgSituationQueueDecisionV1[]
  failureLogs: Array<{
    category: 'situation-rejected' | 'situation-capacity'
    templateKey: string
    violatedRule: string
  }>
}

const SITUATION_RESOLUTION_KINDS: readonly TtrpgSituationResolutionKindV1[] = [
  'intervened',
  'no-intervention',
  'front-defeated',
  'superseded',
]
const SITUATION_CAPACITY = 5
const COOLDOWN_WORLD_TURNS = 3

function fail(message: string): never {
  throw new Error(`[ttrpg-situation] ${message}`)
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) return fail(`${label}必须是非空字符串`)
  return value
}

function integer(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    return fail(`${label}必须是${minimum}以上的安全整数`)
  }
  return Number(value)
}

function uniqueStrings(values: readonly string[], label: string): string[] {
  const result = Array.from(values)
  if (result.some(value => typeof value !== 'string' || value.length === 0)) {
    return fail(`${label}包含空引用`)
  }
  if (new Set(result).size !== result.length) return fail(`${label}包含重复引用`)
  return result
}

function normalizeContext(
  value: unknown,
  rulePackValue?: unknown,
): TtrpgSituationTemplateContextV1 {
  const root = record(value)
  const campaign = record(root.campaign ?? root.content)
  const source = Object.keys(campaign).length > 0 ? campaign : root
  const rulePack = record(root.rulePack ?? rulePackValue)
  const characters = source.characterTemplates
  const clocks = source.clocks
  const fronts = source.fronts
  const situationTemplates = source.situationTemplates
  const effectPlanTemplates = source.effectPlanTemplates
  const index = source.frozenWorldPredicateIndex
  const canonInvariantPredicates = source.canonInvariantPredicates
  const configuredActionKeys = Array.isArray(source.actionKeys)
    ? source.actionKeys.filter((key): key is string => typeof key === 'string')
    : undefined
  const actionKeys = configuredActionKeys
    ?? (Array.isArray(rulePack.actions)
      ? rulePack.actions.map(action => record(action).key).filter((key): key is string => typeof key === 'string')
      : undefined)
  const parsedClocks = Array.isArray(clocks)
    ? clocks.map(clock => parseTtrpgPressureClockV1(clock))
    : undefined
  const parsedFronts = Array.isArray(fronts)
    ? fronts.map(front => parseTtrpgPressureFrontV1(front))
    : undefined
  const rule: Pick<RulePackV2, 'actions'> | undefined = Array.isArray(rulePack.actions)
    ? { actions: rulePack.actions as RulePackV2['actions'] }
    : undefined

  return {
    ...(Array.isArray(source.runtimeEntityReferences) ? { runtimeEntityReferences: source.runtimeEntityReferences.map(value => {
      const row = record(value), kind = row.kind
      if (kind !== 'actor' && kind !== 'location' && kind !== 'item') return fail('runtime entity reference kind不在闭集')
      return { entityRef: text(row.entityRef, 'runtime entity reference'), kind }
    }) } : {}),
    campaignKey: typeof source.campaignKey === 'string' ? source.campaignKey : undefined,
    characterTemplates: Array.isArray(characters) ? characters as TtrpgSituationTemplateContextV1['characterTemplates'] : undefined,
    clocks: parsedClocks,
    fronts: parsedFronts,
    situationTemplates: Array.isArray(situationTemplates)
      ? situationTemplates as TtrpgSituationTemplateV1[]
      : undefined,
    effectPlanTemplates: Array.isArray(effectPlanTemplates)
      ? effectPlanTemplates as Array<{ planKey: string }>
      : undefined,
    frozenWorldPredicateIndex: index as TtrpgFrozenWorldPredicateIndexV1 | undefined,
    canonInvariantPredicates: Array.isArray(canonInvariantPredicates)
      ? canonInvariantPredicates as TtrpgPredicateV1[]
      : undefined,
    sessionFactKeys: Array.isArray(root.sessionFactKeys)
      ? root.sessionFactKeys.filter((key): key is string => typeof key === 'string')
      : undefined,
    actionKeys,
    rulePack: rule,
  }
}

function contextHas(context: TtrpgSituationTemplateContextV1, key: keyof TtrpgSituationTemplateContextV1): boolean {
  return context[key] !== undefined
}

function actionKeys(context: TtrpgSituationTemplateContextV1): Set<string> {
  return new Set(context.actionKeys ?? context.rulePack?.actions.map(action => action.key) ?? [])
}

function characterRows(context: TtrpgSituationTemplateContextV1): readonly { characterKey: string; role: 'player' | 'npc' }[] {
  return context.characterTemplates ?? []
}

function frontKeys(context: TtrpgSituationTemplateContextV1): Set<string> {
  return new Set((context.fronts ?? []).map(front => front.frontKey))
}

function clockKeys(context: TtrpgSituationTemplateContextV1): Set<string> {
  return new Set((context.clocks ?? []).map(clock => clock.clockKey))
}

function situationKeys(context: TtrpgSituationTemplateContextV1): Set<string> {
  return new Set((context.situationTemplates ?? []).map(template => template.templateKey))
}

function planKeys(context: TtrpgSituationTemplateContextV1): Set<string> {
  return new Set((context.effectPlanTemplates ?? []).map(plan => plan.planKey))
}

function factKeys(context: TtrpgSituationTemplateContextV1): Set<string> {
  return new Set([...(context.frozenWorldPredicateIndex?.entries.map(entry => entry.factKey) ?? []), ...(context.sessionFactKeys ?? [])])
}

function factSlotKeys(context: TtrpgSituationTemplateContextV1): Set<string> {
  return new Set(context.frozenWorldPredicateIndex?.entries.map(entry =>
    `${entry.subjectRef}:${entry.predicateKey}`) ?? [])
}

function canonicalPredicateKeys(context: TtrpgSituationTemplateContextV1): Set<string> {
  const result = new Set<string>()
  for (const predicate of context.canonInvariantPredicates ?? []) {
    if (predicate.op === 'world-fact') result.add(`${predicate.subjectRef}:${predicate.predicateKey}`)
  }
  return result
}

function assertKnown(value: string, known: Set<string>, label: string): void {
  if (!known.has(value)) fail(`${label}引用未知对象:${value}`)
}

function assertPredicateShape(value: TtrpgPredicateV1, label: string): void {
  if (value.op === 'all' || value.op === 'any') {
    value.of.forEach((child, index) => assertPredicateShape(child, `${label}.of[${index}]`))
  } else if (value.op === 'not') {
    assertPredicateShape(value.of, `${label}.of`)
  }
}

function parseWorldWhyNowRef(
  value: string,
  context: TtrpgSituationTemplateContextV1,
  label: string,
): void {
  const body = value.slice('world:'.length)
  const separator = body.lastIndexOf(':')
  if (separator <= 0 || separator === body.length - 1) {
    return fail(`${label}不是world:<subjectRef>:<predicateKey>`)
  }
  const subjectRef = body.slice(0, separator)
  const predicateKey = body.slice(separator + 1)
  if (!(OPEN_FACT_PREDICATES as readonly string[]).includes(predicateKey)) {
    return fail(`${label}包含未知谓词:${predicateKey}`)
  }
  if (!contextHas(context, 'frozenWorldPredicateIndex') && !contextHas(context, 'canonInvariantPredicates')) return
  if (!factSlotKeys(context).has(`${subjectRef}:${predicateKey}`)
    && !canonicalPredicateKeys(context).has(`${subjectRef}:${predicateKey}`)) {
    return fail(`${label}未命中冻结事实或canon不变量`)
  }
}

function assertWhyNowRefs(
  refs: readonly string[],
  context: TtrpgSituationTemplateContextV1,
  label: string,
): void {
  if (refs.length < 2) fail(`${label}必须至少有2条`)
  const telegraphKeys = new Set((context.fronts ?? []).flatMap(front =>
    front.telegraph.map(telegraph => telegraph.telegraphKey)))
  for (const [index, ref] of refs.entries()) {
    const separator = ref.indexOf(':')
    if (separator <= 0 || separator === ref.length - 1) fail(`${label}[${index}]格式无效`)
    const prefix = ref.slice(0, separator)
    const key = ref.slice(separator + 1)
    if (prefix === 'world') parseWorldWhyNowRef(ref, context, `${label}[${index}]`)
    else if (prefix === 'session') {
      if (contextHas(context, 'sessionFactKeys')) assertKnown(key, new Set(context.sessionFactKeys), `${label}[${index}]`)
    } else if (prefix === 'clock') {
      if (contextHas(context, 'clocks')) assertKnown(key, clockKeys(context), `${label}[${index}]`)
    } else if (prefix === 'telegraph') {
      if (contextHas(context, 'fronts')) assertKnown(key, telegraphKeys, `${label}[${index}]`)
    } else {
      fail(`${label}[${index}]前缀不在闭集`)
    }
  }
}

function assertTemplateCrossReferences(
  template: TtrpgSituationTemplateV1,
  context: TtrpgSituationTemplateContextV1,
): void {
  const characters = new Map(characterRows(context).map(character => [character.characterKey, character]))
  if (contextHas(context, 'frozenWorldPredicateIndex')
    || contextHas(context, 'canonInvariantPredicates')
    || contextHas(context, 'campaignKey')) {
    const knownBeliefRefs = new Set([
      ...factKeys(context),
      ...canonicalPredicateKeys(context),
      ...(context.campaignKey ? [context.campaignKey] : []),
    ])
    for (const belief of template.driverBeliefs) {
      if (belief.factRef !== null) assertKnown(belief.factRef, knownBeliefRefs, 'S2:driverBeliefs.factRef')
    }
  }
  if (template.driverBinding.kind === 'npc' && contextHas(context, 'characterTemplates')) {
    const driverKey = template.driverBinding.characterKey, character = characters.get(driverKey)
    if (character ? character.role === 'player' : !context.runtimeEntityReferences?.some(row => row.kind === 'actor' && row.entityRef === driverKey)) fail('S6:npc driver必须引用NPC')
  }
  if (template.driverBinding.kind === 'front' && contextHas(context, 'fronts')) {
    assertKnown(template.driverBinding.frontKey, frontKeys(context), 'S6:front driver')
  }
  if ((template.driverBinding.kind === 'world-event' || template.driverBinding.kind === 'player-commitment')
    && (contextHas(context, 'frozenWorldPredicateIndex') || contextHas(context, 'campaignKey'))) {
    const knownFacts = factKeys(context)
    if (context.campaignKey) knownFacts.add(context.campaignKey)
    assertKnown(template.driverBinding.factRef, knownFacts, 'S6:fact driver')
  }

  if (contextHas(context, 'actionKeys')) {
    for (const point of template.interventionPoints) {
      for (const actionKey of point.suggestedActionKeys) assertKnown(actionKey, actionKeys(context), 'S3: suggestedActionKeys')
    }
  }
  if (contextHas(context, 'characterTemplates')) {
    for (const point of template.interventionPoints) {
      if (point.visibleTo === 'private') {
        for (const actorKey of point.knownByActorKeys) assertKnown(actorKey, new Set(characters.keys()), 'S7: intervention private')
      }
    }
    for (const evidence of template.evidence) {
      if (evidence.audience === 'private') {
        for (const actorKey of evidence.knownByActorKeys) assertKnown(actorKey, new Set(characters.keys()), 'S7: evidence private')
      }
      for (const actorKey of evidence.discoveryPolicy.recipientActorKeys) {
        assertKnown(actorKey, new Set(characters.keys()), 'S7: evidence recipient')
      }
    }
  }

  if (contextHas(context, 'effectPlanTemplates')) {
    const plans = planKeys(context)
    const effectRefs = [
      template.noInterventionOutcome.effectPlanRef,
      ...template.consequences.map(consequence => consequence.effectPlanRef),
      ...template.evidence.flatMap(evidence => [
        evidence.discoveryPolicy.failForwardEffectPlanRef,
        evidence.discoveryPolicy.costEffectPlanRef,
      ]),
    ]
    for (const effectRef of effectRefs) {
      if (effectRef !== null) assertKnown(effectRef, plans, 'S8: effectPlanRef')
    }
  }
  if (contextHas(context, 'situationTemplates')) {
    const situations = situationKeys(context)
    for (const consequence of template.consequences) {
      if (consequence.nextSituationTemplateKey !== null) {
        assertKnown(consequence.nextSituationTemplateKey, situations, 'S8: nextSituationTemplateKey')
      }
    }
    const templates = new Map((context.situationTemplates ?? []).map(item => [item.templateKey, item]))
    templates.set(template.templateKey, template)
    const allEvidence = Array.from(templates.values()).flatMap(item => item.evidence)
    const clueRefs = allEvidence.map(evidence => evidence.clueRef)
    if (new Set(clueRefs).size !== clueRefs.length) fail('S10:evidence.clueRef必须在全部局势范围内唯一')
    if (template.consequences.some(consequence =>
      consequence.nextSituationTemplateKey !== null && !situations.has(consequence.nextSituationTemplateKey))) {
      fail('S8:后果链引用未知局势模板')
    }
  }
  if (contextHas(context, 'clocks')) {
    for (const clockKey of template.noInterventionOutcome.advancesClockKeys) {
      assertKnown(clockKey, clockKeys(context), 'S5: advancesClockKeys')
    }
  }
}

function assertSituationTemplate(
  value: unknown,
  contextValue?: unknown,
  rulePackValue?: unknown,
): TtrpgSituationTemplateV1 {
  const context = normalizeContext(contextValue, rulePackValue)
  const parsed = parseSituation(value, 'situationTemplate')
  for (const predicate of parsed.preconditions) assertPredicateShape(predicate, 'S1.preconditions')
  for (const obstacle of parsed.obstacles) assertPredicateShape(obstacle.predicate, `S1.${obstacle.obstacleKey}`)
  if (!parsed.driverBeliefs.some(belief => belief.factRef !== null)) fail('S2:至少需要一条非空factRef')
  assertWhyNowRefs(parsed.whyNowRefs, context, 'S9.whyNowRefs')
  assertTemplateCrossReferences(parsed, context)
  return parsed
}

export function parseTtrpgSituationTemplateV1(
  value: unknown,
  context?: unknown,
  rulePack?: unknown,
): TtrpgSituationTemplateV1 {
  return assertSituationTemplate(value, context, rulePack)
}

function instanceValue(value: unknown): TtrpgSituationInstanceV1 {
  const instance = record(value)
  const situationKey = text(instance.situationKey, 'instance.situationKey')
  const templateKey = text(instance.templateKey, 'instance.templateKey')
  const status = instance.status
  if (status !== 'active' && status !== 'resolved' && status !== 'expired') {
    return fail('instance.status不在闭集')
  }
  const activationReason = instance.activationReason
  if (activationReason !== 'opening' && activationReason !== 'front-escalation' && activationReason !== 'consequence' && activationReason !== 'session-generation') {
    return fail('instance.activationReason不在闭集')
  }
  const resolutionKind = instance.resolutionKind === null || instance.resolutionKind === undefined
    ? null
    : instance.resolutionKind
  if (resolutionKind !== null && !(SITUATION_RESOLUTION_KINDS as readonly unknown[]).includes(resolutionKind)) {
    return fail('instance.resolutionKind不在闭集')
  }
  const activatedAtSequence = integer(instance.activatedAtSequence, 'instance.activatedAtSequence')
  const activatedAtWorldTurn = integer(instance.activatedAtWorldTurn, 'instance.activatedAtWorldTurn')
  const noInterventionDueWorldTurn = integer(instance.noInterventionDueWorldTurn, 'instance.noInterventionDueWorldTurn')
  const resolvedAtSequence = instance.resolvedAtSequence === null
    ? null
    : integer(instance.resolvedAtSequence, 'instance.resolvedAtSequence')
  const whyNowRefs = uniqueStrings(
    Array.isArray(instance.whyNowRefs) ? instance.whyNowRefs : [],
    'instance.whyNowRefs',
  )
  const satisfiedObstacleKeys = uniqueStrings(
    Array.isArray(instance.satisfiedObstacleKeys) ? instance.satisfiedObstacleKeys : [],
    'instance.satisfiedObstacleKeys',
  )
  const discoveredEvidenceRefs = uniqueStrings(
    Array.isArray(instance.discoveredEvidenceRefs) ? instance.discoveredEvidenceRefs : [],
    'instance.discoveredEvidenceRefs',
  )
  return {
    situationKey,
    templateKey,
    status,
    activatedAtSequence,
    activatedAtWorldTurn,
    activationReason,
    whyNowRefs,
    satisfiedObstacleKeys,
    discoveredEvidenceRefs,
    noInterventionDueWorldTurn,
    resolvedAtSequence,
    resolutionKind: resolutionKind as TtrpgSituationResolutionKindV1 | null,
  }
}

function instantiationArguments(
  input: unknown,
  activatedAtSequenceValue?: unknown,
  activatedAtWorldTurnValue?: unknown,
  activationReasonValue?: unknown,
): {
  template: unknown
  activatedAtSequence: number
  activatedAtWorldTurn: number
  activationReason: TtrpgSituationActivationReasonV1
} {
  const row = record(input)
  const isObjectInput = Object.prototype.hasOwnProperty.call(row, 'template')
  const template = isObjectInput ? row.template : input
  const activatedAtSequence = integer(
    isObjectInput ? row.activatedAtSequence ?? row.baseSequence : activatedAtSequenceValue,
    'activatedAtSequence',
  )
  const activatedAtWorldTurn = integer(
    isObjectInput ? row.activatedAtWorldTurn ?? row.worldTurn : activatedAtWorldTurnValue,
    'activatedAtWorldTurn',
  )
  const reason = isObjectInput ? row.activationReason : activationReasonValue
  if (reason !== 'opening' && reason !== 'front-escalation' && reason !== 'consequence' && reason !== 'session-generation') {
    return fail('activationReason不在闭集')
  }
  return { template, activatedAtSequence, activatedAtWorldTurn, activationReason: reason }
}

export function instantiateTtrpgSituationV1(
  input: unknown,
  activatedAtSequence?: unknown,
  activatedAtWorldTurn?: unknown,
  activationReason?: unknown,
): TtrpgSituationInstanceV1 {
  const args = instantiationArguments(input, activatedAtSequence, activatedAtWorldTurn, activationReason)
  const template = assertSituationTemplate(args.template)
  return {
    situationKey: `${template.templateKey}.${args.activatedAtSequence}`,
    templateKey: template.templateKey,
    status: 'active',
    activatedAtSequence: args.activatedAtSequence,
    activatedAtWorldTurn: args.activatedAtWorldTurn,
    activationReason: args.activationReason,
    whyNowRefs: [...template.whyNowRefs],
    satisfiedObstacleKeys: [],
    discoveredEvidenceRefs: [],
    noInterventionDueWorldTurn: args.activatedAtWorldTurn + template.noInterventionOutcome.afterWorldTurns,
    resolvedAtSequence: null,
    resolutionKind: null,
  }
}

function progressArguments(input: unknown): {
  template: unknown
  instance: TtrpgSituationInstanceV1
  predicateContext?: TtrpgPredicateEvaluationContextV1
  discoveredEvidenceRefs: readonly string[]
  satisfiedObstacleKeys: readonly string[]
} {
  const row = record(input)
  if (!Object.prototype.hasOwnProperty.call(row, 'template')
    || !Object.prototype.hasOwnProperty.call(row, 'instance')) {
    return fail('progress输入必须包含template和instance')
  }
  return {
    template: row.template,
    instance: instanceValue(row.instance),
    predicateContext: row.predicateContext as TtrpgPredicateEvaluationContextV1 | undefined,
    discoveredEvidenceRefs: Array.isArray(row.discoveredEvidenceRefs) ? row.discoveredEvidenceRefs as string[] : [],
    satisfiedObstacleKeys: Array.isArray(row.satisfiedObstacleKeys) ? row.satisfiedObstacleKeys as string[] : [],
  }
}

function contextWithSituation(
  context: TtrpgPredicateEvaluationContextV1,
  template: TtrpgSituationTemplateV1,
  instance: TtrpgSituationInstanceV1,
): TtrpgPredicateEvaluationContextV1 {
  const templateSnapshot = {
    templateKey: template.templateKey,
    evidence: template.evidence.map(evidence => ({
      clueRef: evidence.clueRef,
      audience: evidence.audience,
      knownByActorKeys: evidence.knownByActorKeys,
    })),
  }
  const active = context.situations.active.some(item => item.templateKey === instance.templateKey)
    ? context.situations.active.map(item => item.templateKey === instance.templateKey
      ? {
          ...item,
          discoveredEvidenceRefs: Array.from(new Set([
            ...item.discoveredEvidenceRefs,
            ...instance.discoveredEvidenceRefs,
          ])),
        }
      : item)
    : [...context.situations.active, {
        templateKey: instance.templateKey,
        discoveredEvidenceRefs: instance.discoveredEvidenceRefs,
      }]
  const templates = context.situations.templates.some(item => item.templateKey === template.templateKey)
    ? context.situations.templates
    : [...context.situations.templates, templateSnapshot]
  return { ...context, situations: { active, templates } }
}

export function evaluateTtrpgSituationProgressV1(
  input: unknown,
): TtrpgSituationProgressV1 {
  const args = progressArguments(input)
  const template = assertSituationTemplate(args.template)
  if (args.instance.templateKey !== template.templateKey) fail('progress的templateKey与instance不一致')
  if (args.instance.status !== 'active') fail('只有active局势可以progress')
  const evidenceKeys = new Set(template.evidence.map(evidence => evidence.clueRef))
  const obstacleKeys = new Set(template.obstacles.map(obstacle => obstacle.obstacleKey))
  const requestedEvidence = uniqueStrings(args.discoveredEvidenceRefs, 'discoveredEvidenceRefs')
  const requestedObstacles = uniqueStrings(args.satisfiedObstacleKeys, 'satisfiedObstacleKeys')
  requestedEvidence.forEach(key => assertKnown(key, evidenceKeys, 'progress evidence'))
  requestedObstacles.forEach(key => assertKnown(key, obstacleKeys, 'progress obstacle'))

  const evaluatedObstacles = args.predicateContext
    ? template.obstacles
      .filter(obstacle => evaluateTtrpgPredicateV1(
        obstacle.predicate,
        contextWithSituation(args.predicateContext as TtrpgPredicateEvaluationContextV1, template, args.instance),
      ))
      .map(obstacle => obstacle.obstacleKey)
    : []
  const discoveredEvidenceRefs = uniqueStrings(
    [...new Set([...args.instance.discoveredEvidenceRefs, ...requestedEvidence])],
    'instance.discoveredEvidenceRefs',
  )
  const satisfiedObstacleKeys = uniqueStrings(
    [...new Set([...args.instance.satisfiedObstacleKeys, ...requestedObstacles, ...evaluatedObstacles])],
    'instance.satisfiedObstacleKeys',
  )
  const newlyDiscoveredEvidenceRefs = discoveredEvidenceRefs.filter(
    key => !args.instance.discoveredEvidenceRefs.includes(key),
  )
  const newlySatisfiedObstacleKeys = satisfiedObstacleKeys.filter(
    key => !args.instance.satisfiedObstacleKeys.includes(key),
  )
  const resolved = template.obstacles.every(obstacle => evaluatedObstacles.includes(obstacle.obstacleKey))
  return {
    situationKey: args.instance.situationKey,
    templateKey: template.templateKey,
    discoveredEvidenceRefs,
    satisfiedObstacleKeys,
    newlyDiscoveredEvidenceRefs,
    newlySatisfiedObstacleKeys,
    resolved,
    resolutionKind: resolved ? 'intervened' : null,
  }
}

function activeInstances(
  value: readonly TtrpgSituationInstanceV1[] | Readonly<Record<string, TtrpgSituationInstanceV1>> | undefined,
): TtrpgSituationInstanceV1[] {
  if (Array.isArray(value)) return value.map(instanceValue)
  return Object.values(value ?? {}).map(instanceValue)
}

function playerCanSee(
  audience: 'gm-only' | 'party' | 'private' | 'public',
  knownByActorKeys: readonly string[],
  actorKey: string | undefined,
): boolean {
  if (audience === 'gm-only') return false
  if (audience === 'public' || audience === 'party') return true
  return actorKey !== undefined && knownByActorKeys.includes(actorKey)
}

function whyNowReferenceIsResolvable(
  ref: string,
  input: Record<string, unknown>,
  context: TtrpgPredicateEvaluationContextV1,
  actorKey: string | undefined,
  clockDefinitions: readonly TtrpgOpenCampaignClockV1[] | undefined,
): boolean {
  const separator = ref.indexOf(':')
  if (separator <= 0 || separator === ref.length - 1) return false
  const prefix = ref.slice(0, separator)
  const key = ref.slice(separator + 1)
  if (prefix === 'world') {
    const bodySeparator = key.lastIndexOf(':')
    if (bodySeparator <= 0 || bodySeparator === key.length - 1) return false
    const subjectRef = key.slice(0, bodySeparator)
    const predicateKey = key.slice(bodySeparator + 1) as TtrpgOpenFactPredicate
    if (!(OPEN_FACT_PREDICATES as readonly string[]).includes(predicateKey)) return false
    return context.frozenWorldPredicateIndex.entries.some(entry =>
      entry.subjectRef === subjectRef
      && entry.predicateKey === predicateKey
      && playerCanSee(entry.audience, entry.knownByActorKeys, actorKey))
  }
  if (prefix === 'session') {
    const fact = context.sessionFacts
      .map(candidate => record(candidate))
      .find(candidate => candidate.factKey === key && candidate.retired !== true)
    if (!fact) return false
    const audience = fact.audience
    const knownBy = Array.isArray(fact.knownBy)
      ? fact.knownBy.filter((value): value is string => typeof value === 'string')
      : []
    return (audience === 'gm-only' || audience === 'party' || audience === 'private' || audience === 'public')
      && playerCanSee(audience, knownBy, actorKey)
  }
  if (prefix === 'clock') {
    const clocks = clockDefinitions ?? (Array.isArray(input.clocks)
      ? input.clocks as Array<{ clockKey: string; visibility: 'gm-only' | 'party' | 'public' }>
      : [])
    const definition = clocks.find(clock => clock.clockKey === key)
    if (definition) return definition.visibility === 'party' || definition.visibility === 'public'
    const state = record(context.pressure.clocks[key])
    return state.visibility === 'party' || state.visibility === 'public'
  }
  if (prefix === 'telegraph') {
    return Object.values(context.pressure.fronts).some(front => {
      const snapshot = record(front)
      const telegraphWorldTurns = record(snapshot.telegraphWorldTurns)
      return Object.prototype.hasOwnProperty.call(snapshot, 'telegraphWorldTurns')
        && Object.prototype.hasOwnProperty.call(telegraphWorldTurns, key)
    })
  }
  return false
}

function gateInputParts(input: unknown): {
  template: unknown
  context: TtrpgPredicateEvaluationContextV1
  activeInstances: TtrpgSituationInstanceV1[]
  cooldownUntilWorldTurn: Readonly<Record<string, number>>
  worldTurn: number
  actorKey?: string
  templateContext: TtrpgSituationTemplateContextV1
} {
  const row = record(input)
  const context = row.predicateContext ?? row.context
  if (!context || typeof context !== 'object') return fail('实例门输入缺少predicateContext')
  const predicateContext = context as TtrpgPredicateEvaluationContextV1
  const state = record(row.situations)
  const activeInput = row.activeInstances
    ?? state.active
    ?? predicateContext.situations.active.map(item => ({
      situationKey: `${item.templateKey}.snapshot`,
      templateKey: item.templateKey,
      status: 'active',
      activatedAtSequence: 0,
      activatedAtWorldTurn: 0,
      activationReason: 'opening',
      whyNowRefs: [],
      satisfiedObstacleKeys: [],
      discoveredEvidenceRefs: item.discoveredEvidenceRefs,
      noInterventionDueWorldTurn: Number.MAX_SAFE_INTEGER,
      resolvedAtSequence: null,
      resolutionKind: null,
    }))
  const cooldown = row.cooldownUntilWorldTurn
    ?? state.cooldownUntilWorldTurn
    ?? {}
  const templateContext = normalizeContext(
    row.templateContext ?? row.campaign ?? row.content ?? row,
    row.rulePack,
  )
  return {
    template: row.template,
    context: predicateContext,
    activeInstances: activeInstances(activeInput as readonly TtrpgSituationInstanceV1[]),
    cooldownUntilWorldTurn: cooldown as Readonly<Record<string, number>>,
    worldTurn: integer(row.worldTurn, 'worldTurn'),
    actorKey: typeof row.actorKey === 'string'
      ? row.actorKey
      : typeof row.viewerActorKey === 'string' ? row.viewerActorKey : undefined,
    templateContext,
  }
}

function gateFailure(
  gate: 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7',
  reason: string,
): never {
  return fail(`${gate}:${reason}`)
}

function runtimeTemplate(value: unknown): TtrpgSituationTemplateV1 {
  const template = record(value)
  if (typeof template.templateKey !== 'string'
    || !Array.isArray(template.preconditions)
    || !Array.isArray(template.obstacles)
    || !Array.isArray(template.interventionPoints)
    || !Array.isArray(template.evidence)
    || !Array.isArray(template.whyNowRefs)
    || !template.noInterventionOutcome
    || !Array.isArray(template.consequences)) {
    return fail('实例门输入的template结构不完整')
  }
  return value as TtrpgSituationTemplateV1
}

export function assertTtrpgSituationInstanceGatesV1(
  input: unknown,
): TtrpgSituationGateResultV1 {
  const parts = gateInputParts(input)
  const template = runtimeTemplate(parts.template)
  const failures: TtrpgSituationGateResultV1['failures'] = []
  const result: TtrpgSituationGateResultV1 = {
    passed: false,
    i1: { passed: false },
    i2: { passed: false },
    i3: { passed: false },
    i4: { passed: false },
    i5: { passed: false },
    i6: { passed: false },
    i7: { passed: false },
    failures,
  }
  const check = (
    gate: 'I1' | 'I2' | 'I3' | 'I4' | 'I5' | 'I6' | 'I7',
    assertion: () => void,
  ): void => {
    try {
      assertion()
      result[gate.toLowerCase() as 'i1' | 'i2' | 'i3' | 'i4' | 'i5' | 'i6' | 'i7'] = { passed: true }
    } catch (error) {
      const reason = error instanceof Error ? error.message.replace(/^\[ttrpg-situation\] /, '') : String(error)
      result[gate.toLowerCase() as 'i1' | 'i2' | 'i3' | 'i4' | 'i5' | 'i6' | 'i7'] = { passed: false, reason }
      failures.push({ gate, reason })
    }
  }

  check('I1', () => {
    for (const predicate of template.preconditions) {
      if (!evaluateTtrpgPredicateV1(predicate, parts.context)) gateFailure('I1', 'preconditions未全部满足')
    }
  })
  check('I2', () => {
    if (!template.whyNowRefs.some(ref =>
      whyNowReferenceIsResolvable(ref, record(input), parts.context, parts.actorKey, parts.templateContext.clocks))) {
      gateFailure('I2', 'whyNowRefs没有对当前玩家可解析的引用')
    }
  })
  check('I3', () => {
    const context = parts.templateContext
    const driver = template.driverBinding
    if (driver.kind === 'npc' && contextHas(context, 'characterTemplates')) {
      assertKnown(driver.characterKey, new Set([...characterRows(context).map(character => character.characterKey),
        ...(context.runtimeEntityReferences?.filter(row => row.kind === 'actor').map(row => row.entityRef) ?? [])]), 'I3.driverRef')
    }
    if (driver.kind === 'front' && contextHas(context, 'fronts')) assertKnown(driver.frontKey, frontKeys(context), 'I3.driverRef')
    if ((driver.kind === 'world-event' || driver.kind === 'player-commitment')
      && contextHas(context, 'frozenWorldPredicateIndex')) assertKnown(driver.factRef, factKeys(context), 'I3.driverRef')
    if (contextHas(context, 'actionKeys')) {
      for (const point of template.interventionPoints) {
        point.suggestedActionKeys.forEach(key => assertKnown(key, actionKeys(context), 'I3.suggestedActionKeys'))
      }
    }
    if (contextHas(context, 'effectPlanTemplates')) {
      const plans = planKeys(context)
      if (template.noInterventionOutcome.effectPlanRef !== null) assertKnown(template.noInterventionOutcome.effectPlanRef, plans, 'I3.effectPlanRef')
      template.consequences.forEach(consequence => assertKnown(consequence.effectPlanRef, plans, 'I3.effectPlanRef'))
      template.evidence.forEach(evidence => {
        const discovery = evidence.discoveryPolicy
        if (discovery.failForwardEffectPlanRef !== null) assertKnown(discovery.failForwardEffectPlanRef, plans, 'I3.effectPlanRef')
        if (discovery.costEffectPlanRef !== null) assertKnown(discovery.costEffectPlanRef, plans, 'I3.effectPlanRef')
      })
    }
    if (contextHas(context, 'situationTemplates')) {
      const situations = situationKeys(context)
      template.consequences.forEach(consequence => {
        if (consequence.nextSituationTemplateKey !== null) {
          assertKnown(consequence.nextSituationTemplateKey, situations, 'I3.nextSituationTemplateKey')
        }
      })
    }
    const evidenceKeys = new Set(template.evidence.map(evidence => evidence.clueRef))
    template.evidence.forEach(evidence => assertKnown(evidence.clueRef, evidenceKeys, 'I3.clueRef'))
  })
  check('I4', () => {
    if (template.noInterventionOutcome.effectPlanRef === null
      && template.noInterventionOutcome.advancesClockKeys.length === 0) {
      gateFailure('I4', 'noInterventionOutcome没有后果')
    }
  })
  check('I5', () => {
    if (parts.activeInstances.some(instance =>
      instance.status === 'active' && instance.templateKey === template.templateKey)) {
      gateFailure('I5', '同templateKey已有active实例')
    }
  })
  check('I6', () => {
    if (parts.activeInstances.filter(instance => instance.status === 'active').length >= SITUATION_CAPACITY) {
      gateFailure('I6', `active实例数已达到${SITUATION_CAPACITY}`)
    }
  })
  check('I7', () => {
    const cooldown = parts.cooldownUntilWorldTurn[template.templateKey]
    if (cooldown !== undefined) {
      integer(cooldown, `cooldownUntilWorldTurn.${template.templateKey}`)
      if (parts.worldTurn < cooldown) gateFailure('I7', `冷却到${cooldown}轮才结束`)
    }
  })
  if (failures.length > 0) {
    throw new Error(`[ttrpg-situation] ${failures.map(failure => `${failure.gate}:${failure.reason}`).join('; ')}`)
  }
  result.passed = true
  return result
}

function maintenanceArguments(input: unknown): {
  template: unknown
  instance: TtrpgSituationInstanceV1
  worldTurn: number
  resolvedAtSequence: number
  predicateContext?: TtrpgPredicateEvaluationContextV1
  resolutionKind: TtrpgSituationResolutionKindV1 | null
  activeInstances: TtrpgSituationInstanceV1[]
  queuedTemplateKeys: string[]
  templates: TtrpgSituationTemplateV1[]
  cooldownUntilWorldTurn: Readonly<Record<string, number>>
  templateContext: TtrpgSituationTemplateContextV1
} {
  const row = record(input)
  if (row.template === undefined || row.instance === undefined) return fail('maintenance输入必须包含template和instance')
  const templatesValue = row.templates ?? row.situationTemplates ?? []
  const templates = Array.isArray(templatesValue)
    ? templatesValue.map(template => assertSituationTemplate(template))
    : []
  const state = record(row.situations)
  const activeValue = row.activeInstances ?? state.active
  const queuedValue = row.queuedTemplateKeys ?? state.queuedTemplateKeys ?? []
  const cooldownValue = row.cooldownUntilWorldTurn ?? state.cooldownUntilWorldTurn ?? {}
  const resolvedAtSequence = integer(
    row.resolvedAtSequence ?? row.eventSequence ?? row.baseSequence ?? record(row.instance).activatedAtSequence,
    'resolvedAtSequence',
  )
  return {
    template: row.template,
    instance: instanceValue(row.instance),
    worldTurn: integer(row.worldTurn, 'worldTurn'),
    resolvedAtSequence,
    predicateContext: row.predicateContext as TtrpgPredicateEvaluationContextV1 | undefined,
    resolutionKind: row.resolutionKind === undefined ? null : row.resolutionKind as TtrpgSituationResolutionKindV1 | null,
    activeInstances: activeInstances(activeValue as readonly TtrpgSituationInstanceV1[]),
    queuedTemplateKeys: uniqueStrings(Array.isArray(queuedValue) ? queuedValue as string[] : [], 'queuedTemplateKeys'),
    templates,
    cooldownUntilWorldTurn: cooldownValue as Readonly<Record<string, number>>,
    templateContext: normalizeContext(row.templateContext ?? row.campaign ?? row.content ?? row, row.rulePack),
  }
}

function terminalInstance(
  instance: TtrpgSituationInstanceV1,
  transition: 'resolved' | 'expired',
  resolutionKind: TtrpgSituationResolutionKindV1,
  resolvedAtSequence: number,
): TtrpgSituationInstanceV1 {
  return {
    ...instance,
    status: transition === 'expired' ? 'expired' : 'resolved',
    resolvedAtSequence,
    resolutionKind,
  }
}

function consequenceCandidates(
  template: TtrpgSituationTemplateV1,
  situationKey: string,
): TtrpgSituationConsequenceCandidateV1[] {
  return template.consequences
    .filter(consequence => consequence.nextSituationTemplateKey !== null)
    .map(consequence => ({
      sourceSituationKey: situationKey,
      templateKey: consequence.nextSituationTemplateKey as string,
      activationReason: 'consequence',
      effectPlanRef: consequence.effectPlanRef,
      scope: consequence.scope,
      ref: consequence.ref,
      audience: consequence.audience,
    }))
}

function queueAfterTerminal(
  args: ReturnType<typeof maintenanceArguments>,
  terminal: TtrpgSituationInstanceV1,
  cooldown: Readonly<Record<string, number>>,
): {
  queuedTemplateKeys: string[]
  nextActivation: TtrpgSituationInstanceV1 | null
  queueDecisions: TtrpgSituationQueueDecisionV1[]
  failureLogs: TtrpgSituationMaintenanceV1['failureLogs']
} {
  const remainingActive = args.activeInstances
    .filter(instance => instance.situationKey !== terminal.situationKey && instance.status === 'active')
  const queue = [...args.queuedTemplateKeys]
  const queueDecisions: TtrpgSituationQueueDecisionV1[] = []
  const failureLogs: TtrpgSituationMaintenanceV1['failureLogs'] = []
  let nextActivation: TtrpgSituationInstanceV1 | null = null
  while (queue.length > 0 && nextActivation === null) {
    const templateKey = queue[0]
    const queuedTemplate = args.templates.find(candidate => candidate.templateKey === templateKey)
    if (!queuedTemplate) {
      queue.shift()
      queueDecisions.push({ templateKey, action: 'rejected', reason: 'I3:队列引用未知局势模板' })
      failureLogs.push({ category: 'situation-rejected', templateKey, violatedRule: 'I3' })
      continue
    }
    const probe = instantiateTtrpgSituationV1({
      template: queuedTemplate,
      activatedAtSequence: args.resolvedAtSequence,
      activatedAtWorldTurn: args.worldTurn,
      activationReason: 'consequence',
    })
    try {
      assertTtrpgSituationInstanceGatesV1({
        template: queuedTemplate,
        instance: probe,
        predicateContext: args.predicateContext,
        activeInstances: remainingActive,
        cooldownUntilWorldTurn: cooldown,
        worldTurn: args.worldTurn,
        actorKey: undefined,
        templateContext: args.templateContext,
        rulePack: args.templateContext.rulePack,
      })
      queue.shift()
      nextActivation = probe
      queueDecisions.push({ templateKey, action: 'activated', reason: 'I1-I7通过' })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      if (reason.includes('I5:')) {
        queue.shift()
        queueDecisions.push({ templateKey, action: 'duplicate', reason })
      } else if (reason.includes('I6:') || reason.includes('I7:')) {
        queueDecisions.push({ templateKey, action: 'retained', reason })
        failureLogs.push({ category: 'situation-capacity', templateKey, violatedRule: reason.includes('I6:') ? 'I6' : 'I7' })
        break
      } else {
        queue.shift()
        queueDecisions.push({ templateKey, action: 'rejected', reason })
        failureLogs.push({ category: 'situation-rejected', templateKey, violatedRule: reason.includes('I1:')
          ? 'I1' : reason.includes('I2:') ? 'I2' : reason.includes('I3:') ? 'I3' : 'I4' })
      }
    }
  }
  return { queuedTemplateKeys: queue, nextActivation, queueDecisions, failureLogs }
}

export function evaluateTtrpgSituationMaintenanceV1(
  input: unknown,
): TtrpgSituationMaintenanceV1 {
  const args = maintenanceArguments(input)
  const template = assertSituationTemplate(args.template, args.templateContext)
  const instance = args.instance
  if (instance.templateKey !== template.templateKey) fail('maintenance的templateKey与instance不一致')
  if (instance.status !== 'active') fail('只有active局势可以maintenance')
  const allObstaclesSatisfied = args.predicateContext
    ? template.obstacles.every(obstacle => evaluateTtrpgPredicateV1(obstacle.predicate, contextWithSituation(
      args.predicateContext as TtrpgPredicateEvaluationContextV1,
      template,
      instance,
    )))
    : false
  const due = args.worldTurn >= instance.noInterventionDueWorldTurn
  let transition: 'unchanged' | 'resolved' | 'expired' = 'unchanged'
  let resolutionKind: TtrpgSituationResolutionKindV1 | null = null
  if (args.resolutionKind !== null) {
    resolutionKind = args.resolutionKind
    if (resolutionKind === 'no-intervention' && !due) fail('no-intervention尚未到期')
    if (resolutionKind === 'intervened' && !allObstaclesSatisfied) {
      fail('intervened要求全部obstacles predicate满足')
    }
    transition = resolutionKind === 'no-intervention' ? 'expired' : 'resolved'
  } else if (allObstaclesSatisfied) {
    transition = 'resolved'
    resolutionKind = 'intervened'
  } else if (due) {
    transition = 'expired'
    resolutionKind = 'no-intervention'
  }

  if (transition === 'unchanged') {
    return {
      transition,
      instance: { ...instance, whyNowRefs: [...instance.whyNowRefs], satisfiedObstacleKeys: [...instance.satisfiedObstacleKeys], discoveredEvidenceRefs: [...instance.discoveredEvidenceRefs] },
      cooldownUntilWorldTurn: null,
      consequenceCandidates: [],
      queuedTemplateKeys: [...args.queuedTemplateKeys],
      nextActivation: null,
      queueDecisions: [],
      failureLogs: [],
    }
  }
  const terminal = terminalInstance(instance, transition, resolutionKind as TtrpgSituationResolutionKindV1, args.resolvedAtSequence)
  const cooldownUntilWorldTurn = args.worldTurn + COOLDOWN_WORLD_TURNS
  const cooldown = { ...args.cooldownUntilWorldTurn, [template.templateKey]: cooldownUntilWorldTurn }
  const queueResult = queueAfterTerminal(args, terminal, cooldown)
  return {
    transition,
    instance: terminal,
    cooldownUntilWorldTurn,
    consequenceCandidates: consequenceCandidates(template, terminal.situationKey),
    queuedTemplateKeys: queueResult.queuedTemplateKeys,
    nextActivation: queueResult.nextActivation,
    queueDecisions: queueResult.queueDecisions,
    failureLogs: queueResult.failureLogs,
  }
}
