import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useNoteStore as store } from '../../src/stores/note'
import { readRecordTextWitnessesV1 } from '../../src/lib/authoring/record-text-save-evidence'
import { matchingLocalSaveAckV1, type LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { seedCurrentWorkspace, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import * as scopes from '../../src/lib/workspace/scope'
const raw='  # 便签原文\r\n\r\n🌋 e\u0301 保留尾空白。  '
beforeEach(async()=>{await db.delete();await db.open();resetPendingEditCoordinatorForTestsV1();store.setState({notes:[],loadedScope:null,loading:false})})
afterEach(()=>{vi.restoreAllMocks();resetPendingEditCoordinatorForTestsV1();db.close()})
async function fixture(){
 const {scope}=await seedCurrentWorkspace('Work便签050')
 await store.getState().loadAll(scope)
 const id=await store.getState().addNote(scope.projectId,'原便签',undefined,'yellow',scope)
 const intent=async():Promise<LocalSaveIntentV1>=>({kind:'natural-field-local-save-v1',session:'work-note',generation:1,expected:(await readRecordTextWitnessesV1('notes',id,scope)).content})
 const save=async(text=raw,proof?:LocalSaveIntentV1)=>store.getState().updateNote(id,{content:text},{scope,confirmation:proof??await intent()})
 return {scope,id,intent,save,read:()=>db.notes.get(id)}
}
it('confirms original Work-local note identity and exact reopened text without inventing a portable UID',async()=>{
 const f=await fixture(),before=(await f.read())!,proof=await f.intent(),ack=await f.save(raw,proof)
 expect(ack.witness).toMatchObject({value:raw,resourceUid:null,identity:{...f.scope,table:'notes',field:'content',recordId:f.id,recordCreatedAt:before.createdAt}})
 expect(matchingLocalSaveAckV1(ack,proof,raw)).toBe(true)
 await store.getState().updateNote(f.id,{color:'blue'},{scope:f.scope});await store.getState().togglePin(f.id,f.scope)
 db.close();await db.open()
 expect(await f.read()).toMatchObject({content:raw,color:'blue',pinned:true,createdAt:before.createdAt})
 expect((await f.read()) as object).not.toHaveProperty('ragDocumentId')
})
it('retains source on quota, zero rows and corrupt poststate then retries exactly once',async()=>{
 const f=await fixture(),before=await f.read(),proof=await f.intent()
 const fault=()=>{throw new DOMException('work note quota','QuotaExceededError')};db.notes.hook('updating',fault)
 try{await expect(f.save(raw,proof)).rejects.toThrow('work note quota')}finally{db.notes.hook('updating').unsubscribe(fault)}
 const zero=vi.spyOn(db.notes,'update').mockResolvedValueOnce(0);await expect(f.save(raw,proof)).rejects.toThrow('0行');zero.mockRestore()
 const corrupt=()=>({content:'wrong native text'});db.notes.hook('updating',corrupt)
 try{await expect(f.save(raw,proof)).rejects.toThrow('精确保存')}finally{db.notes.hook('updating').unsubscribe(corrupt)}
 expect(await f.read()).toEqual(before);await f.save(raw,proof);expect((await f.read())?.content).toBe(raw)
})
it('rejects stale, replaced, forged and foreign notes and cannot change owner or attach a foreign chapter',async()=>{
 const f=await fixture(),proof=await f.intent(),forged=structuredClone(proof)
 forged.expected.valueHash='forged';await expect(f.save(raw,forged)).rejects.toThrow('字段已被修改')
 await expect(store.getState().updateNote(f.id,{projectId:999})).rejects.toThrow('身份')
 const other=await addCurrentWorkFixtureV1({projectId:f.scope.projectId,worldId:f.scope.worldId,create:{title:'另一Work'}})
 await expect(store.getState().updateNote(f.id,{content:raw},{scope:{...f.scope,workId:other.id!},confirmation:proof})).rejects.toThrow(/不属于|凭据无效/)
 await expect(store.getState().updateNote(f.id,{chapterId:999},{scope:f.scope})).rejects.toThrow('关联章节')
 await f.save(raw,proof);await expect(f.save('stale',proof)).rejects.toThrow('字段已被修改')
 const current=await f.intent(),before=(await f.read())!;await db.notes.delete(f.id);await db.notes.add({...before,createdAt:before.createdAt+1})
 await expect(f.save('replaced',current)).rejects.toThrow('身份变化')
 await db.notes.delete(f.id);await expect(f.save('deleted',current)).rejects.toThrow('不存在')
})
it('freezes pending input and Work scope and does not republish into a different Work list',async()=>{
 const f=await fixture(),proof=await f.intent(),other=await addCurrentWorkFixtureV1({projectId:f.scope.projectId,worldId:f.scope.worldId,create:{title:'另一作品'}})
 let ready!:()=>void,release!:()=>void;const reached=new Promise<void>(resolve=>{ready=resolve})
 const held=coordinatePendingEditV1({key:`note:${f.id}`,persist:()=>new Promise<void>(resolve=>{release=resolve;ready()})});await reached
 const scope={...f.scope},data={content:raw};const pending=store.getState().updateNote(f.id,data,{scope,confirmation:proof})
 scope.workId=other.id!;data.content='late caller';proof.expected.valueHash='late proof'
 await store.getState().loadAll({...f.scope,workId:other.id!});release();await held;await pending
 expect(store.getState().notes).toEqual([]);expect((await f.read())?.content).toBe(raw)
})
it('rereads a delayed same-Work note snapshot after the native writer commits',async()=>{
 const f=await fixture(),proof=await f.intent(),original=scopes.readOwnedRows
 let first=true,ready!:()=>void,release!:()=>void;const reached=new Promise<void>(resolve=>{ready=resolve})
 vi.spyOn(scopes,'readOwnedRows').mockImplementation(async<T>(...args:Parameters<typeof original>)=>{
  const rows=await original<T>(...args);if(first&&args[1]==='notes'){first=false;await new Promise<void>(resolve=>{release=resolve;ready()})}return rows
 })
 const loading=store.getState().loadAll(f.scope);await reached;await f.save(raw,proof);release();await loading
 expect(store.getState().notes[0].content).toBe(raw)
})
