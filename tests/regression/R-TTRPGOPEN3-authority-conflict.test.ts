import { describe, expect, it } from 'vitest'
import { compileTtrpgFrozenWorldPredicateIndexV1 } from '../../src/lib/ttrpg/frozen-facts'
import { assertTtrpgSessionFactGatesV1, type TtrpgSessionFactV1 } from '../../src/lib/ttrpg/session-facts'
import { openRuleFixture } from '../helpers/ttrpg-open-content'

const HASH = 'c'.repeat(64)

function fact(overrides: Partial<TtrpgSessionFactV1> = {}): TtrpgSessionFactV1 {
  return {
    factKey: 'fact.source.exists.1',
    layer: 'session',
    kind: 'state',
    subjectRef: 'source',
    predicateKey: 'exists',
    objectRef: null,
    canonicalValue: true,
    detail: '来源',
    origin: 'rule-outcome',
    originEventSequence: 1,
    originRef: 'event.source',
    sourceFactRefs: ['world.source'],
    sourceEventRefs: [],
    audience: 'public',
    knownBy: [],
    supersedes: null,
    supersedeReason: null,
    retired: false,
    retiredAtSequence: null,
    ...overrides,
  }
}

async function frozen() {
  return compileTtrpgFrozenWorldPredicateIndexV1({
    worldReleaseHash: HASH,
    entries: [{
      factKey: 'world.source',
      subjectRef: 'source',
      predicateKey: 'exists',
      objectRef: null,
      canonicalValue: true,
      authority: 'invariant',
      owner: 'semantic-fact',
      audience: 'public',
      knownByActorKeys: [],
      sourceResourceRefs: ['world.source'],
      sourceFieldRefs: [{ resourceKey: 'world.source', fieldPath: 'exists', contentHash: HASH }],
    }],
  })
}

describe('R-TTRPGOPEN3 authority conflicts', () => {
  it('rejects a session fact that directly owns a mechanical authority', async () => {
    const index = await frozen()
    const rulePack = openRuleFixture()
    expect(() => assertTtrpgSessionFactGatesV1({
      fact: fact({
        factKey: 'fact.location',
        subjectRef: 'source',
        predicateKey: 'located-at',
        objectRef: 'source',
        sourceFactRefs: ['world.source'],
      }),
      frozenWorldPredicateIndex: index,
      rulePack,
    })).toThrow('authority-conflict:entity')
  })

  it('rejects storyFacts/session-fact double ownership', async () => {
    const index = await frozen()
    expect(() => assertTtrpgSessionFactGatesV1({
      fact: fact({ factKey: 'story.flag', sourceFactRefs: ['world.source'] }),
      frozenWorldPredicateIndex: index,
      effectLedgerStoryFacts: { 'story.flag': true },
    })).toThrow('storyFacts 与 session-fact 双写')
  })

  it('does not let ordinary beliefs become authoritative facts without a source', async () => {
    const index = await frozen()
    expect(() => assertTtrpgSessionFactGatesV1({
      fact: fact({ sourceFactRefs: [], sourceEventRefs: [] }),
      frozenWorldPredicateIndex: index,
    })).toThrow('缺少显式来源')
  })
})
