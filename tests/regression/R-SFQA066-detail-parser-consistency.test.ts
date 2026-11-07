import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createWorldWork } from '../../src/lib/workspace/works'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import { revalidateDetailedOutlineCreativeDraftV1 } from '../../src/lib/agent/detailed-outline-copilot'
import { runDurableMasterAgentPlanV1, restoreMasterAgentCandidatesV1 } from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'

const config = { provider: 'agnes' as const, model: 'agnes-2.5-flash', baseUrl: 'https://example.invalid/v1',
  apiKey: 'synthetic-only', temperature: 0, maxTokens: 2000 }
const output = JSON.stringify({ openingHook: '来信上的印章仍然温热。', endingCliffhanger: '门外响起失踪亲人的敲门声。',
  sceneLocation: '旧港邮局', emotionArc: 'rising', appearingCharacterIds: [], foreshadowIds: [], prohibitions: [],
  scenes: [{ title: '查验来信', summary: '邮差拒绝承认送过这封信，主角必须找到登记簿证明自己的记忆。',
    location: '邮局柜台', conflict: '主角需要证据，邮差却急于关门。', pace: 'fast', characterIds: [], estimatedWords: 1200 }] })

beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.setState({ config, taskRoutes: {} })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: output }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 } }), { headers: { 'Content-Type': 'application/json' } })))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function candidate() {
  const f = await seedCurrentWorkspace('066同一细纲候选')
  const volumeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
    projectId: f.scope.projectId, parentId: null, type: 'volume', title: '第一卷', summary: '追寻旧信', order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
    projectId: f.scope.projectId, parentId: volumeId, type: 'chapter', title: '旧港来信', summary: '主角收到不可能寄出的家书，前往邮局寻找证据。', order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const plan = await createMasterAgentPlan({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: '生成第一章的场景细纲' })
  expect(plan.tasks).toHaveLength(1); expect(plan.tasks[0].skillId).toBe('outline.details')
  const conversation = await getOrCreateAgentConversation({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, purpose: 'master-authoring' })
  const generated = await runDurableMasterAgentPlanV1({ scope: f.scope, worldGroupId: null, conversationId: conversation.id!, plan })
  expect(generated.candidates).toHaveLength(1)
  const original = generated.candidates[0]
  expect(original.runtime).toBeDefined(); expect(original.draft).toBe(output)
  expect(fetch).toHaveBeenCalledTimes(1)
  await expect.poll(() => db.aiUsageLog.count()).toBe(1)
  expect(await db.detailedOutlines.count()).toBe(0)
  return { ...f, outlineNodeId, generated, original }
}
type Candidate = Awaited<ReturnType<typeof candidate>>

const commit = (f: Candidate, hot: boolean, scope = f.scope) => commitMasterAgentCandidateAdoptionV1({
  scope, runId: f.generated.runId, candidateEventId: f.original.event.id!, worldGroupId: null,
  ...(hot ? { runtime: f.original.runtime! } : {}),
})

async function edit(f: Candidate, draft: string) {
  expect(f.original.payload.narrativeBrief).toBeDefined()
  await updateAgentEventCandidate(f.original.event.id!, f.scope.projectId, draft, f.scope, {
    revalidateCreativeArtifact: ({ creativeArtifact }) => revalidateDetailedOutlineCreativeDraftV1({
      raw: draft, operation: 'enhanced', narrativeBrief: f.original.payload.narrativeBrief!, previousArtifact: creativeArtifact,
    }),
  })
}

// Rewind only this fake IndexedDB fixture so hot/cold consume the exact same
// persisted candidate/hash/owner. No second model answer or business mock.
async function savedDatabase() {
  return Promise.all(db.tables.map(async table => ({ name: table.name, rows: structuredClone(await table.toArray()) as unknown[] })))
}
async function restoreDatabase(saved: Awaited<ReturnType<typeof savedDatabase>>) {
  await db.delete(); await db.open()
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear()
    for (const table of saved) if (table.rows.length) await db.table(table.name).bulkAdd(structuredClone(table.rows))
  })
}

async function adoptedState(f: Candidate, hot: boolean) {
  const restored = await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: f.generated.runId })
  expect(restored.candidates).toHaveLength(1)
  expect(restored.candidates[0].event.id).toBe(f.original.event.id)
  const candidateHash = restored.candidates[0].payload.candidateHash
  await commit(f, hot)
  await commit(f, hot)
  const rows = await db.detailedOutlines.toArray(); expect(rows).toHaveLength(1)
  const snapshot = await readAgentRunV1(f.scope, f.generated.runId)
  const receipts = snapshot.events.filter(event => event.type === 'adoption.committed')
  expect(receipts).toHaveLength(1)
  expect(receipts[0].payload).toMatchObject({ candidateHash })
  expect(snapshot.events.filter(event => event.type === 'step.succeeded')).toHaveLength(1)
  expect(fetch).toHaveBeenCalledTimes(1)
  return { candidateHash, row: rows[0], receipts: receipts.length }
}

it.each([false, true])('same exact frozen detailed candidate commits identically cold/hot, authorEdit=%s', async authorEdit => {
  const f = await candidate()
  if (authorEdit) {
    const edited = JSON.parse(output) as { scenes: Array<{ title: string; summary: string }> }
    edited.scenes[0].title = '作者改为查验登记簿'
    edited.scenes[0].summary = '作者确认主角翻开登记簿，核对旧信与温热印章之间的矛盾。'
    await edit(f, JSON.stringify(edited))
  }
  const saved = await savedDatabase()
  const cold = await adoptedState(f, false)
  expect(cold.row.scenes[0].title).toBe(authorEdit ? '作者改为查验登记簿' : '查验来信')
  await restoreDatabase(saved)
  const hot = await adoptedState(f, true)
  expect(hot.candidateHash).toBe(cold.candidateHash)
  expect(hot.row.outlineNodeId).toBe(f.outlineNodeId)
  expect(hot.row.scenes).toEqual(cold.row.scenes)
  for (const field of ['openingHook', 'endingCliffhanger', 'sceneLocation', 'emotionArc', 'appearingCharacterIds', 'foreshadowIds', 'prohibitions'] as const) {
    expect(hot.row[field]).toEqual(cold.row[field])
  }
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([false, true])('invalid edited detail structure cannot write or resend, hot=%s', async hot => {
  const f = await candidate()
  await edit(f, JSON.stringify({ ...JSON.parse(output), scenes: { title: '非法对象' } }))
  await expect(commit(f, hot)).rejects.toThrow()
  expect(await db.detailedOutlines.count()).toBe(0)
  expect((await readAgentRunV1(f.scope, f.generated.runId)).events.filter(event => event.type === 'adoption.committed')).toHaveLength(0)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([false, true])('changed outline remains stale and preserves the author version, hot=%s', async hot => {
  const f = await candidate()
  await db.outlineNodes.update(f.outlineNodeId, { summary: '作者已保存的新章纲', updatedAt: Date.now() })
  await expect(commit(f, hot)).rejects.toThrow()
  expect((await db.outlineNodes.get(f.outlineNodeId))?.summary).toBe('作者已保存的新章纲')
  expect(await db.detailedOutlines.count()).toBe(0)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([false, true])('new manuscript blocks replacing the future chapter detail, hot=%s', async hot => {
  const f = await candidate()
  const content = '<p>作者在等待期间已经写好的原稿。</p>'
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', { projectId: f.scope.projectId, outlineNodeId: f.outlineNodeId,
    title: '旧港来信', content, wordCount: 18, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  await expect(commit(f, hot)).rejects.toThrow()
  expect((await db.chapters.get(chapterId))?.content).toBe(content)
  expect(await db.detailedOutlines.count()).toBe(0)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([false, true])('changed existing detail is preserved by the original CAS, hot=%s', async hot => {
  const f = await candidate()
  const detailId = await db.detailedOutlines.add(stampNewRecord(f.scope, 'detailedOutlines', {
    projectId: f.scope.projectId, outlineNodeId: f.outlineNodeId, scenes: [{ sceneId: 'author-scene', title: '作者的场景', summary: '保持作者新值',
      characterIds: [], location: '邮局', conflict: '', pace: 'slow', estimatedWords: 100, notes: '' }], createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  await expect(commit(f, hot)).rejects.toThrow()
  expect((await db.detailedOutlines.get(detailId))?.scenes[0].title).toBe('作者的场景')
  expect(await db.detailedOutlines.count()).toBe(1)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each([false, true])('same-world other Work cannot confirm this candidate, hot=%s', async hot => {
  const f = await candidate()
  const other = await createWorldWork(f.scope.projectId, { title: '另一本作品', kind: 'novel', novelProfile: 'long' })
  await expect(commit(f, hot, { ...f.scope, workId: other.id! })).rejects.toThrow()
  expect(await db.detailedOutlines.count()).toBe(0)
  expect(fetch).toHaveBeenCalledTimes(1)
})
