import { describe, expect, it } from 'vitest'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  compileTtrpgFrozenWorldPredicateIndexV1,
  lookupTtrpgFrozenWorldPredicateV1,
  parseTtrpgFrozenWorldPredicateIndexV1,
} from '../../src/lib/ttrpg/frozen-facts'
import type { TtrpgOpenFrozenFactV1 } from '../../src/lib/ttrpg/open-contract'

const HASH = 'a'.repeat(64)

function fact(overrides: Partial<TtrpgOpenFrozenFactV1> = {}): TtrpgOpenFrozenFactV1 {
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

describe('R-TTRPGOPEN1 frozen facts', () => {
  it('compiles a deterministic SHA-256 index and ignores input entry order', async () => {
    const entries = [
      fact({ factKey: 'fact.lighthouse.open', subjectRef: 'lighthouse', predicateKey: 'open', canonicalValue: true }),
      fact(),
    ]
    const forward = await compileTtrpgFrozenWorldPredicateIndexV1({ worldReleaseHash: HASH, entries })
    const reverse = await compileTtrpgFrozenWorldPredicateIndexV1({ worldReleaseHash: HASH, entries: [...entries].reverse() })
    expect(forward).toEqual(reverse)
    expect(forward.worldReleaseHash).toBe(HASH)
    expect(forward.indexHash).toMatch(/^[a-f0-9]{64}$/)
    expect(forward.indexHash).toBe(await hashProductProductionValueV2({
      worldReleaseHash: HASH,
      entries: forward.entries,
    }))
    expect(lookupTtrpgFrozenWorldPredicateV1(forward, 'harbor', 'exists')).toHaveLength(1)
  })

  it('keeps source hashes traceable and rejects malformed closed inputs', async () => {
    const privateFact = fact({
      factKey: 'fact.secret',
      audience: 'private',
      knownByActorKeys: ['hero'],
    })
    expect(await compileTtrpgFrozenWorldPredicateIndexV1(HASH, [privateFact])).toMatchObject({
      worldReleaseHash: HASH,
      entries: [{ sourceResourceRefs: ['world.harbor'], sourceFieldRefs: [{ contentHash: HASH }] }],
    })
    expect(() => parseTtrpgFrozenWorldPredicateIndexV1({
      worldReleaseHash: HASH,
      indexHash: HASH,
      entries: [fact({ unknown: true } as never)],
    })).toThrow(/字段/)
    await expect(compileTtrpgFrozenWorldPredicateIndexV1({
      worldReleaseHash: 'bad',
      entries: [fact()],
    })).rejects.toThrow(/SHA-256/)
    await expect(compileTtrpgFrozenWorldPredicateIndexV1({
      worldReleaseHash: HASH,
      entries: [fact({ audience: 'private', knownByActorKeys: ['hero'], sourceResourceRefs: [], sourceFieldRefs: [] })],
    })).rejects.toThrow(/sourceResourceRefs/)
  })

  it('enforces the 20000 entry limit', async () => {
    const entries = Array.from({ length: 20_001 }, (_, index) =>
      fact({
        factKey: `fact.harbor.exists.${index}`,
        subjectRef: `harbor.${index}`,
      }))
    await expect(compileTtrpgFrozenWorldPredicateIndexV1({ worldReleaseHash: HASH, entries }))
      .rejects.toThrow(/数组长度越界/)
  })
})
