import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { seedFullProject } from '../helpers/seed-full-project'

describe('PRODUCTPROD-1A1 · six-table production lifecycle', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('strict backup round-trips all refs and verified shared media, then project deletion removes the closure', async () => {
    const source = await seedFullProject()
    const exported = await exportProjectJSON(source.projectId) as any

    const exportedProduction = exported.productProductions
      .find((row: any) => row.productionKey === 'full-fixture-production')
    const exportedBriefs = exported.productProductionBriefs
      .filter((row: any) => row._productionExportId === exportedProduction._exportId)
    const exportedCommands = exported.productProductionCommands
      .filter((row: any) => row._productionExportId === exportedProduction._exportId)
    const exportedBuilds = exported.productBuilds
      .filter((row: any) => row._productionExportId === exportedProduction._exportId)
    const exportedArtifacts = exported.productBuildArtifacts
      .filter((row: any) => row._buildExportId === exportedBuilds[0]._exportId)
    const exportedMedia = exported.mediaBlobObjects
      .find((row: any) => row._exportId === exportedArtifacts[0]._blobObjectExportId)

    expect(exportedProduction).toBeTruthy()
    expect(exportedBriefs).toHaveLength(1)
    expect(exportedCommands).toHaveLength(1)
    expect(exportedBuilds).toHaveLength(1)
    expect(exportedArtifacts).toHaveLength(1)
    expect(exportedMedia.data).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(exportedMedia.leaseOwner).toBeNull()

    const importedProjectId = await importProjectJSON(exported)
    const production = await db.productProductions.where('projectId').equals(importedProjectId)
      .filter(row => row.productionKey === 'full-fixture-production').first()
    const brief = await db.productProductionBriefs.where('productionId').equals(production!.id!).first()
    const command = await db.productProductionCommands.where('productionId').equals(production!.id!).first()
    const build = await db.productBuilds.where('productionId').equals(production!.id!).first()
    const artifact = await db.productBuildArtifacts.where('buildId').equals(build!.id!).first()
    const media = await db.mediaBlobObjects.get(artifact!.blobObjectId!)
    const run = build?.id == null
      ? undefined
      : await db.agentRuns.where('productBuildId').equals(build.id).first()
    const productBlob = await db.productMediaBlobs.where('blobObjectId').equals(media!.id!).first()

    expect(brief?.productionId).toBe(production?.id)
    expect(command?.productionId).toBe(production?.id)
    expect(build?.productionId).toBe(production?.id)
    expect(artifact).toMatchObject({ buildId: build?.id, producerRunId: run?.id, blobObjectId: media?.id })
    expect(run?.productBuildId).toBe(build?.id)
    expect(productBlob?.blobObjectId).toBe(media?.id)
    expect(media).toMatchObject({ backend: 'indexeddb', storageState: 'ready', opfsPath: null, leaseOwner: null })
    expect(media?.data).toBeInstanceOf(ArrayBuffer)

    await cascadeDeleteProject(importedProjectId)
    for (const table of [
      db.productProductions, db.productProductionBriefs, db.productProductionCommands,
      db.productBuilds, db.productBuildArtifacts, db.productMediaAssets, db.productMediaBlobs,
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
