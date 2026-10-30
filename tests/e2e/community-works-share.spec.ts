import { expect, test } from '@playwright/test'

test('community sharing stays hidden by default and previews only author-selected novel data when enabled', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol)
      ? route.continue() : route.abort()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'community-share-e2e'))
  await page.goto('/storyforge/long?module=outline')
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByLabel('新长篇名称').fill('社区隔离浏览器验证')
  await page.getByRole('button', { name: '创建并进入工作台', exact: true }).click()
  await page.locator('[data-workspace-ready=longform]').waitFor()

  const sharingEnabled = process.env.VITE_STORYFORGE_COMMUNITY_SHARING === '1'
  if (!sharingEnabled) {
    await expect(page.getByRole('button', { name: '分享至社区作品集' })).toHaveCount(0)
    expect(pageErrors).toEqual([])
    return
  }

  const owner = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { stampNewRecord } = await importer('/storyforge/src/lib/workspace/scope.ts')
    const work = (await db.works.toArray()).find((row: { kind: string }) => row.kind === 'novel')
    if (!work?.id || !work.worldId) throw new Error('Missing isolated novel work')
    await db.works.update(work.id, { description: '私有作品简介', genres: ['私有流派'] })
    const scope = { projectId: work.projectId, worldId: work.worldId, workId: work.id }
    for (const [order, title, content] of [
      [0, '公开第一章', '只选这一章的正文'],
      [1, '私有第二章', '未选择的正文绝不上传'],
    ] as const) {
      const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
        type: 'chapter', parentId: null, title, summary: '', order, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }))
      await db.chapters.add(stampNewRecord(scope, 'chapters', {
        outlineNodeId, title, content, notes: '私有笔记', wordCount: content.length,
        status: 'final', order, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }))
    }
    return { projectId: work.projectId, workId: work.id }
  })
  await page.goto(`/storyforge/workspace/${owner.projectId}?module=info`)
  await page.getByRole('button', { name: '分享至社区作品集' }).click()
  const panel = page.getByRole('region', { name: '选择小说公开章节' })
  await expect(panel).toBeVisible()
  const boxes = panel.locator('input[type=checkbox]')
  await expect(boxes).toHaveCount(4)
  for (let index = 0; index < 4; index++) await expect(boxes.nth(index)).not.toBeChecked()

  await boxes.nth(2).check()
  await panel.getByRole('checkbox', { name: /我确认拥有所选内容/ }).check()
  await panel.getByRole('button', { name: '生成公开预览' }).click()
  const preview = page.getByLabel('投稿公开预览')
  await expect(preview).toContainText('只选这一章的正文')
  for (const privateText of ['未选择的正文绝不上传', '私有笔记', '私有作品简介', '私有流派']) {
    await expect(preview).not.toContainText(privateText)
  }

  await boxes.nth(0).check()
  await boxes.nth(1).check()
  await panel.getByRole('button', { name: '生成公开预览' }).click()
  await expect(preview).toContainText('私有作品简介')
  await expect(preview).toContainText('公开流派：私有流派')
  const saved = await page.evaluate(async workId => {
    const { db } = await (new Function('return import("/storyforge/src/lib/db/schema.ts")'))()
    const rows = await db.chapters.toArray()
    return rows.filter((row: { workId: number }) => row.workId === workId)
      .map((row: { content: string; notes: string }) => ({ content: row.content, notes: row.notes }))
  }, owner.workId)
  expect(saved).toHaveLength(2)
  expect(saved.every((row: { notes: string }) => row.notes === '私有笔记')).toBe(true)
  expect(pageErrors).toEqual([])
})
