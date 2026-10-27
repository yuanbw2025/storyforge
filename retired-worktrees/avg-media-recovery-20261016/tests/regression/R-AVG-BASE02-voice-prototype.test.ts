import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { isAvgAuthorPrototypeBriefV1 } from '../../src/lib/avg/prototype-contract'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { encodeAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { prepareNativeAvgAssembly } from '../helpers/avg-production-assembly-fixture'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

async function brief(withImage: boolean) {
  const owner = await prepareNativeAvgAssembly(), policy = await avgVoicePolicyFixtureV3(withImage)
  const base = parseProductProductionBriefV3(owner.details.brief!.briefJson)
  return parseProductProductionBriefV3({ ...base, ...policy, intent: { ...base.intent, ...policy.intent },
    avgAssembly: await encodeAvgStoredAssemblyBriefV3(policy.avgAssembly) })
}

describe('AVG native prototype qualification for stored generated-voice briefs', () => {
  // Structural qualification only. No playthrough, media measurement or
  // release is invented by these fixtures; actual browser proof is separate.
  it.each([false, true])('recognizes the strict stored voice policy (with image %s), retaining all source/audio/author gates', async withImage => {
    const value = await brief(withImage)
    expect(isAvgAuthorPrototypeBriefV1(value)).toBe(true)
    expect(value.completionContract.requiredGateIds).toContain('avg.voice.review.recorded.keeper.line')
  })

  it('refuses internal/commercial/other-product paths, missing consent/review and extra calls without qualifying a prototype', async () => {
    const value = await brief(true)
    for (const mutate of [
      (b: typeof value) => { b.qualityProfile = 'internal' },
      (b: typeof value) => { b.qualityProfile = 'commercial-candidate' },
      (b: typeof value) => { b.intent.productType = 'character-chat' },
      (b: typeof value) => { b.externalDataPolicy.allowVoiceScripts = false },
      (b: typeof value) => { b.productionBudget.maximumModelCalls++ },
      (b: typeof value) => { b.fallbackPolicy.allowTextOnly = true },
      (b: typeof value) => { b.completionContract.allowSoftWaivers = true },
      (b: typeof value) => { b.completionContract.requiredGateIds = b.completionContract.requiredGateIds.filter(g => !g.startsWith('avg.voice.review.')) },
      (b: typeof value) => { b.capabilityRequirements = [] },
      (b: typeof value) => { if (b.avgAssembly?.version === 3) b.avgAssembly.voice.encoding = 'opaque' as never },
    ]) {
      const changed = structuredClone(value); mutate(changed)
      expect(isAvgAuthorPrototypeBriefV1(changed)).toBe(false)
    }
    expect(await db.productQualityGateReceipts.count()).toBe(0)
    expect(await db.productReleases.count()).toBe(0)
  })
})
