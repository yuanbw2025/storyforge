import Dexie from 'dexie'
import { db } from '../db/schema'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readVerifiedMediaBlobObjectData } from '../product-production/media-blob-store'
import { verifyProductMediaRuntimeUrlsV1 } from '../product-production/media-runtime-verifier'
import { compileAvgExecutablePackageV2 } from './executable-package'
import type { AvgAuthorStageV1 } from './author-workspace-contract'
import { assertAvgMediaBytesV1 } from './media-import-contract'

export interface AvgAssemblyValidationV1 {
  schema: 'storyforge.avg.assembly-validation'
  version: 1
  moduleHash: string
}

/** Exact metadata and bytes must be backed by this Work's immutable upload.
 * Semantic asset keys survive backup remapping; local blob IDs never enter payloads. */
export async function assertAvgOwnedStageMediaV1(scope: WorkspaceScope, payload: AvgAuthorStageV1) {
  if (!payload.stage.assets.length) return
  const keys = new Set(payload.stage.assets.map(asset => asset.assetKey))
  const rows = await db.avgDraftMedia.where('workId').equals(scope.workId).filter(row => {
    try { return keys.has((JSON.parse(row.assetJson) as { assetKey: string }).assetKey) } catch { return false }
  }).limit(129).toArray()
  const startedAt = Date.now()
  for (const asset of payload.stage.assets) {
    const matches = rows.filter(row => canonicalProductProductionJsonV2(JSON.parse(row.assetJson)) === canonicalProductProductionJsonV2(asset))
    if (matches.length !== 1 || !await assertRecordInScope(scope, 'avgDraftMedia', matches[0]!, { owner: 'work' })) throw new Error(`[avg] 演出素材元数据未导入当前作品:${asset.assetKey}`)
    if (!asset.source.trim() || !asset.license.trim() || asset.byteSize < 1) throw new Error('[avg] 演出素材缺少来源、授权或真实字节')
    if (asset.mimeType.startsWith('image/') ? !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width! < 1 || asset.height! < 1
      : !asset.mimeType.startsWith('audio/') || !Number.isFinite(asset.durationMs) || asset.durationMs! <= 0) throw new Error('[avg] 演出素材尚未经过实际解码导入')
    const blob = await db.mediaBlobObjects.get(matches[0]!.blobObjectId)
    if (!blob || !await assertRecordInScope(scope, 'mediaBlobObjects', blob, { owner: 'work' }) || blob.contentHash !== asset.blobContentHash
      || blob.byteSize !== asset.byteSize || blob.mimeType !== asset.mimeType) throw new Error('[avg] 演出素材字节引用已 stale')
    // Metadata in a restored draft is not decoder evidence. Reinspect the exact
    // bytes; keep OPFS/digest/browser observation inside one DB-free lease.
    const inspect = async () => {
      const bytes = await readVerifiedMediaBlobObjectData(blob)
      assertAvgMediaBytesV1(bytes, asset.mimeType)
      const remainingMs = 60_000 - (Date.now() - startedAt)
      if (remainingMs <= 0) throw new Error('[avg] 演出媒资校验超过 60 秒，请拆分场景')
      const url = URL.createObjectURL(new Blob([bytes], { type: asset.mimeType }))
      try {
        const measurement = await verifyProductMediaRuntimeUrlsV1({ assets: [asset], urls: { [asset.assetKey]: url }, timeoutMs: Math.min(15_000, remainingMs),
          environment: { browserName: 'browser', browserVersion: navigator.userAgent, platform: navigator.platform,
            viewport: { width: window.innerWidth, height: window.innerHeight } } })
        const probe = measurement.assets[0]
        if (!probe || probe.status !== 'decoded') throw new Error('[avg] 演出素材实际解码失败')
        if (probe.decodedWidth !== asset.width || probe.decodedHeight !== asset.height
          || (probe.decodedDurationMs === null ? asset.durationMs !== null : asset.durationMs === null || Math.abs(probe.decodedDurationMs - asset.durationMs) > 1)) throw new Error('[avg] 演出素材解码尺寸或时长与冻结元数据不符')
      } finally { URL.revokeObjectURL(url) }
    }
    const remainingMs = 60_000 - (Date.now() - startedAt)
    if (remainingMs <= 0) throw new Error('[avg] 演出媒资校验超过 60 秒，请拆分场景')
    await Dexie.waitFor(Dexie.ignoreTransaction(inspect), remainingMs)
  }
}

/** No inference, provider or DB writes. Dependencies are actual author-adopted revisions. */
export async function validateAvgAuthorAssemblyV1(input: {
  scope: WorkspaceScope
  payload: AvgAuthorStageV1
  inputs: ProductBuildArtifactRecordV1[]
  productKey: string
  sourceWorld: Parameters<typeof compileAvgExecutablePackageV2>[0]['sourceWorld']
}): Promise<AvgAssemblyValidationV1> {
  const rule = input.inputs.find(row => row.artifactKey === 'avg.system.plan')
  if (!rule) throw new Error('[avg] 演出缺少正式规则依赖')
  const scripts = input.inputs.filter(row => row.artifactKey.startsWith('avg.content.scene-script.'))
  if (input.inputs.length !== scripts.length + 1) throw new Error('[avg] 演出输入域含无关工件')
  const pkg = compileAvgExecutablePackageV2({ product: { key: input.productKey, title: '作者组装校验', description: '' },
    sourceWorld: input.sourceWorld, systemPlan: JSON.parse(rule.payloadJson), scripts: scripts.map(row => JSON.parse(row.payloadJson)),
    scriptRevisions: Object.fromEntries(scripts.map(row => [JSON.parse(row.payloadJson).sceneKey as string, row.version])),
    ...input.payload })
  await assertAvgOwnedStageMediaV1(input.scope, input.payload)
  return { schema: 'storyforge.avg.assembly-validation', version: 1, moduleHash: await hashProductProductionValueV2(pkg.modules[0]) }
}
