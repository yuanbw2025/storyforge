import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import type { ProjectExportData } from '../../src/lib/export/json-export'
import type { WorkspaceScope } from '../../src/lib/types'
import type { seedAuthorizedTextOpenWorldCreatorBuildV1 } from './text-open-world-creator-build'

export interface Quality005LegacyAttemptV1 {
  mode: 'observed' | 'unknown'
  scope: WorkspaceScope
  creator: Awaited<ReturnType<typeof seedAuthorizedTextOpenWorldCreatorBuildV1>>
  runId: number
  output: string | null
  attempts: Array<{ usageKnown: boolean; usage: { modelCalls: number; inputTokens: number; outputTokens: number }; errorCode: string }>
  raw: Array<{ contentHash: string; content: string; byteLength: number }>
  backup: ProjectExportData
  runContractHash: string
  runProjectionHash: string
}

export async function seedQuality005LegacyAttemptsV1(options: { inFlight?: boolean } = {}) {
  const path = resolve('tests/fixtures/text-open-world/quality005-legacy-attempts-v2.json.gz')
  const compressed = readFileSync(path)
  const metadata = JSON.parse(readFileSync(`${path}.metadata.json`, 'utf8')) as {
    compressedSha256: string; decompressedSha256: string; decompressedBytes: number
  }
  const raw = gunzipSync(compressed)
  if (createHash('sha256').update(compressed).digest('hex') !== metadata.compressedSha256
    || createHash('sha256').update(raw).digest('hex') !== metadata.decompressedSha256
    || raw.byteLength !== metadata.decompressedBytes) throw new Error('005 legacy attempt fixture changed')
  const fixture = JSON.parse(raw.toString('utf8')) as {
    baselineCommit: string; actualModelCalls: number; actualNetworkCalls: number; syntheticTransportCalls: number
    humanAcceptance: boolean; cases: Quality005LegacyAttemptV1[]; rows: Record<string, object[]>
    unknownInFlightRows: Record<string, object[]>
  }
  if (fixture.baselineCommit !== '38cbcd5fa632516763f5844bff2665c3aee0003e' || fixture.actualModelCalls !== 0
    || fixture.actualNetworkCalls !== 0 || fixture.syntheticTransportCalls !== 2 || fixture.humanAcceptance !== false) {
    throw new Error('005 legacy attempt fixture provenance changed')
  }
  await db.transaction('rw', db.tables, async () => {
    const rows = options.inFlight ? fixture.unknownInFlightRows : fixture.rows
    for (const table of db.tables) if (rows[table.name]?.length) await table.bulkPut(rows[table.name])
  })
  return fixture
}
