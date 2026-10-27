import { describe, expect, it } from 'vitest'
import { avgVoicePolicyFixtureV3 } from '../helpers/avg-voice-production-fixture'
import { encodeAvgStoredAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-storage'
import { assertAvgImageProductionDefinitionV3, readAvgImageDefinitionV3 } from '../../src/lib/avg/media-production-definition'
import { avgVisualProductionBudgetV2, avgVisualProductionDataClassesV2 } from '../../src/lib/avg/media-production-policy'
import { avgMediaAssemblyGateIdsV2 } from '../../src/lib/avg/assembly-contract'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

/** Policy/metadata only: no fake accepted Work, Build, producer or media. */
async function mixed() {
  const policy = await avgVoicePolicyFixtureV3(true)
  return { ...policy, avgAssembly: await encodeAvgStoredAssemblyBriefV3(policy.avgAssembly) }
}

describe('AVG BASE-02 combined image metadata keeps full stored authority', () => {
  it('selects image by its registered key when voice is first, without mutating the full stored contract', async () => {
    const brief = await mixed(), hash = await hashProductProductionValueV2(brief), before = JSON.stringify(brief)
    expect(brief.capabilityRequirements[0]!.mediaClass).toBe('voice')
    const selected = await assertAvgImageProductionDefinitionV3(brief)
    expect(selected.capability.requirementKey).toBe('avg.media.image')
    expect(selected.capability.allowedDataClasses).toEqual(['image-prompt'])
    expect(selected.assembly.mediaBatch.requirements[0]!.mediaKind).toBe('background')
    expect(JSON.stringify(brief)).toBe(before)
    expect(await hashProductProductionValueV2(brief)).toBe(hash)
    expect(await hashProductProductionValueV2({ ...brief, avgAssembly: selected.assembly })).not.toBe(hash)
    brief.capabilityRequirements.reverse()
    expect((await assertAvgImageProductionDefinitionV3(brief)).capability).toEqual(selected.capability)
  })

  it('verifies the exact voice packet and binding before allowing image metadata, beyond structural decoding', async () => {
    const brief = await mixed()
    brief.avgAssembly.voice.contentHash = '0'.repeat(64)
    expect(readAvgImageDefinitionV3(brief).version).toBe(2)
    await expect(assertAvgImageProductionDefinitionV3(brief)).rejects.toThrow(/hash/)
  })

  it('refuses malformed stored payloads and voice-only Briefs instead of manufacturing an image route', async () => {
    const policy = await avgVoicePolicyFixtureV3()
    const stored = { ...policy, avgAssembly: await encodeAvgStoredAssemblyBriefV3(policy.avgAssembly) }
    expect(() => readAvgImageDefinitionV3(stored)).toThrow(/图片生产定义/)
    await expect(assertAvgImageProductionDefinitionV3(stored)).rejects.toThrow(/图片生产定义/)
    // Unknown input is rejected by the same strict stored parser; it does not
    // gain a capability or authority through a decoded semantic proposal.
    const mixedPolicy = await avgVoicePolicyFixtureV3(true)
    expect(() => readAvgImageDefinitionV3({ avgAssembly: { ...stored.avgAssembly,
      voice: { ...stored.avgAssembly.voice, payloadJson: JSON.stringify(mixedPolicy.avgAssembly.voice) } } })).toThrow()
  })

  it('keeps voice consent, image capabilities and the combined budget mandatory for an image operation', async () => {
    const base = await mixed()
    for (const mutate of [
      (b: typeof base) => { b.externalDataPolicy.allowVoiceScripts = false },
      (b: typeof base) => { b.externalDataPolicy.allowedDataClasses = ['voice-script'] },
      (b: typeof base) => { b.capabilityRequirements.find(c => c.mediaClass === 'image')!.allowedDataClasses = ['voice-script'] },
      (b: typeof base) => { b.capabilityRequirements = b.capabilityRequirements.filter(c => c.mediaClass !== 'image') },
      (b: typeof base) => { b.productionBudget.maximumMediaCalls = 1 },
      (b: typeof base) => { b.completionContract.requiredGateIds = b.completionContract.requiredGateIds.filter(k => !k.startsWith('avg.voice.')) },
    ]) {
      const brief = structuredClone(base); mutate(brief)
      await expect(assertAvgImageProductionDefinitionV3(brief)).rejects.toThrow()
    }
  })

  it('keeps the established image-only policy and assembly bytes on the V2 path', async () => {
    const brief = await mixed(), image = readAvgImageDefinitionV3(brief)
    const imageBrief = { ...brief, avgAssembly: image,
      capabilityRequirements: brief.capabilityRequirements.filter(c => c.mediaClass === 'image'),
      productionBudget: avgVisualProductionBudgetV2(image.mediaBatch.requirements.length),
      externalDataPolicy: { ...brief.externalDataPolicy, allowedDataClasses: avgVisualProductionDataClassesV2(image), allowVoiceScripts: false },
      completionContract: { ...brief.completionContract, requiredGateIds: avgMediaAssemblyGateIdsV2(image.mediaBatch, image.imageProcessing) } }
    const before = JSON.stringify(imageBrief), selected = await assertAvgImageProductionDefinitionV3(imageBrief)
    expect(selected.assembly).toBe(image)
    expect(JSON.stringify(imageBrief)).toBe(before)
    imageBrief.capabilityRequirements.push(brief.capabilityRequirements.find(c => c.mediaClass === 'voice')!)
    await expect(assertAvgImageProductionDefinitionV3(imageBrief)).rejects.toThrow(/唯一/)
  })
})
