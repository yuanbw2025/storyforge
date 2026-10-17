import { avgHash, avgKey, avgNumber, avgRecord } from './protocol-validation'
import { parseAvgRetainedRawProofV1, type AvgRetainedRawProofV1 } from './media-recovery-contract'

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
