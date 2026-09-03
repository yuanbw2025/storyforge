import type { ProductRuntimePackageV1 } from '../types'

export const PRODUCT_COMMERCIAL_MEDIA_POLICY_V2 = Object.freeze({
  policyId: 'storyforge.product-media-commercial.v2',
  policyVersion: '2',
  maximumImageBytes: 12 * 1024 * 1024,
  minimumBackgroundWidth: 1_280,
  minimumBackgroundHeight: 720,
  minimumPortraitHeight: 1_024,
  minimumUiWidth: 256,
  minimumUiHeight: 256,
  minimumAudioSampleRateHz: 44_100,
  maximumAudioSampleRateHz: 192_000,
  musicLufsMinimum: -21,
  musicLufsMaximum: -15,
  voiceLufsMinimum: -18,
  voiceLufsMaximum: -14,
  maximumTruePeakDbtp: -1,
  maximumLoopSeamDbfs: -35,
})

export interface ProductMediaQualityProbeV2 {
  assetKey: string
  status: 'decoded' | 'failed'
  decodedHasAlpha: boolean | null
  decodedChannelCount: number | null
  decodedSampleRateHz: number | null
  integratedLufs: number | null
  truePeakDbtp: number | null
  loopSeamDbfs: number | null
}

/** Returns stable machine-readable failures; an empty list is a policy pass. */
export function evaluateProductMediaCommercialPolicyV2(input: {
  runtimePackage: ProductRuntimePackageV1
  probe: ProductMediaQualityProbeV2
}): string[] {
  const policy = PRODUCT_COMMERCIAL_MEDIA_POLICY_V2
  const asset = input.runtimePackage.presentation?.assets.find(item => item.assetKey === input.probe.assetKey)
  if (!asset) return ['asset-not-in-runtime-package']
  if (input.probe.status !== 'decoded') return []
  const failures: string[] = []
  if (!asset.altText.trim()) failures.push('alt-text-missing')
  if (asset.mimeType.startsWith('image/')) {
    if (asset.byteSize > policy.maximumImageBytes) failures.push('image-byte-size-exceeded')
    if ((asset.kind === 'background' || asset.kind === 'cg')
      && (asset.width == null || asset.height == null
        || asset.width < policy.minimumBackgroundWidth || asset.height < policy.minimumBackgroundHeight)) {
      failures.push('image-background-dimensions-below-commercial-minimum')
    }
    if ((asset.kind === 'character-pose' || asset.kind === 'character-expression')
      && (asset.height == null || asset.height < policy.minimumPortraitHeight)) {
      failures.push('image-portrait-height-below-commercial-minimum')
    }
    if ((asset.kind === 'character-pose' || asset.kind === 'character-expression')
      && input.probe.decodedHasAlpha !== true) failures.push('image-character-alpha-missing')
    if ((asset.kind === 'character-pose' || asset.kind === 'character-expression')
      && !(/^(?:character:[0-9]+|intent:protagonist)$/.test(asset.characterTag))) {
      failures.push('image-character-anchor-missing')
    }
    if (asset.kind === 'ui' && (asset.width == null || asset.height == null
      || asset.width < policy.minimumUiWidth || asset.height < policy.minimumUiHeight)) {
      failures.push('image-ui-dimensions-below-commercial-minimum')
    }
  } else if (asset.mimeType.startsWith('audio/')) {
    if (input.probe.decodedChannelCount == null || input.probe.decodedChannelCount < 1
      || input.probe.decodedChannelCount > 2) failures.push('audio-channel-count-unsupported')
    if (input.probe.decodedSampleRateHz == null
      || input.probe.decodedSampleRateHz < policy.minimumAudioSampleRateHz
      || input.probe.decodedSampleRateHz > policy.maximumAudioSampleRateHz) {
      failures.push('audio-sample-rate-out-of-range')
    }
    if (input.probe.truePeakDbtp == null || input.probe.truePeakDbtp > policy.maximumTruePeakDbtp) {
      failures.push('audio-true-peak-exceeded')
    }
    if ((asset.kind === 'bgm' || asset.kind === 'ambience')
      && (input.probe.integratedLufs == null
        || input.probe.integratedLufs < policy.musicLufsMinimum
        || input.probe.integratedLufs > policy.musicLufsMaximum)) failures.push('audio-music-loudness-out-of-range')
    if (asset.kind === 'voice'
      && (input.probe.integratedLufs == null
        || input.probe.integratedLufs < policy.voiceLufsMinimum
        || input.probe.integratedLufs > policy.voiceLufsMaximum)) failures.push('audio-voice-loudness-out-of-range')
    const requiresLoop = input.runtimePackage.presentation?.cues.some(cue => (
      cue.type === 'play-audio' && cue.assetKey === asset.assetKey && cue.loop === true
    )) === true
    if (requiresLoop && (input.probe.loopSeamDbfs == null
      || input.probe.loopSeamDbfs > policy.maximumLoopSeamDbfs)) failures.push('audio-loop-seam-exceeded')
  }
  return failures.sort()
}
