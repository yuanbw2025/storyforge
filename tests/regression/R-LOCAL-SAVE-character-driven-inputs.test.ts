import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import { useCharacterDrivenPlanStore as store } from '../../src/stores/character-driven-plan'
import { useCharacterStore } from '../../src/stores/character'
import { seedCurrentWorkspace, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { readCharacterDrivenInputSourceV1 } from '../../src/lib/authoring/character-driven-input-save'
import * as scopes from '../../src/lib/workspace/scope'
const raw='  # 作者方案\r\n\r\n🌋 e\u0301 尾空白。  '
beforeEach(async()=>{await db.delete();await db.open();resetPendingEditCoordinatorForTestsV1();store.setState({plans:[],loadedScope:null,currentPlanId:null,activePlanId:null,loading:false})})
afterEach(()=>{vi.restoreAllMocks();resetPendingEditCoordinatorForTestsV1();db.close()})
async function fixture(){
 const {scope}=await seedCurrentWorkspace('角色驱动方案050')
 const characterId=await useCharacterStore.getState().addCharacter({projectId:scope.projectId,name:'原角色',roleWeight:'main',moralAxis:'neutral',orderAxis:'neutral',shortDescription:'',appearance:'',personality:'',background:'',profile:'',motivation:'',abilities:'',relationships:'',arc:''})
 await store.getState().loadAll(scope)
 const id=await store.getState().createPlan(scope.projectId,'原方案')
 const arcs=[{characterId,name:'原角色',role:'原角色快照',initialState:'原起点',targetState:'原终点'}]
 await store.getState().saveInputs(id,{arcs,userHint:'原要求'})
 const read=()=>readCharacterDrivenInputSourceV1(id,scope)
 const input={arcs:[{...arcs[0],initialState:raw,targetState:raw}],userHint:raw}
 const save=async(expected?: Awaited<ReturnType<typeof read>>)=>store.getState().saveInputs(id,input,{scope,expected:expected??await read()})
 return {scope,id,characterId,input,read,save}
}
it('confirms exact native input with original Work/UID/version and leaves generated data and active reference intact after reopen',async()=>{
 const f=await fixture();await db.characterDrivenPlans.update(f.id,{generatedVolumes:'[]',status:'adopted',version:3});await store.getState().setActivePlan(f.scope.projectId,f.id)
 const before=await f.read(),saved=await f.save(before)
 db.close();await db.open()
 expect(await f.read()).toEqual(saved)
 expect(saved).toMatchObject({arcs:JSON.stringify(f.input.arcs),userHint:raw,version:3,parentPlanId:before.parentPlanId,generatedVolumes:before.generatedVolumes,status:'draft'})
 expect(Reflect.get(saved,'ragDocumentId')).toBe(Reflect.get(before,'ragDocumentId'))
 expect((await db.works.get(f.scope.workId))?.activeCharacterDrivenPlanId).toBe(f.id)
})
it('rolls back quota, zero rows and wrong poststate before an explicit retry',async()=>{
 const f=await fixture(),before=await f.read()
 const fault=()=>{throw new DOMException('plan input quota','QuotaExceededError')};db.characterDrivenPlans.hook('updating',fault)
 try{await expect(f.save(before)).rejects.toThrow('plan input quota')}finally{db.characterDrivenPlans.hook('updating').unsubscribe(fault)}
 const zero=vi.spyOn(db.characterDrivenPlans,'update').mockResolvedValueOnce(0);await expect(f.save(before)).rejects.toThrow('0行');zero.mockRestore()
 const wrong=()=>({userHint:'wrong native poststate'});db.characterDrivenPlans.hook('updating',wrong)
 try{await expect(f.save(before)).rejects.toThrow('未读到相同方案')}finally{db.characterDrivenPlans.hook('updating').unsubscribe(wrong)}
 expect(await f.read()).toEqual(before);expect((await f.save(before)).userHint).toBe(raw)
})
it('rejects stale, forged, foreign and deleted input bases without laundering malformed author arcs',async()=>{
 const f=await fixture(),before=await f.read(),forged={...before,ragDocumentId:'forged'}
 await expect(f.save(forged)).rejects.toThrow('已被其他页面修改')
 const other=await addCurrentWorkFixtureV1({projectId:f.scope.projectId,worldId:f.scope.worldId,create:{title:'另一Work'}})
 await expect(store.getState().saveInputs(f.id,f.input,{scope:{...f.scope,workId:other.id!},expected:before})).rejects.toThrow('不属于当前作品')
 await expect(store.getState().saveInputs(f.id,{...f.input,arcs:[{...f.input.arcs[0],unknown:'preserve'}] as never},{scope:f.scope,expected:before})).rejects.toThrow('非当前字段')
 expect(await f.read()).toEqual(before);await f.save(before);await expect(f.save(before)).rejects.toThrow('已被其他页面修改')
 await db.characterDrivenPlans.delete(f.id);await expect(f.save(before)).rejects.toThrow('不存在')
})
it('freezes mutable caller and Work before queued execution and never publishes into another loaded Work',async()=>{
 const f=await fixture(),expected=await f.read(),other=await addCurrentWorkFixtureV1({projectId:f.scope.projectId,worldId:f.scope.worldId,create:{title:'另一个Work'}})
 let ready!:()=>void,release!:()=>void;const reached=new Promise<void>(resolve=>{ready=resolve})
 const held=coordinatePendingEditV1({key:`character-driven-inputs:${f.id}`,persist:()=>new Promise<void>(resolve=>{release=resolve;ready()})});await reached
 const input=structuredClone(f.input),scope={...f.scope},saving=store.getState().saveInputs(f.id,input,{scope,expected})
 input.arcs[0].initialState='late caller';input.userHint='late caller';scope.workId=other.id!;expected.userHint='late preimage'
 await db.projects.update(f.scope.projectId,{activeWorkId:other.id});await store.getState().loadAll({...f.scope,workId:other.id!})
 release();await held;await saving
 expect((await f.read()).userHint).toBe(raw);expect(JSON.parse((await f.read()).arcs)[0].initialState).toBe(raw);expect(store.getState().plans).toEqual([])
})
it('rereads late plan snapshots and preserves original soft-reference normalization without modifying author text',async()=>{
 const f=await fixture(),before=await f.read(),original=scopes.readOwnedRows
 let first=true,ready!:()=>void,release!:()=>void;const reached=new Promise<void>(resolve=>{ready=resolve})
 vi.spyOn(scopes,'readOwnedRows').mockImplementation(async<T>(...args:Parameters<typeof original>)=>{const rows=await original<T>(...args);if(first&&args[1]==='characterDrivenPlans'){first=false;await new Promise<void>(resolve=>{release=resolve;ready()})}return rows})
 const loading=store.getState().loadAll(f.scope);await reached
 await db.characters.delete(f.characterId);const saved=await f.save(before);release();await loading
 expect(JSON.parse(saved.arcs)[0]).toMatchObject({characterId:null,name:'原角色',initialState:raw,targetState:raw})
 expect(store.getState().plans[0]).toEqual(saved)
})
it('identifies a known committed input when the postcommit native read fails without claiming a successful save',async()=>{
 const f=await fixture(),before=await f.read(),original=db.characterDrivenPlans.get.bind(db.characterDrivenPlans)
 const fault=vi.spyOn(db.characterDrivenPlans,'get').mockImplementation(key=>!Dexie.currentTransaction&&key===f.id?Promise.reject(new Error('plan postcommit read fault')):original(key))
 let error:unknown;try{await f.save(before)}catch(cause){error=cause}fault.mockRestore()
 expect(error).toBeInstanceOf(Error)
 const committed=Reflect.get(error as object,'committedCharacterDrivenInputsV1')
 expect(committed).toMatchObject({id:f.id,userHint:raw});expect(await f.read()).toEqual(committed)
})
