import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type { ProductProductionPlanTaskV3, ProductProductionPlanV3 } from '../../src/lib/types'
import type { ProductProductionTaskExecutionResultV1 } from '../../src/lib/product-production/scheduler'

interface LegacyLargeSource {
  schema: 'storyforge.quality005.legacy-large-source.v1'
  baselineCommit: string
  actualModelCalls: 0
  actualNetworkCalls: 0
  humanAcceptance: false
  prepared: { preview: { plan: ProductProductionPlanV3; start: { executionBrief: { productionBudget: { maximumStorageBytes: number } } } } }
  p0: ProductProductionPlanTaskV3
  result: ProductProductionTaskExecutionResultV1
}

/** Reads immutable old contracts/output only. It intentionally does not seed
 * or execute a new novel-source Production under the current policy. */
export function readQuality005LegacyLargeSourceV1(): LegacyLargeSource {
  const path = resolve('tests/fixtures/text-open-world/quality005-legacy-large-source-v1.json.gz')
  const compressed = readFileSync(path), raw = gunzipSync(compressed)
  const metadata = JSON.parse(readFileSync(`${path}.metadata.json`, 'utf8')) as {
    compressedSha256: string; decompressedSha256: string; decompressedBytes: number
  }
  if (createHash('sha256').update(compressed).digest('hex') !== metadata.compressedSha256
    || createHash('sha256').update(raw).digest('hex') !== metadata.decompressedSha256
    || raw.byteLength !== metadata.decompressedBytes) throw new Error('005 old large source bytes changed')
  const fixture = JSON.parse(raw.toString('utf8')) as LegacyLargeSource
  if (fixture.schema !== 'storyforge.quality005.legacy-large-source.v1'
    || fixture.baselineCommit !== '38cbcd5fa632516763f5844bff2665c3aee0003e'
    || fixture.actualModelCalls !== 0 || fixture.actualNetworkCalls !== 0 || fixture.humanAcceptance !== false) {
    throw new Error('005 old large source origin changed')
  }
  return fixture
}
