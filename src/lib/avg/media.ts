import { db } from '../db/schema'
import type { FrozenAvgMediaAsset, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../world-engine/scope'

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function encodeBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data); let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}

export async function readAvgReleaseMediaDataUrl(input: { scope: WorkspaceScope; asset: FrozenAvgMediaAsset }): Promise<string> {
  const scope = await resolveScope({ scope: input.scope })
  const asset = await db.avgMediaAssets.where('[workId+assetKey+version]').equals([scope.workId, input.asset.assetKey, input.asset.version]).first()
  if (!asset || !await assertRecordInScope(scope, 'avgMediaAssets', asset, { owner: 'work' }) || asset.contentHash !== input.asset.contentHash || asset.mimeType !== input.asset.mimeType) throw new Error(`[avg] 冻结媒资版本缺失或元数据不匹配:${input.asset.assetKey}@${input.asset.version}`)
  const row = await db.avgMediaBlobs.where('mediaAssetId').equals(asset.id!).first()
  if (!row || !await assertRecordInScope(scope, 'avgMediaBlobs', row, { owner: 'work' }) || row.data.byteLength !== input.asset.byteSize || await sha256(row.data) !== input.asset.contentHash) throw new Error(`[avg] 冻结媒资二进制缺失或哈希不匹配:${input.asset.assetKey}@${input.asset.version}`)
  return `data:${asset.mimeType};base64,${encodeBase64(row.data)}`
}

export async function preloadAvgReleaseMedia(input: { scope: WorkspaceScope; assets: FrozenAvgMediaAsset[]; maximumBytes?: number }): Promise<{ urls: Record<string, string>; failures: Array<{ assetKey: string; reason: string }> }> {
  const maximumBytes = input.maximumBytes ?? 64 * 1024 * 1024
  const urls: Record<string, string> = {}; const failures: Array<{ assetKey: string; reason: string }> = []; let used = 0
  for (const asset of input.assets) {
    if (used + asset.byteSize > maximumBytes) { failures.push({ assetKey: asset.assetKey, reason: '预加载容量预算已满' }); continue }
    try { urls[asset.assetKey] = await readAvgReleaseMediaDataUrl({ scope: input.scope, asset }); used += asset.byteSize }
    catch (cause) { failures.push({ assetKey: asset.assetKey, reason: cause instanceof Error ? cause.message : String(cause) }) }
  }
  return { urls, failures }
}
