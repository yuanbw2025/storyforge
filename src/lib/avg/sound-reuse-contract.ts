import { avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgUnique } from './protocol-validation'
import { parseAvgGeneratedSoundSource, type AvgGeneratedSoundSource } from './stage-processed-sound-source-contract'

export interface AvgSoundRevalidationInputRefV1 {
  artifactKey: string; version: number; contentHash: string
}
interface AvgSoundRevalidationEvidenceBaseV1 {
  version: 1
  noProviderRequest: true
  retainedOrigin: AvgGeneratedSoundSource
  sourceBuildRevision: number
  repairHash: string
  sourceContextHash: string
  inputs: AvgSoundRevalidationInputRefV1[]
  contentHashVerified: true
}
export interface AvgSoundRequirementsRevalidationEvidenceV1 extends AvgSoundRevalidationEvidenceBaseV1 {
  schema: 'storyforge.avg.sound-requirements-revalidation'
}
export interface AvgRawSoundRevalidationEvidenceV1 extends AvgSoundRevalidationEvidenceBaseV1 {
  schema: 'storyforge.avg.raw-sound-revalidation'
  decoderVerified: true
  hearing: 'unobserved'
  authorAdopted: false
}
export type AvgSoundRevalidationEvidenceV1 = AvgSoundRequirementsRevalidationEvidenceV1 | AvgRawSoundRevalidationEvidenceV1

/** Inert local-revalidation shape only. Exact current task inputs, completed
 * producer, original bytes/rights and author/parent proofs remain mandatory
 * at the existing sealed boundary; this codec creates none of that authority. */
export function parseAvgSoundRevalidationEvidenceV1(value: unknown): AvgSoundRevalidationEvidenceV1 {
  const body = avgProtocolBody(value), schema = (body as { schema?: unknown } | null)?.schema
  const raw = schema === 'storyforge.avg.raw-sound-revalidation'
  if (!raw && schema !== 'storyforge.avg.sound-requirements-revalidation') throw new Error('[avg-sound-reuse] 复验证据schema无效')
  const r = avgRecord(body, ['schema', 'version', 'noProviderRequest', 'retainedOrigin', 'sourceBuildRevision',
    'repairHash', 'sourceContextHash', 'inputs', 'contentHashVerified', ...(raw ? ['decoderVerified', 'hearing', 'authorAdopted'] : [])], 'sound revalidation evidence')
  if (r.version !== 1 || r.noProviderRequest !== true || r.contentHashVerified !== true) {
    throw new Error('[avg-sound-reuse] 复验证据必须明确版本、零请求及字节核验')
  }
  const inputs = avgUnique(avgList(r.inputs, 'sound revalidation inputs', (value, label) => {
    const ref = avgRecord(value, ['artifactKey', 'version', 'contentHash'], label)
    return { artifactKey: avgKey(ref.artifactKey, label), version: avgNumber(ref.version, label + ' version', 1, 1e9),
      contentHash: avgHash(ref.contentHash, label + ' hash') }
  }, 128), ref => ref.artifactKey, 'sound revalidation inputs')
  if (!inputs.length) throw new Error('[avg-sound-reuse] 复验必须保留非空准确输入引用')
  const common: AvgSoundRevalidationEvidenceBaseV1 = { version: 1, noProviderRequest: true,
    retainedOrigin: parseAvgGeneratedSoundSource(r.retainedOrigin),
    sourceBuildRevision: avgNumber(r.sourceBuildRevision, 'sound revalidation source revision', 0, 1e9),
    repairHash: avgHash(r.repairHash, 'sound revalidation repair'), sourceContextHash: avgHash(r.sourceContextHash, 'sound revalidation context'),
    inputs, contentHashVerified: true }
  if (!raw) return { schema: 'storyforge.avg.sound-requirements-revalidation', ...common }
  if (r.decoderVerified !== true || r.hearing !== 'unobserved' || r.authorAdopted !== false) {
    throw new Error('[avg-sound-reuse] 原音频复验不能冒充未核验解码、审听或作者采用')
  }
  return { schema: 'storyforge.avg.raw-sound-revalidation', ...common, decoderVerified: true, hearing: 'unobserved', authorAdopted: false }
}
