/** TTRPG-owned projection of already completed Gateway reads. This performs
 * no lookup or selection and grants no additional source permissions. */
import type { ContextGatewayExecutionV1 } from '../context-gateway/execution'
import { sha256Text } from '../ai/chapter-memory/text-normalization'

export interface TtrpgOpenWorldReadsInputV1 {
  retrievalTrace: Pick<ContextGatewayExecutionV1['retrievalTrace'], 'mandatory' | 'autoSelected' | 'agentReads'>
  sourceSnapshots: ContextGatewayExecutionV1['sourceSnapshots']
}

export async function projectTtrpgOpenWorldReadsV1(input: TtrpgOpenWorldReadsInputV1) {
  function fail(): never { throw new Error('[ttrpg-open-world-reads] 世界读取正文与逐资源来源锚点不一致；尚未发送请求') }
  const reads = [...input.retrievalTrace.mandatory, ...input.retrievalTrace.autoSelected, ...input.retrievalTrace.agentReads]
  const byKey = new Map(reads.map(read => [read.resourceKey, read]))
  if (!reads.length || byKey.size !== reads.length || input.sourceSnapshots.length !== reads.length) fail()
  const seen = new Set<string>(), resources = []
  for (const snapshot of input.sourceSnapshots) {
    const read = snapshot.resourceKey ? byKey.get(snapshot.resourceKey) : undefined
    if (!read || read.sourceKey !== 'worldRelease' || snapshot.sourceKey !== 'worldRelease'
      || seen.has(read.resourceKey) || typeof snapshot.content !== 'string' || !/^[a-f0-9]{64}$/.test(read.contentHash)
      || snapshot.sourceRefs?.length !== 1 || snapshot.sourceRefs[0].table !== 'worldReleases'
      || snapshot.sourceRefs[0].contentHash !== read.contentHash
      || JSON.stringify(snapshot.sourceRefs) !== JSON.stringify(read.sourceRefs)) fail()
    if ((read.depth === 'full' || read.depth === 'original') && await sha256Text(snapshot.content as string) !== read.contentHash) fail()
    seen.add(read.resourceKey)
    resources.push({ resourceKey: read.resourceKey, contentHash: read.contentHash, depth: read.depth, readContent: snapshot.content as string })
  }
  return resources.sort((left, right) => left.resourceKey.localeCompare(right.resourceKey))
}

export async function renderTtrpgOpenProductionWorldReadsV2(input: TtrpgOpenWorldReadsInputV1): Promise<string> {
  return JSON.stringify({ schema: 'storyforge.ttrpg-open-production-world-reads', version: 2,
    resources: await projectTtrpgOpenWorldReadsV1(input) })
}
