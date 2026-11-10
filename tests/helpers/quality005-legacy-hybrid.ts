import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import type { ProductMediaAsset, ProductRuntimeEvent, WorkspaceScope } from '../../src/lib/types'

interface LegacyHybridFixture {
  schema: 'storyforge.quality005.legacy-hybrid.v1'
  baselineCommit: string
  actualNetworkCalls: 0
  actualModelCalls: 0
  humanAcceptance: false
  scope: WorkspaceScope
  releaseId: number
  cases: Array<{
    mode: 'adventure' | 'interaction' | 'media'
    emptySessionId: number
    command: Record<string, unknown>
    event?: ProductRuntimeEvent
    asset?: ProductMediaAsset
    dataBase64?: string
  }>
  rows: Record<string, object[]>
}

/** Exact old byte fixture, not a production allowLegacy capability. Captured
 * through the native pre-policy public readers and command/media writers. */
export async function seedQuality005LegacyHybridV1(): Promise<LegacyHybridFixture> {
  const path = resolve('tests/fixtures/text-open-world/quality005-legacy-hybrid-v1.json.gz')
  const compressed = readFileSync(path), raw = gunzipSync(compressed)
  const metadata = JSON.parse(readFileSync(`${path}.metadata.json`, 'utf8')) as {
    compressedSha256: string; decompressedSha256: string; decompressedBytes: number
  }
  if (createHash('sha256').update(compressed).digest('hex') !== metadata.compressedSha256
    || createHash('sha256').update(raw).digest('hex') !== metadata.decompressedSha256
    || raw.byteLength !== metadata.decompressedBytes) throw new Error('005 historical hybrid fixture bytes changed')
  const fixture = JSON.parse(raw.toString('utf8')) as LegacyHybridFixture
  if (fixture.schema !== 'storyforge.quality005.legacy-hybrid.v1'
    || fixture.baselineCommit !== '38cbcd5fa632516763f5844bff2665c3aee0003e'
    || fixture.actualModelCalls !== 0 || fixture.actualNetworkCalls !== 0 || fixture.humanAcceptance !== false) {
    throw new Error('005 historical hybrid fixture provenance changed')
  }
  for (const row of fixture.rows.mediaBlobObjects ?? []) {
    const value = row as { data?: { encoding?: unknown; value?: string } | ArrayBuffer }
    if (value.data && !(value.data instanceof ArrayBuffer) && value.data.encoding === 'base64-array-buffer') {
      const bytes = Uint8Array.from(Buffer.from(value.data.value!, 'base64'))
      value.data = bytes.buffer
    }
  }
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) if (fixture.rows[table.name]?.length) await table.bulkPut(fixture.rows[table.name])
  })
  return fixture
}
