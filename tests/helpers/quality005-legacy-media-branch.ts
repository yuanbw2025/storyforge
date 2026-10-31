import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import type { ProductMediaAsset, ProductMediaBlob, ProductRuntimeSession, WorkspaceScope } from '../../src/lib/types'
import { seedQuality005LegacyHybridV1 } from './quality005-legacy-hybrid'

export async function seedQuality005LegacyMediaBranchV1() {
  await seedQuality005LegacyHybridV1()
  const path = resolve('tests/fixtures/text-open-world/quality005-legacy-media-branch-v1.json.gz')
  const zipped = readFileSync(path), raw = gunzipSync(zipped)
  const metadata = JSON.parse(readFileSync(`${path}.metadata.json`, 'utf8')) as {
    compressedSha256: string; decompressedSha256: string; decompressedBytes: number
  }
  if (createHash('sha256').update(zipped).digest('hex') !== metadata.compressedSha256
    || createHash('sha256').update(raw).digest('hex') !== metadata.decompressedSha256
    || raw.byteLength !== metadata.decompressedBytes) throw new Error('005 native old branch bytes changed')
  const f = JSON.parse(raw.toString('utf8')) as { schema: string; baselineCommit: string; baseFixtureSha256: string;
    actualModelCalls: number; actualNetworkCalls: number; humanAcceptance: boolean;
    scope: WorkspaceScope; child: ProductRuntimeSession & { id: number }; sourceSessionId: number; assetId: number }
  if (f.schema !== 'storyforge.quality005.legacy-media-branch.v1'
    || f.baselineCommit !== '38cbcd5fa632516763f5844bff2665c3aee0003e'
    || f.baseFixtureSha256 !== '91f9eb3206dd5efe28515c45f264b7b7190297bf5061d4693aa73bccce1d9694'
    || f.actualModelCalls !== 0 || f.actualNetworkCalls !== 0 || f.humanAcceptance !== false) throw new Error('005 native old branch origin changed')
  await db.productRuntimeSessions.put(f.child)
  return f
}

/** Native pre-policy clone rows, rather than a newly minted historical receipt. */
export async function seedQuality005LegacyMediaCloneV1() {
  await seedQuality005LegacyHybridV1()
  const path = resolve('tests/fixtures/text-open-world/quality005-legacy-media-clone-v1.json.gz')
  const zipped = readFileSync(path), raw = gunzipSync(zipped)
  const metadata = JSON.parse(readFileSync(`${path}.metadata.json`, 'utf8')) as {
    compressedSha256: string; decompressedSha256: string; decompressedBytes: number
  }
  if (createHash('sha256').update(zipped).digest('hex') !== metadata.compressedSha256
    || createHash('sha256').update(raw).digest('hex') !== metadata.decompressedSha256
    || raw.byteLength !== metadata.decompressedBytes) throw new Error('005 native old cloned media bytes changed')
  const f = JSON.parse(raw.toString('utf8')) as { schema: string; baselineCommit: string; baseFixtureSha256: string;
    actualModelCalls: number; actualNetworkCalls: number; humanAcceptance: boolean;
    scope: WorkspaceScope; child: ProductRuntimeSession & { id: number }; sourceSessionId: number; assetId: number;
    clonedAssets: ProductMediaAsset[]; clonedBindings: ProductMediaBlob[] }
  if (f.schema !== 'storyforge.quality005.legacy-media-clone.v1'
    || f.baselineCommit !== '38cbcd5fa632516763f5844bff2665c3aee0003e'
    || f.baseFixtureSha256 !== '91f9eb3206dd5efe28515c45f264b7b7190297bf5061d4693aa73bccce1d9694'
    || f.actualModelCalls !== 0 || f.actualNetworkCalls !== 0 || f.humanAcceptance !== false) throw new Error('005 native old clone origin changed')
  await db.transaction('rw', db.productRuntimeSessions, db.productMediaAssets, db.productMediaBlobs, async () => {
    await db.productRuntimeSessions.put(f.child)
    await db.productMediaAssets.bulkPut(f.clonedAssets)
    await db.productMediaBlobs.bulkPut(f.clonedBindings)
  })
  return f
}
