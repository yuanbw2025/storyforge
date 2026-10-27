import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductMediaAsset, ProductMediaBlob, ProductMediaKind, WorkspaceScope, ExactRunArtifactIdentityV1 } from '../types'
import { PRODUCT_MEDIA_KINDS } from '../types'
import { sanitizeSvg } from '../utils/sanitize-svg'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { sha256BinaryV1 } from '../media/blob-store'
import { putMediaBlobObject } from '../product-production/media-blob-store'
import { stableProductRuntimeJsonV1 as stable } from './runtime-values'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { extractExactArtifactOwnerRootsV1 } from '../memory/artifact-roots'
type ExactArtifactReader = typeof import('../memory/artifact-store').readAgentRunArtifactExactV1

const STABLE_ASSET_KEY = /^[a-zA-Z0-9._:-]+$/
const MEDIA_EVIDENCE_TAILS = new Map<string,Promise<void>>()
/** Only explicit opt-in metadata imports serialize here. No model call is
 * queued or retried. Another page holding the native lock is a visible error. */
function withMediaEvidenceLock<T>(key: string,operation: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) return await navigator.locks.request(key,{ ifAvailable: true },lock => {
      if (!lock) throw new Error('[product-runtime-media] 另一页面正在导入同一原媒资，请在原操作完成后明确继续')
      return operation()
    })
    return operation()
  }
  const result = (MEDIA_EVIDENCE_TAILS.get(key) ?? Promise.resolve()).then(run,run),tail = result.then(()=>undefined,()=>undefined)
  MEDIA_EVIDENCE_TAILS.set(key,tail)
  return result.finally(()=>{if (MEDIA_EVIDENCE_TAILS.get(key) === tail) MEDIA_EVIDENCE_TAILS.delete(key)})
}
const mediaRoots = () => {
  const roots = REGISTRY_BY_NAME.get('productMediaAssets')?.exactArtifactRoots
  if (!roots?.length) throw new Error('[product-runtime-media] 媒资逐字证据生命周期尚未登记')
  return roots
}
function mediaEvidence(refs: readonly ExactRunArtifactIdentityV1[] | undefined) {
  if (refs === undefined) return undefined
  if (!Array.isArray(refs) || refs.length < 1 || refs.length > 64) throw new Error('[product-runtime-media] 媒资逐字证据须有界且非空')
  if (refs.some(ref => !ref || typeof ref !== 'object' || Array.isArray(ref)
    || Object.keys(ref).sort().join(',') !== 'artifactKind,contentHash')) throw new Error('[product-runtime-media] 媒资逐字证据字段不精确')
  const normalized = extractExactArtifactOwnerRootsV1({ exactArtifactRefsJson: stable(refs) },mediaRoots())
  if (!normalized.length) throw new Error('[product-runtime-media] 媒资逐字证据注册路径未覆盖原引用')
  return { refs: normalized,json: stable(normalized) }
}
async function assertEvidenceAvailable(projectId: number, evidence: ReturnType<typeof mediaEvidence>,reader: ExactArtifactReader | undefined) {
  if (!evidence) return
  if (!reader) throw new Error('[product-runtime-media] 原逐字证据读取器尚未准备')
  for (const ref of evidence.refs) await reader({ projectId,...ref })
}
function assertDuplicateEvidence(asset: ProductMediaAsset, evidence: NonNullable<ReturnType<typeof mediaEvidence>>) {
  const refs = extractExactArtifactOwnerRootsV1(asset as unknown as Record<string,unknown>,mediaRoots())
  if (stable(refs) !== evidence.json) throw new Error('[product-runtime-media] 相同媒资版本的原逐字证据不同，不能覆盖或补造')
}

/** Branch lifecycle only. The product hook supplies cutpoint membership; this
 * shared writer verifies owners and exact rows, preserving immutable versions
 * and a strong binding to the same content-addressed physical object. */
export async function cloneProductRuntimeMediaBindingV1(input: {
  asset: ProductMediaAsset; binding: ProductMediaBlob; targetSessionId: number
}): Promise<void> {
  if (!Dexie.currentTransaction) throw new Error('[product-runtime-media] 分支媒资复制必须处于原分支事务中')
  extractExactArtifactOwnerRootsV1(input.asset as unknown as Record<string,unknown>,mediaRoots())
  const source = input.asset.productRuntimeSessionId == null ? null : await db.productRuntimeSessions.get(input.asset.productRuntimeSessionId)
  const target = await db.productRuntimeSessions.get(input.targetSessionId)
  const current = input.asset.id == null ? null : await db.productMediaAssets.get(input.asset.id)
  const binding = input.binding.id == null ? null : await db.productMediaBlobs.get(input.binding.id)
  const object = binding ? await db.mediaBlobObjects.get(binding.blobObjectId) : null
  if (!source?.id || !target?.id || target.status !== 'active' || target.parentSessionId !== source.id || target.parentThroughSequence === null
    || target.kind !== source.kind || target.runtimeSourceHash !== source.runtimeSourceHash || target.projectId !== source.projectId
    || target.worldId !== source.worldId || target.workId !== source.workId || input.asset.ownerKind !== 'runtime' || input.asset.productReleaseId !== null
    || input.asset.productType !== source.kind || input.asset.projectId !== source.projectId || input.asset.worldId !== source.worldId || input.asset.workId !== source.workId
    || input.binding.mediaAssetId !== input.asset.id || input.binding.projectId !== source.projectId || input.binding.worldId !== source.worldId || input.binding.workId !== source.workId
    || stable(current) !== stable(input.asset) || stable(binding) !== stable(input.binding)
    || !object || object.storageState !== 'ready' || object.projectId !== source.projectId || object.worldId !== source.worldId || object.workId !== source.workId
    || object.contentHash !== input.asset.contentHash || object.byteSize !== input.asset.byteSize || object.mimeType !== input.asset.mimeType
    || object.backend === 'indexeddb' && object.data === null || object.backend === 'opfs' && !object.opfsPath) throw new Error('[product-runtime-media] 分支媒资 owner、原版本或物理绑定已变化')
  const existing = await db.productMediaAssets.where('productRuntimeSessionId').equals(target.id)
    .filter(row => row.assetKey === input.asset.assetKey && row.version === input.asset.version).toArray()
  if (existing.length) throw new Error('[product-runtime-media] 子分支已有相同媒资版本，不能覆盖')
  const { id: _assetId, ...fields } = input.asset, { id: _bindingId, ...blobFields } = input.binding
  const now = Date.now(), id = await db.productMediaAssets.add({ ...fields, productRuntimeSessionId: target.id, createdAt: now, updatedAt: now })
  await db.productMediaBlobs.add({ ...blobFields, mediaAssetId: id, createdAt: now })
}

function assetKey(value: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 200 || !STABLE_ASSET_KEY.test(normalized)) {
    throw new Error('[product-runtime-media] assetKey 无效')
  }
  return normalized
}

/**
 * Runtime-owned media import boundary. Release media is materialized by the
 * ProductRelease publisher instead; runtime media can never leak into another
 * product instance merely because both instances share one Work.
 */
export async function importProductRuntimeMediaAssetV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
  assetKey: string
  kind: ProductMediaKind
  name: string
  blob: Blob
  altText?: string
  source?: string
  license?: string
  width?: number | null
  height?: number | null
  durationMs?: number | null
  characterTag?: string
  sceneTag?: string
  forceLatest?: boolean
  exactArtifactRefs?: readonly ExactRunArtifactIdentityV1[]
}): Promise<ProductMediaAsset> {
  input = { ...input,scope: structuredClone(input.scope),
    ...(input.exactArtifactRefs === undefined ? {} : { exactArtifactRefs: structuredClone(input.exactArtifactRefs) }) }
  const evidence = mediaEvidence(input.exactArtifactRefs)
  if (evidence) return withMediaEvidenceLock(`storyforge:media-evidence:${stable([db.name,input.scope,input.productRuntimeSessionId,assetKey(input.assetKey)])}`,
    () => importCapturedRuntimeMedia(input,evidence))
  return importCapturedRuntimeMedia(input,evidence)
}

async function importCapturedRuntimeMedia(input: Parameters<typeof importProductRuntimeMediaAssetV1>[0],evidence: ReturnType<typeof mediaEvidence>): Promise<ProductMediaAsset> {
  const scope = await resolveScope({ scope: input.scope })
  const session = await db.productRuntimeSessions.get(input.productRuntimeSessionId)
  if (!session || session.workId !== scope.workId || session.worldId !== scope.worldId
    || session.projectId !== scope.projectId || session.status === 'archived') {
    throw new Error('[product-runtime-media] 运行实例不存在、已归档或不属于当前 Work')
  }
  const stableKey = assetKey(input.assetKey)
  if (!PRODUCT_MEDIA_KINDS.includes(input.kind) || !input.name.trim() || input.blob.size > 100 * 1024 * 1024) {
    throw new Error('[product-runtime-media] 媒资输入无效或超过 100MB')
  }
  // Load optional evidence code before any binding transaction. Never await
  // a module fetch inside IndexedDB, or pull Harness into legacy media paths.
  const readExact = evidence ? (await import('../memory/artifact-store')).readAgentRunArtifactExactV1 : undefined
  const rawData = await input.blob.arrayBuffer()
  const isSvg = input.blob.type.toLowerCase() === 'image/svg+xml'
  const data = isSvg
    ? (() => {
        const sanitized = sanitizeSvg(new TextDecoder().decode(rawData))
        if (!sanitized) throw new Error('[product-runtime-media] SVG 媒资无法安全解析')
        return new TextEncoder().encode(sanitized).buffer
      })()
    : rawData
  const contentHash = await sha256BinaryV1(data)
  const existing = await db.productMediaAssets
    .where('productRuntimeSessionId').equals(input.productRuntimeSessionId)
    .filter(row => row.ownerKind === 'runtime' && row.assetKey === stableKey).toArray()
  const duplicate = existing.find(row => row.contentHash === contentHash)
  const latestVersion = Math.max(0, ...existing.map(row => row.version))
  if (duplicate && (!input.forceLatest || duplicate.version === latestVersion)) {
    if (!evidence) return duplicate
    return db.transaction('rw',scopeTransactionTables(db.productRuntimeSessions,db.productMediaAssets,db.agentRunArtifacts),async()=>{
      const current = await db.productMediaAssets.get(duplicate.id!),owner = await db.productRuntimeSessions.get(session.id!)
      if (!current || stable(current) !== stable(duplicate) || !owner || owner.status === 'archived'
        || owner.projectId !== scope.projectId || owner.worldId !== scope.worldId || owner.workId !== scope.workId || owner.kind !== session.kind
        || current.projectId !== scope.projectId || current.worldId !== scope.worldId || current.workId !== scope.workId
        || current.productType !== session.kind || current.productReleaseId !== null || current.productRuntimeSessionId !== session.id) throw new Error('[product-runtime-media] 原媒资或拥有者在复用期间已变化')
      assertDuplicateEvidence(current,evidence);await assertEvidenceAvailable(scope.projectId,evidence,readExact);return current
    })
  }
  await assertEvidenceAvailable(scope.projectId,evidence,readExact)

  const blobObject = await putMediaBlobObject({
    scope,
    data,
    mimeType: input.blob.type.toLowerCase() || 'application/octet-stream',
    expectedContentHash: contentHash,
    sanitizedSvg: isSvg,
  })
  const version = latestVersion + 1
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(
    db.productRuntimeSessions, db.productMediaAssets, db.productMediaBlobs, db.mediaBlobObjects, ...(evidence ? [db.agentRunArtifacts] : []),
  ), async () => {
    const currentSession = await db.productRuntimeSessions.get(input.productRuntimeSessionId)
    if (!currentSession || currentSession.workId !== scope.workId || currentSession.worldId !== scope.worldId
      || currentSession.projectId !== scope.projectId || currentSession.status === 'archived'
      || currentSession.kind !== session.kind) {
      throw new Error('[product-runtime-media] 运行实例在媒资绑定前失效')
    }
    const currentBlobObject = await db.mediaBlobObjects.get(blobObject.id!)
    if (!currentBlobObject || currentBlobObject.workId !== scope.workId || currentBlobObject.storageState !== 'ready') {
      throw new Error('[product-runtime-media] 内容寻址对象在绑定前丢失或不可用')
    }
    let currentVersion = version
    if (evidence) {
      await assertEvidenceAvailable(scope.projectId,evidence,readExact)
      const currentAssets = await db.productMediaAssets.where('productRuntimeSessionId').equals(session.id!)
        .filter(row => row.ownerKind === 'runtime' && row.assetKey === stableKey).toArray()
      const currentDuplicate = currentAssets.find(row => row.contentHash === contentHash),latest = Math.max(0,...currentAssets.map(row => row.version))
      if (currentDuplicate && (!input.forceLatest || currentDuplicate.version === latest)) {
        if (currentDuplicate.projectId !== scope.projectId || currentDuplicate.worldId !== scope.worldId || currentDuplicate.workId !== scope.workId
          || currentDuplicate.productType !== session.kind || currentDuplicate.productReleaseId !== null) throw new Error('[product-runtime-media] 并发媒资的原拥有者不一致')
        assertDuplicateEvidence(currentDuplicate,evidence);return currentDuplicate
      }
      currentVersion = latest + 1
    }
    const row = stampNewRecord(scope, 'productMediaAssets', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      ownerKind: 'runtime',
      productType: currentSession.kind,
      productReleaseId: null,
      productRuntimeSessionId: currentSession.id!,
      assetKey: stableKey,
      version: currentVersion,
      kind: input.kind,
      name: input.name.trim(),
      mimeType: input.blob.type.toLowerCase() || 'application/octet-stream',
      byteSize: data.byteLength,
      width: input.width ?? null,
      height: input.height ?? null,
      durationMs: input.durationMs ?? null,
      contentHash,
      source: input.source?.trim() ?? '',
      license: input.license?.trim() ?? '',
      altText: input.altText?.trim() ?? '',
      characterTag: input.characterTag?.trim() ?? '',
      sceneTag: input.sceneTag?.trim() ?? '',
      ...(evidence ? { exactArtifactRefsJson: evidence.json } : {}),
      createdAt: now,
      updatedAt: now,
    } satisfies ProductMediaAsset, { owner: 'work' })
    const id = await db.productMediaAssets.add(row) as number
    await db.productMediaBlobs.add(stampNewRecord(scope, 'productMediaBlobs', {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      mediaAssetId: id,
      blobObjectId: currentBlobObject.id!,
      data: null,
      createdAt: now,
    } satisfies ProductMediaBlob, { owner: 'work' }))
    return { ...row, id }
  })
}
