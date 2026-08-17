import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  deleteNarrativeSimulationGameDraft,
  publishNarrativeSimulationGame,
  saveNarrativeSimulationContent,
  seedNarrativeSimulationAcceptanceGame,
} from '../../src/lib/narrative-simulation/authoring'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { parseNarrativeSimulationGameReleaseManifest } from '../../src/lib/text-game/releases'
import { createNarrativeSimulationInstance } from '../../src/lib/world-engine/instances'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'

describe('TEXTSIM-1 · registry lifecycle', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it.sequential('草稿、发布与存档严格导出导入并重映射，删草稿保留不可变发布和存档', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: 'TEXTSIM 生命周期', genre: 'simulation', genres: ['simulation'], status: 'drafting',
      description: '', targetWordCount: 1, createdAt: now, updatedAt: now,
    } as any) as number
    const owned = await ensureWorkspaceOwnership(projectId)
    const definition = await seedNarrativeSimulationAcceptanceGame({ scope: owned.scope })
    const publication = await publishNarrativeSimulationGame({ scope: owned.scope, gameDefinitionId: definition.id! })
    const session = await createNarrativeSimulationInstance({
      scope: owned.scope,
      gameReleaseId: publication.gameRelease.id!,
      title: '生命周期存档',
    })
    const originalHash = publication.gameRelease.contentHash
    const draft = await db.narrativeSimulationModules.where('gameDefinitionId').equals(definition.id!).first()
    const content = JSON.parse(draft!.contentJson)
    content.themes[0].title = '修改后的历史题材'
    await saveNarrativeSimulationContent({ scope: owned.scope, gameDefinitionId: definition.id!, content })
    expect((await db.gameReleases.get(publication.gameRelease.id!))?.contentHash).toBe(originalHash)
    expect(parseNarrativeSimulationGameReleaseManifest(publication.gameRelease.manifestJson).simulation.themes[0].title)
      .toBe('历史城镇')

    const exported = await exportProjectJSON(projectId)
    expect(exported.narrativeSimulationModules).toHaveLength(1)
    expect(exported.narrativeSimulationModules?.[0]).toMatchObject({
      _gameDefinitionExportId: expect.any(Number),
      _workExportId: expect.any(Number),
    })
    const importedId = await importProjectJSON(exported)
    const importedDefinition = await db.gameDefinitions.where('projectId').equals(importedId)
      .filter(row => row.productType === 'narrative-simulation').first()
    const importedModule = await db.narrativeSimulationModules.where('projectId').equals(importedId).first()
    expect(importedModule?.gameDefinitionId).toBe(importedDefinition?.id)
    expect(importedModule?.workId).toBe(importedDefinition?.workId)
    expect(await db.simulationSessions.where('projectId').equals(importedId)
      .filter(row => row.kind === 'textsimulation').count()).toBe(1)

    await deleteNarrativeSimulationGameDraft({ scope: owned.scope, gameDefinitionId: definition.id! })
    expect(await db.narrativeSimulationModules.where('gameDefinitionId').equals(definition.id!).count()).toBe(0)
    expect(await db.gameDefinitions.get(definition.id!)).toBeUndefined()
    expect(await db.gameReleases.get(publication.gameRelease.id!)).toMatchObject({ gameDefinitionId: null })
    expect(await db.simulationSessions.get(session.id!)).toMatchObject({
      gameReleaseId: publication.gameRelease.id,
      kind: 'textsimulation',
    })
  }, 60_000)
})
