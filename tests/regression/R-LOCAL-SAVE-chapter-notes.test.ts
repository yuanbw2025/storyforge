import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useChapterStore as store } from '../../src/stores/chapter'
import { useOutlineStore } from '../../src/stores/outline'
import { readRecordTextWitnessesV1 } from '../../src/lib/authoring/record-text-save-evidence'
import type { LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { seedCurrentWorkspace, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { coordinatePendingEditV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import * as scopes from '../../src/lib/workspace/scope'

const raw='  # 作者笔记\r\n\r\n🌋 e\u0301 原文与尾空白。  '
beforeEach(async()=>{await db.delete();await db.open();resetPendingEditCoordinatorForTestsV1();store.setState({chapters:[],currentChapter:null,loadedScope:null,loading:false})})
afterEach(()=>{vi.restoreAllMocks();resetPendingEditCoordinatorForTestsV1();db.close()})
async function fixture(){
 const {scope}=await seedCurrentWorkspace('作者笔记050')
 const node=await useOutlineStore.getState().addNode({projectId:scope.projectId,parentId:null,type:'chapter',title:'原章名',summary:'原章纲',order:0},scope)
 const chapter=await store.getState().getOrCreateByOutlineNode(scope.projectId,node,{title:'原章名',content:'<p>作者正文不改 é 🌋。</p>',notes:'原笔记',wordCount:12,status:'draft',order:0})
 await store.getState().loadAll(scope);store.getState().selectChapter(chapter.id!)
 const intent=async():Promise<LocalSaveIntentV1>=>({kind:'natural-field-local-save-v1',session:'chapter-notes',generation:1,expected:(await readRecordTextWitnessesV1('chapters',chapter.id!,scope)).notes})
 const save=async(text=raw,proof?:LocalSaveIntentV1)=>store.getState().updateChapter(chapter.id!,{notes:text},{scope,confirmation:proof??await intent()})
 return {scope,chapter,intent,save,read:()=>db.chapters.get(chapter.id!)}
}
it('confirms exact original chapter notes through the native writer and reopened record without changing prose',async()=>{
 const f=await fixture(),before=(await f.read())!,ack=await f.save()
 expect(ack.witness).toMatchObject({value:raw,resourceUid:before.ragDocumentId,identity:{...f.scope,table:'chapters',field:'notes',recordId:before.id}})
 db.close();await db.open()
 expect(await f.read()).toMatchObject({content:before.content,title:before.title,wordCount:before.wordCount,notes:raw,ragDocumentId:before.ragDocumentId})
 expect(store.getState().currentChapter?.notes).toBe(raw)
})
it('rolls back quota, zero-row and wrong-poststate writes then permits explicit retry',async()=>{
 const f=await fixture(),before=await f.read(),proof=await f.intent()
 const quota=()=>{throw new DOMException('chapter notes quota','QuotaExceededError')};db.chapters.hook('updating',quota)
 try{await expect(f.save(raw,proof)).rejects.toThrow('chapter notes quota')}finally{db.chapters.hook('updating').unsubscribe(quota)}
 const zero=vi.spyOn(db.chapters,'update').mockResolvedValueOnce(0);await expect(f.save(raw,proof)).rejects.toThrow('0行');zero.mockRestore()
 const corrupt=()=>({notes:'wrong poststate'});db.chapters.hook('updating',corrupt)
 try{await expect(f.save(raw,proof)).rejects.toThrow('未读到相同身份与原文')}finally{db.chapters.hook('updating').unsubscribe(corrupt)}
 expect(await f.read()).toEqual(before);expect((await f.save(raw,proof)).witness.value).toBe(raw)
})
it('rejects stale, forged, foreign and removed chapter evidence and disallows notes proof for prose replacement',async()=>{
 const f=await fixture(),proof=await f.intent(),forged=structuredClone(proof)
 forged.expected.valueHash='forged';await expect(f.save(raw,forged)).rejects.toThrow('字段已被修改')
 const foreign=structuredClone(proof);foreign.expected.identity.workId+=100
 await expect(f.save(raw,foreign)).rejects.toThrow('凭据无效')
 await expect(store.getState().updateChapter(f.chapter.id!,{content:'<p>不能用笔记确认写正文</p>'},{scope:f.scope,confirmation:proof})).rejects.toThrow('凭据无效')
 await f.save(raw,proof);await expect(f.save('过期输入',proof)).rejects.toThrow('字段已被修改')
 const latest=await f.intent();await db.chapters.delete(f.chapter.id!);await expect(f.save('记录不存在',latest)).rejects.toThrow('删除')
})
it('freezes pending input and owner before queuing without changing a newly loaded Work cache',async()=>{
 const f=await fixture(),proof=await f.intent(),other=await addCurrentWorkFixtureV1({projectId:f.scope.projectId,worldId:f.scope.worldId,create:{title:'另一作品'}})
 let ready!:()=>void,release!:()=>void;const reached=new Promise<void>(resolve=>{ready=resolve})
 const held=coordinatePendingEditV1({key:`chapter:${f.chapter.id}`,persist:()=>new Promise<void>(resolve=>{release=resolve;ready()})});await reached
 const scope={...f.scope},patch={notes:raw};const pending=store.getState().updateChapter(f.chapter.id!,patch,{scope,confirmation:proof})
 patch.notes='late input';scope.workId=other.id!;proof.expected.valueHash='late proof'
 await store.getState().loadAll({...f.scope,workId:other.id!});release();await held;await pending
 expect((await f.read())?.notes).toBe(raw);expect(store.getState().chapters).toEqual([])
})
it('rereads delayed chapter snapshots after the original notes transaction commits',async()=>{
 const f=await fixture(),proof=await f.intent(),original=scopes.readOwnedRows
 let first=true,ready!:()=>void,release!:()=>void;const reached=new Promise<void>(resolve=>{ready=resolve})
 vi.spyOn(scopes,'readOwnedRows').mockImplementation(async<T>(...args:Parameters<typeof original>)=>{
  const rows=await original<T>(...args);if(first&&args[1]==='chapters'){first=false;await new Promise<void>(resolve=>{release=resolve;ready()})}return rows
 })
 const loading=store.getState().loadAll(f.scope);await reached;await f.save(raw,proof);release();await loading
 expect(store.getState().chapters[0].notes).toBe(raw)
})
