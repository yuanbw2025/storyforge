import type { AvgVisualProductionRequirementV2 } from './media-production-contract-v2'
import { parseAvgImageRegionCompositeRecipeV3, type AvgImageRegionCompositeRecipeV3 } from './image-region-composite-contract'

/** Structural preflight only. The owning reader separately verifies the
 * actual adoption, family/revision, Work bytes and original sent request. */
export function readAvgRegionRecipeReferenceV1(recipeInput: AvgImageRegionCompositeRecipeV3,
  requirement: Pick<AvgVisualProductionRequirementV2, 'mediaKind' | 'references'>) {
  const recipe = parseAvgImageRegionCompositeRecipeV3(recipeInput)
  if (requirement.mediaKind !== 'character-expression') throw new Error('[avg-composite] 局部配方只允许准确表情需求')
  const matches = requirement.references.filter(r => r.assetKey === recipe.baseReference.assetKey
    && r.assetVersion === recipe.baseReference.assetVersion && r.contentHash === recipe.baseReference.contentHash)
  const reference = matches[0]
  if (matches.length !== 1 || !reference?.generatedSource || reference.purpose !== 'identity'
    || !reference.providerInputAllowed || !reference.derivativeUseAllowed) throw new Error('[avg-composite] 底图不是冻结需求中明确获授权的已采用身份参考')
  return reference
}
