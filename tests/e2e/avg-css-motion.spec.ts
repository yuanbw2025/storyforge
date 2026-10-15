import { test, expect, type Page } from '@playwright/test'

async function openMovingStage(page: Page, reading: boolean) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  await expect(page.getByRole('button', { name: '新建 AVG', exact: true })).toBeVisible({ timeout: 30_000 })
  const source = await page.evaluate(async reading => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await load('/storyforge/tests/helpers/avg-release-fixture.ts')).prepareAvgMediaReleasePreview(async (workspace: any, context: any) => {
      if (!reading) delete workspace.presentation.reading
      workspace.systemPlan.characters.push({ key: 'calibration', displayName: '舞台校准角色' })
      const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 200
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#d4c3a0'; ctx.fillRect(20, 10, 60, 190)
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
      const actor = await (await load('/storyforge/src/lib/avg/editor-service.ts')).importAvgMediaForAssemblyV1({
        scope: context.scope, name: '原创角色轮廓校准图', kind: 'character-pose', data: await blob.arrayBuffer(), mimeType: 'image/png',
        license: 'CC0-1.0 原创工程校准图', altText: '角色轮廓', characterTag: 'calibration',
      })
      workspace.presentation.stage.assets.push(actor)
      workspace.presentation.stage.cues = workspace.presentation.stage.cues.filter((cue: any) => cue.type !== 'set-tone')
      const add = (cueKey: string, type: string, durationMs: number, order: number, extra = {}) =>
        workspace.presentation.stage.cues.push({ cueKey, type, durationMs, order, phase: 'before', beatKey: 'line.dark', easing: 'linear', ...extra })
      add('actor.initial', 'show-actor', 0, 9, { actorKey: 'calibration', assetKey: actor.assetKey, slot: 'center' })
      add('motion.wait', 'wait', 700, 10)
      add('motion.camera', 'camera', 5000, 11, { x: 2, y: 1, scale: 1.2 })
      add('motion.tone', 'set-tone', 5000, 12, { tone: 'warm' })
      add('motion.actor', 'move-actor', 5000, 13, { actorKey: 'calibration', slot: 'left', x: 2, y: 1, scale: 1.15, opacity: .8 })
    })
  }, reading)
  await page.goto(`./avg/play?project=${source.scope.projectId}&work=${source.scope.workId}&session=${source.sessionId}`)
  await expect.poll(() => page.locator('.avg-stage-scene').evaluate(element => element.getAnimations({ subtree: true })
    .filter(animation => animation instanceof CSSTransition && animation.effect?.getTiming().duration === 5000 && animation.playState === 'running').length)).toBeGreaterThanOrEqual(5)
}

async function cssMotion(page: Page) {
  return page.locator('.avg-stage-scene').evaluate(element => {
    const actor = element.querySelector('.avg-actor')!
    const sceneStyle = getComputedStyle(element), actorStyle = getComputedStyle(actor)
    const animations = element.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSAnimation || animation instanceof CSSTransition)
    return { frame: { camera: sceneStyle.transform, tone: sceneStyle.filter, actor: actorStyle.transform, entrance: actorStyle.translate, left: actorStyle.left, opacity: actorStyle.opacity },
      active: animations.filter(animation => animation.playState === 'running').length,
      paused: animations.filter(animation => animation.playState === 'paused' && !animation.pending).length }
  })
}

async function expectFrozen(page: Page) {
  await expect.poll(async () => (await cssMotion(page)).active).toBe(0)
  await expect.poll(async () => (await cssMotion(page)).paused).toBeGreaterThanOrEqual(5)
  const frame = (await cssMotion(page)).frame
  // Observe actual computed frames for longer than a normal entrance animation.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
  expect((await cssMotion(page)).frame).toEqual(frame)
  return frame
}

test('reading history pauses camera, tone and actor CSS motion, resumes in place and never replays finished transitions', async ({ page }, info) => {
  test.setTimeout(120_000)
  await openMovingStage(page, true)
  await page.getByRole('button', { name: '历史', exact: true }).click()
  const frame = await expectFrozen(page)
  await page.screenshot({ path: info.outputPath('avg-css-history-paused.png') })
  await page.getByRole('dialog', { name: '历史回看' }).getByRole('button', { name: '关闭', exact: true }).click()
  await expect.poll(async () => (await cssMotion(page)).frame.camera).not.toBe(frame.camera)
  await expect.poll(async () => (await cssMotion(page)).active, { timeout: 10_000 }).toBe(0)
  const finished = (await cssMotion(page)).frame
  await page.getByRole('button', { name: '历史', exact: true }).click()
  await page.getByRole('dialog', { name: '历史回看' }).getByRole('button', { name: '关闭', exact: true }).click()
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
  expect((await cssMotion(page)).frame).toEqual(finished)
  expect((await cssMotion(page)).active).toBe(0)
})

test('without reading, settings and background pause CSS motion including new image entrances while the menu stays open', async ({ page }) => {
  test.setTimeout(120_000)
  await openMovingStage(page, false)
  const settings = page.locator('summary[aria-label="设置"]')
  await settings.click()
  await expectFrozen(page)
  await page.getByRole('button', { name: '图片', exact: true }).click()
  await expect(page.locator('.avg-actor')).toHaveCount(0)
  await page.getByRole('button', { name: '图片', exact: true }).click()
  await expect.poll(() => page.locator('.avg-actor').evaluate(element => element.getAnimations()
    .some(animation => animation instanceof CSSAnimation && animation.playState === 'paused' && !animation.pending))).toBe(true)
  const actorFrame = (await cssMotion(page)).frame.actor
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
  expect((await cssMotion(page)).frame.actor).toBe(actorFrame)
  await settings.click()
  await expect.poll(async () => (await cssMotion(page)).active).toBeGreaterThan(0)
  // Exercise the real visibility handler; this does not certify OS tab behavior.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(async () => (await cssMotion(page)).active).toBe(0)
  const hidden = (await cssMotion(page)).frame
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)))
  expect((await cssMotion(page)).frame).toEqual(hidden)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(async () => (await cssMotion(page)).frame.camera).not.toBe(hidden.camera)
})
