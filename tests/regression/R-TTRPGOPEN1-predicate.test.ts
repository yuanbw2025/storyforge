import { describe, expect, it } from 'vitest'
import { compileTtrpgFrozenWorldPredicateIndexV1 } from '../../src/lib/ttrpg/frozen-facts'
import {
  evaluateTtrpgPredicateV1,
  parseTtrpgPredicateV1,
  serializeTtrpgPredicateV1,
} from '../../src/lib/ttrpg/predicate'
import type { TtrpgPredicateEvaluationContextV1 } from '../../src/lib/ttrpg/predicate'
import type { TtrpgOpenFrozenFactV1, TtrpgPredicateV1 } from '../../src/lib/ttrpg/open-contract'

const HASH = 'b'.repeat(64)

function baseFact(overrides: Partial<TtrpgOpenFrozenFactV1> = {}): TtrpgOpenFrozenFactV1 {
  return {
    factKey: 'fact.harbor.exists',
    subjectRef: 'harbor',
    predicateKey: 'exists',
    objectRef: null,
    canonicalValue: true,
    authority: 'invariant',
    owner: 'semantic-fact',
    audience: 'public',
    knownByActorKeys: [],
    sourceResourceRefs: ['world.harbor'],
    sourceFieldRefs: [{ resourceKey: 'world.harbor', fieldPath: 'identity.exists', contentHash: HASH }],
    ...overrides,
  }
}

async function context(): Promise<TtrpgPredicateEvaluationContextV1> {
  const index = await compileTtrpgFrozenWorldPredicateIndexV1({
    worldReleaseHash: HASH,
    entries: [
      baseFact(),
      baseFact({ factKey: 'fact.harbor.open', predicateKey: 'open', canonicalValue: true }),
      baseFact({ factKey: 'fact.hero.knows', subjectRef: 'hero', predicateKey: 'knows', objectRef: 'keeper', canonicalValue: true }),
    ],
  })
  return {
    frozenWorldPredicateIndex: index,
    sessionFacts: [{ subjectRef: 'hero', predicateKey: 'damaged', objectRef: null, canonicalValue: false }],
    effectLedger: {
      storyFacts: { 'quest.started': true },
      socialBalances: { 'hero:trust:keeper': 2 },
    },
    pressure: {
      clocks: { flood: { value: 3 } },
      fronts: { storm: { currentStageKey: 'storm.stage.1', escalationStages: [{ stageKey: 'storm.stage.1' }, { stageKey: 'storm.stage.2' }] } },
    },
    actors: {
      hero: { locationRef: 'harbor', itemKeys: ['lamp'], abilityKeys: ['observe'], resources: { stamina: 2 } },
      keeper: { locationRef: 'harbor', itemKeys: [], abilityKeys: [], resources: {} },
    },
    situations: {
      active: [{ templateKey: 'situation.flood', discoveredEvidenceRefs: ['clue.lamp'] }],
      templates: [{
        templateKey: 'situation.flood',
        evidence: [
          { clueRef: 'clue.lamp', audience: 'party', knownByActorKeys: [] },
          { clueRef: 'clue.secret', audience: 'private', knownByActorKeys: ['hero'] },
        ],
      }],
    },
    chaos: 5,
    worldTurn: 2,
    knownRefs: ['harbor', 'hero', 'keeper', 'lamp', 'observe', 'flood', 'storm', 'storm.stage.1', 'storm.stage.2',
      'quest.started', 'hero:trust:keeper', 'clue.lamp', 'clue.secret', 'situation.flood', 'stamina'],
  }
}

describe('R-TTRPGOPEN1 predicate', () => {
  it('parses the closed 17-operation predicate set with bounded nesting', () => {
    const leaves: TtrpgPredicateV1[] = [
      { op: 'world-fact', subjectRef: 'harbor', predicateKey: 'exists', objectRef: null, value: true },
      { op: 'session-fact', subjectRef: 'hero', predicateKey: 'damaged', objectRef: null, value: false },
      { op: 'evidence-known-by', clueRef: 'clue.secret', actorKey: 'hero' },
      { op: 'clock-at-least', clockKey: 'flood', value: 3 },
      { op: 'story-fact', factKey: 'quest.started', expected: true },
      { op: 'actor-at', actorKey: 'hero', locationRef: 'harbor' },
      { op: 'item-held', actorKey: 'hero', itemKey: 'lamp' },
      { op: 'ability-available', actorKey: 'hero', abilityKey: 'observe' },
      { op: 'resource-at-least', actorKey: 'hero', resourceKey: 'stamina', value: 2 },
      { op: 'social-balance-at-least', balanceKey: 'hero:trust:keeper', value: 2 },
      { op: 'chaos-at-least', value: 5 },
      { op: 'world-turn-at-least', value: 2 },
      { op: 'situation-active', templateKey: 'situation.flood' },
      { op: 'front-stage-at-least', frontKey: 'storm', stageKey: 'storm.stage.1' },
      { op: 'not', of: { op: 'world-turn-at-least', value: 99 } },
      { op: 'all', of: [{ op: 'world-turn-at-least', value: 1 }] },
      { op: 'any', of: [{ op: 'world-turn-at-least', value: 99 }, { op: 'chaos-at-least', value: 5 }] },
    ]
    expect(leaves).toHaveLength(17)
    for (const predicate of leaves) expect(parseTtrpgPredicateV1(predicate)).toEqual(predicate)
    expect(() => parseTtrpgPredicateV1({ op: 'unknown' })).toThrow(/predicate-unresolvable/)
    let nested: TtrpgPredicateV1 = { op: 'world-turn-at-least', value: 1 }
    for (let index = 0; index < 8; index += 1) nested = { op: 'not', of: nested }
    expect(() => parseTtrpgPredicateV1(nested)).toThrow(/深度/)
    expect(() => parseTtrpgPredicateV1({
      op: 'all',
      of: Array.from({ length: 33 }, () => ({ op: 'world-turn-at-least', value: 1 })),
    })).toThrow(/数组长度/)
  })

  it('evaluates every leaf and combination from a read-only derived snapshot', async () => {
    const snapshot = await context()
    const checks: Array<[TtrpgPredicateV1, boolean]> = [
      [{ op: 'world-fact', subjectRef: 'harbor', predicateKey: 'exists', objectRef: null, value: true }, true],
      [{ op: 'session-fact', subjectRef: 'hero', predicateKey: 'damaged', objectRef: null, value: false }, true],
      [{ op: 'evidence-known-by', clueRef: 'clue.secret', actorKey: 'hero' }, true],
      [{ op: 'clock-at-least', clockKey: 'flood', value: 4 }, false],
      [{ op: 'story-fact', factKey: 'quest.started', expected: true }, true],
      [{ op: 'actor-at', actorKey: 'hero', locationRef: 'harbor' }, true],
      [{ op: 'item-held', actorKey: 'hero', itemKey: 'lamp' }, true],
      [{ op: 'ability-available', actorKey: 'hero', abilityKey: 'observe' }, true],
      [{ op: 'resource-at-least', actorKey: 'hero', resourceKey: 'stamina', value: 3 }, false],
      [{ op: 'social-balance-at-least', balanceKey: 'hero:trust:keeper', value: 2 }, true],
      [{ op: 'chaos-at-least', value: 6 }, false],
      [{ op: 'world-turn-at-least', value: 2 }, true],
      [{ op: 'situation-active', templateKey: 'situation.flood' }, true],
      [{ op: 'front-stage-at-least', frontKey: 'storm', stageKey: 'storm.stage.2' }, false],
      [{ op: 'not', of: { op: 'world-turn-at-least', value: 99 } }, true],
      [{ op: 'all', of: [{ op: 'world-turn-at-least', value: 1 }, { op: 'chaos-at-least', value: 5 }] }, true],
      [{ op: 'any', of: [{ op: 'world-turn-at-least', value: 99 }, { op: 'chaos-at-least', value: 5 }] }, true],
    ]
    const before = structuredClone(snapshot)
    for (const [predicate, expected] of checks) expect(evaluateTtrpgPredicateV1(predicate, snapshot)).toBe(expected)
    expect(snapshot).toEqual(before)
    expect(serializeTtrpgPredicateV1(checks[0][0])).toBe('op:world-fact:harbor/exists')
  })

  it('distinguishes unresolved references from false predicates', async () => {
    const snapshot = await context()
    expect(evaluateTtrpgPredicateV1(
      { op: 'world-fact', subjectRef: 'harbor', predicateKey: 'exists', objectRef: null, value: false },
      snapshot,
    )).toBe(false)
    expect(() => evaluateTtrpgPredicateV1(
      { op: 'clock-at-least', clockKey: 'missing', value: 1 },
      snapshot,
    )).toThrow(/predicate-unresolvable/)
    expect(() => evaluateTtrpgPredicateV1(
      { op: 'all', of: [{ op: 'world-turn-at-least', value: 999 }, { op: 'clock-at-least', clockKey: 'missing', value: 1 }] },
      snapshot,
    )).toThrow(/predicate-unresolvable/)
  })
})
