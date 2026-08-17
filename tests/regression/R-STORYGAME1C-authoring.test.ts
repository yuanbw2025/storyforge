import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { addNarrativeNode } from '../../src/lib/narrative/blueprint'
import {
  advanceStoryGameDraftPreview,
  buildStoryGameDraftPreview,
  createStarterStoryGame,
  deleteStoryGameDraft,
  deleteNarrativeBeat,
  deleteNarrativeChoice,
  deleteNarrativeNode,
  loadStoryGameAuthoringSnapshot,
  publishStoryGameDraft,
  seedStoryGameAcceptanceSample,
  updateGameDefinition,
  updateNarrativeBeat,
  updateNarrativeChoice,
  updateNarrativeModule,
  updateNarrativeNode,
} from '../../src/lib/text-game/authoring'
import { addNarrativeBeat, addNarrativeChoice, validateStoryGameContent } from '../../src/lib/text-game/content'
import { parseGameReleaseManifest } from '../../src/lib/text-game/releases'
import { createStoryGameInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { readSimulationState } from '../../src/lib/simulation/runtime'

async function createWorkspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    name,
    genre: 'mystery',
    genres: ['mystery'],
    status: 'drafting',
    description: 'STORYGAME-1C 测试项目',
    targetWordCount: 80_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return ensureWorkspaceOwnership(projectId)
}

describe('STORYGAME-1C · authoring workbench kernel', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('以范围校验 API 完成游戏、节点、Beat、Choice 编辑和安全删除', async () => {
    const owner = await createWorkspace('作者编辑')
    const foreign = await createWorkspace('其他工作区')
    const definition = await createStarterStoryGame({
      scope: owner.scope,
      gameKey: 'editable-story',
      title: '可编辑故事',
    })
    const snapshot = await loadStoryGameAuthoringSnapshot(owner.scope)
    const module = snapshot.modules[0]
    const entry = snapshot.nodes.find(node => node.key === 'entry')!
    const ending = snapshot.nodes.find(node => node.key === 'ending')!
    const beat = snapshot.beats[0]
    const choice = snapshot.choices[0]

    await updateGameDefinition({
      scope: owner.scope,
      gameDefinitionId: definition.id!,
      title: '改写后的故事',
      description: '新的简介',
      initialVariablesJson: '{"trust":1}',
    })
    await updateNarrativeModule({
      scope: owner.scope,
      moduleId: module.id!,
      title: '第一章',
      entryNodeKey: 'entry',
      status: 'ready',
    })
    await updateNarrativeNode({
      scope: owner.scope,
      nodeId: entry.id!,
      kind: 'entry',
      title: '新的开场',
      summary: '开场摘要',
      conditionJson: '{}',
      effectsJson: '[{"op":"increment","path":"trust","value":1}]',
    })
    await updateNarrativeBeat({ scope: owner.scope, beatId: beat.id!, kind: 'action', text: '门被推开。', order: 2 })
    await updateNarrativeChoice({
      scope: owner.scope,
      choiceId: choice.id!,
      text: '走进终章',
      description: '结束故事',
      targetNodeKey: 'ending',
      displayConditionJson: '{}',
      availableConditionJson: '{"path":"trust","eq":2}',
      unavailableReason: '信任不足。',
      effectsJson: '[]',
      tagsJson: '["ending"]',
    })
    expect(await loadStoryGameAuthoringSnapshot(owner.scope)).toMatchObject({
      definitions: [expect.objectContaining({ title: '改写后的故事', initialVariablesJson: '{"trust":1}' })],
      modules: [expect.objectContaining({ title: '第一章', status: 'ready' })],
      beats: [expect.objectContaining({ text: '门被推开。', kind: 'action', order: 2 })],
      choices: [expect.objectContaining({ text: '走进终章', tagsJson: '["ending"]' })],
    })

    await expect(updateNarrativeNode({
      scope: foreign.scope,
      nodeId: entry.id!,
      kind: 'entry',
      title: '越权修改',
      conditionJson: '{}',
      effectsJson: '[]',
    })).rejects.toThrow('不属于当前 scope')
    await expect(deleteNarrativeNode({ scope: owner.scope, nodeId: entry.id! })).rejects.toThrow('入口节点不能删除')

    const temporary = await addNarrativeNode({
      scope: owner.scope,
      moduleId: module.id!,
      key: 'temporary',
      kind: 'scene',
      title: '临时节点',
      order: 3,
    })
    const temporaryBeat = await addNarrativeBeat({
      scope: owner.scope,
      moduleId: module.id!,
      nodeKey: 'temporary',
      beatKey: 'temporary.beat',
      kind: 'narration',
      text: '临时内容',
    })
    const incoming = await addNarrativeChoice({
      scope: owner.scope,
      moduleId: module.id!,
      sourceNodeKey: 'entry',
      choiceKey: 'entry.temporary',
      text: '进入临时节点',
      targetNodeKey: 'temporary',
    })
    const outgoing = await addNarrativeChoice({
      scope: owner.scope,
      moduleId: module.id!,
      sourceNodeKey: 'temporary',
      choiceKey: 'temporary.ending',
      text: '返回结局',
      targetNodeKey: 'ending',
    })
    await deleteNarrativeNode({ scope: owner.scope, nodeId: temporary.id! })
    expect(await db.narrativeBeats.get(temporaryBeat.id!)).toBeUndefined()
    expect(await db.narrativeChoices.get(incoming.id!)).toBeUndefined()
    expect(await db.narrativeChoices.get(outgoing.id!)).toBeUndefined()
    expect(await db.narrativeNodes.get(ending.id!)).toBeTruthy()

    await deleteNarrativeBeat({ scope: owner.scope, beatId: beat.id! })
    await deleteNarrativeChoice({ scope: owner.scope, choiceId: choice.id! })
    expect(await db.narrativeBeats.get(beat.id!)).toBeUndefined()
    expect(await db.narrativeChoices.get(choice.id!)).toBeUndefined()
  })

  it('生成达到验收规模的三章样例，草稿试玩与正式运行共享选择语义', async () => {
    const owner = await createWorkspace('潮港守灯录')
    const definition = await seedStoryGameAcceptanceSample({ scope: owner.scope })
    expect((await seedStoryGameAcceptanceSample({ scope: owner.scope })).id).toBe(definition.id)
    const snapshot = await loadStoryGameAuthoringSnapshot(owner.scope)
    expect(snapshot.nodes).toHaveLength(25)
    expect(snapshot.beats).toHaveLength(45)
    expect(snapshot.choices.length).toBeGreaterThanOrEqual(20)
    expect(snapshot.nodes.filter(node => node.kind === 'ending')).toHaveLength(3)
    const report = await validateStoryGameContent(owner.scope, definition.narrativeModuleId)
    expect(report).toMatchObject({ valid: true, unreachableNodeKeys: [], deadEndNodeKeys: [] })
    expect(snapshot.choices.some(choice => choice.displayConditionJson !== '{}')).toBe(true)
    expect(snapshot.choices.some(choice => choice.availableConditionJson !== '{}' && !!choice.unavailableReason)).toBe(true)

    let preview = await buildStoryGameDraftPreview({ scope: owner.scope, gameDefinitionId: definition.id! })
    expect(preview.state).toMatchObject({ currentNodeKey: 'ch1.entry', availableChoiceKeys: ['ch1.seek-archive', 'ch1.climb-roof'] })
    preview = advanceStoryGameDraftPreview(preview, 'ch1.seek-archive')
    preview = advanceStoryGameDraftPreview(preview, 'ch1.archive-merge')
    expect(preview.state).toMatchObject({ currentNodeKey: 'ch1.merge', variables: expect.objectContaining({ clue: true }) })

    const publication = await publishStoryGameDraft({
      scope: owner.scope,
      gameDefinitionId: definition.id!,
      label: '潮港守灯录 v1',
    })
    const manifest = parseGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest.narrative).toMatchObject({ entryNodeKey: 'ch1.entry' })
    expect(manifest.narrative.nodes).toHaveLength(25)
    expect(manifest.narrative.beats).toHaveLength(45)
    expect(manifest.narrative.choices.length).toBeGreaterThanOrEqual(20)

    const session = await createStoryGameInstance({
      scope: owner.scope,
      gameReleaseId: publication.gameRelease.id!,
      title: '正式存档',
    })
    const formal = await readSimulationState(session.id!)
    expect(formal.narrative).toMatchObject({
      currentNodeKey: preview.state.nodes[0].key,
      availableChoiceKeys: ['ch1.seek-archive', 'ch1.climb-roof'],
    })

    await db.narrativeBeats.where('moduleId').equals(definition.narrativeModuleId).modify({ text: '发布后的草稿变化' })
    expect(parseGameReleaseManifest((await db.gameReleases.get(publication.gameRelease.id!))!.manifestJson).narrative.beats[0].text)
      .not.toBe('发布后的草稿变化')
  }, 20_000)

  it('删除专属草稿级联清理内容但保留冻结发布；共享模块不被误删', async () => {
    const owner = await createWorkspace('作者删除生命周期')
    const first = await createStarterStoryGame({ scope: owner.scope, gameKey: 'first-draft', title: '第一草稿' })
    const moduleId = first.narrativeModuleId
    const publication = await publishStoryGameDraft({ scope: owner.scope, gameDefinitionId: first.id! })
    await db.works.update(owner.scope.workId, { activeNarrativeModuleId: moduleId })
    const legacySessionId = await db.simulationSessions.add({
      projectId: owner.scope.projectId,
      worldId: owner.scope.worldId,
      workId: owner.scope.workId,
      worldGroupId: null,
      worldReleaseId: null,
      gameReleaseId: null,
      narrativeModuleId: moduleId,
      narrativeModuleExportId: null,
      draftSnapshotHash: null,
      kind: 'sandbox',
      title: '冻结旧实例',
      status: 'active',
      rulesetVersion: 1,
      seed: 'legacy-frozen-instance',
      canonSnapshotJson: '{"version":1,"sources":[]}',
      initialStateJson: '{"version":1,"clock":0,"entities":{},"memories":[],"narratives":[],"ttrpg":null,"chat":null,"narrative":null,"lastSequence":0}',
      parentSessionId: null,
      parentThroughSequence: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }) as number
    await deleteStoryGameDraft({ scope: owner.scope, gameDefinitionId: first.id! })
    expect(await db.gameDefinitions.get(first.id!)).toBeUndefined()
    expect(await db.narrativeModules.get(moduleId)).toBeUndefined()
    expect(await db.narrativeNodes.where('moduleId').equals(moduleId).count()).toBe(0)
    expect(await db.narrativeBeats.where('moduleId').equals(moduleId).count()).toBe(0)
    expect(await db.narrativeChoices.where('moduleId').equals(moduleId).count()).toBe(0)
    expect(await db.gameReleases.get(publication.gameRelease.id!)).toMatchObject({ gameDefinitionId: null })
    expect(await db.works.get(owner.scope.workId)).toMatchObject({ activeNarrativeModuleId: null })
    expect(await db.simulationSessions.get(legacySessionId)).toMatchObject({ narrativeModuleId: null })

    const shared = await createStarterStoryGame({ scope: owner.scope, gameKey: 'shared-first', title: '共享草稿一' })
    const now = Date.now()
    const secondId = await db.gameDefinitions.add({
      ...shared,
      id: undefined,
      gameKey: 'shared-second',
      title: '共享草稿二',
      createdAt: now,
      updatedAt: now,
    }) as number
    await deleteStoryGameDraft({ scope: owner.scope, gameDefinitionId: shared.id! })
    expect(await db.gameDefinitions.get(secondId)).toBeTruthy()
    expect(await db.narrativeModules.get(shared.narrativeModuleId)).toBeTruthy()
    expect(await db.narrativeNodes.where('moduleId').equals(shared.narrativeModuleId).count()).toBe(2)
  })
})
