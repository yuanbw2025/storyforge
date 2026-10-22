/** Validate disclosure authority before any predicate can inspect the full runtime. */
import type { TtrpgPredicateV1, TtrpgSituationTemplateV1 } from './open-contract'
import type { TtrpgPredicateFactSnapshotV1 } from './predicate'
import { parseTtrpgPredicateV1 } from './predicate'

export interface TtrpgOpenPublicPredicateScopeV1 {
  invariantFacts: readonly TtrpgPredicateFactSnapshotV1[]
  sessionFacts: readonly TtrpgPredicateFactSnapshotV1[]
  clocks: readonly { clockKey: string }[]
  observedEvidenceRefs: readonly string[]
  recipientActorKeys: readonly string[]
}
/** This declaration is delivered in full, so a model need not probe the private runtime. */
export function describeTtrpgOpenPublicPredicateScopeV1<T extends TtrpgOpenPublicPredicateScopeV1 & { worldTurn: number }>(scope: T) {
  return { schema: 'storyforge.ttrpg-open-public-situation-predicate-scope', version: 1,
    worldTurn: scope.worldTurn, recipientActorKeys: scope.recipientActorKeys, invariantFacts: scope.invariantFacts,
    sessionFacts: scope.sessionFacts, clocks: scope.clocks, observedEvidenceRefs: scope.observedEvidenceRefs,
    supportedOperations: ['all', 'any', 'not', 'world-turn-at-least', 'clock-at-least', 'evidence-known-by', 'world-fact', 'session-fact'],
    unsupportedPredicatesMustBeRejectedWithoutReadingHiddenOwners: true }
}
export function assertTtrpgOpenPublicPredicateV1(value: unknown, scope: TtrpgOpenPublicPredicateScopeV1): TtrpgPredicateV1 {
  const predicate = parseTtrpgPredicateV1(value)
  const permitted = (p: TtrpgPredicateV1): boolean => {
    switch (p.op) {
      case 'all': case 'any': return p.of.map(permitted).every(Boolean)
      case 'not': return permitted(p.of)
      case 'world-turn-at-least': return true
      case 'clock-at-least': return scope.clocks.some(clock => clock.clockKey === p.clockKey)
      case 'evidence-known-by': return scope.recipientActorKeys.includes(p.actorKey) && scope.observedEvidenceRefs.includes(p.clueRef)
      case 'world-fact': case 'session-fact': return (p.op === 'world-fact' ? scope.invariantFacts : scope.sessionFacts)
        .some(fact => !fact.retired && fact.subjectRef === p.subjectRef && fact.predicateKey === p.predicateKey && (fact.objectRef ?? null) === p.objectRef)
      default: return false
    }
  }
  // Deliberately no hidden ref, count, owner value or engine failure in the rejection.
  if (!permitted(predicate)) throw new Error('[ttrpg-public-situation] 条件没有本次共同资料的当前权威证明')
  return predicate
}
export function assertTtrpgOpenPublicSituationPredicatesV1(template: TtrpgSituationTemplateV1, scope: TtrpgOpenPublicPredicateScopeV1): void {
  const predicates = [...template.preconditions, ...template.obstacles.map(row => row.predicate),
    ...template.interventionPoints.flatMap(row => row.requiresPredicate ? [row.requiresPredicate] : []),
    ...template.evidence.flatMap(row => row.discoveryPolicy.preconditions)]
  for (const predicate of predicates) assertTtrpgOpenPublicPredicateV1(predicate, scope)
}
