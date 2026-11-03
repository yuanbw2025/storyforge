import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedQuality005LegacyHybridV1 } from './quality005-legacy-hybrid'

interface LegacyInteractionCandidate {
  schema: 'storyforge.quality005.legacy-interaction-candidate.v1'
  baselineCommit: string
  baseFixtureSha256: string
  actualNetworkCalls: 0
  actualModelCalls: 0
  syntheticTransportCalls: 1
  humanAcceptance: false
  scope: WorkspaceScope
  sessionId: number
  runId: number
  receiptHash: string
  pendingRows: Record<string, object[]>
  completedRows: Record<string, object[]>
}

export async function seedQuality005LegacyInteractionCandidateV1(completed = false): Promise<LegacyInteractionCandidate> {
  await seedQuality005LegacyHybridV1()
  const path = resolve('tests/fixtures/text-open-world/quality005-legacy-interaction-candidate-v1.json.gz')
  const compressed = readFileSync(path), raw = gunzipSync(compressed)
  const metadata = JSON.parse(readFileSync(`${path}.metadata.json`, 'utf8')) as {
    compressedSha256: string; decompressedSha256: string; decompressedBytes: number
  }
  if (createHash('sha256').update(compressed).digest('hex') !== metadata.compressedSha256
    || createHash('sha256').update(raw).digest('hex') !== metadata.decompressedSha256
    || raw.byteLength !== metadata.decompressedBytes) throw new Error('005 old interaction candidate bytes changed')
  const fixture = JSON.parse(raw.toString('utf8')) as LegacyInteractionCandidate
  if (fixture.schema !== 'storyforge.quality005.legacy-interaction-candidate.v1'
    || fixture.baselineCommit !== '38cbcd5fa632516763f5844bff2665c3aee0003e'
    || fixture.baseFixtureSha256 !== '91f9eb3206dd5efe28515c45f264b7b7190297bf5061d4693aa73bccce1d9694'
    || fixture.actualModelCalls !== 0 || fixture.actualNetworkCalls !== 0 || fixture.syntheticTransportCalls !== 1 || fixture.humanAcceptance !== false) {
    throw new Error('005 old interaction candidate origin changed')
  }
  const rows = completed ? fixture.completedRows : fixture.pendingRows
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) if (rows[table.name]?.length) await table.bulkPut(rows[table.name])
  })
  return fixture
}
