import type { ProductRuntimePackageV1 } from '../types'

export interface ProductFirstInteractiveResourcePlanV1 {
  schema: 'storyforge.product-first-interactive-resource-plan'
  version: 1
  strategy: 'text-adventure-entry-scene' | 'conservative-all-media'
  manifestBytes: number
  mediaBytes: number
  assetKeys: string[]
  totalBytes: number
}

export interface ProductProgressiveMediaRequestV1 {
  generation: number
  assetKeys: string[]
}

/**
 * Track progressive reads across scene changes without confusing them with a
 * session/source change. A late request from the same immutable source may be
 * cached safely; a request from an older source generation is ignored. Failed
 * keys are released so reopening the scene can retry them.
 */
export function createProductProgressiveMediaRequestLedgerV1() {
  let generation = 0
  const claimedKeys = new Set<string>()
  return {
    reset(): number {
      generation += 1
      claimedKeys.clear()
      return generation
    },
    begin(assetKeys: string[]): ProductProgressiveMediaRequestV1 {
      const pending = [...new Set(assetKeys)].filter(assetKey => !claimedKeys.has(assetKey))
      pending.forEach(assetKey => claimedKeys.add(assetKey))
      return { generation, assetKeys: pending }
    },
    settle(request: ProductProgressiveMediaRequestV1, failedAssetKeys: string[] = []): boolean {
      if (request.generation !== generation) return false
      failedAssetKeys.forEach(assetKey => claimedKeys.delete(assetKey))
      return true
    },
  }
}

/**
 * Match the text-adventure player's visible scene illustration selection.
 * The player renders at most one product-owned background/CG in its reading
 * surface. Character portraits are loaded only when the author/player opens
 * the character panel and therefore are not part of the first interaction.
 */
export function textAdventureSceneMediaAssetKeysV1(
  runtimePackage: ProductRuntimePackageV1,
  nodeKey: string,
): string[] {
  if (runtimePackage.productType !== 'text-adventure' || !runtimePackage.presentation) return []
  const presentation = runtimePackage.presentation
  const beatKeys = new Set(runtimePackage.narrative.beats
    .filter(beat => beat.nodeKey === nodeKey)
    .map(beat => beat.beatKey))
  const assetByKey = new Map(presentation.assets.map(asset => [asset.assetKey, asset]))
  const referencedIllustration = presentation.cues
    .filter(cue => beatKeys.has(cue.beatKey) && cue.assetKey)
    .map(cue => assetByKey.get(cue.assetKey!))
    .find(asset => asset?.kind === 'background' || asset?.kind === 'cg')
  const fallbackIllustration = presentation.assets
    .find(asset => asset.kind === 'background' || asset.kind === 'cg')
  const selected = referencedIllustration ?? fallbackIllustration
  return selected ? [selected.assetKey] : []
}

/**
 * Compute the immutable resources needed to render the first playable state.
 *
 * The preview manifest is always counted in full because the current local
 * runtime verifies and parses that complete JSON before creating a session.
 * Text adventure then adds only the entry scene image selected by the real
 * player. Other products remain conservative until their own progressive
 * loading contract is proven; for them every frozen media asset is counted.
 */
export function createProductFirstInteractiveResourcePlanV1(input: {
  previewManifestJson: string
  runtimePackage: ProductRuntimePackageV1
}): ProductFirstInteractiveResourcePlanV1 {
  const manifestBytes = new TextEncoder().encode(input.previewManifestJson).byteLength
  const assets = input.runtimePackage.presentation?.assets ?? []
  const textAdventure = input.runtimePackage.productType === 'text-adventure'
  const assetKeys = textAdventure
    ? textAdventureSceneMediaAssetKeysV1(
        input.runtimePackage,
        input.runtimePackage.narrative.entryNodeKey,
      )
    : assets.map(asset => asset.assetKey)
  const selectedKeys = new Set(assetKeys)
  const mediaBytes = assets
    .filter(asset => selectedKeys.has(asset.assetKey))
    .reduce((sum, asset) => sum + asset.byteSize, 0)
  return {
    schema: 'storyforge.product-first-interactive-resource-plan',
    version: 1,
    strategy: textAdventure ? 'text-adventure-entry-scene' : 'conservative-all-media',
    manifestBytes,
    mediaBytes,
    assetKeys,
    totalBytes: manifestBytes + mediaBytes,
  }
}

export function assertProductFirstInteractiveMeasurementV1(input: {
  firstInteractiveBytes: number
  firstInteractiveAssetKeys?: string[]
  expected: ProductFirstInteractiveResourcePlanV1
}): void {
  const keys = input.firstInteractiveAssetKeys
  if (input.firstInteractiveBytes !== input.expected.totalBytes
    || !keys
    || keys.length !== input.expected.assetKeys.length
    || keys.some((key, index) => key !== input.expected.assetKeys[index])) {
    throw new Error('[product-browser-performance] 首次可交互资源测量与当前 Build 不一致')
  }
}
