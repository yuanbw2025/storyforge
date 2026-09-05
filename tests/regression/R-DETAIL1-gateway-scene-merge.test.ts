import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  buildDetailedOutlineCopilotPatchV1,
  parseDetailedOutlineCopilotDraftV1,
} from '../../src/lib/agent/detailed-outline-copilot'
import { prepareDetailedOutlineGatewayAssemblyV1 } from '../../src/lib/outline/detail-gateway-context'
import { stampNewRecord, type WorkspaceScope } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const now = 1_787_900_100_000

async function addScoped(
  scope: WorkspaceScope,
  tableName: string,
  row: Record<string, unknown>,
  owner: 'world' | 'work',
): Promise<number> {
  return (db as any)[tableName].add(stampNewRecord(scope, tableName, {
    projectId: scope.projectId,
    createdAt: now,
    updatedAt: now,
    ...row,
  }, { owner })) as Promise<number>
}

async function seed() {
  const { scope } = await seedCurrentWorkspace('DETAIL-1 潮门细纲')
  const { projectId } = scope
  const groupId = await addScoped(scope, 'worldGroups', {
    name: '潮汐大陆', description: '', type: 'primary', order: 0,
  }, 'world')
  const otherGroupId = await addScoped(scope, 'worldGroups', {
    name: '镜海', description: '', type: 'parallel', order: 1,
  }, 'world')
  const arcId = await addScoped(scope, 'storyArcs', {
    worldGroupId: groupId, name: '潮钟主线', type: 'main', description: '寻找潮钟',
    stages: JSON.stringify([{ id: 'stage-1', title: '退潮', description: '进入旧城', startVolume: 1, endVolume: 1, keyEvents: ['镜门开启'] }]),
  }, 'work')
  const otherArcId = await addScoped(scope, 'storyArcs', {
    worldGroupId: otherGroupId, name: '镜海隔离线', type: 'sub', description: '不得泄漏', stages: '[]',
  }, 'work')
  const volumeId = await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId, parentId: null, type: 'volume', title: '第一卷', summary: '进入旧城', order: 0,
  }, 'work')
  const priorId = await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '镜片苏醒', order: 0,
  }, 'work')
  const targetId = await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId, parentId: volumeId, type: 'chapter', title: '第二章', summary: '守灯人进入潮门', order: 1,
  }, 'work')
  const nextId = await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId, parentId: volumeId, type: 'chapter', title: '第三章', summary: '潮钟第一次回响', order: 2,
  }, 'work')
  const priorChapterId = await addScoped(scope, 'chapters', {
    outlineNodeId: priorId, title: '第一章', content: '<p>镜片在潮声中苏醒。</p>',
    wordCount: 12, status: 'draft', order: 0, notes: '',
  }, 'work')
  const factId = await addScoped(scope, 'temporalFacts', {
    worldGroupId: groupId,
    subjectName: '镜片', predicate: 'state', factKind: 'state', value: '已经苏醒',
    sourceType: 'chapter', status: 'confirmed', locked: false,
    validFromChapterId: priorChapterId, validToChapterId: null, sourceChapterId: priorChapterId,
    sourceQuote: '镜片在潮声中苏醒。', confidence: 1,
  }, 'work')
  const otherFactId = await addScoped(scope, 'temporalFacts', {
    worldGroupId: otherGroupId,
    subjectName: '镜海秘密', predicate: 'state', factKind: 'state', value: '不得泄漏',
    sourceType: 'manual', status: 'confirmed', locked: false,
    validFromChapterId: null, validToChapterId: null, sourceChapterId: null,
    sourceQuote: '不得泄漏。', confidence: 1,
  }, 'work')
  const progressId = await addScoped(scope, 'storylineProgress', {
    arcId, currentStageId: 'stage-1', status: 'active', progressNote: '刚进入旧城',
    lastActiveChapterId: priorChapterId, lastActiveChapterTitle: '第一章', involvedEntities: '[]',
    evidenceQuote: '镜片在潮声中苏醒。',
  }, 'work')
  const otherProgressId = await addScoped(scope, 'storylineProgress', {
    arcId: otherArcId, currentStageId: null, status: 'dormant', progressNote: '不得泄漏',
    lastActiveChapterId: null, lastActiveChapterTitle: '', involvedEntities: '[]', evidenceQuote: '',
  }, 'work')
  const detailId = await addScoped(scope, 'detailedOutlines', {
    outlineNodeId: targetId,
    scenes: [
      { sceneId: 'scene-a', title: '入门', summary: '守灯人进入潮门。', characterIds: [], location: '潮门', conflict: '是否前进', pace: 'medium', estimatedWords: 800, notes: '保留' },
      { sceneId: 'scene-b', title: '回响', summary: '潮钟传来第一次回响。', characterIds: [], location: '内港', conflict: '回响引来守卫', pace: 'fast', estimatedWords: 1000, notes: '' },
    ],
    openingHook: '承接镜片苏醒。', endingCliffhanger: '', sceneLocation: '潮门',
    appearingCharacterIds: [], foreshadowIds: [], prohibitions: [], lastUsedSummary: '守灯人进入潮门',
  }, 'work')
  const moduleId = await addScoped(scope, 'narrativeModules', {
    kind: 'main', title: '潮钟蓝图', description: '持续演化蓝图', status: 'ready',
    sourceProjection: 'story-arc', sourceRefId: arcId, entryNodeKey: 'entry',
  }, 'work')
  await addScoped(scope, 'narrativeNodes', {
    moduleId, key: 'entry', kind: 'entry', title: '镜门入口', summary: '进入潮门',
    conditionJson: '{}', effectsJson: '[]', successorKeysJson: '[]', sourceOutlineNodeId: targetId, order: 0,
  }, 'work')
  await addScoped(scope, 'narrativeBeats', {
    moduleId, nodeKey: 'entry', beatKey: 'echo', kind: 'narration', speakerCharacterId: null,
    text: '潮钟回响。', order: 0,
  }, 'work')
  await addScoped(scope, 'narrativeChoices', {
    moduleId, sourceNodeKey: 'entry', choiceKey: 'enter', text: '进入潮门', description: '',
    unavailableReason: '', targetNodeKey: 'entry', displayConditionJson: '{}', availableConditionJson: '{}',
    effectsJson: '[]', tagsJson: '[]', order: 0,
  }, 'work')
  await db.works.update(scope.workId, { activeNarrativeModuleId: moduleId })
  return {
    projectId, scope, groupId, otherGroupId, arcId, otherArcId, volumeId, priorId, targetId, nextId,
    priorChapterId, factId, otherFactId, progressId, otherProgressId, detailId, moduleId,
  }
}

function completeScene(action: 'add' | 'modify', sceneId?: string) {
  return {
    action,
    ...(sceneId ? { sceneId } : {}),
    title: action === 'modify' ? '回响加剧' : '守卫抵达',
    summary: action === 'modify' ? '潮钟回响加剧并惊动守卫。' : '守卫封锁内港。',
    location: '内港', conflict: '守灯人必须隐藏身份', pace: 'fast', estimatedWords: 1200, characterIds: [],
  }
}

describe('DETAIL-1 · 细纲 Gateway 与场景合并治理', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('强制装入目标、相邻章、故事线阶段/进度、已写边界/事实、当前细纲原文和完整激活蓝图', async () => {
    const fixture = await seed()
    const assembly = await prepareDetailedOutlineGatewayAssemblyV1({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.groupId,
      outlineNodeId: fixture.targetId,
      operation: 'enhanced',
      authorRequest: '完善第二章细纲',
      config: useAIConfigStore.getState().config,
    })
    const mandatory = new Set(assembly.contextGatewayExecution.retrievalTrace.mandatory.map(item => item.resourceKey))
    const [prior, target, next, arc, otherArc, progress, otherProgress, detail, fact, otherFact, module] = await Promise.all([
      db.outlineNodes.get(fixture.priorId), db.outlineNodes.get(fixture.targetId), db.outlineNodes.get(fixture.nextId),
      db.storyArcs.get(fixture.arcId), db.storyArcs.get(fixture.otherArcId),
      db.storylineProgress.get(fixture.progressId), db.storylineProgress.get(fixture.otherProgressId),
      db.detailedOutlines.get(fixture.detailId), db.temporalFacts.get(fixture.factId),
      db.temporalFacts.get(fixture.otherFactId), db.narrativeModules.get(fixture.moduleId),
    ])
    expect(mandatory).toContain(`outline-node:${target!.ragDocumentId}`)
    expect(mandatory).toContain(`outline-node:${prior!.ragDocumentId}`)
    expect(mandatory).toContain(`outline-node:${next!.ragDocumentId}`)
    expect(mandatory).toContain(`story-arc:${arc!.ragDocumentId}`)
    expect(mandatory).toContain(`story-arc:${arc!.ragDocumentId}:stage:stage-1`)
    expect(mandatory).toContain(`storyline-progress:${progress!.ragDocumentId}`)
    expect(mandatory).toContain(`detailed-outline:${detail!.ragDocumentId}:field:scenes`)
    expect([...mandatory].some(key => key.endsWith(':written-boundary'))).toBe(true)
    expect(mandatory).toContain(`fact:${fact!.ragDocumentId}`)
    expect(mandatory).toContain(`narrative-blueprint:${module!.ragDocumentId}`)
    expect(assembly.contextGatewayExecution.contextPacket.sourceRefs.some(ref => ref.table === 'narrativeNodes')).toBe(true)
    expect(assembly.contextGatewayExecution.contextPacket.sourceRefs.some(ref => ref.table === 'narrativeBeats')).toBe(true)
    expect(assembly.contextGatewayExecution.contextPacket.sourceRefs.some(ref => ref.table === 'narrativeChoices')).toBe(true)
    expect([...mandatory].some(key => key.includes(otherArc!.ragDocumentId!))).toBe(false)
    expect([...mandatory].some(key => key.includes(otherProgress!.ragDocumentId!))).toBe(false)
    expect([...mandatory].some(key => key.includes(otherFact!.ragDocumentId!))).toBe(false)
    expect(assembly.sourceEvidence?.map(item => item.key)).toEqual(['ragSelection'])
  })

  it('已写目标章在模型调用前硬阻断', async () => {
    const fixture = await seed()
    await addScoped(fixture.scope, 'chapters', {
      outlineNodeId: fixture.targetId, title: '第二章', content: '<p>已经写下不可覆盖的正文。</p>',
      wordCount: 14, status: 'draft', order: 1, notes: '',
    }, 'work')
    await expect(prepareDetailedOutlineGatewayAssemblyV1({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.groupId,
      outlineNodeId: fixture.targetId,
      operation: 'scenes',
      authorRequest: '拆分场景',
      config: useAIConfigStore.getState().config,
    })).rejects.toThrow('已写正文保护区')
  })

  it('编辑器空段落占位不被误判为已写正文', async () => {
    const fixture = await seed()
    await addScoped(fixture.scope, 'chapters', {
      outlineNodeId: fixture.targetId, title: '第二章', content: '<p><br></p>',
      wordCount: 0, status: 'outline', order: 1, notes: '',
    }, 'work')
    await expect(prepareDetailedOutlineGatewayAssemblyV1({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.groupId,
      outlineNodeId: fixture.targetId,
      operation: 'scenes',
      authorRequest: '拆分场景',
      config: useAIConfigStore.getState().config,
    })).resolves.toMatchObject({ contextGatewayExecution: { path: 'deterministic-fast' } })
  })

  it('空细纲占位记录不被误列为 mandatory resource，首次拆场景仍可运行', async () => {
    const fixture = await seed()
    const detail = await db.detailedOutlines.get(fixture.detailId)
    await db.detailedOutlines.update(fixture.detailId, {
      scenes: [],
      openingHook: '',
      endingCliffhanger: '',
      sceneLocation: '',
      lastUsedSummary: '',
    })

    const assembly = await prepareDetailedOutlineGatewayAssemblyV1({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.groupId,
      outlineNodeId: fixture.targetId,
      operation: 'scenes',
      authorRequest: '首次拆分场景',
      config: useAIConfigStore.getState().config,
    })
    const mandatory = new Set(assembly.contextGatewayExecution.retrievalTrace.mandatory.map(item => item.resourceKey))

    expect(detail?.ragDocumentId).toBeTruthy()
    expect(assembly.contextGatewayExecution.path).toBe('deterministic-fast')
    expect(mandatory).not.toContain(`detailed-outline:${detail!.ragDocumentId}`)
    expect(mandatory).not.toContain(`detailed-outline:${detail!.ragDocumentId}:field:scenes`)
  })

  it('空故事线阶段不被误列为 mandatory 原文，首次拆场景仍可运行', async () => {
    const fixture = await seed()
    const arc = await db.storyArcs.get(fixture.arcId)
    await db.storyArcs.update(fixture.arcId, { stages: '[]' })

    const assembly = await prepareDetailedOutlineGatewayAssemblyV1({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.groupId,
      outlineNodeId: fixture.targetId,
      operation: 'scenes',
      authorRequest: '在故事线尚未分阶段时拆分场景',
      config: useAIConfigStore.getState().config,
    })
    const mandatory = new Set(assembly.contextGatewayExecution.retrievalTrace.mandatory.map(item => item.resourceKey))
    const arcResourceKey = `story-arc:${arc!.ragDocumentId}`

    expect(arc?.ragDocumentId).toBeTruthy()
    expect(assembly.contextGatewayExecution.path).toBe('deterministic-fast')
    expect(mandatory).toContain(arcResourceKey)
    expect(mandatory).not.toContain(`${arcResourceKey}:field:stages`)
    expect([...mandatory].some(key => key.startsWith(`${arcResourceKey}:stage:`))).toBe(false)
  })

  it('已有场景只能按稳定 sceneId 显式保留、修改、新增或删除，不允许无条件追加', () => {
    const currentScenes = [
      { sceneId: 'scene-a', title: '入门', summary: '守灯人进入潮门。', characterIds: [], location: '潮门', conflict: '是否前进', pace: 'medium' as const, estimatedWords: 800, notes: '保留' },
      { sceneId: 'scene-b', title: '回响', summary: '潮钟传来第一次回响。', characterIds: [], location: '内港', conflict: '回响引来守卫', pace: 'fast' as const, estimatedWords: 1000, notes: '' },
    ]
    const raw = JSON.stringify({
      scenePlanMode: 'merge-proposal',
      scenes: [
        { action: 'retain', sceneId: 'scene-a' },
        completeScene('modify', 'scene-b'),
        completeScene('add'),
      ],
    })
    const patch = buildDetailedOutlineCopilotPatchV1({
      raw, operation: 'scenes', currentScenes, chapterSummary: '守灯人进入潮门',
      validCharacterIds: new Set(), validForeshadowIds: new Set(),
    })
    expect(patch.scenes).toHaveLength(3)
    expect(patch.scenes?.[0]).toEqual(currentScenes[0])
    expect(patch.scenes?.[1]?.sceneId).toBe('scene-b')
    expect(patch.scenes?.[1]?.title).toBe('回响加剧')
    expect(patch.scenes?.[2]?.sceneId).toBeTruthy()
    expect(['scene-a', 'scene-b']).not.toContain(patch.scenes?.[2]?.sceneId)

    expect(() => parseDetailedOutlineCopilotDraftV1(JSON.stringify({
      scenePlanMode: 'merge-proposal', scenes: [{ action: 'modify', sceneId: 'unknown', ...completeScene('modify', 'unknown') }],
    }), 'scenes')).not.toThrow()
    expect(() => buildDetailedOutlineCopilotPatchV1({
      raw: JSON.stringify({ scenePlanMode: 'merge-proposal', scenes: [
        { action: 'retain', sceneId: 'scene-a' }, completeScene('modify', 'unknown'),
      ] }),
      operation: 'scenes', currentScenes, chapterSummary: '', validCharacterIds: new Set(), validForeshadowIds: new Set(),
    })).toThrow('未知 sceneId')
    expect(() => buildDetailedOutlineCopilotPatchV1({
      raw: JSON.stringify({ scenePlanMode: 'merge-proposal', scenes: [{ action: 'retain', sceneId: 'scene-a' }] }),
      operation: 'scenes', currentScenes, chapterSummary: '', validCharacterIds: new Set(), validForeshadowIds: new Set(),
    })).toThrow('未声明保留、修改或删除')
    expect(() => buildDetailedOutlineCopilotPatchV1({
      raw: JSON.stringify({ scenePlanMode: 'replace', scenes: [completeScene('add')] }),
      operation: 'scenes', currentScenes, chapterSummary: '', validCharacterIds: new Set(), validForeshadowIds: new Set(),
    })).toThrow('禁止无条件追加或覆盖')
  })
})
