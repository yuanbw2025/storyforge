/** Complete structural instructions for the model; the existing closed parser and S1-S10 remain authoritative. */
import { OPEN_FACT_PREDICATES } from './open-contract'
type Schema = Record<string, unknown>
const key: Schema = { type: 'string', minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' }
const text = (maxLength = 20000): Schema => ({ type: 'string', minLength: 1, maxLength })
const enumeration = (values: readonly string[]): Schema => ({ type: 'string', enum: values })
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] })
const list = (items: Schema, minItems = 0, maxItems = 100): Schema => ({ type: 'array', items, minItems, maxItems })
const keys = (min = 0, max = 1000): Schema => ({ ...list(key, min, max), uniqueItems: true })
const closed = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: 'object', properties, required: Object.keys(properties).filter(k => !optional.includes(k)), additionalProperties: false })
const integer = (minimum: number, maximum: number): Schema => ({ type: 'integer', minimum, maximum })
const number: Schema = { type: 'number', minimum: -1000000, maximum: 1000000 }
const boolean: Schema = { type: 'boolean' }
const scalar: Schema = { anyOf: [text(), number, boolean] }
const predicate: Schema = { $ref: '#/$defs/predicate' }
const predicates = list(predicate, 0, 32)
const audiences = ['gm-only', 'party', 'private', 'public']
const op = (name: string, fields: Record<string, Schema>): Schema => closed({ op: { const: name }, ...fields })
export const TTRPG_OPEN_SITUATION_OUTPUT_SCHEMA_V1: Schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...closed({ schema: { const: 'storyforge.ttrpg-open-situation-proposal' }, version: { const: 1 },
    template: closed({
      title: text(300), motive: enumeration(['knowledge', 'protection', 'reputation', 'wealth', 'ability', 'equipment', 'conquest', 'serenity', 'comfort']),
      driverBinding: { oneOf: [
        closed({ kind: { const: 'npc' }, characterKey: key }), closed({ kind: { const: 'front' }, frontKey: key }),
        closed({ kind: enumeration(['world-event', 'player-commitment']), factRef: key }) ] },
      driverGoal: text(), driverBeliefs: list(closed({ factRef: nullable(key), belief: text(), isMistaken: boolean }), 1),
      preconditions: predicates,
      obstacles: list(closed({ obstacleKey: key, kind: enumeration(['physical', 'social', 'informational', 'resource', 'legal']),
        ref: nullable(key), predicate, dependsOn: keys(0, 100) }), 2),
      interventionPoints: list(closed({ pointKey: key, visibleTo: enumeration(['party', 'private', 'public']),
        knownByActorKeys: keys(), affordanceHint: text(), requiresPredicate: nullable(predicate),
        suggestedActionKeys: keys(0, 100), targetsObstacleKeys: keys(1, 100) }), 2),
      evidence: list(closed({ clueRef: key, title: text(300), description: text(), sourceFactRefs: keys(), sourceResourceRefs: keys(),
        discoverableBy: keys(1, 100), coversObstacleKeys: keys(0, 100), audience: enumeration(['gm-only', 'party', 'private']),
        knownByActorKeys: keys(), isRequired: boolean, discoveryPolicy: closed({ preconditions: predicates,
          paths: list(closed({ kind: enumeration(['action', 'generic-check']), key, interventionPointKey: key }), 1),
          failForwardEffectPlanRef: nullable(key), costEffectPlanRef: nullable(key), allowedAudience: enumeration(audiences),
          recipientActorKeys: keys(), requiresPlayerConfirmation: boolean }) }), 2),
      whyNowRefs: keys(2, 100),
      noInterventionOutcome: closed({ afterWorldTurns: integer(1, 50), description: text(), effectPlanRef: nullable(key), advancesClockKeys: keys() }),
      consequences: list(closed({ scope: enumeration(['actor', 'faction', 'location', 'world-state', 'party-identity']), ref: key,
        effectPlanRef: key, nextSituationTemplateKey: nullable(key), audience: enumeration(['gm-only', 'party', 'public']) })),
      sourceRefs: keys(1, 100),
    }), personalizationSourceKeys: keys(1, 100) }),
  $defs: { predicate: { oneOf: [
    op('all', { of: list(predicate, 1, 32) }), op('any', { of: list(predicate, 1, 32) }), op('not', { of: predicate }),
    ...['world-fact', 'session-fact'].map(name => closed({ op: { const: name }, subjectRef: key,
      predicateKey: enumeration(OPEN_FACT_PREDICATES), objectRef: nullable(key), value: scalar }, ['value'])),
    op('evidence-known-by', { clueRef: key, actorKey: key }), op('clock-at-least', { clockKey: key, value: integer(0, 100) }),
    op('story-fact', { factKey: key, expected: nullable(scalar) }), op('actor-at', { actorKey: key, locationRef: key }),
    op('item-held', { actorKey: key, itemKey: key }), op('ability-available', { actorKey: key, abilityKey: key }),
    op('resource-at-least', { actorKey: key, resourceKey: key, value: number }),
    op('social-balance-at-least', { balanceKey: key, value: number }), op('chaos-at-least', { value: integer(1, 9) }),
    op('world-turn-at-least', { value: integer(0, 1000) }), op('situation-active', { templateKey: key }),
    op('front-stage-at-least', { frontKey: key, stageKey: key }),
  ] } },
}
