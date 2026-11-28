import Dexie from 'dexie'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useCultivationStore } from '../../src/stores/cultivation'
import { useWorldviewStore } from '../../src/stores/worldview'
import { readPowerAuthoringBaselineV1, powerAuthoringTransactionTablesV1, powerRemovalImpactHashV1, type AdoptPowerAuthoringInputV1 } from '../../src/lib/cultivation/power-authoring-adoption'
import type { PowerAuthoringTargetV1 } from '../../src/lib/cultivation/power-authoring-contract'
import { seedCurrentWorkspace, currentWorkFixtureRecordV1 } from '../helpers/current-workspace'
const raw = '  # 作者候选\r\n\r\n完整尾空白 e\u0301🌋  '
const stages = JSON.stringify([
 { id: 'root', name: '起境', parentStageIds: [], features: '旧能力', breakthrough: '旧代价', authorExtra: { note: '不变', value: 125 } },
 { id: 'left', name: '左路', parentStageIds: ['root'] },
 { id: 'right', name: '右路', parentStageIds: ['root'] },
 { id: 'merge', name: '合流', parentStageIds: ['left','right'] },
])
beforeEach(async () => { await db.delete(); await db.open(); useCultivationStore.setState({ systems: [], loadedScope: null, loading: false, loadError: null }) })
afterEach(() => { vi.restoreAllMocks(); db.close() })
async function fixture() {
 const f = await seedCurrentWorkspace('048 原生定点采纳')
 const id = await useCultivationStore.getState().addSystem({ projectId: f.scope.projectId, name: '原路径', description: '原原理', stages }, f.scope)
 return { ...f, id, powerScope: { ...f.scope, worldGroupId: null } }
}
async function intent(f: Awaited<ReturnType<typeof fixture>>, edit: PowerAuthoringTargetV1, data: unknown): Promise<AdoptPowerAuthoringInputV1> {
 const baseline = await readPowerAuthoringBaselineV1(f.powerScope, edit)
 return { target: edit.table, powerAuthoring: { scope: f.powerScope, edit, recordHash: baseline.recordHash, referenceHash: baseline.referenceHash, allocatedStageIds: [] }, data, mode: 'replace' }
}
const stageTarget = (id: number): PowerAuthoringTargetV1 => ({ table: 'cultivationSystems', recordId: id, field: 'stages', stageId: 'root', stageField: 'features' })

it('adopts exact independent text and one stage leaf in the original World/UID without rewriting siblings', async () => {
 const f = await fixture(), before = (await db.cultivationSystems.get(f.id))!
 const input = await intent(f, stageTarget(f.id), raw)
 expect(await adopt(input)).toMatchObject({ written: [{ id: f.id, fields: ['stages'] }] })
 const saved = (await db.cultivationSystems.get(f.id))!, graph = JSON.parse(saved.stages)
 expect(Reflect.get(saved,'ragDocumentId')).toBe(Reflect.get(before,'ragDocumentId'))
 expect(saved.name).toBe(before.name); expect(saved.description).toBe(before.description)
 expect(graph[0]).toEqual({ ...JSON.parse(stages)[0], features: raw }); expect(graph.slice(1)).toEqual(JSON.parse(stages).slice(1))
 await adopt(await intent(f, { table:'cultivationSystems', recordId:f.id, field:'description' }, ''))
 expect((await db.cultivationSystems.get(f.id))!.description).toBe('')
 await useWorldviewStore.getState().savePowerSystem({ projectId:f.scope.projectId, name:'正式底层力量', description:'原总体', rules:'原通用规则', levels:'原独立等级说明' }, f.scope)
 const detail = (await db.powerSystems.where('projectId').equals(f.scope.projectId).first())!
 await adopt(await intent(f, { table:'powerSystems',recordId:detail.id!,field:'rules' }, raw))
 expect(await db.powerSystems.get(detail.id!)).toMatchObject({ rules:raw,name:detail.name,description:detail.description,levels:detail.levels })
 expect(await db.cultivationSystems.count()).toBe(1)
})

it('rejects stale records, foreign scopes, replaced UID and malformed target hybrids before writing', async () => {
 const f=await fixture(), input=await intent(f,stageTarget(f.id),raw)
 await db.cultivationSystems.update(f.id,{description:'作者后续手改'})
 await expect(adopt(input)).rejects.toThrow('已变化')
 const fresh=await intent(f,stageTarget(f.id),raw), other=await seedCurrentWorkspace('外部作品')
 await expect(adopt({...fresh,powerAuthoring:{...fresh.powerAuthoring,scope:{...other.scope,worldGroupId:null}}})).rejects.toThrow('其他 World')
 await expect(adopt({...fresh,projectId:f.scope.projectId} as unknown as AdoptPowerAuthoringInputV1)).rejects.toThrow('未登记字段')
 await db.cultivationSystems.update(f.id,{ragDocumentId:'forged'} as never)
 await expect(adopt(fresh)).rejects.toThrow('身份缺失')
 expect((await db.cultivationSystems.get(f.id))!.stages).toBe(stages)
})

it('rejects cyclic/dangling/unallocated path plans and does not accept empty names or broken old graphs', async () => {
 const f=await fixture(), edit:PowerAuthoringTargetV1={table:'cultivationSystems',recordId:f.id,field:'stages'}
 for(const data of [
  {version:1,updates:[{id:'root',patch:{parentStageIds:['merge']}}],additions:[],removals:[]},
  {version:1,updates:[{id:'root',patch:{parentStageIds:['unknown']}}],additions:[],removals:[]},
  {version:1,updates:[],additions:[{id:'invented',name:'模型私造',parentStageIds:[]}],removals:[]},
 ]) await expect(adopt(await intent(f,edit,data))).rejects.toThrow()
 await expect(adopt(await intent(f,{table:'cultivationSystems',recordId:f.id,field:'name'},'  '))).rejects.toThrow('不能为空')
 await db.cultivationSystems.update(f.id,{stages:'{original broken'})
 await expect(adopt(await intent(f,stageTarget(f.id),raw))).rejects.toThrow('invalid JSON')
 expect((await db.cultivationSystems.get(f.id))!.stages).toBe('{original broken')
})

async function refs(f:Awaited<ReturnType<typeof fixture>>) {
 const character=await db.characters.add(stampNewRecord(f.scope,'characters',{projectId:f.scope.projectId,name:'关联角色',roleWeight:'main',moralAxis:'neutral',orderAxis:'neutral',cultivationSystemId:f.id,cultivationStageId:'merge',createdAt:1,updatedAt:1},{owner:'world'}) as never)
 const progress=await db.cultivationProgress.add(stampNewRecord(f.scope,'cultivationProgress',{projectId:f.scope.projectId,characterId:character,characterName:'关联角色',cultivationSystemId:f.id,cultivationSystemName:'原路径',stageId:'merge',stageName:'合流',transition:'enter',sourceChapterTitle:'原章',sourceQuote:'保留原进度证据',sourceOffset:0,trigger:'入境',status:'confirmed',createdAt:1,updatedAt:1},{owner:'work'}) as never)
 return {character,progress}
}
it('requires explicit current removal impact and atomically preserves history while clearing only removed-stage references', async () => {
 const f=await fixture(), r=await refs(f), edit:PowerAuthoringTargetV1={table:'cultivationSystems',recordId:f.id,field:'stages'}
 const data={version:1,updates:[],additions:[],removals:['merge']}
 const input=await intent(f,edit,data), baseline=await readPowerAuthoringBaselineV1(f.powerScope,edit)
 expect(baseline.references).toMatchObject([{table:'characters',id:r.character,stageId:'merge'},{table:'cultivationProgress',id:r.progress,stageId:'merge'}])
 await expect(adopt(input)).rejects.toThrow('确认当前引用影响')
 input.powerAuthoring.confirmedRemovalHash=await powerRemovalImpactHashV1(baseline,['merge'])
 const quota=vi.spyOn(db.characters,'update').mockRejectedValueOnce(new Error('reference quota'))
 await expect(adopt(input)).rejects.toThrow('reference quota'); quota.mockRestore()
 expect((await db.cultivationSystems.get(f.id))!.stages).toBe(stages)
 expect((await db.characters.get(r.character))!.cultivationStageId).toBe('merge')
 expect((await db.cultivationProgress.get(r.progress))!.status).toBe('confirmed')
 await adopt(input)
 expect(JSON.parse((await db.cultivationSystems.get(f.id))!.stages).map((s:{id:string})=>s.id)).toEqual(['root','left','right'])
 expect(await db.characters.get(r.character)).toMatchObject({cultivationSystemId:f.id,cultivationStageId:null})
 expect(await db.cultivationProgress.get(r.progress)).toMatchObject({stageId:null,status:'source-missing',sourceQuote:'保留原进度证据'})
})

it('treats newly added references as stale and refuses corrupt cross-World links without touching any owner', async () => {
 const f=await fixture(), input=await intent(f,stageTarget(f.id),raw)
 const r=await refs(f)
 await expect(adopt(input)).rejects.toThrow('引用已变化')
 const other=await seedCurrentWorkspace('引用的外部世界')
 await db.characters.update(r.character,{worldId:other.scope.worldId})
 await expect(readPowerAuthoringBaselineV1(f.powerScope,stageTarget(f.id))).rejects.toThrow('跨 World')
 expect((await db.cultivationSystems.get(f.id))!.stages).toBe(stages)
 expect((await db.characters.get(r.character))!.worldId).toBe(other.scope.worldId)
})

it('allows explicitly affected progress in a sibling Work of the same World and stales its old named-stage evidence', async () => {
 const f=await fixture(), r=await refs(f)
 const workId=await db.works.add(currentWorkFixtureRecordV1({projectId:f.scope.projectId,worldId:f.scope.worldId,title:'同世界另一原作'}))
 await db.cultivationProgress.update(r.progress,{workId})
 const input=await intent(f,{table:'cultivationSystems',recordId:f.id,field:'stages',stageId:'merge',stageField:'name'},'新合流')
 await adopt(input)
 expect(await db.cultivationProgress.get(r.progress)).toMatchObject({workId,stageId:'merge',stageName:'合流',status:'stale',sourceQuote:'保留原进度证据'})
})

it('rolls back field, original references and progress when a caller Run receipt fails; rejects incomplete native owner tables', async () => {
 const f=await fixture(), r=await refs(f), input=await intent(f,{table:'cultivationSystems',recordId:f.id,field:'stages',stageId:'merge',stageField:'name'},'新合流')
 const original=(await db.cultivationSystems.get(f.id))!
 await expect(db.transaction('rw',powerAuthoringTransactionTablesV1('cultivationSystems'),()=>{
  const transaction=Dexie.currentTransaction!
  return Dexie.Promise.resolve(adopt(input,{transaction})).then(()=>{throw new Error('subsequent Run receipt failure')})
 })).rejects.toThrow('Run receipt failure')
 expect(await db.cultivationSystems.get(f.id)).toEqual(original)
 expect((await db.cultivationProgress.get(r.progress))!.status).toBe('confirmed')
 await expect(db.transaction('rw',db.cultivationSystems,()=>adopt(input,{transaction:Dexie.currentTransaction!}))).rejects.toThrow('生命周期表')
 for(const [value,message] of [[new Error('quota'),'quota'],[0,'0行']] as const){
  const fault=value instanceof Error?vi.spyOn(db.cultivationSystems,'update').mockRejectedValueOnce(value):vi.spyOn(db.cultivationSystems,'update').mockResolvedValueOnce(value)
  await expect(adopt(input)).rejects.toThrow(message); fault.mockRestore()
 }
 const corrupt=()=>({description:'unexpected collateral edit'}); db.cultivationSystems.hook('updating',corrupt)
 try {await expect(adopt(input)).rejects.toThrow('后态不匹配')} finally {db.cultivationSystems.hook('updating').unsubscribe(corrupt)}
 expect(await db.cultivationSystems.get(f.id)).toEqual(original)
 await adopt(input); expect((await db.cultivationProgress.get(r.progress))!.status).toBe('stale')
})

it('keeps Canon source status in the same native adoption and refuses a false zero-row fact acknowledgement', async () => {
 const f=await fixture()
 const {fingerprintSettingSource}=await import('../../src/lib/fact-ledger/setting-assertions')
 const factId=await db.temporalFacts.add(stampNewRecord(f.scope,'temporalFacts',{projectId:f.scope.projectId,subjectName:'原路径',predicate:'powerCeiling',factKind:'state',value:'旧阶段',sourceType:'setting',sourceRecordTable:'cultivationSystems',sourceCultivationSystemId:f.id,sourceField:'stages',sourceFingerprint:fingerprintSettingSource(stages),status:'confirmed',locked:false,createdAt:1,updatedAt:1},{owner:'work'}) as never)
 const input=await intent(f,stageTarget(f.id),raw)
 const zero=vi.spyOn(db.temporalFacts,'update').mockResolvedValueOnce(0)
 await expect(adopt(input)).rejects.toThrow('Canon 来源状态后态'); zero.mockRestore()
 expect((await db.cultivationSystems.get(f.id))!.stages).toBe(stages)
 expect((await db.temporalFacts.get(factId))!.status).toBe('confirmed')
 await adopt(input)
 expect((await db.temporalFacts.get(factId))!.status).toBe('stale')
})

it('aborts an original Run transaction even if its caller catches a lifecycle failure after the formal write', async () => {
 const f=await fixture(), r=await refs(f), edit:PowerAuthoringTargetV1={table:'cultivationSystems',recordId:f.id,field:'stages'}
 const input=await intent(f,edit,{version:1,updates:[],additions:[],removals:['merge']})
 const before=await readPowerAuthoringBaselineV1(f.powerScope,edit)
 input.powerAuthoring.confirmedRemovalHash=await powerRemovalImpactHashV1(before,['merge'])
 const zero=vi.spyOn(db.cultivationProgress,'update').mockResolvedValueOnce(0)
 let caught=''
 try{
  await expect(db.transaction('rw',powerAuthoringTransactionTablesV1('cultivationSystems'),()=>{
   const transaction=Dexie.currentTransaction!
   return Dexie.Promise.resolve(adopt(input,{transaction})).catch(error=>{caught=String(error)})
  })).rejects.toThrow()
 }finally{zero.mockRestore()}
 expect(caught).toContain('0行')
 expect((await db.cultivationSystems.get(f.id))!.stages).toBe(stages)
 expect((await db.characters.get(r.character))!.cultivationStageId).toBe('merge')
 expect((await db.cultivationProgress.get(r.progress))!.status).toBe('confirmed')
})
