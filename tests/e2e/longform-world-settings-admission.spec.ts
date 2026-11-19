import { expect, test } from '@playwright/test'

test('world settings leave the longform layout while the next active Work read is pending', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/*', route => {
    const request = route.request()
    return new URL(request.url()).origin === new URL(test.info().project.use.baseURL!).origin
      && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
  const ids = await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)')
    const { seedCurrentWorkspace } = await imp('/storyforge/tests/helpers/current-workspace.ts')
    const { createWorldWork } = await imp('/storyforge/src/lib/workspace/works.ts')
    const { scope } = await seedCurrentWorkspace('世界设定布局身份验收')
    const short = await createWorldWork(scope.projectId, {
      title: '同工作区短篇', kind: 'novel', novelProfile: 'short', targetWordCount: 10_000,
    })
    return { projectId: scope.projectId, longId: scope.workId, shortId: short.id }
  })
  await page.goto(`./workspace/${ids.projectId}?module=worldview-natural`)
  await expect(page.locator('.lf-world-settings')).toBeVisible()
  await page.evaluate(async ids => {
    const imp = new Function('p', 'return import(p)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { switchActiveWork } = await imp('/storyforge/src/lib/workspace/works.ts')
    const { useProjectStore } = await imp('/storyforge/src/stores/project.ts')
    await switchActiveWork(ids.projectId, ids.shortId)
    const get = db.works.get.bind(db.works)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    Object.assign(window, { activeWorkReadStarted: false, releaseActiveWorkRead: () => {
      db.works.get = get
      release()
    } })
    db.works.get = async (id: unknown) => {
      if (id === ids.shortId) {
        Object.assign(window, { activeWorkReadStarted: true })
        await gate
      }
      return get(id)
    }
    // Publish the persisted pointer without waiting for the deliberately held
    // Work read. The mounted hook still holds the previous long Work here.
    await useProjectStore.getState().loadProjects()
  }, ids)
  await expect.poll(() => page.evaluate(() => (window as unknown as {
    activeWorkReadStarted: boolean
  }).activeWorkReadStarted)).toBe(true)
  await expect(page.locator('.lf-world-settings')).toHaveCount(0)
  await page.evaluate(() => (window as unknown as { releaseActiveWorkRead: () => void }).releaseActiveWorkRead())
  await expect(page.locator('.short-json-editor')).toBeVisible()
  await page.evaluate(async ids => {
    const imp = new Function('p', 'return import(p)')
    const { switchActiveWork } = await imp('/storyforge/src/lib/workspace/works.ts')
    const { useProjectStore } = await imp('/storyforge/src/stores/project.ts')
    await switchActiveWork(ids.projectId, ids.longId)
    await useProjectStore.getState().loadProjects()
  }, ids)
  await page.goto(`./workspace/${ids.projectId}?module=worldview-natural`)
  await expect(page.locator('.lf-world-settings')).toBeVisible()
})
