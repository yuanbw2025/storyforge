import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  adoptAdaptationCausalEdgesV1,
  adoptAdaptationDecisionsV1,
  adoptAdaptationSourceFactsV1,
  listAdaptationAnalysisV1,
} from '../../src/lib/adaptation/analysis'
import { createAdaptation, listActiveSourceUnits } from '../../src/lib/adaptation/source-manifest'
import { db } from '../../src/lib/db/schema'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { CREATION_RELEASE_SCHEMAS_V1, assertCreationReleaseParentV1, parseAndVerifyCreationReleaseManifestV1 } from '../../src/lib/creation-release/contracts'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import type { ComicTargetSpecV1, ScreenplayTargetSpecV1 } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { deleteWork } from '../../src/lib/workspace/lifecycle'

const screenplaySpec: ScreenplayTargetSpecV1 = {
  format: 'film', language: 'zh-CN', episodeCount: null, targetMinutesPerEpisode: 90,
  rating: 'PG-13', dialogueDensity: 'balanced', productionScale: 'contained', preserveVoiceOver: false,
  titlePage: { creditLine: '改编', authorDisplayName: '测试作者', contactText: '', copyrightNotice: '', draftLabel: '第一稿' },
  exportDefaults: ['fountain', 'fdx', 'pdf'],
}

const comicSpec: ComicTargetSpecV1 = {
  format: 'page-comic', audience: '青少年', readingDirection: 'ltr', chapterCount: 1,
  targetPagesPerChapter: 12, pageSize: { width: 1200, height: 1700, unit: 'px', bleed: 30 },
  colorMode: 'color', artStyleBrief: '克制的现实主义线稿', renderCandidatesPerPanel: 2,
  imageCapabilityRequirement: { referenceImage: false, deterministicSeed: false, inpainting: false, commercialUseRequired: false, minimumWidth: 1024, minimumHeight: 1024 },
}

async function fixture() {
  const source = await createWorkspace({
    name: '共享分析来源', genres: ['other'], status: 'drafting', description: '灯塔故事',
    targetWordCount: 8_000, enableMultiWorld: false,
  }, { kind: 'novel', novelProfile: 'short' })
  const chapters = await db.chapters.where('projectId').equals(source.scope.projectId).sortBy('order')
  await db.chapters.update(chapters[0].id!, { content: '<p>守灯人点亮了会诱导船只的旧灯。</p>', updatedAt: Date.now() })
  await db.chapters.update(chapters[1].id!, { content: '<p>她发现灯光中的亡者只是记忆，最终熄灯救船。</p>', updatedAt: Date.now() + 1 })
  const screenplay = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '灯塔剧本', sourceSelection: { mode: 'entire-work' }, medium: 'screenplay', targetSpec: screenplaySpec })
  const comic = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '灯塔漫画', sourceSelection: { mode: 'entire-work' }, medium: 'comic', targetSpec: comicSpec })
  return { source, screenplay, comic }
}

async function rootRevision(id: number): Promise<number> {
  return (await db.adaptationProjects.get(id))!.revision
}

describe('ADAPT-FOUNDATION-1 · 共享来源事实、因果边与改编决策', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('共享 Release 外壳闭集接受三种产品身份并拒绝跨产品父版本', async () => {
    expect(Object.keys(CREATION_RELEASE_SCHEMAS_V1).sort()).toEqual(['comic', 'screenplay', 'short-novel'])
    const manifest = { schema: 'storyforge.screenplay-release', version: 1, productKind: 'screenplay', work: { code: 'WORK-FOUNDATION-1' }, createdAt: 100 }
    const release = {
      id: 2, projectId: 1, worldId: 1, workId: 2, productKind: 'screenplay' as const,
      version: 2, label: '剧本 v2', parentReleaseId: 1, sourceRevision: 8,
      manifestJson: canonicalStringify(manifest), contentHash: await hashCanonicalValue(manifest), createdAt: 100,
    }
    await expect(parseAndVerifyCreationReleaseManifestV1(release, 'WORK-FOUNDATION-1')).resolves.toMatchObject({ productKind: 'screenplay' })
    expect(() => assertCreationReleaseParentV1(release, { ...release, id: 1, version: 1, parentReleaseId: null, productKind: 'comic' })).toThrow('跨产品')
  })

  it('两个媒介各自拥有审定记录，context 只读确认项，跨 Work 与 stale 批次 fail-closed', async () => {
    const { screenplay, comic } = await fixture()
    const screenplayUnit = (await listActiveSourceUnits(screenplay.adaptation.id!)).find(unit => unit.sourceKind === 'chapter')!
    const comicUnit = (await listActiveSourceUnits(comic.adaptation.id!)).find(unit => unit.sourceKind === 'chapter')!

    await expect(adoptAdaptationSourceFactsV1({
      scope: screenplay.scope, adaptationProjectId: screenplay.adaptation.id!, expectedAdaptationRevision: screenplay.adaptation.revision,
      sourceManifestVersion: 1,
      items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'fact.bad', kind: 'event', statement: '非法', subjectKeys: [], sourceUnitKeys: [screenplayUnit.sourceUnitKey], confidence: 1, projectId: 99 } as never }],
    })).rejects.toThrow('系统或未知字段')
    expect(await db.adaptationSourceFacts.count()).toBe(0)

    await adoptAdaptationSourceFactsV1({
      scope: screenplay.scope, adaptationProjectId: screenplay.adaptation.id!, expectedAdaptationRevision: screenplay.adaptation.revision,
      sourceManifestVersion: 1,
      items: [
        { authorStatus: 'confirmed', candidate: { stableKey: 'fact.light', kind: 'event', statement: '守灯人点亮旧灯。', subjectKeys: ['character.keeper'], sourceUnitKeys: [screenplayUnit.sourceUnitKey], confidence: 1 } },
        { authorStatus: 'confirmed', candidate: { stableKey: 'fact.choice', kind: 'character-state', statement: '守灯人必须在亡者幻象与救船之间选择。', subjectKeys: ['character.keeper'], sourceUnitKeys: [screenplayUnit.sourceUnitKey], confidence: 0.95 } },
        { authorStatus: 'rejected', candidate: { stableKey: 'fact.false', kind: 'event', statement: '原作写明船已经沉没。', subjectKeys: [], sourceUnitKeys: [screenplayUnit.sourceUnitKey], confidence: 0.2 } },
      ],
    })
    const factsRevision = await rootRevision(screenplay.adaptation.id!)
    await adoptAdaptationCausalEdgesV1({
      scope: screenplay.scope, adaptationProjectId: screenplay.adaptation.id!, expectedAdaptationRevision: factsRevision, sourceManifestVersion: 1,
      items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'edge.light-choice', fromFactKey: 'fact.light', toFactKey: 'fact.choice', relation: 'cause', rationale: '灯光使救船选择成为必要。', sourceUnitKeys: [screenplayUnit.sourceUnitKey] } }],
    })
    const edgeRevision = await rootRevision(screenplay.adaptation.id!)
    await adoptAdaptationDecisionsV1({
      scope: screenplay.scope, adaptationProjectId: screenplay.adaptation.id!, expectedAdaptationRevision: edgeRevision, sourceManifestVersion: 1,
      items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'decision.externalize', action: 'externalize', sourceFactKeys: ['fact.choice'], targetKeys: ['ending'], rationale: '用熄灯动作外化人物选择。' } }],
    })

    await adoptAdaptationSourceFactsV1({
      scope: comic.scope, adaptationProjectId: comic.adaptation.id!, expectedAdaptationRevision: comic.adaptation.revision, sourceManifestVersion: 1,
      items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'fact.visual-light', kind: 'motif', statement: '旧灯的冷光反复出现。', subjectKeys: ['object.old-lamp'], sourceUnitKeys: [comicUnit.sourceUnitKey], confidence: 0.9 } }],
    })
    const comicRevision = await rootRevision(comic.adaptation.id!)
    await expect(adoptAdaptationCausalEdgesV1({
      scope: comic.scope, adaptationProjectId: comic.adaptation.id!, expectedAdaptationRevision: comicRevision, sourceManifestVersion: 1,
      items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'edge.cross-work', fromFactKey: 'fact.light', toFactKey: 'fact.choice', relation: 'cause', rationale: '不得越界。', sourceUnitKeys: [comicUnit.sourceUnitKey] } }],
    })).rejects.toThrow('未确认事实')
    expect(await db.adaptationCausalEdges.where('adaptationProjectId').equals(comic.adaptation.id!).count()).toBe(0)

    const assembled = await assembleContext({
      projectId: screenplay.scope.projectId, scope: screenplay.scope, adaptationProjectId: screenplay.adaptation.id!,
      sourceKeys: ['adaptation.sourceFacts', 'adaptation.decisions'], inputBudgetTokens: 30_000,
    })
    expect(assembled.text).toContain('fact.light')
    expect(assembled.text).toContain('edge.light-choice')
    expect(assembled.text).toContain('decision.externalize')
    expect(assembled.text).not.toContain('fact.false')
    expect((await listAdaptationAnalysisV1({ scope: comic.scope, adaptationProjectId: comic.adaptation.id! })).facts.map(row => row.stableKey)).toEqual(['fact.visual-light'])

    const before = await db.adaptationDecisions.count()
    await expect(adoptAdaptationDecisionsV1({
      scope: screenplay.scope, adaptationProjectId: screenplay.adaptation.id!, expectedAdaptationRevision: edgeRevision, sourceManifestVersion: 1,
      items: [{ authorStatus: 'confirmed', candidate: { stableKey: 'decision.stale', action: 'add', sourceFactKeys: [], targetKeys: [], rationale: 'stale 不得写入。' } }],
    })).rejects.toThrow('已变化')
    expect(await db.adaptationDecisions.count()).toBe(before)
  })

  it('事实重采纳会原子清空下游，备份往返保持证据链，目标 Work 删除完整级联', async () => {
    const { source, screenplay } = await fixture()
    const unit = (await listActiveSourceUnits(screenplay.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
    await adoptAdaptationSourceFactsV1({ scope: screenplay.scope, adaptationProjectId: screenplay.adaptation.id!, expectedAdaptationRevision: 1, sourceManifestVersion: 1, items: [
      { authorStatus: 'confirmed', candidate: { stableKey: 'fact.a', kind: 'event', statement: '点灯。', subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 } },
      { authorStatus: 'confirmed', candidate: { stableKey: 'fact.b', kind: 'event', statement: '船只转向。', subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 } },
    ] })
    await adoptAdaptationCausalEdgesV1({ scope: screenplay.scope, adaptationProjectId: screenplay.adaptation.id!, expectedAdaptationRevision: 2, sourceManifestVersion: 1, items: [
      { authorStatus: 'confirmed', candidate: { stableKey: 'edge.a-b', fromFactKey: 'fact.a', toFactKey: 'fact.b', relation: 'cause', rationale: '灯光引导船只。', sourceUnitKeys: [unit.sourceUnitKey] } },
    ] })
    await adoptAdaptationDecisionsV1({ scope: screenplay.scope, adaptationProjectId: screenplay.adaptation.id!, expectedAdaptationRevision: 3, sourceManifestVersion: 1, items: [
      { authorStatus: 'confirmed', candidate: { stableKey: 'decision.keep-b', action: 'keep', sourceFactKeys: ['fact.b'], targetKeys: ['ending'], rationale: '保留结果。' } },
    ] })

    const backup = await exportProjectJSON(source.scope.projectId)
    expect(backup.version).toBe(13)
    expect(backup.adaptationSourceFacts).toHaveLength(2)
    expect(backup.adaptationCausalEdges).toHaveLength(1)
    expect(backup.adaptationDecisions).toHaveLength(1)
    const importedProjectId = await importProjectJSON(structuredClone(backup))
    const importedRoot = (await db.adaptationProjects.where('projectId').equals(importedProjectId).toArray()).find(root => root.medium === 'screenplay')!
    const importedWork = await db.works.get(importedRoot.workId)
    const imported = await listAdaptationAnalysisV1({ scope: { projectId: importedProjectId, worldId: importedWork!.worldId, workId: importedWork!.id! }, adaptationProjectId: importedRoot.id! })
    expect(imported.edges[0]).toMatchObject({ fromFactKey: 'fact.a', toFactKey: 'fact.b' })
    expect(imported.decisions[0]).toMatchObject({ sourceFactKeys: ['fact.b'] })

    await adoptAdaptationSourceFactsV1({ scope: screenplay.scope, adaptationProjectId: screenplay.adaptation.id!, expectedAdaptationRevision: 4, sourceManifestVersion: 1, items: [
      { authorStatus: 'confirmed', candidate: { stableKey: 'fact.a', kind: 'event', statement: '重新确认点灯事实。', subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], confidence: 1 } },
    ] })
    expect(await db.adaptationCausalEdges.where('adaptationProjectId').equals(screenplay.adaptation.id!).count()).toBe(0)
    expect(await db.adaptationDecisions.where('adaptationProjectId').equals(screenplay.adaptation.id!).count()).toBe(0)

    await deleteWork(screenplay.scope.workId)
    expect(await db.adaptationProjects.get(screenplay.adaptation.id!)).toBeUndefined()
    expect(await db.adaptationSourceFacts.where('adaptationProjectId').equals(screenplay.adaptation.id!).count()).toBe(0)
    expect(await db.adaptationCausalEdges.where('adaptationProjectId').equals(screenplay.adaptation.id!).count()).toBe(0)
    expect(await db.adaptationDecisions.where('adaptationProjectId').equals(screenplay.adaptation.id!).count()).toBe(0)
  })
})
