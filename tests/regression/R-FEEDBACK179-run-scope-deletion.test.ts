import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { seedCurrentWorkspace, currentWorkFixtureRecordV1 } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { createAgentRunV1, reviseAgentRunContractV1 } from '../../src/lib/agent/run/event-store'
import { useOutlineStore } from '../../src/stores/outline'
import { cascadeDeleteChapterRecords } from '../../src/lib/chapters/lifecycle'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
function runContract(input: { projectId: number; worldGroupId: number; outlineNodeId: number }) {
  return {
    version: 1,
    objective: '验证导入后的完成凭证失效',
    workflowKind: 'long-running-resumable',
    scope: {
      projectId: input.projectId,
      worldGroupId: input.worldGroupId,
      outlineNodeIds: [input.outlineNodeId],
    },
    permissions: {
      contextSourceKeys: ['worldview', 'storyCore'],
      writeTargets: [{ table: 'outlineNodes', fields: ['summary'], mode: 'candidate-only' }],
    },
    runtimeBindingHash: 'a'.repeat(64),
    budget: {
      maxModelCalls: 1,
      maxToolCalls: 0,
      maxInputTokens: 4_000,
      maxOutputTokens: 1_000,
      maxAttemptsPerStep: 1,
    },
    acceptance: [{ id: 'outline.output', kind: 'output-present', required: true }],
    verificationPlan: [{
      id: 'outline.terminal',
      kind: 'terminal',
      verifier: 'terminal-v1',
      criterionIds: ['outline.output'],
    }],
    failurePolicy: {
      onProtocolError: 'fail',
      onVerificationFailure: 'fail',
      onStaleInput: 'pause-for-author',
    },
  }
}


async function seed() {
 const {scope}=await seedCurrentWorkspace('Issue179 synthetic lifecycle')
 const worldGroupId=await db.worldGroups.add(stampNewRecord(scope,'worldGroups',{name:'Synthetic world',order:0,createdAt:1,updatedAt:1},{owner:'world'})) as number
 const outlineNodeId=await db.outlineNodes.add(stampNewRecord(scope,'outlineNodes',{worldGroupId,parentId:null,type:'volume' as const,title:'Synthetic outline',summary:'',order:0,createdAt:1,updatedAt:1},{owner:'work'})) as number
 const run=await createAgentRunV1({scope,worldGroupId,contract:runContract({projectId:scope.projectId,worldGroupId,outlineNodeId})})
 return {scope,worldGroupId,outlineNodeId,run}
}
describe('Issue179 synthetic backup lifecycle investigation',()=>{
 beforeEach(async()=>{await db.delete();await db.open();useOutlineStore.setState({nodes:[],loading:false,loadedScope:null,loadError:null})})
 afterEach(()=>db.close())
 it('roundtrips a legal intact run with its outline',async()=>{
  const f=await seed();const backup=await exportProjectJSON(f.scope.projectId)
  const id=await importProjectJSON(backup)
  expect(await db.agentRuns.where('projectId').equals(id).count()).toBe(1)
  expect(await db.outlineNodes.where('projectId').equals(id).count()).toBe(1)
 })
 it('rejects a foreign world outline at run creation without inserting another run',async()=>{
  const f=await seed();const g=await db.worldGroups.add(stampNewRecord(f.scope,'worldGroups',{name:'Other group',order:1,createdAt:1,updatedAt:1},{owner:'world'})) as number
  const foreign=await db.outlineNodes.add(stampNewRecord(f.scope,'outlineNodes',{worldGroupId:g,parentId:null,type:'volume' as const,title:'Foreign outline',summary:'',order:1,createdAt:1,updatedAt:1},{owner:'work'})) as number
  await expect(createAgentRunV1({scope:f.scope,worldGroupId:f.worldGroupId,contract:runContract({projectId:f.scope.projectId,worldGroupId:f.worldGroupId,outlineNodeId:foreign})})).rejects.toThrow(/世界组/)
  expect(await db.agentRuns.count()).toBe(1)
 })
 it('rejects a referenced outline deletion and retains the original backup',async()=>{
  const f=await seed();const before=await db.agentRuns.toArray();const events=await db.agentRunEvents.toArray()
  await useOutlineStore.getState().loadAll(f.scope)
  await expect(useOutlineStore.getState().deleteNode(f.outlineNodeId,f.scope)).rejects.toThrow('仍被运行历史引用')
  expect(await db.outlineNodes.get(f.outlineNodeId)).toBeDefined()
  expect(await db.agentRuns.toArray()).toEqual(before)
  expect(await db.agentRunEvents.toArray()).toEqual(events)
  await exportProjectJSON(f.scope.projectId)
 })
 it('retains a target referenced only by an earlier contract generation',async()=>{
  const f=await seed()
  const replacement=await db.outlineNodes.add(stampNewRecord(f.scope,'outlineNodes',{worldGroupId:f.worldGroupId,parentId:null,type:'volume' as const,title:'Replacement',summary:'',order:1,createdAt:1,updatedAt:1},{owner:'work'})) as number
  await reviseAgentRunContractV1({scope:f.scope,runId:f.run.run.id!,contract:runContract({projectId:f.scope.projectId,worldGroupId:f.worldGroupId,outlineNodeId:replacement})})
  const before=await db.agentRunEvents.toArray()
  await useOutlineStore.getState().loadAll(f.scope)
  await expect(useOutlineStore.getState().deleteNode(f.outlineNodeId,f.scope)).rejects.toThrow('仍被运行历史引用')
  expect(await db.agentRunEvents.toArray()).toEqual(before)
  await exportProjectJSON(f.scope.projectId)
 })
 it('rejects direct chapter deletion before changing prose or run events',async()=>{
  const f=await seed()
  const id=await db.chapters.add(stampNewRecord(f.scope,'chapters',{outlineNodeId:f.outlineNodeId,title:'Prose',content:'<p>synthetic prose</p>',wordCount:2,status:'draft' as const,order:0,notes:'',createdAt:1,updatedAt:1},{owner:'work'})) as number
  const c=runContract({projectId:f.scope.projectId,worldGroupId:f.worldGroupId,outlineNodeId:f.outlineNodeId})
  await reviseAgentRunContractV1({scope:f.scope,runId:f.run.run.id!,contract:{...c,scope:{...c.scope,chapterIds:[id]}}})
  const before=await db.chapters.toArray();const events=await db.agentRunEvents.toArray()
  await expect(cascadeDeleteChapterRecords([id])).rejects.toThrow('仍被运行历史引用')
  expect(await db.chapters.toArray()).toEqual(before);expect(await db.agentRunEvents.toArray()).toEqual(events)
  await exportProjectJSON(f.scope.projectId)
 })
 it('rolls back the whole mixed deletion batch and leaves the UI cache intact',async()=>{
  const f=await seed()
  const unused=await db.outlineNodes.add(stampNewRecord(f.scope,'outlineNodes',{worldGroupId:f.worldGroupId,parentId:null,type:'volume' as const,title:'Unused',summary:'',order:1,createdAt:1,updatedAt:1},{owner:'work'})) as number
  await useOutlineStore.getState().loadAll(f.scope)
  const before=await db.outlineNodes.toArray();const cache=structuredClone(useOutlineStore.getState().nodes)
  await expect(useOutlineStore.getState().deleteNodes([unused,f.outlineNodeId],f.scope)).rejects.toThrow('仍被运行历史引用')
  expect(await db.outlineNodes.toArray()).toEqual(before);expect(useOutlineStore.getState().nodes).toEqual(cache)
 })
 it('still deletes an unreferenced outline with other run history present',async()=>{
  const f=await seed()
  const unused=await db.outlineNodes.add(stampNewRecord(f.scope,'outlineNodes',{worldGroupId:f.worldGroupId,parentId:null,type:'volume' as const,title:'Unused',summary:'',order:1,createdAt:1,updatedAt:1},{owner:'work'})) as number
  await useOutlineStore.getState().loadAll(f.scope);await useOutlineStore.getState().deleteNode(unused,f.scope)
  expect(await db.outlineNodes.get(unused)).toBeUndefined();await exportProjectJSON(f.scope.projectId)
 })
 it('preserves the full Work deletion lifecycle including its run history',async()=>{
  const f=await seed();await deleteWork(f.scope.workId!)
  expect(await db.works.get(f.scope.workId!)).toBeUndefined();expect(await db.agentRuns.count()).toBe(0);expect(await db.agentRunEvents.count()).toBe(0)
 })
 it('fails closed on malformed history without mutating the deletion batch',async()=>{
  const f=await seed()
  const unused=await db.outlineNodes.add(stampNewRecord(f.scope,'outlineNodes',{worldGroupId:f.worldGroupId,parentId:null,type:'volume' as const,title:'Unused',summary:'',order:1,createdAt:1,updatedAt:1},{owner:'work'})) as number
  const event=(await db.agentRunEvents.where('runId').equals(f.run.run.id!).toArray()).find(row=>row.type==='contract.accepted')
  await db.agentRunEvents.update(event!.id!,{payloadJson:'invalid'})
  await useOutlineStore.getState().loadAll(f.scope);const before=await db.outlineNodes.toArray()
  await expect(useOutlineStore.getState().deleteNode(unused,f.scope)).rejects.toThrow('无法核验运行历史引用')
  expect(await db.outlineNodes.toArray()).toEqual(before)
 })

 it('does not read or block on malformed history belonging to another Work in the same workspace',async()=>{
  const f=await seed()
  const otherId=await db.works.add(currentWorkFixtureRecordV1({projectId:f.scope.projectId,worldId:f.scope.worldId,title:'Other Work'})) as number
  const otherScope={...f.scope,workId:otherId}
  const otherNode=await db.outlineNodes.add(stampNewRecord(otherScope,'outlineNodes',{worldGroupId:f.worldGroupId,parentId:null,type:'volume' as const,title:'Other Work outline',summary:'',order:1,createdAt:1,updatedAt:1},{owner:'work'})) as number
  const otherRun=await createAgentRunV1({scope:otherScope,worldGroupId:f.worldGroupId,contract:runContract({projectId:f.scope.projectId,worldGroupId:f.worldGroupId,outlineNodeId:otherNode})})
  await db.agentRuns.update(otherRun.run.id!,{contractJson:'invalid'})
  const before=await db.agentRuns.get(otherRun.run.id!)
  const unused=await db.outlineNodes.add(stampNewRecord(f.scope,'outlineNodes',{worldGroupId:f.worldGroupId,parentId:null,type:'volume' as const,title:'Unused own outline',summary:'',order:2,createdAt:1,updatedAt:1},{owner:'work'})) as number
  await useOutlineStore.getState().loadAll(f.scope)
  await useOutlineStore.getState().deleteNode(unused,f.scope)
  expect(await db.outlineNodes.get(unused)).toBeUndefined()
  expect(await db.outlineNodes.get(otherNode)).toBeDefined()
  expect(await db.agentRuns.get(otherRun.run.id!)).toEqual(before)
 })

})
