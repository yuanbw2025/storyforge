import { htmlToPlainText } from '../../src/lib/utils/html'
import { duplicateScreenplayScene, mergeScreenplayScenes } from '../../src/lib/screenplay/service'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import {
  confirmAdaptationBrief,
  confirmAdaptationPlan,
  createAdaptation,
  listActiveSourceUnits,
  saveAdaptationBriefDraft,
  saveAdaptationPlanDraft,
  startAdaptationProduction,
} from '../../src/lib/adaptation/source-manifest'
import type { AdaptationBriefV1, AdaptationPlanV1, ScreenplayTargetSpecV1 } from '../../src/lib/types'
import {
  createScreenplayScene,
  listScreenplayScenes,
} from '../../src/lib/screenplay/service'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const spec: ScreenplayTargetSpecV1 = {
  format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 100,
  rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'standard', preserveVoiceOver: false,
  titlePage: { creditLine: '改编', authorDisplayName: '作者', contactText: 'author@example.test', copyrightNotice: '版权所有', draftLabel: '第一稿' },
  exportDefaults: ['fountain', 'fdx', 'pdf'],
}
const brief: AdaptationBriefV1 = {
  version: 1, coreTheme: '选择与代价', dominantEmotion: '克制', mustKeep: ['结局'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [],
  audience: '成年观众', rating: 'PG-13', targetScale: '100 分钟电影', narrativePerspective: '主人公', timeBudget: '两小时', costLimit: '标准', deviationNotes: '', unresolvedQuestions: [], assumptions: [],
}

async function setup() {
  const source = await createWorkspace({ name: '剧本来源', genres: ['other'], status: 'drafting', description: '风雨夜的选择', targetWordCount: 10_000, enableMultiWorld: false }, { kind: 'novel', novelProfile: 'short' })
  const chapters = await db.chapters.where('projectId').equals(source.scope.projectId).sortBy('order')
  await db.chapters.update(chapters[0].id!, { content: '<p>林岚走进旧车站。</p>', summary: '进入车站', updatedAt: Date.now() })
  const created = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '旧车站', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: spec })
  const units = await listActiveSourceUnits(created.adaptation.id!)
  const chapterUnit = units.find(unit => unit.sourceKind === 'chapter')!
  const plan: AdaptationPlanV1 = { version: 1, premise: '她必须作出选择。', sections: [{ stableKey: 'act-1', title: '第一幕', summary: '进入困局', order: 0, episodeNumber: 1, sourceUnitKeys: [chapterUnit.sourceUnitKey] }], globalAssumptions: [] }
  let root = await saveAdaptationBriefDraft({ adaptationProjectId: created.adaptation.id!, brief, expectedRevision: 1 })
  root = await confirmAdaptationBrief({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  root = await saveAdaptationPlanDraft({ adaptationProjectId: root.id!, plan, expectedRevision: root.revision })
  root = await confirmAdaptationPlan({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  await startAdaptationProduction({ adaptationProjectId: root.id!, expectedRevision: root.revision })
  const now = Date.now()
  const characterId = await db.characters.add(stampNewRecord(source.scope, 'characters', {
    projectId: source.scope.projectId,
    name: '林岚',
    roleWeight: 'main',
    moralAxis: 'neutral',
    orderAxis: 'neutral',
    shortDescription: '',
    appearance: '',
    personality: '',
    background: '',
    motivation: '',
    abilities: '',
    relationships: '',
    arc: '',
    homeWorldGroupId: null,
    isCrossWorld: false,
    createdAt: now,
    updatedAt: now,
  }, { owner: 'world' })) as number
  await db.workCharacterBindings.add(stampNewRecord(created.scope, 'workCharacterBindings', {
    projectId: source.scope.projectId,
    characterId,
    role: 'protagonist',
    createdAt: now,
    updatedAt: now,
  }, { owner: 'work' }))
  return { ...created, source, unitId: chapterUnit.id!, characterId }
}


import { splitScreenplayScene } from '../../src/lib/screenplay/service'
import { generateScreenplayProfessionalCandidateV1, listScreenplayTasksV1, closeScreenplayTaskV1 } from '../../src/lib/screenplay/durable-production'
import { inspectScreenplayCompletionV1 } from '../../src/lib/screenplay/production'
import { adoptAdaptationSourceFactsV1 } from '../../src/lib/adaptation/analysis'
import * as assembly from '../../src/lib/registry/assemble-context'
import { readScreenplayAuthorDraft, saveScreenplayAuthorDraft } from '../../src/lib/screenplay/author-drafts'

describe('SCREEN-4 UI integration safety',()=>{
 beforeEach(async()=>{await db.delete();await db.open()})
 afterEach(()=>{vi.restoreAllMocks();db.close()})
 it('invalid split is atomic and preserves original dialogue, duration and revision',async()=>{
  const f=await setup()
  const scene=await createScreenplayScene(f.scope,{planSectionKey:'act-1',episodeNumber:1,sceneNumber:1,intExt:'INT',location:'站台',timeOfDay:'夜',summary:'争论',estimatedSeconds:60,sourceUnitIds:[f.unitId],blocks:[{id:'c1',type:'character',name:'甲'},{id:'d1',type:'dialogue',text:'不要离开'},{id:'c2',type:'character',name:'乙',dualDialogue:true},{id:'d2',type:'dialogue',text:'我会留下'}]})
  await expect(splitScreenplayScene({scope:f.scope,sceneId:scene.id!,blockIndex:2,expectedRevision:scene.revision})).rejects.toThrow('双栏对白')
  expect(await listScreenplayScenes(f.scope)).toEqual([scene])
 })
 it('valid split keeps both halves and stale revision cannot split again',async()=>{
  const f=await setup()
  const scene=await createScreenplayScene(f.scope,{planSectionKey:'act-1',episodeNumber:1,sceneNumber:1,intExt:'INT',location:'站台',timeOfDay:'夜',summary:'等待',estimatedSeconds:60,sourceUnitIds:[f.unitId],blocks:[{id:'a1',type:'action',text:'走进站台'},{id:'a2',type:'action',text:'停下脚步'}]})
  const rows=await splitScreenplayScene({scope:f.scope,sceneId:scene.id!,blockIndex:1,expectedRevision:scene.revision})
  expect(rows.map(s=>s.blocks[0].id)).toEqual(['a1','a2']);expect(rows.reduce((n,s)=>n+s.estimatedSeconds,0)).toBe(60)
  await expect(splitScreenplayScene({scope:f.scope,sceneId:scene.id!,blockIndex:1,expectedRevision:scene.revision})).rejects.toThrow('已变化')
 })
 it('context preparation failure terminates the task without invoking the model',async()=>{
  const f=await setup();const unit=(await listActiveSourceUnits(f.adaptation.id!)).find(u=>u.id===f.unitId)!
  vi.spyOn(assembly,'assembleContext').mockRejectedValueOnce(new Error('context unavailable'));const model=vi.fn(async()=>'[]')
  await expect(generateScreenplayProfessionalCandidateV1({scope:f.scope,adaptationProjectId:f.adaptation.id!,stage:'source-analysis',sourceUnitKeys:[unit.sourceUnitKey],runAI:model})).rejects.toThrow('context unavailable')
  expect(model).not.toHaveBeenCalled();expect(await listScreenplayTasksV1(f.scope)).toEqual([])
  expect((await db.agentRuns.where('workId').equals(f.scope.workId).first())?.status).toBe('failed')
 })
 it('author drafts persist independently by Work and never replace a formal scene',async()=>{
  const a=await setup();const b=await setup()
  await saveScreenplayAuthorDraft(a.scope,'scene:1:r1','author input')
  expect(await readScreenplayAuthorDraft(a.scope,'scene:1:r1')).toBe('author input')
  expect(await readScreenplayAuthorDraft(b.scope,'scene:1:r1')).toBeNull()
  expect(await listScreenplayScenes(a.scope)).toEqual([])
 })
 it('long headingless source stays complete in one novel chapter and remains a separate adaptation source owner',async()=>{
  const text=('这是长原作中的一段不可丢失的正文。'.repeat(1600)+'\n').repeat(3)
  const source=await createWorkspace({name:'长原作导入',genres:[],description:'',status:'drafting',targetWordCount:100000},{purpose:'independent-work',kind:'novel',novelProfile:'long',importedNovelText:text})
  const chapters=await db.chapters.where('projectId').equals(source.scope.projectId).filter(c=>c.workId===source.scope.workId).sortBy('order')
  expect(chapters).toHaveLength(1)
  expect(chapters[0].title).toBe('全文')
  expect(chapters.map(c=>htmlToPlainText(c.content)).join('').replace(/\s/g,'')).toBe(text.replace(/\s/g,''))
  const target=await createAdaptation({sourceScope:source.scope,sourceWorkId:source.scope.workId,title:'独立改编',sourceSelection:{mode:'entire-work'},medium:'screenplay',targetSpec:spec})
  expect(target.scope.workId).not.toBe(source.scope.workId)
  expect((await listActiveSourceUnits(target.adaptation.id!)).filter(u=>u.sourceKind==='chapter')).toHaveLength(chapters.length)
  expect((await db.works.get(source.scope.workId))?.kind).toBe('novel')
 })
 it('late model results after cancellation cannot create a candidate or formal content',async()=>{
  const f=await setup();const controller=new AbortController();const unit=(await listActiveSourceUnits(f.adaptation.id!)).find(u=>u.id===f.unitId)!
  const model=vi.fn(async()=>{controller.abort();return JSON.stringify([{stableKey:'fact.a',kind:'event',statement:'到站',subjectKeys:[],sourceUnitKeys:[unit.sourceUnitKey],confidence:1}])})
  await expect(generateScreenplayProfessionalCandidateV1({scope:f.scope,adaptationProjectId:f.adaptation.id!,stage:'source-analysis',sourceUnitKeys:[unit.sourceUnitKey],signal:controller.signal,runAI:model})).rejects.toThrow('迟到结果')
  expect(model).toHaveBeenCalledTimes(1)
  expect((await db.agentRuns.where('workId').equals(f.scope.workId).first())?.status).toBe('cancelled')
  expect(await db.adaptationSourceFacts.where('workId').equals(f.scope.workId).count()).toBe(0)
  expect(await listScreenplayTasksV1(f.scope)).toEqual([])
 })
 it('unknown model outcomes stay visible and block release until explicitly closed',async()=>{
  const f=await setup();const unit=(await listActiveSourceUnits(f.adaptation.id!)).find(u=>u.id===f.unitId)!
  const model=vi.fn(async()=>{throw new Error('network outcome unknown')})
  await expect(generateScreenplayProfessionalCandidateV1({scope:f.scope,adaptationProjectId:f.adaptation.id!,stage:'source-analysis',sourceUnitKeys:[unit.sourceUnitKey],runAI:model})).rejects.toThrow('network outcome unknown')
  expect(model).toHaveBeenCalledTimes(1)
  const tasks=await listScreenplayTasksV1(f.scope);expect(tasks).toHaveLength(1)
  expect((await inspectScreenplayCompletionV1(f.scope)).blockers.join(' ')).toContain('未处理的剧本')
  await closeScreenplayTaskV1(f.scope,tasks[0].id)
  expect((await inspectScreenplayCompletionV1(f.scope)).blockers.join(' ')).not.toContain('未处理的剧本')
 })
 it('changing confirmed upstream facts invalidates planning without deleting manuscript scenes',async()=>{
  const f=await setup();const unit=(await listActiveSourceUnits(f.adaptation.id!)).find(u=>u.id===f.unitId)!
  const scene=await createScreenplayScene(f.scope,{planSectionKey:'act-1',episodeNumber:1,sceneNumber:1,intExt:'INT',location:'站台',timeOfDay:'夜',summary:'等待',estimatedSeconds:60,sourceUnitIds:[f.unitId],blocks:[{id:'a',type:'action',text:'停在站台'}]})
  const root=(await db.adaptationProjects.get(f.adaptation.id!))!
  await adoptAdaptationSourceFactsV1({scope:f.scope,adaptationProjectId:root.id!,expectedAdaptationRevision:root.revision,sourceManifestVersion:root.activeSourceManifestVersion,items:[{authorStatus:'confirmed',candidate:{stableKey:'fact.changed',kind:'event',statement:'新的原作理解',subjectKeys:[],sourceUnitKeys:[unit.sourceUnitKey],confidence:1}}]})
  expect((await inspectScreenplayCompletionV1(f.scope)).blockers.join(' ')).toContain('上游改编内容已变化')
  expect(await listScreenplayScenes(f.scope)).toEqual([scene])
 })
 it('copy, split and merge keep corresponding scene cards and source mapping',async()=>{
  const f=await setup()
  const original=await createScreenplayScene(f.scope,{planSectionKey:'act-1',episodeNumber:1,sceneNumber:1,intExt:'INT',location:'站台',timeOfDay:'夜',summary:'等待',estimatedSeconds:60,sourceUnitIds:[f.unitId],blocks:[{id:'a1',type:'action',text:'走进站台'},{id:'a2',type:'action',text:'停下脚步'}]})
  const unit=(await listActiveSourceUnits(f.adaptation.id!)).find(u=>u.id===f.unitId)!
  await db.screenplaySceneCards.add(stampNewRecord(f.scope,'screenplaySceneCards',{projectId:f.scope.projectId,workId:f.scope.workId,adaptationProjectId:f.adaptation.id!,manifestVersion:1,stableKey:original.stableKey,beatKey:'beat-1',episodeNumber:1,sceneNumber:1,order:0,purpose:'等待',conflict:'迟到',entryState:'到站',exitState:'停下',visibleAction:'等待',informationReveal:'列车离开',sourceUnitKeys:[unit.sourceUnitKey],estimatedSeconds:60,authorStatus:'confirmed',revision:1,createdAt:Date.now(),updatedAt:Date.now()},{owner:'work'}))
  const copy=await duplicateScreenplayScene({scope:f.scope,sceneId:original.id!})
  const [first,second]=await splitScreenplayScene({scope:f.scope,sceneId:copy.id!,blockIndex:1,expectedRevision:copy.revision})
  let cards=await db.screenplaySceneCards.where('adaptationProjectId').equals(f.adaptation.id!).toArray()
  expect(cards.map(c=>c.stableKey)).toEqual(expect.arrayContaining([original.stableKey,first.stableKey,second.stableKey]))
  expect(cards.find(c=>c.stableKey===first.stableKey)?.estimatedSeconds).toBe(first.estimatedSeconds)
  expect(cards.find(c=>c.stableKey===second.stableKey)?.estimatedSeconds).toBe(second.estimatedSeconds)
  await mergeScreenplayScenes({scope:f.scope,firstSceneId:first.id!,secondSceneId:second.id!,expectedFirstRevision:first.revision,expectedSecondRevision:second.revision})
  cards=await db.screenplaySceneCards.where('adaptationProjectId').equals(f.adaptation.id!).toArray()
  expect(cards.map(c=>c.stableKey).sort()).toEqual((await listScreenplayScenes(f.scope)).map(c=>c.stableKey).sort())
 })

})
