import { avgV5FormalFixture } from './avg-v5-formal-fixture'
import { importAvgMediaV1 } from '../../src/lib/avg/editor-service'
import { deterministicRegionMapPngV1 } from '../../src/lib/product-production/production-executor'
import { prepareAvgVisualPlanningSourceDraftV5 } from '../../src/lib/avg/visual-planning-scope-draft'

/** Actual S2 Work/world/draft and legal original engineering reference bytes.
 * No V5 Brief save, author start, Run, model response or acceptance is seeded. */
export async function avgV5WorkbenchPreparationFixture(){
  const f=await avgV5FormalFixture(),planning=structuredClone(f.author.versioned)
  const data=await deterministicRegionMapPngV1({width:32,height:32,palette:['#253746','#9f8772','#d1cbb8']})
  for(const entry of planning.referenceCatalog){
    const asset=await importAvgMediaV1({scope:f.owner.scope,data,mimeType:'image/png',kind:'background',name:`原创准备参考 ${entry.referenceKey}`,
      license:'本工程夹具原创色块；不证明人物身份、艺术或商业质量',altText:'原创色块',characterTag:''})
    entry.reference={...entry.reference,assetKey:asset.assetKey,assetVersion:asset.version,contentHash:asset.contentHash,byteSize:asset.byteSize,license:asset.license}
  }
  const proposed=await prepareAvgVisualPlanningSourceDraftV5({workspace:f.author.source,planning})
  return {...f,planning,workspace:proposed.workspace,scope:proposed.scope}
}
