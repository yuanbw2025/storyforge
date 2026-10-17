import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedTableConversationV1 } from '../helpers/open-ttrpg-table-conversation'
import { readTtrpgOpenNarrativeMemoriesV1, recordTtrpgOpenDeskMemoryV1 } from '../../src/lib/ttrpg/open-memory-service'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'

async function prepare() {
  const fixture = await seedTableConversationV1(true)
  const page = await readTtrpgOpenNarrativeMemoriesV1(fixture.input)
  const input = { ...fixture.input, submissionKey: 'desk.note', baseSequence: page.sequence, baseStateHash: page.stateHash,
    draft: { observerKey: page.actorKey, reliability: 'belief' as const, audience: 'private' as const, knownBy: [page.actorKey!],
      summary: '我怀疑港口有人在盯着我们。', fromEventSequence: 1, toEventSequence: page.sequence } }
  return { fixture, input }
}
describe('R-TTRPGOPEN8 confirmed human memory desk boundary', { timeout: 60000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('retains the exact baseline for idempotent retry and rejects an altered attempt', async () => {
    const { fixture, input } = await prepare()
    const event = await recordTtrpgOpenDeskMemoryV1(input)
    expect((await recordTtrpgOpenDeskMemoryV1(input)).id).toBe(event.id)
    await expect(recordTtrpgOpenDeskMemoryV1({ ...input, draft: { ...input.draft, summary: '悄悄改变原提交' } })).rejects.toThrow()
    expect((await readTtrpgOpenNarrativeMemoriesV1(fixture.input)).entries).toMatchObject([{ summary: input.draft.summary, knownBy: ['hero'] }])
    expect((await readTtrpgOpenNarrativeMemoriesV1(fixture.host)).entries).toEqual([])
    expect((await readTtrpgOpenNarrativeMemoriesV1(fixture.other)).entries).toEqual([])
  })
  it('rejects mismatched workspace or model provenance before any record is committed', async () => {
    const { fixture, input } = await prepare(), other = await seedTableConversationV1(true)
    const before = await readProductRuntimeState(fixture.f.sessionId)
    await expect(recordTtrpgOpenDeskMemoryV1({ ...input, scope: other.f.scope })).rejects.toThrow()
    await expect(recordTtrpgOpenDeskMemoryV1({ ...input, origin: 'model' } as typeof input)).rejects.toThrow()
    expect(await readProductRuntimeState(fixture.f.sessionId)).toEqual(before)
    expect(await db.ttrpgNarrativeMemories.count()).toBe(0)
  })
})
