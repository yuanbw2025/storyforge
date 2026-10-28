import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as readiness from '../../src/lib/avg/visual-planning-brief-v5'
import { classifyAvgAuthorPrototypeBriefV1, isAvgAuthorPrototypeBriefV1, assertAvgVisualPrototypeWriteEnabledV5 } from '../../src/lib/avg/prototype-contract'
import { avgV5FormalFixture } from '../helpers/avg-v5-formal-fixture'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

describe('original V5 visual prototype classification, without legacy alias or author authority', () => {
  it('preserves the original V5 Brief and legacy predicate, independently of a closed factory', async () => {
    const s = await avgV5FormalFixture(), original = JSON.stringify(s.brief)
    const ready = vi.spyOn(readiness, 'avgVisualPlanningExecutionReadyV5').mockReturnValue(false)
    expect(classifyAvgAuthorPrototypeBriefV1(s.brief)).toBe('visual-v5')
    expect(isAvgAuthorPrototypeBriefV1(s.brief)).toBe(false); expect(s.brief.avgAssembly).toBeUndefined()
    expect(JSON.stringify(s.brief)).toBe(original)
    expect(() => assertAvgVisualPrototypeWriteEnabledV5()).toThrow('尚未启用')
    ready.mockReturnValue(true); expect(() => assertAvgVisualPrototypeWriteEnabledV5()).not.toThrow()
    expect(await db.productQualityGateReceipts.count()).toBe(0); expect(await db.productReleases.count()).toBe(0)
  })
  it('refuses old/mixed/other/commercial, missing exact image/reference policy, budget or review gates', async () => {
    const s = await avgV5FormalFixture()
    for (const mutate of [
      (b: typeof s.brief) => { b.qualityProfile = 'internal' },
      (b: typeof s.brief) => { b.qualityProfile = 'commercial-candidate' },
      (b: typeof s.brief) => { b.intent.productType = 'character-chat' },
      (b: typeof s.brief) => { b.avgAssembly = b.avgVisualPlanning.assembly },
      (b: typeof s.brief) => { Object.assign(b.avgVisualPlanning, { version: 4 }) },
      (b: typeof s.brief) => { Object.assign(b, { avgSoundPlanning: {} }) },
      (b: typeof s.brief) => { Object.assign(b.avgVisualPlanning, { imageBinding: null }) },
      (b: typeof s.brief) => { Object.assign(b.avgVisualPlanning.scope.referenceCatalog[0].reference, { contentPolicy: null }) },
      (b: typeof s.brief) => { b.capabilityRequirements = [] },
      (b: typeof s.brief) => { b.productionBudget.maximumModelCalls++ },
      (b: typeof s.brief) => { b.fallbackPolicy.allowTextOnly = true },
      (b: typeof s.brief) => { b.completionContract.allowSoftWaivers = true },
      (b: typeof s.brief) => { b.completionContract.requiredGateIds = [] },
    ]) { const changed = structuredClone(s.brief); mutate(changed); expect(classifyAvgAuthorPrototypeBriefV1(changed)).toBeNull() }
    expect(await db.productQualityGateReceipts.count()).toBe(0); expect(await db.productReleases.count()).toBe(0)
  })
})
