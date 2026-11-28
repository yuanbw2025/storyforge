import { usePromptStore } from '../../src/stores/prompt'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useHistoryStore } from '../../src/stores/project-singletons'
import { prepareHistoryTextCopilotV1, adoptRestoredHistoryTextCandidateV1, parseHistoryTextRequestV1 } from '../../src/lib/agent/history-text-copilot'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { runDurableMasterAgentPlanV1, restoreMasterAgentCandidatesV1, parseMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1, rejectMasterAgentCandidateV1 } from '../../src/lib/agent/run/master-adoption'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

beforeEach(async () => { await db.delete(); await db.open(); usePromptStore.setState({ templates: [], loaded: false }) })
afterEach(() => { usePromptStore.setState({ templates: [], loaded: false }); vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close() })
async function fixture(empty = false) {
  const f = await seedCurrentWorkspace('061 原历史字段')
  if (!empty) await useHistoryStore.getState().saveForHistoryAuthorV1({ origin: { version: 1, kind: 'work', scope: f.scope }, selection: { kind: 'partition', worldGroupId: null }, patch: { overview: '作者原历史 α', eraSystem: '第三纪元；月有九日' } })
  return f
}
async function run(f: Awaited<ReturnType<typeof fixture>>, field: 'overview' | 'eraSystem' = 'overview') {
  const plan = await createMasterAgentPlan({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: '只生成指定历史文字，待作者确认。', pinnedTask: { agentId: 'world-origin', skillId: 'world-origin.history-text', instruction: '只创作选定历史字段；幻想设想标注待确认。', historyTextRequest: { field, mode: 'expand' } } })
  const sourceBefore = (await db.histories.where('projectId').equals(f.scope.projectId).toArray())[0]
  const conversation = await getOrCreateAgentConversation({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, purpose: 'test-history061' })
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body));expect(sent.messages.map((m: { content: string }) => m.content).join('\n')).toContain('只输出本次固定字段');if (sourceBefore) expect(sent.messages.map((m: { content: string }) => m.content).join('\n')).toContain(sourceBefore.overview)
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, value: '候选历史 α\r\n精确保留尾空格  ' }) } }], usage: { prompt_tokens: 800, completion_tokens: 100, total_tokens: 900 } }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  return { ...await runDurableMasterAgentPlanV1({ scope: f.scope, worldGroupId: null, conversationId: conversation.id!, plan, budget: new AgentTeamBudgetTracker('balanced') }), fetch, plan }
}
it('closes request permissions, binds the original field, and can start from no formal history row', async () => {
  const f = await fixture(true)
  expect(() => parseHistoryTextRequestV1({ field: 'events', mode: 'rewrite' })).toThrow()
  const r = await run(f)
  expect(r.candidates).toHaveLength(1);expect(r.fetch).toHaveBeenCalledTimes(1)
  expect(await db.histories.count()).toBe(0)
  expect(parseMasterAgentPlanV1(r.plan).tasks[0].historyTextRequest).toEqual({ field: 'overview', mode: 'expand' })
  expect(() => parseMasterAgentPlanV1({ ...r.plan, tasks: [{ ...r.plan.tasks[0], skillId: 'world-origin.worldview-field' }] })).toThrow()
  const contract = (await readAgentRunV1(f.scope, r.runId)).contract
  expect(contract.permissions.writeTargets).toEqual([{ table: 'histories', fields: ['overview'], mode: 'author-confirmed' }])
  const c = r.candidates[0]
  await commitMasterAgentCandidateAdoptionV1({ scope: f.scope, worldGroupId: null, runId: r.runId, candidateEventId: c.event.id! })
  expect((await db.histories.toArray())[0]).toMatchObject({ overview: '候选历史 α\r\n精确保留尾空格  ', eraSystem: '', events: '[]' })
})
it('restores an author-edited candidate without another request and atomically rolls back formal text when the receipt fails', async () => {
  const f = await fixture(), before = (await db.histories.toArray())[0], r = await run(f, 'eraSystem')
  const c = r.candidates[0], draft = JSON.stringify({ version: 1, value: '作者候选纪年\n末尾  ' })
  await updateAgentEventCandidate(c.event.id!, f.scope.projectId, draft, f.scope)
  const restored = await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: r.runId })
  expect(restored.candidates[0].draft).toBe(draft)
  const ref = { scope: f.scope, worldGroupId: null, runId: r.runId, candidateEventId: c.event.id! }
  await expect(commitMasterAgentCandidateAdoptionV1(ref, { afterBusinessAdoption: () => { throw Error('receipt fault') } })).rejects.toThrow('receipt fault')
  expect((await db.histories.toArray())[0]).toEqual(before)
  expect((await readAgentRunV1(f.scope, r.runId)).events.some(e => e.type === 'adoption.committed')).toBe(false)
  const originalAdd = db.agentRunEvents.add
  const fault = vi.spyOn(db.agentRunEvents, 'add').mockImplementation(function (this: typeof db.agentRunEvents, event, key) {
    if (event.type === 'step.succeeded') return Promise.reject(new Error('final journal fault')) as ReturnType<typeof originalAdd>
    return originalAdd.call(this, event, key)
  })
  await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('final journal fault')
  fault.mockRestore()
  expect((await db.histories.toArray())[0]).toEqual(before)
  expect((await readAgentRunV1(f.scope, r.runId)).events.some(e => e.type === 'adoption.committed')).toBe(false)
  await commitMasterAgentCandidateAdoptionV1(ref)
  expect((await db.histories.get(before.id!))!).toMatchObject({ overview: before.overview, eraSystem: '作者候选纪年\n末尾  ', events: before.events })
  expect((await verifyMasterAgentRunV1({ scope: f.scope, runId: r.runId })).accepted).toBe(true)
  await commitMasterAgentCandidateAdoptionV1(ref)
  expect(await db.histories.count()).toBe(1);expect(r.fetch).toHaveBeenCalledTimes(1)
})
it('retains a stale draft instead of overwriting a changed original or creating a replacement after deletion', async () => {
  const f = await fixture(), r = await run(f), c = r.candidates[0]
  const row = (await db.histories.toArray())[0]
  await db.histories.update(row.id!, { overview: '作者生成期间又改了' })
  const ref = { scope: f.scope, worldGroupId: null, runId: r.runId, candidateEventId: c.event.id! }
  await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('变化')
  expect((await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: r.runId })).candidates[0].draft).toContain('候选历史')
  await rejectMasterAgentCandidateV1(ref)
  expect((await db.histories.get(row.id!))!.overview).toBe('作者生成期间又改了');expect(r.fetch).toHaveBeenCalledTimes(1)
  const prepared = await prepareHistoryTextCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: { field: 'overview', mode: 'rewrite' }, authorRequest: '指定原总述' })
  await db.histories.delete(row.id!)
  await expect(adoptRestoredHistoryTextCandidateV1({ scope: f.scope, worldGroupId: null, snapshot: prepared.snapshot, draft: '{"version":1,"value":"不能重建"}' })).rejects.toThrow('变化')
  expect(await db.histories.count()).toBe(0)
})
it('rejects foreign scope, readonly all-partitions, short Work and the World-only entry before model dispatch; backup keeps formal text and cancels nonportable candidate', async () => {
  const f = await fixture(), prepared = await prepareHistoryTextCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: { field: 'overview', mode: 'polish' }, authorRequest: '仅润色' })
  const other = await seedCurrentWorkspace('另一作品'), runAI = vi.fn(async () => '{"version":1,"value":"错误"}')
  await expect(adoptRestoredHistoryTextCandidateV1({ scope: other.scope, worldGroupId: null, snapshot: prepared.snapshot, draft: '{"version":1,"value":"错误"}' })).rejects.toThrow('不属于')
  await db.projects.update(f.scope.projectId, { enableMultiWorld: true })
  await expect(prepareHistoryTextCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: { field: 'overview', mode: 'rewrite' }, authorRequest: '' }, { runAI })).rejects.toThrow('具体历史分区')
  await db.projects.update(f.scope.projectId, { enableMultiWorld: false })
  await db.works.update(f.scope.workId, { novelProfile: 'short' })
  await expect(prepareHistoryTextCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: { field: 'overview', mode: 'rewrite' }, authorRequest: '' }, { runAI })).rejects.toThrow('原长篇')
  await db.works.update(f.scope.workId, { novelProfile: 'long' })
  await db.projects.update(f.scope.projectId, { workspacePurpose: 'world-engine' })
  await expect(prepareHistoryTextCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: { field: 'overview', mode: 'rewrite' }, authorRequest: '' }, { runAI })).rejects.toThrow('原长篇')
  expect(runAI).not.toHaveBeenCalled()
  await db.projects.update(f.scope.projectId, { workspacePurpose: 'independent-work' })
  await run(f)
  const backup = await exportProjectJSON(f.scope.projectId), imported = await importProjectJSON(backup)
  expect((await db.histories.where('projectId').equals(imported).toArray())[0].overview).toBe('作者原历史 α')
  const importedRuns = await db.agentRuns.where('projectId').equals(imported).toArray()
  expect(importedRuns.length).toBeGreaterThan(0);expect(importedRuns.every(r => r.status === 'cancelled')).toBe(true)
})

it('reads complete registered history events only in the selected partition', async () => {
  const f = await fixture()
  const { useHistoricalStore } = await import('../../src/stores/historical')
  const eventId = await useHistoricalStore.getState().addEvent({ projectId: f.scope.projectId, era: 'custom', year: 8, date: '灰潮第八轮', title: '原已确认转折', description: '不可遗忘的历史因果 Ω', isHistorical: false }, f.scope)
  const other = await seedCurrentWorkspace('外部历史')
  await useHistoricalStore.getState().addEvent({ projectId: other.scope.projectId, era: 'custom', year: 9, date: '外部', title: '外部禁止读取', description: 'FOREIGN-HISTORY-MUST-NOT-LEAK', isHistorical: false }, other.scope)
  const prepared = await prepareHistoryTextCopilotV1({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: { field: 'overview', mode: 'expand' }, authorRequest: '保留原转折' })
  const sent = JSON.stringify(prepared.prepared.messages)
  expect(sent).toContain('不可遗忘的历史因果 Ω');expect(sent).toContain('作者原历史 α');expect(sent).not.toContain('FOREIGN-HISTORY-MUST-NOT-LEAK')
  expect(prepared.contextGatewayExecution.contextPacket.sourceRefs.some(ref => ref.table === 'historicalTimelineEvents' && ref.recordId === eventId)).toBe(true)
})

it('freezes the selected per-field template and real overrides across changes and recovery, while retaining the mandatory formal packet', async () => {
  const f = await fixture(), store = usePromptStore.getState()
  const template = { ...store.getActive('history.overview'), id: 987, scope: 'user' as const, name: '作者总述模板 A', systemPrompt: 'Frozen-template-A', userPromptTemplate: '可选模板正文', updatedAt: 1, createdAt: 1 }
  usePromptStore.setState({ templates: [template] })
  const plan = await createMasterAgentPlan({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: '按作者总述模板起草', pinnedTask: { agentId: 'world-origin', skillId: 'world-origin.history-text', instruction: '仅生成历史总述', historyTextRequest: { field: 'overview', mode: 'rewrite' }, promptExecution: { version: 1, moduleKey: 'history.overview', userOverride: '本次用户覆盖，仅做正文，不自行拼接资料。' } } })
  const frozen = plan.tasks[0].promptExecution!
  expect(frozen.template.name).toBe('作者总述模板 A');expect(frozen.userOverride).toContain('本次用户覆盖')
  usePromptStore.setState({ templates: [{ ...template, systemPrompt: 'Later-template-B', name: '后来模板 B', updatedAt: 2 }] })
  const conversation = await getOrCreateAgentConversation({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, purpose: 'history061-template' })
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)).messages.map((m: { content: string }) => m.content).join('\n')
    expect(sent).toContain('Frozen-template-A');expect(sent).not.toContain('Later-template-B');expect(sent).toContain('本次用户覆盖');expect(sent).toContain('作者原历史 α');expect(sent).toContain('只输出本次固定字段')
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"version":1,"value":"按原模板的历史候选"}' } }], usage: { prompt_tokens: 800, completion_tokens: 100, total_tokens: 900 } }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  const run = await runDurableMasterAgentPlanV1({ scope: f.scope, worldGroupId: null, conversationId: conversation.id!, plan, budget: new AgentTeamBudgetTracker('balanced') })
  const c = (await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: run.runId })).candidates[0]
  expect(c.payload.promptExecutionEvidence).toMatchObject({ moduleKey: 'history.overview', templateName: '作者总述模板 A', templateHash: frozen.templateHash, overridesHash: frozen.overridesHash })
  expect(() => parseMasterAgentPlanV1({ ...plan, tasks: [{ ...plan.tasks[0], historyTextRequest: { field: 'eraSystem', mode: 'rewrite' } }] })).toThrow('Skill')
  expect(fetch).toHaveBeenCalledTimes(1)
  await commitMasterAgentCandidateAdoptionV1({ scope: f.scope, worldGroupId: null, runId: run.runId, candidateEventId: c.event.id! })
  expect((await db.histories.toArray())[0].overview).toBe('按原模板的历史候选')
})
