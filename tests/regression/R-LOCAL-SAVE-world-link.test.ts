import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useWorldGroupStore as store } from '../../src/stores/world-group'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import * as scopes from '../../src/lib/workspace/scope'
import { isPortableResourceUidV1 } from '../../src/lib/context-gateway/resource-uid'
const raw = '  # 通道原文\r\n\r\n🌋 e\u0301 方向与代价。  '
beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1(); store.setState({ groups:[], links:[], activeGroupId:null, loadedScope:null, loading:false }) })
afterEach(() => { vi.restoreAllMocks(); resetPendingEditCoordinatorForTestsV1(); db.close() })
async function fixture() {
 const { scope } = await seedCurrentWorkspace('通道保存', { enableMultiWorld:true })
 const a=await store.getState().createGroup({ projectId:scope.projectId, name:'起点',description:'',type:'primary',order:0 },scope)
 const b=await store.getState().createGroup({ projectId:scope.projectId, name:'目标',description:'',type:'parallel',order:1 },scope)
 await store.getState().loadAll(scope)
 const data={ projectId:scope.projectId,fromGroupId:a,toGroupId:b,linkType:'portal' as const,name:'原通道',description:'原描述',bidirectional:false }
 const id=await store.getState().createLink(data,scope)
 return {scope,a,b,data,id}
}
it('creates and updates the same native World UID with exact raw optional text and reopened endpoints', async()=>{
 const f=await fixture(), before=(await db.worldGroupLinks.get(f.id))!
 expect(isPortableResourceUidV1(before.ragDocumentId,'world-group-link')).toBe(true)
 const saved=await store.getState().updateLink(f.id,{name:raw,description:raw,bidirectional:true},{scope:f.scope,expected:before})
 db.close();await db.open()
 expect(await db.worldGroupLinks.get(f.id)).toEqual(saved)
 expect(saved).toMatchObject({ name:raw,description:raw,bidirectional:true,worldId:f.scope.worldId,fromGroupId:f.a,toGroupId:f.b,ragDocumentId:before.ragDocumentId })
 expect(await db.worldGroupLinks.count()).toBe(1)
})
it('retains the native basis on quota, zero-row and corrupt poststate faults, then accepts an explicit retry',async()=>{
 const f=await fixture(), expected=(await db.worldGroupLinks.get(f.id))!
 const change=()=>store.getState().updateLink(f.id,{description:raw},{scope:f.scope,expected})
 const fail=vi.spyOn(db.worldGroupLinks,'update').mockRejectedValueOnce(new Error('link quota'))
 await expect(change()).rejects.toThrow('link quota');fail.mockRestore()
 const zero=vi.spyOn(db.worldGroupLinks,'update').mockResolvedValueOnce(0)
 await expect(change()).rejects.toThrow('0行');zero.mockRestore()
 const corrupt=()=>({description:'wrong poststate'});db.worldGroupLinks.hook('updating',corrupt)
 try {await expect(change()).rejects.toThrow('精确保存')}finally{db.worldGroupLinks.hook('updating').unsubscribe(corrupt)}
 expect(await db.worldGroupLinks.get(f.id)).toEqual(expected)
 await change();expect((await db.worldGroupLinks.get(f.id))?.description).toBe(raw)
})
it('refuses stale forms, missing rows, forged identity patches and foreign endpoints without changing the original relation',async()=>{
 const f=await fixture(), expected=(await db.worldGroupLinks.get(f.id))!, other=(await seedCurrentWorkspace('别的World')).scope
 const foreign=await store.getState().createGroup({projectId:other.projectId,name:'外部World',description:'',type:'primary',order:0},other)
 await expect(store.getState().updateLink(f.id,{toGroupId:foreign},{scope:f.scope,expected})).rejects.toThrow('端点不属于当前 World')
 await expect(store.getState().updateLink(f.id,{fromGroupId:f.b,toGroupId:f.b},{scope:f.scope,expected})).rejects.toThrow('同一世界')
 await expect(store.getState().updateLink(f.id,{worldId:other.worldId} as never,{scope:f.scope})).rejects.toThrow('非作者字段')
 await db.worldGroupLinks.update(f.id,{description:'另页修改'})
 await expect(store.getState().updateLink(f.id,{description:raw},{scope:f.scope,expected})).rejects.toThrow('已被其他页面修改')
 expect((await db.worldGroupLinks.get(f.id))?.description).toBe('另页修改')
 await db.worldGroupLinks.delete(f.id)
 await expect(store.getState().updateLink(f.id,{description:raw},{scope:f.scope})).rejects.toThrow('已不存在')
})
it('freezes queued patch, scope and original form before a different World is loaded',async()=>{
 const f=await fixture(), expected=(await db.worldGroupLinks.get(f.id))!, other=(await seedCurrentWorkspace('另一作品')).scope
 let release!:()=>void,ready!:()=>void
 const entered=new Promise<void>(resolve=>{ready=resolve})
 const held=coordinatePendingEditV1({key:`world-link:${f.id}`,persist:()=>new Promise<void>(resolve=>{release=resolve;ready()})})
 await entered
 const scope={...f.scope},patch={description:raw}
 const pending=store.getState().updateLink(f.id,patch,{scope,expected})
 patch.description='later';Object.assign(scope,other);expected.description='later'
 await store.getState().loadAll(other);release();await held;await pending
 expect(store.getState().loadedScope).toEqual(other);expect(store.getState().links).toEqual([])
 expect((await db.worldGroupLinks.get(f.id))?.description).toBe(raw)
})
it('a confirmed original update fences a delayed same-World link snapshot',async()=>{
 const f=await fixture(), expected=(await db.worldGroupLinks.get(f.id))!, original=scopes.readOwnedRows
 let held=false,ready!:()=>void,release!:()=>void
 const entered=new Promise<void>(resolve=>{ready=resolve})
 vi.spyOn(scopes,'readOwnedRows').mockImplementation(async<T>(...args:Parameters<typeof original>)=>{
  const rows=await original<T>(...args)
  if(args[1]==='worldGroupLinks'&&!held){held=true;await new Promise<void>(resolve=>{release=resolve;ready()})}
  return rows
 })
 const loading=store.getState().loadAll(f.scope);await entered
 await store.getState().updateLink(f.id,{description:raw},{scope:f.scope,expected})
 release();await loading;expect(store.getState().links[0].description).toBe(raw)
})
it('identifies an already committed creation after a failed readback so recovery cannot silently create a second relation',async()=>{
 const f=await fixture()
 const fault=vi.spyOn(db.worldGroupLinks,'get').mockRejectedValueOnce(new Error('readback fault'))
 let failure:unknown
 try {await store.getState().createLink({...f.data,name:raw,description:raw},f.scope)}catch(cause){failure=cause}
 fault.mockRestore()
 expect(failure).toBeInstanceOf(Error)
 const evidence=Reflect.get(failure as object,'committedWorldLink')
 expect(evidence).toMatchObject({id:expect.any(Number),ragDocumentId:expect.any(String)})
 expect(await db.worldGroupLinks.get(evidence.id)).toMatchObject({name:raw,description:raw,ragDocumentId:evidence.ragDocumentId})
 expect(await db.worldGroupLinks.count()).toBe(2)
 const committed=(await db.worldGroupLinks.get(evidence.id))!
 expect(store.getState().links.some(link=>link.id===committed.id)).toBe(false)
 await store.getState().updateLink(committed.id!,{description:raw},{scope:f.scope,expected:committed})
 expect(store.getState().links.find(link=>link.id===committed.id)).toEqual(await db.worldGroupLinks.get(committed.id!))
 expect(await db.worldGroupLinks.count()).toBe(2)
})
