import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { addNarrativeNode, createNarrativeModule } from '../../src/lib/narrative/blueprint'
import {
  branchSimulationSession,
  commitNarrativeChoice,
  commitNarrativeChoiceWithStateV1,
  createSimulationCheckpoint,
  readSimulationState,
  readSimulationStateVersion,
  verifySimulationCheckpoint,
} from '../../src/lib/simulation/runtime'
import {
  addNarrativeBeat,
  addNarrativeChoice,
  createGameDefinition,
  deleteGameDefinition,
  validateNarrativeContentGraph,
  evaluateNarrativeChoices,
  validateStoryGameContent,
} from '../../src/lib/text-game/content'
import {
  assertGameReleaseUnchanged,
  parseGameReleaseManifest,
  publishGameDefinition,
} from '../../src/lib/text-game/releases'
import type { FrozenGameNarrativeNode } from '../../src/lib/types'
import { assertInstanceBinding, createStoryGameInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'

async function createWorkspace(name: string) {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    name,
    genre: 'mystery',
    genres: ['mystery'],
    status: 'drafting',
    description: 'STORYGAME-1A 回归项目',
    targetWordCount: 80_000,
    createdAt: now,
    updatedAt: now,
  } as any) as number
  return ensureWorkspaceOwnership(projectId)
}

describe('STORYGAME-1A · content and execution kernel', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('冻结 Beat/Choice，正式提交选择并确定性回放、检查点和分支', async () => {
    const ownership = await createWorkspace('冻结分支叙事')
    const module = await createNarrativeModule({
      scope: ownership.scope,
      owner: 'work',
      kind: 'main',
      title: '雾中来客',
    })
    await addNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      key: 'entry',
      kind: 'entry',
      title: '敲门声',
      effectsJson: '[{"op":"set","path":"trust","value":0}]',
      order: 0,
    })
    await addNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      key: 'welcome',
      kind: 'scene',
      title: '让他进来',
      conditionJson: '{"path":"trust","eq":1}',
      effectsJson: '[{"op":"set","path":"sheltered","value":true}]',
      order: 1,
    })
    await addNarrativeNode({
      scope: ownership.scope,
      moduleId: module.id!,
      key: 'ending',
      kind: 'ending',
      title: '炉火旁',
      order: 2,
    })
    await addNarrativeBeat({
      scope: ownership.scope,
      moduleId: module.id!,
      nodeKey: 'entry',
      beatKey: 'rain',
      kind: 'narration',
      text: '雨敲着窗。',
    })
    await addNarrativeChoice({
      scope: ownership.scope,
      moduleId: module.id!,
      sourceNodeKey: 'entry',
      choiceKey: 'open-door',
      text: '打开门',
      targetNodeKey: 'welcome',
      effectsJson: '[{"op":"increment","path":"trust","value":1}]',
      order: 0,
    })
    await addNarrativeChoice({
      scope: ownership.scope,
      moduleId: module.id!,
      sourceNodeKey: 'entry',
      choiceKey: 'locked-door',
      text: '等待口令',
      unavailableReason: '你还不知道口令。',
      targetNodeKey: 'ending',
      availableConditionJson: '{"selected":"open-door"}',
      order: 1,
    })
    await addNarrativeChoice({
      scope: ownership.scope,
      moduleId: module.id!,
      sourceNodeKey: 'entry',
      choiceKey: 'hidden-door',
      text: '发现暗门',
      targetNodeKey: 'ending',
      displayConditionJson: '{"visited":"welcome"}',
      order: 2,
    })
    await addNarrativeChoice({
      scope: ownership.scope,
      moduleId: module.id!,
      sourceNodeKey: 'welcome',
      choiceKey: 'sit-fire',
      text: '请他坐到炉火旁',
      targetNodeKey: 'ending',
      availableConditionJson: '{"path":"sheltered","eq":true}',
      order: 0,
    })
    expect(await validateStoryGameContent(ownership.scope, module.id!)).toMatchObject({ valid: true })

    const definition = await createGameDefinition({
      scope: ownership.scope,
      gameKey: 'mist-visitor',
      title: '雾中来客',
      narrativeModuleId: module.id!,
      initialVariables: { chapter: 1 },
    })
    const revision = await createWorldRevision({
      scope: ownership.scope,
      label: '游戏内容冻结',
    })
    const worldRelease = await publishWorldRevision(revision.id!)

    await db.narrativeBeats.where('moduleId').equals(module.id!).modify({ text: '草稿已改写。' })
    await db.narrativeChoices.where('moduleId').equals(module.id!).modify({ text: '草稿选择已改写' })
    const gameRelease = await publishGameDefinition({
      scope: ownership.scope,
      gameDefinitionId: definition.id!,
      worldReleaseId: worldRelease.id!,
    })
    const manifest = parseGameReleaseManifest(gameRelease.manifestJson)
    // WorldRelease freezes only semantic world input. The product draft stays
    // editable until Product/Game Release publication, which freezes its own
    // executable graph at the then-current revision.
    expect(manifest.narrative.beats[0].text).toBe('草稿已改写。')
    expect(manifest.narrative.choices[0].text).toBe('草稿选择已改写')
    await db.narrativeBeats.where('moduleId').equals(module.id!).modify({ text: '发布后再次改写。' })
    expect(parseGameReleaseManifest((await db.gameReleases.get(gameRelease.id!))!.manifestJson)
      .narrative.beats[0].text).toBe('草稿已改写。')
    await assertGameReleaseUnchanged(gameRelease.id!)

    const session = await createStoryGameInstance({
      scope: ownership.scope,
      gameReleaseId: gameRelease.id!,
      title: '第一次游玩',
      seed: 'storygame-fixed-seed',
    })
    expect(session).toMatchObject({
      kind: 'storygame',
      gameReleaseId: gameRelease.id,
      worldReleaseId: worldRelease.id,
    })
    const initial = await readSimulationState(session.id!)
    expect(initial.narrative).toMatchObject({
      version: 2,
      currentNodeKey: 'entry',
      visibleChoiceKeys: ['open-door', 'locked-door'],
      availableChoiceKeys: ['open-door'],
      variables: { chapter: 1, trust: 0 },
    })
    expect(evaluateNarrativeChoices({
      ...initial.narrative!.variables,
      __visitedNodeKeys: initial.narrative!.visitedNodeKeys,
      __selectedChoiceKeys: [],
    }, 'entry', initial.narrative!.choices!)).toEqual(expect.arrayContaining([
      expect.objectContaining({ choiceKey: 'locked-door', visible: true, available: false, unavailableReason: '你还不知道口令。' }),
      expect.objectContaining({ choiceKey: 'hidden-door', visible: false, available: false }),
    ]))
    const baseline = await readSimulationStateVersion(session.id!)
    const firstCommit = await commitNarrativeChoiceWithStateV1({
      sessionId: session.id!,
      choiceKey: 'open-door',
      commandId: 'choice-command-1',
      baseSequence: baseline.sequence,
      baseStateHash: baseline.stateHash,
    })
    const first = firstCommit.event
    expect(first).toMatchObject({ type: 'narrative.choice.committed', sequence: 3 })
    expect(firstCommit.appendedEvents.map(event => event.type))
      .toEqual(['narrative.choice.committed', 'narrative.node.entered'])
    expect(firstCommit.state.narrative?.currentNodeKey).toBe('welcome')
    expect(await commitNarrativeChoice({
      sessionId: session.id!,
      choiceKey: 'open-door',
      commandId: 'choice-command-1',
      baseSequence: baseline.sequence,
      baseStateHash: baseline.stateHash,
    })).toEqual(first)
    expect(await db.simulationEvents.where('sessionId').equals(session.id!).count()).toBe(4)
    expect((await db.simulationEvents.where('sessionId').equals(session.id!).sortBy('sequence')).map(event => event.type))
      .toEqual(['narrative.started', 'narrative.node.entered', 'narrative.choice.committed', 'narrative.node.entered'])
    await expect(commitNarrativeChoice({
      sessionId: session.id!,
      choiceKey: 'open-door',
      commandId: 'choice-command-2',
      baseSequence: baseline.sequence,
      baseStateHash: baseline.stateHash,
    })).rejects.toThrow('已变化')

    const afterFirst = await readSimulationState(session.id!)
    expect(afterFirst.narrative).toMatchObject({
      currentNodeKey: 'welcome',
      availableChoiceKeys: ['sit-fire'],
      variables: { chapter: 1, trust: 1, sheltered: true },
      choiceHistory: [{ eventSequence: 3, choiceKey: 'open-door', fromNodeKey: 'entry', toNodeKey: 'welcome' }],
    })
    const checkpoint = await createSimulationCheckpoint({ sessionId: session.id!, name: '进屋后' })
    expect(await verifySimulationCheckpoint(checkpoint.id!)).toBe(true)
    const next = await readSimulationStateVersion(session.id!)
    await commitNarrativeChoice({
      sessionId: session.id!,
      choiceKey: 'sit-fire',
      commandId: 'choice-command-3',
      baseSequence: next.sequence,
      baseStateHash: next.stateHash,
    })
    expect(await readSimulationState(session.id!)).toMatchObject({
      lastSequence: 7,
      narrative: { completed: true, endingKey: 'ending', completedAtSequence: 7 },
    })
    const branch = await branchSimulationSession({
      parentSessionId: session.id!,
      throughSequence: 4,
      title: '从进屋后分支',
    })
    expect(branch.gameReleaseId).toBe(gameRelease.id)
    expect(await readSimulationState(branch.id!)).toMatchObject({
      lastSequence: 0,
      narrative: { currentNodeKey: 'welcome', completed: false, availableChoiceKeys: ['sit-fire'] },
    })
  }, 15_000)

  it('图校验报告断链、无效目标、不可达、缺失结局和无退出循环', () => {
    const nodes = (rows: Array<Partial<FrozenGameNarrativeNode> & Pick<FrozenGameNarrativeNode, 'key' | 'kind'>>) => rows.map(row => ({
      title: row.key,
      summary: '',
      conditionJson: '{}',
      effectsJson: '[]',
      successorKeys: [],
      ...row,
    }))
    const invalid = validateNarrativeContentGraph({
      entryNodeKey: 'entry',
      nodes: nodes([
        { key: 'entry', kind: 'entry', successorKeys: ['missing'] },
        { key: 'orphan', kind: 'scene' },
      ]),
      beats: [],
      choices: [],
    })
    expect(invalid.valid).toBe(false)
    expect(invalid.danglingSuccessors).toEqual([{ nodeKey: 'entry', successorKey: 'missing' }])
    expect(invalid.unreachableNodeKeys).toContain('orphan')
    expect(invalid.errors.join(';')).toContain('缺少结局')

    const cycle = validateNarrativeContentGraph({
      entryNodeKey: 'a',
      nodes: nodes([
        { key: 'a', kind: 'entry' },
        { key: 'b', kind: 'scene' },
        { key: 'end', kind: 'ending' },
      ]),
      beats: [],
      choices: [
        { choiceKey: 'a-b', sourceNodeKey: 'a', text: 'B', description: '', unavailableReason: '', targetNodeKey: 'b', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
        { choiceKey: 'b-a', sourceNodeKey: 'b', text: 'A', description: '', unavailableReason: '', targetNodeKey: 'a', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 0 },
        { choiceKey: 'bad', sourceNodeKey: 'a', text: '坏目标', description: '', unavailableReason: '', targetNodeKey: 'missing', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: [], order: 1 },
      ],
    })
    expect(cycle.valid).toBe(false)
    expect(cycle.invalidChoiceTargets).toEqual([{ choiceKey: 'bad', targetNodeKey: 'missing' }])
    expect(cycle.blockingCycleKeys.length).toBe(1)
    expect(cycle.reachableEndingKeys).toEqual([])
  })

  it('删除草稿定义不破坏发布，严格导出导入重映射完整引用链', async () => {
    const ownership = await createWorkspace('生命周期')
    const module = await createNarrativeModule({ scope: ownership.scope, owner: 'work', kind: 'main', title: '短篇' })
    await addNarrativeNode({ scope: ownership.scope, moduleId: module.id!, key: 'entry', kind: 'entry', title: '入口' })
    await addNarrativeNode({ scope: ownership.scope, moduleId: module.id!, key: 'end', kind: 'ending', title: '结局' })
    await addNarrativeChoice({ scope: ownership.scope, moduleId: module.id!, sourceNodeKey: 'entry', choiceKey: 'finish', text: '结束', targetNodeKey: 'end' })
    const definition = await createGameDefinition({ scope: ownership.scope, gameKey: 'short', title: '短篇', narrativeModuleId: module.id! })
    const revision = await createWorldRevision({ scope: ownership.scope, label: '短篇冻结' })
    const worldRelease = await publishWorldRevision(revision.id!)
    const gameRelease = await publishGameDefinition({ scope: ownership.scope, gameDefinitionId: definition.id!, worldReleaseId: worldRelease.id! })
    const session = await createStoryGameInstance({ scope: ownership.scope, gameReleaseId: gameRelease.id!, title: '存档' })

    const backup = await exportProjectJSON(ownership.scope.projectId)
    expect(backup.gameDefinitions).toHaveLength(1)
    expect(backup.gameReleases).toHaveLength(1)
    expect(backup.narrativeChoices).toHaveLength(1)
    expect(backup.simulationSessions?.[0]._gameReleaseExportId).toBe(backup.gameReleases?.[0]._exportId)
    const importedProjectId = await importProjectJSON(backup)
    const importedOwnership = await ensureWorkspaceOwnership(importedProjectId)
    const importedDefinition = await db.gameDefinitions.where('projectId').equals(importedProjectId).first()
    const importedRelease = await db.gameReleases.where('projectId').equals(importedProjectId).first()
    const importedSession = await db.simulationSessions.where('projectId').equals(importedProjectId).first()
    expect(importedDefinition).toMatchObject({ worldId: importedOwnership.scope.worldId, workId: importedOwnership.scope.workId })
    expect(importedRelease).toMatchObject({
      gameDefinitionId: importedDefinition?.id,
      worldId: importedOwnership.scope.worldId,
      workId: importedOwnership.scope.workId,
      contentHash: gameRelease.contentHash,
    })
    expect(importedSession?.gameReleaseId).toBe(importedRelease?.id)
    expect(await assertInstanceBinding(importedSession!.id!, importedOwnership.scope)).toMatchObject({
      gameReleaseId: importedRelease?.id,
    })
    expect(await readSimulationState(importedSession!.id!)).toMatchObject({
      narrative: { contentHash: gameRelease.contentHash },
    })

    await db.simulationSessions.update(importedSession!.id!, { gameReleaseId: null })
    await expect(assertInstanceBinding(importedSession!.id!, importedOwnership.scope)).rejects.toThrow('完整项目备份恢复')
    await db.simulationSessions.update(importedSession!.id!, { gameReleaseId: importedRelease!.id! })

    const frozenManifest = gameRelease.manifestJson
    await db.gameReleases.update(gameRelease.id!, { manifestJson: frozenManifest.replace('短篇', '被篡改') })
    await expect(assertGameReleaseUnchanged(gameRelease.id!)).rejects.toThrow('已被篡改')
    await db.gameReleases.update(gameRelease.id!, { manifestJson: frozenManifest })

    await deleteGameDefinition({ scope: ownership.scope, gameDefinitionId: definition.id! })
    expect(await db.gameDefinitions.get(definition.id!)).toBeUndefined()
    expect(await db.gameReleases.get(gameRelease.id!)).toMatchObject({ gameDefinitionId: null })
    await expect(assertGameReleaseUnchanged(gameRelease.id!)).resolves.toMatchObject({ id: gameRelease.id })
    expect(await readSimulationState(session.id!)).toMatchObject({ narrative: { contentHash: gameRelease.contentHash } })
  })
})
