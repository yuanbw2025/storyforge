import { describe, expect, it } from 'vitest'
import {
  cloneTtrpgNarrativeMemoriesForBranchV1,
  isTtrpgNarrativeMemoryRuleEligibleV1,
  markTtrpgNarrativeMemoryStaleV1,
  parseTtrpgNarrativeMemoryV1,
  recallTtrpgNarrativeMemoryV1,
  recordTtrpgNarrativeMemoryV1,
  type TtrpgNarrativeMemoryV1,
} from '../../src/lib/ttrpg/narrative-memory'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

function memory(
  overrides: Partial<TtrpgNarrativeMemoryV1> = {},
): TtrpgNarrativeMemoryV1 {
  return {
    projectId: 1,
    worldGroupId: 2,
    worldId: 3,
    workId: 4,
    sessionId: 10,
    revisionKey: 'memory.session-10.1',
    observerKey: null,
    reliability: 'observed',
    audience: 'public',
    knownBy: [],
    summary: '队伍在潮门外发现了旧船。',
    fromEventSequence: 1,
    toEventSequence: 2,
    sourceSessionId: null,
    derivedFromHash: HASH_A,
    stale: false,
    updatedAt: 100,
    ...overrides,
  }
}

describe('R-TTRPGOPEN9 narrative memory rollback', () => {
  it('parses the closed contract and rejects reliability, observer, audience, and interval counterexamples', () => {
    expect(parseTtrpgNarrativeMemoryV1(memory())).toEqual(memory())
    expect(parseTtrpgNarrativeMemoryV1(memory({ reliability: 'hearsay', observerKey: 'npc:warden' }))).toEqual(
      memory({ reliability: 'hearsay', observerKey: 'npc:warden' }),
    )
    expect(parseTtrpgNarrativeMemoryV1(memory({ reliability: 'belief', observerKey: 'actor:hero' }))).toEqual(
      memory({ reliability: 'belief', observerKey: 'actor:hero' }),
    )

    expect(() => parseTtrpgNarrativeMemoryV1({
      ...memory(),
      reliability: 'rumor',
    })).toThrow()
    expect(() => parseTtrpgNarrativeMemoryV1({
      ...memory(),
      reliability: 'belief',
      observerKey: null,
    })).toThrow()
    expect(() => parseTtrpgNarrativeMemoryV1({
      ...memory(),
      audience: 'private',
      knownBy: [],
    })).toThrow()
    expect(() => parseTtrpgNarrativeMemoryV1({
      ...memory(),
      fromEventSequence: 4,
      toEventSequence: 3,
    })).toThrow()
    expect(() => parseTtrpgNarrativeMemoryV1({
      ...memory(),
      unexpected: true,
    })).toThrow()
  })

  it('records pure clones and enforces current lineage, range, and unique revision keys', () => {
    const original = memory()
    const recorded = recordTtrpgNarrativeMemoryV1({
      memory: original,
      currentEventSequence: 2,
      sourceLineageHash: HASH_A,
    })
    expect(recorded).toEqual(original)
    expect(recorded).not.toBe(original)
    expect(recorded.knownBy).not.toBe(original.knownBy)

    const batch = recordTtrpgNarrativeMemoryV1([original], memory({
      revisionKey: 'memory.session-10.2',
      fromEventSequence: 3,
      toEventSequence: 4,
    }))
    expect(batch.map(item => item.revisionKey)).toEqual([
      'memory.session-10.1',
      'memory.session-10.2',
    ])
    expect(() => recordTtrpgNarrativeMemoryV1({
      memory: memory({ toEventSequence: 3 }),
      currentEventSequence: 2,
    })).toThrow()
    expect(() => recordTtrpgNarrativeMemoryV1({
      memory: memory({ derivedFromHash: HASH_B }),
      sourceLineageHash: HASH_A,
    })).toThrow()
    expect(() => recordTtrpgNarrativeMemoryV1([original], original)).toThrow()
    expect(() => recordTtrpgNarrativeMemoryV1(memory({ stale: true }))).toThrow()
  })

  it('filters recalled memories by audience, knownBy, session, hash, and complete event range', () => {
    const memories = [
      memory({ revisionKey: 'memory.public', summary: '公开事实' }),
      memory({
        revisionKey: 'memory.party',
        audience: 'party',
        fromEventSequence: 3,
        toEventSequence: 4,
        summary: '队伍都知道的记忆',
      }),
      memory({
        revisionKey: 'memory.private.hero',
        audience: 'private',
        knownBy: ['actor:hero'],
        fromEventSequence: 5,
        toEventSequence: 5,
        summary: '英雄私下听到的消息',
      }),
      memory({
        revisionKey: 'memory.gm',
        audience: 'gm-only',
        fromEventSequence: 1,
        toEventSequence: 1,
        summary: '主持人私有记忆',
      }),
      memory({
        revisionKey: 'memory.stale',
        stale: true,
        summary: '回退后的旧摘要',
      }),
      memory({
        revisionKey: 'memory.other-session',
        sessionId: 11,
        summary: '另一局记忆',
      }),
    ]

    expect(recallTtrpgNarrativeMemoryV1(memories, {
      audience: 'party',
      sessionId: 10,
      eventSequence: 4,
      derivedFromHash: HASH_A,
    }).map(item => item.revisionKey)).toEqual([
      'memory.public',
      'memory.party',
    ])
    expect(recallTtrpgNarrativeMemoryV1(memories, {
      audience: 'private',
      actorKey: 'actor:hero',
      sessionId: 10,
      eventSequence: 5,
    }).map(item => item.revisionKey)).toEqual([
      'memory.public',
      'memory.party',
      'memory.private.hero',
    ])
    expect(recallTtrpgNarrativeMemoryV1(memories, {
      audience: 'private',
      actorKey: 'actor:other',
      sessionId: 10,
      eventSequence: 5,
    }).map(item => item.revisionKey)).toEqual(['memory.public', 'memory.party'])
    expect(recallTtrpgNarrativeMemoryV1(memories, {
      audience: 'gm-only',
      sessionId: 10,
      eventSequence: 5,
    })).toHaveLength(4)
    expect(recallTtrpgNarrativeMemoryV1(memories, {
      audience: 'party',
      sessionId: 10,
      eventSequence: 3,
      derivedFromHash: HASH_B,
    })).toEqual([])
    expect(recallTtrpgNarrativeMemoryV1({
      memories,
      viewer: { audience: 'gm-only', sessionId: 10, fromEventSequence: 1, toEventSequence: 1 },
    }).map(item => item.revisionKey)).toEqual(['memory.gm'])
  })

  it('marks rollback and lineage overflow stale, keeps the operation pure, and never treats belief as rule evidence', () => {
    const before = memory({ revisionKey: 'memory.before', fromEventSequence: 1, toEventSequence: 2 })
    const crossing = memory({ revisionKey: 'memory.crossing', fromEventSequence: 2, toEventSequence: 4 })
    const after = memory({ revisionKey: 'memory.after', fromEventSequence: 5, toEventSequence: 6 })
    const changedLineage = memory({ revisionKey: 'memory.lineage', derivedFromHash: HASH_B })
    const source = [before, crossing, after, changedLineage]
    const marked = markTtrpgNarrativeMemoryStaleV1(source, {
      checkpointSequence: 3,
      derivedFromHash: HASH_A,
      updatedAt: 200,
    })

    expect(source.every(item => item.stale === false)).toBe(true)
    expect(marked.map(item => [item.revisionKey, item.stale, item.updatedAt])).toEqual([
      ['memory.before', false, 100],
      ['memory.crossing', true, 200],
      ['memory.after', true, 200],
      ['memory.lineage', true, 200],
    ])
    expect(recallTtrpgNarrativeMemoryV1(marked, {
      audience: 'public',
      sessionId: 10,
      eventSequence: 3,
      derivedFromHash: HASH_A,
    }).map(item => item.revisionKey)).toEqual(['memory.before'])

    const belief = memory({
      revisionKey: 'memory.belief',
      reliability: 'belief',
      observerKey: 'actor:hero',
    })
    expect(recallTtrpgNarrativeMemoryV1([belief], { audience: 'public' })).toHaveLength(1)
    expect(isTtrpgNarrativeMemoryRuleEligibleV1(belief)).toBe(false)
    expect(isTtrpgNarrativeMemoryRuleEligibleV1(before)).toBe(false)
    expect(isTtrpgNarrativeMemoryRuleEligibleV1(memory({ reliability: 'hearsay', observerKey: 'actor:hero' }))).toBe(false)
  })

  it('clones only complete records at or before a branch cut point and keeps ancestor source evidence', () => {
    const inherited = memory({
      revisionKey: 'memory.inherited',
      fromEventSequence: 1,
      toEventSequence: 3,
    })
    const crossing = memory({
      revisionKey: 'memory.crossing',
      fromEventSequence: 3,
      toEventSequence: 4,
    })
    const future = memory({
      revisionKey: 'memory.future',
      fromEventSequence: 5,
      toEventSequence: 5,
    })
    const cloned = cloneTtrpgNarrativeMemoriesForBranchV1({
      memories: [inherited, crossing, future],
      childSessionId: 20,
      throughSequence: 3,
    })

    expect(cloned.map(item => item.revisionKey)).toEqual(['memory.inherited'])
    expect(cloned[0]).toMatchObject({
      sessionId: 20,
      sourceSessionId: 10,
      fromEventSequence: 1,
      toEventSequence: 3,
    })
    expect(cloned[0]).not.toHaveProperty('id')
    expect(recallTtrpgNarrativeMemoryV1(cloned, {
      audience: 'public',
      sessionId: 20,
      eventSequence: 3,
    })).toHaveLength(1)
    expect(recallTtrpgNarrativeMemoryV1([
      ...cloned,
      crossing,
    ], {
      audience: 'public',
      sessionId: 20,
      eventSequence: 3,
    })).toHaveLength(1)
  })
})
