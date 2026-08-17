import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  deleteTextOpenWorldGameDraft,
  publishTextOpenWorldGame,
  seedTextOpenWorldAcceptanceGame,
} from '../../src/lib/open-world/authoring'
import {
  appendSimulationEvent,
  branchSimulationSession,
  commitAdventureAction,
  commitOpenWorldCommand,
  readSimulationState,
  readSimulationStateVersion,
} from '../../src/lib/simulation/runtime'
import { parseTextOpenWorldGameReleaseManifest } from '../../src/lib/text-game/releases'
import { createTextOpenWorldInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

describe('TEXTWORLD-1 · publish, replay and registry lifecycle', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it.sequential('发布冻结、命令幂等、共享任务状态、导入重映射和草稿删除保持完整', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({ name: 'TEXTWORLD 生命周期', genre: 'open-world', genres: ['open-world'], status: 'drafting', description: '', targetWordCount: 1, createdAt: now, updatedAt: now } as any) as number
    const owned = await ensureWorkspaceOwnership(projectId)
    const definition = await seedTextOpenWorldAcceptanceGame({ scope: owned.scope })
    const publication = await publishTextOpenWorldGame({ scope: owned.scope, gameDefinitionId: definition.id! })
    const manifest = parseTextOpenWorldGameReleaseManifest(publication.gameRelease.manifestJson)
    expect(manifest).toMatchObject({ productType: 'text-open-world' })
    expect(manifest.openWorld.regions).toHaveLength(5)
    const session = await createTextOpenWorldInstance({ scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title: '五区验收存档', seed: 'lifecycle-seed' })

    let base = await readSimulationStateVersion(session.id!)
    const drawInput = { sessionId: session.id!, command: { kind: 'draw' as const, trigger: 'observe' as const }, commandId: 'world-draw-1', baseSequence: base.sequence, baseStateHash: base.stateHash }
    const draw = await commitOpenWorldCommand(drawInput)
    const repeated = await commitOpenWorldCommand(drawInput)
    expect(repeated.events.map(event => event.sequence)).toEqual(draw.events.map(event => event.sequence))
    await expect(appendSimulationEvent({
      sessionId: session.id!,
      type: 'world.quest-card.dealt',
      payload: { sourceKey: 'forged' },
    })).rejects.toThrow('专用命令')
    await expect(commitOpenWorldCommand({
      sessionId: session.id!,
      command: { kind: 'tick' },
      commandId: 'world-stale-1',
      baseSequence: drawInput.baseSequence,
      baseStateHash: drawInput.baseStateHash,
    })).rejects.toThrow('已变化')
    await expect(commitOpenWorldCommand({
      sessionId: session.id!,
      command: { kind: 'tick' },
      commandId: drawInput.commandId,
      baseSequence: drawInput.baseSequence,
      baseStateHash: drawInput.baseStateHash,
    })).rejects.toThrow('不同命令')
    let state = await readSimulationState(session.id!)
    const instance = state.openWorld?.questInstances.find(item => item.status === 'revealed')
    expect(instance).toBeTruthy()

    base = await readSimulationStateVersion(session.id!)
    await commitOpenWorldCommand({ sessionId: session.id!, command: { kind: 'quest-decision', instanceKey: instance!.instanceKey, decision: 'accept' }, commandId: 'world-accept-1', baseSequence: base.sequence, baseStateHash: base.stateHash })
    state = await readSimulationState(session.id!)
    expect(state.openWorld?.questInstances.find(item => item.instanceKey === instance!.instanceKey)?.status).toBe('active')
    expect(state.adventure?.quests.find(item => item.questKey === instance!.questKey)?.status).toBe('active')

    base = await readSimulationStateVersion(session.id!)
    await expect(commitAdventureAction({
      sessionId: session.id!,
      actionKey: 'move.1',
      commandId: 'world-illegal-move-1',
      baseSequence: base.sequence,
      baseStateHash: base.stateHash,
    })).rejects.toThrow('区域移动只能通过开放世界交通命令')

    base = await readSimulationStateVersion(session.id!)
    await commitAdventureAction({ sessionId: session.id!, actionKey: `resolve.${instance!.questKey}`, commandId: 'world-resolve-1', baseSequence: base.sequence, baseStateHash: base.stateHash })
    state = await readSimulationState(session.id!)
    expect(state.openWorld?.questInstances.find(item => item.instanceKey === instance!.instanceKey)?.status).toBe('resolved')
    expect(state.adventure?.quests.find(item => item.questKey === instance!.questKey)?.status).toBe('completed')

    base = await readSimulationStateVersion(session.id!)
    const longCommandId = `long.${'a'.repeat(195)}`
    const longCommand = await commitOpenWorldCommand({
      sessionId: session.id!,
      command: { kind: 'tick' },
      commandId: longCommandId,
      baseSequence: base.sequence,
      baseStateHash: base.stateHash,
    })
    expect(longCommand.checkpoint.name.length).toBeLessThanOrEqual(200)
    expect((await commitOpenWorldCommand({
      sessionId: session.id!,
      command: { kind: 'tick' },
      commandId: longCommandId,
      baseSequence: base.sequence,
      baseStateHash: base.stateHash,
    })).checkpoint.id).toBe(longCommand.checkpoint.id)
    state = await readSimulationState(session.id!)

    const exported = await exportProjectJSON(projectId)
    expect(exported.openWorldModules).toHaveLength(1)
    expect(exported.openWorldModules?.[0]).toMatchObject({ _gameDefinitionExportId: expect.any(Number), _workExportId: expect.any(Number) })
    const importedId = await importProjectJSON(exported)
    const importedDefinition = await db.gameDefinitions.where('projectId').equals(importedId).filter(item => item.productType === 'text-open-world').first()
    const importedModule = await db.openWorldModules.where('projectId').equals(importedId).first()
    expect(importedModule).toMatchObject({ gameDefinitionId: importedDefinition?.id, workId: importedDefinition?.workId })
    expect(await db.simulationSessions.where('projectId').equals(importedId).filter(item => item.kind === 'textworld').count()).toBe(1)

    const branch = await branchSimulationSession({
      parentSessionId: session.id!,
      throughSequence: state.lastSequence,
      title: '五区验收分支',
    })
    const branchState = await readSimulationState(branch.id!)
    expect(branch).toMatchObject({ parentSessionId: session.id, parentThroughSequence: state.lastSequence })
    expect(branchState.openWorld?.questInstances.find(item => item.instanceKey === instance!.instanceKey)?.status).toBe('resolved')
    expect(branchState.lastSequence).toBe(0)

    await deleteTextOpenWorldGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    expect(await db.openWorldModules.where('gameDefinitionId').equals(definition.id!).count()).toBe(0)
    expect(await db.adventureModules.where('gameDefinitionId').equals(definition.id!).count()).toBe(0)
    expect(await db.narrativeSimulationModules.where('gameDefinitionId').equals(definition.id!).count()).toBe(0)
    expect(await db.gameReleases.get(publication.gameRelease.id!)).toMatchObject({ gameDefinitionId: null })
    expect(await db.simulationSessions.get(session.id!)).toMatchObject({ kind: 'textworld', gameReleaseId: publication.gameRelease.id })
  }, 90_000)
})
