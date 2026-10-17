import { ttrpgOpenActorKnowsEvidenceV1, type TtrpgOpenKnowledgeEntryV1 } from './open-knowledge'
import { parsePredicate } from './open-content-predicates'
import { json } from './open-contract-parse'
import { lookupTtrpgFrozenWorldPredicateV1 } from './frozen-facts'
import type {
  TtrpgFrozenWorldPredicateIndexV1,
  TtrpgOpenFactPredicate,
  TtrpgOpenScalar,
  TtrpgPredicateV1,
} from './open-contract'

export interface TtrpgPredicateFactSnapshotV1 {
  subjectRef: string
  predicateKey: TtrpgOpenFactPredicate
  objectRef?: string | null
  canonicalValue: TtrpgOpenScalar
  retired?: boolean
}

export interface TtrpgPredicateActorSnapshotV1 {
  locationRef: string | null
  itemKeys: readonly string[]
  abilityKeys: readonly string[]
  resources: Readonly<Record<string, number>>
}

export interface TtrpgPredicateEvidenceSnapshotV1 {
  clueRef: string
  audience: 'gm-only' | 'party' | 'private'
  knownByActorKeys: readonly string[]
}

export interface TtrpgPredicateSituationSnapshotV1 {
  templateKey: string
  discoveredEvidenceRefs: readonly string[]
}

export interface TtrpgPredicateSituationTemplateSnapshotV1 {
  templateKey: string
  evidence: readonly TtrpgPredicateEvidenceSnapshotV1[]
}

export interface TtrpgPredicateFrontSnapshotV1 {
  currentStageKey: string | null
  escalationStages: readonly { stageKey: string }[]
}

export interface TtrpgPredicateEvaluationContextV1 {
  frozenWorldPredicateIndex: TtrpgFrozenWorldPredicateIndexV1
  sessionFacts: readonly TtrpgPredicateFactSnapshotV1[]
  /** Formal runtime reads mutable facts through owner adapters. */
  worldFacts?: readonly TtrpgPredicateFactSnapshotV1[]
  effectLedger: {
    storyFacts: Readonly<Record<string, TtrpgOpenScalar | null>>
    socialBalances: Readonly<Record<string, number>>
  }
  pressure: {
    clocks: Readonly<Record<string, { value: number }>>
    fronts: Readonly<Record<string, TtrpgPredicateFrontSnapshotV1>>
  }
  actors: Readonly<Record<string, TtrpgPredicateActorSnapshotV1>>
  situations: {
    active: readonly TtrpgPredicateSituationSnapshotV1[]
    templates: readonly TtrpgPredicateSituationTemplateSnapshotV1[]
  }
  chaos: number
  worldTurn: number
  /** Formal open callers always provide this owner; omitted only by offline prototype fixtures. */
  knowledge?: readonly TtrpgOpenKnowledgeEntryV1[]
  knownRefs?: readonly string[]
}

function fail(message: string): never {
  throw new Error(`[ttrpg-predicate] ${message}`)
}

function referenceError(ref: string, label: string): never {
  return fail(`predicate-unresolvable:${label}:${ref}`)
}

function parse(value: unknown): TtrpgPredicateV1 {
  try {
    return parsePredicate(json(value), 'predicate')
  } catch (error) {
    if (error instanceof Error && error.message.includes('predicate-unresolvable')) throw error
    throw error
  }
}

export function parseTtrpgPredicateV1(value: unknown): TtrpgPredicateV1 {
  return parse(value)
}

function knownReferences(context: TtrpgPredicateEvaluationContextV1): Set<string> {
  const refs = new Set(context.knownRefs ?? [])
  for (const entry of context.frozenWorldPredicateIndex.entries) {
    refs.add(entry.subjectRef)
    if (entry.objectRef !== null) refs.add(entry.objectRef)
  }
  for (const fact of context.sessionFacts) {
    refs.add(fact.subjectRef)
    if (fact.objectRef != null) refs.add(fact.objectRef)
  }
  for (const [actorKey, actor] of Object.entries(context.actors)) {
    refs.add(actorKey)
    if (actor.locationRef !== null) refs.add(actor.locationRef)
    for (const itemKey of actor.itemKeys) refs.add(itemKey)
    for (const abilityKey of actor.abilityKeys) refs.add(abilityKey)
    for (const resourceKey of Object.keys(actor.resources)) refs.add(resourceKey)
  }
  for (const clockKey of Object.keys(context.pressure.clocks)) refs.add(clockKey)
  for (const [frontKey, front] of Object.entries(context.pressure.fronts)) {
    refs.add(frontKey)
    if (front.currentStageKey !== null) refs.add(front.currentStageKey)
    for (const stage of front.escalationStages) refs.add(stage.stageKey)
  }
  for (const situation of context.situations.active) {
    refs.add(situation.templateKey)
    for (const clueRef of situation.discoveredEvidenceRefs) refs.add(clueRef)
  }
  for (const template of context.situations.templates) {
    refs.add(template.templateKey)
    for (const evidence of template.evidence) refs.add(evidence.clueRef)
  }
  for (const factKey of Object.keys(context.effectLedger.storyFacts)) refs.add(factKey)
  for (const balanceKey of Object.keys(context.effectLedger.socialBalances)) refs.add(balanceKey)
  return refs
}

function assertReference(refs: Set<string>, value: string, label: string): void {
  if (!refs.has(value)) referenceError(value, label)
}

function assertFactReferences(
  predicate: TtrpgPredicateV1,
  context: TtrpgPredicateEvaluationContextV1,
  refs: Set<string>,
): void {
  switch (predicate.op) {
    case 'world-fact':
      assertReference(refs, predicate.subjectRef, 'world-fact.subjectRef')
      if (predicate.objectRef !== null) assertReference(refs, predicate.objectRef, 'world-fact.objectRef')
      return
    case 'session-fact':
      assertReference(refs, predicate.subjectRef, 'session-fact.subjectRef')
      if (predicate.objectRef !== null) assertReference(refs, predicate.objectRef, 'session-fact.objectRef')
      return
    case 'evidence-known-by':
      assertReference(refs, predicate.clueRef, 'evidence-known-by.clueRef')
      assertReference(refs, predicate.actorKey, 'evidence-known-by.actorKey')
      return
    case 'clock-at-least':
      assertReference(refs, predicate.clockKey, 'clock-at-least.clockKey')
      return
    case 'story-fact':
      assertReference(refs, predicate.factKey, 'story-fact.factKey')
      return
    case 'actor-at':
      assertReference(refs, predicate.actorKey, 'actor-at.actorKey')
      assertReference(refs, predicate.locationRef, 'actor-at.locationRef')
      return
    case 'item-held':
      assertReference(refs, predicate.actorKey, 'item-held.actorKey')
      assertReference(refs, predicate.itemKey, 'item-held.itemKey')
      return
    case 'ability-available':
      assertReference(refs, predicate.actorKey, 'ability-available.actorKey')
      assertReference(refs, predicate.abilityKey, 'ability-available.abilityKey')
      return
    case 'resource-at-least':
      assertReference(refs, predicate.actorKey, 'resource-at-least.actorKey')
      assertReference(refs, predicate.resourceKey, 'resource-at-least.resourceKey')
      return
    case 'social-balance-at-least':
      assertReference(refs, predicate.balanceKey, 'social-balance-at-least.balanceKey')
      return
    case 'chaos-at-least':
    case 'world-turn-at-least':
      return
    case 'situation-active':
      assertReference(refs, predicate.templateKey, 'situation-active.templateKey')
      return
    case 'front-stage-at-least':
      assertReference(refs, predicate.frontKey, 'front-stage-at-least.frontKey')
      assertReference(refs, predicate.stageKey, 'front-stage-at-least.stageKey')
      return
    case 'all':
    case 'any':
      for (const child of predicate.of) assertFactReferences(child, context, refs)
      return
    case 'not':
      assertFactReferences(predicate.of, context, refs)
      return
  }
}

function matchesFact(
  fact: TtrpgPredicateFactSnapshotV1,
  subjectRef: string,
  predicateKey: TtrpgOpenFactPredicate,
  objectRef: string | null,
  value: TtrpgOpenScalar | undefined,
): boolean {
  return !fact.retired
    && fact.subjectRef === subjectRef
    && fact.predicateKey === predicateKey
    && (fact.objectRef ?? null) === objectRef
    && (value === undefined || fact.canonicalValue === value)
}

function evaluateLeaf(
  predicate: TtrpgPredicateV1,
  context: TtrpgPredicateEvaluationContextV1,
): boolean {
  switch (predicate.op) {
    case 'world-fact':
      if (context.worldFacts !== undefined) return context.worldFacts.some(fact => matchesFact(fact, predicate.subjectRef, predicate.predicateKey, predicate.objectRef, predicate.value))
      return lookupTtrpgFrozenWorldPredicateV1(
        context.frozenWorldPredicateIndex,
        predicate.subjectRef,
        predicate.predicateKey,
        predicate.objectRef,
      ).some(entry => predicate.value === undefined || entry.canonicalValue === predicate.value)
    case 'session-fact':
      return context.sessionFacts.some(fact =>
        matchesFact(fact, predicate.subjectRef, predicate.predicateKey, predicate.objectRef, predicate.value))
    case 'evidence-known-by': {
      if (context.knowledge !== undefined) return ttrpgOpenActorKnowsEvidenceV1(context.knowledge, predicate.actorKey, predicate.clueRef)
      for (const situation of context.situations.active) {
        if (situation.discoveredEvidenceRefs.includes(predicate.clueRef)) return true
      }
      for (const template of context.situations.templates) {
        const evidence = template.evidence.find(item => item.clueRef === predicate.clueRef)
        if (!evidence) continue
        if (evidence.audience === 'party') return true
        if (evidence.audience === 'private' && evidence.knownByActorKeys.includes(predicate.actorKey)) return true
      }
      return false
    }
    case 'clock-at-least':
      return context.pressure.clocks[predicate.clockKey].value >= predicate.value
    case 'story-fact':
      return context.effectLedger.storyFacts[predicate.factKey] === predicate.expected
    case 'actor-at':
      return context.actors[predicate.actorKey].locationRef === predicate.locationRef
    case 'item-held':
      return context.actors[predicate.actorKey].itemKeys.includes(predicate.itemKey)
    case 'ability-available':
      return context.actors[predicate.actorKey].abilityKeys.includes(predicate.abilityKey)
    case 'resource-at-least': {
      const actor = context.actors[predicate.actorKey]
      const value = actor.resources[predicate.resourceKey]
      return value >= predicate.value
    }
    case 'social-balance-at-least':
      return context.effectLedger.socialBalances[predicate.balanceKey] >= predicate.value
    case 'chaos-at-least':
      return context.chaos >= predicate.value
    case 'world-turn-at-least':
      return context.worldTurn >= predicate.value
    case 'situation-active':
      return context.situations.active.some(situation => situation.templateKey === predicate.templateKey)
    case 'front-stage-at-least': {
      const front = context.pressure.fronts[predicate.frontKey]
      const currentIndex = front.currentStageKey === null
        ? -1
        : front.escalationStages.findIndex(stage => stage.stageKey === front.currentStageKey)
      const expectedIndex = front.escalationStages.findIndex(stage => stage.stageKey === predicate.stageKey)
      return currentIndex >= expectedIndex
    }
    case 'all':
    case 'any':
    case 'not':
      return fail('组合谓词不能直接作为叶子求值')
  }
}

export function evaluateTtrpgPredicateV1(
  predicate: TtrpgPredicateV1,
  context: TtrpgPredicateEvaluationContextV1,
): boolean {
  const parsed = parse(predicate)
  const refs = knownReferences(context)
  assertFactReferences(parsed, context, refs)
  if (parsed.op === 'all') return parsed.of.every(child => evaluateTtrpgPredicateV1(child, context))
  if (parsed.op === 'any') return parsed.of.some(child => evaluateTtrpgPredicateV1(child, context))
  if (parsed.op === 'not') return !evaluateTtrpgPredicateV1(parsed.of, context)
  return evaluateLeaf(parsed, context)
}

export function serializeTtrpgPredicateV1(predicate: TtrpgPredicateV1): string {
  const parsed = parse(predicate)
  switch (parsed.op) {
    case 'world-fact':
    case 'session-fact':
      return `op:${parsed.op}:${parsed.subjectRef}/${parsed.predicateKey}${parsed.objectRef === null ? '' : `/${parsed.objectRef}`}`
    case 'evidence-known-by':
      return `op:${parsed.op}:${parsed.clueRef}/${parsed.actorKey}`
    case 'clock-at-least':
      return `op:${parsed.op}:${parsed.clockKey}`
    case 'story-fact':
      return `op:${parsed.op}:${parsed.factKey}`
    case 'actor-at':
      return `op:${parsed.op}:${parsed.actorKey}/${parsed.locationRef}`
    case 'item-held':
      return `op:${parsed.op}:${parsed.actorKey}/${parsed.itemKey}`
    case 'ability-available':
      return `op:${parsed.op}:${parsed.actorKey}/${parsed.abilityKey}`
    case 'resource-at-least':
      return `op:${parsed.op}:${parsed.actorKey}/${parsed.resourceKey}`
    case 'social-balance-at-least':
      return `op:${parsed.op}:${parsed.balanceKey}`
    case 'chaos-at-least':
    case 'world-turn-at-least':
      return `op:${parsed.op}:${parsed.value}`
    case 'situation-active':
      return `op:${parsed.op}:${parsed.templateKey}`
    case 'front-stage-at-least':
      return `op:${parsed.op}:${parsed.frontKey}/${parsed.stageKey}`
    case 'all':
    case 'any':
      return `op:${parsed.op}:${parsed.of.map(serializeTtrpgPredicateV1).join(',')}`
    case 'not':
      return `op:${parsed.op}:${serializeTtrpgPredicateV1(parsed.of)}`
  }
}
