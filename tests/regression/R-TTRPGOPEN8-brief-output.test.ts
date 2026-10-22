import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { recordTtrpgOpenNarrativeMemoryV1 } from '../../src/lib/ttrpg/runtime-commands'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { ttrpgOpenDeliveredBriefAttributionsV1, parseTtrpgOpenBriefV1 } from '../../src/lib/ttrpg/open-brief-output'
import { parseTtrpgOpenBriefAttributionV1 } from '../../src/lib/ttrpg/open-brief-contract'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import type { ContextGatewaySourceSnapshotInputV1 } from '../../src/lib/context-gateway/attempt-evidence'

async function actualReads(revisionKey = 'brief.original-belief') {
  const f = await readyOpenTtrpgSessionV1('Brief output provenance', p => { p.ttrpg!.campaign.runtimePolicy.enabled = true })
  const e = await openEnvelopeV1(f.sessionId, 'brief.output.note')
  await recordTtrpgOpenNarrativeMemoryV1({ ...e, viewerKey: OPEN_HUMAN_VIEWER, draft: { revisionKey, observerKey: 'hero', reliability: 'belief',
    audience: 'party', knownBy: [], summary: '主角只是怀疑港口有人跟踪。', fromEventSequence: 1, toEventSequence: e.baseSequence } })
  const scope = { ...f.scope, productRuntimeSessionId: f.sessionId, runtimeActorKey: 'gm' }, reads: ContextGatewaySourceSnapshotInputV1[] = []
  for (const key of ['ttrpgOpenBriefInput', 'ttrpgOpenPartyMemory']) {
    const snapshot = await CONTEXT_SOURCE_BY_KEY.get(key)!.resources!.openReadSession!(scope)
    const page = await snapshot.provider.listMetadata({ scope, limit: 1000 })
    for (const descriptor of page.items) {
      const read = await snapshot.provider.read({ scope, resourceKey: descriptor.resourceKey, depth: 'full', maxTokens: 16000 })
      reads.push({ sourceKey: key, resourceKey: descriptor.resourceKey, sourceRefs: read.sourceRefs, content: read.content })
    }
    await snapshot.assertCurrent()
  }
  return { f, reads, sources: await ttrpgOpenDeliveredBriefAttributionsV1(reads) }
}
describe('R-TTRPGOPEN8 closed stage recap output and source attribution', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('derives original belief, observer, human origin and exact content hash from actual full reads, not model claims', async () => {
    const f = await actualReads(), memory = f.sources.find(s => s.kind === 'memory')!
    expect(memory).toMatchObject({ citationKey: 'memory.brief.original-belief', observerKey: 'hero', reliability: 'belief', origin: 'human-authored' })
    const read = f.reads.find(read => read.resourceKey === memory.resourceKey)!
    expect(memory.contentHash).toBe(await sha256Text(read.content as string))
    const value = { paragraphs: [{ text: '主角仍将跟踪视为个人推测。', sourceKeys: [memory.citationKey] }] }
    expect(parseTtrpgOpenBriefV1(value, f.sources)).toEqual(value)
    expect(f.sources.some(source => source.kind === 'release-observation' && source.reliability === 'release-time')).toBe(true)
    expect(f.sources.find(source => source.citationKey === 'brief.frame')).toMatchObject({ kind: 'stage', reliability: 'confirmed', observerKey: null })
  })
  it('rejects a real catalog entry that was not delivered, even when its key was known beforehand', async () => {
    const f = await actualReads(), target = f.sources.find(source => source.kind === 'release-observation')!
    const fewer = await ttrpgOpenDeliveredBriefAttributionsV1(f.reads.filter(read => read.resourceKey !== target.resourceKey))
    expect(() => parseTtrpgOpenBriefV1({ paragraphs: [{ text: '借用没读过的资料', sourceKeys: [target.citationKey] }] }, fewer)).toThrow(/未实际交付/)
  })
  it.each(['root-authority', 'paragraph-observer', 'paragraph-reliability', 'unknown-citation', 'duplicate-citation'])('rejects model %s instead of letting generated text rewrite source authority', async kind => {
    const f = await actualReads(), key = f.sources.find(s => s.kind === 'memory')!.citationKey
    const value: any = { paragraphs: [{ text: '复盘候选', sourceKeys: [key] }] }
    if (kind === 'root-authority') value.noMechanicalAuthority = false
    if (kind === 'paragraph-observer') value.paragraphs[0].observerKey = 'gm'
    if (kind === 'paragraph-reliability') value.paragraphs[0].reliability = 'observed'
    if (kind === 'unknown-citation') value.paragraphs[0].sourceKeys = ['memory.undelivered-secret']
    if (kind === 'duplicate-citation') value.paragraphs[0].sourceKeys.push(key)
    expect(() => parseTtrpgOpenBriefV1(value, f.sources)).toThrow()
  })
  it('rejects foreign providers, partial metadata, missing controls, duplicate resources and forged recipient grants', async () => {
    const f = await actualReads(), memory = f.reads.find(read => JSON.parse(read.content as string).schema === 'storyforge.ttrpg-open-memory-context')!
    await expect(ttrpgOpenDeliveredBriefAttributionsV1([...f.reads, { ...memory, sourceKey: 'ttrpgOpenGmOracleInput' }])).rejects.toThrow()
    await expect(ttrpgOpenDeliveredBriefAttributionsV1(f.reads.map(read => read === memory ? { ...read, content: JSON.stringify({ version: 1, resourceKey: read.resourceKey, shortSummary: '目录' }) } : read))).rejects.toThrow()
    await expect(ttrpgOpenDeliveredBriefAttributionsV1(f.reads.filter(read => !read.resourceKey!.endsWith(':brief-contract')))).rejects.toThrow()
    await expect(ttrpgOpenDeliveredBriefAttributionsV1([...f.reads, memory])).rejects.toThrow(/重复/)
    const body = JSON.parse(memory.content as string); body.knownBy = ['hero']
    await expect(ttrpgOpenDeliveredBriefAttributionsV1(f.reads.map(read => read === memory ? { ...read, content: JSON.stringify(body) } : read))).rejects.toThrow(/每名实际接收者/)
    body.audience = 'gm-only'
    await expect(ttrpgOpenDeliveredBriefAttributionsV1(f.reads.map(read => read === memory ? { ...read, content: JSON.stringify(body) } : read))).rejects.toThrow()
  })
  it('rejects source authority/observer/origin relabeling in the pure attribution contract', async () => {
    const f = await actualReads(), memory = f.sources.find(s => s.kind === 'memory')!
    expect(() => parseTtrpgOpenBriefAttributionV1({ ...memory, observerKey: null })).toThrow()
    expect(() => parseTtrpgOpenBriefAttributionV1({ ...memory, origin: null })).toThrow()
    expect(() => parseTtrpgOpenBriefAttributionV1({ ...memory, reliability: 'confirmed' })).toThrow()
    expect(() => parseTtrpgOpenBriefAttributionV1({ ...memory, kind: 'retained-narration', reliability: 'narrated', contextSourceKey: 'ttrpgOpenBriefInput' })).toThrow()
    const contract = f.reads.find(r => r.resourceKey!.endsWith(':brief-contract'))!
    const body = JSON.parse(contract.content as string); body.noWorldWrite = false
    await expect(ttrpgOpenDeliveredBriefAttributionsV1(f.reads.map(r => r === contract ? { ...r, content: JSON.stringify(body) } : r))).rejects.toThrow()
  })
  it('keeps a maximum-length real memory revision citable without cropping identity', async () => {
    const key = 'x'.repeat(200), f = await actualReads(key), alias = `memory.${key}`
    expect(f.sources.some(source => source.citationKey === alias)).toBe(true)
    expect(parseTtrpgOpenBriefV1({ paragraphs: [{ text: '保留完整引用身份', sourceKeys: [alias] }] }, f.sources).paragraphs[0].sourceKeys).toEqual([alias])
  })
  it('refuses empty, oversized or non-closed prose instead of truncating it into a valid memory', async () => {
    const f = await actualReads(), sourceKeys = ['brief.frame']
    for (const value of [{ paragraphs: [] }, { paragraphs: [{ text: 'x'.repeat(4001), sourceKeys }] },
      { paragraphs: Array.from({ length: 9 }, () => ({ text: '过量段落', sourceKeys })) },
      { paragraphs: [{ text: '正文', sourceKeys }], facts: [] }]) expect(() => parseTtrpgOpenBriefV1(value, f.sources)).toThrow()
  })
})
