import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { parseAiTownStateV1 } from '../../src/lib/ai-town/runtime'
import { runAiTownOfflineBatchV1 } from '../../src/lib/ai-town/runtime-api'
import { readProductRuntimeState, readProductRuntimeStateVersion } from '../../src/lib/product/runtime-api'
import { seedAiTownRuntimeFixture } from '../helpers/ai-town-runtime'

describe('R-AITOWN3 · AI 小镇长周期稳定性', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('连续 14 个游戏日的离线演化仍可重放、有边界且有生活线生长', async () => {
    const seeded = await seedAiTownRuntimeFixture()
    for (let batch = 0; batch < 7; batch += 1) {
      const version = await readProductRuntimeStateVersion(seeded.session.id!)
      await runAiTownOfflineBatchV1({
        sessionId: seeded.session.id!,
        commandId: `town:longevity:offline:${batch}`,
        baseSequence: version.sequence,
        baseStateHash: version.stateHash,
        days: 2,
      })
    }
    const state = await readProductRuntimeState(seeded.session.id!)
    expect(state.town).toMatchObject({ day: 15, slot: 'morning', offlineDaysSimulated: 14 })
    expect(state.town?.dailyDigests).toHaveLength(14)
    expect(state.town?.dailyDigests.every(digest => digest.publicSummary.length > 0)).toBe(true)
    expect(Object.values(state.town?.lifeThreads ?? {}).filter(thread => thread.progress > 0).length).toBeGreaterThanOrEqual(2)
    expect(Object.values(state.town?.relationships ?? {}).some(edge => edge.evidenceSequences.length > 0)).toBe(true)
    expect(state.town?.pendingMajorChanges).toEqual([])
    expect(() => parseAiTownStateV1(state.town)).not.toThrow()

    const replayed = await readProductRuntimeState(seeded.session.id!)
    expect(replayed).toEqual(state)
  })
})
