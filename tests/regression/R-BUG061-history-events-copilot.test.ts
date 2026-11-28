import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { runDurableMasterAgentPlanV1, restoreMasterAgentCandidatesV1, parseMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1, rejectMasterAgentCandidateV1 } from '../../src/lib/agent/run/master-adoption'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { allocateHistoryEventDraftIdsV1, type HistoryEventCandidatesV1 } from '../../src/lib/history/event-creation-contract'
import { useHistoricalStore } from '../../src/stores/historical'
import { useHistoryStore } from '../../src/stores/project-singletons'
import { usePromptStore } from '../../src/stores/prompt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

beforeEach(async () => { await db.delete(); await db.open(); usePromptStore.setState({ templates: [], loaded: false }) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); usePromptStore.setState({ templates: [], loaded: false }); db.close() })
async function fixture(mode: 'from-empty' | 'supplement' = 'from-empty') {
  const f = await seedCurrentWorkspace('061 时间轴从零起草')
  const request = { mode, draftIds: allocateHistoryEventDraftIdsV1(2) }
  const events = request.draftIds.map((draftId, index) => ({ draftId, title: `候选灰潮${index}`, era: 'custom', date: `灰潮前${index + 1}旬`, description: `待确认设想：完整事件${index}`, impact: `后果${index}` }))
  if (mode === 'supplement') await useHistoricalStore.getState().addEvent({ projectId: f.scope.projectId, era: 'custom', date: '灰潮元旬', year: null, title: '作者已有事件 α', description: '不可改写的原过程 Ω', isHistorical: false }, f.scope)
  return { ...f, request, events }
}
async function run(f: Awaited<ReturnType<typeof fixture>>) {
  const plan = await createMasterAgentPlan({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: '只生成本批历史事件候选，等作者选择。', pinnedTask: { agentId: 'world-origin', skillId: 'world-origin.history-events', instruction: '只补充本次新事件，保留原历史，等待我选择。', historyEventRequest: f.request } })
  const conversation = await getOrCreateAgentConversation({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, purpose: 'test-history061-events' })
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)).messages.map((m: { content: string }) => m.content).join('\n')
    for (const id of f.request.draftIds) expect(sent).toContain(id)
    if (f.request.mode === 'supplement') expect(sent).toContain('不可改写的原过程 Ω')
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, events: f.events }) } }], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return { ...await runDurableMasterAgentPlanV1({ scope: f.scope, worldGroupId: null, conversationId: conversation.id!, plan, budget: new AgentTeamBudgetTracker('balanced') }), fetch, plan }
}
it('starts with no placeholder, freezes the creation grant and restores unselected candidates without a second request', async () => {
  const f = await fixture(), r = await run(f)
  expect(r.candidates).toHaveLength(1);expect(r.fetch).toHaveBeenCalledTimes(1)
  expect(await db.historicalTimelineEvents.count()).toBe(0)
  expect(parseMasterAgentPlanV1(r.plan).tasks[0].historyEventRequest).toEqual(f.request)
  expect(r.plan.tasks[0].promptExecution?.moduleKey).toBe('history.timeline')
  expect(() => parseMasterAgentPlanV1({ ...r.plan, tasks: [{ ...r.plan.tasks[0], skillId: 'world-origin.history-text' }] })).toThrow()
  const restored = await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: r.runId }), c = restored.candidates[0]
  expect((JSON.parse(c.draft) as HistoryEventCandidatesV1).selectedIds).toBeUndefined()
  const ref = { scope: f.scope, worldGroupId: null, runId: r.runId, candidateEventId: c.event.id! }
  await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('先选择')
  expect(await db.historicalTimelineEvents.count()).toBe(0)
  const contract = (await readAgentRunV1(f.scope, r.runId)).contract
  expect(contract.permissions.writeTargets).toEqual([{ table: 'historicalTimelineEvents', fields: ['title', 'era', 'date', 'description', 'impact'], mode: 'author-confirmed' }])
})
it('commits only the selected author-edited event, rolls back a failed Run receipt and remains idempotent on retry and backup', async () => {
  const f = await fixture(), r = await run(f), c = r.candidates[0]
  const data = { version: 1, events: [{ ...f.events[0], description: '作者修改的过程\n尾空格  ' }, f.events[1]], selectedIds: [f.events[0].draftId] }
  await updateAgentEventCandidate(c.event.id!, f.scope.projectId, JSON.stringify(data), f.scope)
  const ref = { scope: f.scope, worldGroupId: null, runId: r.runId, candidateEventId: c.event.id! }
  await expect(commitMasterAgentCandidateAdoptionV1(ref, { afterBusinessAdoption: () => { throw Error('final receipt fault') } })).rejects.toThrow('final receipt fault')
  expect(await db.historicalTimelineEvents.count()).toBe(0)
  expect((await readAgentRunV1(f.scope, r.runId)).events.some(e => e.type === 'adoption.committed')).toBe(false)
  await commitMasterAgentCandidateAdoptionV1(ref);await commitMasterAgentCandidateAdoptionV1(ref)
  const rows = await db.historicalTimelineEvents.toArray()
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({ title: f.events[0].title, description: data.events[0].description, date: f.events[0].date, year: null, isHistorical: false })
  expect((await verifyMasterAgentRunV1({ scope: f.scope, runId: r.runId })).accepted).toBe(true)
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  expect((await db.historicalTimelineEvents.where('projectId').equals(imported).toArray())[0].description).toBe(data.events[0].description)
  const importedRuns = await db.agentRuns.where('projectId').equals(imported).toArray()
  expect(importedRuns).toHaveLength(1)
  // Completed receipts are kept as history and staled on scope remapping, not reused as current verification.
  expect(importedRuns[0].status).toBe('running')
  const importedEvents = await db.agentRunEvents.where('runId').equals(importedRuns[0].id!).sortBy('sequence')
  expect(importedEvents.at(-1)).toMatchObject({ type: 'verification.staled', payloadJson: expect.stringContaining('project-import-scope-rebound') })
  expect(r.fetch).toHaveBeenCalledTimes(1)
}, 15000)
it('preserves existing events during supplement and blocks stale source without rewriting or regenerating', async () => {
  const f = await fixture('supplement'), before = (await db.historicalTimelineEvents.toArray())[0], r = await run(f), c = r.candidates[0]
  await updateAgentEventCandidate(c.event.id!, f.scope.projectId, JSON.stringify({ version: 1, events: f.events, selectedIds: f.request.draftIds }), f.scope)
  await useHistoryStore.getState().saveForHistoryAuthorV1({ origin: { version: 1, kind: 'work', scope: f.scope }, selection: { kind: 'partition', worldGroupId: null }, patch: { overview: '作者生成期间新增的历史' } })
  const ref = { scope: f.scope, worldGroupId: null, runId: r.runId, candidateEventId: c.event.id! }
  await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('已变化')
  expect(await db.historicalTimelineEvents.toArray()).toEqual([before])
  expect((await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: r.runId })).candidates[0].draft).toContain(f.events[0].title)
  await rejectMasterAgentCandidateV1(ref)
  expect(r.fetch).toHaveBeenCalledTimes(1)
})
