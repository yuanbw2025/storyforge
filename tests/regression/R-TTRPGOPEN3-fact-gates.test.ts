import { describe, expect, it } from 'vitest'
import { compileTtrpgFrozenWorldPredicateIndexV1 } from '../../src/lib/ttrpg/frozen-facts'
import {
  assertTtrpgSessionFactGatesV1,
  type TtrpgSessionFactV1,
} from '../../src/lib/ttrpg/session-facts'
import { openRuleFixture } from '../helpers/ttrpg-open-content'

const HASH = 'a'.repeat(64)

function fact(overrides: Partial<TtrpgSessionFactV1> = {}): TtrpgSessionFactV1 {
  return {
    factKey: 'fact.harbor.exists.1',
    layer: 'session',
    kind: 'state',
    subjectRef: 'harbor',
    predicateKey: 'exists',
    objectRef: null,
    canonicalValue: true,
    detail: '港口仍然存在',
    origin: 'oracle',
    originEventSequence: 1,
    originRef: 'event.4',
    sourceFactRefs: ['world.harbor.exists'],
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

async function index(overrides: Partial<{
  factKey: string
  subjectRef: string
  predicateKey: 'exists' | 'open'
  canonicalValue: string | number | boolean
  authority: 'invariant' | 'initial-state'
}> = {}) {
  return compileTtrpgFrozenWorldPredicateIndexV1({
    worldReleaseHash: HASH,
    entries: [{
      factKey: 'world.harbor.exists',
      subjectRef: 'harbor',
      predicateKey: 'exists',
      objectRef: null,
      canonicalValue: true,
      authority: 'invariant',
      owner: 'semantic-fact',
      audience: 'public',
      knownByActorKeys: [],
      sourceResourceRefs: ['world.harbor'],
      sourceFieldRefs: [{ resourceKey: 'world.harbor', fieldPath: 'exists', contentHash: HASH }],
      ...overrides,
    }],
  })
}

describe('R-TTRPGOPEN3 fact gates', () => {
  it('passes a sourced fact through F1-F4', async () => {
    const frozen = await index()
    expect(assertTtrpgSessionFactGatesV1({
      fact: fact(),
      frozenWorldPredicateIndex: frozen,
    }).passed).toBe(true)
  })

  it('rejects conflict with a frozen invariant at F1', async () => {
    const frozen = await index()
    expect(() => assertTtrpgSessionFactGatesV1({
      fact: fact({ canonicalValue: false }),
      frozenWorldPredicateIndex: frozen,
    })).toThrow(/F1/)
  })

  it('checks only declared canon invariants at F2', async () => {
    const frozen = await index({ factKey: 'world.source', subjectRef: 'source' })
    expect(() => assertTtrpgSessionFactGatesV1({
      fact: fact({ sourceFactRefs: [], sourceEventRefs: ['event.oracle'], canonicalValue: false }),
      frozenWorldPredicateIndex: frozen,
      canonInvariantPredicates: [{
        op: 'world-fact',
        subjectRef: 'harbor',
        predicateKey: 'exists',
        objectRef: null,
        value: true,
      }],
      sourceEvents: [{
        eventRef: 'event.oracle',
        facts: [fact({ factKey: 'fact.oracle.source', subjectRef: 'source', sourceFactRefs: ['world.source'] })],
        audience: 'public',
        knownBy: [],
        kind: 'ordinary',
      }],
    })).toThrow(/F2/)
  })

  it('rejects F3 conflicts unless the same slot is explicitly superseded', async () => {
    const frozen = await index({ factKey: 'world.source', subjectRef: 'source' })
    const existing = fact({ factKey: 'fact.harbor.exists.2', sourceFactRefs: ['world.source'] })
    const base = {
      frozenWorldPredicateIndex: frozen,
      existingFacts: [existing],
      sourceEvents: [{
        eventRef: 'event.oracle',
        facts: [fact({ factKey: 'fact.oracle.source', subjectRef: 'source', sourceFactRefs: ['world.source'] })],
        audience: 'public' as const,
        knownBy: [],
        kind: 'ordinary' as const,
      }],
    }
    expect(() => assertTtrpgSessionFactGatesV1({
      ...base,
      fact: fact({ canonicalValue: false, sourceFactRefs: [], sourceEventRefs: ['event.oracle'] }),
    })).toThrow(/F3/)
    expect(assertTtrpgSessionFactGatesV1({
      ...base,
      fact: fact({
        factKey: 'fact.harbor.exists.3',
        canonicalValue: false,
        sourceFactRefs: [],
        sourceEventRefs: ['event.oracle'],
        supersedes: existing.factKey,
        supersedeReason: 'Oracle 结果更新当前叙事槽位',
      }),
    }).passed).toBe(true)
  })

  it('does not treat non-exclusive multi-value predicates as contradictions', async () => {
    const frozen = await index({ factKey: 'world.source', subjectRef: 'source' })
    const first = fact({
      factKey: 'fact.knows.one',
      predicateKey: 'knows',
      subjectRef: 'hero',
      objectRef: 'clue.one',
      canonicalValue: '第一条线索',
      sourceFactRefs: ['world.source'],
    })
    const second = {
      ...first,
      factKey: 'fact.knows.two',
      objectRef: 'clue.two',
      canonicalValue: '第二条线索',
      sourceFactRefs: [],
      sourceEventRefs: ['event.oracle'],
    }
    expect(assertTtrpgSessionFactGatesV1({
      fact: second,
      frozenWorldPredicateIndex: frozen,
      existingFacts: [first],
      sourceEvents: [{
        eventRef: 'event.oracle',
        facts: [fact({ factKey: 'fact.oracle.source', subjectRef: 'source', sourceFactRefs: ['world.source'] })],
        audience: 'public',
        knownBy: [],
        kind: 'ordinary',
      }],
    }).passed).toBe(true)
  })

  it('uses the frozen RulePack fact policy when supplied', async () => {
    const frozen = await index()
    const rulePack = openRuleFixture()
    expect(() => assertTtrpgSessionFactGatesV1({
      fact: fact({
        predicateKey: 'located-at',
        objectRef: 'harbor',
        sourceFactRefs: ['world.harbor.exists'],
      }),
      frozenWorldPredicateIndex: frozen,
      rulePack,
    })).toThrow('authority-conflict')
  })
})
