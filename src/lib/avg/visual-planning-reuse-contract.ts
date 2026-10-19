import { avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgUnique } from './protocol-validation'
import { avgMediaBriefArtifactKeyV1, type AvgVisualPlanningScopeV1 } from './visual-planning-contract'

export interface AvgVisualArtifactRefV4 { artifactKey: string; version: number; contentHash: string }
/** Logical, portable locators only. Reading this descriptor grants no write,
 * retry or dispatch authority; each use must prove the original records. */
export interface AvgVisualProposalReuseSourceV4 {
  schema: 'storyforge.avg.visual-proposal-reuse-source'; version: 1
  productionKey: string; buildNumber: number; buildRevision: number; controlEpoch: number
  briefHash: string; planHash: string; artifact: AvgVisualArtifactRefV4; authorReceiptHash: string
  proposal: AvgVisualArtifactRefV4; producerReceiptHash: string; requestSnapshotHash: string; rawResponseHash: string
}
export type AvgVisualReusePathV4 = readonly string[]

export function parseAvgVisualArtifactRefV4(value: unknown): AvgVisualArtifactRefV4 {
  const r = avgRecord(value,['artifactKey','version','contentHash'],'visual artifact ref')
  return { artifactKey: avgKey(r.artifactKey,'artifactKey'), version: avgNumber(r.version,'artifact version',1,Number.MAX_SAFE_INTEGER),
    contentHash: avgHash(r.contentHash,'artifact contentHash') }
}
export function parseAvgVisualProposalReuseSourceV4(value: unknown): AvgVisualProposalReuseSourceV4 {
  const r = avgRecord(avgProtocolBody(value),['schema','version','productionKey','buildNumber','buildRevision','controlEpoch',
    'briefHash','planHash','artifact','authorReceiptHash','proposal','producerReceiptHash','requestSnapshotHash','rawResponseHash'],'visual proposal reuse source')
  if(r.schema!=='storyforge.avg.visual-proposal-reuse-source'||r.version!==1)throw new Error('[avg-visual-reuse] 来源版本无效')
  const artifact=parseAvgVisualArtifactRefV4(r.artifact),proposal=parseAvgVisualArtifactRefV4(r.proposal)
  if(!/^avg\.media\.(visual-bible|(?:environment|character|prop)-brief\.[A-Za-z0-9._:-]+)$/.test(artifact.artifactKey)
    ||proposal.artifactKey!==artifact.artifactKey.replace(/^avg\.media\./,'avg.proposal.'))throw new Error('[avg-visual-reuse] 来源岗位与原始方案不一致')
  return {schema:r.schema,version:1,productionKey:avgKey(r.productionKey,'productionKey'),
    buildNumber:avgNumber(r.buildNumber,'source buildNumber',1,Number.MAX_SAFE_INTEGER-1),
    buildRevision:avgNumber(r.buildRevision,'source buildRevision',0,Number.MAX_SAFE_INTEGER),
    controlEpoch:avgNumber(r.controlEpoch,'source controlEpoch',0,Number.MAX_SAFE_INTEGER),
    briefHash:avgHash(r.briefHash,'source briefHash'),planHash:avgHash(r.planHash,'source planHash'),artifact,
    authorReceiptHash:avgHash(r.authorReceiptHash,'source authorReceiptHash'),proposal,
    producerReceiptHash:avgHash(r.producerReceiptHash,'source producerReceiptHash'),
    requestSnapshotHash:avgHash(r.requestSnapshotHash,'source requestSnapshotHash'),rawResponseHash:avgHash(r.rawResponseHash,'source rawResponseHash')}
}
export function avgVisualPlanningTargetKeysV4(scope:Pick<AvgVisualPlanningScopeV1,'templates'>){
  return ['avg.media.visual-bible',...[...new Map(scope.templates.map(t=>[t.parameters.family.subjectKey,t.subjectKind])).entries()]
    .map(([subject,kind])=>avgMediaBriefArtifactKeyV1(kind,subject))]
}
export function parseAvgVisualProposalReuseSourcesV4(value:unknown,scope:AvgVisualPlanningScopeV1){
  const items=avgUnique(avgList(value,'proposal reuse',parseAvgVisualProposalReuseSourceV4,9),r=>r.artifact.artifactKey,'reuse target')
  const targets=avgVisualPlanningTargetKeysV4(scope)
  if(!items.length||items.some(r=>!targets.includes(r.artifact.artifactKey)))throw new Error('[avg-visual-reuse] 复用来源为空或超出本批准确岗位')
  return items
}
