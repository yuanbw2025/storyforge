import type { FrozenRuntimeMediaAssetV2 } from '../types'
import type { AvgSoundPlanningBriefV1 } from './sound-production-brief'
import type { AvgCompiledSoundRequirementV1 } from './sound-provider-contract'
import type { parseAvgSoundByteMeasurementV1 } from './sound-decoder'

/** Deterministic candidate envelope only; the sealed boundary must prove its
 * actual claim, source snapshot, original response, decoder and physical Blob. */
export function buildAvgRawSoundArtifactV1(input: {
  planning: AvgSoundPlanningBriefV1; scopeHash: string; planHash: string; requirement: AvgCompiledSoundRequirementV1
  measurement: ReturnType<typeof parseAvgSoundByteMeasurementV1>; providerResult: unknown
  requestSnapshotHash: string; responseEvidenceHash: string; contextHash: string
  inputs: Array<{ artifactKey: string; version: number; contentHash: string }>
}) {
  const { planning, requirement: req, measurement: m } = input, generated = req.dispatch.operation === 'generate-music'
  const rights = { origin: generated ? 'generated-local-music' : 'licensed-original-library',
    commercialUse: generated ? null : true, requiresAuthorReview: true,
    ...(req.dispatch.operation === 'import-licensed-audio' ? { source: req.dispatch.source } : { modelTermsReview: 'required' }) }
  const metadata: FrozenRuntimeMediaAssetV2 = { assetKey: req.template.assetKey, version: 1, kind: req.template.channel,
    name: `声音 · ${req.template.requirementKey}`, altText: req.template.purpose, mimeType: m.mimeType, byteSize: m.byteSize,
    contentHash: m.contentHash, blobContentHash: m.contentHash, width: null, height: null, durationMs: m.durationMs,
    source: generated ? 'storyforge-local-music:storyforge.avg.local-music.v1' : req.dispatch.operation === 'import-licensed-audio' ? req.dispatch.source.publisherPage : '',
    license: generated ? 'model-terms-review-required' : 'CC0-1.0', characterTag: '', sceneTag: req.template.consumer.sceneKey! }
  return { artifactKey: `avg.sound.raw.${req.template.requirementKey}`,
    ...(generated ? { requirementKey: 'avg.media.music' } : {}), kind: 'audio' as const, mediaKind: req.template.channel,
    payload: { schema: 'storyforge.avg.raw-sound', version: 1, sourceInputHash: planning.scope.sourceInputHash,
      scopeHash: input.scopeHash, planHash: input.planHash, requirement: req, measurement: m, providerResult: input.providerResult,
      capabilityBindingHash: generated ? planning.musicBinding!.bindingHash : null,
      requestSnapshotHash: input.requestSnapshotHash, responseEvidenceHash: input.responseEvidenceHash },
    metadata, rights, contentHash: m.contentHash, mimeType: m.mimeType, byteSize: m.byteSize,
    quality: { schema: 'storyforge.avg.raw-sound-evidence', version: 1, received: true, originalResponseRecorded: true,
      requestSnapshotHash: input.requestSnapshotHash, responseEvidenceHash: input.responseEvidenceHash, contextHash: input.contextHash,
      inputs: input.inputs, contentHashVerified: true, decoderVerified: true, hearing: 'unobserved', authorAdopted: false } }
}
