import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedAvgNativePreview } from '../helpers/avg-native-fixture'
import { createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { useAvgGamePlayerStore } from '../../src/stores/avg-game-player'
import * as runtimeApi from '../../src/lib/avg/runtime-api'

async function instance(title:string){
  const s=await seedAvgNativePreview()
  const session=await createProductRuntimeInstance({scope:s.scope,kind:'avg',title,productSource:{kind:'build',productBuildId:s.buildId,expectedPreviewHash:s.preview.previewHash}})
  return {...s,sessionId:session.id!}
}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done});return {promise,resolve}}
describe('AVG player library and selection scope under delayed actual IndexedDB reads',()=>{
  beforeEach(async()=>{await useAvgGamePlayerStore.getState().select(null);await db.delete();await db.open()})
  afterEach(async()=>{vi.restoreAllMocks();await useAvgGamePlayerStore.getState().select(null);useAvgGamePlayerStore.setState({scope:null,sessions:[],releases:[],error:''});db.close()})
  it('does not replace the new Work library, selected source or loading state with an older load result',async()=>{
    const a=await instance('作品 A 原存档'),b=await instance('作品 B 当前存档'),gate=deferred(),entered=deferred()
    const where=db.productReleases.where.bind(db.productReleases)
    vi.spyOn(db.productReleases,'where').mockImplementation(((index:unknown)=>{
      const clause=where(index as string)
      if(index==='workId'){
        const equals=clause.equals.bind(clause)
        clause.equals=(value:any)=>{const collection=equals(value);if(value===a.scope.workId){const toArray=collection.toArray.bind(collection);collection.toArray=(async()=>{entered.resolve();await gate.promise;return toArray()}) as typeof collection.toArray}return collection}
      }
      return clause
    }) as typeof db.productReleases.where)
    const old=useAvgGamePlayerStore.getState().load(a.scope,null,true)
    await entered.promise
    try{
      await useAvgGamePlayerStore.getState().load(b.scope,null,true);await useAvgGamePlayerStore.getState().select(b.sessionId)
      gate.resolve();await old
      const current=useAvgGamePlayerStore.getState()
      expect(current.scope).toEqual(b.scope);expect(current.selectedSessionId).toBe(b.sessionId)
      expect(current.selectedSourceSessionId).toBe(b.sessionId)
      expect(current.sessions.map(row=>row.id)).toEqual([b.sessionId])
      expect(current.runtimeState.narrative!.contentHash).toBe(b.preview.packageHash)
      expect(current.error).toBe('');expect(current.loading).toBe(false)
    }finally{gate.resolve();await old}
  },30_000)
  it('suppresses an old library failure after another Work has loaded successfully',async()=>{
    const a=await instance('A 失败读取'),b=await instance('B 当前读取'),gate=deferred(),entered=deferred()
    const where=db.productReleases.where.bind(db.productReleases)
    vi.spyOn(db.productReleases,'where').mockImplementation(((index:unknown)=>{
      const clause=where(index as string)
      if(index==='workId'){const equals=clause.equals.bind(clause);clause.equals=(value:any)=>{const collection=equals(value);if(value===a.scope.workId)collection.toArray=(async()=>{entered.resolve();await gate.promise;throw new Error('old-scope-read-failed')}) as typeof collection.toArray;return collection}}
      return clause
    }) as typeof db.productReleases.where)
    const old=useAvgGamePlayerStore.getState().load(a.scope,null,true);await entered.promise
    try{await useAvgGamePlayerStore.getState().load(b.scope,null,true);await useAvgGamePlayerStore.getState().select(b.sessionId);gate.resolve();await old
      expect(useAvgGamePlayerStore.getState().error).toBe('');expect(useAvgGamePlayerStore.getState().selectedSourceSessionId).toBe(b.sessionId)
    }finally{gate.resolve();await old}
  },30_000)
  it('keeps the newer request loading until that request really completes',async()=>{
    const a=await instance('A 较旧读取'),b=await instance('B 未完成读取'),gates=new Map([a.scope.workId,b.scope.workId].map(id=>[id,{gate:deferred(),entered:deferred()}]))
    const where=db.productReleases.where.bind(db.productReleases)
    vi.spyOn(db.productReleases,'where').mockImplementation(((index:unknown)=>{
      const clause=where(index as string)
      if(index==='workId'){const equals=clause.equals.bind(clause);clause.equals=(value:any)=>{const collection=equals(value),held=gates.get(value);if(held){const toArray=collection.toArray.bind(collection);collection.toArray=(async()=>{held.entered.resolve();await held.gate.promise;return toArray()}) as typeof collection.toArray}return collection}}
      return clause
    }) as typeof db.productReleases.where)
    const old=useAvgGamePlayerStore.getState().load(a.scope,null,true);await gates.get(a.scope.workId)!.entered.promise
    const current=useAvgGamePlayerStore.getState().load(b.scope,null,true);await gates.get(b.scope.workId)!.entered.promise
    try{
      gates.get(a.scope.workId)!.gate.resolve();await old
      expect(useAvgGamePlayerStore.getState().loading).toBe(true)
      expect(useAvgGamePlayerStore.getState().selectedManifest).toBeNull()
      await expect(useAvgGamePlayerStore.getState().choose('inspect')).rejects.toThrow(/正在读取/)
      gates.get(b.scope.workId)!.gate.resolve();await current;await useAvgGamePlayerStore.getState().select(b.sessionId)
      expect(useAvgGamePlayerStore.getState().loading).toBe(false);expect(useAvgGamePlayerStore.getState().selectedSourceSessionId).toBe(b.sessionId)
    }finally{for(const held of gates.values())held.gate.resolve();await Promise.allSettled([old,current])}
  },30_000)
  it('finishes an already authorized old checkpoint fork in its owner without selecting it in the new Work',async()=>{
    const a=await instance('A 已授权分支'),b=await instance('B 当前作品')
    await useAvgGamePlayerStore.getState().load(a.scope,null,true);await useAvgGamePlayerStore.getState().select(a.sessionId)
    await useAvgGamePlayerStore.getState().saveCheckpoint('准确起点')
    const checkpoint=useAvgGamePlayerStore.getState().checkpoints[0]!,gate=deferred(),entered=deferred()
    const verify=runtimeApi.verifyProductRuntimeCheckpoint
    vi.spyOn(runtimeApi,'verifyProductRuntimeCheckpoint').mockImplementation(async id=>{entered.resolve();await gate.promise;return verify(id)})
    const pending=useAvgGamePlayerStore.getState().forkCheckpoint(checkpoint.id!);await entered.promise
    try{
      await useAvgGamePlayerStore.getState().load(b.scope,null,true);await useAvgGamePlayerStore.getState().select(b.sessionId)
      gate.resolve();const childId=await pending,child=(await db.productRuntimeSessions.get(childId))!
      expect(child.workId).toBe(a.scope.workId);expect(child.parentSessionId).toBe(a.sessionId)
      expect(useAvgGamePlayerStore.getState().selectedSessionId).toBe(b.sessionId)
      expect(useAvgGamePlayerStore.getState().selectedSourceSessionId).toBe(b.sessionId)
      expect(useAvgGamePlayerStore.getState().runtimeState.narrative!.contentHash).toBe(b.preview.packageHash)
      expect(useAvgGamePlayerStore.getState().busy).toBe(false)
    }finally{gate.resolve();await pending}
  },30_000)
  it('rejects a late voice callback before it can change the current session or its error state',async()=>{
    const a=await instance('A 旧声音'),b=await instance('B 当前声音')
    await useAvgGamePlayerStore.getState().load(b.scope,null,true);await useAvgGamePlayerStore.getState().select(b.sessionId)
    const before=await db.productRuntimeEvents.where('sessionId').equals(b.sessionId).count()
    await expect(useAvgGamePlayerStore.getState().voiceCommand({type:'observe',expectedSessionId:a.sessionId,lineKey:'line.desk',visit:0,generation:'play.1',outcome:'ended',reason:'',playedMs:100})).rejects.toThrow(/不属于当前存档/)
    expect(await db.productRuntimeEvents.where('sessionId').equals(b.sessionId).count()).toBe(before)
    expect(useAvgGamePlayerStore.getState().error).toBe('');expect(useAvgGamePlayerStore.getState().selectedSourceSessionId).toBe(b.sessionId)
  },30_000)
  it('fails closed on a foreign selected session, then permits an explicit valid selection',async()=>{
    const a=await instance('A 不可读取'),b=await instance('B 当前作用域')
    await useAvgGamePlayerStore.getState().load(b.scope,null,true);await useAvgGamePlayerStore.getState().select(b.sessionId)
    await expect(useAvgGamePlayerStore.getState().select(a.sessionId)).rejects.toThrow()
    expect(useAvgGamePlayerStore.getState().selectedSessionId).toBeNull();expect(useAvgGamePlayerStore.getState().selectedManifest).toBeNull()
    expect(useAvgGamePlayerStore.getState().runtimeState.narrative).toBeNull();expect(useAvgGamePlayerStore.getState().error).not.toBe('')
    await useAvgGamePlayerStore.getState().select(b.sessionId)
    expect(useAvgGamePlayerStore.getState().selectedSourceSessionId).toBe(b.sessionId);expect(useAvgGamePlayerStore.getState().error).toBe('')
  },30_000)
})
