import { describe, expect, it } from 'vitest'
import { compileTtrpgFrozenWorldPredicateIndexV1 } from '../../src/lib/ttrpg/frozen-facts'
import {
  assertTtrpgSessionFactGatesV1,
  type TtrpgSessionFactV1,
} from '../../src/lib/ttrpg/session-facts'

const HASH = 'b'.repeat(64)

function fact(overrides: Partial<TtrpgSessionFactV1> = {}): TtrpgSessionFactV1 {
  return {
    factKey: 'fact.secret.exists.1',
    layer: 'session',
    kind: 'event-truth',
    subjectRef: 'secret',
    predicateKey: 'exists',
    objectRef: null,
    canonicalValue: true,
    detail: '秘密存在',
    origin: 'oracle',
    originEventSequence: 1,
    originRef: 'event.secret',
    sourceFactRefs: ['world.secret'],
    sourceEventRefs: [],
    audience: 'gm-only',
    knownBy: [],
    supersedes: null,
    supersedeReason: null,
    retired: false,
    retiredAtSequence: null,
    ...overrides,
  }
}

async function frozenSecret() {
  return compileTtrpgFrozenWorldPredicateIndexV1({
    worldReleaseHash: HASH,
    entries: [{
      factKey: 'world.secret',
      subjectRef: 'secret',
      predicateKey: 'exists',
      objectRef: null,
      canonicalValue: true,
      authority: 'invariant',
      owner: 'semantic-fact',
      audience: 'gm-only',
      knownByActorKeys: [],
      sourceResourceRefs: ['world.secret'],
      sourceFieldRefs: [{ resourceKey: 'world.secret', fieldPath: 'secret', contentHash: HASH }],
    }],
  })
}

describe('R-TTRPGOPEN3 fact secrecy', () => {
  it('rejects lowering a gm-only source to party, private, or public', async () => {
    const frozen = await frozenSecret()
    for (const audience of ['party', 'private', 'public'] as const) {
      expect(() => assertTtrpgSessionFactGatesV1({
        fact: fact({ audience, knownBy: audience === 'private' ? ['hero'] : [] }),
        frozenWorldPredicateIndex: frozen,
      })).toThrow('F4')
    }
  })

  it('requires resolvable explicit sources', async () => {
    const frozen = await frozenSecret()
    expect(() => assertTtrpgSessionFactGatesV1({
      fact: fact({ sourceFactRefs: ['missing.fact'], audience: 'gm-only' }),
      frozenWorldPredicateIndex: frozen,
    })).toThrow('sourceFactRef不可解析')
  })

  it('allows a declared reveal event to propagate the declared audience', async () => {
    const frozen = await frozenSecret()
    expect(assertTtrpgSessionFactGatesV1({
      fact: fact({
        sourceFactRefs: [],
        sourceEventRefs: ['event.reveal'],
        audience: 'party',
        knownBy: [],
      }),
      frozenWorldPredicateIndex: frozen,
      sourceEvents: [{
        eventRef: 'event.reveal',
        facts: [fact({ factKey: 'fact.secret.source', audience: 'gm-only' })],
        audience: 'party',
        knownBy: [],
        kind: 'reveal',
      }],
    }).passed).toBe(true)
  })

  it('keeps private recipients within the source intersection', async () => {
    const frozen = await frozenSecret()
    const source = fact({
      factKey: 'fact.private.source',
      audience: 'private',
      knownBy: ['hero', 'companion.1'],
    })
    const base = {
      frozenWorldPredicateIndex: frozen,
      sourceFacts: [source],
    }
    expect(assertTtrpgSessionFactGatesV1({
      ...base,
      fact: fact({
        sourceFactRefs: ['fact.private.source'],
        audience: 'private',
        knownBy: ['hero'],
      }),
    }).passed).toBe(true)
    expect(() => assertTtrpgSessionFactGatesV1({
      ...base,
      fact: fact({
        sourceFactRefs: ['fact.private.source'],
        audience: 'private',
        knownBy: ['hero', 'companion.2'],
      }),
    })).toThrow('knownBy扩大')
  })
})
