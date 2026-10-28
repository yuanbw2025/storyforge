import { vi } from 'vitest'
import type { FrozenRuntimeMediaAssetV2, WorkspaceScope, ProviderCapabilityRequirementV1 } from '../../src/lib/types'
import type { MediaProviderTransportV1 } from '../../src/lib/product-production/media-adapters'
import { exportProjectJSON } from '../../src/lib/export/json-export'
import { createAvgDraftReferenceAdapterV2 } from '../../src/lib/avg/editor-service'
import { readAvgAdoptedGeneratedImageV2 } from '../../src/lib/avg/media-generated-reference'
import type { AvgGeneratedImageSource } from '../../src/lib/avg/media-generated-reference-contract'
import { parseAvgMediaReferencesV2 } from '../../src/lib/avg/media-reference-contract-v2'
import { avgVersionedPlanningFixture } from './avg-versioned-planning-fixture'
import { compileAvgVisualPlanningProposalV2,freezeAvgVisualPlanningScopeV2,prepareAvgRawImageRequestFromBatchV2 } from '../../src/lib/avg/media-production-v2'
import { avgImageReferenceCapabilityV2 } from '../../src/lib/avg/media-reference-contract'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

/** Controlled transport only. It receives real Work-owned source bytes from
 * the public resolver, through a separate pure five-target author-intent fixture
 * and V2 compiler/request. This is no stored Brief, provider call or fabricated Run. */
export async function avgVersionedReferenceTransportFixture(input:{scope:WorkspaceScope;asset:FrozenRuntimeMediaAssetV2;source:AvgGeneratedImageSource}){
  const {scope,asset,source}=input,image=await readAvgAdoptedGeneratedImageV2({scope,source})
  const reference=parseAvgMediaReferencesV2([{schema:'storyforge.avg.media-reference',version:2,assetKey:asset.assetKey,assetVersion:asset.version,
    contentHash:asset.contentHash,mimeType:asset.mimeType,byteSize:asset.byteSize,purpose:'style',allowedChange:'工程传输校准，仅保留配色和质感。',
    dataClass:'avg-authorized-reference',license:asset.license,providerInputAllowed:true,derivativeUseAllowed:true,crop:null,mask:null,generatedSource:source,
    contentPolicy:{permittedFeatures:['配色和质感'],excludedFeatures:['具体布局','道具和剧情信息']} }])[0]!
  const author=avgVersionedPlanningFixture()
  const scope2=await freezeAvgVisualPlanningScopeV2({...author.versioned,referenceCatalog:[{referenceKey:'reference.actual',reference}],
    templates:author.versioned.templates.map(t=>({...t,allowedReferenceKeys:['reference.actual'],requiredReferenceKeys:['reference.actual']}))},author.source)
  const mediaBriefs=author.mediaBriefs.map(b=>({...b,outputs:b.outputs.map(o=>({...o,referenceKeys:['reference.actual']}))}))
  const compiled=await compileAvgVisualPlanningProposalV2({...author,scope:scope2,mediaBriefs})
  const capability:ProviderCapabilityRequirementV1={requirementKey:'avg.media.image',mediaClass:'image',operation:'generate',adapterFamily:'agnes-image-reference',
    minimumCapabilityVersion:'1',allowedDataClasses:[reference.dataClass],maximumRequestCost:null,maximumTotalCost:null,rightsPolicyVersion:'controlled-reference.v2',
    capabilityHash:await hashProductProductionValueV2(avgImageReferenceCapabilityV2('agnes.image-2.5-flash.v1')),required:true}
  const frozen=await prepareAvgRawImageRequestFromBatchV2({batch:compiled.batch,capability,qualityProfile:'prototype',
    requirementKey:compiled.batch.requirements[0].requirementKey,idempotencyKey:'controlled.reference.v2',adapterId:'agnes.image-2.5-flash.v1'})
  const request=frozen.request
  const adapter=await createAvgDraftReferenceAdapterV2({scope,frozen})
  let binary='';for(const b of new Uint8Array(image.data))binary+=String.fromCharCode(b)
  const dispatch=vi.fn<MediaProviderTransportV1['request']>(async()=>({status:200,contentType:'application/json',body:null,
    json:{data:[{b64_json:btoa(binary)}]},providerRequestId:'controlled-reference-v2',usage:null,costUsd:null}))
  const before=await exportProjectJSON(scope.projectId)
  const [candidate]=await adapter.generate({...request,inputHash:frozen.inputHash},{executionLocation:'browser-direct',request:dispatch},new AbortController().signal)
  await adapter.parseAndVerify(candidate)
  const after=await exportProjectJSON(scope.projectId)
  return {reference,frozen,compiled,candidate,dispatch,projectUnchanged:JSON.stringify({...before,exportedAt:0})===JSON.stringify({...after,exportedAt:0})}
}
