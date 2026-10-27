/** Existing product media/Blob owners, with exact versions and transaction witnesses. */
import { db } from '../db/schema'
import type { ProductMediaAsset, ProductMediaBlob, MediaBlobObjectRecordV1, WorkspaceScope, ProductRuntimeSession, ExactRunArtifactIdentityV1 } from '../types'
import { readProductMediaBlobData } from '../product-production/media-blob-store'
import { detectProductMediaMimeTypeV1 } from '../product-production/media-adapters'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgOpenAudioAssetV1, type TtrpgOpenAudioAssetV1, type TtrpgOpenAudioRequestV1 } from './open-audio-contract'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import * as p from './open-contract-parse'
import { cloneProductRuntimeMediaBindingV1 } from '../product/runtime-media-library'
import type { TtrpgOpenAudioRequestV2, TtrpgOpenGeneratedAudioOriginV1 } from './open-generated-audio-contract'

export interface TtrpgOpenAudioMediaWitnessV1 { asset: ProductMediaAsset; binding: ProductMediaBlob; object: MediaBlobObjectRecordV1 }
export interface TtrpgOpenAudioUploadTicketV1 { schema: 'storyforge.ttrpg-open-audio-upload-ticket'; key: string }
interface UploadGrant {
  scope: WorkspaceScope; sessionId: number; sessionKey: string; runtimeSourceHash: string; viewerKey: string
  sequence: number; stateHash: string; request: TtrpgOpenAudioRequestV1; asset: TtrpgOpenAudioAssetV1; assetId: number
}
const uploads = new WeakMap<TtrpgOpenAudioUploadTicketV1, UploadGrant>()
export interface TtrpgOpenAudioGeneratedTicketV2 {schema:'storyforge.ttrpg-open-audio-generated-ticket'; key:string}
interface GeneratedGrant extends Omit<UploadGrant, 'request'> {request:TtrpgOpenAudioRequestV2; generated:TtrpgOpenGeneratedAudioOriginV1}
const generated = new WeakMap<TtrpgOpenAudioGeneratedTicketV2,GeneratedGrant>()
/** Issued only after explicit rights preparation and a native original proof.
 * The prepared file survives refresh; this local permission never does. */
export function issueTtrpgOpenAudioGeneratedTicketV2(grant: GeneratedGrant): TtrpgOpenAudioGeneratedTicketV2 {
  const ticket: TtrpgOpenAudioGeneratedTicketV2 = Object.freeze({schema:'storyforge.ttrpg-open-audio-generated-ticket',key:crypto.randomUUID()})
  generated.set(ticket,structuredClone(grant));return ticket
}
export function readTtrpgOpenAudioGeneratedTicketV2(ticket:TtrpgOpenAudioGeneratedTicketV2|undefined,input:{sessionId:number;sessionKey:string;viewerKey:string;request:TtrpgOpenAudioRequestV2}) {
  const grant=ticket&&generated.get(ticket)
  if(!grant||grant.sessionId!==input.sessionId||grant.sessionKey!==input.sessionKey||grant.viewerKey!==input.viewerKey||stable(grant.request)!==stable(input.request))p.fail('请明确重新核对本人的原生成配音与使用权；复制或刷新不能恢复采用许可')
  return structuredClone(grant)
}
export function assertTtrpgOpenAudioExactRootsV1(row: ProductMediaAsset, expected: readonly ExactRunArtifactIdentityV1[] | undefined) {
  if (expected !== undefined && stable(p.json(row.exactArtifactRefsJson ?? null)) !== stable(expected)) p.fail('原生成媒资的完整准确证据根已变化，不能用匹配 WAV 替换来源')
}
/** Called only after the human service verifies the current owner and imports the actual supplied file.
 * This process-local pending grant is deliberately not portable or executable after refresh/import. */
export function issueTtrpgOpenAudioUploadTicketV1(grant: UploadGrant): TtrpgOpenAudioUploadTicketV1 {
  const ticket: TtrpgOpenAudioUploadTicketV1 = Object.freeze({ schema: 'storyforge.ttrpg-open-audio-upload-ticket', key: crypto.randomUUID() })
  uploads.set(ticket, structuredClone(grant)); return ticket
}
export function readTtrpgOpenAudioUploadTicketV1(ticket: TtrpgOpenAudioUploadTicketV1 | undefined, input: {
  sessionId: number; sessionKey: string; viewerKey: string; request: TtrpgOpenAudioRequestV1
}): UploadGrant {
  const grant = ticket && uploads.get(ticket)
  if (!grant || grant.sessionId !== input.sessionId || grant.sessionKey !== input.sessionKey || grant.viewerKey !== input.viewerKey
    || stable(grant.request) !== stable(input.request)) p.fail('请重新选择并核对本人上传的音频；复制、刷新或导入不能恢复未确认许可')
  return structuredClone(grant)
}
export function ttrpgOpenAudioAssetSnapshotV1(row: ProductMediaAsset, originSessionKey: string): TtrpgOpenAudioAssetV1 {
  return parseTtrpgOpenAudioAssetV1({ originSessionKey, assetKey: row.assetKey, version: row.version, kind: row.kind, name: row.name,
    mimeType: row.mimeType, byteSize: row.byteSize, durationMs: row.durationMs, contentHash: row.contentHash, source: row.source, license: row.license })
}
export async function readTtrpgOpenAudioMediaWitnessV1(input: {
  scope: WorkspaceScope; session: ProductRuntimeSession; expected: TtrpgOpenAudioAssetV1; exactArtifactRefs?: readonly ExactRunArtifactIdentityV1[]
}): Promise<{ witness: TtrpgOpenAudioMediaWitnessV1; data: ArrayBuffer }> {
  const expected = parseTtrpgOpenAudioAssetV1(input.expected), rows = await db.productMediaAssets.where('productRuntimeSessionId').equals(input.session.id!)
    .filter(row => row.assetKey === expected.assetKey && row.version === expected.version).toArray()
  const row = rows[0]
  if (rows.length !== 1 || !row?.id || row.productType !== 'ttrpg' || row.ownerKind !== 'runtime' || row.productReleaseId !== null
    || row.projectId !== input.scope.projectId || row.worldId !== input.scope.worldId || row.workId !== input.scope.workId
    || stable(ttrpgOpenAudioAssetSnapshotV1(row, expected.originSessionKey)) !== stable(expected)) p.fail('原准确音频媒资版本或 owner 不可用')
  assertTtrpgOpenAudioExactRootsV1(row, input.exactArtifactRefs)
  const bindings = await db.productMediaBlobs.where('mediaAssetId').equals(row.id).toArray(), binding = bindings[0]
  const object = binding && await db.mediaBlobObjects.get(binding.blobObjectId)
  if (bindings.length !== 1 || !binding?.id || !object?.id || binding.projectId !== row.projectId || binding.worldId !== row.worldId || binding.workId !== row.workId
    || object.projectId !== row.projectId || object.worldId !== row.worldId || object.workId !== row.workId) p.fail('原音频物理绑定不存在或跨作用域')
  const data = await readProductMediaBlobData({ scope: input.scope, blob: binding, expected })
  if (detectProductMediaMimeTypeV1(data) !== expected.mimeType) p.fail('音频实际文件格式与原声明不一致')
  return { witness: { asset: row, binding, object }, data }
}
export async function assertTtrpgOpenAudioMediaWitnessV1(witness: TtrpgOpenAudioMediaWitnessV1): Promise<void> {
  const [asset, binding, object] = await Promise.all([db.productMediaAssets.get(witness.asset.id!), db.productMediaBlobs.get(witness.binding.id!), db.mediaBlobObjects.get(witness.object.id!)])
  const { data: originalData, ...originalMetadata } = witness.object
  const { data, ...metadata } = object ?? { data: null }
  if (stable(asset) !== stable(witness.asset) || stable(binding) !== stable(witness.binding) || stable(metadata) !== stable(originalMetadata)
    || (data === null) !== (originalData === null)) p.fail('音频媒资或物理绑定在提交期间发生变化')
  if (data && originalData) {
    const a = new Uint8Array(data), b = new Uint8Array(originalData)
    if (a.length !== b.length || a.some((value, index) => value !== b[index])) p.fail('音频物理字节在提交期间发生变化')
  }
}
/** Only accepted cutpoint references are copied; shared physical bytes retain strong child bindings. */
export async function cloneTtrpgOpenAudioMediaV1(input: { parent: ProductRuntimeSession; child: ProductRuntimeSession; runtime: TtrpgRuntimeStateV2 }): Promise<void> {
  const assets = new Map<string, {asset:TtrpgOpenAudioAssetV1; roots?:ExactRunArtifactIdentityV1[]}>()
  for (const receipt of input.runtime.openRun?.audioReceipts ?? []) if (receipt.asset) {
    const identity = stable([receipt.asset.assetKey, receipt.asset.version]), previous = assets.get(identity)
    const value={asset:receipt.asset,...(receipt.version===2?{roots:receipt.generated.artifactRefs}:{})}
    if (previous && stable(previous) !== stable(value)) p.fail('音频原版本元数据或生成来源冲突')
    assets.set(identity, value)
  }
  if (!assets.size) return
  const parentRows = await db.productMediaAssets.where('productRuntimeSessionId').equals(input.parent.id!).toArray()
  for (const {asset:expected,roots} of assets.values()) {
    const matches = parentRows.filter(row => row.assetKey === expected.assetKey && row.version === expected.version), original = matches[0]
    if (matches.length !== 1 || !original?.id || original.ownerKind !== 'runtime' || original.productType !== 'ttrpg' || original.productReleaseId !== null
      || original.projectId !== input.child.projectId || original.worldId !== input.child.worldId || original.workId !== input.child.workId
      || stable(ttrpgOpenAudioAssetSnapshotV1(original, expected.originSessionKey)) !== stable(expected)) p.fail('分支缺少切点音频的原准确版本')
    assertTtrpgOpenAudioExactRootsV1(original, roots)
    const bindings = await db.productMediaBlobs.where('mediaAssetId').equals(original.id).toArray(), binding = bindings[0]
    if (bindings.length !== 1 || !binding || binding.projectId !== original.projectId || binding.worldId !== original.worldId || binding.workId !== original.workId) p.fail('分支缺少原音频强绑定')
    await cloneProductRuntimeMediaBindingV1({ asset: original, binding, targetSessionId: input.child.id! })
  }
}
