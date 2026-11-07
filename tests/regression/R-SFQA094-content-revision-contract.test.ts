import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assertOutlineBatchContentRevisionFreshV1, captureWorkspaceContentRevisionV1,
  OUTLINE_BATCH_APPEND_PAYLOAD_TYPE_V1, verifyWorkspaceContentRevisionV1 } from '../../src/lib/authoring/content-revision'
import { adoptOutlineGenerationCandidateV1 } from '../../src/lib/outline/candidate-lifecycle'
import { createSfqa094BatchV1, sfqa094IntentV1 } from '../helpers/sfqa094-batch'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe.sequential('SFQA094 · 独立共享修订合同保持原默认精确语义', () => {
  it('默认capture/verify仍对全部实际行逐字敏感，未改变version或原hash', async () => {
    const fixture = await createSfqa094BatchV1()
    const candidate = [...fixture.result.candidatesByVolume.values()][0]
    const original = candidate.contentRevision!
    expect(await captureWorkspaceContentRevisionV1({ scope: fixture.scope, worldGroupId: null })).toEqual(original)
    await adoptOutlineGenerationCandidateV1({ candidate, intent: sfqa094IntentV1(candidate, fixture.volumes[0].id!) })
    const result = await verifyWorkspaceContentRevisionV1(original, { scope: fixture.scope, worldGroupId: null })
    expect(result.fresh).toBe(false)
    expect(result.changedTables).toEqual(['outlineNodes'])
    expect(original.version).toBe(1)
  })

  it('窄runId入口拒绝替换原冻结向量和跨owner运行', async () => {
    const fixture = await createSfqa094BatchV1()
    const candidate = [...fixture.result.candidatesByVolume.values()][0]
    await db.outlineNodes.update(fixture.volumes[0].id!, { summary: '作者更新' })
    const current = await captureWorkspaceContentRevisionV1({ scope: fixture.scope, worldGroupId: null })
    await expect(assertOutlineBatchContentRevisionFreshV1(current, { scope: fixture.scope, worldGroupId: null, runId: candidate.runId })).rejects.toThrow(/原始|冻结/)
    const other = await createSfqa094BatchV1()
    await expect(assertOutlineBatchContentRevisionFreshV1(candidate.contentRevision!, { scope: other.scope, worldGroupId: null, runId: candidate.runId })).rejects.toThrow()
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(0)
  })

  it('只有已完成run而没有精确追加证明时，旧批次仍保持stale', async () => {
    const fixture = await createSfqa094BatchV1()
    const [first, second] = fixture.result.candidatesByVolume.values()
    await adoptOutlineGenerationCandidateV1({ candidate: first, intent: sfqa094IntentV1(first, fixture.volumes[0].id!) })
    const evidence = (await db.agentEvents.toArray()).filter(row => row.durableRunId === first.runId && JSON.parse(row.payload).type === OUTLINE_BATCH_APPEND_PAYLOAD_TYPE_V1)
    for (const row of evidence) if (row.id != null) await db.agentEvents.delete(row.id)
    await expect(assertOutlineBatchContentRevisionFreshV1(second.contentRevision!, { scope: fixture.scope, worldGroupId: null, runId: second.runId })).rejects.toThrow(/证明/)
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(2)
  })
})
