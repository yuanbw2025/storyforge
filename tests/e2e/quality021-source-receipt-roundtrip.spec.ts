import { expect, test, type BrowserContext } from '@playwright/test'

test('SFQA021 F2: actual wire variants, editing binding and API refusal survive isolated IndexedDB backup/reload', async ({ page, browser, context, baseURL }) => {
  if (!baseURL) throw Error('Expected isolated browser origin')
  const allowed = new URL(baseURL).origin, external: string[] = []
  const isolate = async (target: BrowserContext) => {
    await target.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    await target.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (['http:', 'https:'].includes(url.protocol) && url.origin !== allowed) { external.push(url.origin); await route.abort(); return }
      await route.continue()
    })
  }
  await isolate(context)
  await page.goto('./world/worlds')
  const payload = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [fixtures, workspaces, receipts, packages, exports, schema, registry, ownership, releases] = await Promise.all([
      load<typeof import('../helpers/sfqa021-world-sharing-carrier')>('/storyforge/tests/helpers/sfqa021-world-sharing-carrier.ts'),
      load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts'),
      load<typeof import('../../src/lib/world-engine/source-receipt')>('/storyforge/src/lib/world-engine/source-receipt.ts'),
      load<typeof import('../../src/lib/world-engine/world-package')>('/storyforge/src/lib/world-engine/world-package.ts'),
      load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts'),
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../../src/lib/registry/project-tables')>('/storyforge/src/lib/registry/project-tables.ts'),
      load<typeof import('../../src/lib/workspace/ownership')>('/storyforge/src/lib/workspace/ownership.ts'),
      load<typeof import('../../src/lib/world-engine/releases')>('/storyforge/src/lib/world-engine/releases.ts'),
    ])
    const f = await fixtures.createSfqa021WorldSharingCarrierV1(5), target = await workspaces.seedCurrentWorkspace('F2只读承载')
    const beforeWorld = JSON.stringify(await schema.db.worlds.get(target.scope.worldId))
    const wire = JSON.stringify(f.pkg, null, 2) + '\n'
    const first = await receipts.installWorldSourcePackageV1(target.scope, wire)
    const deniedPacket = await packages.createWorldPackage(f.release.id!, { ...f.pkg.manifest,
      allowedUses: { ...f.pkg.manifest.allowedUses, ttrpg: false, avg: true }, transport: 'dictionary-v1' })
    const second = await receipts.installWorldSourcePackageV1(target.scope, deniedPacket)
    const choices = await receipts.listWorldSourceReceiptsV1(target.scope)
    const readonlyWorldUnchanged = JSON.stringify(await schema.db.worlds.get(target.scope.worldId)) === beforeWorld
    const backup = await exports.exportProjectJSON(target.scope.projectId), corrupt = structuredClone(backup)
    corrupt.worldSourceReceipts[0].packageDigest = 'f'.repeat(64)
    const counts = await Promise.all(registry.PROJECT_TABLES.map(spec => spec.table.count()))
    let refused = ''
    try { await exports.importProjectJSON(corrupt) } catch (cause) { refused = String(cause) }
    const unchangedCounts = JSON.stringify(await Promise.all(registry.PROJECT_TABLES.map(spec => spec.table.count()))) === JSON.stringify(counts)
    const sameId = await exports.importProjectJSON(backup), sameScope = await ownership.resolveWorkspaceScope(sameId)
    const sameWire = await receipts.exportOriginalWorldSourceWireV1(sameScope, first.declarationHash)
    const editable = await fixtures.createSfqa021WorldSharingCarrierV1(3)
    const allowedPacket = await packages.createWorldPackage(editable.release.id!, { ...editable.pkg.manifest,
      allowedUses: { ...editable.pkg.manifest.allowedUses, 'world-remix': true } })
    const editId = await packages.importWorldPackage(allowedPacket), editScope = await ownership.resolveWorkspaceScope(editId)
    const edit = await receipts.resolveWorldEditingSourceV1(editScope)
    const revision = await releases.createWorldRevision({ scope: editScope, label: '浏览器派生封存', formatVersion: 3 })
    const release = await releases.publishWorldRevision(revision.id!)
    let repackageRefused = ''
    try { await packages.createWorldPackage(release.id!, { ...allowedPacket.manifest, authorName: '不可抹上游的新作者' }) }
    catch (cause) { repackageRefused = String(cause) }
    return JSON.stringify({ backupWire: JSON.stringify(backup), editBackupWire: JSON.stringify(await exports.exportProjectJSON(editId)),
      wire, D1: first.declarationHash, D2: second.declarationHash, sharedR: first.worldReleaseId === second.worldReleaseId,
      choiceCount: choices.length, distinctKeys: new Set(choices.map(choice => choice.key)).size,
      readonlyWorldUnchanged, refused, unchangedCounts, sameWire,
      editD: edit.row.declarationHash, editOrigin: JSON.stringify(edit.world.communityOrigin), repackageRefused,
      runs: await schema.db.agentRuns.count() })
  })
  const seeded = JSON.parse(payload)
  expect(seeded.sharedR).toBe(true); expect(seeded.choiceCount).toBe(2); expect(seeded.distinctKeys).toBe(2)
  expect(seeded.readonlyWorldUnchanged).toBe(true); expect(seeded.unchangedCounts).toBe(true)
  expect(seeded.refused).toBeTruthy(); expect(seeded.sameWire).toBe(seeded.wire)
  expect(seeded.repackageRefused).toContain('旧 v3/v4/v5'); expect(seeded.runs).toBe(0)
  const fresh = await browser.newContext({ baseURL })
  try {
    await isolate(fresh)
    const receiver = await fresh.newPage()
    await receiver.goto('./world/worlds')
    const restoredJson = await receiver.evaluate(async (payloadJson: string) => {
      const seed = JSON.parse(payloadJson)
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const [exports, receipts, ownership, schema, packages] = await Promise.all([
        load<typeof import('../../src/lib/export/json-export')>('/storyforge/src/lib/export/json-export.ts'),
        load<typeof import('../../src/lib/world-engine/source-receipt')>('/storyforge/src/lib/world-engine/source-receipt.ts'),
        load<typeof import('../../src/lib/workspace/ownership')>('/storyforge/src/lib/workspace/ownership.ts'),
        load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
        load<typeof import('../../src/lib/world-engine/world-package')>('/storyforge/src/lib/world-engine/world-package.ts'),
      ])
      const empty = await schema.db.projects.count()
      const id = await exports.importProjectJSON(JSON.parse(seed.backupWire)), scope = await ownership.resolveWorkspaceScope(id)
      const choices = await receipts.listWorldSourceReceiptsV1(scope)
      const first = await receipts.readWorldSourceReceiptV1(scope, seed.D1), second = await receipts.readWorldSourceReceiptV1(scope, seed.D2)
      const wire = await receipts.exportOriginalWorldSourceWireV1(scope, seed.D1)
      const editId = await exports.importProjectJSON(JSON.parse(seed.editBackupWire)), editScope = await ownership.resolveWorkspaceScope(editId)
      const edit = await receipts.resolveWorldEditingSourceV1(editScope)
      return JSON.stringify({ empty, id, editId, count: choices.length, wire, valid: (await packages.inspectWorldPackage(JSON.parse(wire))).valid,
        ttrpgFirst: first.captured.declaration.allowedUses.ttrpg, ttrpgSecond: second.captured.declaration.allowedUses.ttrpg,
        originAbsent: (await schema.db.worlds.get(scope.worldId))?.communityOrigin === undefined,
        editD: edit.row.declarationHash, editOrigin: JSON.stringify(edit.world.communityOrigin),
        projects: await schema.db.projects.count(), runs: await schema.db.agentRuns.count() })
    }, payload)
    const restored = JSON.parse(restoredJson)
    expect(restored.empty).toBe(0); expect(restored.count).toBe(2); expect(restored.wire).toBe(seeded.wire)
    expect(restored.valid).toBe(true); expect(restored.ttrpgFirst).toBe(true); expect(restored.ttrpgSecond).toBe(false)
    expect(restored.originAbsent).toBe(true); expect(restored.editD).toBe(seeded.editD); expect(restored.editOrigin).toBe(seeded.editOrigin)
    expect(restored.projects).toBe(2); expect(restored.runs).toBe(0)
    await receiver.reload()
    const reloaded = await receiver.evaluate(async (restoredWire: string) => {
      const data = JSON.parse(restoredWire)
      const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")') as () => Promise<typeof import('../../src/lib/db/schema')>)()
      const row = await db.worldSourceReceipts.where('projectId').equals(data.id).filter(item => item.declarationHash === data.D1).first()
      return row?.wireJson
    }, JSON.stringify({ id: restored.id, D1: seeded.D1 }))
    expect(reloaded).toBe(seeded.wire)
  } finally { await fresh.close() }
  expect(external).toEqual([])
})
