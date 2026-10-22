/** Three-valued evaluation: unreadable operands stay unknown, including under NOT/ANY. */
import type { TtrpgPredicateV1 } from './open-contract'
import type { TtrpgPredicateFactSnapshotV1 } from './predicate'
import type { loadTtrpgOpenPlayerContextV1 } from './open-player-context'
export interface TtrpgOpenContextPredicateViewV1 {
  worldTurn: number
  player?: Awaited<ReturnType<typeof loadTtrpgOpenPlayerContextV1>>['view']
  worldFacts: readonly TtrpgPredicateFactSnapshotV1[]
  sessionFacts: readonly TtrpgPredicateFactSnapshotV1[]
}
export function evaluateTtrpgOpenContextPredicateV1(predicate: TtrpgPredicateV1, view: TtrpgOpenContextPredicateViewV1): boolean | undefined {
  const evaluate = (p: TtrpgPredicateV1) => evaluateTtrpgOpenContextPredicateV1(p, view)
  if (predicate.op === 'all' || predicate.op === 'any') {
    const results = predicate.of.map(evaluate)
    if (results.some(result => result === undefined)) return undefined
    return predicate.op === 'all' ? results.every(Boolean) : results.some(Boolean)
  }
  if (predicate.op === 'not') { const result = evaluate(predicate.of); return result === undefined ? undefined : !result }
  if (predicate.op === 'world-turn-at-least') return view.worldTurn >= predicate.value
  if (predicate.op === 'world-fact' || predicate.op === 'session-fact') {
    const facts = (predicate.op === 'world-fact' ? view.worldFacts : view.sessionFacts).filter(fact => !fact.retired
      && fact.subjectRef === predicate.subjectRef && fact.predicateKey === predicate.predicateKey && (fact.objectRef ?? null) === predicate.objectRef)
    return facts.length ? facts.some(fact => predicate.value === undefined || fact.canonicalValue === predicate.value) : undefined
  }
  const player = view.player
  if (!player) return undefined
  if (predicate.op === 'actor-at') {
    if (predicate.actorKey === player.authority.actorKey) return player.self.locationKey === predicate.locationRef
    return player.actorsHere.some(actor => actor.actorKey === predicate.actorKey) ? player.self.locationKey === predicate.locationRef : undefined
  }
  if ('actorKey' in predicate && predicate.actorKey !== player.authority.actorKey) return undefined
  if (predicate.op === 'item-held') return player.self.inventory.some(item => item.definitionRef === predicate.itemKey && item.quantity > 0)
  if (predicate.op === 'resource-at-least') {
    const value = player.self.attributes[`resource.${predicate.resourceKey}`]
    return typeof value === 'number' ? value >= predicate.value : undefined
  }
  if (predicate.op === 'ability-available') return player.rules.core.actionCatalog.find(action => action.actionKey === predicate.abilityKey)?.available
  if (predicate.op === 'evidence-known-by') {
    const entry = player.knowledge.find(entry => entry.evidenceRef === predicate.clueRef)
    return entry ? entry.reliability === 'observed' : undefined
  }
  return undefined
}
