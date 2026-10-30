import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { readProductRuntimeState, verifyFormalRuntimeSourceV1 } from '../../src/lib/product/runtime-core'
import { validateTextOpenWorldSourcePinBundleV1 } from '../../src/lib/open-world/source-pin'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { textOpenWorldCreatorLocatorFromBriefRowV1 } from '../../src/lib/open-world/creator-brief-persistence'
import { seedQuality005LegacyNovelV1, snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'

describe('SFQA-005 · old bytes are readable evidence without new authorization', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('exports and imports the strictly valid old Pin/Release/Session without replacing the novel owner or authorizing work', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const before = await snapshotQuality005RowsV1()
    const backup = await exportProjectJSON(f.scope.projectId)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    const importedProjectId = await importProjectJSON(backup)
    expect(importedProjectId).not.toBe(f.scope.projectId)
    const importedRelease = (await db.productReleases.where('projectId').equals(importedProjectId).first())!
    expect(importedRelease.manifestJson).toBe((await db.productReleases.get(f.releaseId))!.manifestJson)
    expect(importedRelease.contentHash).toBe((await db.productReleases.get(f.releaseId))!.contentHash)
    const originalSession = (await db.productRuntimeSessions.get(f.receiptSessionId))!
    const importedSession = (await db.productRuntimeSessions.where('projectId').equals(importedProjectId).toArray())
      .find(session => session.title === originalSession.title)!
    const frozen = await verifyFormalRuntimeSourceV1(importedSession, ['text-open-world'])
    expect(frozen.runtimePackage.textOpenWorldVNext?.sourceManifest.kind).toBe('novel-source-pin')
    expect((await readProductRuntimeState(importedSession.id!)).lastSequence).toBe(f.receipt.eventSequence)
    const originalWork = (await db.works.get(f.scope.workId))!
    expect(originalWork).toEqual(f.rows.works.find(row => (row as { id?: number }).id === originalWork.id))
    expect(await db.productBuilds.where('projectId').equals(importedProjectId).count()).toBe(1)
    expect((await db.productProductions.where('projectId').equals(importedProjectId).first())?.creatorSourceKind).toBe('novel')
  }, 30_000)

  it.each(['pinHash', 'unitText'] as const)('still rejects damaged legacy %s rather than weakening the frozen codec', async field => {
    const f = await seedQuality005LegacyNovelV1()
    const bundle = structuredClone(f.pinBundle)
    if (field === 'pinHash') bundle.pin.pinHash = '0'.repeat(64)
    else bundle.units[0].payload.contentText = `${bundle.units[0].payload.contentText ?? ''} forged`
    const before = await snapshotQuality005RowsV1()
    await expect(validateTextOpenWorldSourcePinBundleV1(bundle)).rejects.toThrow()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('returns a real terminal command receipt even if its old Build is missing, and never recreates the Build', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const row = (await db.productProductionBriefs.toArray())[0]
    const old = (await db.productProductionCommands.toArray()).find(command => command.type === 'authorize-text-open-world-creator-start')!
    const sessionKey = f.creator.productionKey.slice('text-open-world.'.length, -17)
    await db.productBuilds.delete(f.creator.buildId)
    const before = await snapshotQuality005RowsV1()
    await expect(executeProductProductionCommand({ scope: f.scope, productionId: f.creator.productionId, command: {
      type: 'authorize-text-open-world-creator-start', commandId: old.commandId,
      expectedStateRevision: old.expectedStateRevision!, briefRevision: row.revision, briefHash: row.briefHash,
      sourceLocator: textOpenWorldCreatorLocatorFromBriefRowV1(row), preflight: f.creator.start.preflight,
      confirmation: f.creator.start.confirmation, rightsBasis: f.creator.start.rightsBasis, rightsNote: f.creator.start.rightsNote,
      authorizationNonce: `source-pin-${sessionKey}`, expectedPlanHash: f.creator.start.productionPlanHash,
      authorizedAt: f.creator.start.authorizedAt,
    } })).resolves.toMatchObject({ ok: true, replayed: true, result: { buildId: f.creator.buildId } })
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    expect(await db.productBuilds.count()).toBe(0)
  })
})
