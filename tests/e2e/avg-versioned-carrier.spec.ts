import { expect, test } from '@playwright/test'

test('AVG V2 carrier survives browser refresh and portable backup while runtime admission stays closed', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const seeded = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { seedBuild } = await load('/storyforge/tests/helpers/avg-carrier-fixture.ts')
    const s = await seedBuild()
    return { scope: s.scope, buildId: s.buildId, releaseId: s.id,
      packageHash: s.preview.packageHash, previewHash: s.preview.previewHash }
  })
  await page.reload()
  const result = await page.evaluate(async s => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, sources, backups, { deleteWork }] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'),
      load('/storyforge/src/lib/product-production/preview-source.ts'),
      load('/storyforge/src/lib/export/json-export.ts'),
      load('/storyforge/src/lib/workspace/lifecycle.ts'),
    ])
    const source = { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.previewHash }
    const verified = await sources.verifyProductRuntimeSourceEnvelope({ scope: s.scope, source })
    let runtimeError = ''
    try { await sources.resolveProductRuntimeSource({ scope: s.scope, source }) }
    catch (error) { runtimeError = String(error) }
    const original = await db.productBuilds.get(s.buildId)
    const snapshot = await backups.exportProjectJSON(s.scope.projectId)
    const importedId = await backups.importProjectJSON(snapshot)
    const imported = await db.productBuilds.where('projectId').equals(importedId).first()
    const importedSource = { ...source, productBuildId: imported.id }
    const readback = await sources.verifyProductRuntimeSourceEnvelope({ scope: imported, source: importedSource })
    const before = await db.projects.count()
    const forged = structuredClone(snapshot)
    const preview = JSON.parse(forged.productBuilds[0].previewManifestJson)
    forged.productBuilds[0].previewManifestJson = JSON.stringify({ ...preview, version: 3 })
    let importError = ''
    try { await backups.importProjectJSON(forged) } catch (error) { importError = String(error) }
    const count = await db.projects.count()
    await deleteWork(imported.workId)
    return { version: verified.runtimePackage.version, hash: verified.packageHash,
      importedHash: readback.packageHash, bytesPreserved: original.previewManifestJson === imported.previewManifestJson,
      remapped: imported.id !== s.buildId, runtimeError, importError, atomic: before === count,
      originalKept: !!await db.productBuilds.get(s.buildId), importedDeleted: !await db.productBuilds.get(imported.id),
      sessions: await db.productRuntimeSessions.count(), blobs: await db.mediaBlobObjects.count() }
  }, seeded)
  expect(result).toMatchObject({ version: 2, hash: seeded.packageHash, importedHash: seeded.packageHash,
    bytesPreserved: true, remapped: true, atomic: true, originalKept: true, importedDeleted: true, sessions: 0, blobs: 0 })
  expect(result.runtimeError).toContain('未登记可玩模块')
  expect(result.importError).toContain('ProductBuild Preview')
})
