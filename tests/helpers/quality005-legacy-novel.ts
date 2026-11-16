import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import type { ProjectExportData } from '../../src/lib/export/json-export'
import type { TextOpenWorldCommandEnvelopeV1, TextOpenWorldCommandReceiptV1, TextOpenWorldSourcePinBundleV1, WorkspaceScope } from '../../src/lib/types'
import type { seedAuthorizedTextOpenWorldCreatorBuildV1 } from './text-open-world-creator-build'

export interface Quality005LegacyNovelFixtureV1 {
  schema: 'storyforge.quality005.synthetic-legacy-fixture.v1'
  capturedSourceCommit: string
  actualModelCalls: 0
  humanAcceptance: false
  scope: WorkspaceScope
  releaseId: number
  emptySessionId: number
  receiptSessionId: number
  envelope: TextOpenWorldCommandEnvelopeV1
  receipt: TextOpenWorldCommandReceiptV1
  creator: Awaited<ReturnType<typeof seedAuthorizedTextOpenWorldCreatorBuildV1>>
  pinBundle: TextOpenWorldSourcePinBundleV1
  backup: ProjectExportData
  rows: Record<string, object[]>
}

/** Exact pre-fix synthetic bytes, never a production allowLegacy capability.
 * Seeding the old rows makes historical-reader regressions independent of the
 * new-operation APIs that deliberately no longer create novel Productions. */
export async function seedQuality005LegacyNovelV1(): Promise<Quality005LegacyNovelFixtureV1> {
  const compressed = readFileSync(resolve('tests/fixtures/text-open-world/quality005-legacy-novel-v1.json.gz'))
  const metadata = JSON.parse(readFileSync(resolve('tests/fixtures/text-open-world/quality005-legacy-novel-v1.json.metadata.json'), 'utf8')) as {
    compressedSha256: string; decompressedSha256: string; decompressedBytes: number
  }
  const raw = gunzipSync(compressed)
  if (createHash('sha256').update(compressed).digest('hex') !== metadata.compressedSha256
    || createHash('sha256').update(raw).digest('hex') !== metadata.decompressedSha256
    || raw.byteLength !== metadata.decompressedBytes) throw new Error('005 historical fixture bytes changed')
  const fixture = JSON.parse(raw.toString('utf8')) as Quality005LegacyNovelFixtureV1
  if (fixture.capturedSourceCommit !== '38cbcd5fa632516763f5844bff2665c3aee0003e'
    || fixture.actualModelCalls !== 0 || fixture.humanAcceptance !== false) {
    throw new Error('005 historical fixture origin changed')
  }
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      const rows = fixture.rows[table.name]
      if (rows?.length) await table.bulkPut(rows)
    }
  })
  return fixture
}

export async function snapshotQuality005RowsV1(): Promise<Record<string, object[]>> {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}
