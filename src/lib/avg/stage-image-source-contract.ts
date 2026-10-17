import type { FrozenRuntimeMediaAssetV2 } from '../types'
import { parseAvgGeneratedReferenceSourceV1, type AvgGeneratedReferenceSourceV1 } from './media-generated-reference-contract'
import { avgKey, avgList, avgRecord, avgText, avgUnique } from './protocol-validation'

/** Stage use is confirmed by the new author-stage adoption, separately from
 * reference outbound consent. All locators are portable content identities. */
export interface AvgInheritedStageImageV1 {
  assetKey:string;source:AvgGeneratedReferenceSourceV1;declaration:string
}
export function parseAvgInheritedStageImagesV1(value:unknown,assets:FrozenRuntimeMediaAssetV2[]):AvgInheritedStageImageV1[]{
  return avgUnique(avgList(value,'inheritedImages',value=>{
    const r=avgRecord(value,['assetKey','source','declaration'],'inherited stage image'),assetKey=avgKey(r.assetKey,'inherited.assetKey')
    const source=parseAvgGeneratedReferenceSourceV1(r.source),asset=assets.find(asset=>asset.assetKey===assetKey)
    if(!asset?.mimeType.startsWith('image/')||asset.contentHash!==(source.processing?.contentHash??source.raw.contentHash))throw new Error('[avg-media] 演出继承必须指向目录中准确的原图或加工图字节')
    return {assetKey,source,declaration:avgText(r.declaration,'inherited.declaration',2000)}
  },128),r=>r.assetKey,'inherited stage images')
}
