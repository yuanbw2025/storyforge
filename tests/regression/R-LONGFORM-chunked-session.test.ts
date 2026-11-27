import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { OutlineNode } from '../../src/lib/types'
import { DEFAULT_CHUNKED_CONFIG } from '../../src/lib/outline/generation-modes'
import { createChunkedOutlineSession, saveChunkedOutlineSession, restoreChunkedOutlineSession, runChunkedChapterModel, adoptChunkedOutlineSession } from '../../src/lib/outline/chunked-session'
import { readOutlineGenerationCandidateV1, restoreLatestOutlineGenerationCandidateV1 } from '../../src/lib/outline/candidate-lifecycle'
import { EMPTY_DIRECTION_TEMPLATE } from '../../src/lib/outline/direction-template'
import { NarrativeEngine } from '../../src/lib/outline/narrative-engine'
import { readAgentRunV1 } from '../../src/lib/agent/run'
import * as entries from '../../src/lib/agent/formal-ai-entry'
import { verifyContextGatewayCandidateEvidenceV1 } from '../../src/lib/context-gateway/attempt-evidence'

async function seed() {
  const fixture = await seedCurrentWorkspace('精细章纲隔离验收')
  const volumeId = await db.outlineNodes.add(stampNewRecord(fixture.scope, 'outlineNodes', { parentId: null, type: 'volume', title: '第一卷', summary: '从旧信走向海港', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode)
  const session = await createChunkedOutlineSession({ projectId: fixture.project.id!, volumeId, config: { ...DEFAULT_CHUNKED_CONFIG, blockCount: 3 }, totalChapters: 6 })
  return { ...fixture, volumeId, session }
}
function select(session: Awaited<ReturnType<typeof seed>>['session']) {
  const choice = { id: 'choice-1', title: '前往海港', description: '收到旧信后前往海港', template: { ...EMPTY_DIRECTION_TEMPLATE }, focus: new NarrativeEngine().calculateChapterFocus(1, 6) }
  session.choices = [choice]; session.selectedChoiceId = choice.id; session.phase = 'chapters'
}
describe.sequential('chunked outline durable integration', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.restoreAllMocks(); db.close() })
  it('restores a persisted response at the checkpoint interruption boundary without repeating a request', async () => {
    const { session, project } = await seed(); select(session)
    await saveChunkedOutlineSession(session)
    const model = vi.spyOn(entries, 'executeRegisteredAIEntryV1').mockResolvedValue('1. 旧信：收到失散亲人的来信。')
    await runChunkedChapterModel(session, [{ role: 'user', content: '生成第一块一章' }], 0)
    const restored = await restoreChunkedOutlineSession(project.id!)
    expect(model).toHaveBeenCalledOnce()
    expect(restored?.blocks).toHaveLength(1)
    expect(restored?.blocks[0].chapters[0].title).toContain('旧信')
    expect(restored?.inFlightRunId).toBeUndefined()
    expect(await restoreLatestOutlineGenerationCandidateV1(project.id!)).toBeNull()
    expect(await db.outlineNodes.where('parentId').equals(session.volumeId).count()).toBe(0)
  })
  it('composes independently recorded responses then adopts all chapters into the frozen volume', async () => {
    const { session, project } = await seed(); select(session); await saveChunkedOutlineSession(session)
    const first = JSON.stringify([{ title: '旧信', summary: '收到亲人的来信。' }])
    const second = JSON.stringify([{ title: '出发', summary: '告别故乡。' }, { title: '风雨', summary: '在海上遇到风浪。' }, { title: '港口', summary: '抵达灯塔港。' }])
    const model = vi.spyOn(entries, 'executeRegisteredAIEntryV1').mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    await runChunkedChapterModel(session, [{ role: 'user', content: '生成第一块一章' }], 0)
    const restored = (await restoreChunkedOutlineSession(project.id!))!
    select(restored); await saveChunkedOutlineSession(restored)
    await runChunkedChapterModel(restored, [{ role: 'user', content: '生成第二块三章' }], 1)
    const recovered = (await restoreChunkedOutlineSession(project.id!))!
    const candidate = await readOutlineGenerationCandidateV1(recovered.scope, recovered.candidateRunId!)
    expect(JSON.parse(candidate!.output)).toEqual([...JSON.parse(first), ...JSON.parse(second)])
    expect(candidate?.chunked?.rawOutput).toBe(second)
    expect(JSON.stringify(model.mock.calls[1][1])).toContain('收到亲人的来信')
    await adoptChunkedOutlineSession(recovered)
    expect(await db.outlineNodes.where('parentId').equals(session.volumeId).count()).toBe(4)
    expect((await readAgentRunV1(recovered.scope, candidate!.runId)).projection.state).toBe('completed')
    expect(await restoreChunkedOutlineSession(project.id!)).toBeNull()
  })
  it('refuses stale source content before another model request', async () => {
    const { session, volumeId } = await seed(); select(session)
    await db.outlineNodes.update(volumeId, { summary: '作者改了整个卷的方向', updatedAt: Date.now() })
    const model = vi.spyOn(entries, 'executeRegisteredAIEntryV1')
    await expect(runChunkedChapterModel(session, [{ role: 'user', content: '生成' }], 0)).rejects.toThrow()
    expect(model).not.toHaveBeenCalled()
  })
  it('retains the complete long predecessor candidate for the next block without a source quota', async () => {
    const { session, project } = await seed(); select(session); await saveChunkedOutlineSession(session)
    const first = JSON.stringify([{ title: '旧信', summary: '亲人留下海港线索。'.repeat(2_000) }])
    const second = JSON.stringify([{ title: '出发', summary: '告别故乡。' }, { title: '风雨', summary: '越过风浪。' }, { title: '港口', summary: '抵达灯塔港。' }])
    const model = vi.spyOn(entries, 'executeRegisteredAIEntryV1').mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    await runChunkedChapterModel(session, [{ role: 'user', content: '生成第一块' }], 0)
    const restored = (await restoreChunkedOutlineSession(project.id!))!
    select(restored); await saveChunkedOutlineSession(restored)
    await runChunkedChapterModel(restored, [{ role: 'user', content: '生成第二块' }], 1)
    const recovered = (await restoreChunkedOutlineSession(project.id!))!
    const candidate = (await readOutlineGenerationCandidateV1(recovered.scope, recovered.candidateRunId!))!
    const verified = await verifyContextGatewayCandidateEvidenceV1({ scope: recovered.scope, runId: candidate.runId, stepId: candidate.stepId, attempt: 1, candidateHash: candidate.candidateHash })
    expect(model).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(model.mock.calls[1][1])).toContain('亲人留下海港线索。'.repeat(2_000))
    expect(verified.manifest.sources.find(source => source.key === 'priorOutlineCandidate')?.delivery).toBe('full')
    expect(verified.manifest.artifacts.some(artifact => artifact.role === 'source-snapshot' && artifact.sourceKey === 'priorOutlineCandidate')).toBe(false)
    expect(JSON.parse(candidate.output)).toEqual([...JSON.parse(first), ...JSON.parse(second)])
    expect(await db.outlineNodes.where('parentId').equals(session.volumeId).count()).toBe(0)
    await adoptChunkedOutlineSession(recovered)
    expect((await readAgentRunV1(recovered.scope, candidate.runId)).projection.state).toBe('completed')
  })
  it('rejects a second writer with an outdated checkpoint', async () => {
    const { session } = await seed(); const other = structuredClone(session)
    select(session); await saveChunkedOutlineSession(session)
    await expect(saveChunkedOutlineSession(other)).rejects.toThrow('其他页面')
  })
})
