import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  deleteAdventureGameDraft,
  publishAdventureGameDraft,
  seedAdventureAcceptanceGame,
} from '../../src/lib/adventure/authoring'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { commitAdventureAction, readSimulationState, readSimulationStateVersion } from '../../src/lib/simulation/runtime'
import { createTextAdventureInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

describe('TEXTADV-1 · portable lifecycle', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('注册表派生导入导出并重映射 adventureModules，删草稿保留不可变发布', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'TEXTADV 生命周期', genre: 'adventure', genres: ['adventure'], status: 'drafting',
      description: '文字冒险生命周期', targetWordCount: 30_000, createdAt: now, updatedAt: now,
    } as any) as number
    const owned = await ensureWorkspaceOwnership(projectId)
    const definition = await seedAdventureAcceptanceGame({ scope: owned.scope, title: '生命周期' })
    const publication = await publishAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    const session = await createTextAdventureInstance({
      scope: owned.scope, gameReleaseId: publication.gameRelease.id!, title: '待导出冒险', seed: 'portable-adventure-seed',
    })
    for (const [actionKey, commandId] of [['take.rope', 'portable.take-rope'], ['inspect.notice', 'portable.quest']] as const) {
      const base = await readSimulationStateVersion(session.id!)
      await commitAdventureAction({ sessionId: session.id!, actionKey, commandId, baseSequence: base.sequence, baseStateHash: base.stateHash })
    }
    const before = await readSimulationState(session.id!)
    const exported = await exportProjectJSON(owned.project.id!)
    expect(exported.adventureModules).toHaveLength(1)
    expect(exported.adventureModules[0]).toMatchObject({ _gameDefinitionExportId: 0 })
    const importedId = await importProjectJSON(exported)
    const imported = await db.adventureModules.where('projectId').equals(importedId).first()
    expect(JSON.parse(imported!.contentJson).locations).toHaveLength(6)
    const importedDefinition = await db.gameDefinitions.where('projectId').equals(importedId).first()
    expect(imported!.gameDefinitionId).toBe(importedDefinition!.id)
    const importedSession = await db.simulationSessions.where('projectId').equals(importedId)
      .filter(item => item.kind === 'textadventure').first()
    expect(importedSession).toMatchObject({ seed: 'portable-adventure-seed', gameReleaseId: expect.any(Number) })
    const after = await readSimulationState(importedSession!.id!)
    expect(after.adventure?.inventory).toEqual(before.adventure?.inventory)
    expect(after.adventure?.quests).toEqual(before.adventure?.quests)
    expect(after.adventure?.actionHistory).toEqual(before.adventure?.actionHistory)

    await deleteAdventureGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    expect(await db.adventureModules.where('gameDefinitionId').equals(definition.id!).count()).toBe(0)
    expect(await db.gameReleases.get(publication.gameRelease.id!)).toMatchObject({ gameDefinitionId: null })
  }, 30_000)
})
