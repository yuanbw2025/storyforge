import type { ProductMediaKind } from '../types'

export interface TextAdventureVisualCompositionRoleV1 {
  mediaKind: ProductMediaKind
  sceneTag: string
}

/**
 * Minimum distinct editorial jobs for an illustrated commercial candidate.
 * Both production planning and release-quality verification consume this
 * contract so a package cannot replace the map, cast or story moments with a
 * repeated generic image while preserving only the total count.
 */
export const TEXT_ADVENTURE_COMMERCIAL_VISUAL_BASELINE_V1 = [
  { mediaKind: 'background', sceneTag: 'cover-opening' },
  { mediaKind: 'character-pose', sceneTag: 'protagonist-anchor' },
  { mediaKind: 'background', sceneTag: 'region-map' },
  { mediaKind: 'cg', sceneTag: 'mainline-turn-act-1' },
  { mediaKind: 'background', sceneTag: 'secondary-region-anchor' },
  { mediaKind: 'cg', sceneTag: 'important-item-primary' },
  { mediaKind: 'character-pose', sceneTag: 'major-character-anchor' },
  { mediaKind: 'cg', sceneTag: 'mainline-turn-act-2' },
  { mediaKind: 'character-pose', sceneTag: 'supporting-character-anchor' },
  { mediaKind: 'cg', sceneTag: 'mainline-turn-act-3' },
  { mediaKind: 'cg', sceneTag: 'important-item-secondary' },
  { mediaKind: 'cg', sceneTag: 'ending-consequence' },
] as const satisfies readonly TextAdventureVisualCompositionRoleV1[]
