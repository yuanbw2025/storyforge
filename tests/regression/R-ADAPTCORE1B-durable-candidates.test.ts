import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createAdaptation, listActiveSourceUnits, startAdaptationProduction } from '../../src/lib/adaptation/source-manifest'
import type { AdaptationBriefV1, ScreenplayTargetSpecV1 } from '../../src/lib/types'
import {
  adoptAdaptationCandidateV1,
  generateAdaptationCandidateV1,
  readPendingAdaptationCandidateV1,
} from '../../src/lib/agent/run/adaptation-durable'

const targetSpec: ScreenplayTargetSpecV1 = {
  format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 95,
  rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'contained', preserveVoiceOver: false,
  titlePage: { creditLine: '改编', authorDisplayName: '测试作者', contactText: '', copyrightNotice: '', draftLabel: '候选稿' },
  exportDefaults: ['fountain', 'fdx', 'pdf'],
}

const brief: AdaptationBriefV1 = {
  version: 1, coreTheme: '选择与代价', dominantEmotion: '克制', mustKeep: ['结局'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [],
  audience: '成年观众', rating: 'PG-13', targetScale: '95 分钟电影', narrativePerspective: '主人公', timeBudget: '95 分钟', costLimit: '有限场景', deviationNotes: '', unresolvedQuestions: [], assumptions: [],
}

async function fixture() {
  const source = await createWorkspace({ name: '可恢复来源', genre: 'other', genres: ['other'], status: 'drafting', description: '旧站抉择', targetWordCount: 10_000, enableMultiWorld: false }, { kind: 'novel', novelProfile: 'short' })
  const chapter = await db.chapters.where('projectId').equals(source.scope.projectId).filter(row => row.workId === source.scope.workId).first()
  await db.chapters.update(chapter!.id!, { content: '<p>暴雨中，林岚走进旧车站。</p>', summary: '进入旧站', updatedAt: Date.now() })
  const created = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '旧站剧本', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec })
  const unit = (await listActiveSourceUnits(created.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
  return { source, created, chapterId: chapter!.id!, unit }
}

describe('ADAPT-CORE-1B / SCREEN-1B · durable adaptation candidates', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('Brief 在作者确认前零写入，刷新后可恢复；作者编辑后的候选进入正式状态并得到终验回执', async () => {
    const { created } = await fixture()
    const generated = await generateAdaptationCandidateV1({
      scope: created.scope,
      adaptationProjectId: created.adaptation.id!,
      artifactKind: 'brief',
      runAI: async () => JSON.stringify(brief),
    })
    expect((await db.adaptationProjects.get(created.adaptation.id!))?.brief).toBeNull()
    const pending = await readPendingAdaptationCandidateV1({ scope: created.scope, artifactKind: 'brief' })
    expect(pending?.snapshot.run.id).toBe(generated.snapshot.run.id)
    const edited = { ...brief, dominantEmotion: '压抑后爆发', assumptions: ['车站可作为合并空间'] }
    const adopted = await adoptAdaptationCandidateV1<'brief'>({ scope: created.scope, runId: generated.snapshot.run.id, authorPayload: edited })
    expect(adopted.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(await db.adaptationProjects.get(created.adaptation.id!)).toMatchObject({ brief: edited, briefSourceManifestVersion: 1 })
    const revision = (await db.adaptationProjects.get(created.adaptation.id!))!.revision
    await adoptAdaptationCandidateV1<'brief'>({ scope: created.scope, runId: generated.snapshot.run.id, authorPayload: edited })
    expect((await db.adaptationProjects.get(created.adaptation.id!))!.revision).toBe(revision)
  })

  it('来源在候选后变化会让采纳 fail closed，不产生正式 Brief', async () => {
    const { source, created, chapterId } = await fixture()
    const generated = await generateAdaptationCandidateV1({ scope: created.scope, adaptationProjectId: created.adaptation.id!, artifactKind: 'brief', runAI: async () => JSON.stringify(brief) })
    await db.chapters.update(chapterId, { content: '来源在候选后被作者修改', updatedAt: Date.now() + 100 })
    await expect(adoptAdaptationCandidateV1<'brief'>({ scope: created.scope, runId: generated.snapshot.run.id })).rejects.toThrow('来源内容已变化')
    expect((await db.adaptationProjects.get(created.adaptation.id!))?.brief).toBeNull()
    expect(await db.works.get(source.scope.workId)).toBeTruthy()
  })

  it('Plan 与场景批次均需作者确认；非法场景使整批零落库，合法批次保留来源键映射', async () => {
    const { created, unit } = await fixture()
    const briefRun = await generateAdaptationCandidateV1({ scope: created.scope, adaptationProjectId: created.adaptation.id!, artifactKind: 'brief', runAI: async () => JSON.stringify(brief) })
    await adoptAdaptationCandidateV1<'brief'>({ scope: created.scope, runId: briefRun.snapshot.run.id })
    const plan = { version: 1 as const, premise: '她必须在末班车到来前作出选择。', sections: [{ stableKey: 'act-1', title: '第一幕', summary: '进入困局', order: 0, episodeNumber: 1, sourceUnitKeys: [unit.sourceUnitKey] }], globalAssumptions: [] }
    const planRun = await generateAdaptationCandidateV1({ scope: created.scope, adaptationProjectId: created.adaptation.id!, artifactKind: 'plan', runAI: async () => JSON.stringify(plan) })
    await adoptAdaptationCandidateV1<'plan'>({ scope: created.scope, runId: planRun.snapshot.run.id })
    let root = (await db.adaptationProjects.get(created.adaptation.id!))!
    root = await startAdaptationProduction({ adaptationProjectId: root.id!, expectedRevision: root.revision })
    const valid = { stableKey: 'act-1-scene-1', planSectionKey: 'act-1', episodeNumber: 1, sceneNumber: 1, intExt: 'INT' as const, location: '旧车站', timeOfDay: '夜', summary: '林岚进入旧站', estimatedSeconds: 60, sourceUnitKeys: [unit.sourceUnitKey], blocks: [{ id: 'action_1', type: 'action' as const, text: '雨水顺着玻璃落下。' }] }
    const invalid = { ...valid, stableKey: 'act-1-scene-2', sceneNumber: 2, blocks: [{ id: 'dialogue_1', type: 'dialogue' as const, text: '没有角色提示。' }] }
    const badRun = await generateAdaptationCandidateV1({ scope: created.scope, adaptationProjectId: root.id!, artifactKind: 'screenplay-scenes', selectedPlanSectionKeys: ['act-1'], runAI: async () => JSON.stringify([valid, invalid]) })
    await expect(adoptAdaptationCandidateV1<'screenplay-scenes'>({ scope: created.scope, runId: badRun.snapshot.run.id })).rejects.toThrow('对白前必须')
    expect(await db.screenplayScenes.count()).toBe(0)

    const goodRun = await generateAdaptationCandidateV1({ scope: created.scope, adaptationProjectId: root.id!, artifactKind: 'screenplay-scenes', selectedPlanSectionKeys: ['act-1'], runAI: async () => JSON.stringify([valid]) })
    const adopted = await adoptAdaptationCandidateV1<'screenplay-scenes'>({ scope: created.scope, runId: goodRun.snapshot.run.id })
    expect(adopted.snapshot.projection.state).toBe('completed')
    const scene = await db.screenplayScenes.where('adaptationProjectId').equals(root.id!).first()
    expect(scene).toMatchObject({ stableKey: 'act-1-scene-1', sourceUnitIds: [unit.id], sourceReviewManifestVersion: 1 })
  })
})
