import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { inspectProjectBackup } from '../../src/lib/export/backup-trust'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { inspectCommunityWorldOriginV1 } from '../../src/lib/world-engine/source-declaration'
import type { CommunityWorldOrigin } from '../../src/lib/types/world-sharing'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createSfqa021WorldSharingCarrierV1 as fixture } from '../helpers/sfqa021-world-sharing-carrier'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())


describe('SFQA021 F1 · real registered World backup carrier', () => {
  it.each([3, 4, 5] as const)('v%i declaration survives same-DB and fresh-DB backup without local locators or altered original package', async version => {
    const f = await fixture(version), packetBytes = JSON.stringify(f.pkg), originalRelease = f.release.manifestJson
    const backup = await exportProjectJSON(f.target.scope.projectId)
    const carrier = backup.worlds.find(row => row.code === f.target.world.code)
    expect(carrier?.communityOrigin).toEqual(f.origin)
    expect(inspectProjectBackup(backup).errors).toEqual([])
    expect(carrier?.communityOrigin).not.toHaveProperty('worldId')
    expect(carrier?.communityOrigin).not.toHaveProperty('localReleaseRecordId')
    const otherBefore = await exportProjectJSON(f.source.scope.projectId)
    const restored = await importProjectJSON(backup)
    const same = (await db.worlds.where('projectId').equals(restored).toArray())[0]
    expect(same.id).not.toBe(f.target.scope.worldId); expect(same.communityOrigin).toEqual(f.origin)
    expect({ ...await exportProjectJSON(f.source.scope.projectId), exportedAt: 0 }).toEqual({ ...otherBefore, exportedAt: 0 })
    expect((await db.worldReleases.get(f.release.id!))?.manifestJson).toBe(originalRelease)
    expect(JSON.stringify(f.pkg)).toBe(packetBytes)
    await db.delete(); await db.open()
    const fresh = await importProjectJSON(backup)
    const freshWorld = (await db.worlds.where('projectId').equals(fresh).toArray())[0]
    expect(freshWorld.communityOrigin).toEqual(f.origin)
    expect(inspectCommunityWorldOriginV1(freshWorld.communityOrigin).status).toBe('self-consistent')
    expect(JSON.stringify(f.pkg)).toBe(packetBytes)
    expect(await db.agentRuns.count()).toBe(0)
  })

  it.each(['attribution', 'wire-digest', 'local-id', 'version', 'uses'] as const)('corrupt new %s is refused at both actual import boundaries without changing any table', async kind => {
    const f = await fixture(3), backup = await exportProjectJSON(f.target.scope.projectId)
    const origin = backup.worlds[0].communityOrigin
    if (!origin) throw new Error('Missing actual registered World declaration')
    if (kind === 'attribution') Reflect.set(origin, 'attribution', '被替换的署名')
    if (kind === 'wire-digest') Reflect.set(origin, 'packageDigest', 'c'.repeat(64))
    if (kind === 'local-id') Reflect.set(origin, 'localReleaseRecordId', 123)
    if (kind === 'version') Reflect.set(origin, 'version', 2)
    if (kind === 'uses') Reflect.set(origin, 'allowedUses', { ttrpg: true })
    const unchangedInput = structuredClone(backup)
    const counts = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    const before = await db.worlds.get(f.target.scope.worldId)
    expect(inspectProjectBackup(backup).errors.join('；')).toContain('communityOrigin')
    await expect(importProjectJSON(backup)).rejects.toThrow('communityOrigin')
    await expect(deriveImportProjectJSON(backup)).rejects.toThrow('communityOrigin')
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(counts)
    expect(await db.worlds.get(f.target.scope.worldId)).toEqual(before)
    expect(backup).toEqual(unchangedInput)
  })

  it('preserves a real legacy six-field origin across backup as unknown instead of manufacturing allowed uses', async () => {
    const source = await seedCurrentWorkspace('旧来源载体', { purpose: 'world-engine' })
    const legacy: CommunityWorldOrigin = { packageId: 'old@v1', sourceWorldCode: 'old', sourceWorldVersion: 1,
      authorName: '  旧作者  ', license: 'CC-BY-4.0', importedAt: 42 }
    await db.worlds.update(source.scope.worldId, { communityOrigin: legacy })
    const backup = await exportProjectJSON(source.scope.projectId)
    expect(inspectProjectBackup(backup).valid).toBe(true)
    const restored = await importProjectJSON(backup)
    const world = (await db.worlds.where('projectId').equals(restored).toArray())[0]
    expect(world.communityOrigin).toEqual(legacy)
    expect(world.communityOrigin).not.toHaveProperty('allowedUses')
    expect(inspectCommunityWorldOriginV1(world.communityOrigin)).toEqual({ status: 'unknown', declaration: null, errors: [] })
  })
})
