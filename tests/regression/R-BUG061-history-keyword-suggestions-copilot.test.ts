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
import { allocateHistoryKeywordSuggestionIdsV1 } from '../../src/lib/history/keyword-suggestions'
import { createHistoryKeywordDraftV1, readHistoryKeywordDraftsV1, saveHistoryKeywordDraftsV1 } from '../../src/lib/history/keyword-drafts'
import { useHistoricalStore } from '../../src/stores/historical'
import { usePromptStore } from '../../src/stores/prompt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

beforeEach(async () => { await db.delete(); await db.open();usePromptStore.setState({ templates: [], loaded: false }) })
afterEach(() => { vi.unstubAllGlobals();vi.restoreAllMocks();usePromptStore.setState({ templates: [], loaded: false });db.close() })
async function fixture(withFormal = true, withAuthor = true) {
  const f = await seedCurrentWorkspace('061 推荐关键词原主Agent'), origin = { scope: f.scope, worldGroupId: null }
  const initial = withAuthor ? await saveHistoryKeywordDraftsV1({ ...origin, expectedRevision: null, value: { version: 1, drafts: [{ ...createHistoryKeywordDraftV1('作者私有待处理词'), conceptNote: '只在草稿的秘密未确认' }] } }) : await readHistoryKeywordDraftsV1(origin)
  if (withFormal) await useHistoricalStore.getState().addKeyword({ projectId: f.scope.projectId, keyword: '作者既有飞钱', category: 'economy', era: 'custom', description: '已确认名义，只读完整片段' }, { projectId: f.scope.projectId, worldId: f.scope.worldId })
  const request = { draftIds: allocateHistoryKeywordSuggestionIdsV1(2) }, suggestions = request.draftIds.map((draftId,index) => ({ draftId, keyword: `候选盐路${index}`, category: 'economy' as const, era: 'custom', reason: '待确认设想：商贸交换的场景方向。' }))
  const plan = await createMasterAgentPlan({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, request: '推荐历史关键词，等我选择。', pinnedTask: { agentId: 'world-origin', skillId: 'world-origin.history-keyword-suggestions', instruction: '仅建议关键词，不生成条目或作者意见。', historyKeywordSuggestionRequest: request } })
  const conversation = await getOrCreateAgentConversation({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, purpose: 'test-history-keyword-suggest' })
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)).messages.map((m: { content: string }) => m.content).join('\n')
    if (withFormal) expect(sent).toContain('已确认名义，只读完整片段');expect(sent).not.toContain('只在草稿的秘密未确认')
    for (const id of request.draftIds) expect(sent).toContain(id)
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, suggestions }) } }], usage: { prompt_tokens: 900, completion_tokens: 200, total_tokens: 1100 } }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetch)
  const run = await runDurableMasterAgentPlanV1({ scope: f.scope, worldGroupId: null, conversationId: conversation.id!, plan, budget: new AgentTeamBudgetTracker('balanced') })
  return { ...f, origin, initial, plan, request, suggestions, fetch, run }
}
it('starts from empty formal history, keeps recommendations unselected, private drafts out of context and backup runs nonportable', async () => {
  const f = await fixture(false);expect(f.run.candidates).toHaveLength(1);expect(f.fetch).toHaveBeenCalledTimes(1)
  expect(f.plan.tasks[0].promptExecution?.moduleKey).toBe('history.keyword-suggestions')
  expect(() => parseMasterAgentPlanV1({ ...f.plan, tasks: [{ ...f.plan.tasks[0], skillId: 'world-origin.history-events' }] })).toThrow()
  const restored = await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: f.run.runId }), c = restored.candidates[0]
  expect(JSON.parse(c.draft).selectedIds).toBeUndefined()
  expect((await readAgentRunV1(f.scope,f.run.runId)).contract.permissions.writeTargets).toEqual([{ table: 'agentEvents', fields: [], mode: 'author-confirmed', adoptionExtension: 'history-keyword-suggestions-v1' }])
  await expect(commitMasterAgentCandidateAdoptionV1({ scope:f.scope,worldGroupId:null,runId:f.run.runId,candidateEventId:c.event.id! })).rejects.toThrow('先选择')
  expect(await readHistoryKeywordDraftsV1(f.origin)).toEqual(f.initial);expect(await db.historicalKeywords.count()).toBe(0)
  const imported = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const importedRuns = await db.agentRuns.where('projectId').equals(imported).toArray()
  expect(importedRuns).toHaveLength(1);expect(importedRuns[0].status).toBe('cancelled')
},15000)
it('atomically transfers chosen edited suggestions with original Run receipt, keeps official content and retry identity unchanged', async () => {
  const f = await fixture(true, false), c = f.run.candidates[0], suggestions = [{ ...f.suggestions[0], keyword: '作者改名后的盐路' },f.suggestions[1]]
  await updateAgentEventCandidate(c.event.id!,f.scope.projectId,JSON.stringify({ version:1,suggestions,selectedIds:[suggestions[0].draftId] }),f.scope)
  const ref = { scope:f.scope,worldGroupId:null,runId:f.run.runId,candidateEventId:c.event.id! }
  await expect(commitMasterAgentCandidateAdoptionV1(ref,{afterBusinessAdoption:()=>{throw Error('original Run receipt quota fault')}})).rejects.toThrow('original Run receipt quota fault')
  expect(await readHistoryKeywordDraftsV1(f.origin)).toEqual(f.initial)
  expect((await readAgentRunV1(f.scope,f.run.runId)).events.some(row=>row.type==='adoption.committed')).toBe(false)
  await commitMasterAgentCandidateAdoptionV1(ref);await commitMasterAgentCandidateAdoptionV1(ref)
  const drafts=(await readHistoryKeywordDraftsV1(f.origin)).value.drafts
  expect(drafts).toHaveLength(1);expect(drafts[0]).toMatchObject({draftId:suggestions[0].draftId,keyword:'作者改名后的盐路',description:'',conceptNote:'',selected:true})
  expect(await db.historicalKeywords.count()).toBe(1)
  expect((await verifyMasterAgentRunV1({scope:f.scope,runId:f.run.runId})).accepted).toBe(true)
  expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('retains changed author input and the candidate when the draft source becomes stale, with no extra model request',async()=>{
  const f=await fixture(),c=f.run.candidates[0]
  await updateAgentEventCandidate(c.event.id!,f.scope.projectId,JSON.stringify({version:1,suggestions:f.suggestions,selectedIds:f.request.draftIds}),f.scope)
  const value=structuredClone(f.initial.value);value.drafts[0].description='作者生成期间新增的文字'
  await saveHistoryKeywordDraftsV1({...f.origin,expectedRevision:f.initial.revision,value})
  const ref={scope:f.scope,worldGroupId:null,runId:f.run.runId,candidateEventId:c.event.id!}
  await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('作者草稿已变化')
  expect((await readHistoryKeywordDraftsV1(f.origin)).value).toEqual(value)
  expect((await restoreMasterAgentCandidatesV1({scope:f.scope,runId:f.run.runId})).candidates[0].draft).toContain(f.suggestions[0].keyword)
  await rejectMasterAgentCandidateV1(ref);expect(f.fetch).toHaveBeenCalledTimes(1)
})
