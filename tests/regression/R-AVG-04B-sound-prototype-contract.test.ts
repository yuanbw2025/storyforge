import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as readiness from '../../src/lib/avg/sound-production-brief'
import { classifyAvgAuthorPrototypeBriefV1, isAvgAuthorPrototypeBriefV1, assertAvgSoundPrototypeWriteEnabledV1 } from '../../src/lib/avg/prototype-contract'
import { avgSoundProductionFixtureV1 } from '../helpers/avg-sound-production-fixture'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

describe('original Sound prototype policy, without an avgAssembly alias or acceptance', () => {
  it.each([false, true])('classifies the exact prototype policy (library only %s) without changing the original Brief or granting the legacy field', async libraryOnly => {
    const s = await avgSoundProductionFixtureV1(libraryOnly), before = JSON.stringify(s.brief)
    expect(classifyAvgAuthorPrototypeBriefV1(s.brief)).toBe('sound')
    expect(isAvgAuthorPrototypeBriefV1(s.brief)).toBe(false)
    expect(s.brief.avgAssembly).toBeUndefined()
    expect(JSON.stringify(s.brief)).toBe(before)
    expect(classifyAvgAuthorPrototypeBriefV1(s.legacy)).toBe('assembly')
    expect(await db.productQualityGateReceipts.count()).toBe(0)
    expect(await db.productReleases.count()).toBe(0)
  })
  it('refuses mixed/other product, internal/commercial, missing exact route, source, budget and review gates', async () => {
    const s = await avgSoundProductionFixtureV1()
    for (const mutate of [
      (b: typeof s.brief) => { b.qualityProfile = 'internal' },
      (b: typeof s.brief) => { b.qualityProfile = 'commercial-candidate' },
      (b: typeof s.brief) => { b.intent.productType = 'character-chat' },
      (b: typeof s.brief) => { b.avgAssembly = s.legacy.avgAssembly },
      (b: typeof s.brief) => { b.avgSoundPlanning!.musicBinding = null },
      (b: typeof s.brief) => { b.avgSoundPlanning!.assembly.mediaAssetKeys = [] },
      (b: typeof s.brief) => { b.capabilityRequirements = [] },
      (b: typeof s.brief) => { b.productionBudget.maximumModelCalls++ },
      (b: typeof s.brief) => { b.fallbackPolicy.allowProceduralAudio = true },
      (b: typeof s.brief) => { b.completionContract.allowSoftWaivers = true },
      (b: typeof s.brief) => { b.completionContract.requiredGateIds = b.completionContract.requiredGateIds.filter(g => !g.includes('review')) },
    ]) {
      const changed = structuredClone(s.brief); mutate(changed)
      expect(classifyAvgAuthorPrototypeBriefV1(changed)).toBeNull()
    }
    expect(await db.productQualityGateReceipts.count()).toBe(0)
    expect(await db.productReleases.count()).toBe(0)
  })
  it('keeps read-only classification independent from the actual default-off write fence', async () => {
    const s = await avgSoundProductionFixtureV1()
    const enabled = vi.spyOn(readiness, 'avgSoundProductionExecutionReadyV1').mockReturnValue(false)
    expect(classifyAvgAuthorPrototypeBriefV1(s.brief)).toBe('sound')
    expect(() => assertAvgSoundPrototypeWriteEnabledV1()).toThrow(/尚未启用/)
    enabled.mockReturnValue(true)
    expect(() => assertAvgSoundPrototypeWriteEnabledV1()).not.toThrow()
    expect(await db.productQualityGateReceipts.count()).toBe(0)
  })
})
