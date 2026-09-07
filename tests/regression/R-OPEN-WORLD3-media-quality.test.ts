import { describe, expect, it } from 'vitest'
import {
  evaluateTextOpenWorldMediaCoverageV1,
  verifyTextOpenWorldMediaRightsV1,
} from '../../src/lib/open-world/media-quality'
import type {
  ProductBuildArtifactRecordV1,
  ProviderCapabilityRequirementV1,
  TextOpenWorldMediaRequirementsV1,
} from '../../src/lib/types'

const HASH = 'a'.repeat(64)

function mediaArtifact(input: {
  source: string
  license: string
  commercialUse?: boolean
}): ProductBuildArtifactRecordV1 {
  return {
    artifactKey: 'text-open-world.media.visual.001', contentHash: HASH,
    requirementKey: 'media.visual', producerReceiptHash: HASH,
    metadataJson: JSON.stringify({ assetKey: 'asset.one', source: input.source, license: input.license }),
    qualityJson: JSON.stringify({ providerReceiptHash: HASH }),
    rightsJson: JSON.stringify({
      origin: input.source.startsWith('storyforge-procedural-') ? 'procedural' : 'generated',
      adapterId: input.source === 'storyforge-procedural-svg-v1'
        ? 'storyforge.procedural-svg.v1'
        : input.source === 'storyforge-procedural-audio-v1'
          ? 'storyforge.procedural-audio.v1' : input.source,
      license: input.license,
      commercialUse: input.commercialUse ?? true,
      rightsPolicyVersion: input.source.startsWith('storyforge-procedural-')
        ? undefined : 'storyforge-rights-v1',
      requiresProviderTermsReview: input.source.startsWith('storyforge-procedural-')
        ? undefined : true,
    }),
  } as ProductBuildArtifactRecordV1
}

const capability: ProviderCapabilityRequirementV1 = {
  requirementKey: 'media.visual', mediaClass: 'image', operation: 'generate',
  adapterFamily: 'test', minimumCapabilityVersion: '1', allowedDataClasses: ['prompt-text'],
  maximumRequestCost: null, maximumTotalCost: null,
  rightsPolicyVersion: 'storyforge-rights-v1', capabilityHash: HASH, required: false,
}

function requirements(): TextOpenWorldMediaRequirementsV1 {
  const slot = (input: Partial<TextOpenWorldMediaRequirementsV1['slots'][number]> & {
    key: string
    kind: TextOpenWorldMediaRequirementsV1['slots'][number]['kind']
    productionMode: TextOpenWorldMediaRequirementsV1['slots'][number]['productionMode']
    fallback: TextOpenWorldMediaRequirementsV1['slots'][number]['fallback']
  }, order: number): TextOpenWorldMediaRequirementsV1['slots'][number] => ({
    order, subjectKind: 'world', subjectKey: 'game.salt-ridge', title: input.key,
    creativeBrief: input.key, required: true,
    sourceArtifactKey: 'text-open-world.presentation-profile', sourceEntityKey: HASH,
    consumerKeys: ['play.scene'], ...input,
  })
  return {
    schema: 'storyforge.text-open-world-media-requirements', version: 1,
    productType: 'text-open-world', productInstanceKey: 'game.salt-ridge',
    presentationProfileHash: HASH, npcRuntimeCatalogHash: HASH,
    mapInteractionCatalogHash: HASH, sceneScriptsHash: HASH,
    slots: [
      slot({ key: 'media.map', kind: 'procedural-map', productionMode: 'procedural-code', fallback: 'procedural-svg' }, 1),
      slot({ key: 'media.portrait', kind: 'character-portrait', productionMode: 'generate-or-import', fallback: 'generated-placeholder' }, 2),
      slot({ key: 'media.background', kind: 'scene-background', productionMode: 'generate-or-import', fallback: 'text-description' }, 3),
    ],
    coverage: {
      requiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background'],
      coveredRequiredVisualKinds: ['procedural-map', 'character-portrait', 'scene-background'],
      requiredActorKeys: ['actor.linzho'], coveredActorKeys: ['actor.linzho'],
      requiredRegionKeys: ['region.harbor'], coveredRegionKeys: ['region.harbor'],
      requiredSlotKeys: ['media.map', 'media.portrait', 'media.background'],
      fallbackReadySlotKeys: ['media.map', 'media.portrait', 'media.background'], missingRequiredSlotKeys: [],
    },
    productionBudget: {
      requestedGeneratedSlotCount: 2, authorizedMaximumMediaCalls: 2,
      fitsAuthorizedMediaCalls: true, overflowSlotKeys: [],
    },
    governance: {
      requirementsDerivedAfterContent: true, mediaNeverBlocksTextFallback: true,
      proceduralMapRequiresNoModelCall: true, everyRequiredSlotHasFallback: true,
      rightsCheckedAtAssetAcceptance: true,
    },
    basisHash: HASH, createdAt: 1, mediaRequirementsHash: HASH,
  }
}

describe('R-OPEN-WORLD3 · 媒资权利与真实覆盖率', () => {
  it('权利证据必须和metadata一致，商业候选拒绝程序化占位', async () => {
    await expect(verifyTextOpenWorldMediaRightsV1({
      artifact: mediaArtifact({ source: 'storyforge-procedural-svg-v1', license: 'CC0-1.0' }),
      qualityProfile: 'prototype', capabilityRequirement: capability,
    })).resolves.toMatchObject({ commercialUse: true, commercialPolicyPassed: true })
    await expect(verifyTextOpenWorldMediaRightsV1({
      artifact: mediaArtifact({ source: 'storyforge-procedural-svg-v1', license: 'CC0-1.0' }),
      qualityProfile: 'commercial-candidate', capabilityRequirement: capability,
    })).rejects.toThrow(/商业候选媒资/)
    await expect(verifyTextOpenWorldMediaRightsV1({
      artifact: mediaArtifact({ source: 'trusted-relay.v1', license: 'rights-policy:storyforge-rights-v1' }),
      qualityProfile: 'commercial-candidate', capabilityRequirement: capability,
    })).resolves.toMatchObject({ commercialPolicyPassed: true })
    await expect(verifyTextOpenWorldMediaRightsV1({
      artifact: mediaArtifact({ source: 'trusted-relay.v1', license: 'rights-policy:storyforge-rights-v1', commercialUse: false }),
      qualityProfile: 'prototype', capabilityRequirement: capability,
    })).rejects.toThrow(/不可商用/)
    await expect(verifyTextOpenWorldMediaRightsV1({
      artifact: mediaArtifact({ source: 'storyforge-procedural-svg-v1', license: 'custom-license' }),
      qualityProfile: 'internal', capabilityRequirement: capability,
    })).rejects.toThrow(/CC0权利不匹配/)
    const forgedProcedural = mediaArtifact({ source: 'storyforge-procedural-svg-v1', license: 'CC0-1.0' })
    forgedProcedural.rightsJson = JSON.stringify({
      origin: 'procedural', adapterId: 'forged.procedural.v1', license: 'CC0-1.0', commercialUse: true,
    })
    await expect(verifyTextOpenWorldMediaRightsV1({
      artifact: forgedProcedural, qualityProfile: 'prototype', capabilityRequirement: capability,
    })).rejects.toThrow(/程序化媒资来源/)
  })

  it('fallback只计可玩覆盖，不能冒充商业真实资产覆盖', () => {
    const prototype = evaluateTextOpenWorldMediaCoverageV1({
      requirements: requirements(), generatedSlotKeys: ['media.portrait'],
      qualityProfile: 'prototype', minimumCoverage: 1,
    })
    expect(prototype).toMatchObject({
      playableCoverage: 1, generatedRequiredCoverage: 0.5,
      evaluatedCoverage: 1, releaseReady: true,
    })
    const commercial = evaluateTextOpenWorldMediaCoverageV1({
      requirements: requirements(), generatedSlotKeys: ['media.portrait'],
      qualityProfile: 'commercial-candidate', minimumCoverage: 1,
    })
    expect(commercial).toMatchObject({
      playableCoverage: 1, generatedRequiredCoverage: 0.5,
      evaluatedCoverage: 0.5, releaseReady: false,
    })
    const requiredFallbackOnly = requirements()
    requiredFallbackOnly.slots.find(slot => slot.key === 'media.background')!.productionMode = 'fallback-only'
    expect(evaluateTextOpenWorldMediaCoverageV1({
      requirements: requiredFallbackOnly, generatedSlotKeys: ['media.portrait'],
      qualityProfile: 'commercial-candidate', minimumCoverage: 1,
    })).toMatchObject({
      requiredGeneratedSlotCount: 2, generatedRequiredCoverage: 0.5, releaseReady: false,
    })
    expect(evaluateTextOpenWorldMediaCoverageV1({
      requirements: requirements(), generatedSlotKeys: ['media.portrait', 'media.background'],
      qualityProfile: 'commercial-candidate', minimumCoverage: 1,
    })).toMatchObject({ generatedRequiredCoverage: 1, releaseReady: true })
  })

  it('商业档把Brief已排产的可选音频也计入真实资产覆盖', () => {
    const withAudio = requirements()
    withAudio.slots.push({
      key: 'media.music', order: 4, kind: 'music', subjectKind: 'world',
      subjectKey: 'game.salt-ridge', title: '主题音乐', creativeBrief: '低沉边地弦乐',
      required: false, productionMode: 'optional-generate-or-import', fallback: 'silent',
      sourceArtifactKey: 'text-open-world.presentation-profile', sourceEntityKey: HASH,
      consumerKeys: ['play.scene'],
    })
    expect(evaluateTextOpenWorldMediaCoverageV1({
      requirements: withAudio,
      generatedSlotKeys: ['media.portrait', 'media.background'],
      qualityProfile: 'commercial-candidate', minimumCoverage: 1,
    })).toMatchObject({
      requiredGeneratedSlotCount: 3,
      generatedRequiredBindingCount: 2,
      generatedRequiredCoverage: 2 / 3,
      releaseReady: false,
    })
  })
})
