import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { runDurableMasterAgentPlanV1, restoreMasterAgentCandidatesV1, parseMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { createHistoryKeywordDraftV1, readHistoryKeywordDraftsV1, saveHistoryKeywordDraftsV1 } from '../../src/lib/history/keyword-drafts'
import { parseHistoryKeywordContentV1, readHistoryKeywordContentSnapshotV1, historyKeywordContentTransactionTablesV1, type HistoryKeywordContentRequestV1 } from '../../src/lib/history/keyword-content'
import { createHistoryKeywordsFromDraftsV1 } from '../../src/lib/history/keyword-draft-creation'
import { useHistoricalStore } from '../../src/stores/historical'
import { usePromptStore } from '../../src/stores/prompt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { adopt } from '../../src/lib/registry/adopt'

beforeEach(async()=>{await db.delete();await db.open();usePromptStore.setState({templates:[],loaded:false})})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();usePromptStore.setState({templates:[],loaded:false});db.close()})
async function setup() {
  const f=await seedCurrentWorkspace('061 条目字段原主Agent'),origin={scope:f.scope,worldGroupId:null}
  const first={...createHistoryKeywordDraftV1('盐路飞钱'),description:'作者已写的正文不能覆盖',conceptNote:'作者要求只在盐路结算'},second={...createHistoryKeywordDraftV1('灰潮灯市'),selected:true},secret={...createHistoryKeywordDraftV1('未选择的秘密'),conceptNote:'未选择私密草稿不得提交模型'}
  const initial=await saveHistoryKeywordDraftsV1({...origin,expectedRevision:null,value:{version:1,drafts:[first,second,secret]}})
  await useHistoricalStore.getState().addKeyword({projectId:f.scope.projectId,keyword:'正式历史',category:'institution',era:'custom',description:'已确认的完整历史约束'},{projectId:f.scope.projectId,worldId:f.scope.worldId})
  return {...f,origin,first,second,secret,initial}
}
async function fixture() {
  const f=await setup(),request:HistoryKeywordContentRequestV1={mode:'fill-empty',targets:[{draftId:f.first.draftId,fields:['location','aiBrainstorm']},{draftId:f.second.draftId,fields:['description']}]}
  // A valid partial response: the unreturned second draft is not manufactured or silently retried.
  const output={version:1,patches:[{draftId:f.first.draftId,values:{location:'待确认设想：盐路关口',aiBrainstorm:'待确认设想：关口断供引发冲突'}}]}
  const plan=await createMasterAgentPlan({projectId:f.scope.projectId,scope:f.scope,worldGroupId:null,request:'为所选草稿起草字段，保留原文。',pinnedTask:{agentId:'world-origin',skillId:'world-origin.history-keyword-content',instruction:'只补充明确的空白字段，先给候选。',historyKeywordContentRequest:request}})
  const conversation=await getOrCreateAgentConversation({projectId:f.scope.projectId,scope:f.scope,worldGroupId:null,purpose:'test-history-keyword-content'})
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{const sent=JSON.parse(String(init?.body)).messages.map((row:{content:string})=>row.content).join('\n');expect(sent).toContain(f.first.description);expect(sent).toContain(f.first.conceptNote);expect(sent).toContain('已确认的完整历史约束');expect(sent).not.toContain(f.secret.conceptNote);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1000,completion_tokens:300,total_tokens:1300}}),{status:200})})
  vi.stubGlobal('fetch',fetch)
  const run=await runDurableMasterAgentPlanV1({scope:f.scope,worldGroupId:null,conversationId:conversation.id!,plan,budget:new AgentTeamBudgetTracker('balanced')})
  return {...f,request,output,plan,run,fetch}
}
it('freezes exact drafts/fields and leaves partial output unselected and restorable without re-dispatch',async()=>{
  const f=await fixture();expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.run.candidates).toHaveLength(1)
  expect(f.plan.tasks[0].promptExecution?.moduleKey).toBe('history.keyword-content')
  expect(()=>parseMasterAgentPlanV1({...f.plan,tasks:[{...f.plan.tasks[0],skillId:'world-origin.history-keyword-suggestions'}]})).toThrow()
  const restored=await restoreMasterAgentCandidatesV1({scope:f.scope,runId:f.run.runId}),c=restored.candidates[0];expect(JSON.parse(c.draft).selectedTargets).toBeUndefined()
  expect((await readAgentRunV1(f.scope,f.run.runId)).contract.permissions.writeTargets).toEqual([{table:'agentEvents',fields:[],mode:'author-confirmed',adoptionExtension:'history-keyword-suggestions-v1'}])
  await expect(commitMasterAgentCandidateAdoptionV1({scope:f.scope,worldGroupId:null,runId:f.run.runId,candidateEventId:c.event.id!})).rejects.toThrow('先选择')
  const imported=await importProjectJSON(await exportProjectJSON(f.scope.projectId));expect((await db.agentRuns.where('projectId').equals(imported).toArray())[0].status).toBe('cancelled')
  expect(await readHistoryKeywordDraftsV1(f.origin)).toEqual(f.initial);expect(await db.historicalKeywords.count()).toBe(2)
},15000)
it('commits only author-selected fields atomically with original receipt, then creates formal keywords only by explicit author action',async()=>{
  const f=await fixture(),c=f.run.candidates[0],data={...f.output,selectedTargets:[{draftId:f.first.draftId,fields:['location']}]}
  await updateAgentEventCandidate(c.event.id!,f.scope.projectId,JSON.stringify(data),f.scope)
  const ref={scope:f.scope,worldGroupId:null,runId:f.run.runId,candidateEventId:c.event.id!}
  await expect(commitMasterAgentCandidateAdoptionV1(ref,{afterBusinessAdoption:()=>{throw Error('original receipt quota fault')}})).rejects.toThrow('original receipt quota fault')
  expect(await readHistoryKeywordDraftsV1(f.origin)).toEqual(f.initial)
  await commitMasterAgentCandidateAdoptionV1(ref);await commitMasterAgentCandidateAdoptionV1(ref)
  let saved=await readHistoryKeywordDraftsV1(f.origin)
  expect(saved.value.drafts[0]).toMatchObject({...f.first,location:'待确认设想：盐路关口'});expect(saved.value.drafts[1]).toEqual(f.second);expect(saved.value.drafts[2]).toEqual(f.secret)
  expect(await db.historicalKeywords.count()).toBe(1);expect((await verifyMasterAgentRunV1({scope:f.scope,runId:f.run.runId})).accepted).toBe(true);expect(f.fetch).toHaveBeenCalledTimes(1)
  const next=structuredClone(saved.value);next.drafts.forEach(row=>row.selected=row.draftId===f.first.draftId);next.drafts[0].aiBrainstorm='作者确认保留的风暴灵感'
  saved=await saveHistoryKeywordDraftsV1({...f.origin,expectedRevision:saved.revision,value:next})
  await createHistoryKeywordsFromDraftsV1({...f.origin,expectedRevision:saved.revision!})
  const formal=(await db.historicalKeywords.toArray()).find(row=>row.keyword===f.first.keyword)!;expect(formal.description).toBe(f.first.description);expect(formal.aiBrainstorm).toBe('作者确认保留的风暴灵感')
  await expect(readHistoryKeywordContentSnapshotV1(f.origin,{mode:'rewrite',targets:[{draftId:f.first.draftId,fields:['description']}]})).rejects.toThrow('正式词条')
})
it('preserves author changes after dispatch and refuses forged/unrequested fields, model selection and implicit overwrite',async()=>{
  const f=await fixture(),c=f.run.candidates[0]
  for(const output of [{...f.output,selectedTargets:[{draftId:f.first.draftId,fields:['location']}]},{version:1,patches:[{draftId:f.first.draftId,values:{description:'越权改正文'}}]},{version:1,patches:[{draftId:f.secret.draftId,values:{location:'串到未选草稿'}}]},{version:1,patches:[{draftId:f.first.draftId,values:{relatedChapterIds:[]}}]}])expect(()=>parseHistoryKeywordContentV1(JSON.stringify(output),f.request,false)).toThrow()
  await expect(readHistoryKeywordContentSnapshotV1(f.origin,{mode:'fill-empty',targets:[{draftId:f.first.draftId,fields:['description']}]})).rejects.toThrow('不会覆盖')
  await updateAgentEventCandidate(c.event.id!,f.scope.projectId,JSON.stringify({...f.output,selectedTargets:[{draftId:f.first.draftId,fields:['location']}]}),f.scope)
  const changed=structuredClone(f.initial.value);changed.drafts[0].keyword='作者生成期间改名'
  await saveHistoryKeywordDraftsV1({...f.origin,expectedRevision:f.initial.revision,value:changed})
  await expect(commitMasterAgentCandidateAdoptionV1({scope:f.scope,worldGroupId:null,runId:f.run.runId,candidateEventId:c.event.id!})).rejects.toThrow('作者草稿已变化')
  expect((await readHistoryKeywordDraftsV1(f.origin)).value).toEqual(changed);expect((await restoreMasterAgentCandidatesV1({scope:f.scope,runId:f.run.runId})).candidates[0].draft).toContain('盐路关口');expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('uses one native transaction for rewrite-field adoption and rejects rollback or wrong-owner transaction',async()=>{
  const f=await setup(),request:HistoryKeywordContentRequestV1={mode:'rewrite',targets:[{draftId:f.first.draftId,fields:['description']}]},snapshot=await readHistoryKeywordContentSnapshotV1(f.origin,request)
  const input={target:'agentEvents' as const,mode:'add-many' as const,historyKeywordContent:snapshot,data:{version:1 as const,patches:[{draftId:f.first.draftId,values:{description:'作者确认的改写候选'}}],selectedTargets:request.targets}}
  await expect(db.transaction('rw',historyKeywordContentTransactionTablesV1(),async()=>{await adopt(input,{transaction:Dexie.currentTransaction!});throw Error('outer fault')})).rejects.toThrow('outer fault')
  expect(await readHistoryKeywordDraftsV1(f.origin)).toEqual(f.initial)
  await expect(db.transaction('rw',db.agentEvents,async()=>adopt(input,{transaction:Dexie.currentTransaction!}))).rejects.toThrow('缺少原作用域写入事务')
  await adopt(input)
  expect((await readHistoryKeywordDraftsV1(f.origin)).value.drafts[0]).toEqual({...f.first,description:'作者确认的改写候选'});expect(await db.historicalKeywords.count()).toBe(1)
})
