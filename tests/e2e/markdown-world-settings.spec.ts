import { expect, test, type Page } from '@playwright/test'

const raw = '# 原始世界🌊\r\n\r\n**事实**：第七年。\r\n\r\n| 地点 | 状态 |\r\n| --- | --- |\r\n| 海港 | 开放 |\r\n\r\n![不加载](https://blocked.invalid/image.png)\r\n  '
async function flush(page: Page) {
  await page.evaluate(async () => {
    const path = '/storyforge/src/lib/authoring/pending-edit-coordinator.ts'
    await (await import(path)).flushPendingEditsV1()
  })
}
async function read(page: Page, projectId: number) {
  return page.evaluate(async projectId => {
    const path = '/storyforge/src/lib/db/schema.ts'
    return (await import(path)).db.worldviews.where('projectId').equals(projectId).first()
  }, projectId)
}
for (const purpose of ['independent-work', 'world-engine'] as const) {
  test(`${purpose}: real origin/humanity panels read Markdown, commit raw source and retain it after reopening`, async ({ page, context, baseURL }) => {
    const origin = new URL(baseURL!).origin
    let forbidden = 0
    await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '051-isolated-world-settings'))
    await context.route('**/*', route => {
      const request = route.request()
      if (new URL(request.url()).origin !== origin || !['GET', 'HEAD'].includes(request.method())) { forbidden++; return route.abort() }
      return route.continue()
    })
    await page.goto('./')
    const projectId = await page.evaluate(async ({ purpose, raw }) => {
      const root = '/storyforge/src/lib/'
      const { createWorkspace } = await import(root + 'workspace/create-workspace.ts')
      const { useWorldviewStore } = await import('/storyforge/src/stores/worldview.ts')
      const { scope } = await createWorkspace({ name: '051 isolated world settings', description: '', genres: [], status: 'drafting', targetWordCount: 1000 },
        { purpose, kind: 'novel', novelProfile: 'long' })
      await useWorldviewStore.getState().loadAll(scope)
      await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldOrigin: raw, races: raw }, scope)
      return scope.projectId
    }, { purpose, raw })
    const url = (module: string) => purpose === 'independent-work'
      ? `./workspace/${projectId}?module=${module}`
      : `./world/${module === 'worldview-origin' ? 'basics' : 'society'}?project=${projectId}&module=${module}`
    for (const [module, field] of [['worldview-origin', 'worldOrigin'], ['worldview-humanity', 'races']] as const) {
      await page.goto(url(module))
      const view = page.locator('[data-markdown-read-view]:visible').first()
      await expect(view.locator('h1')).toHaveText('原始世界🌊')
      await expect(view.locator('table')).toHaveCount(1)
      expect((await read(page, projectId))[field]).toBe(raw)
      await view.getByRole('button', { name: '编辑源码', exact: true }).click()
      const input = page.locator('textarea:visible').first()
      await expect(input).toBeVisible()
      await input.fill(`# 已编辑 ${field}\n\n**事实**：仍是第七年。  `)
      const submitted = await input.inputValue()
      await flush(page)
      await expect(page.locator('[data-markdown-read-view]:visible').first().locator('h1')).toHaveText(`已编辑 ${field}`)
      expect((await read(page, projectId))[field]).toBe(submitted)
      await page.reload(); await expect(page.locator('[data-markdown-read-view]:visible').first().locator('h1')).toHaveText(`已编辑 ${field}`)
      const reopened = await context.newPage(); await reopened.goto(new URL(url(module), baseURL).href)
      await expect(reopened.locator('[data-markdown-read-view]:visible').first().locator('h1')).toHaveText(`已编辑 ${field}`)
      expect((await read(reopened, projectId))[field]).toBe(submitted)
      await reopened.close()
    }
    expect(forbidden).toBe(0)
  })
}
