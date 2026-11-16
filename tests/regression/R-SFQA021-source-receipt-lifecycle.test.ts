import { Blob as NodeBlob } from 'node:buffer'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, StoryForgeDB, STORYFORGE_STORES_V13, STORYFORGE_STORES_V12, STORYFORGE_STORES } from '../../src/lib/db/schema'
import { REQUIRED_TABLES, openCurrentSchema } from '../../src/lib/db/ensure-schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { inspectProjectBackup, normalizeProjectBackup } from '../../src/lib/export/backup-trust'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deriveImportProjectJSON } from '../../src/lib/export/registry-import'
import { captureWorldSourceWireV1, createWorldPackage, importWorldPackage } from '../../src/lib/world-engine/world-package'
import { encodeWorldSourceDeclarationV1 } from '../../src/lib/world-engine/source-declaration'
import { copyWorldSourceReceiptV1, exportOriginalWorldSourceWireV1, installCapturedWorldSourceInTransactionV1, installWorldSourcePackageV1, readWorldSourceReceiptV1, resolveWorldEditingSourceV1 } from '../../src/lib/world-engine/source-receipt'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'
import { cascadeDeleteProject, transactionTablesFor } from '../../src/lib/registry/lifecycle'
import { cascadeRegisteredReferences, deleteWorld } from '../../src/lib/workspace/lifecycle'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace, currentWorkFixtureRecordV1 } from '../helpers/current-workspace'
import { generateWorldCode } from '../../src/lib/workspace/identity'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { createSfqa021WorldSharingCarrierV1 as fixture } from '../helpers/sfqa021-world-sharing-carrier'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe('SFQA021 F2 · registered receipt lifecycle foundation', () => {
  it.each([
    { label: 'v13', version: 13, stores: STORYFORGE_STORES_V13 },
    { label: 'TTRPG v12', version: 12, stores: Object.fromEntries(Object.entries(STORYFORGE_STORES_V12).filter(([name]) => name !== 'worldNarrativeIndexCaches')) },
    { label: 'World v12', version: 12, stores: Object.fromEntries(Object.entries(STORYFORGE_STORES_V12).filter(([name]) => name !== 'ttrpgNarrativeMemories')) },
  ])('upgrades real $label without changing author rows or fabricating receipts', async ({ version, stores }) => {
    const f = await fixture(3), name = 'sfqa021-v13-' + crypto.randomUUID()
    const project = await db.projects.get(f.source.scope.projectId)
    const world = await db.worlds.get(f.source.scope.worldId)
    const work = await db.works.get(f.source.scope.workId)
    if (!project || !world || !work) throw Error('Missing seeded v13 owner rows')
    expect(STORYFORGE_STORES_V13).not.toHaveProperty('worldSourceReceipts')
    const old = new Dexie(name)
    old.version(version).stores(stores)
    await old.open()
    await old.table('projects').put(project)
    await old.table('worlds').put(world)
    await old.table('works').put(work)
    old.close()
    const upgraded = new StoryForgeDB(name)
    try {
      await upgraded.open()
      expect(upgraded.verno).toBe(14)
      expect(await upgraded.projects.get(f.source.scope.projectId)).toEqual(project)
      expect(await upgraded.worlds.get(f.source.scope.worldId)).toEqual(world)
      expect(await upgraded.works.get(f.source.scope.workId)).toEqual(work)
      expect(await upgraded.worldSourceReceipts.count()).toBe(0)
      expect(upgraded.tables.map(table => table.name).sort()).toEqual([...REQUIRED_TABLES].sort())
    } finally { await upgraded.delete() }
  })

  it('converts supported v17 only by adding an empty receipt collection, keeping old full origin opaque', async () => {
    const f = await fixture(3), current = await exportProjectJSON(f.target.scope.projectId)
    expect(current.version).toBe(18)
    const legacy = structuredClone(current)
    legacy.version = 17
    Reflect.deleteProperty(legacy, 'worldSourceReceipts')
    const original = JSON.stringify(legacy), converted = normalizeProjectBackup(legacy)
    expect(converted.version).toBe(18)
    expect(converted.worldSourceReceipts).toEqual([])
    expect(converted.worlds).toEqual(legacy.worlds)
    expect(JSON.stringify(legacy)).toBe(original)
    const id = await importProjectJSON(legacy)
    expect((await db.worlds.where('projectId').equals(id).first())?.communityOrigin).toEqual(f.origin)
    expect(await db.worldSourceReceipts.where('projectId').equals(id).count()).toBe(0)
  })

  it('requires the new collection in v18 and forbids smuggling it into v17', async () => {
    const f = await fixture(3), backup = await exportProjectJSON(f.target.scope.projectId)
    const missing = structuredClone(backup)
    Reflect.deleteProperty(missing, 'worldSourceReceipts')
    expect(inspectProjectBackup(missing).missingTables).toContain('worldSourceReceipts')
    const smuggled = { ...backup, version: 17 }
    expect(inspectProjectBackup(smuggled).errors.join(' ')).toContain('worldSourceReceipts')
    const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    await expect(importProjectJSON(missing)).rejects.toThrow()
    await expect(importProjectJSON(smuggled)).rejects.toThrow()
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
  })
})

describe('SFQA021 F2 · real wire/owner/binding round trips', () => {
  it.each([3, 4, 5] as const)('keeps v%i original wire and selected D through same-DB/fresh-DB restore', async version => {
    const f = await fixture(version), target = await seedCurrentWorkspace('原 wire 往返')
    const wire = JSON.stringify(f.pkg, null, 2) + '\n'
    const stored = await installWorldSourcePackageV1(target.scope, wire)
    const backup = await exportProjectJSON(target.scope.projectId)
    const restoredId = await importProjectJSON(backup), restored = await resolveWorkspaceScope(restoredId)
    const same = await readWorldSourceReceiptV1(restored, stored.declarationHash)
    expect(same.row.id).not.toBe(stored.receiptId)
    expect(same.row.worldReleaseId).not.toBe(stored.worldReleaseId)
    expect(same.row.wireJson).toBe(wire)
    expect(await exportOriginalWorldSourceWireV1(restored, stored.declarationHash)).toBe(wire)
    expect((await db.worlds.get(restored.worldId))?.communityOrigin).toBeUndefined()
    await db.delete(); await db.open()
    const freshId = await importProjectJSON(backup), fresh = await resolveWorkspaceScope(freshId)
    const again = await readWorldSourceReceiptV1(fresh, stored.declarationHash)
    expect(again.row.wireJson).toBe(wire)
    expect(again.captured.declaration.allowedUses).toEqual(f.pkg.manifest.allowedUses)
    expect(again.captured.declaration.attribution).toBe(f.pkg.manifest.attribution)
    expect(await db.projects.count()).toBe(1)
  })

  it.each(['wire', 'P', 'D', 'owner-shadow', 'cache-locator', 'version'] as const)('rejects corrupted %s before both real import ports write any row', async kind => {
    const f = await fixture(3), target = await seedCurrentWorkspace('坏回执隔离')
    await installWorldSourcePackageV1(target.scope, f.pkg)
    const bad = structuredClone(await exportProjectJSON(target.scope.projectId)), row = bad.worldSourceReceipts[0]
    if (kind === 'wire') { const packet = JSON.parse(row.wireJson); packet.manifest.attribution = '只重算声明也不能冒充原包'; row.wireJson = JSON.stringify(packet) }
    else if (kind === 'P') row.packageDigest = 'f'.repeat(64)
    else if (kind === 'D') row.declarationHash = 'e'.repeat(64)
    else if (kind === 'owner-shadow') row._worldOwnerExportId += 1
    else if (kind === 'cache-locator') row._worldReleaseExportId = 999_999
    else Reflect.set(row, 'receiptVersion', 2)
    const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    await expect(importProjectJSON(bad)).rejects.toThrow()
    await expect(deriveImportProjectJSON(bad)).rejects.toThrow()
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
  })

  it.each([3, 4, 5] as const)('restores the unique v%i editing binding and immutable origin, never upgrading it to another same-R D', async version => {
    const f = await fixture(version)
    const packet = await createWorldPackage(f.release.id!, { ...f.pkg.manifest,
      allowedUses: { ...f.pkg.manifest.allowedUses, 'world-remix': true }, ...(version === 5 ? { transport: 'dictionary-v1' as const } : {}) })
    const projectId = await importWorldPackage(packet), scope = await resolveWorkspaceScope(projectId)
    const before = await resolveWorldEditingSourceV1(scope)
    const second = await installWorldSourcePackageV1(scope, f.pkg)
    expect(second.declarationHash).not.toBe(before.row.declarationHash)
    expect((await resolveWorldEditingSourceV1(scope)).row.declarationHash).toBe(before.row.declarationHash)
    expect((await db.worlds.get(scope.worldId))?.communityOrigin).toEqual(before.world.communityOrigin)
    const backup = await exportProjectJSON(projectId)
    const restoredId = await importProjectJSON(backup), restored = await resolveWorldEditingSourceV1(await resolveWorkspaceScope(restoredId))
    expect(restored.row.declarationHash).toBe(before.row.declarationHash)
    expect(restored.world.communityOrigin).toEqual(before.world.communityOrigin)
    expect(restored.row.wireJson).toBe(before.row.wireJson)
    const bad = structuredClone(backup)
    const binding = bad.worldDerivations.find(row => row.sourceReceiptBinding)
    if (!binding?.sourceReceiptBinding) throw Error('Missing registered D binding')
    binding.sourceReceiptBinding.declarationHash = second.declarationHash
    const counts = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    await expect(importProjectJSON(bad)).rejects.toThrow()
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(counts)
  })

  it('survives source-author/other-scope deletion and clears only the cache locator on registered R deletion', async () => {
    const f = await fixture(3), first = await seedCurrentWorkspace('消费者一'), other = await seedCurrentWorkspace('消费者二')
    const stored = await installWorldSourcePackageV1(first.scope, f.pkg)
    const copied = await copyWorldSourceReceiptV1(other.scope, first.scope, stored.declarationHash)
    await cascadeDeleteProject(f.source.scope.projectId)
    await db.transaction('rw', transactionTablesFor('deleteProject'), async () => {
      await cascadeRegisteredReferences('worldReleases', stored.worldReleaseId)
      await db.worldReleases.delete(stored.worldReleaseId)
    })
    expect((await db.worldSourceReceipts.get(stored.receiptId))?.worldReleaseId).toBeNull()
    expect(await exportOriginalWorldSourceWireV1(first.scope, stored.declarationHash)).toBe(JSON.stringify(f.pkg))
    const rebuilt = await installWorldSourcePackageV1(first.scope, f.pkg)
    expect(rebuilt.receiptId).toBe(stored.receiptId)
    expect(rebuilt.worldReleaseId).not.toBe(stored.worldReleaseId)
    await deleteWorld(first.scope.worldId, { confirm: true })
    expect(await db.worldSourceReceipts.where('worldId').equals(first.scope.worldId).count()).toBe(0)
    expect((await readWorldSourceReceiptV1(other.scope, copied.declarationHash)).row.wireJson).toBe(JSON.stringify(f.pkg))
    await cascadeDeleteProject(other.scope.projectId)
    expect(await db.worldSourceReceipts.where('projectId').equals(other.scope.projectId).count()).toBe(0)
  })

  it('rolls R/revision back on receipt quota failure and rechecks the owner after wire preflight', async () => {
    const f = await fixture(3), target = await seedCurrentWorkspace('事务失败')
    const counts = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    const add = vi.spyOn(db.worldSourceReceipts, 'add').mockRejectedValueOnce(new Error('QuotaExceededError'))
    try { await expect(installWorldSourcePackageV1(target.scope, f.pkg)).rejects.toThrow('QuotaExceededError'); expect(add).toHaveBeenCalledTimes(1) }
    finally { add.mockRestore() }
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(counts)
    const captured = await captureWorldSourceWireV1(f.pkg)
    await cascadeDeleteProject(target.scope.projectId)
    const afterDelete = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    await expect(db.transaction('rw', scopeTransactionTables(db.worldReleases, db.worldRevisions, db.worldSourceReceipts),
      () => installCapturedWorldSourceInTransactionV1(target.scope, captured))).rejects.toThrow()
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(afterDelete)
  })
  it('rejects a separately self-consistent forged origin, a missing selected receipt and duplicate edit bindings', async () => {
    const f = await fixture(3), packet = await createWorldPackage(f.release.id!, { ...f.pkg.manifest,
      allowedUses: { ...f.pkg.manifest.allowedUses, 'world-remix': true } })
    const id = await importWorldPackage(packet), backup = await exportProjectJSON(id)
    const forged = structuredClone(backup), origin = forged.worlds[0].communityOrigin
    if (!origin) throw Error('Missing real origin snapshot')
    forged.worlds[0].communityOrigin = { ...encodeWorldSourceDeclarationV1({ manifest: { ...packet.manifest, attribution: '自洽不等于原wire' },
      packageVersion: packet.packageVersion, packageDigest: packet.integrity.digest }), importedAt: origin.importedAt }
    const missing = structuredClone(backup); missing.worldSourceReceipts = []
    const duplicate = structuredClone(backup), original = duplicate.worldDerivations[0]
    duplicate.worldDerivations.push({ ...structuredClone(original), _exportId: original._exportId + 1 })
    const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    for (const bad of [forged, missing, duplicate]) await expect(importProjectJSON(bad)).rejects.toThrow()
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
  })

  it('preserves real legacy v17 world-copy lineage as unknown without fabricating a receipt or new binding', async () => {
    const f = await fixture(4), packet = await createWorldPackage(f.release.id!, { ...f.pkg.manifest,
      allowedUses: { ...f.pkg.manifest.allowedUses, 'world-remix': true } })
    const id = await importWorldPackage(packet), backup = await exportProjectJSON(id)
    const old = structuredClone(backup); old.version = 17
    Reflect.deleteProperty(old, 'worldSourceReceipts')
    for (const row of old.worldDerivations) Reflect.deleteProperty(row, 'sourceReceiptBinding')
    const header = { packageId: packet.manifest.packageId, sourceWorldCode: packet.manifest.sourceWorldCode,
      sourceWorldVersion: packet.manifest.sourceWorldVersion, authorName: packet.manifest.authorName,
      license: packet.manifest.license, importedAt: 123 }
    old.worlds[0].communityOrigin = header
    const lineage = old.worldDerivations[0].narrativeLineageJson
    const restoredId = await importProjectJSON(old), restoredScope = await resolveWorkspaceScope(restoredId)
    expect((await db.worlds.get(restoredScope.worldId))?.communityOrigin).toEqual(header)
    expect((await db.worldDerivations.where('projectId').equals(restoredId).first())?.narrativeLineageJson).toBe(lineage)
    expect(await db.worldSourceReceipts.where('projectId').equals(restoredId).count()).toBe(0)
    await expect(resolveWorldEditingSourceV1(restoredScope)).rejects.toThrow('unknown')
  })

})


describe('SFQA021 F2 · capture before asynchronous trust/write boundary', () => {
  it.each([
    { label: 'public/wire', entry: importProjectJSON, mutation: 'wire' },
    { label: 'direct/wire', entry: deriveImportProjectJSON, mutation: 'wire' },
    { label: 'public/binding', entry: importProjectJSON, mutation: 'binding' },
    { label: 'direct/binding', entry: deriveImportProjectJSON, mutation: 'binding' },
  ])('$label keeps the verified snapshot or rejects all writes when the caller changes its object just before first add', async ({ entry, mutation }) => {
    const f = await fixture(3), packet = await createWorldPackage(f.release.id!, { ...f.pkg.manifest,
      allowedUses: { ...f.pkg.manifest.allowedUses, 'world-remix': true } })
    const sourceId = await importWorldPackage(packet), backup = await exportProjectJSON(sourceId)
    const expectedWire = backup.worldSourceReceipts[0].wireJson
    const originalBinding = backup.worldDerivations.find(row => row.sourceReceiptBinding)?.sourceReceiptBinding?.declarationHash
    if (!originalBinding) throw Error('Expected real verified editing binding')
    const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    const add = db.projects.add.bind(db.projects)
    let reachedFirstWrite = false
    const hook = vi.spyOn(db.projects, 'add').mockImplementationOnce((...args) => {
      reachedFirstWrite = true
      if (mutation === 'wire') backup.worldSourceReceipts[0].wireJson = 'post-validation unverified wire'
      else {
        const binding = backup.worldDerivations.find(row => row.sourceReceiptBinding)?.sourceReceiptBinding
        if (!binding) throw Error('Expected original caller binding')
        binding.declarationHash = 'e'.repeat(64)
      }
      return add(...args)
    })
    let imported: number | undefined, rejected = false
    try { imported = await entry(backup) } catch { rejected = true }
    finally { hook.mockRestore() }
    expect(reachedFirstWrite).toBe(true)
    if (rejected) {
      expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
    } else {
      if (imported === undefined) throw Error('Expected imported owner')
      const receipt = await db.worldSourceReceipts.where('projectId').equals(imported).first()
      const binding = await db.worldDerivations.where('projectId').equals(imported).first()
      expect(receipt?.wireJson).toBe(expectedWire)
      expect(binding?.sourceReceiptBinding?.declarationHash).toBe(originalBinding)
      expect((await resolveWorldEditingSourceV1(await resolveWorkspaceScope(imported))).row.declarationHash).toBe(originalBinding)
    }
    if (mutation === 'wire') expect(backup.worldSourceReceipts[0].wireJson).toBe('post-validation unverified wire')
    else expect(backup.worldDerivations.find(row => row.sourceReceiptBinding)?.sourceReceiptBinding?.declarationHash).toBe('e'.repeat(64))
  })
})


describe('SFQA021 F2 · owner remap and supported snapshot values', () => {
  it('remaps multiple Worlds/Works and same-R variants inside one project without borrowing another World D', async () => {
    const f = await fixture(3), owner = await seedCurrentWorkspace('多个World owner', { purpose: 'world-engine' })
    const now = Date.now(), secondWorldId = await db.worlds.add({ projectId: owner.scope.projectId,
      identityKind: 'world-draft', code: generateWorldCode(), name: '第二World', description: '', currentVersion: 0, createdAt: now, updatedAt: now })
    await db.works.add(currentWorkFixtureRecordV1({ projectId: owner.scope.projectId, worldId: secondWorldId, title: '第二Work' }))
    const secondScope = { projectId: owner.scope.projectId, worldId: secondWorldId }
    const a = await installWorldSourcePackageV1(owner.scope, f.pkg)
    const denied = await createWorldPackage(f.release.id!, { ...f.pkg.manifest,
      allowedUses: { ...f.pkg.manifest.allowedUses, ttrpg: false, avg: true } })
    const b = await installWorldSourcePackageV1(secondScope, denied)
    const backup = await exportProjectJSON(owner.scope.projectId), restoredId = await importProjectJSON(backup)
    expect(await db.worlds.where('projectId').equals(restoredId).count()).toBe(2)
    expect(await db.works.where('projectId').equals(restoredId).count()).toBe(2)
    const worlds = await db.worlds.where('projectId').equals(restoredId).toArray()
    const restoredSecond = worlds.find(row => row.name === '第二World')
    const restoredFirst = worlds.find(row => row.name !== '第二World')
    if (!restoredFirst?.id || !restoredSecond?.id) throw Error('Expected remapped World roots')
    const scopeA = { projectId: restoredId, worldId: restoredFirst.id }, scopeB = { projectId: restoredId, worldId: restoredSecond.id }
    expect((await readWorldSourceReceiptV1(scopeA, a.declarationHash)).captured.declaration.allowedUses.ttrpg).toBe(true)
    expect((await readWorldSourceReceiptV1(scopeB, b.declarationHash)).captured.declaration.allowedUses.ttrpg).toBe(false)
    await expect(readWorldSourceReceiptV1(scopeB, a.declarationHash)).rejects.toThrow('unknown')
    expect((await db.works.where('projectId').equals(restoredId).filter(row => row.title === '第二Work').first())?.worldId).toBe(restoredSecond.id)
    await deleteWorld(restoredFirst.id, { confirm: true })
    expect((await readWorldSourceReceiptV1(scopeB, b.declarationHash)).captured.declaration.allowedUses.ttrpg).toBe(false)
    expect(await db.worldSourceReceipts.where('worldId').equals(restoredFirst.id).count()).toBe(0)
  })

  it('rejects a real future database at the current-schema public guard without rewriting its data', async () => {
    const f = await fixture(3), name = db.name
    const original = await db.projects.get(f.source.scope.projectId)
    if (!original) throw Error('Expected real author root')
    await db.delete()
    const future = new Dexie(name)
    future.version(15).stores({ ...STORYFORGE_STORES, futureEvidence: '++id' })
    await future.open(); await future.table('projects').put(original); future.close()
    try {
      // Bare Dexie.open can read a newer native DB; the existing application
      // guard deliberately checks backendDB.version as well as declared verno.
      await expect(openCurrentSchema()).rejects.toThrow('只支持当前 schema v14')
      const readback = new Dexie(name)
      try { await readback.open(); expect(readback.verno).toBe(15); expect(await readback.table('projects').get(original.id!)).toEqual(original); expect(readback.tables.some(table => table.name === 'futureEvidence')).toBe(true) }
      finally { readback.close() }
    } finally { db.close(); future.close(); await Dexie.delete(name) }
  })

  it.each([
    { label: 'public/ArrayBuffer source', entry: importProjectJSON, blob: false },
    { label: 'direct/Blob source', entry: deriveImportProjectJSON, blob: true },
  ])('$label preserves officially exported binary bytes against a post-validation caller edit', async ({ entry, blob }) => {
    const owner = await seedCurrentWorkspace('合法二进制快照'), bytes = new Uint8Array([11, 22, 33, 44]).buffer
    const object = await putMediaBlobObject({ scope: owner.scope, data: bytes, mimeType: 'application/octet-stream', backend: 'indexeddb' })
    if (blob) {
      // The existing exporter explicitly supports legacy stored Blob values;
      // current portable imports still require its verified data-URL string.
      Reflect.set(object, 'data', new NodeBlob([bytes], { type: object.mimeType }))
      await db.mediaBlobObjects.put(object)
    }
    const backup = await exportProjectJSON(owner.scope.projectId)
    expect(typeof backup.mediaBlobObjects[0].data).toBe('string')
    const originalData = backup.mediaBlobObjects[0].data
    const add = db.projects.add.bind(db.projects)
    let reached = false
    const hook = vi.spyOn(db.projects, 'add').mockImplementationOnce((...args) => {
      reached = true; backup.mediaBlobObjects[0].data = 'data:application/octet-stream;base64,Y2NjYw=='
      return add(...args)
    })
    let id: number
    try { id = await entry(backup) } finally { hook.mockRestore() }
    expect(reached).toBe(true)
    const restored = await db.mediaBlobObjects.where('projectId').equals(id).first()
    if (!(restored?.data instanceof ArrayBuffer)) throw Error('Expected preserved actual binary storage')
    expect([...new Uint8Array(restored.data)]).toEqual([11, 22, 33, 44])
    expect(backup.mediaBlobObjects[0].data).not.toBe(originalData)
  })

})

describe('SFQA021 F2 · call-time package and World owner selection', () => {
  async function twinWorlds(label: string) {
    const owner = await seedCurrentWorkspace(label, { purpose: 'world-engine' })
    const now = Date.now()
    const worldId = await db.worlds.add({ projectId: owner.scope.projectId, identityKind: 'world-draft',
      code: generateWorldCode(), name: label + ' B', description: '', currentVersion: 0, createdAt: now, updatedAt: now })
    return { first: { projectId: owner.scope.projectId, worldId: owner.scope.worldId }, second: { projectId: owner.scope.projectId, worldId } }
  }

  async function afterFirstRealOwnerRead<T>(entry: () => Promise<T>, mutateCaller: () => void) {
    let release!: () => void, acknowledge!: () => void
    const hold = new Promise<void>(resolve => { release = resolve })
    const reached = new Promise<void>(resolve => { acknowledge = resolve })
    const get = db.projects.get.bind(db.projects)
    const hook = vi.spyOn(db.projects, 'get').mockImplementationOnce((...args) => get(...args).then(row => {
      acknowledge()
      return Dexie.Promise.resolve(hold).then(() => row)
    }))
    const pending = entry().then(value => ({ rejected: false as const, value }), () => ({ rejected: true as const }))
    try {
      await reached // The actual IndexedDB read completed; only its ACK is held.
      mutateCaller()
      release()
      return await pending
    } finally { release(); hook.mockRestore() }
  }

  it('install keeps the call-time actual wire when its caller changes A to another fully valid same-R declaration during the first owner read', async () => {
    const f = await fixture(3), target = await twinWorlds('调用时原包')
    const packetB = await createWorldPackage(f.release.id!, { ...f.pkg.manifest,
      allowedUses: { ...f.pkg.manifest.allowedUses, ttrpg: false, avg: true } })
    const [a, b] = await Promise.all([captureWorldSourceWireV1(f.pkg), captureWorldSourceWireV1(packetB)])
    expect(a.frozenRelease.releaseUid).toBe(b.frozenRelease.releaseUid)
    expect(a.declaration.declarationHash).not.toBe(b.declaration.declarationHash)
    const callerPacket = structuredClone(f.pkg), expectedWire = JSON.stringify(callerPacket)
    const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    const outcome = await afterFirstRealOwnerRead(() => installWorldSourcePackageV1(target.first, callerPacket),
      () => { Object.assign(callerPacket, structuredClone(packetB)) })
    expect(callerPacket).toEqual(packetB)
    if (outcome.rejected) expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
    else {
      const receipt = await db.worldSourceReceipts.get(outcome.value.receiptId)
      const cached = await db.worldReleases.get(outcome.value.worldReleaseId)
      expect(receipt?.wireJson).toBe(expectedWire)
      expect(receipt?.declarationHash).toBe(a.declaration.declarationHash)
      expect(receipt?.worldId).toBe(target.first.worldId)
      expect(cached?.worldId).toBe(target.first.worldId)
      expect(cached?.releaseUid).toBe(a.frozenRelease.releaseUid)
    }
  })

  it('install keeps call-time World A when the caller changes worldId to valid World B in the same Project during the first owner read', async () => {
    const f = await fixture(3), target = await twinWorlds('调用时目标')
    const callerScope = { ...target.first }, expectedWire = JSON.stringify(f.pkg)
    const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    const outcome = await afterFirstRealOwnerRead(() => installWorldSourcePackageV1(callerScope, f.pkg),
      () => { callerScope.worldId = target.second.worldId })
    expect(callerScope).toEqual(target.second)
    if (outcome.rejected) expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
    else {
      const receipt = await db.worldSourceReceipts.get(outcome.value.receiptId)
      const cached = await db.worldReleases.get(outcome.value.worldReleaseId)
      expect(receipt?.worldId).toBe(target.first.worldId)
      expect(receipt?.projectId).toBe(target.first.projectId)
      expect(receipt?.wireJson).toBe(expectedWire)
      expect(cached?.worldId).toBe(target.first.worldId)
      expect(await db.worldSourceReceipts.where('worldId').equals(target.second.worldId).count()).toBe(0)
    }
  })

  it.each(['target', 'source'] as const)('copy captures both owners before awaits when caller %s changes to another valid same-Project World', async mutation => {
    const f = await fixture(3), source = await twinWorlds('复制来源'), target = await twinWorlds('复制目标')
    const wireA = JSON.stringify(f.pkg), wireB = JSON.stringify(f.pkg, null, 2) + '\n'
    const a = await installWorldSourcePackageV1(source.first, wireA), b = await installWorldSourcePackageV1(source.second, wireB)
    expect(a.declarationHash).toBe(b.declarationHash) // Same P/R/D, distinct original wire formatting.
    const callerTarget = { ...target.first }, callerSource = { ...source.first }
    const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    const outcome = await afterFirstRealOwnerRead(() => copyWorldSourceReceiptV1(callerTarget, callerSource, a.declarationHash), () => {
      if (mutation === 'target') callerTarget.worldId = target.second.worldId
      else callerSource.worldId = source.second.worldId
    })
    expect(callerTarget).toEqual(mutation === 'target' ? target.second : target.first)
    expect(callerSource).toEqual(mutation === 'source' ? source.second : source.first)
    if (outcome.rejected) expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
    else {
      const receipt = await db.worldSourceReceipts.get(outcome.value.receiptId)
      const cached = await db.worldReleases.get(outcome.value.worldReleaseId)
      expect(receipt?.worldId).toBe(target.first.worldId)
      expect(receipt?.projectId).toBe(target.first.projectId)
      expect(receipt?.wireJson).toBe(wireA)
      expect(cached?.worldId).toBe(target.first.worldId)
      expect(await db.worldSourceReceipts.where('worldId').equals(target.second.worldId).count()).toBe(0)
      expect((await db.worldSourceReceipts.get(a.receiptId))?.wireJson).toBe(wireA)
      expect((await db.worldSourceReceipts.get(b.receiptId))?.wireJson).toBe(wireB)
    }
  })
})
