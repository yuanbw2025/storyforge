import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { adoptMasterCandidate, createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { beginMasterAgentCandidateAdoptionV1, commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { createWorldWork } from '../../src/lib/workspace/works'
import { resolveScope } from '../../src/lib/workspace/scope'
import * as scopeReads from '../../src/lib/workspace/scope'
import { adopt } from '../../src/lib/registry/adopt'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import type { WorkspaceScope } from '../../src/lib/types'

const config = { provider: 'custom' as const, model: '068-synthetic', baseUrl: 'http://127.0.0.1:9/v1',
  apiKey: 'synthetic-only', temperature: 0, maxTokens: 4000, contextWindow: 128_000 }
let nextName = '阿明'
beforeEach(async () => {
  await db.delete(); await db.open()
  useAIConfigStore.setState({ config, presets: [], taskRoutes: {} })
  nextName = '阿明'
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
    if (String(url) !== config.baseUrl + '/chat/completions' || options?.method !== 'POST') throw new Error('Unexpected model transport')
    const content = JSON.stringify({ name: nextName, roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral',
      relationships: '帮助港口居民保存来信。', shortDescription: '负责保存港口来信的修表师。' })
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 23, completion_tokens: 17, total_tokens: 40 } }), { headers: { 'Content-Type': 'application/json' } })
  }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function candidate(scope: WorkspaceScope, name: string) {
  nextName = name
  const calls = vi.mocked(fetch).mock.calls.length
  const plan = await createMasterAgentPlan({ projectId: scope.projectId, scope, worldGroupId: null, request: '创建一个新的主要角色' })
  expect(plan.tasks).toHaveLength(1)
  expect(plan.tasks[0]).toMatchObject({ agentId: 'character', skillId: 'character.create' })
  const conversation = await getOrCreateAgentConversation({ projectId: scope.projectId, scope, worldGroupId: null, purpose: 'master-authoring' })
  const generated = await runDurableMasterAgentPlanV1({ scope, worldGroupId: null, conversationId: conversation.id!, plan })
  expect(generated.candidates).toHaveLength(1)
  expect(fetch).toHaveBeenCalledTimes(calls + 1)
  await expect.poll(() => db.aiUsageLog.count()).toBe(calls + 1)
  const original = generated.candidates[0]
  expect(original.runtime).toBeDefined()
  return { scope, generated, original }
}
type Candidate = Awaited<ReturnType<typeof candidate>>
function commit(f: Candidate, scope = f.scope, hot = false) {
  return commitMasterAgentCandidateAdoptionV1({ scope, runId: f.generated.runId,
    candidateEventId: f.original.event.id!, worldGroupId: null, ...(hot ? { runtime: f.original.runtime! } : {}) })
}

it.each([['阿明', '阿明'], ['Ａ明', 'a明']])('two real cold confirmations of %s / %s commit exactly one character and one receipt', async (firstName, secondName) => {
  const f = await seedCurrentWorkspace('068冷态并发')
  const first = await candidate(f.scope, firstName)
  const second = await candidate(f.scope, secondName)
  expect(first.original.payload.baseSnapshot).toEqual(second.original.payload.baseSnapshot)
  expect(await db.characters.count()).toBe(0)
  const outcomes = await Promise.allSettled([commit(first), commit(second)])
  const snapshots = await Promise.all([readAgentRunV1(f.scope, first.generated.runId), readAgentRunV1(f.scope, second.generated.runId)])
  const rows = await db.characters.toArray()
  expect({ fulfilled: outcomes.filter(outcome => outcome.status === 'fulfilled').length,
    rows: rows.length,
    committed: snapshots.flatMap(snapshot => snapshot.events).filter(event => event.type === 'adoption.committed').length,
    succeeded: snapshots.flatMap(snapshot => snapshot.events).filter(event => event.type === 'step.succeeded').length,
  }).toEqual({ fulfilled: 1, rows: 1, committed: 1, succeeded: 1 })
  expect(rows[0].name.normalize('NFKC').trim().toLocaleLowerCase('zh-CN')).toBe(firstName.normalize('NFKC').toLocaleLowerCase('zh-CN'))
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('two valid Work-owned cold confirmations retain final roster CAS across a native IndexedDB write window', async () => {
  const f = await seedCurrentWorkspace('068最终事务窗口')
  const otherWork = await createWorldWork(f.scope.projectId, { title: '068共享世界的另一作品', kind: 'novel', novelProfile: 'long' })
  const otherScope = await resolveScope({ projectId: f.scope.projectId,
    scope: { projectId: f.scope.projectId, worldId: otherWork.worldId, workId: otherWork.id! } })
  expect(otherScope.worldId).toBe(f.scope.worldId)
  expect(otherScope.workId).not.toBe(f.scope.workId)
  const first = await candidate(f.scope, 'Ａ明')
  const second = await candidate(otherScope, 'a明')
  expect(first.original.event.conversationId).not.toBe(second.original.event.conversationId)
  expect(first.original.payload.baseSnapshot).toEqual(second.original.payload.baseSnapshot)
  for (const c of [first, second]) {
    const ref = { scope: c.scope, runId: c.generated.runId, candidateEventId: c.original.event.id!, worldGroupId: null }
    await beginMasterAgentCandidateAdoptionV1(ref)
    const current = await readAgentRunV1(c.scope, c.generated.runId)
    expect(current.projection.steps[c.original.payload.runStepId!]).toMatchObject({ status: 'running', confirmation: 'adopt' })
  }

  // Align only the delivery of two real outer roster reads, without holding a
  // DB lock. An existing native write transaction always reads immediately.
  let enteredBusiness = 0
  let frozenRosterReads = 0
  let bothBusiness!: () => void
  let releaseRows!: () => void
  const ready = new Promise<void>(resolve => { bothBusiness = resolve })
  const rowsReady = new Promise<void>(resolve => { releaseRows = resolve })
  const read = scopeReads.readOwnedRows
  const spy = vi.spyOn(scopeReads, 'readOwnedRows').mockImplementation(async <T,>(...args: Parameters<typeof read>) => {
    const rows = await read<T>(...args)
    if (enteredBusiness === 2 && args[1] === 'characters' && Dexie.currentTransaction?.mode !== 'readwrite' && frozenRosterReads < 2) {
      frozenRosterReads += 1
      if (frozenRosterReads === 2) releaseRows()
      await rowsReady
    }
    return rows
  })
  try {
    // The public dependency seam only aligns the two already-authorized
    // operations; both still execute the unchanged real business adopter.
    const settle = (c: Candidate) => commitMasterAgentCandidateAdoptionV1({
      scope: c.scope, runId: c.generated.runId, candidateEventId: c.original.event.id!, worldGroupId: null,
    }, { adopt: async input => {
      enteredBusiness += 1
      if (enteredBusiness === 2) bothBusiness()
      await ready
      return adoptMasterCandidate(input)
    } }).catch(error => { bothBusiness(); releaseRows(); throw error })
    const outcomes = await Promise.allSettled([settle(first), settle(second)])
    const snapshots = await Promise.all([readAgentRunV1(first.scope, first.generated.runId), readAgentRunV1(second.scope, second.generated.runId)])
    expect({ enteredBusiness, frozenRosterReads,
      fulfilled: outcomes.filter(outcome => outcome.status === 'fulfilled').length,
      rows: await db.characters.count(),
      committed: snapshots.flatMap(snapshot => snapshot.events).filter(event => event.type === 'adoption.committed').length,
      succeeded: snapshots.flatMap(snapshot => snapshot.events).filter(event => event.type === 'step.succeeded').length,
    }).toEqual({ enteredBusiness: 2, frozenRosterReads: 2, fulfilled: 1, rows: 1, committed: 1, succeeded: 1 })
    expect(fetch).toHaveBeenCalledTimes(2)
  } finally { bothBusiness(); releaseRows(); spy.mockRestore() }
})

it.each([false, true])('normal character confirmation remains single-shot and repeatable, hot=%s', async hot => {
  const f = await seedCurrentWorkspace('068正常角色确认')
  const c = await candidate(f.scope, '阿明')
  await commit(c, f.scope, hot)
  await commit(c, f.scope, hot)
  const rows = await db.characters.toArray()
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ name: '阿明', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral',
    shortDescription: '负责保存港口来信的修表师。', relationships: '帮助港口居民保存来信。', worldId: f.scope.worldId, isCrossWorld: false })
  expect(('workId' in rows[0] ? rows[0].workId : undefined) ?? null).toBeNull()
  const run = await readAgentRunV1(f.scope, c.generated.runId)
  expect(run.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  expect(run.events.filter(event => event.type === 'step.succeeded')).toHaveLength(1)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it.each(['same-world-other-work', 'other-project'] as const)('wrong %s owner cannot commit; the original valid owner can still confirm', async owner => {
  const f = await seedCurrentWorkspace('068原候选owner')
  const otherScope = owner === 'other-project'
    ? (await seedCurrentWorkspace('068外项目')).scope
    : await (async () => {
      const work = await createWorldWork(f.scope.projectId, { title: '068外作品', kind: 'novel', novelProfile: 'long' })
      return resolveScope({ projectId: f.scope.projectId, scope: { ...f.scope, workId: work.id! } })
    })()
  const c = await candidate(f.scope, '阿明')
  await expect(commit(c, otherScope)).rejects.toThrow()
  expect(await db.characters.count()).toBe(0)
  const before = await readAgentRunV1(f.scope, c.generated.runId)
  expect(before.events.filter(event => event.type === 'adoption.committed')).toHaveLength(0)
  await commit(c)
  expect(await db.characters.count()).toBe(1)
  const after = await readAgentRunV1(f.scope, c.generated.runId)
  expect(after.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  expect(fetch).toHaveBeenCalledTimes(1)
})

it('a late author-created equivalent name stays unchanged when the frozen cold candidate is rejected', async () => {
  const f = await seedCurrentWorkspace('068迟到同名角色')
  const c = await candidate(f.scope, 'a明')
  const written = await adopt({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, target: 'characters', mode: 'add',
    data: { ...JSON.parse(c.original.draft), name: 'Ａ明', shortDescription: '作者先行保存的原角色内容。', isCrossWorld: false } })
  expect(written.written).toHaveLength(1)
  const row = (await db.characters.toArray())[0]
  await expect(commit(c)).rejects.toThrow()
  expect(await db.characters.toArray()).toEqual([row])
  expect((await readAgentRunV1(f.scope, c.generated.runId)).events.filter(event => event.type === 'adoption.committed')).toHaveLength(0)
  expect(fetch).toHaveBeenCalledTimes(1)
})
