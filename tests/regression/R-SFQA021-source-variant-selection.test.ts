import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createSfqa021WorldSharingCarrierV1 as fixture } from '../helpers/sfqa021-world-sharing-carrier'
import { createWorldPackage } from '../../src/lib/world-engine/world-package'
import { copyWorldSourceReceiptV1, installWorldSourcePackageV1, listWorldSourceReceiptsV1, readWorldSourceReceiptV1, resolveWorldEditingSourceV1 } from '../../src/lib/world-engine/source-receipt'
import { cacheWorldReferenceForProductV1 } from '../../src/lib/world-engine/reference-cache'
import { createWorldReferenceV1 } from '../../src/lib/world-engine/world-reference'

async function seedTtrpg(name: string) {
  return createWorkspace({ name, description: '', genres: ['other'], status: 'drafting', targetWordCount: 0 },
    { purpose: 'independent-work', kind: 'ttrpg' })
}

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe('SFQA021 F2 · R cache and explicit D variants', () => {
  it('keeps one R and two distinct selected declarations; copying a denied D never borrows the allowed D', async () => {
    const f = await fixture(3), target = await seedTtrpg('两个声明')
    const denied = await createWorldPackage(f.release.id!, { ...f.pkg.manifest,
      allowedUses: { ...f.pkg.manifest.allowedUses, ttrpg: false, avg: true } })
    const yes = await installWorldSourcePackageV1(target.scope, f.pkg)
    const no = await installWorldSourcePackageV1(target.scope, denied)
    expect(yes.worldReleaseId).toBe(no.worldReleaseId)
    expect(yes.declarationHash).not.toBe(no.declarationHash)
    const choices = await listWorldSourceReceiptsV1(target.scope)
    expect(choices).toHaveLength(2)
    expect(new Set(choices.map(choice => choice.key)).size).toBe(2)
    expect((await readWorldSourceReceiptV1(target.scope, yes.declarationHash)).captured.declaration.allowedUses.ttrpg).toBe(true)
    expect((await readWorldSourceReceiptV1(target.scope, no.declarationHash)).captured.declaration.allowedUses.ttrpg).toBe(false)
    await expect(resolveWorldEditingSourceV1(target.scope)).rejects.toThrow('unknown')
    const other = await seedTtrpg('仅复制拒绝声明')
    const copied = await copyWorldSourceReceiptV1(other.scope, target.scope, no.declarationHash)
    expect(copied.declarationHash).toBe(no.declarationHash)
    await expect(readWorldSourceReceiptV1(other.scope, yes.declarationHash)).rejects.toThrow('unknown')
    expect((await readWorldSourceReceiptV1(other.scope, no.declarationHash)).captured.declaration.allowedUses.ttrpg).toBe(false)
  })

  it('does not invent a D or origin for legacy R-only caching', async () => {
    const f = await fixture(3), target = await seedTtrpg('旧只读缓存')
    await cacheWorldReferenceForProductV1(target.scope, f.release.id!)
    expect(await listWorldSourceReceiptsV1(target.scope)).toEqual([])
    expect((await db.worlds.get(target.scope.worldId))?.communityOrigin).toBeUndefined()
    await expect(resolveWorldEditingSourceV1(target.scope)).rejects.toThrow('unknown')
  })

  it.each([4, 5] as const)('stores supported v%i wire without pretending TTRPG v3 capability is available', async version => {
    const f = await fixture(version), target = await seedTtrpg('能力与用途分离')
    const stored = await installWorldSourcePackageV1(target.scope, f.pkg)
    expect((await readWorldSourceReceiptV1(target.scope, stored.declarationHash)).captured.declaration.allowedUses.ttrpg).toBe(true)
    await expect(createWorldReferenceV1(stored.worldReleaseId)).rejects.toThrow()
    expect(stored.status).toBe('stored-unselected')
    expect(await db.agentRuns.count()).toBe(0)
  })
})
