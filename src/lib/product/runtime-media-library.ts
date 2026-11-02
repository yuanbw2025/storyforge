import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductMediaAsset, ProductMediaBlob, ProductMediaKind, ProductRuntimeSession, WorkspaceScope, ExactRunArtifactIdentityV1 } from '../types'
import { PRODUCT_MEDIA_KINDS } from '../types'
import { sanitizeSvg } from '../utils/sanitize-svg'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { sha256BinaryV1 } from '../media/blob-store'
import { putMediaBlobObject, readVerifiedMediaBlobObjectData, type MediaBlobCommitGuardV1 } from '../product-production/media-blob-store'
import { stableProductRuntimeJsonV1 as stable } from './runtime-values'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { extractExactArtifactOwnerRootsV1 } from '../memory/artifact-roots'
import { assertTextOpenWorldRuntimeNewWorkV1, TextOpenWorldSourceAdmissionErrorV1 } from '../open-world/source-admission'
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

interface RuntimeMediaCloneInputV1 {
  asset: ProductMediaAsset; binding: ProductMediaBlob; targetSessionId: number
}

async function readRuntimeMediaCloneRowsV1(input: RuntimeMediaCloneInputV1) {
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
    || !current || !binding || stable(current) !== stable(input.asset) || !sameMediaBindingV1(binding, input.binding)
    || !object || object.storageState !== 'ready' || object.projectId !== source.projectId || object.worldId !== source.worldId || object.workId !== source.workId
    || object.contentHash !== input.asset.contentHash || object.byteSize !== input.asset.byteSize || object.mimeType !== input.asset.mimeType
    || object.backend === 'indexeddb' && object.data === null || object.backend === 'opfs' && !object.opfsPath) throw new Error('[product-runtime-media] 分支媒资 owner、原版本或物理绑定已变化')
  return { source, target, asset: current, binding, object }
}

const PREPARED_OPEN_WORLD_MEDIA_CLONE_V1: unique symbol = Symbol('verified-open-world-media-clone')
export interface PreparedTextOpenWorldRuntimeMediaCloneV1 {
  readonly [PREPARED_OPEN_WORLD_MEDIA_CLONE_V1]: true
  /** Declares the native transaction stores, never the permission itself. */
  readonly transactionTables: MediaBlobCommitGuardV1['transactionTables']
}
const preparedOpenWorldMediaClonesV1 = new WeakMap<PreparedTextOpenWorldRuntimeMediaCloneV1, {
  input: RuntimeMediaCloneInputV1
  assetObject: ProductMediaAsset
  bindingObject: ProductMediaBlob
  rows: Awaited<ReturnType<typeof readRuntimeMediaCloneRowsV1>>
  assertCurrentSource: (target: Awaited<ReturnType<typeof readRuntimeMediaCloneRowsV1>>['target']) => Promise<void>
}>()

function sameMediaBytesV1(a: ArrayBuffer | null, b: ArrayBuffer | null): boolean {
  if (a === null || b === null) return a === b
  if (a.byteLength !== b.byteLength) return false
  const av = new Uint8Array(a), bv = new Uint8Array(b)
  for (let index = 0; index < av.length; index += 1) if (av[index] !== bv[index]) return false
  return true
}

function sameMediaBindingV1(left: ProductMediaBlob, right: ProductMediaBlob): boolean {
  return stable({ ...left, data: null }) === stable({ ...right, data: null })
    && sameMediaBytesV1(left.data, right.data)
}

function sameCloneInputV1(left: RuntimeMediaCloneInputV1, right: RuntimeMediaCloneInputV1): boolean {
  return left.targetSessionId === right.targetSessionId && stable(left.asset) === stable(right.asset)
    && sameMediaBindingV1(left.binding, right.binding)
}

/** OW alone needs this new-operation preparation. The strict frozen reader
 * and any module loading run outside IndexedDB; the original transaction only
 * compares captured authority. Other product hooks keep their existing API. */
export async function prepareTextOpenWorldRuntimeMediaCloneV1(
  input: RuntimeMediaCloneInputV1,
): Promise<PreparedTextOpenWorldRuntimeMediaCloneV1> {
  if (Dexie.currentTransaction) throw new Error('[product-runtime-media] 请在分支事务外先核验文字开放世界的真实冻结来源')
  const assetObject = input.asset, bindingObject = input.binding
  const captured = structuredClone(input)
  const rows = await readRuntimeMediaCloneRowsV1(captured)
  if (rows.target.kind !== 'text-open-world') throw new Error('[product-runtime-media] 此来源准备仅适用于文字开放世界媒资克隆')
  const runtime = await import('./runtime-core')
  const frozen = await runtime.verifyFormalRuntimeSourceV1(rows.target, ['text-open-world'])
  assertTextOpenWorldRuntimeNewWorkV1(frozen.runtimePackage, '克隆新的运行媒资绑定')
  const transactionTables = Object.freeze(scopeTransactionTables(db.productRuntimeSessions,
    db.productReleases, db.productBuilds, db.productProductions, db.productProductionBriefs))
  const proof: PreparedTextOpenWorldRuntimeMediaCloneV1 = Object.freeze({
    [PREPARED_OPEN_WORLD_MEDIA_CLONE_V1]: true as const, transactionTables,
  })
  preparedOpenWorldMediaClonesV1.set(proof, {
    input: captured, assetObject, bindingObject, rows: structuredClone(rows),
    assertCurrentSource: target => runtime.assertFormalRuntimeSourceUnchangedV1({ previewSession: rows.target, session: target, frozen }),
  })
  return proof
}

/** Branch lifecycle only. The product hook supplies cutpoint membership; this
 * shared writer verifies owners and exact rows, preserving immutable versions
 * and a strong binding to the same content-addressed physical object. */
export async function cloneProductRuntimeMediaBindingV1(input: RuntimeMediaCloneInputV1 & {
  preparedSource?: PreparedTextOpenWorldRuntimeMediaCloneV1
}): Promise<void> {
  if (!Dexie.currentTransaction) throw new Error('[product-runtime-media] 分支媒资复制必须处于原分支事务中')
  const assetObject = input.asset, bindingObject = input.binding
  // Capture scalar request fields and the original opaque proof identities.
  // ArrayBuffer data is compared with the native row below; formal writes use
  // that independently read row, never caller memory after an await.
  input = { ...input, asset: { ...assetObject }, binding: { ...bindingObject } }
  const { source, target, asset, binding, object } = await readRuntimeMediaCloneRowsV1(input)
  const existing = await db.productMediaAssets.where('productRuntimeSessionId').equals(target.id!)
    .filter(row => row.assetKey === input.asset.assetKey && row.version === input.asset.version).toArray()
  if (existing.length) {
    const omitAssetTimes = ({ id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...fields }: ProductMediaAsset) => fields
    const omitBindingTimes = ({ id: _id, createdAt: _createdAt, ...fields }: ProductMediaBlob) => fields
    const row = existing[0]
    const saved = await db.productMediaBlobs.where('mediaAssetId').equals(row.id!).toArray()
    if (existing.length === 1 && saved.length === 1
      && stable(omitAssetTimes(row)) === stable({ ...omitAssetTimes(asset), productRuntimeSessionId: target.id })
      && stable(omitBindingTimes(saved[0])) === stable({ ...omitBindingTimes(binding), mediaAssetId: row.id })
      && sameMediaBytesV1(saved[0].data, binding.data)) return
    throw new Error('[product-runtime-media] 子分支已有不同的相同媒资版本，不能覆盖')
  }
  if (target.kind === 'text-open-world') {
    const proof = input.preparedSource && preparedOpenWorldMediaClonesV1.get(input.preparedSource)
    if (!proof || proof.assetObject !== assetObject || proof.bindingObject !== bindingObject
      || !sameCloneInputV1({ asset: input.asset, binding: input.binding, targetSessionId: input.targetSessionId }, proof.input)
      || stable(source) !== stable(proof.rows.source) || stable(target) !== stable(proof.rows.target)
      || stable(asset) !== stable(proof.rows.asset) || !sameMediaBindingV1(binding, proof.rows.binding)
      || stable(object) !== stable(proof.rows.object) || !sameMediaBytesV1(object.data, proof.rows.object.data)) {
      throw new TextOpenWorldSourceAdmissionErrorV1('克隆新的运行媒资前必须在事务外核验同一父子实例与原绑定')
    }
    await resolveScope({ scope: { projectId: target.projectId, worldId: target.worldId!, workId: target.workId! } })
    await proof.assertCurrentSource(target)
  }
  const { id: _assetId, ...fields } = asset, { id: _bindingId, ...blobFields } = binding
  const now = Date.now(), id = await db.productMediaAssets.add({ ...fields, productRuntimeSessionId: target.id!, createdAt: now, updatedAt: now })
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

function sameRuntimeMediaRequestMetadataV1(asset: ProductMediaAsset,
  input: Parameters<typeof importProductRuntimeMediaAssetV1>[0], contentHash: string, byteSize: number): boolean {
  const expected = {
    kind: input.kind, name: input.name.trim(), mimeType: input.blob.type.toLowerCase() || 'application/octet-stream',
    contentHash, byteSize, width: input.width ?? null, height: input.height ?? null, durationMs: input.durationMs ?? null,
    source: input.source?.trim() ?? '', license: input.license?.trim() ?? '', altText: input.altText?.trim() ?? '',
    characterTag: input.characterTag?.trim() ?? '', sceneTag: input.sceneTag?.trim() ?? '',
  }
  return Object.entries(expected).every(([key, value]) => asset[key as keyof ProductMediaAsset] === value)
}

/** An existing version is evidence, not permission to import another one.
 * Verify its original owner/binding/bytes without reopening a missing Release;
 * the final native read transaction cannot create or repair any record. */
async function readExactRuntimeMediaDuplicateV1(input: {
  scope: WorkspaceScope; session: ProductRuntimeSession; asset: ProductMediaAsset; data: ArrayBuffer
  evidence: ReturnType<typeof mediaEvidence>; readExact: ExactArtifactReader | undefined
}): Promise<ProductMediaAsset> {
  const { scope, session, asset, data, evidence, readExact } = input
  const bindings = await db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).toArray()
  const binding = bindings.length === 1 ? bindings[0] : undefined
  const object = binding ? await db.mediaBlobObjects.get(binding.blobObjectId) : undefined
  if (asset.ownerKind !== 'runtime' || asset.productType !== session.kind || asset.productReleaseId !== null
    || asset.productRuntimeSessionId !== session.id || asset.projectId !== scope.projectId
    || asset.worldId !== scope.worldId || asset.workId !== scope.workId
    || !binding || binding.projectId !== scope.projectId || binding.worldId !== scope.worldId || binding.workId !== scope.workId
    || !object || object.projectId !== scope.projectId || object.worldId !== scope.worldId || object.workId !== scope.workId
    || object.contentHash !== asset.contentHash || object.byteSize !== asset.byteSize || object.mimeType !== asset.mimeType) {
    throw new Error('[product-runtime-media] 原媒资、原绑定或物理对象的 owner/metadata 不闭合')
  }
  const originalBytes = await readVerifiedMediaBlobObjectData(object)
  if (!sameMediaBytesV1(data, originalBytes)) throw new Error('[product-runtime-media] 原媒资物理字节不匹配')
  return db.transaction('r', scopeTransactionTables(db.productRuntimeSessions, db.productMediaAssets,
    db.productMediaBlobs, db.mediaBlobObjects, ...(evidence ? [db.agentRunArtifacts] : [])), async () => {
    await resolveScope({ scope })
    const [owner, current, currentBindings, currentObject] = await Promise.all([
      db.productRuntimeSessions.get(session.id!), db.productMediaAssets.get(asset.id!),
      db.productMediaBlobs.where('mediaAssetId').equals(asset.id!).toArray(), db.mediaBlobObjects.get(object.id!),
    ])
    if (!owner || stable(owner) !== stable(session) || !current || stable(current) !== stable(asset)
      || currentBindings.length !== 1 || !sameMediaBindingV1(currentBindings[0], binding)
      || !currentObject || stable(currentObject) !== stable(object) || !sameMediaBytesV1(currentObject.data, object.data)) {
      throw new Error('[product-runtime-media] 原媒资或拥有者在只读复用期间已变化')
    }
    if (evidence) assertDuplicateEvidence(current, evidence)
    await assertEvidenceAvailable(scope.projectId, evidence, readExact)
    return current
  })
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
  if (session.kind === 'text-open-world' && duplicate && (!input.forceLatest || duplicate.version === latestVersion)
    && sameRuntimeMediaRequestMetadataV1(duplicate, input, contentHash, data.byteLength)) {
    return readExactRuntimeMediaDuplicateV1({ scope, session, asset: duplicate, data, evidence, readExact })
  }
  // A missing source may be tolerated only by the exact read above. Every
  // genuinely new import/version/metadata choice still verifies real authority.
  const runtimeAuthority = session.kind === 'text-open-world' ? await import('./runtime-core') : null
  const frozen = runtimeAuthority
    ? await runtimeAuthority.verifyFormalRuntimeSourceV1(session, ['text-open-world']) : null
  if (frozen) assertTextOpenWorldRuntimeNewWorkV1(frozen.runtimePackage, '新增运行媒资')
  const sourceTables = frozen ? [db.productReleases, db.productBuilds, db.productProductions, db.productProductionBriefs] : []
  const assertCurrentSource = async (): Promise<void> => {
    const current = await db.productRuntimeSessions.get(session.id!)
    if (!current || stable(current) !== stable(session)) throw new Error('[product-runtime-media] 运行实例在媒资写入前发生变化')
    if (frozen && runtimeAuthority) {
      await runtimeAuthority.assertFormalRuntimeSourceUnchangedV1({ previewSession: session, session: current, frozen })
    }
  }
  if (duplicate && (!input.forceLatest || duplicate.version === latestVersion)) {
    if (!evidence && !frozen) return duplicate
    return db.transaction('rw',scopeTransactionTables(db.productRuntimeSessions,db.productMediaAssets,db.agentRunArtifacts,...sourceTables),async()=>{
      const current = await db.productMediaAssets.get(duplicate.id!),owner = await db.productRuntimeSessions.get(session.id!)
      if (!current || stable(current) !== stable(duplicate) || !owner || owner.status === 'archived'
        || owner.projectId !== scope.projectId || owner.worldId !== scope.worldId || owner.workId !== scope.workId || owner.kind !== session.kind
        || current.projectId !== scope.projectId || current.worldId !== scope.worldId || current.workId !== scope.workId
        || current.productType !== session.kind || current.productReleaseId !== null || current.productRuntimeSessionId !== session.id) throw new Error('[product-runtime-media] 原媒资或拥有者在复用期间已变化')
      if (frozen) await assertCurrentSource()
      if (evidence) assertDuplicateEvidence(current,evidence)
      await assertEvidenceAvailable(scope.projectId,evidence,readExact);return current
    })
  }
  await assertEvidenceAvailable(scope.projectId,evidence,readExact)

  const blobObject = await putMediaBlobObject({
    scope,
    data,
    mimeType: input.blob.type.toLowerCase() || 'application/octet-stream',
    expectedContentHash: contentHash,
    sanitizedSvg: isSvg,
    ...(frozen ? { commitGuard: {
      transactionTables: [db.productRuntimeSessions, ...sourceTables],
      assertCurrentInTransaction: assertCurrentSource,
    } } : {}),
  })
  const version = latestVersion + 1
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(
    db.productRuntimeSessions, db.productMediaAssets, db.productMediaBlobs, db.mediaBlobObjects, ...sourceTables, ...(evidence ? [db.agentRunArtifacts] : []),
  ), async () => {
    const currentSession = await db.productRuntimeSessions.get(input.productRuntimeSessionId)
    if (!currentSession || currentSession.workId !== scope.workId || currentSession.worldId !== scope.worldId
      || currentSession.projectId !== scope.projectId || currentSession.status === 'archived'
      || currentSession.kind !== session.kind) {
      throw new Error('[product-runtime-media] 运行实例在媒资绑定前失效')
    }
    if (frozen) await assertCurrentSource()
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
