import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useHistoryStore } from '../../src/stores/project-singletons'
import { useHistoricalStore } from '../../src/stores/historical'
import { usePromptStore } from '../../src/stores/prompt'
import { createMasterAgentPlan } from '../../src/lib/agent/orchestrator'
import { runDurableMasterAgentPlanV1, restoreMasterAgentCandidatesV1 } from '../../src/lib/agent/run/master-durable'
import { getOrCreateAgentConversation, updateAgentEventCandidate } from '../../src/lib/agent/conversations'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { parseHistoryJointTextCandidateV1 } from '../../src/lib/agent/history-text-copilot'

beforeEach(async()=>{await db.delete();await db.open();usePromptStore.setState({templates:[],loaded:false})})
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();usePromptStore.setState({templates:[],loaded:false});db.close()})
async function fixture(empty=false) {
  const f=await seedCurrentWorkspace('061 总述纪年联合起草'),origin={version:1 as const,kind:'work' as const,scope:f.scope},selection={kind:'partition' as const,worldGroupId:null}
  if(!empty)await useHistoryStore.getState().saveForHistoryAuthorV1({origin,selection,patch:{overview:'作者原总述 Ω',eraSystem:'作者原纪年：第三纪元'}})
  const eventId=await useHistoricalStore.getState().addEvent({projectId:f.scope.projectId,era:'custom',year:19,date:'第三纪元十九年',title:'不可自动改期的事件',description:'原纪年下事件',isHistorical:false},f.scope)
  const output={version:1 as const,values:{overview:'待确认总述候选\n尾空格  ',eraSystem:'待确认纪年：灰潮元年'}}
  const plan=await createMasterAgentPlan({projectId:f.scope.projectId,scope:f.scope,worldGroupId:null,request:'从同一份输入联合起草总述与纪年，我分别选择采用。',pinnedTask:{agentId:'world-origin',skillId:'world-origin.history-text',instruction:'保留作者事实和事件，不自动换算日期。',historyTextRequest:{field:'joint',mode:'expand'}}})
  const conversation=await getOrCreateAgentConversation({projectId:f.scope.projectId,scope:f.scope,worldGroupId:null,purpose:'test-history-joint-text'})
  const fetch=vi.fn(async(_url:unknown,init?:RequestInit)=>{const sent=JSON.parse(String(init?.body)).messages.map((row:{content:string})=>row.content).join('\n');expect(sent).toContain('同一份完整输入');expect(sent).toContain('不可自动改期的事件');if(!empty){expect(sent).toContain('作者原总述 Ω');expect(sent).toContain('作者原纪年：第三纪元')}return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:1200,completion_tokens:300,total_tokens:1500}}),{status:200})})
  vi.stubGlobal('fetch',fetch)
  const run=await runDurableMasterAgentPlanV1({scope:f.scope,worldGroupId:null,conversationId:conversation.id!,plan,budget:new AgentTeamBudgetTracker('balanced')})
  return {...f,origin,selection,eventId,output,plan,run,fetch}
}
it('creates one request with both original canonical grants, leaves both results unselected and permits one-field adoption from empty history',async()=>{
  const f=await fixture(true),c=f.run.candidates[0],ref={scope:f.scope,worldGroupId:null,runId:f.run.runId,candidateEventId:c.event.id!}
  expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.plan.tasks[0].promptExecution?.moduleKey).toBe('history.overview-calendar')
  expect((await readAgentRunV1(f.scope,f.run.runId)).contract.permissions.writeTargets).toEqual([{table:'histories',fields:['overview','eraSystem'],mode:'author-confirmed'}])
  expect(parseHistoryJointTextCandidateV1(c.draft).selectedFields).toBeUndefined()
  await expect(commitMasterAgentCandidateAdoptionV1(ref)).rejects.toThrow('先选择')
  expect(await db.histories.count()).toBe(0)
  await updateAgentEventCandidate(c.event.id!,f.scope.projectId,JSON.stringify({...f.output,selectedFields:['overview']}),f.scope)
  await commitMasterAgentCandidateAdoptionV1(ref)
  expect((await db.histories.toArray())[0]).toMatchObject({overview:f.output.values.overview,eraSystem:'',events:'[]'})
  expect((await db.historicalTimelineEvents.get(f.eventId))!.date).toBe('第三纪元十九年');expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('restores independent edits/selection and commits both fields and the original receipt atomically and idempotently',async()=>{
  const f=await fixture(),c=f.run.candidates[0],before=(await db.histories.toArray())[0]
  const edited={...f.output,values:{...f.output.values,eraSystem:'作者修改后的纪年\r\n尾空格  '},selectedFields:['overview','eraSystem']}
  await updateAgentEventCandidate(c.event.id!,f.scope.projectId,JSON.stringify(edited),f.scope)
  expect((await restoreMasterAgentCandidatesV1({scope:f.scope,runId:f.run.runId})).candidates[0].draft).toBe(JSON.stringify(edited))
  const ref={scope:f.scope,worldGroupId:null,runId:f.run.runId,candidateEventId:c.event.id!}
  await expect(commitMasterAgentCandidateAdoptionV1(ref,{afterBusinessAdoption:()=>{throw Error('original joint receipt fault')}})).rejects.toThrow('original joint receipt fault')
  expect((await db.histories.toArray())[0]).toEqual(before);expect((await readAgentRunV1(f.scope,f.run.runId)).events.some(row=>row.type==='adoption.committed')).toBe(false)
  await commitMasterAgentCandidateAdoptionV1(ref);await commitMasterAgentCandidateAdoptionV1(ref)
  expect((await db.histories.toArray())[0]).toMatchObject(edited.values);expect((await verifyMasterAgentRunV1({scope:f.scope,runId:f.run.runId})).accepted).toBe(true)
  expect((await db.historicalTimelineEvents.get(f.eventId))!.date).toBe('第三纪元十九年');expect(f.fetch).toHaveBeenCalledTimes(1)
})
it('rejects model self-selection/extra fields and retains both candidates and author input when either original field changes',async()=>{
  const f=await fixture(),c=f.run.candidates[0]
  for(const row of [{...f.output,selectedFields:['overview']},{version:1,values:{overview:'缺少纪年'}},{version:1,values:{...f.output.values,events:'越权事件'}}])expect(()=>parseHistoryJointTextCandidateV1(JSON.stringify(row),false)).toThrow()
  await updateAgentEventCandidate(c.event.id!,f.scope.projectId,JSON.stringify({...f.output,selectedFields:['overview']}),f.scope)
  await useHistoryStore.getState().saveForHistoryAuthorV1({origin:f.origin,selection:f.selection,patch:{eraSystem:'作者生成期间修改纪年'}})
  await expect(commitMasterAgentCandidateAdoptionV1({scope:f.scope,worldGroupId:null,runId:f.run.runId,candidateEventId:c.event.id!})).rejects.toThrow('原历史内容已变化')
  expect((await db.histories.toArray())[0]).toMatchObject({overview:'作者原总述 Ω',eraSystem:'作者生成期间修改纪年'})
  expect((await restoreMasterAgentCandidatesV1({scope:f.scope,runId:f.run.runId})).candidates[0].draft).toContain(f.output.values.eraSystem);expect(f.fetch).toHaveBeenCalledTimes(1)
})
