import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { StoryArc, WorkspaceScope } from '../../src/lib/types'
import {
  buildPostAdoptionAuthorizationSnapshotV1,
  invalidateChapterPostAdoptionDerivativesV1,
  preflightPostAdoptionAutoV1,
  readWorkPostAdoptionSettingsV1,
  resolveWorkPostAdoptionSettingsV1,
  updateWorkPostAdoptionSettingsV1,
} from '../../src/lib/prose/post-adoption-policy'
import {
  authorizeChapterPostAdoptionV1,
  chapterPostAdoptionChainStateV1,
  createChapterPostAdoptionDurableRunV1,
  scheduleChapterPostAdoptionStepsV1,
  CHAPTER_POST_ADOPTION_STEP_IDS_V1,
} from '../../src/lib/agent/run/chapter-post-adoption-durable'
import {
  adoptChapterOrganizationSelection,
  parseChapterOrganizationOutput,
  persistChapterOrganizationCandidate,
  selectAllChapterOrganizationCandidates,
} from '../../src/lib/agent/chapter-organization'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'

async function seed(label: string, projectId?: number, worldId?: number): Promise<{
  scope: WorkspaceScope
  chapterId: number
}> {
  const now = Date.now()
  const pid = projectId ?? await db.projects.add({
    name: label,
    genre: 'fantasy',
    genres: ['fantasy'],
    status: 'drafting',
    description: '',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const wid = worldId ?? await db.worlds.add({
    projectId: pid,
    code: `world-${label}`,
    name: `${label}世界`,
    description: '',
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId: pid,
    worldId: wid,
    title: label,
    description: '',
    genres: ['fantasy'],
    status: 'drafting',
    targetWordCount: 100_000,
    createdAt: now,
    updatedAt: now,
  }) as number
  if (projectId == null) {
    await db.projects.update(pid, {
      activeWorldId: wid,
      activeWorkId: workId,
      ownershipSchemaVersion: 1,


    })
  }
  const outlineNodeId = await db.outlineNodes.add({
    projectId: pid,
    workId,
    parentId: null,
    type: 'chapter',
    title: `${label}章`,
    summary: '',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId: pid,
    workId,
    outlineNodeId,
    title: `${label}章`,
    content: '<p>林舟抵达潮门，并与苏砚并肩点亮旧灯。</p>',
    wordCount: 20,
    status: 'draft',
    order: 0,
    notes: '',
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return { scope: { projectId: pid, worldId: wid, workId }, chapterId }
}

describe.sequential('PROGRESS-1 · 章后策略、预算与七域演化', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('旧 Work 默认 suggest；建议 Run 在作者确认前零模型调用，刷新/重复创建保持同一个 task', async () => {
    const fixture = await seed('suggest')
    const settings = await readWorkPostAdoptionSettingsV1(fixture.scope)
    expect(settings.policy).toBe('suggest')
    const chapter = await db.chapters.get(fixture.chapterId)
    const authorization = await buildPostAdoptionAuthorizationSnapshotV1({
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      sourceTextHash: await hashChapterText(chapter!.content),
      modelRoutes: [
        { taskType: 'organization', provider: 'gemini', model: 'gemini-3.5-flash' },
        { taskType: 'memory', provider: 'gemini', model: 'gemini-3.5-flash' },
      ],
      settings,
    })
    const first = await createChapterPostAdoptionDurableRunV1({
      scope: fixture.scope,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      authorization,
    })
    expect(chapterPostAdoptionChainStateV1(first)).toBe('downstream-suggested')
    expect(first.events.filter(event => event.type === 'model.requested')).toHaveLength(0)
    await expect(scheduleChapterPostAdoptionStepsV1({ scope: fixture.scope, snapshot: first }))
      .rejects.toThrow('尚未获得作者确认')

    const repeated = await createChapterPostAdoptionDurableRunV1({
      scope: fixture.scope,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      authorization,
    })
    expect(repeated.run.id).toBe(first.run.id)
    expect(repeated.events.filter(event => event.type === 'candidate.persisted')).toHaveLength(1)
  })

  it('作者授权幂等且只调度预先选择的任务；设置严格隔离在 Work 内', async () => {
    const first = await seed('work-a')
    const second = await seed('work-b', first.scope.projectId, first.scope.worldId)
    const selected = resolveWorkPostAdoptionSettingsV1({
      postAdoptionPolicy: 'suggest',
      postAdoptionTaskTypes: ['organization'],
      postAdoptionBudget: {
        maxModelCalls: 1,
        maxInputTokens: 24_000,
        maxOutputTokens: 8_000,
        maxCostUsd: 0.1,
        allowUnknownCost: false,
      },
    })
    await updateWorkPostAdoptionSettingsV1({ scope: first.scope, settings: selected })
    expect((await readWorkPostAdoptionSettingsV1(first.scope)).taskTypes).toEqual(['organization'])
    expect((await readWorkPostAdoptionSettingsV1(second.scope)).taskTypes).toEqual([
      'organization', 'memory', 'retrieval', 'consistency',
    ])
    const chapter = await db.chapters.get(first.chapterId)
    const authorization = await buildPostAdoptionAuthorizationSnapshotV1({
      scope: first.scope,
      chapterId: first.chapterId,
      sourceTextHash: await hashChapterText(chapter!.content),
      modelRoutes: [
        { taskType: 'organization', provider: 'gemini', model: 'gemini-3.5-flash' },
      ],
      settings: selected,
    })
    let snapshot = await createChapterPostAdoptionDurableRunV1({
      scope: first.scope,
      worldGroupId: null,
      chapterId: first.chapterId,
      authorization,
    })
    snapshot = await authorizeChapterPostAdoptionV1({ scope: first.scope, snapshot, source: 'author-click' })
    const repeated = await authorizeChapterPostAdoptionV1({ scope: first.scope, snapshot, source: 'author-click' })
    expect(repeated.events.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
    expect(repeated.contract.permissions.contextSourceKeys).toEqual(expect.arrayContaining([
      'chapterContent', 'storyArcs', 'storylineProgress',
    ]))
    expect(repeated.contract.permissions.writeTargets.map(target => target.table)).not.toContain('chapters')
    expect(repeated.contract.executionBindings?.map(binding => binding.stepId)).toEqual([
      CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
    ])
    snapshot = await scheduleChapterPostAdoptionStepsV1({ scope: first.scope, snapshot: repeated })
    expect(Object.keys(snapshot.projection.steps).sort()).toEqual([
      CHAPTER_POST_ADOPTION_STEP_IDS_V1.authorization,
      CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
    ].sort())
  })

  it('建议创建后正文发生修改，旧授权在模型调用前被 stale 阻断', async () => {
    const fixture = await seed('stale-suggestion')
    const chapter = await db.chapters.get(fixture.chapterId)
    const authorization = await buildPostAdoptionAuthorizationSnapshotV1({
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      sourceTextHash: await hashChapterText(chapter!.content),
      modelRoutes: [
        { taskType: 'organization', provider: 'gemini', model: 'gemini-3.5-flash' },
        { taskType: 'memory', provider: 'gemini', model: 'gemini-3.5-flash' },
      ],
      settings: await readWorkPostAdoptionSettingsV1(fixture.scope),
    })
    const snapshot = await createChapterPostAdoptionDurableRunV1({
      scope: fixture.scope,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      authorization,
    })
    await db.chapters.update(fixture.chapterId, {
      content: '<p>作者已经把潮门改成了雪港。</p>',
      updatedAt: Date.now(),
    })
    await expect(authorizeChapterPostAdoptionV1({
      scope: fixture.scope,
      snapshot,
      source: 'author-click',
    })).rejects.toThrow('旧章后授权候选已过期')
    expect(snapshot.events.filter(event => event.type === 'model.requested')).toHaveLength(0)
  })

  it('auto-with-budget 在模型调用前阻断未知费用或超预算，不静默降级', async () => {
    const fixture = await seed('auto-budget')
    const chapter = await db.chapters.get(fixture.chapterId)
    const settings = resolveWorkPostAdoptionSettingsV1({
      postAdoptionPolicy: 'auto-with-budget',
      postAdoptionTaskTypes: ['organization'],
      postAdoptionBudget: {
        maxModelCalls: 1,
        maxInputTokens: 24_000,
        maxOutputTokens: 8_000,
        maxCostUsd: 0.1,
        allowUnknownCost: false,
      },
    })
    const unknown = await buildPostAdoptionAuthorizationSnapshotV1({
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      sourceTextHash: await hashChapterText(chapter!.content),
      modelRoutes: [
        { taskType: 'organization', provider: 'agnes', model: 'agnes-2.5-flash' },
      ],
      settings,
    })
    expect(preflightPostAdoptionAutoV1(unknown)).toMatchObject({ allowed: false })
    await expect(createChapterPostAdoptionDurableRunV1({
      scope: fixture.scope,
      worldGroupId: null,
      chapterId: fixture.chapterId,
      authorization: unknown,
    })).rejects.toThrow('未通过预授权')
    expect(await db.agentRuns.count()).toBe(0)

    const tooSmall = await buildPostAdoptionAuthorizationSnapshotV1({
      scope: fixture.scope,
      chapterId: fixture.chapterId,
      sourceTextHash: await hashChapterText(chapter!.content),
      modelRoutes: [
        { taskType: 'organization', provider: 'gemini', model: 'gemini-3.5-flash' },
      ],
      settings: { ...settings, budget: { ...settings.budget, maxOutputTokens: 1_000 } },
    })
    expect(preflightPostAdoptionAutoV1(tooSmall)).toMatchObject({
      allowed: false,
      reason: '预计输出 token 超过预授权上限。',
    })
  })

  it('off/任何策略共用零模型失效器，只清派生缓存并按证据降级事实', async () => {
    const fixture = await seed('invalidate')
    const other = await seed('other', fixture.scope.projectId, fixture.scope.worldId)
    const now = Date.now()
    const sourceTextHash = await hashChapterText('旧正文')
    await db.retrievalChunks.bulkAdd([
      { projectId: fixture.scope.projectId, workId: fixture.scope.workId, sourceChapterId: fixture.chapterId, chunkIndex: 0, text: '旧', keywords: [], sourceTextHash, createdAt: now },
      { projectId: other.scope.projectId, workId: other.scope.workId, sourceChapterId: other.chapterId, chunkIndex: 0, text: '另一个作品', keywords: [], sourceTextHash, createdAt: now },
    ] as any)
    await db.narrativeSummaryNodes.bulkAdd([
      { projectId: fixture.scope.projectId, workId: fixture.scope.workId, level: 'chapter', sourceChapterId: fixture.chapterId, title: '旧', summary: '旧', keywords: [], sourceHash: sourceTextHash, status: 'verified', generatedBy: 'system-rollup', createdAt: now, updatedAt: now },
      { projectId: other.scope.projectId, workId: other.scope.workId, level: 'chapter', sourceChapterId: other.chapterId, title: '另', summary: '另', keywords: [], sourceHash: sourceTextHash, status: 'verified', generatedBy: 'system-rollup', createdAt: now, updatedAt: now },
    ] as any)
    const factId = await db.temporalFacts.add({
      projectId: fixture.scope.projectId,
      workId: fixture.scope.workId,
      subjectName: '林舟',
      predicate: 'location',
      value: '旧港',
      status: 'confirmed',
      locked: false,
      sourceType: 'chapter',
      sourceChapterId: fixture.chapterId,
      sourceQuote: '正文里已不存在的引文',
      createdAt: now,
      updatedAt: now,
    } as any) as number
    const result = await invalidateChapterPostAdoptionDerivativesV1({
      scope: fixture.scope,
      chapterId: fixture.chapterId,
    })
    expect(result).toEqual({ deletedChunks: 1, staleSummaries: 1, demotedFacts: 1 })
    expect((await db.temporalFacts.get(factId))?.status).toBe('stale')
    expect(await db.retrievalChunks.where('sourceChapterId').equals(other.chapterId).count()).toBe(1)
    expect((await db.narrativeSummaryNodes.where('sourceChapterId').equals(other.chapterId).first())?.status).toBe('verified')
  })

  it('整理本章同一次响应生成故事线推进、交汇和新线，确认前零写入，确认后走登记采纳', async () => {
    const fixture = await seed('storyline')
    const now = Date.now()
    const arcs: StoryArc[] = [
      { projectId: fixture.scope.projectId, workId: fixture.scope.workId, name: '潮门主线', type: 'main', stages: JSON.stringify([{ id: 'open', title: '开门', description: '', keyEvents: [] }]), description: '', createdAt: now, updatedAt: now } as any,
      { projectId: fixture.scope.projectId, workId: fixture.scope.workId, name: '苏砚支线', type: 'sub', stages: '[]', description: '', createdAt: now, updatedAt: now } as any,
    ]
    const arcIds = await db.storyArcs.bulkAdd(arcs, { allKeys: true }) as number[]
    const chapter = await db.chapters.get(fixture.chapterId)
    const chapterText = '林舟抵达潮门，并与苏砚并肩点亮旧灯。'
    const candidate = parseChapterOrganizationOutput({
      raw: JSON.stringify({
        stateDiffs: [], facts: [], inventoryEvents: [], storyEvents: [], relations: [], foreshadowUpdates: [],
        storyline: {
          progress: [{ arcId: arcIds[0], currentStageId: 'open', status: 'active', progressNote: '潮门主线正式启动', involvedEntities: ['林舟'], quote: '林舟抵达潮门' }],
          crossings: [{ arcIdA: arcIds[0], arcIdB: arcIds[1], note: '两线在点灯事件交汇', quote: '与苏砚并肩点亮旧灯' }],
          newArcs: [{ name: '旧灯谜线', type: 'sub', description: '旧灯来源形成新谜题', quote: '点亮旧灯' }],
        },
      }),
      projectId: fixture.scope.projectId,
      chapterId: fixture.chapterId,
      chapterTitle: chapter!.title,
      worldGroupId: null,
      chapterText,
      sourceTextHash: await hashChapterText(chapter!.content),
      characters: [],
      existingRelations: [],
      foreshadows: [],
      storyArcs: (await db.storyArcs.bulkGet(arcIds)) as StoryArc[],
      budget: new AgentTeamBudgetTracker('economy').snapshot(),
    })!
    expect(candidate.storyline).toMatchObject({
      progress: [{ arcId: arcIds[0] }],
      crossings: [{ arcIdA: arcIds[0], arcIdB: arcIds[1] }],
      newArcs: [{ name: '旧灯谜线' }],
    })
    const run = await persistChapterOrganizationCandidate(candidate)
    expect(await db.storylineProgress.count()).toBe(0)
    const adopted = await adoptChapterOrganizationSelection({
      run,
      selection: selectAllChapterOrganizationCandidates(candidate),
    })
    expect(adopted.written.storyline).toBe(3)
    expect(await db.storylineProgress.count()).toBe(1)
    expect(await db.storylineCrossings.count()).toBe(1)
    expect(await db.storyArcs.where('projectId').equals(fixture.scope.projectId).count()).toBe(3)
  })
})
