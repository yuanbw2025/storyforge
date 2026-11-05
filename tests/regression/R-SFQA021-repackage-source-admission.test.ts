import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createSfqa021WorldSharingCarrierV1 as fixture } from '../helpers/sfqa021-world-sharing-carrier'
import { createWorldPackage, importWorldPackage, inspectWorldPackage } from '../../src/lib/world-engine/world-package'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { exportOriginalWorldSourceWireV1, installWorldSourcePackageV1, readWorldSourceReceiptV1, resolveWorldEditingSourceV1 } from '../../src/lib/world-engine/source-receipt'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'

async function seedTtrpg(name: string) {
  return createWorkspace({ name, description: '', genres: ['other'], status: 'drafting', targetWordCount: 0 },
    { purpose: 'independent-work', kind: 'ttrpg' })
}

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe('SFQA021 F2 · existing package API source closure', () => {
  it('rejects direct re-signing/repermission of an external cached R, without needing the UI', async () => {
    const f = await fixture(3), target = await seedTtrpg('外来缓存')
    const stored = await installWorldSourcePackageV1(target.scope, f.pkg)
    await expect(createWorldPackage(stored.worldReleaseId, { ...f.pkg.manifest, authorName: '新作者',
      allowedUses: { ...f.pkg.manifest.allowedUses, 'world-remix': true } })).rejects.toThrow('外来冻结缓存')
    expect(await exportOriginalWorldSourceWireV1(target.scope, stored.declarationHash)).toBe(JSON.stringify(f.pkg))
  })

  it.each([3, 4, 5] as const)('atomically binds an explicitly permitted v%i edit, but rejects repacking its new R through old wire', async version => {
    const f = await fixture(version)
    const packet = await createWorldPackage(f.release.id!, { ...f.pkg.manifest,
      allowedUses: { ...f.pkg.manifest.allowedUses, 'world-remix': true }, ...(version === 5 ? { transport: 'dictionary-v1' as const } : {}) })
    const id = await importWorldPackage(JSON.stringify(packet, null, 2)), scope = await resolveWorkspaceScope(id)
    const source = await resolveWorldEditingSourceV1(scope)
    expect(source.binding.sourceReceiptBinding?.declarationHash).toBe(source.row.declarationHash)
    expect(source.world.communityOrigin?.authorName).toBe(packet.manifest.authorName)
    expect(source.row.wireJson).toBe(JSON.stringify(packet, null, 2))
    expect(source.world.code).not.toBe(packet.manifest.sourceWorldCode)
    const revision = await createWorldRevision({ scope, label: '新世界封存', formatVersion: version === 3 ? 3 : 4 })
    const release = await publishWorldRevision(revision.id!)
    await expect(createWorldPackage(release.id!, { ...packet.manifest, authorName: '新namespace的新作者' })).rejects.toThrow('旧 v3/v4/v5 重包')
    expect((await readWorldSourceReceiptV1(scope, source.row.declarationHash)).captured.declaration.attribution).toBe(packet.manifest.attribution)
  })

  it('preserves a genuinely independent author R despite unrelated readonly receipts in that same World', async () => {
    const external = await fixture(3), own = await seedCurrentWorkspace('独立作者', { purpose: 'world-engine' })
    const revision = await createWorldRevision({ scope: own.scope, label: '自己作品' })
    const release = await publishWorldRevision(revision.id!)
    await installWorldSourcePackageV1(own.scope, external.pkg)
    const packet = await createWorldPackage(release.id!, { ...external.pkg.manifest, authorName: '真正自有作者' })
    expect((await inspectWorldPackage(packet)).valid).toBe(true)
    expect(packet.manifest.authorName).toBe('真正自有作者')
    expect((await db.worlds.get(own.scope.worldId))?.communityOrigin).toBeUndefined()
    expect(await db.worldDerivations.where('worldId').equals(own.scope.worldId).count()).toBe(0)
  })
  it('refuses a known explicit ancestor whose full wire chain is missing, without claiming to detect hidden external ancestry', async () => {
    const f = await fixture(3), permitted = await createWorldPackage(f.release.id!, { ...f.pkg.manifest,
      allowedUses: { ...f.pkg.manifest.allowedUses, 'world-remix': true } })
    const id = await importWorldPackage(permitted), scope = await resolveWorkspaceScope(id)
    const revision = await createWorldRevision({ scope, label: '明确承袭祖先', formatVersion: 3 })
    const release = await publishWorldRevision(revision.id!)
    // Simulate an outside old-wire packager, using genuine frozen derived R
    // and a real integrity digest. This is no author signature/provenance grant.
    const payload = { format: 'storyforge.world-package', packageVersion: 3,
      manifest: { ...permitted.manifest, sourceWorldCode: release.sourceWorldCode, sourceWorldVersion: release.version,
        packageId: `${release.sourceWorldCode}@v${release.version}`, releaseHash: release.contentHash },
      release: { label: release.label, version: release.version, contentHash: release.contentHash, manifest: JSON.parse(release.manifestJson) } }
    const outside = { ...payload, integrity: { algorithm: 'SHA-256', digest: await hashCanonicalValue(payload) } }
    expect((await inspectWorldPackage(outside)).valid).toBe(true)
    const before = await db.projects.count()
    await expect(importWorldPackage(outside)).rejects.toThrow('已知上游')
    expect(await db.projects.count()).toBe(before)
  })

  it('rejects a source change during the existing API digest rather than returning a stale new package', async () => {
    const external = await fixture(3), own = await seedCurrentWorkspace('打包竞态', { purpose: 'world-engine' })
    const revision = await createWorldRevision({ scope: own.scope, label: '原生版本', formatVersion: 3 })
    const release = await publishWorldRevision(revision.id!)
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    let changed = false
    const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
      let payload: unknown
      try { payload = JSON.parse(new TextDecoder().decode(data)) } catch { payload = null }
      if (!changed && payload && typeof payload === 'object' && Reflect.get(payload, 'format') === 'storyforge.world-package') {
        changed = true
        await db.worlds.update(own.scope.worldId, { communityOrigin: external.origin })
      }
      return digest(algorithm, data)
    })
    try { await expect(createWorldPackage(release.id!, { ...external.pkg.manifest })).rejects.toThrow('stale') }
    finally { spy.mockRestore() }
    expect(changed).toBe(true)
    expect((await db.worldReleases.get(release.id!))?.manifestJson).toBe(release.manifestJson)
  })

})
