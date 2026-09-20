import type {
  FrozenRuntimeMediaAssetV2,
  TextOpenWorldParsedModulesV1,
} from '../types'

export interface TextOpenWorldPlayerMediaVisualV1 {
  slotKey: string
  assetKey: string | null
  url: string | null
  altText: string
  fallbackText: string
}

export interface TextOpenWorldPlayerMediaProjectionV1 {
  currentLocationBackground: TextOpenWorldPlayerMediaVisualV1 | null
  backgroundByLocationKey: Record<string, TextOpenWorldPlayerMediaVisualV1>
  portraitByActorKey: Record<string, TextOpenWorldPlayerMediaVisualV1>
  degradedSlotKeys: string[]
}

/**
 * Joins the immutable presentation module with the outer RuntimePackage media
 * catalog. The projection never guesses semantic owners from asset filenames;
 * legacy inference, when possible, is confined to the module parser.
 */
export function projectTextOpenWorldPlayerMediaV1(input: {
  modules: TextOpenWorldParsedModulesV1
  assets: readonly FrozenRuntimeMediaAssetV2[]
  urls: Readonly<Record<string, string>>
  currentLocationKey: string
}): TextOpenWorldPlayerMediaProjectionV1 {
  const declaredAssets = new Set(input.assets.map(asset => asset.assetKey))
  const degradedSlotKeys = new Set<string>()
  const visual = (
    slot: TextOpenWorldParsedModulesV1['presentation']['mediaSlots'][number],
  ): TextOpenWorldPlayerMediaVisualV1 => {
    const assetDeclared = slot.assetKey != null && declaredAssets.has(slot.assetKey)
    const url = assetDeclared ? input.urls[slot.assetKey!] ?? null : null
    if (slot.assetKey == null || !assetDeclared || !url) degradedSlotKeys.add(slot.key)
    return {
      slotKey: slot.key,
      assetKey: assetDeclared ? slot.assetKey : null,
      url,
      altText: slot.altText,
      fallbackText: slot.fallbackText,
    }
  }

  const backgroundByLocationKey: Record<string, TextOpenWorldPlayerMediaVisualV1> = {}
  const portraitByActorKey: Record<string, TextOpenWorldPlayerMediaVisualV1> = {}
  const orderedSlots = [...input.modules.presentation.mediaSlots].sort((left, right) => (
    Number(right.required) - Number(left.required) || left.key.localeCompare(right.key)
  ))
  for (const slot of orderedSlots) {
    if (slot.subjectKind === 'location' && slot.kind === 'background'
      && backgroundByLocationKey[slot.subjectKey] == null) {
      backgroundByLocationKey[slot.subjectKey] = visual(slot)
    }
    if (slot.subjectKind === 'actor' && slot.kind === 'portrait'
      && portraitByActorKey[slot.subjectKey] == null) {
      portraitByActorKey[slot.subjectKey] = visual(slot)
    }
  }
  return {
    currentLocationBackground: backgroundByLocationKey[input.currentLocationKey] ?? null,
    backgroundByLocationKey,
    portraitByActorKey,
    degradedSlotKeys: [...degradedSlotKeys].sort(),
  }
}
