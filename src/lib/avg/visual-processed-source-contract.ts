import { avgHash,avgKey,avgNumber,avgRecord } from './protocol-validation'
import { parseAvgVisualRawProducerProofV4,parseAvgImageRevalidationProducerProofV1,
  type AvgGeneratedReferenceSourceV2,type AvgGeneratedReferenceSourceV3 } from './media-generated-reference-contract'
import { parseAvgVisualRawReuseSourceV4,type AvgVisualRawReuseSourceV4 } from './visual-image-reuse-contract'

export interface AvgGeneratedReferenceSourceV4 extends Omit<AvgGeneratedReferenceSourceV2,'version'|'raw'|'processing'> {
  version:4
  raw:AvgGeneratedReferenceSourceV2['raw']|AvgGeneratedReferenceSourceV3['raw']
  original?:AvgVisualRawReuseSourceV4
  processing:{schema:'storyforge.avg.image-processing-producer-proof';version:1;noProviderRequest:true;
    buildNumber:number;briefHash:string;planHash:string;controlEpoch:number;taskKey:string;artifactKey:string;artifactVersion:number;
    contentHash:string;inputHash:string;producerReceiptHash:string;candidateHash:string;proofHash:string;processingEvidenceHash:string}
}

/** Local derivative only. Original HTTP and optional current revalidation
 * remain distinct from processing; outbound reference V1 remains closed. */
export function parseAvgGeneratedReferenceSourceV4(value:unknown):AvgGeneratedReferenceSourceV4{
  const hasOriginal=!!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'original')
  const r=avgRecord(value,['schema','version','productionKey','requirementKey','raw','compilation','review','choice','processing',...(hasOriginal?['original']:[])],'V4 processed image source')
  if(r.schema!=='storyforge.avg.generated-reference-source'||r.version!==4)throw new Error('[avg-process] 本地加工选图来源版本无效')
  const productionKey=avgKey(r.productionKey,'processed productionKey'),requirementKey=avgKey(r.requirementKey,'processed requirementKey')
  const rawValue=r.raw as {schema?:unknown}|null
  const raw=rawValue?.schema==='storyforge.avg.image-revalidation-producer-proof'?parseAvgImageRevalidationProducerProofV1(r.raw,requirementKey)
    :parseAvgVisualRawProducerProofV4(r.raw,requirementKey)
  const original=hasOriginal?parseAvgVisualRawReuseSourceV4(r.original):undefined
  if((raw.schema==='storyforge.avg.image-revalidation-producer-proof')!==!!original
    ||original&&(original.productionKey!==productionKey||original.requirementKey!==requirementKey||original.raw.contentHash!==raw.contentHash
      ||original.raw.buildNumber>=raw.buildNumber))throw new Error('[avg-process] 加工图原始来源与本版复验不闭合')
  const processing=parseAvgLocalProcessingProducerProofV1(r.processing,requirementKey,raw)
  const c=avgRecord(r.compilation,['artifactKey','version','contentHash'],'processing compilation')
  if(c.artifactKey!=='avg.media.compiled-visual-requirements')throw new Error('[avg-process] 加工缺少准确编译来源')
  const author=(v:unknown,key:string)=>{
    const a=avgRecord(v,['artifactKey','version','contentHash','authorReceiptHash'],'processed author witness')
    if(a.artifactKey!==key)throw new Error('[avg-process] 加工评审或选图来源不准确')
    return {artifactKey:key,version:avgNumber(a.version,'processed authorVersion',1,1e9),contentHash:avgHash(a.contentHash,'processed authorHash'),authorReceiptHash:avgHash(a.authorReceiptHash,'processed authorReceipt')}
  }
  return {schema:r.schema,version:4,productionKey,requirementKey,raw,processing,...(original?{original}:{}),
    compilation:{artifactKey:c.artifactKey,version:avgNumber(c.version,'processing compilationVersion',1,1e9),contentHash:avgHash(c.contentHash,'processing compilationHash')},
    review:author(r.review,`avg.review.visual.${requirementKey}`),choice:author(r.choice,`avg.media.choice.${requirementKey}`)}
}

/** Shared physical local producer identity. Actual V4/V5 semantic evidence,
 * author review and source bytes are independently proved by their readers. */
export function parseAvgLocalProcessingProducerProofV1(value:unknown,requirementKey:string,raw:Pick<AvgGeneratedReferenceSourceV4['raw'],'buildNumber'|'briefHash'|'planHash'|'controlEpoch'>):AvgGeneratedReferenceSourceV4['processing']{
  const p=avgRecord(value,['schema','version','noProviderRequest','buildNumber','briefHash','planHash','controlEpoch','taskKey','artifactKey',
    'artifactVersion','contentHash','inputHash','producerReceiptHash','candidateHash','proofHash','processingEvidenceHash'],'local processing producer')
  if(p.schema!=='storyforge.avg.image-processing-producer-proof'||p.version!==1||p.noProviderRequest!==true
    ||p.taskKey!==`avg.media.process.${requirementKey}`||p.artifactKey!==`avg.media.processed.${requirementKey}`
    ||p.buildNumber!==raw.buildNumber||p.briefHash!==raw.briefHash||p.planHash!==raw.planHash||p.controlEpoch!==raw.controlEpoch)throw new Error('[avg-process] 原图与加工必须属于准确同版任务')
  return {schema:p.schema,version:1,noProviderRequest:true,
    buildNumber:avgNumber(p.buildNumber,'processing buildNumber',1,1e9),briefHash:avgHash(p.briefHash,'processing briefHash'),planHash:avgHash(p.planHash,'processing planHash'),
    controlEpoch:avgNumber(p.controlEpoch,'processing epoch',0,1e9),taskKey:p.taskKey,artifactKey:p.artifactKey,
    artifactVersion:avgNumber(p.artifactVersion,'processing artifactVersion',1,1e9),contentHash:avgHash(p.contentHash,'processing contentHash'),
    inputHash:avgHash(p.inputHash,'processing inputHash'),producerReceiptHash:avgHash(p.producerReceiptHash,'processing producerReceipt'),
    candidateHash:avgHash(p.candidateHash,'processing candidateHash'),proofHash:avgHash(p.proofHash,'processing proofHash'),processingEvidenceHash:avgHash(p.processingEvidenceHash,'processing evidenceHash')}
}
