import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createAdaptation, listActiveSourceUnits } from '../../src/lib/adaptation/source-manifest'
import type { AdaptationBriefV1, ComicTargetSpecV1, ScreenplayTargetSpecV1 } from '../../src/lib/types'
import {
  adoptAdaptationCandidateV1,
  generateAdaptationCandidateV1,
  readPendingAdaptationCandidateV1,
} from '../../src/lib/agent/run/adaptation-durable'

const screenplayTargetSpec: ScreenplayTargetSpecV1 = {
  format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 95,
  rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'contained', preserveVoiceOver: false,
  titlePage: { creditLine: '改编', authorDisplayName: '测试作者', contactText: '', copyrightNotice: '', draftLabel: '候选稿' },
  exportDefaults: ['fountain', 'fdx', 'pdf'],
}

const comicTargetSpec: ComicTargetSpecV1 = {
  format: 'page-comic', audience: '青年读者', readingDirection: 'ltr', chapterCount: 1, targetPagesPerChapter: 20,
  pageSize: { width: 1200, height: 1700, unit: 'px', bleed: 30 }, colorMode: 'color', artStyleBrief: '克制写实线稿',
  renderCandidatesPerPanel: 2,
  imageCapabilityRequirement: { referenceImage: false, deterministicSeed: false, inpainting: false, commercialUseRequired: false, minimumWidth: 1024, minimumHeight: 1024 },
}

const brief: AdaptationBriefV1 = {
  version: 1, coreTheme: '选择与代价', dominantEmotion: '克制', mustKeep: ['结局'], mayCut: [], mayMerge: [], mayReorder: [], allowedAdditions: [],
  audience: '成年观众', rating: 'PG-13', targetScale: '95 分钟电影', narrativePerspective: '主人公', timeBudget: '95 分钟', costLimit: '有限场景', deviationNotes: '', unresolvedQuestions: [], assumptions: [],
}

async function fixture(medium: 'comic' | 'screenplay' = 'comic') {
  const source = await createWorkspace({ name: '可恢复来源', genres: ['other'], status: 'drafting', description: '旧站抉择', targetWordCount: 10_000, enableMultiWorld: false }, { kind: 'novel', novelProfile: 'short' })
  const chapter = await db.chapters.where('projectId').equals(source.scope.projectId).filter(row => row.workId === source.scope.workId).first()
  await db.chapters.update(chapter!.id!, { content: '<p>暴雨中，林岚走进旧车站。</p>', summary: '进入旧站', updatedAt: Date.now() })
  const created = medium === 'screenplay'
    ? await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '旧站剧本', sourceSelection: { mode: 'entire-work' }, medium, targetSpec: screenplayTargetSpec })
    : await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '旧站漫画', sourceSelection: { mode: 'entire-work' }, medium, targetSpec: comicTargetSpec })
  const unit = (await listActiveSourceUnits(created.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
  return { source, created, chapterId: chapter!.id!, unit }
}

describe('ADAPT-CORE-1B · durable adaptation candidates 与旧剧本入口退役', () => {
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

  it('剧本不能再进入通用 Brief/Plan/场景批次生成器', async () => {
    const { created } = await fixture('screenplay')
    for (const artifactKind of ['brief', 'plan', 'screenplay-scenes'] as const) {
      await expect(generateAdaptationCandidateV1({
        scope: created.scope,
        adaptationProjectId: created.adaptation.id!,
        artifactKind,
        selectedPlanSectionKeys: artifactKind === 'screenplay-scenes' ? ['act-1'] : undefined,
        runAI: async () => JSON.stringify(brief),
      })).rejects.toThrow('十步专业剧本 Pipeline')
    }
    expect(await db.agentRuns.count()).toBe(0)
    expect(await db.screenplayScenes.count()).toBe(0)
  })
})
