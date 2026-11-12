import { expect, test, type Download } from '@playwright/test'

async function readDownload(download: Download) {
  const stream = await download.createReadStream()
  if (!stream) throw Error('Expected actual downloaded file stream')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

test('SFQA021 F3: actual readonly file entry and explicit declaration choice preserve both raw variants across reload', async ({ page, baseURL }) => {
  if (!baseURL) throw Error('Expected isolated browser origin')
  const origin = new URL(baseURL).origin, external: string[] = []
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin) { external.push(url.origin); await route.abort(); return }
    await route.continue()
  })
  await page.goto('./world/worlds')
  const seedWire = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [fixtures, workspaces, releases, packages, schema, registry] = await Promise.all([
      load<typeof import('../helpers/sfqa021-world-sharing-carrier')>('/storyforge/tests/helpers/sfqa021-world-sharing-carrier.ts'),
      load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts'),
      load<typeof import('../../src/lib/world-engine/releases')>('/storyforge/src/lib/world-engine/releases.ts'),
      load<typeof import('../../src/lib/world-engine/world-package')>('/storyforge/src/lib/world-engine/world-package.ts'),
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../../src/lib/registry/project-tables')>('/storyforge/src/lib/registry/project-tables.ts'),
    ])
    const f = await fixtures.createSfqa021WorldSharingCarrierV1(5)
    const consumer = await workspaces.seedCurrentWorkspace('F3浏览器来源库', { purpose: 'world-engine' })
    const revision = await releases.createWorldRevision({ scope: consumer.scope, label: '独立作者原版', formatVersion: 3 })
    const own = await releases.publishWorldRevision(revision.id!)
    const b = await packages.createWorldPackage(f.release.id!, { ...f.pkg.manifest, attribution: '第二份声明B',
      allowedUses: { ...f.pkg.manifest.allowedUses, ttrpg: false, avg: true }, transport: 'dictionary-v1' })
    const wireA = JSON.stringify(f.pkg, null, 2) + '\n', wireB = JSON.stringify(b)
    const aProof = await packages.captureWorldSourceWireV1(wireA), bProof = await packages.captureWorldSourceWireV1(wireB)
    return JSON.stringify({ projectId: consumer.scope.projectId, worldId: consumer.scope.worldId,
      wireA, wireB, keyA: aProof.frozenRelease.releaseUid + ':' + aProof.declaration.declarationHash,
      keyB: bProof.frozenRelease.releaseUid + ':' + bProof.declaration.declarationHash,
      attributionA: f.pkg.manifest.attribution, warningsA: f.pkg.manifest.contentWarnings,
      ownReleaseId: own.id!, ownHash: own.contentHash,
      beforeWorld: JSON.stringify(await schema.db.worlds.get(consumer.scope.worldId)), beforeProjects: await schema.db.projects.count(),
      semanticCounts: await Promise.all(registry.PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => spec.table.count())) })
  })
  const seed = JSON.parse(seedWire)
  await page.goto('./world/sharing?project=' + seed.projectId)
  const panel = page.getByRole('region', { name: '世界发布与导入', exact: true })
  const picker = panel.getByLabel('选择来源声明', { exact: true })
  const file = panel.getByLabel('选择世界分享包', { exact: true })
  await file.setInputFiles({ name: 'readonly-original.json', mimeType: 'application/json', buffer: Buffer.from(seed.wireA) })
  await expect(panel.getByTestId('world-package-preview')).toContainText('分享包预检通过')
  await expect(panel.getByRole('button', { name: '确认导入纯语义世界', exact: true })).toBeDisabled()
  await panel.getByRole('button', { name: '保存为只读来源', exact: true }).click()
  await expect(panel.getByRole('status')).toContainText('已保存只读来源')
  await expect(picker.locator('option')).toHaveCount(2)
  await expect(picker).toHaveValue('')
  await expect(panel.getByRole('button', { name: '下载所选原来源包', exact: true })).toBeDisabled()
  await expect(page).toHaveURL(new URL('./world/sharing?project=' + seed.projectId, baseURL).href)
  const snapshot = await page.evaluate(async (seedJson: string) => {
    const seed = JSON.parse(seedJson)
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [schema, registry] = await Promise.all([
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../../src/lib/registry/project-tables')>('/storyforge/src/lib/registry/project-tables.ts'),
    ])
    const row = await schema.db.worldSourceReceipts.where('worldId').equals(seed.worldId).first()
    return JSON.stringify({ raw: row?.wireJson, world: JSON.stringify(await schema.db.worlds.get(seed.worldId)),
      projects: await schema.db.projects.count(), runs: await schema.db.agentRuns.count(),
      derivations: await schema.db.worldDerivations.where('worldId').equals(seed.worldId).count(),
      semanticCounts: await Promise.all(registry.PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => spec.table.count())) })
  }, seedWire)
  const actual = JSON.parse(snapshot)
  expect(actual.raw).toBe(seed.wireA); expect(actual.world).toBe(seed.beforeWorld)
  expect(actual.projects).toBe(seed.beforeProjects); expect(actual.semanticCounts).toEqual(seed.semanticCounts)
  expect(actual.runs).toBe(0); expect(actual.derivations).toBe(0)
  await picker.selectOption(seed.keyA)
  const details = panel.getByTestId('world-source-declaration')
  await expect(details).toContainText('跑团：允许')
  expect(await details.getByLabel('来源署名要求', { exact: true }).textContent()).toBe(seed.attributionA)
  for (const warning of seed.warningsA) await expect(details).toContainText(warning)
  const firstDownload = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下载所选原来源包', exact: true }).click()
  expect(await readDownload(await firstDownload)).toBe(seed.wireA)
  await file.setInputFiles({ name: 'second-declaration.json', mimeType: 'application/json', buffer: Buffer.from(seed.wireB) })
  await expect(panel.getByTestId('world-package-preview')).toContainText('第二份声明B')
  await panel.getByRole('button', { name: '保存为只读来源', exact: true }).click()
  await expect(picker.locator('option')).toHaveCount(3)
  await expect(picker).toHaveValue(seed.keyA)
  await expect(details).toContainText('跑团：允许')
  await picker.selectOption(seed.keyB)
  await expect(details).toContainText('跑团：不允许'); await expect(details).toContainText('AVG：允许')
  const secondDownload = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下载所选原来源包', exact: true }).click()
  expect(await readDownload(await secondDownload)).toBe(seed.wireB)
  await panel.getByLabel('分享世界版本', { exact: true }).selectOption(String(seed.ownReleaseId))
  await panel.getByLabel('作者署名', { exact: true }).fill('F3独立作者')
  const ownDownload = page.waitForEvent('download')
  await panel.getByRole('button', { name: '下载世界分享包', exact: true }).click()
  const own = JSON.parse(await readDownload(await ownDownload))
  expect(own.manifest.authorName).toBe('F3独立作者'); expect(own.manifest.releaseHash).toBe(seed.ownHash)
  await page.reload()
  await expect(picker.locator('option')).toHaveCount(3); await expect(picker).toHaveValue('')
  await picker.selectOption(seed.keyB); await expect(details).toContainText('第二份声明B')
  const beforeInvalid = await page.evaluate(async () => {
    const { PROJECT_TABLES } = await (new Function('return import("/storyforge/src/lib/registry/project-tables.ts")') as () => Promise<typeof import('../../src/lib/registry/project-tables')>)()
    return Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
  })
  await file.setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('invalid JSON') })
  await expect(panel.getByRole('alert')).toContainText('无法读取分享包')
  await expect(picker).toHaveValue(seed.keyB)
  const afterInvalid = await page.evaluate(async () => {
    const { PROJECT_TABLES } = await (new Function('return import("/storyforge/src/lib/registry/project-tables.ts")') as () => Promise<typeof import('../../src/lib/registry/project-tables')>)()
    return Promise.all(PROJECT_TABLES.map(spec => spec.table.count()))
  })
  expect(afterInvalid).toEqual(beforeInvalid)
  expect(external).toEqual([])
})
