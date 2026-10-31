import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { db } from '../../src/lib/db/schema'
import { commitNarrativeChoice } from '../../src/lib/product/runtime-core'
import type { ProductRuntimeEvent, ProductRuntimeSession } from '../../src/lib/types'
import { seedQuality005LegacyNovelV1 } from './quality005-legacy-novel'

export async function seedQuality005LegacyChoiceV1() {
  const base = await seedQuality005LegacyNovelV1()
  const path = resolve('tests/fixtures/text-open-world/quality005-legacy-choice-v1.json.gz')
  const compressed = readFileSync(path), raw = gunzipSync(compressed)
  const metadata = JSON.parse(readFileSync(`${path}.metadata.json`, 'utf8')) as {
    compressedSha256: string; decompressedSha256: string; decompressedBytes: number
  }
  if (createHash('sha256').update(compressed).digest('hex') !== metadata.compressedSha256
    || createHash('sha256').update(raw).digest('hex') !== metadata.decompressedSha256
    || raw.byteLength !== metadata.decompressedBytes) throw new Error('005 old narrative receipt bytes changed')
  const fixture = JSON.parse(raw.toString('utf8')) as { baselineCommit: string; baseFixtureSha256: string;
    actualNetworkCalls: number; actualModelCalls: number; command: Parameters<typeof commitNarrativeChoice>[0];
    event: ProductRuntimeEvent; sessions: ProductRuntimeSession[]; events: ProductRuntimeEvent[] }
  if (fixture.baselineCommit !== base.capturedSourceCommit || fixture.actualNetworkCalls !== 0 || fixture.actualModelCalls !== 0
    || fixture.baseFixtureSha256 !== 'c2cd43a626045fb62842b30c02c4558d98ce7bfd7ae1b84ef837c12f633f46b3'
    || fixture.command.sessionId !== base.emptySessionId) throw new Error('005 old narrative receipt origin changed')
  await db.transaction('rw', [db.productRuntimeSessions, db.productRuntimeEvents], async () => {
    await db.productRuntimeSessions.bulkPut(fixture.sessions)
    await db.productRuntimeEvents.bulkPut(fixture.events)
  })
  return { base, ...fixture }
}
