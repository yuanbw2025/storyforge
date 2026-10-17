import { db } from '../db/schema'
import { avgRuntimeStage } from '../avg/executable-module'
import type {
  FrozenRuntimeMediaAssetV2,
  AnyProductBuildPreviewManifest,
  ProductMediaResolverV1,
  AnyProductRuntimePackage,
  ResolvedMediaCatalogV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { readProductReleaseMediaBytes } from './release-media'
import { acquireMediaBlobLease, readMediaBlobObjectData } from './media-blob-store'

interface ResolverLease {
  release(): Promise<void>
}

// React may dispose one preview resolver and mount the next in the same tick.
// Serialize lease release before the next resolver acquires so switching saves
// never produces a false "other reader" degradation.
let buildResolverLeaseReleaseBarrier: Promise<void> = Promise.resolve()

function assetCatalog(runtimePackage: AnyProductRuntimePackage): Map<string, FrozenRuntimeMediaAssetV2> {
  return new Map((avgRuntimeStage(runtimePackage)?.assets ?? []).map(asset => [asset.assetKey, asset]))
}

function createResolver(input: {
  runtimePackage: AnyProductRuntimePackage
  readBytes(asset: FrozenRuntimeMediaAssetV2): Promise<ArrayBuffer>
  trimReadCache?(retainedKeys: ReadonlySet<string>): void
  releaseAll(pending: Promise<void>): Promise<void>
}): ProductMediaResolverV1 {
  const assets = assetCatalog(input.runtimePackage)
  const urls = new Map<string, string>()
  let disposed = false
  let pending: Promise<void> = Promise.resolve()
  const ensureActive = () => {
    if (disposed) throw new Error('[product-media-resolver] resolver 已释放')
  }
  // A window switch cannot revoke a URL midway through an earlier preload.
  // Use the internal reader below, never recursively enqueue this.read().
  const enqueue = <T>(operation:()=>Promise<T>,checkActive=true):Promise<T> => {
    const result=pending.then(()=>{if(checkActive)ensureActive();return operation()})
    pending=result.then(()=>undefined,()=>undefined)
    return result
  }
  const read = async (assetKey:string) => {
    ensureActive()
    const asset=assets.get(assetKey)
    if(!asset)throw new Error(`[product-media-resolver] 未知媒资:${assetKey}`)
    const data=await input.readBytes(asset)
    ensureActive()
    return new Blob([data],{type:asset.mimeType})
  }
  return {
    read: assetKey=>enqueue(()=>read(assetKey)),
    preload({ assetKeys, maximumBytes, retainOnlyRequested }): Promise<ResolvedMediaCatalogV1> {
      if(disposed)return Promise.reject(new Error('[product-media-resolver] resolver 已释放'))
      const keys=[...new Set(assetKeys)]
      // An issued preload keeps its historical per-asset failure result if
      // disposal happens in the queue; a new call after disposal rejects above.
      return enqueue(async()=>{
      if (!Number.isFinite(maximumBytes) || maximumBytes < 0) {
        throw new Error('[product-media-resolver] maximumBytes 无效')
      }
      const result: ResolvedMediaCatalogV1 = { urls: {}, failures: [], usedBytes: 0 }
      const allowed=new Set<string>()
      if(retainOnlyRequested){
        let reserved=0
        for(const key of keys){const asset=assets.get(key);if(asset&&reserved+asset.byteSize<=maximumBytes){allowed.add(key);reserved+=asset.byteSize}}
        for(const [key,url] of urls)if(!allowed.has(key)){URL.revokeObjectURL(url);urls.delete(key)}
        input.trimReadCache?.(allowed)
      }
      for (const assetKey of keys) {
        const asset = assets.get(assetKey)
        if (!asset) {
          result.failures.push({ assetKey, reason: 'RuntimePackage 未声明此媒资' })
          continue
        }
        if (retainOnlyRequested ? !allowed.has(assetKey) : result.usedBytes + asset.byteSize > maximumBytes) {
          result.failures.push({ assetKey, reason: '预加载容量预算已满' })
          continue
        }
        try {
          const cached = urls.get(assetKey)
          if (cached) {
            result.urls[assetKey] = cached
            result.usedBytes += asset.byteSize
            continue
          }
          const blob = await read(assetKey)
          ensureActive()
          const url = URL.createObjectURL(blob)
          urls.set(assetKey, url)
          result.urls[assetKey] = url
          result.usedBytes += asset.byteSize
        } catch (cause) {
          result.failures.push({ assetKey, reason: cause instanceof Error ? cause.message : String(cause) })
        }
      }
      return result
      },false)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
      void input.releaseAll(pending)
    },
  }
}

export async function createReleaseProductMediaResolver(input: {
  scope: WorkspaceScope
  productReleaseId: number
  runtimePackage: AnyProductRuntimePackage
}): Promise<ProductMediaResolverV1> {
  const scope = await resolveScope({ scope: input.scope })
  return createResolver({
    runtimePackage: input.runtimePackage,
    async readBytes(asset) {
      if (asset.contentHash !== asset.blobContentHash) {
        throw new Error(`[product-media-resolver] Release 媒资哈希不闭合:${asset.assetKey}`)
      }
      return readProductReleaseMediaBytes({
        scope,
        productReleaseId: input.productReleaseId,
        asset,
      })
    },
    async releaseAll() {},
  })
}

export async function createBuildProductMediaResolver(input: {
  scope: WorkspaceScope
  productBuildId: number
  preview: AnyProductBuildPreviewManifest
}): Promise<ProductMediaResolverV1> {
  const scope = await resolveScope({ scope: input.scope })
  // A browser Work is one logical read owner. React StrictMode, HMR and quick
  // Build switches may legitimately keep two read-only resolvers alive for a
  // few milliseconds; a random per-component owner turns that overlap into a
  // false exclusive-lease conflict. Blob scope and artifact hashes still gate
  // every read, while a stable Work owner lets those readers share the lease.
  const owner = `preview:work-${scope.workId}`
  const leases = new Map<number, ResolverLease>()
  const byteReads = new Map<number, Promise<ArrayBuffer>>()
  const assetBlobIds = new Map<string,number>()
  const bindings = new Map(input.preview.mediaBindings.map(binding => [binding.assetKey, binding]))
  return createResolver({
    runtimePackage: input.preview.runtimePackage,
    async readBytes(asset) {
      // Capture before any DB await: dispose immediately publishes its release
      // barrier, which this already-running read must never wait on itself.
      const readBarrier=buildResolverLeaseReleaseBarrier
      const binding = bindings.get(asset.assetKey)
      if (!binding || binding.blobContentHash !== asset.blobContentHash) {
        throw new Error(`[product-media-resolver] Build Preview 媒资未绑定:${asset.assetKey}`)
      }
      const artifacts = await db.productBuildArtifacts.where('buildId').equals(input.productBuildId)
        .filter(row => row.artifactKey === binding.artifactKey
          && (row.status === 'accepted' || row.status === 'carried-forward')).toArray()
      const artifact = artifacts.sort((left, right) => right.version - left.version)[0]
      if (!artifact || artifact.blobObjectId == null || artifact.contentHash !== binding.blobContentHash
        || artifact.mimeType !== asset.mimeType || artifact.byteSize !== asset.byteSize
        || !await assertRecordInScope(scope, 'productBuildArtifacts', artifact, { owner: 'work' })) {
        throw new Error(`[product-media-resolver] Build Artifact 缺失或不匹配:${binding.artifactKey}`)
      }
      const blobObjectId = artifact.blobObjectId
      assetBlobIds.set(asset.assetKey,blobObjectId)
      const existingRead = byteReads.get(blobObjectId)
      if (existingRead) return (await existingRead).slice(0)
      const read = (async () => {
        await readBarrier
        if (!leases.has(blobObjectId)) {
          leases.set(blobObjectId, await acquireMediaBlobLease({ scope, blobObjectId, owner }))
        }
        return readMediaBlobObjectData({
          scope,
          blobObjectId,
          expected: { contentHash: asset.blobContentHash, byteSize: asset.byteSize, mimeType: asset.mimeType },
        })
      })()
      byteReads.set(blobObjectId, read)
      try { return (await read).slice(0) }
      catch (cause) { byteReads.delete(blobObjectId); throw cause }
    },
    trimReadCache(retainedKeys) {
      const ids=new Set([...retainedKeys].flatMap(key=>assetBlobIds.has(key)?[assetBlobIds.get(key)!]:[]))
      for(const id of byteReads.keys())if(!ids.has(id))byteReads.delete(id)
    },
    async releaseAll(pending) {
      const previousBarrier = buildResolverLeaseReleaseBarrier
      const release = (async () => {
        await previousBarrier.catch(() => undefined)
        await pending
        await Promise.allSettled([...byteReads.values()])
        await Promise.all([...leases.values()].map(lease => lease.release()))
        leases.clear()
        byteReads.clear()
      })()
      buildResolverLeaseReleaseBarrier = release.catch(() => undefined)
      await release
    },
  })
}
