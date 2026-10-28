import type { ProviderCapabilityRequirementV1 } from '../../src/lib/types'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { AVG_IMAGE_REFERENCE_CAPABILITY_V1 } from '../../src/lib/avg/media-reference-contract'
import { avgVoiceRouteBindingHashV1, type AvgAssemblyBriefV3 } from '../../src/lib/avg/voice-assembly-contract'
import { hashAvgVoiceTextV1 } from '../../src/lib/avg/voice-production-contract'
import { AVG_NATURAL_VOICE_INTENT_V1, hashAvgSpeechProtocolV1, type AvgSpeechProtocolV1 } from '../../src/lib/avg/voice-request-contract'
import { compileAvgVoiceSpeechRequestV1 } from '../../src/lib/avg/voice-request-contract'
import type { AvgRawVoicePayloadV1 } from '../../src/lib/avg/voice-raw-contract'
import { avgVoiceRightsReceiptV1, encodeAvgRawVoicePayloadV1 } from '../../src/lib/avg/voice-raw-contract'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import type { AvgAuthorWorkspaceV1 } from '../../src/lib/avg/author-workspace-contract'
import type { AvgAuthorVoiceChoiceV1 } from '../../src/lib/avg/voice-choice-contract'
import { hashAvgVoiceSourceInputV1 } from '../../src/lib/avg/voice-production-source'
import { avgSystemFixture } from './avg-system-fixture'
import { avgVoiceProductionBudgetV3, avgVoiceProductionDataClassesV3, type AvgVoiceProductionPolicyInputV3 } from '../../src/lib/avg/voice-production-policy'
import { avgVoiceAssemblyGateIdsV3 } from '../../src/lib/avg/voice-assembly-contract'

/** Inert contract fixture: no accepted Work, real service/voice rights or Run. */
export async function avgVoiceAssemblyFixtureV3(withImage = false) {
  const protocol: AvgSpeechProtocolV1 = { schema: 'storyforge.avg.speech-protocol', version: 1,
    adapterId: 'storyforge.avg.compatible-speech.v1', provider: 'fixture', model: 'speech-fixture',
    endpointRouteHash: 'a'.repeat(64), voices: [{ voiceId: 'voice-a', locales: ['zh-CN'] }], outputFormat: 'wav',
    maximumInputCharacters: 4096, supportsInstructions: false, maximumInstructionsCharacters: 0, speedRange: null }
  const capabilityHash = await hashAvgSpeechProtocolV1(protocol), text = '封口仍在。'
  const capability: ProviderCapabilityRequirementV1 = { requirementKey: 'avg.media.voice', mediaClass: 'voice', operation: 'speech',
    adapterFamily: protocol.adapterId, minimumCapabilityVersion: '1', allowedDataClasses: ['voice-script'],
    maximumRequestCost: null, maximumTotalCost: null, rightsPolicyVersion: 'avg-fixture-voice-rights.v1', capabilityHash, required: true }
  const assembly: AvgAssemblyBriefV3 = { schema: 'storyforge.avg.assembly-brief', version: 3, title: '工程合同',
    sceneKeys: ['desk'], mediaAssetKeys: ['voice.desk'], basePackageHash: null, image: null,
    voice: { protocol, binding: { requirementKey: 'avg.media.voice', adapterId: protocol.adapterId,
      endpointRouteHash: protocol.endpointRouteHash, bindingHash: await avgVoiceRouteBindingHashV1({
        requirementKey: 'avg.media.voice', adapterId: protocol.adapterId, capabilityHash, endpointRouteHash: protocol.endpointRouteHash }) },
    batch: { schema: 'storyforge.avg.voice-production-batch', version: 1, sourceInputHash: 'b'.repeat(64), outputFormat: 'wav',
      presets: [{ presetKey: 'keeper.voice', revision: 1, adapterId: protocol.adapterId, provider: protocol.provider,
        model: protocol.model, voiceId: 'voice-a', locale: 'zh-CN', endpointRouteHash: protocol.endpointRouteHash, capabilityHash,
        rights: { basis: 'provider-preset', declaration: '工程预设；不证明实际声音权利。', reference: 'fixture' } }],
      requirements: [{ requirementKey: 'keeper.line', assetKey: 'voice.desk', sceneKey: 'desk', lineKey: 'line.desk',
        speakerKey: 'keeper', locale: 'zh-CN', text, textHash: await hashAvgVoiceTextV1(text), textRevision: 1,
        script: { artifactKey: 'avg.content.scene-script.desk', version: 1, contentHash: 'c'.repeat(64) },
        presetKey: 'keeper.voice', presetRevision: 1, maximumDurationMs: 30_000,
        performance: { revision: 1, intent: AVG_NATURAL_VOICE_INTENT_V1, pronunciations: [], instructions: null, speed: null } }] } } }
  const capabilities = [capability]
  if (withImage) {
    assembly.mediaAssetKeys.push('desk.background')
    assembly.image = { imageBinding: { requirementKey: 'avg.media.image', adapterId: 'agnes.image-2.1-flash.v1',
      bindingHash: 'd'.repeat(64), endpointRouteHash: 'e'.repeat(64) }, mediaBatch: {
      schema: 'storyforge.avg.visual-production-batch', version: 1, batchKey: 'visual.fixture', revision: 1,
      aspectRatio: '16:9', sourceInputHash: 'f'.repeat(64), requirements: [{ requirementKey: 'desk.background', revision: 1,
        assetKey: 'desk.background', name: '原创工程背景', altText: '工程色块',
        family: { subjectKey: 'desk', familyKey: 'desk.day', variantKey: 'day', revision: 1 },
        consumer: { consumerKey: 'desk.background', domain: 'stage', slot: 'background', subjectKey: 'desk', sceneKey: 'desk',
          lineKey: null, required: true, fallback: 'none' }, triggerBeatKey: 'line.desk', itemVariantKey: null,
        mediaKind: 'background', prompt: '原创工程房间', negativePrompt: '', invariants: [], forbiddenDepictions: [],
        width: 576, height: 324, resolutionTier: '1K', alpha: 'not-required', references: [] }] } }
    capabilities.push({ requirementKey: 'avg.media.image', mediaClass: 'image', operation: 'generate', adapterFamily: 'agnes',
      minimumCapabilityVersion: '1', allowedDataClasses: ['image-prompt'], maximumRequestCost: null, maximumTotalCost: null,
      rightsPolicyVersion: 'avg-fixture-image-rights.v1', capabilityHash: await hashProductProductionValueV2(AVG_IMAGE_REFERENCE_CAPABILITY_V1), required: true })
  }
  return { assembly, capabilities }
}

/** Pure policy fixture, deliberately no fabricated WorldRelease/Work/Run. */
export async function avgVoicePolicyFixtureV3(withImage = false): Promise<AvgVoiceProductionPolicyInputV3> {
  const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3(withImage)
  return { intent: { productType: 'avg' }, qualityProfile: 'prototype', avgAssembly: assembly,
    capabilityRequirements: capabilities, productionBudget: avgVoiceProductionBudgetV3(assembly),
    consultationBudget: { maximumModelCalls: 0, maximumInputTokens: 0, maximumOutputTokens: 0, maximumCostUsd: 0 },
    media: { visualLevel: withImage ? 'key-scenes' : 'none', audioLevel: 'full', imageCount: withImage ? 1 : 0,
      musicTrackCount: 0, sfxCount: 0, voiceLineCount: assembly.voice.batch.requirements.length,
      requiredMediaKinds: withImage ? ['background', 'voice'] : ['voice'] },
    externalDataPolicy: { allowedDataClasses: avgVoiceProductionDataClassesV3(assembly), forbiddenDataClasses: [],
      allowReferenceImages: false, allowVoiceScripts: true },
    fallbackPolicy: { allowTextOnly: false, allowExistingProjectMedia: true, allowProceduralAudio: false, onRequiredCapabilityMissing: 'pause' },
    completionContract: { requiresPlayablePreview: true, requiredGateIds: avgVoiceAssemblyGateIdsV3(assembly), minimumMediaCoverage: 1, allowSoftWaivers: false } }
}

/** Metadata-only raw fixture. No Blob, provider or decoder claim is verified. */
export async function avgRawVoiceFixtureV1() {
  const { assembly, capabilities } = await avgVoiceAssemblyFixtureV3()
  const requirement = assembly.voice.batch.requirements[0]!, preset = assembly.voice.batch.presets[0]!, capability = capabilities[0]!
  const request = await compileAvgVoiceSpeechRequestV1(assembly.voice.batch, requirement.requirementKey, assembly.voice.protocol)
  const payload: AvgRawVoicePayloadV1 = { schema: 'storyforge.avg.raw-voice', version: 1, sourceInputHash: assembly.voice.batch.sourceInputHash,
    requirement, preset, request, capabilityBindingHash: assembly.voice.binding.bindingHash,
    measurement: { decoder: 'storyforge.avg.pcm16-browser.v1', contentHash: 'f'.repeat(64), mimeType: 'audio/wav', byteSize: 48_044,
      durationMs: 1000, channelCount: 1, sourceSampleRateHz: 24_000, decodedSampleRateHz: 48_000, sampleCount: 24_000,
      integratedLufs: -18, truePeakDbtp: -12 },
    provider: { providerRequestId: 'fixture.request.1', executionLocation: 'browser-direct', usage: null, costUsd: null },
    rights: { origin: 'generated', basis: 'provider-preset', presetKey: preset.presetKey, presetRevision: preset.revision,
      declaration: preset.rights.declaration, reference: preset.rights.reference, rightsPolicyVersion: capability.rightsPolicyVersion,
      requiresProviderTermsReview: true, commercialUse: null } }
  const asset: FrozenRuntimeMediaAssetV2 = { assetKey: 'voice.desk', version: 1, kind: 'voice', name: '配音 · line.desk', altText: '配音 · line.desk',
    mimeType: 'audio/wav', contentHash: 'f'.repeat(64), blobContentHash: 'f'.repeat(64), byteSize: 48_044, width: null, height: null,
    durationMs: 1000, source: 'fixture:storyforge.avg.compatible-speech.v1', license: 'rights-policy:avg-fixture-voice-rights.v1', characterTag: 'keeper', sceneTag: 'desk' }
  const row = { artifactKey: 'avg.voice.raw.keeper.line', kind: 'audio' as const, mediaKind: 'voice' as const,
    payloadJson: JSON.stringify(await encodeAvgRawVoicePayloadV1(payload)), metadataJson: JSON.stringify(asset), rightsJson: JSON.stringify(await avgVoiceRightsReceiptV1(payload.rights)),
    contentHash: 'f'.repeat(64), mimeType: 'audio/wav', byteSize: 48_044 }
  return { assembly, capability, payload, asset, row }
}

export async function avgVoiceConfigurationFixtureV1() {
  const { assembly, asset } = await avgRawVoiceFixtureV1(), systemPlan = avgSystemFixture()
  const workspace: AvgAuthorWorkspaceV1 = { schema: 'storyforge.avg.author-workspace', version: 1, basePreviewHash: null, systemPlan,
    scripts: systemPlan.scenes.map(scene => ({ schema: 'storyforge.avg.scene-script', version: 1, sceneKey: scene.key,
      lines: [{ lineKey: `line.${scene.key}`, beatKey: `line.${scene.key}`, speakerKey: scene.key === 'desk' ? 'keeper' : null,
        text: scene.key === 'desk' ? '封口仍在。' : '你等待答复。', informationKeys: [], actionKeys: [] }],
      choices: systemPlan.actions.filter(a => a.fromSceneKey === scene.key).map(a => ({ choiceKey: a.key, actionKey: a.key, text: a.label })) })),
    presentation: { schema: 'storyforge.avg.author-stage', version: 1, aspectRatio: '16:9', stage: { version: 1, cues: [], assets: [] },
      reading: { schema: 'storyforge.avg.reading-plan', version: 1, manualVoice: 'wait', voiceFailure: 'pause', maximumVoiceWaitMs: 30_000, autoDelayMs: 800, voices: [] } } }
  const script = workspace.scripts.find(s => s.sceneKey === 'desk')!
  const source = { artifactKey: 'avg.content.scene-script.desk', version: 1, contentHash: await hashProductProductionValueV2(script), payload: script }
  assembly.sceneKeys = systemPlan.scenes.map(s => s.key)
  assembly.voice.batch.sourceInputHash = await hashAvgVoiceSourceInputV1(workspace)
  assembly.voice.batch.requirements[0]!.script.contentHash = source.contentHash
  const request = await compileAvgVoiceSpeechRequestV1(assembly.voice.batch, 'keeper.line', assembly.voice.protocol)
  const choice: AvgAuthorVoiceChoiceV1 = { schema: 'storyforge.avg.voice-choice', version: 1, requirementKey: 'keeper.line', requestIdentityHash: request.identityHash,
    raw: { artifactKey: 'avg.voice.raw.keeper.line', version: 1, contentHash: asset.contentHash },
    review: { artifactKey: 'avg.review.audio.keeper.line', version: 1, contentHash: 'd'.repeat(64) }, asset,
    declaration: '工程配置候选；不证明真实 producer、Work 或作者采用。' }
  return { workspace, assembly, sourceScripts: [source], choices: [choice] }
}
