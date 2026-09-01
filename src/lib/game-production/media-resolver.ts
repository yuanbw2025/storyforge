import { db } from '../db/schema'
import type {
  FrozenRuntimeMediaAssetV2,
  GameBuildPreviewManifestV1,
  GameMediaResolverV1,
  GameRuntimePackageV2,
  ResolvedMediaCatalogV1,
  WorkspaceScope,
} from '../types'
import { assertRecordInScope, resolveScope } from '../world-engine/scope'
import { readProductReleaseMediaBytes } from './release-media'
import { acquireMediaBlobLease, readMediaBlobObjectData } from './media-blob-store'

interface ResolverLease {
  release(): Promise<void>
}

function assetCatalog(runtimePackage: GameRuntimePackageV2): Map<string, FrozenRuntimeMediaAssetV2> {
  return new Map((runtimePackage.presentation?.assets ?? []).map(asset => [asset.assetKey, asset]))
}

function createResolver(input: {
  runtimePackage: GameRuntimePackageV2
  readBytes(asset: FrozenRuntimeMediaAssetV2): Promise<ArrayBuffer>
  releaseAll(): Promise<void>
}): GameMediaResolverV1 {
  const assets = assetCatalog(input.runtimePackage)
  const urls = new Set<string>()
  let disposed = false
  const ensureActive = () => {
    if (disposed) throw new Error('[game-media-resolver] resolver 已释放')
  }
  return {
    async read(assetKey) {
      ensureActive()
      const asset = assets.get(assetKey)
      if (!asset) throw new Error(`[game-media-resolver] 未知媒资:${assetKey}`)
      const data = await input.readBytes(asset)
      return new Blob([data], { type: asset.mimeType })
    },
    async preload({ assetKeys, maximumBytes }): Promise<ResolvedMediaCatalogV1> {
      ensureActive()
      if (!Number.isFinite(maximumBytes) || maximumBytes < 0) {
        throw new Error('[game-media-resolver] maximumBytes 无效')
      }
      const result: ResolvedMediaCatalogV1 = { urls: {}, failures: [], usedBytes: 0 }
      for (const assetKey of [...new Set(assetKeys)]) {
        const asset = assets.get(assetKey)
        if (!asset) {
          result.failures.push({ assetKey, reason: 'RuntimePackage 未声明此媒资' })
          continue
        }
        if (result.usedBytes + asset.byteSize > maximumBytes) {
          result.failures.push({ assetKey, reason: '预加载容量预算已满' })
          continue
        }
        try {
          const blob = await this.read(assetKey)
          const url = URL.createObjectURL(blob)
          urls.add(url)
          result.urls[assetKey] = url
          result.usedBytes += asset.byteSize
        } catch (cause) {
          result.failures.push({ assetKey, reason: cause instanceof Error ? cause.message : String(cause) })
        }
      }
      return result
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const url of urls) URL.revokeObjectURL(url)
      urls.clear()
      void input.releaseAll()
    },
  }
}

export async function createReleaseGameMediaResolver(input: {
  scope: WorkspaceScope
  runtimePackage: GameRuntimePackageV2
}): Promise<GameMediaResolverV1> {
  const scope = await resolveScope({ scope: input.scope })
  return createResolver({
    runtimePackage: input.runtimePackage,
    async readBytes(asset) {
      if (asset.contentHash !== asset.blobContentHash) {
        throw new Error(`[game-media-resolver] Release 媒资哈希不闭合:${asset.assetKey}`)
      }
      return readProductReleaseMediaBytes({ scope, asset })
    },
    async releaseAll() {},
  })
}

export async function createBuildGameMediaResolver(input: {
  scope: WorkspaceScope
  gameBuildId: number
  preview: GameBuildPreviewManifestV1
}): Promise<GameMediaResolverV1> {
  const scope = await resolveScope({ scope: input.scope })
  const owner = `preview:${input.gameBuildId}:${crypto.randomUUID()}`
  const leases = new Map<number, ResolverLease>()
  const bindings = new Map(input.preview.mediaBindings.map(binding => [binding.assetKey, binding]))
  return createResolver({
    runtimePackage: input.preview.runtimePackage,
    async readBytes(asset) {
      const binding = bindings.get(asset.assetKey)
      if (!binding || binding.blobContentHash !== asset.blobContentHash) {
        throw new Error(`[game-media-resolver] Build Preview 媒资未绑定:${asset.assetKey}`)
      }
      const artifacts = await db.gameBuildArtifacts.where('buildId').equals(input.gameBuildId)
        .filter(row => row.artifactKey === binding.artifactKey
          && (row.status === 'accepted' || row.status === 'carried-forward')).toArray()
      const artifact = artifacts.sort((left, right) => right.version - left.version)[0]
      if (!artifact || artifact.blobObjectId == null || artifact.contentHash !== binding.blobContentHash
        || artifact.mimeType !== asset.mimeType || artifact.byteSize !== asset.byteSize
        || !await assertRecordInScope(scope, 'gameBuildArtifacts', artifact, { owner: 'work' })) {
        throw new Error(`[game-media-resolver] Build Artifact 缺失或不匹配:${binding.artifactKey}`)
      }
      if (!leases.has(artifact.blobObjectId)) {
        leases.set(artifact.blobObjectId, await acquireMediaBlobLease({
          scope,
          blobObjectId: artifact.blobObjectId,
          owner,
        }))
      }
      return readMediaBlobObjectData({
        scope,
        blobObjectId: artifact.blobObjectId,
        expected: { contentHash: asset.blobContentHash, byteSize: asset.byteSize, mimeType: asset.mimeType },
      })
    },
    async releaseAll() {
      await Promise.all([...leases.values()].map(lease => lease.release()))
      leases.clear()
    },
  })
}
