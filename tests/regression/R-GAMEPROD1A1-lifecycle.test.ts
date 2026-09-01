import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { seedFullProject } from '../helpers/seed-full-project'

describe('GAMEPROD-1A1 · six-table production lifecycle', () => {
  beforeAll(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('strict backup round-trips all refs and verified shared media, then project deletion removes the closure', async () => {
    const source = await seedFullProject()
    const exported = await exportProjectJSON(source.projectId) as any

    expect(exported.gameProductions).toHaveLength(1)
    expect(exported.gameProductionBriefs).toHaveLength(1)
    expect(exported.gameProductionCommands).toHaveLength(1)
    expect(exported.gameBuilds).toHaveLength(1)
    expect(exported.gameBuildArtifacts).toHaveLength(1)
    expect(exported.mediaBlobObjects[0].data).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(exported.mediaBlobObjects[0].leaseOwner).toBeNull()

    const importedProjectId = await importProjectJSON(exported)
    const production = await db.gameProductions.where('projectId').equals(importedProjectId).first()
    const brief = await db.gameProductionBriefs.where('projectId').equals(importedProjectId).first()
    const command = await db.gameProductionCommands.where('projectId').equals(importedProjectId).first()
    const build = await db.gameBuilds.where('projectId').equals(importedProjectId).first()
    const artifact = await db.gameBuildArtifacts.where('projectId').equals(importedProjectId).first()
    const media = await db.mediaBlobObjects.where('projectId').equals(importedProjectId).first()
    const run = build?.id == null
      ? undefined
      : await db.agentRuns.where('gameBuildId').equals(build.id).first()
    const productBlob = await db.productMediaBlobs.where('projectId').equals(importedProjectId).first()

    expect(brief?.productionId).toBe(production?.id)
    expect(command?.productionId).toBe(production?.id)
    expect(build?.productionId).toBe(production?.id)
    expect(artifact).toMatchObject({ buildId: build?.id, producerRunId: run?.id, blobObjectId: media?.id })
    expect(run?.gameBuildId).toBe(build?.id)
    expect(productBlob?.blobObjectId).toBe(media?.id)
    expect(media).toMatchObject({ backend: 'indexeddb', storageState: 'ready', opfsPath: null, leaseOwner: null })
    expect(media?.data).toBeInstanceOf(ArrayBuffer)

    await cascadeDeleteProject(importedProjectId)
    for (const table of [
      db.gameProductions, db.gameProductionBriefs, db.gameProductionCommands,
      db.gameBuilds, db.gameBuildArtifacts, db.productMediaAssets, db.productMediaBlobs,
      db.mediaBlobObjects,
    ]) expect(await table.where('projectId').equals(importedProjectId).count()).toBe(0)
  }, 40_000)

  it('rejects a tampered shared media object and rolls back the whole import', async () => {
    const source = await seedFullProject()
    const exported = await exportProjectJSON(source.projectId) as any
    const portable: string = exported.mediaBlobObjects[0].data
    const [prefix, body] = portable.split(',')
    exported.mediaBlobObjects[0].data = `${prefix},${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}`
    const projectCount = await db.projects.count()

    await expect(importProjectJSON(exported)).rejects.toThrow('二进制哈希')
    expect(await db.projects.count()).toBe(projectCount)
  }, 40_000)
})
