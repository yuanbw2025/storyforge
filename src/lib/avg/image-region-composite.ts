/** AVG-04A.27a.1: experimental headless pixel/PNG foundation only.
 * No formal Plan admission, model call, DB write, author choice or UI route.
 * The read-only source helper proves exact Work inputs; the future durable
 * adapter must freeze recipe/budget, recheck the claim and admit its result. */
export { AVG_REGION_COMPOSITE_ALGORITHM_V1, AVG_REGION_COMPOSITE_PIXEL_LIMIT_V1,
  parseAvgImageRegionCompositeRecipeV3, deriveAvgRegionCompositeGeometryV1,
  type AvgImageRegionCompositeRecipeV3, type AvgRegionRectV1, type AvgRegionCompositeGeometryV1 } from './image-region-composite-contract'
export { composeAvgCharacterRegionsV1, type AvgCompositeRasterV1 } from './image-region-composite-kernel'
export { AVG_STRAIGHT_PNG_CODEC_V1, decodeAvgStraightPngV1, encodeAvgStraightPngV1 } from './image-straight-png'
export { AVG_IMAGE_PROCESSOR_V3, parseAvgImageRegionCompositeReceiptV3, assertAvgImageRegionCompositeReceiptV3,
  type AvgImageRegionCompositeReceiptV3, type AvgRegionImagePhysicalV1, type AvgRegionInputProofV1 } from './image-region-composite-receipt'
export { processAvgRegionCompositeBytesV1, verifyAvgRegionCompositeBytesV1, type AvgRegionCompositeByteInputV1 } from './image-region-composite-pixels'
export { readAvgRegionCompositeInputsV1, type AvgRegionCompositeSourceReadV1 } from './image-region-composite-source'
export { runAvgRegionCompositeWorkersV1, verifyAvgRegionCompositeWorkerV1 } from './image-region-composite-worker-client'
