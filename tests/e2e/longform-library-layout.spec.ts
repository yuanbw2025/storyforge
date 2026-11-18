import { expect, test, type Page } from '@playwright/test'

const longTitle = '长标题布局样本：' + '穿过群山寻找失落的钟声与来信'.repeat(7)

async function seedLibrary(page: Page) {
  await page.goto('./long')
  await expect(page.getByRole('button', { name: '新建长篇', exact: true })).toBeVisible()
  return page.evaluate(async title => {
    const imp = new Function('p', 'return import(p)')
    const { createWorkspace } = await imp('/storyforge/src/lib/workspace/create-workspace.ts')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 180
    const context = canvas.getContext('2d')!
    context.fillStyle = '#244e43'; context.fillRect(0, 0, 120, 180)
    context.fillStyle = '#ba9562'; context.fillRect(12, 14, 96, 2)
    const image = canvas.toDataURL('image/png')
    const rows = []
    for (const [index, [name, description]] of [
      ['潮汐来信', '海港、旧书与一封迟来的信。'],
      [title, '这是隔离的合成布局简介，验证长文本不会挤掉字数、日期或操作。'.repeat(8)],
      ['未命名的远方', ''], ['长夜归航', '一位守灯人的返乡之路。'],
    ].entries()) {
      const created = await createWorkspace({ name, description, genres: [], status: 'drafting', targetWordCount: 300000 },
        { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
      if (index === 0) await db.works.update(created.work.id, { coverImage: image })
      rows.push({ projectId: created.project.id, workId: created.work.id, title: name })
    }
    return { rows, image }
  }, longTitle)
}

for (const width of [1728, 1366, 390]) {
  test(`longform library keeps covers, complete titles and actions usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 })
    const { rows } = await seedLibrary(page)
    const cards = page.locator('.lf-library-card')
    await expect(cards).toHaveCount(4)
    await expect(cards.getByRole('heading', { name: longTitle, exact: true })).toBeVisible()
    await expect(cards.locator('.lf-library-cover img')).toHaveCount(1)
    await expect(cards.locator('.lf-library-cover-placeholder')).toHaveCount(3)
    const layout = await cards.evaluateAll(elements => elements.map(card => {
      const cover = card.querySelector('.lf-library-cover')!.getBoundingClientRect()
      const title = card.querySelector('h3')!
      const actions = card.querySelector('.lf-library-card-actions')!.getBoundingClientRect()
      return { ratio: cover.width / cover.height, clipped: title.scrollHeight > title.clientHeight + 1,
        overflow: card.scrollWidth > card.clientWidth + 1, actionsY: actions.y,
        rowY: card.getBoundingClientRect().y }
    }))
    for (const card of layout) {
      expect(card.ratio).toBeCloseTo(2 / 3, 1)
      expect(card.clipped).toBe(false)
      expect(card.overflow).toBe(false)
    }
    const firstRow = layout.filter(card => Math.abs(card.rowY - layout[0].rowY) < 2)
    expect(Math.max(...firstRow.map(card => card.actionsY)) - Math.min(...firstRow.map(card => card.actionsY))).toBeLessThan(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(await page.locator('.lf-content').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1)
    expect(await page.locator('.lf-library-toolbar').evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(width === 390 ? 150 : 75)
    await page.screenshot({ path: info.outputPath(`library-stress-${width}.png`), fullPage: true })
    // Keep a second visual sample with ordinary-length metadata, alongside the
    // unabridged title stress sample above. All records are isolated fixtures.
    await page.evaluate(async id => {
      const imp = new Function('p', 'return import(p)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts')
      await db.works.update(id, { title: '穿过群山，寻找失落的钟声', description: '旅人在山间寻找一座旧钟楼，也逐渐找回了来时的路。' })
    }, rows[1].workId)
    await expect(cards.getByRole('heading', { name: '穿过群山，寻找失落的钟声', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath(`library-${width}.png`), fullPage: true })
  })
}

test('empty, cancelled creation and no search results keep their distinct states', async ({ page }, info) => {
  await page.goto('./long')
  await expect(page.getByRole('heading', { name: '从你的第一个故事开始', exact: true })).toBeVisible()
  await page.screenshot({ path: info.outputPath('library-empty.png') })
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByLabel('新长篇名称').fill('取消创建的隔离样本')
  await page.locator('.lf-library-create').getByRole('button', { name: '取消', exact: true }).click()
  expect(await page.evaluate(async () => {
    const imp = new Function('p', 'return import(p)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return db.projects.count()
  })).toBe(0)
  await seedLibrary(page)
  await page.getByLabel('搜索长篇', { exact: true }).fill('不存在的检索样本')
  await expect(page.getByRole('heading', { name: '没有找到匹配的长篇', exact: true })).toBeVisible()
  await expect(page.locator('.lf-library-card')).toHaveCount(0)
  await page.getByRole('button', { name: '清除搜索', exact: true }).click()
  await expect(page.locator('.lf-library-card')).toHaveCount(4)
})

test('secondary actions retain rename, explicit manual cover saving, export and cancelled deletion', async ({ page }) => {
  const { rows, image } = await seedLibrary(page)
  const target = rows[0]
  const card = () => page.getByRole('article', { name: target.title, exact: true })
  await card().locator('summary').click()
  await card().getByRole('button', { name: '重命名', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(card().locator('details')).not.toHaveAttribute('open')
  await card().locator('summary').click()
  await card().getByRole('button', { name: '重命名', exact: true }).click()
  await page.getByLabel('新作品名称').fill('更名后的潮汐来信')
  await page.getByRole('button', { name: '保存名称', exact: true }).click()
  target.title = '更名后的潮汐来信'
  await expect(card()).toBeVisible()
  await card().getByRole('button', { name: `修改封面：${target.title}`, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/home/cover\\?work=${target.workId}$`))
  const replacement = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 180
    const context = canvas.getContext('2d')!; context.fillStyle = '#963a50'; context.fillRect(0, 0, 120, 180)
    return canvas.toDataURL('image/png')
  })
  const upload = () => page.getByLabel('上传封面', { exact: true }).setInputFiles({ name: 'synthetic-cover.png', mimeType: 'image/png', buffer: Buffer.from(replacement.split(',')[1], 'base64') })
  await upload()
  await expect(page.getByAltText(`${target.title}的封面预览`)).toHaveAttribute('src', replacement)
  expect(await page.evaluate(async id => {
    const imp = new Function('p', 'return import(p)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return (await db.works.get(id)).coverImage
  }, target.workId)).toBe(image)
  await page.goto('./long')
  await expect(card().locator('.lf-library-cover img')).toHaveAttribute('src', image)
  await card().getByRole('button', { name: `修改封面：${target.title}`, exact: true }).click()
  await upload()
  await expect(page.getByAltText(`${target.title}的封面预览`)).toHaveAttribute('src', replacement)
  await page.getByRole('button', { name: '保存封面', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('封面已保存')
  await page.goto('./long')
  await expect(card().locator('.lf-library-cover img')).toHaveAttribute('src', replacement)
  expect(await page.evaluate(async id => {
    const imp = new Function('p', 'return import(p)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return (await db.works.toArray()).filter((work: { id: number }) => work.id !== id).some((work: { coverImage?: string }) => !!work.coverImage)
  }, target.workId)).toBe(false)
  expect(await page.evaluate(async ids => {
    const imp = new Function('p', 'return import(p)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return Promise.all(ids.map(async id => !!(await db.works.get(id))?.coverImage))
  }, rows.map(row => row.workId))).toEqual([true, false, false, false])
  await card().locator('summary').click()
  await card().getByRole('button', { name: '导出与备份', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/workspace/${target.projectId}.*module=(export|data-management)`))
  await page.goto('./long')
  await card().locator('summary').click()
  await card().getByRole('button', { name: '删除作品', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  await expect(card()).toBeVisible()
  expect(await page.evaluate(async id => {
    const imp = new Function('p', 'return import(p)'); const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return !!await db.works.get(id)
  }, target.workId)).toBe(true)
})
