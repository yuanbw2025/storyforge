import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { createSfqa021WorldSharingCarrierV1 as fixture } from '../helpers/sfqa021-world-sharing-carrier'
import { captureWorldSourceWireV1, importWorldPackage } from '../../src/lib/world-engine/world-package'
import { exportOriginalWorldSourceWireV1, installCapturedWorldSourceInTransactionV1, installWorldSourcePackageV1, readWorldSourceReceiptV1 } from '../../src/lib/world-engine/source-receipt'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { WORLD_SOURCE_WIRE_MAX_BYTES } from '../../src/lib/world-engine/source-receipt-contract'

async function seedTtrpg(name: string) {
  return createWorkspace({ name, description: '', genres: ['other'], status: 'drafting', targetWordCount: 0 },
    { purpose: 'independent-work', kind: 'ttrpg' })
}

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

describe('SFQA021 F2 · actual immutable wire evidence', () => {
  it.each([3, 4, 5] as const)('captures and stores v%i normative wire, exact credits/warnings and transport without editable materialization', async version => {
    const f = await fixture(version), target = await seedTtrpg('只读产品')
    const wire = JSON.stringify(f.pkg, null, 2) + '\n'
    const captured = await captureWorldSourceWireV1(wire)
    const before = await db.worlds.get(target.scope.worldId), characters = await db.characters.count()
    const stored = await installWorldSourcePackageV1(target.scope, wire)
    const evidence = await readWorldSourceReceiptV1(target.scope, stored.declarationHash)
    expect(evidence.row.wireJson).toBe(wire)
    expect(captured.declaration.packageDigest).toBe(f.pkg.integrity.digest)
    expect(evidence.captured.declaration.attribution).toBe(f.pkg.manifest.attribution)
    expect(evidence.captured.declaration.contentWarnings).toEqual(f.pkg.manifest.contentWarnings)
    expect(evidence.captured.declaration.allowedUses).toEqual(f.pkg.manifest.allowedUses)
    expect(evidence.captured.frozenRelease.releaseUid).toBe(stored.releaseUid)
    expect(await exportOriginalWorldSourceWireV1(target.scope, stored.declarationHash)).toBe(wire)
    expect(await db.worlds.get(target.scope.worldId)).toEqual(before)
    expect(await db.characters.count()).toBe(characters)
    expect(await db.worldDerivations.where('worldId').equals(target.scope.worldId).count()).toBe(0)
    expect(stored.status).toBe('stored-unselected')
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('deduplicates JSON formatting variants by verified P/R/D without replacing the first original text', async () => {
    const f = await fixture(3), target = await seedCurrentWorkspace('同包')
    const wire = JSON.stringify(f.pkg, null, 2)
    const a = await installWorldSourcePackageV1(target.scope, wire)
    const b = await installWorldSourcePackageV1(target.scope, JSON.stringify(f.pkg))
    expect(b.receiptId).toBe(a.receiptId)
    expect(b.worldReleaseId).toBe(a.worldReleaseId)
    expect(await exportOriginalWorldSourceWireV1(target.scope, a.declarationHash)).toBe(wire)
  })

  it('refuses altered raw metadata, forged preflight objects and editing a denied package with zero writes', async () => {
    const f = await fixture(3), target = await seedCurrentWorkspace('拒绝写入')
    const damaged = structuredClone(f.pkg); damaged.manifest.attribution = '不能重算D冒充旧P'
    const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    await expect(installWorldSourcePackageV1(target.scope, damaged)).rejects.toThrow('完整性')
    const captured = await captureWorldSourceWireV1(f.pkg)
    await expect(db.transaction('rw', scopeTransactionTables(db.worldReleases, db.worldRevisions, db.worldSourceReceipts),
      () => installCapturedWorldSourceInTransactionV1(target.scope, { ...captured }))).rejects.toThrow('真实 wire')
    await expect(importWorldPackage(f.pkg)).rejects.toThrow('world-remix=false')
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
  })

  it('refuses out-of-budget raw text before parsing and unknown extra old-wire fields', async () => {
    await expect(captureWorldSourceWireV1(' '.repeat(WORLD_SOURCE_WIRE_MAX_BYTES + 1))).rejects.toThrow('预算')
    const f = await fixture(3)
    await expect(captureWorldSourceWireV1({ ...f.pkg, sourceReceipts: [] })).rejects.toThrow('未知顶层字段')
  })
  it('rejects a contradictory same-P index and a corrupt same-R cache instead of repairing/overwriting either', async () => {
    const f = await fixture(3), target = await seedCurrentWorkspace('损坏去重证据')
    const stored = await installWorldSourcePackageV1(target.scope, f.pkg)
    await db.worldSourceReceipts.update(stored.receiptId, { declarationHash: 'e'.repeat(64) })
    const before = await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
    await expect(installWorldSourcePackageV1(target.scope, f.pkg)).rejects.toThrow('同 P')
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
    await db.worldSourceReceipts.update(stored.receiptId, { declarationHash: stored.declarationHash })
    await db.worldReleases.update(stored.worldReleaseId, { manifestJson: '{}' })
    await expect(installWorldSourcePackageV1(target.scope, f.pkg)).rejects.toThrow('缓存世界版本损坏')
    expect(await Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))).toEqual(before)
    expect((await db.worldReleases.get(stored.worldReleaseId))?.manifestJson).toBe('{}')
  })

})
