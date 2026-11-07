import { expect, test, type Page } from '@playwright/test'

async function prepare(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'ollama',
      baseUrl: 'https://sfqa043-model-test.invalid/v1', model: 'no-model-used' }))
  })
  await page.route('https://sfqa043-model-test.invalid/**', route => route.abort())
  await page.goto('./')
  return page.evaluate(async () => {
    const { createSfqa043ComicFixtureV1, addSfqa043MediaAndPageV1 } = await (new Function(
      'return import("/storyforge/tests/helpers/sfqa043-comic.ts")',
    ) as () => Promise<typeof import('../helpers/sfqa043-comic')>)()
    const f = await createSfqa043ComicFixtureV1()
    await addSfqa043MediaAndPageV1(f)
    return { scope: f.scope, rootId: f.adaptation.id!, bindingId: f.bindingId }
  })
}

async function readState(page: Page, rootId: number) {
  return page.evaluate(async rootId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")') as () => Promise<typeof import('../../src/lib/db/schema')>)()
    const root = await db.adaptationProjects.get(rootId)
    if (!root) throw new Error('missing real comic root')
    return { root, subjects: await db.comicVisualSubjects.where('adaptationProjectId').equals(rootId).toArray(),
      assets: await db.comicMediaAssets.where('adaptationProjectId').equals(rootId).toArray(),
      panels: await db.comicPanels.where('workId').equals(root.workId).toArray(),
      blobs: (await db.mediaBlobObjects.toArray()).map(row => {
        if (!row.data) throw new Error('Expected the fixture image bytes in the real IndexedDB blob')
        return { ...row, data: [...new Uint8Array(row.data)] }
      }),
      bindings: await db.workCharacterBindings.toArray(), characters: await db.characters.toArray(),
      runs: await db.agentRuns.count() }
  }, rootId)
}

async function confirmUpdate(page: Page) {
  await page.getByRole('button', { name: '确认视觉圣经', exact: true }).click()
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '备份并替换', exact: true }).click()])
}

test('SFQA043: bound subject author form preserves identity and real images, clears prior visual review and survives reload', async ({ page }) => {
  const f = await prepare(page), before = await readState(page, f.rootId)
  expect(before.subjects[0].characterId).not.toBeNull()
  expect(before.subjects[0].selectedMediaAssetKey).not.toBeNull()
  expect(before.panels[0].visualReviewBasis).toBe('author-visual')
  await page.goto(`./comic/visual?work=${f.scope.workId}`)
  const description = page.getByLabel('段落 第1项 外观设计 设计描述', { exact: true })
  await expect(description).toHaveValue('短发、深色风衣')
  await description.fill('作者确认的新设计：短发、保留银色票夹与深色风衣')
  await confirmUpdate(page)
  await expect(page.getByText('视觉圣经已确认', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  const after = await readState(page, f.rootId)
  expect(after.root.revision).toBe(before.root.revision + 1)
  expect(after.subjects[0]).toMatchObject({ id: before.subjects[0].id, stableKey: before.subjects[0].stableKey,
    characterId: before.subjects[0].characterId, selectedMediaAssetKey: before.subjects[0].selectedMediaAssetKey,
    revision: before.subjects[0].revision + 1 })
  expect(after.subjects[0].design.description).toContain('作者确认的新设计')
  expect(after.assets).toEqual(before.assets); expect(after.blobs).toEqual(before.blobs)
  expect(after.bindings).toEqual(before.bindings); expect(after.characters).toEqual(before.characters)
  expect(after.panels[0]).toMatchObject({ selectedMediaAssetKey: before.panels[0].selectedMediaAssetKey,
    visualReviewRevision: null, visualReviewBasis: null, visualReviewedAt: null })
  expect(after.runs).toBe(0)
  await page.reload()
  await expect(description).toHaveValue('作者确认的新设计：短发、保留银色票夹与深色风衣')
  expect(await readState(page, f.rootId)).toEqual(after)
})

test('SFQA043: invalid real binding blocks actual confirmation without writes and retains the author draft after refresh', async ({ page }) => {
  const f = await prepare(page)
  await page.evaluate(async bindingId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")') as () => Promise<typeof import('../../src/lib/db/schema')>)()
    await db.workCharacterBindings.delete(bindingId)
  }, f.bindingId)
  const before = await readState(page, f.rootId)
  await page.goto(`./comic/visual?work=${f.scope.workId}`)
  const description = page.getByLabel('段落 第1项 外观设计 设计描述', { exact: true })
  await expect(description).toHaveValue('短发、深色风衣')
  await description.fill('绑定待核查时作者输入仍要保留')
  await confirmUpdate(page)
  await expect(page.getByRole('alert')).toContainText('已有角色绑定已失效')
  expect(await readState(page, f.rootId)).toEqual(before)
  await page.reload()
  await expect(description).toHaveValue('绑定待核查时作者输入仍要保留')
  expect(await readState(page, f.rootId)).toEqual(before)
})
