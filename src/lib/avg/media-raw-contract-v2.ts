import type { ProductProductionBriefV3,ProviderCapabilityRequirementV1 } from '../types'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../product-production/hash'
import { avgHash,avgKey,avgNumber,avgProtocolBody,avgRecord } from './protocol-validation'
import { avgRawMediaArtifactKeyV1 } from './media-production-contract'
import { parseAvgVisualProductionRequirementV2,type AvgVisualProductionBatchV2,type AvgVisualProductionRequirementV2 } from './media-production-contract-v2'
import { assertAvgImageRequestV2,type AvgImageRequestV2 } from './media-reference-contract-v2'
import { avgImageReferenceCapabilityV2,type AvgImageAdapterIdV4 } from './media-reference-contract'
import { assertAvgRawImageAssetMetadataV1,parseAvgRawImageProviderRightsV1,avgVisualRequestTextV1,type AvgRawImagePayloadV1,type assertAvgRawImageArtifactV1 } from './media-raw-contract'
import { avgReferenceTransmissionV1 } from './media-reference-adapter'

/** Explicit V2 raw identity: content policy and exact target family remain in
 * the original request hash. A legacy parser must reject this payload. */
export interface AvgRawImagePayloadV2 extends Omit<AvgRawImagePayloadV1,'version'|'requirement'|'request'>{
  version:2;requirement:AvgVisualProductionRequirementV2;request:AvgImageRequestV2
}
export async function parseAvgRawImagePayloadV2(value:unknown):Promise<AvgRawImagePayloadV2>{
  const r=avgRecord(avgProtocolBody(value),['schema','version','batchKey','batchRevision','sourceInputHash','requirement','request','provider','rights','capabilityBindingHash'],'versioned raw image')
  if(r.schema!=='storyforge.avg.raw-image'||r.version!==2)throw new Error('[avg-media] 新版原图版本无效')
  const requirement=parseAvgVisualProductionRequirementV2(r.requirement),request=await assertAvgImageRequestV2(r.request as AvgImageRequestV2)
  return {schema:r.schema,version:2,batchKey:avgKey(r.batchKey,'batchKey'),batchRevision:avgNumber(r.batchRevision,'batchRevision',1,1e6),
    sourceInputHash:avgHash(r.sourceInputHash,'sourceInputHash'),requirement,request,...parseAvgRawImageProviderRightsV1({provider:r.provider,rights:r.rights},request.request),
    capabilityBindingHash:avgHash(r.capabilityBindingHash,'capabilityBindingHash')}
}
export async function assertAvgRawImageArtifactFromDefinitionV2(definition:{
  mediaBatch:AvgVisualProductionBatchV2;imageBinding:{bindingHash:string;adapterId:AvgImageAdapterIdV4}
  capability:ProviderCapabilityRequirementV1;qualityProfile:ProductProductionBriefV3['qualityProfile']
},row:Parameters<typeof assertAvgRawImageArtifactV1>[1]){
  const payload=await parseAvgRawImagePayloadV2(row.payloadJson),batch=definition.mediaBatch,capability=definition.capability
  const r=batch.requirements.find(r=>row.artifactKey===avgRawMediaArtifactKeyV1(r.requirementKey)),request=payload.request.request,text=r&&avgVisualRequestTextV1(r)
  const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
  if(capability.capabilityHash!==await hashProductProductionValueV2(avgImageReferenceCapabilityV2(definition.imageBinding.adapterId))
    ||request.adapterId!==definition.imageBinding.adapterId)throw new Error('[avg-media] 新原图能力与冻结图片模型不一致')
  if(!r||!same(payload.requirement,r)||payload.batchKey!==batch.batchKey||payload.batchRevision!==batch.revision||payload.sourceInputHash!==batch.sourceInputHash
    ||payload.capabilityBindingHash!==definition.imageBinding.bindingHash||row.kind!=='image'||row.mediaKind!==r.mediaKind
    ||request.artifactKey!==row.artifactKey||request.requirementKey!==capability.requirementKey||request.mediaKind!==r.mediaKind
    ||request.prompt!==text!.prompt||request.negativePrompt!==text!.negativePrompt||request.width!==r.width||request.height!==r.height
    ||request.qualityProfile!==definition.qualityProfile||request.rightsPolicyVersion!==capability.rightsPolicyVersion
    ||!same([...request.allowedDataClasses].sort(),[...capability.allowedDataClasses].sort())
    ||payload.request.resolutionTier!==r.resolutionTier||!same(payload.request.references,r.references)||!same(payload.request.targetFamily,r.family))throw new Error('[avg-media] 新原图与准确编译需求或参考策略不一致')
  return {payload,asset:assertAvgRawImageAssetMetadataV1({requirement:r,request,rights:payload.rights,capability},row)}
}

/** Exact reception metadata shared by original admission and later consumers.
 * This records the sent policy, never art compliance or native decoding. */
export function assertAvgRawImageReceptionV2(qualityJson:string,source:{request:AvgImageRequestV2;rule:unknown;scripts:unknown;compilation:unknown}){
  const q=avgRecord(JSON.parse(qualityJson),['received','rawResponseRecorded','responseEvidenceHash','headerVerified','contentHashVerified',
    'decoderVerified','referenceTransmission','sourceRule','sourceScripts','sourceCompilation','sourceContextHash'],'versioned compiled image evidence')
  const same=(a:unknown,b:unknown)=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(b)
  if(q.received!==true||q.rawResponseRecorded!==true||q.headerVerified!==true||q.contentHashVerified!==true||q.decoderVerified!==false
    ||!same(q.sourceRule,source.rule)||!same(q.sourceScripts,source.scripts)||!same(q.sourceCompilation,source.compilation)
    ||!same(q.referenceTransmission,avgReferenceTransmissionV1(source.request)))throw new Error('[avg-visual-image] 新原图必须保留准确参考用途/家族回执，不能冒充解码或画面合规')
  avgHash(q.sourceContextHash,'sourceContextHash')
  return q
}
