import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'

export type OwnRuntimeStageV1 = 'pending' | 'adopted' | 'step-succeeded' | 'verifying' | 'completed'
interface OwnRuntimeCapture {
  schema: 'storyforge.quality005.own-runtime-recovery.v2'
  baselineCommit: string
  originalCaptureSha256: string
  actualNetworkCalls: 0
  actualModelCalls: 0
  syntheticTransportCalls: 1 | 2
  humanAcceptance: false
  cases: Array<{
    mode: 'novel' | 'world-release'
    scope: WorkspaceScope
    sessionId: number
    runId: number
    receiptHash: string
    baseRows: Record<string, object[]>
    stageDeltas: Record<OwnRuntimeStageV1, Record<string, object[]>>
    stageTableHashes: Record<OwnRuntimeStageV1, Record<string, string>>
  }>
}

/** Only selects an exact native historical snapshot. No new events, receipts,
 * authorization or source reinterpretation are manufactured by this helper. */
export async function seedQuality005OwnRuntimeRecoveryV1(mode: 'novel' | 'world-release', stage: OwnRuntimeStageV1, harness: 'open-world' | 'evolution' = 'open-world') {
  const origin = harness === 'open-world'
    ? { filename: 'quality005-own-runtime-recovery-v2.json.gz', calls: 2,
        sha: '294375fbb05781d9afbba5a237946bd9f1fd24ada03b1487b285849f23b7f817' }
    : { filename: 'quality005-evolution-recovery-v2.json.gz', calls: 1,
        sha: '6b1022e7f606dd336dbdb864cdccbce38ec5189f93201e0c499b362b56125984' }
  const path = resolve('tests/fixtures/text-open-world', origin.filename)
  const compressed = readFileSync(path), raw = gunzipSync(compressed)
  const metadata = JSON.parse(readFileSync(`${path}.metadata.json`, 'utf8')) as {
    compressedSha256: string; decompressedSha256: string; decompressedBytes: number
  }
  const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
  if (sha(compressed) !== metadata.compressedSha256 || sha(raw) !== metadata.decompressedSha256
    || raw.byteLength !== metadata.decompressedBytes) throw new Error('005 own runtime source bytes changed')
  const capture = JSON.parse(raw.toString('utf8')) as OwnRuntimeCapture
  if (capture.schema !== 'storyforge.quality005.own-runtime-recovery.v2'
    || capture.baselineCommit !== '38cbcd5fa632516763f5844bff2665c3aee0003e'
    || capture.originalCaptureSha256 !== origin.sha
    || capture.actualModelCalls !== 0 || capture.actualNetworkCalls !== 0 || capture.syntheticTransportCalls !== origin.calls || capture.humanAcceptance !== false) {
    throw new Error('005 own runtime source provenance changed')
  }
  const fixture = capture.cases.find(row => row.mode === mode)
  if (!fixture) throw new Error('No native historical candidate exists for this explicitly measured source/Harness fixture')
  const rows = { ...fixture.baseRows, ...fixture.stageDeltas[stage] }
  for (const [table, expected] of Object.entries(fixture.stageTableHashes[stage])) {
    if (sha(JSON.stringify(rows[table])) !== expected) throw new Error(`005 original stage table changed:${table}`)
  }
  for (const row of rows.mediaBlobObjects ?? []) {
    const blob = row as { data?: { encoding?: unknown; value?: string } | ArrayBuffer }
    if (blob.data && !(blob.data instanceof ArrayBuffer) && blob.data.encoding === 'base64-array-buffer') {
      blob.data = Uint8Array.from(Buffer.from(blob.data.value!, 'base64')).buffer
    }
  }
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) if (rows[table.name]?.length) await table.bulkPut(rows[table.name])
  })
  return fixture
}
