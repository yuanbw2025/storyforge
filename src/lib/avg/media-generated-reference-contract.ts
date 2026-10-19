import { parseAvgVisualRawReuseSourceV4, type AvgVisualRawReuseSourceV4 } from './visual-image-reuse-contract'
import { avgHash, avgKey, avgNumber, avgRecord } from './protocol-validation'
import { parseAvgRetainedRawProofV1, type AvgRetainedRawProofV1 } from './media-recovery-contract'
import { parseAvgGeneratedReferenceSourceV4,parseAvgLocalProcessingProducerProofV1,type AvgGeneratedReferenceSourceV4 } from './visual-processed-source-contract'

/** Portable origin, never a host-local Build/Run/Blob locator. Outbound and
 * derivative consent still belong to each later reference request. */
export interface AvgGeneratedReferenceSourceV1 {
  schema: 'storyforge.avg.generated-reference-source'
  version: 1
  productionKey: string
  requirementKey: string
  raw: AvgRetainedRawProofV1
  processing?: Omit<AvgRetainedRawProofV1,'schema'> & {schema:'storyforge.avg.processed-image-proof'}
  choice: { artifactKey: string; version: number; contentHash: string; authorReceiptHash: string }
}

export function parseAvgGeneratedReferenceSourceV1(value: unknown): AvgGeneratedReferenceSourceV1 {
  const hasProcessing=!!value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,'processing')
  const r = avgRecord(value, ['schema','version','productionKey','requirementKey','raw','choice',...(hasProcessing?['processing']:[])], 'generated reference source')
  if (r.schema !== 'storyforge.avg.generated-reference-source' || r.version !== 1) throw new Error('[avg-media] 生成参考来源版本无效')
  const requirementKey = avgKey(r.requirementKey, 'reference.requirementKey'), raw = parseAvgRetainedRawProofV1(r.raw)
  const c = avgRecord(r.choice, ['artifactKey','version','contentHash','authorReceiptHash'], 'generated reference choice')
  let processing:AvgGeneratedReferenceSourceV1['processing']
  if(hasProcessing){
    const p=avgRecord(r.processing,['schema','version','buildNumber','briefHash','planHash','controlEpoch','taskKey','artifactKey','artifactVersion','contentHash','inputHash','producerReceiptHash','candidateHash','proofHash'],'processed image proof')
    if(p.schema!=='storyforge.avg.processed-image-proof'||p.version!==1||p.buildNumber!==raw.buildNumber||p.briefHash!==raw.briefHash||p.planHash!==raw.planHash||p.controlEpoch!==raw.controlEpoch
      ||p.taskKey!==`avg.media.process.${requirementKey}`||p.artifactKey!==`avg.media.processed.${requirementKey}`)throw new Error('[avg-process] 加工来源不属于准确原图版本和需求')
    processing={schema:'storyforge.avg.processed-image-proof',version:1,buildNumber:raw.buildNumber,briefHash:raw.briefHash,planHash:raw.planHash,controlEpoch:raw.controlEpoch,
      taskKey:p.taskKey,artifactKey:p.artifactKey,artifactVersion:avgNumber(p.artifactVersion,'processed.artifactVersion',1,1e9),contentHash:avgHash(p.contentHash,'processed.contentHash'),
      inputHash:avgHash(p.inputHash,'processed.inputHash'),producerReceiptHash:avgHash(p.producerReceiptHash,'processed.producerReceiptHash'),candidateHash:avgHash(p.candidateHash,'processed.candidateHash'),proofHash:avgHash(p.proofHash,'processed.proofHash')}
  }
  if (raw.artifactKey !== `avg.media.raw.${requirementKey}` || raw.taskKey !== `avg.media.generate.${requirementKey}`
    || c.artifactKey !== `avg.media.choice.${requirementKey}`) throw new Error('[avg-media] 生成参考的原图与作者选择不属于同一需求')
  return { schema:r.schema,version:1,productionKey:avgKey(r.productionKey,'reference.productionKey'),requirementKey,raw,...(processing?{processing}:{}),
    choice:{artifactKey:c.artifactKey,version:avgNumber(c.version,'reference.choice.version',1,1e9),
      contentHash:avgHash(c.contentHash,'reference.choice.contentHash'),authorReceiptHash:avgHash(c.authorReceiptHash,'reference.choice.authorReceiptHash')} }
}

/** V4 originals use a distinct tagged source. V1 reference requests keep
 * their own parser; this source first serves explicit local stage retention. */
export interface AvgGeneratedReferenceSourceV2 {
  schema:'storyforge.avg.generated-reference-source';version:2
  productionKey:string;requirementKey:string
  raw:{schema:'storyforge.avg.visual-image-producer-proof';version:4;buildNumber:number;briefHash:string;planHash:string;controlEpoch:number;
    taskKey:string;artifactKey:string;artifactVersion:number;contentHash:string;inputHash:string;producerReceiptHash:string;
    candidateHash:string;responseEvidenceHash:string;proofHash:string}
  compilation:{artifactKey:'avg.media.compiled-visual-requirements';version:number;contentHash:string}
  choice:{artifactKey:string;version:number;contentHash:string;authorReceiptHash:string}
  review:{artifactKey:string;version:number;contentHash:string;authorReceiptHash:string}
  processing?:never
}
export interface AvgGeneratedReferenceSourceV3 extends Omit<AvgGeneratedReferenceSourceV2,'version'|'raw'> {
  version:3
  raw:Omit<AvgGeneratedReferenceSourceV2['raw'],'schema'|'version'|'responseEvidenceHash'>&{
    schema:'storyforge.avg.image-revalidation-producer-proof';version:1;noProviderRequest:true;revalidationEvidenceHash:string}
  original:AvgVisualRawReuseSourceV4
}
/** V5/raw2 policy semantics keep an explicitly tagged original provenance.
 * Parsing never proves actual producer, author observation or usage rights. */
export interface AvgGeneratedReferenceSourceV5 extends Omit<AvgGeneratedReferenceSourceV2,'version'|'raw'>{
  version:5
  raw:Omit<AvgGeneratedReferenceSourceV2['raw'],'version'>&{version:5}
}
/** Actual V5 original/raw2 with a separate bounded local derivative. Source5
 * stays original-only; this packet cannot grant a legacy request authority. */
export interface AvgGeneratedReferenceSourceV6 extends Omit<AvgGeneratedReferenceSourceV5,'version'|'processing'>{
  version:6
  processing:AvgGeneratedReferenceSourceV4['processing']
}
export type AvgGeneratedImageSource=AvgGeneratedReferenceSourceV1|AvgGeneratedReferenceSourceV2|AvgGeneratedReferenceSourceV3|AvgGeneratedReferenceSourceV4|AvgGeneratedReferenceSourceV5|AvgGeneratedReferenceSourceV6

/** Structural original HTTP proof only. Every consumer must independently
 * verify the actual portable producer and bytes; parsing grants no use. */
export function parseAvgVisualRawProducerProofV4(value:unknown,requirementKey:string):AvgGeneratedReferenceSourceV2['raw'] {
  return parseAvgVisualRawProducerProof(value,requirementKey,4)
}
export function parseAvgVisualRawProducerProofV5(value:unknown,requirementKey:string):AvgGeneratedReferenceSourceV5['raw'] {
  return parseAvgVisualRawProducerProof(value,requirementKey,5)
}
function parseAvgVisualRawProducerProof<V extends 4|5>(value:unknown,requirementKey:string,version:V) {
  const p=avgRecord(value,['schema','version','buildNumber','briefHash','planHash','controlEpoch','taskKey','artifactKey','artifactVersion','contentHash','inputHash','producerReceiptHash','candidateHash','responseEvidenceHash','proofHash'],'V4 image producer')
  if(p.schema!=='storyforge.avg.visual-image-producer-proof'||p.version!==version||p.taskKey!==`avg.media.generate.${requirementKey}`||p.artifactKey!==`avg.media.raw.${requirementKey}`)throw new Error('[avg-visual-history] 来源不是准确 V4 图片 producer')
  return {schema:'storyforge.avg.visual-image-producer-proof' as const,version,buildNumber:avgNumber(p.buildNumber,'source.buildNumber',1,1e9),
    briefHash:avgHash(p.briefHash,'source.briefHash'),planHash:avgHash(p.planHash,'source.planHash'),controlEpoch:avgNumber(p.controlEpoch,'source.controlEpoch',0,1e9),
    taskKey:p.taskKey,artifactKey:p.artifactKey,artifactVersion:avgNumber(p.artifactVersion,'source.artifactVersion',1,1e9),
    contentHash:avgHash(p.contentHash,'source.contentHash'),inputHash:avgHash(p.inputHash,'source.inputHash'),producerReceiptHash:avgHash(p.producerReceiptHash,'source.producerReceiptHash'),
    candidateHash:avgHash(p.candidateHash,'source.candidateHash'),responseEvidenceHash:avgHash(p.responseEvidenceHash,'source.responseEvidenceHash'),proofHash:avgHash(p.proofHash,'source.proofHash')}
}

function parseOriginalImageSourceFields<V extends 2|5|6>(value:unknown,version:V) {
  const r=avgRecord(value,['schema','version','productionKey','requirementKey','raw','compilation','choice','review',...(version===6?['processing']:[])],'visual image source')
  if(r.schema!=='storyforge.avg.generated-reference-source'||r.version!==version)throw new Error('[avg-visual-history] 图片来源版本无效')
  const requirementKey=avgKey(r.requirementKey,'source.requirementKey')
  const c=avgRecord(r.compilation,['artifactKey','version','contentHash'],'V4 image compilation')
  if(c.artifactKey!=='avg.media.compiled-visual-requirements')throw new Error('[avg-visual-history] 原编译来源不匹配')
  const author=(value:unknown,key:string)=>{
    const a=avgRecord(value,['artifactKey','version','contentHash','authorReceiptHash'],'V4 image author source')
    if(a.artifactKey!==key)throw new Error('[avg-visual-history] 原作者来源不匹配')
    return {artifactKey:key,version:avgNumber(a.version,'source.authorVersion',1,1e9),contentHash:avgHash(a.contentHash,'source.authorContentHash'),authorReceiptHash:avgHash(a.authorReceiptHash,'source.authorReceiptHash')}
  }
  return {schema:'storyforge.avg.generated-reference-source' as const,version,rawValue:r.raw,productionKey:avgKey(r.productionKey,'source.productionKey'),requirementKey,
    compilation:{artifactKey:'avg.media.compiled-visual-requirements' as const,version:avgNumber(c.version,'source.compilationVersion',1,1e9),contentHash:avgHash(c.contentHash,'source.compilationHash')},
    choice:author(r.choice,`avg.media.choice.${requirementKey}`),review:author(r.review,`avg.review.visual.${requirementKey}`)}
}

export function parseAvgGeneratedReferenceSourceV2(value:unknown):AvgGeneratedReferenceSourceV2 {
  const source=parseOriginalImageSourceFields(value,2)
  return {schema:source.schema,version:source.version,productionKey:source.productionKey,requirementKey:source.requirementKey,
    raw:parseAvgVisualRawProducerProofV4(source.rawValue,source.requirementKey),compilation:source.compilation,choice:source.choice,review:source.review}
}
export function parseAvgGeneratedReferenceSourceV5(value:unknown):AvgGeneratedReferenceSourceV5 {
  const source=parseOriginalImageSourceFields(value,5)
  return {schema:source.schema,version:source.version,productionKey:source.productionKey,requirementKey:source.requirementKey,
    raw:parseAvgVisualRawProducerProofV5(source.rawValue,source.requirementKey),compilation:source.compilation,choice:source.choice,review:source.review}
}

export function parseAvgImageRevalidationProducerProofV1(value:unknown,requirementKey:string):AvgGeneratedReferenceSourceV3['raw']{
  const p=avgRecord(value,['schema','version','buildNumber','briefHash','planHash','controlEpoch','taskKey','artifactKey','artifactVersion','contentHash',
    'inputHash','producerReceiptHash','candidateHash','proofHash','noProviderRequest','revalidationEvidenceHash'],'local image producer')
  if(p.schema!=='storyforge.avg.image-revalidation-producer-proof'||p.version!==1||p.noProviderRequest!==true
    ||p.taskKey!==`avg.media.generate.${requirementKey}`||p.artifactKey!==`avg.media.raw.${requirementKey}`)throw new Error('[avg-visual-raw-reuse] 本地复验与原始图片来源不闭合')
  const raw:AvgGeneratedReferenceSourceV3['raw']={schema:p.schema,version:1,noProviderRequest:true,
    buildNumber:avgNumber(p.buildNumber,'local buildNumber',1,1e9),controlEpoch:avgNumber(p.controlEpoch,'local controlEpoch',0,1e9),
    briefHash:avgHash(p.briefHash,'local briefHash'),planHash:avgHash(p.planHash,'local planHash'),taskKey:p.taskKey,artifactKey:p.artifactKey,
    artifactVersion:avgNumber(p.artifactVersion,'local artifactVersion',1,1e9),contentHash:avgHash(p.contentHash,'local contentHash'),
    inputHash:avgHash(p.inputHash,'local inputHash'),producerReceiptHash:avgHash(p.producerReceiptHash,'local producerReceiptHash'),
    candidateHash:avgHash(p.candidateHash,'local candidateHash'),proofHash:avgHash(p.proofHash,'local proofHash'),
    revalidationEvidenceHash:avgHash(p.revalidationEvidenceHash,'local quality hash')}
  return raw
}

/** A current local producer and current author witnesses, with the original
 * HTTP origin kept separately. Existing V1/V2 sources stay closed. */
export function parseAvgGeneratedReferenceSourceV3(value:unknown):AvgGeneratedReferenceSourceV3 {
  const r=avgRecord(value,['schema','version','productionKey','requirementKey','raw','compilation','choice','review','original'],'revalidated image source')
  if(r.schema!=='storyforge.avg.generated-reference-source'||r.version!==3)throw new Error('[avg-visual-raw-reuse] 本地复验图片来源版本无效')
  const requirementKey=avgKey(r.requirementKey,'source.requirementKey'),productionKey=avgKey(r.productionKey,'source.productionKey')
  const original=parseAvgVisualRawReuseSourceV4(r.original)
  const raw=parseAvgImageRevalidationProducerProofV1(r.raw,requirementKey)
  if(original.productionKey!==productionKey||original.requirementKey!==requirementKey||original.raw.contentHash!==raw.contentHash
    ||original.raw.buildNumber>=raw.buildNumber)throw new Error('[avg-visual-raw-reuse] 原始图片与本次复验不闭合')
  const c=avgRecord(r.compilation,['artifactKey','version','contentHash'],'local compilation')
  if(c.artifactKey!=='avg.media.compiled-visual-requirements')throw new Error('[avg-visual-raw-reuse] 本次编译来源不准确')
  const author=(value:unknown,key:string)=>{
    const a=avgRecord(value,['artifactKey','version','contentHash','authorReceiptHash'],'local visual author')
    if(a.artifactKey!==key)throw new Error('[avg-visual-raw-reuse] 本次评审或选择不准确')
    return {artifactKey:key,version:avgNumber(a.version,'local authorVersion',1,1e9),contentHash:avgHash(a.contentHash,'local authorHash'),authorReceiptHash:avgHash(a.authorReceiptHash,'local authorReceipt')}
  }
  return {schema:r.schema,version:3,productionKey,requirementKey,raw,original,
    compilation:{artifactKey:c.artifactKey,version:avgNumber(c.version,'local compilationVersion',1,1e9),contentHash:avgHash(c.contentHash,'local compilationHash')},
    choice:author(r.choice,`avg.media.choice.${requirementKey}`),review:author(r.review,`avg.review.visual.${requirementKey}`)}
}

export function parseAvgGeneratedReferenceSourceV6(value:unknown):AvgGeneratedReferenceSourceV6 {
  const s=parseOriginalImageSourceFields(value,6),raw=parseAvgVisualRawProducerProofV5(s.rawValue,s.requirementKey)
  const processing=parseAvgLocalProcessingProducerProofV1((value as {processing?:unknown}).processing,s.requirementKey,raw)
  return {schema:s.schema,version:6,productionKey:s.productionKey,requirementKey:s.requirementKey,raw,processing,
    compilation:s.compilation,choice:s.choice,review:s.review}
}

export function parseAvgGeneratedImageSource(value:unknown):AvgGeneratedImageSource {
  if(value&&typeof value==='object'&&'version'in value&&value.version===6)return parseAvgGeneratedReferenceSourceV6(value)
  if(value&&typeof value==='object'&&'version'in value&&value.version===5)return parseAvgGeneratedReferenceSourceV5(value)
  if(value&&typeof value==='object'&&'version'in value&&value.version===4)return parseAvgGeneratedReferenceSourceV4(value)
  if(value&&typeof value==='object'&&'version'in value&&value.version===3)return parseAvgGeneratedReferenceSourceV3(value)
  return value&&typeof value==='object'&&'version'in value&&value.version===2
    ?parseAvgGeneratedReferenceSourceV2(value):parseAvgGeneratedReferenceSourceV1(value)
}
