import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import type { TextOpenWorldCreatorBriefSessionV1 } from '../../src/lib/open-world/creator-brief'
import type { ProductProductionBriefRecordV1, WorkspaceScope } from '../../src/lib/types'

interface LegacyChapterBrief {
  schema: 'storyforge.quality005.legacy-chapter-brief.v1'
  baselineCommit: string
  actualNetworkCalls: 0
  actualModelCalls: 0
  humanAcceptance: false
  novel: { scope: WorkspaceScope; chapters: Array<{ id: number; title: string }>; now: number }
  selectedChapterIds: number[]
  confirmed: TextOpenWorldCreatorBriefSessionV1
  otherSession: TextOpenWorldCreatorBriefSessionV1
  brief: ProductProductionBriefRecordV1 & { id: number }
  rows: Record<string, object[]>
}

/** Immutable native pre-policy confirmation, retained only to exercise old
 * chapter locators, author evidence and import remapping under the new rule. */
export async function seedQuality005LegacyChapterBriefV1(): Promise<LegacyChapterBrief> {
  const path = resolve('tests/fixtures/text-open-world/quality005-legacy-chapter-brief-v1.json.gz')
  const compressed = readFileSync(path), raw = gunzipSync(compressed)
  const metadata = JSON.parse(readFileSync(`${path}.metadata.json`, 'utf8')) as {
    compressedSha256: string; decompressedSha256: string; decompressedBytes: number
  }
  if (createHash('sha256').update(compressed).digest('hex') !== metadata.compressedSha256
    || createHash('sha256').update(raw).digest('hex') !== metadata.decompressedSha256
    || raw.byteLength !== metadata.decompressedBytes) throw new Error('005 old chapter Brief bytes changed')
  const fixture = JSON.parse(raw.toString('utf8')) as LegacyChapterBrief
  if (fixture.schema !== 'storyforge.quality005.legacy-chapter-brief.v1'
    || fixture.baselineCommit !== '38cbcd5fa632516763f5844bff2665c3aee0003e'
    || fixture.actualModelCalls !== 0 || fixture.actualNetworkCalls !== 0 || fixture.humanAcceptance !== false) {
    throw new Error('005 old chapter Brief origin changed')
  }
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) if (fixture.rows[table.name]?.length) await table.bulkPut(fixture.rows[table.name])
  })
  return fixture
}
