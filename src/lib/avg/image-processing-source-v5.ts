import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1,ProductProductionBriefV3,WorkspaceScope } from '../types'
import { verifyAcceptedProductBuildArtifactV1 } from '../product-production/artifact-store'
import { avgProcessedImageArtifactKeyV1 } from './image-processing-contract'
import { inspectAvgProcessedImageBytesV1 } from './image-processing-source'
import { assertAvgConsumedRawImageV5 } from './image-consumption-v5'

/** Actual V5/current or frozen read only. Legacy definitions are never used to
 * grant the new policy request an old processed-image authority. */
export async function inspectAvgProcessedImageSourceV5(input:{scope:WorkspaceScope;brief:ProductProductionBriefV3;raw:ProductBuildArtifactRecordV1;processed:ProductBuildArtifactRecordV1}){
  const raw=await assertAvgConsumedRawImageV5({...input,row:input.raw})
  const load=()=>import('./visual-image-processing-v5')
  const {inspectAvgVisualProcessedImageV5}=await(Dexie.currentTransaction?Dexie.waitFor(Dexie.ignoreTransaction(load)):load())
  const image=await inspectAvgVisualProcessedImageV5({scope:input.scope,compiled:raw.compiled,raw:input.raw,artifact:input.processed})
  return inspectAvgProcessedImageBytesV1({...input,image})
}
export async function readAvgProcessedImageSourceV5(input:{scope:WorkspaceScope;buildId:number;brief:ProductProductionBriefV3;raw:ProductBuildArtifactRecordV1;version?:number;contentHash?:string}){
  const raw=await assertAvgConsumedRawImageV5({...input,row:input.raw})
  const rows=await db.productBuildArtifacts.where('[buildId+artifactKey]').equals([input.buildId,avgProcessedImageArtifactKeyV1(raw.requirement.requirementKey)])
    .filter(r=>r.status==='accepted'&&r.controlEpoch===input.raw.controlEpoch).limit(2).toArray()
  const row=rows[0]
  if(rows.length!==1||!row||input.version!==undefined&&row.version!==input.version||input.contentHash!==undefined&&row.contentHash!==input.contentHash)throw new Error('[avg-process] 当前版本缺少准确的新加工图')
  const proved=await verifyAcceptedProductBuildArtifactV1({scope:input.scope,buildId:input.buildId,artifactKey:row.artifactKey,version:row.version,contentHash:row.contentHash})
  return inspectAvgProcessedImageSourceV5({...input,processed:proved})
}
