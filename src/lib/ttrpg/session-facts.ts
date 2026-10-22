import type {
  TtrpgFrozenWorldPredicateIndexV1,
  TtrpgOpenAudience,
  TtrpgOpenFactKind,
  TtrpgOpenFactOwner,
  TtrpgOpenFactPolicyV1,
  TtrpgOpenFactPredicate,
  TtrpgOpenScalar,
  TtrpgPredicateV1,
  RulePackV2,
} from './open-contract'
import { OPEN_FACT_PREDICATES } from './open-contract'
import { parseTtrpgPredicateV1 } from './predicate'
import * as p from './open-contract-parse'

export type TtrpgFactLayerV1 = 'world' | 'authored' | 'session'
export type TtrpgSessionFactOriginV1 =
  'oracle' | 'ai-improv' | 'player-declared' | 'rule-outcome'

export interface TtrpgSessionFactV1 {
  factKey: string
  layer: Extract<TtrpgFactLayerV1, 'session'>
  kind: TtrpgOpenFactKind
  subjectRef: string
  predicateKey: TtrpgOpenFactPredicate
  objectRef: string | null
  canonicalValue: TtrpgOpenScalar
  detail: string
  origin: TtrpgSessionFactOriginV1
  originEventSequence: number
  originRef: string | null
  sourceFactRefs: string[]
  sourceEventRefs: string[]
  audience: TtrpgOpenAudience
  knownBy: string[]
  supersedes: string | null
  supersedeReason: string | null
  retired: boolean
  retiredAtSequence: number | null
}

export interface TtrpgSessionFactSourceEventV1 {
  eventRef: string
  facts: TtrpgSessionFactV1[]
  audience: TtrpgOpenAudience | null
  knownBy: string[]
  kind: 'ordinary' | 'reveal' | 'discovery'
}

export interface TtrpgSessionFactGateFailureV1 {
  gate: 'F1' | 'F2' | 'F3' | 'F4'
  reason: string
  against: string | null
}

export interface TtrpgSessionFactGateResultV1 {
  passed: true
  f1: { passed: true }
  f2: { passed: true }
  f3: { passed: true }
  f4: { passed: true }
  failures: []
}

export interface TtrpgSessionFactGateInputV1 {
  fact: TtrpgSessionFactV1
  frozenWorldPredicateIndex: TtrpgFrozenWorldPredicateIndexV1
  canonInvariantPredicates?: readonly TtrpgPredicateV1[]
  existingFacts?: readonly TtrpgSessionFactV1[]
  sourceFacts?: readonly TtrpgSessionFactV1[]
  sourceEvents?: readonly TtrpgSessionFactSourceEventV1[] | Readonly<Record<string, TtrpgSessionFactSourceEventV1>>
  factPolicy?: readonly TtrpgOpenFactPolicyV1[]
  rulePack?: RulePackV2
  effectLedgerStoryFacts?: Readonly<Record<string, TtrpgOpenScalar | null>>
  /** Deterministically resolved from frozen product entity bindings, never model claims. */
  knownEntityRefs?: readonly string[]
  revealEvents?: readonly TtrpgSessionFactSourceEventV1[]
}

const FACT_FIELDS = [
  'factKey', 'layer', 'kind', 'subjectRef', 'predicateKey', 'objectRef',
  'canonicalValue', 'detail', 'origin', 'originEventSequence', 'originRef',
  'sourceFactRefs', 'sourceEventRefs', 'audience', 'knownBy', 'supersedes',
  'supersedeReason', 'retired', 'retiredAtSequence',
] as const
const SOURCE_EVENT_FIELDS = ['eventRef', 'facts', 'audience', 'knownBy', 'kind'] as const
const MUTUALLY_EXCLUSIVE = new Map<TtrpgOpenFactPredicate, readonly TtrpgOpenFactPredicate[]>([
  ['open', ['blocked']],
  ['blocked', ['open']],
  ['allied-with', ['hostile-to']],
  ['hostile-to', ['allied-with']],
])
const SECRET_RANK: Record<TtrpgOpenAudience, number> = {
  public: 0,
  party: 1,
  private: 2,
  'gm-only': 3,
}

function fail(message: string): never {
  return p.fail(`[ttrpg-session-facts] ${message}`)
}

function assertNonEmptyRef(value: unknown, label: string): string {
  return p.key(value, label)
}

function parseCanonicalValue(value: unknown, label: string): TtrpgOpenScalar {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return p.number(value, label)
  return p.text(value, label, 2_000)
}

function parseFact(value: unknown, label: string): TtrpgSessionFactV1 {
  const row = p.record(value, FACT_FIELDS, label)
  const predicateKey = p.oneOf(row.predicateKey, OPEN_FACT_PREDICATES, `${label}.predicateKey`)
  const knownBy = p.keys(row.knownBy, `${label}.knownBy`, 100, 0)
  const audience = p.oneOf(row.audience, ['gm-only', 'party', 'private', 'public'], `${label}.audience`)
  if (audience === 'private' && knownBy.length === 0) fail(`${label}.private 事实必须有knownBy`)
  const retired = p.bool(row.retired, `${label}.retired`)
  const retiredAtSequence = p.nullable(row.retiredAtSequence, (candidate, nestedLabel) =>
    p.integer(candidate, nestedLabel, 0), `${label}.retiredAtSequence`)
  if (retired !== (retiredAtSequence !== null)) fail(`${label}.retired 与 retiredAtSequence 不一致`)
  const supersedes = p.nullable(row.supersedes, p.key, `${label}.supersedes`)
  const supersedeReason = p.nullable(row.supersedeReason, (candidate, nestedLabel) =>
    p.text(candidate, nestedLabel, 1_000), `${label}.supersedeReason`)
  if ((supersedes === null) !== (supersedeReason === null)) fail(`${label}.supersedes 必须配套 supersedeReason`)
  return {
    factKey: assertNonEmptyRef(row.factKey, `${label}.factKey`),
    layer: p.literal(row.layer, 'session', `${label}.layer`),
    kind: p.oneOf(row.kind, ['entity', 'relation', 'state', 'event-truth', 'location', 'item'], `${label}.kind`),
    subjectRef: assertNonEmptyRef(row.subjectRef, `${label}.subjectRef`),
    predicateKey,
    objectRef: p.nullable(row.objectRef, assertNonEmptyRef, `${label}.objectRef`),
    canonicalValue: parseCanonicalValue(row.canonicalValue, `${label}.canonicalValue`),
    detail: p.text(row.detail, `${label}.detail`, 4_000),
    origin: p.oneOf(row.origin, ['oracle', 'ai-improv', 'player-declared', 'rule-outcome'], `${label}.origin`),
    originEventSequence: p.integer(row.originEventSequence, `${label}.originEventSequence`),
    originRef: p.nullable(row.originRef, p.key, `${label}.originRef`),
    sourceFactRefs: p.keys(row.sourceFactRefs, `${label}.sourceFactRefs`, 100, 0),
    sourceEventRefs: p.keys(row.sourceEventRefs, `${label}.sourceEventRefs`, 100, 0),
    audience,
    knownBy,
    supersedes,
    supersedeReason,
    retired,
    retiredAtSequence,
  }
}

function parseSourceEvent(value: unknown, label: string): TtrpgSessionFactSourceEventV1 {
  const row = p.record(value, SOURCE_EVENT_FIELDS, label)
  return {
    eventRef: p.key(row.eventRef, `${label}.eventRef`),
    facts: p.list(row.facts, `${label}.facts`, parseFact, 500, 0),
    audience: p.nullable(row.audience, (candidate, nestedLabel) =>
      p.oneOf(candidate, ['gm-only', 'party', 'private', 'public'], nestedLabel), `${label}.audience`),
    knownBy: p.keys(row.knownBy, `${label}.knownBy`, 100, 0),
    kind: p.oneOf(row.kind, ['ordinary', 'reveal', 'discovery'], `${label}.kind`),
  }
}

export function parseTtrpgSessionFactV1(value: unknown): TtrpgSessionFactV1 {
  return parseFact(p.json(value), 'sessionFact')
}

export function parseTtrpgSessionFactSourceEventV1(value: unknown): TtrpgSessionFactSourceEventV1 {
  return parseSourceEvent(p.json(value), 'sourceEvent')
}

export function createTtrpgSessionFactKeyV1(input: {
  subjectRef: string
  predicateKey: TtrpgOpenFactPredicate
  baseSequence: number
}): string {
  const subjectRef = assertNonEmptyRef(input.subjectRef, 'subjectRef')
  const predicateKey = p.oneOf(input.predicateKey, OPEN_FACT_PREDICATES, 'predicateKey')
  const baseSequence = p.integer(input.baseSequence, 'baseSequence')
  const candidate = `fact.${subjectRef}.${predicateKey}.${baseSequence}`
  return candidate.length <= 200
    ? candidate
    : `fact.${subjectRef.slice(0, 16)}.${predicateKey}.${baseSequence}`
}

function cloneFact(fact: TtrpgSessionFactV1): TtrpgSessionFactV1 {
  return {
    ...fact,
    sourceFactRefs: [...fact.sourceFactRefs],
    sourceEventRefs: [...fact.sourceEventRefs],
    knownBy: [...fact.knownBy],
  }
}

function activeFacts(facts: readonly TtrpgSessionFactV1[]): TtrpgSessionFactV1[] {
  return facts.filter(fact => !fact.retired).map(cloneFact)
}

function sourceEvents(input: TtrpgSessionFactGateInputV1): TtrpgSessionFactSourceEventV1[] {
  const values = input.sourceEvents == null
    ? []
    : Array.isArray(input.sourceEvents)
      ? input.sourceEvents
      : Object.values(input.sourceEvents)
  return [...values, ...(input.revealEvents ?? [])].map((event, index) =>
    parseSourceEvent(event, `sourceEvents[${index}]`))
}

function sourceFacts(input: TtrpgSessionFactGateInputV1): TtrpgSessionFactV1[] {
  return [
    ...(input.existingFacts ?? []),
    ...(input.sourceFacts ?? []),
    ...input.frozenWorldPredicateIndex.entries.map(entry => ({
      factKey: entry.factKey,
      layer: 'session' as const,
      kind: 'entity' as const,
      subjectRef: entry.subjectRef,
      predicateKey: entry.predicateKey,
      objectRef: entry.objectRef,
      canonicalValue: entry.canonicalValue,
      detail: '冻结来源事实',
      origin: 'rule-outcome' as const,
      originEventSequence: 0,
      originRef: null,
      sourceFactRefs: [],
      sourceEventRefs: [],
      audience: entry.audience,
      knownBy: entry.knownByActorKeys,
      supersedes: null,
      supersedeReason: null,
      retired: false,
      retiredAtSequence: null,
    })),
  ].map(parseTtrpgSessionFactV1)
}

function slotEqual(left: TtrpgSessionFactV1, right: TtrpgSessionFactV1): boolean {
  if (left.predicateKey !== right.predicateKey || left.subjectRef !== right.subjectRef) return false
  if (['knows', 'owes', 'promised', 'damaged'].includes(left.predicateKey)) {
    return left.objectRef === right.objectRef
  }
  return true
}

function pairEqual(left: TtrpgSessionFactV1, right: TtrpgSessionFactV1): boolean {
  return left.subjectRef === right.subjectRef && left.objectRef === right.objectRef
}

export function ttrpgSessionFactsConflictV1(left: TtrpgSessionFactV1, right: TtrpgSessionFactV1): boolean {
  if (left.retired || right.retired) return false
  if (left.predicateKey === 'owns' && right.predicateKey === 'owns') {
    return left.objectRef !== null && left.objectRef === right.objectRef && left.subjectRef !== right.subjectRef
  }
  if (left.predicateKey === 'located-at' && right.predicateKey === 'located-at') {
    return left.subjectRef === right.subjectRef && left.objectRef !== right.objectRef
  }
  if (left.predicateKey === 'exists' && right.predicateKey === 'exists') {
    return left.subjectRef === right.subjectRef && left.canonicalValue !== right.canonicalValue
  }
  if (left.predicateKey === 'exists' && right.predicateKey === 'destroyed'
    || left.predicateKey === 'destroyed' && right.predicateKey === 'exists') {
    const exists = left.predicateKey === 'exists' ? left : right
    const destroyed = left.predicateKey === 'destroyed' ? left : right
    return exists.subjectRef === destroyed.subjectRef
      && exists.canonicalValue === true && destroyed.canonicalValue === true
  }
  if (MUTUALLY_EXCLUSIVE.get(left.predicateKey)?.includes(right.predicateKey)
    && pairEqual(left, right)
    && left.canonicalValue === true && right.canonicalValue === true) return true
  if (left.predicateKey === 'knows' && right.predicateKey === 'knows' && pairEqual(left, right)
    && typeof left.canonicalValue === 'boolean' && typeof right.canonicalValue === 'boolean') {
    return left.canonicalValue !== right.canonicalValue
  }
  if (['knows', 'owes', 'promised', 'damaged'].includes(left.predicateKey)
    || ['knows', 'owes', 'promised', 'damaged'].includes(right.predicateKey)) return false
  if (left.predicateKey === right.predicateKey && slotEqual(left, right)) {
    const oneValue = left.canonicalValue
    const otherValue = right.canonicalValue
    return oneValue !== otherValue
  }
  return false
}

function parsePolicy(
  input: TtrpgSessionFactGateInputV1,
  predicateKey: TtrpgOpenFactPredicate,
): TtrpgOpenFactPolicyV1 | null {
  return input.factPolicy?.find(policy => policy.predicateKey === predicateKey)
    ?? input.rulePack?.factPolicy.find(policy => policy.predicateKey === predicateKey)
    ?? null
}

function assertPolicyValueType(fact: TtrpgSessionFactV1, policy: TtrpgOpenFactPolicyV1): void {
  const valid = policy.valueType === 'boolean'
    ? typeof fact.canonicalValue === 'boolean'
    : policy.valueType === 'number'
      ? typeof fact.canonicalValue === 'number'
      : typeof fact.canonicalValue === 'string'
  if (!valid) fail(`authority-conflict:value-type:${fact.predicateKey}`)
  if (policy.valueType === 'entity-ref' && fact.objectRef === null) {
    fail(`authority-conflict:object-ref:${fact.predicateKey}`)
  }
}

function assertFactPolicy(input: TtrpgSessionFactGateInputV1): void {
  const policy = parsePolicy(input, input.fact.predicateKey)
  if (!policy) return
  if (!policy.allowedKinds.includes(input.fact.kind)) fail('authority-conflict:kind-not-allowed')
  if (!policy.allowNewSubjects) {
    const known = new Set([
      ...(input.knownEntityRefs ?? []),
      ...input.frozenWorldPredicateIndex.entries.flatMap(entry => [entry.subjectRef, entry.objectRef]),
      ...(input.existingFacts ?? []).flatMap(fact => [fact.subjectRef, fact.objectRef]),
    ])
    if (!known.has(input.fact.subjectRef) || (input.fact.objectRef !== null && !known.has(input.fact.objectRef))) {
      fail('authority-conflict:new-subject')
    }
  }
  const owner = policy.authority.session
  if (owner !== null && owner !== 'semantic-fact') fail(`authority-conflict:${owner}`)
  assertPolicyValueType(input.fact, policy)
}

function assertNotStoryFactOwner(input: TtrpgSessionFactGateInputV1): void {
  const keys = input.effectLedgerStoryFacts ? Object.keys(input.effectLedgerStoryFacts) : []
  if (keys.includes(input.fact.factKey) || keys.includes(input.fact.subjectRef)) {
    fail('authority-conflict:storyFacts 与 session-fact 双写')
  }
}

function assertF1(input: TtrpgSessionFactGateInputV1): void {
  const fact = input.fact
  const frozen = input.frozenWorldPredicateIndex.entries
    .filter(entry => entry.authority === 'invariant')
  const frozenFacts = frozen.map(entry => ({
    ...fact,
    factKey: entry.factKey,
    subjectRef: entry.subjectRef,
    predicateKey: entry.predicateKey,
    objectRef: entry.objectRef,
    audience: entry.audience,
    knownBy: entry.knownByActorKeys,
    canonicalValue: entry.canonicalValue,
  }))
  for (const existing of frozenFacts) {
    if (ttrpgSessionFactsConflictV1(fact, existing)) fail(`F1: ${existing.factKey}:${input.frozenWorldPredicateIndex.worldReleaseHash}`)
  }
}

function predicateLeaves(predicate: TtrpgPredicateV1): TtrpgPredicateV1[] {
  if (predicate.op === 'all' || predicate.op === 'any') return predicate.of.flatMap(predicateLeaves)
  if (predicate.op === 'not') return predicateLeaves(predicate.of)
  return [predicate]
}

function assertF2(input: TtrpgSessionFactGateInputV1): void {
  for (const candidate of input.canonInvariantPredicates ?? []) {
    const parsed = parseTtrpgPredicateV1(candidate)
    for (const leaf of predicateLeaves(parsed)) {
      if (leaf.op !== 'world-fact') continue
      const invariant: TtrpgSessionFactV1 = {
        ...input.fact,
        predicateKey: leaf.predicateKey,
        subjectRef: leaf.subjectRef,
        objectRef: leaf.objectRef,
        canonicalValue: leaf.value ?? true,
      }
      if (ttrpgSessionFactsConflictV1(input.fact, invariant)) fail(`F2:${leaf.op}:${leaf.subjectRef}:${leaf.predicateKey}`)
    }
  }
}

function assertF3(input: TtrpgSessionFactGateInputV1): void {
  const existing = activeFacts(input.existingFacts ?? [])
  if (input.fact.supersedes !== null) {
    const target = existing.find(fact => fact.factKey === input.fact.supersedes)
    if (!target) fail('F3:supersedes-target-missing')
    if (!slotEqual(input.fact, target) && !(input.fact.predicateKey === 'owns' && target.predicateKey === 'owns'
      && input.fact.objectRef === target.objectRef)) fail('F3:supersedes-slot-mismatch')
  }
  const conflict = existing.find(existingFact => existingFact.factKey !== input.fact.supersedes && ttrpgSessionFactsConflictV1(input.fact, existingFact))
  if (conflict) fail(`F3:${conflict.factKey}:需要supersedes`)
}

function eventFacts(event: TtrpgSessionFactSourceEventV1): TtrpgSessionFactV1[] {
  return event.facts.map(parseTtrpgSessionFactV1)
}

interface ResolvedSourceV1 {
  audience: TtrpgOpenAudience
  knownBy: string[]
  event: TtrpgSessionFactSourceEventV1 | null
}

function assertF4(input: TtrpgSessionFactGateInputV1): void {
  const fact = input.fact
  if (fact.sourceFactRefs.length === 0 && fact.sourceEventRefs.length === 0) fail('F4:缺少显式来源')
  const availableFacts = sourceFacts(input)
  const factsByKey = new Map(availableFacts.map(source => [source.factKey, source]))
  const eventsByRef = new Map(sourceEvents(input).map(event => [event.eventRef, event]))
  const resolved: ResolvedSourceV1[] = []
  for (const factRef of fact.sourceFactRefs) {
    const source = factsByKey.get(factRef)
    if (!source) fail(`F4:sourceFactRef不可解析:${factRef}`)
    resolved.push({ audience: source.audience, knownBy: source.knownBy, event: null })
  }
  for (const eventRef of fact.sourceEventRefs) {
    const event = eventsByRef.get(eventRef)
    if (!event) fail(`F4:sourceEventRef不可解析:${eventRef}`)
    const contained = eventFacts(event)
    if (contained.length === 0 && event.audience === null) fail(`F4:sourceEvent无事实:${eventRef}`)
    for (const source of contained) {
      resolved.push({ audience: source.audience, knownBy: source.knownBy, event })
    }
    if (event.audience !== null) resolved.push({ audience: event.audience, knownBy: event.knownBy, event })
  }
  if (resolved.length === 0) fail('F4:来源为空')
  const maxSource = resolved.reduce((maximum, source) =>
    Math.max(maximum, SECRET_RANK[source.audience]), 0)
  const reveal = resolved.find(source =>
    source.event !== null
      && (source.event.kind === 'reveal' || source.event.kind === 'discovery')
      && source.event.audience !== null)
  const effectiveMaxSource = reveal ? SECRET_RANK[reveal.event!.audience!] : maxSource
  if (SECRET_RANK[fact.audience] < effectiveMaxSource) fail('F4:密级降级')
  if (reveal && fact.audience !== reveal.event!.audience) fail('F4:传播受众不匹配')
  if (fact.audience === 'private' && fact.knownBy.length === 0) fail('F4:private缺少knownBy')
  const privateSources = resolved.filter(source => source.audience === 'private')
  if (!reveal && fact.audience === 'private' && privateSources.length > 0) {
    const intersection = privateSources.reduce<string[] | null>((current, source) => {
      const next = new Set(source.knownBy)
      return current === null ? [...next] : current.filter(actorKey => next.has(actorKey))
    }, null) ?? []
    if (fact.knownBy.some(actorKey => !intersection.includes(actorKey))) fail('F4:private knownBy扩大')
  }
  if (maxSource === SECRET_RANK.private && fact.audience === 'gm-only') return
  if (maxSource === SECRET_RANK.party && fact.audience === 'private' && fact.knownBy.length === 0) {
    fail('F4:party升级private必须明确knownBy')
  }
}

export function assertTtrpgSessionFactGatesV1(
  input: TtrpgSessionFactGateInputV1,
): TtrpgSessionFactGateResultV1 {
  const fact = parseTtrpgSessionFactV1(input.fact)
  const normalizedInput = { ...input, fact }
  assertFactPolicy(normalizedInput)
  assertNotStoryFactOwner(normalizedInput)
  assertF1(normalizedInput)
  assertF2(normalizedInput)
  assertF3(normalizedInput)
  assertF4(normalizedInput)
  return {
    passed: true,
    f1: { passed: true },
    f2: { passed: true },
    f3: { passed: true },
    f4: { passed: true },
    failures: [],
  }
}

export function projectTtrpgSessionFactsV1(
  facts: readonly TtrpgSessionFactV1[],
  viewer?: { audience: TtrpgOpenAudience; actorKey?: string },
): TtrpgSessionFactV1[] {
  const parsed = facts.map(parseTtrpgSessionFactV1)
    .filter(fact => !fact.retired)
    .filter(fact => {
      if (!viewer) return true
      if (viewer.audience === 'gm-only') return true
      if (SECRET_RANK[fact.audience] > SECRET_RANK[viewer.audience]) return false
      return fact.audience !== 'private' || (viewer.actorKey !== undefined && fact.knownBy.includes(viewer.actorKey))
    })
    .sort((left, right) => left.factKey.localeCompare(right.factKey))
  return parsed.map(cloneFact)
}

export function retireTtrpgSessionFactV1(input: {
  fact: TtrpgSessionFactV1
  retiredAtSequence: number
}): TtrpgSessionFactV1 {
  const fact = parseTtrpgSessionFactV1(input.fact)
  const retiredAtSequence = p.integer(input.retiredAtSequence, 'retiredAtSequence')
  return { ...fact, retired: true, retiredAtSequence }
}

export type TtrpgSessionFactOwnerV1 = TtrpgOpenFactOwner
