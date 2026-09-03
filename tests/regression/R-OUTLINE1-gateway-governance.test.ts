import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { generateWorkspaceUid } from '../../src/lib/memory/identity'
import { ensureWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord, type WorkspaceScope } from '../../src/lib/workspace/scope'
import { prepareOutlineGatewayAssemblyV1 } from '../../src/lib/outline/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'

const now = 1_787_900_000_000

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
  const projectId = await db.projects.add({
    workspaceUid: generateWorkspaceUid(),
    name: 'OUTLINE-1 潮汐长篇', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
    description: '', targetWordCount: 1_000_000, createdAt: now, updatedAt: now,
  } as any) as number
  const { scope } = await ensureWorkspaceOwnership(projectId)
  const groupId = await addScoped(scope, 'worldGroups', {
    name: '潮汐大陆', description: '', type: 'primary', order: 0,
  }, 'world')
  const otherGroupId = await addScoped(scope, 'worldGroups', {
    name: '镜海', description: '', type: 'parallel', order: 1,
  }, 'world')
  const storyCoreId = await addScoped(scope, 'storyCores', {
    worldGroupId: groupId,
    logline: '守灯人追寻失落潮钟。', concept: '记忆与选择', theme: '选择塑造自我',
    centralConflict: '守住现实还是救回旧世界', plotPattern: '追寻', mainPlot: '寻找潮钟', subPlots: '镜裔内战',
  }, 'work')
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
  const outlineChapterId = await addScoped(scope, 'outlineNodes', {
    worldGroupId: groupId, parentId: volumeId, type: 'chapter', title: '第一章', summary: '镜片苏醒', order: 0,
  }, 'work')
  await addScoped(scope, 'chapters', {
    outlineNodeId: outlineChapterId, title: '第一章', content: '<p>镜片在潮声中苏醒。</p>',
    wordCount: 12, status: 'draft', order: 0, notes: '',
  }, 'work')
  const moduleId = await addScoped(scope, 'narrativeModules', {
    kind: 'main', title: '潮钟蓝图', description: '持续演化蓝图', status: 'ready',
    sourceProjection: 'story-arc', sourceRefId: arcId, entryNodeKey: 'entry',
  }, 'work')
  await addScoped(scope, 'narrativeNodes', {
    moduleId, key: 'entry', kind: 'entry', title: '镜门入口', summary: '镜片苏醒',
    conditionJson: '{}', effectsJson: '[]', successorKeysJson: '[]', sourceOutlineNodeId: outlineChapterId, order: 0,
  }, 'work')
  await addScoped(scope, 'narrativeBeats', {
    moduleId, nodeKey: 'entry', beatKey: 'wake', kind: 'narration', speakerCharacterId: null,
    text: '镜片发出潮声。', order: 0,
  }, 'work')
  await addScoped(scope, 'narrativeChoices', {
    moduleId, sourceNodeKey: 'entry', choiceKey: 'touch', text: '触碰镜片', description: '',
    unavailableReason: '', targetNodeKey: 'entry', displayConditionJson: '{}', availableConditionJson: '{}',
    effectsJson: '[]', tagsJson: '[]', order: 0,
  }, 'work')
  await db.works.update(scope.workId, { activeNarrativeModuleId: moduleId })
  return { projectId, scope, groupId, otherGroupId, storyCoreId, arcId, otherArcId, volumeId, outlineChapterId, moduleId }
}

describe('OUTLINE-1 · 大纲 Gateway 治理', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('从注册资源强制装入意图、故事线阶段、目标卷、已写边界和完整激活蓝图', async () => {
    const fixture = await seed()
    const assembly = await prepareOutlineGatewayAssemblyV1({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.groupId,
      request: { kind: 'chapters', volumeId: fixture.volumeId },
      authorRequest: '把第一卷继续拆分为未写章节',
      config: useAIConfigStore.getState().config,
    })
    const mandatory = new Set(assembly.contextGatewayExecution.retrievalTrace.mandatory.map(item => item.resourceKey))
    const storyCore = await db.storyCores.get(fixture.storyCoreId)
    const arc = await db.storyArcs.get(fixture.arcId)
    const otherArc = await db.storyArcs.get(fixture.otherArcId)
    const volume = await db.outlineNodes.get(fixture.volumeId)
    const module = await db.narrativeModules.get(fixture.moduleId)
    expect(mandatory).toContain(`story-core-field:${storyCore!.ragDocumentId}:field:logline`)
    expect(mandatory).toContain(`story-arc:${arc!.ragDocumentId}`)
    expect(mandatory).toContain(`story-arc:${arc!.ragDocumentId}:stage:stage-1`)
    expect(mandatory).toContain(`outline-node:${volume!.ragDocumentId}`)
    expect([...mandatory].some(key => key.endsWith(':written-boundary'))).toBe(true)
    expect(mandatory).toContain(`narrative-blueprint:${module!.ragDocumentId}`)
    expect(assembly.contextGatewayExecution.contextPacket.sourceRefs.some(ref => ref.table === 'narrativeNodes')).toBe(true)
    expect(assembly.contextGatewayExecution.contextPacket.sourceRefs.some(ref => ref.table === 'narrativeBeats')).toBe(true)
    expect(assembly.contextGatewayExecution.contextPacket.sourceRefs.some(ref => ref.table === 'narrativeChoices')).toBe(true)
    expect([...mandatory].some(key => key.includes(otherArc!.ragDocumentId!))).toBe(false)
    expect(assembly.sourceEvidence?.map(item => item.key)).toEqual(['ragSelection'])
    expect(assembly.text).toContain('已写正文保护边界')
  })

  it('priorOutlineCandidate 只在明确续接时激活，且定点改写已写区在模型调用前硬阻断', async () => {
    const fixture = await seed()
    const continued = await prepareOutlineGatewayAssemblyV1({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.groupId,
      request: { kind: 'chapters', volumeId: fixture.volumeId },
      authorRequest: '继续下一批章纲',
      config: useAIConfigStore.getState().config,
      priorOutlineCandidateText: '上一批候选：第二章进入镜门。',
    })
    expect(continued.sourceEvidence?.map(item => item.key)).toEqual(['ragSelection', 'priorOutlineCandidate'])
    expect(continued.text).toContain('上一批候选：第二章进入镜门')

    await expect(prepareOutlineGatewayAssemblyV1({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.groupId,
      request: { kind: 'single-chapter', chapterId: fixture.outlineChapterId },
      authorRequest: '重写第一章章纲',
      config: useAIConfigStore.getState().config,
    })).rejects.toThrow('已写正文保护区')
    await expect(prepareOutlineGatewayAssemblyV1({
      projectId: fixture.projectId,
      scope: fixture.scope,
      worldGroupId: fixture.groupId,
      request: { kind: 'single-volume', volumeId: fixture.volumeId },
      authorRequest: '重写第一卷卷纲',
      config: useAIConfigStore.getState().config,
    })).rejects.toThrow('已写正文保护区')
  })
})
