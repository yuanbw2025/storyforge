import { deriveAvgImageProcessingGeometryV1, type AvgImageProcessingRecipeV1, type AvgImageProcessingReceiptV1, AVG_IMAGE_PROCESSOR_V1 } from '../../src/lib/avg/image-processing-contract'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'

export const avgImageProcessingRecipeFixture=():AvgImageProcessingRecipeV1=>({schema:'storyforge.avg.image-processing-recipe',version:1,crop:null,width:576,height:324,
  fit:'contain',anchor:{x:5000,y:5000},background:null,declaration:'原创工程图片的明确本地裁切/画布校验；不代表美术加工或商业验收'})

/** Explicit unit fixture only. Actual pixels and decoder remain browser tests. */
export async function avgImageProcessingReceiptFixture(input:{recipe:AvgImageProcessingRecipeV1;source:{contentHash:string;mimeType:string;byteSize:number;width:number;height:number};data:ArrayBuffer;hasAlpha?:boolean}):Promise<AvgImageProcessingReceiptV1>{
  const body:Omit<AvgImageProcessingReceiptV1,'receiptHash'>={schema:'storyforge.avg.image-processing-receipt',version:1,processor:AVG_IMAGE_PROCESSOR_V1,
    recipeHash:await hashProductProductionValueV2(input.recipe),source:input.source,output:{contentHash:await sha256MediaData(input.data),pixelHash:'e'.repeat(64),mimeType:'image/png',byteSize:input.data.byteLength,
      width:input.recipe.width,height:input.recipe.height,hasAlpha:input.hasAlpha??false},geometry:deriveAvgImageProcessingGeometryV1(input.recipe,input.source.width,input.source.height),renderer:{userAgent:'unit-fixture-no-native-pixels',platform:'fixture'}}
  return {...body,receiptHash:await hashProductProductionValueV2(body)}
}
