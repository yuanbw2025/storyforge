import { test, expect } from '@playwright/test'

for (const format of ['scripted', 'open'] as const) test(`${format}: an unpublished saved route cannot lose the newly created Work on immediate navigation`, async ({ page }, info) => {
  test.skip(format === 'open' && process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview')
  await page.goto('./ttrpg/library')
  await page.getByRole('button', { name: format === 'open' ? '新建开放跑团（预览）' : '新建战役', exact: true }).click()
  const title = `${format} 刚保存的作品身份`
  await page.getByLabel('战役名称', { exact: true }).fill(title)
  // Hold React Router's NEW query projection, while its real history update and
  // the old page's urgent save-completion render remain observable. This models
  // the actual live acceptance race, without forging URLs/DB rows or delaying
  // domain save. URL.searchParams remains the browser's native query object.
  await page.evaluate(() => {
    const Native = window.URLSearchParams
    let release!: () => void, held = true
    const gate = new Promise<void>(resolve => { release = resolve })
    ;(globalThis as any).__heldCreatedRouteReads = 0
    class PendingRouteParams extends Native {
      get(key: string) {
        const value = super.get(key)
        if (held && key === 'project' && value && super.get('work')) {
          ;(globalThis as any).__heldCreatedRouteReads++
          throw gate
        }
        return value
      }
    }
    window.URLSearchParams = PendingRouteParams
    ;(globalThis as any).__releaseCreatedRoute = () => { held = false; window.URLSearchParams = Native; release() }
  })
  await page.getByRole('button', { name: '保存制作方案', exact: true }).click()
  await expect(page).toHaveURL(/project=/)
  const saved = new URL(page.url())
  await expect.poll(() => page.evaluate(() => (globalThis as any).__heldCreatedRouteReads)).toBeGreaterThan(0)
  await expect(page.getByLabel('战役名称', { exact: true })).toHaveValue(title)
  await expect(page.getByLabel('战役名称', { exact: true })).toBeDisabled()
  // UI navigation is allowed to retain the address; a second save must not
  // create a second Work while the first route has not reached the component.
  const content = page.getByRole('navigation', { name: '跑团内容导航', exact: true })
  await content.getByRole('button', { name: '规则与村规', exact: true }).click()
  const navigated = new URL(page.url())
  await page.evaluate(() => { (globalThis as any).__releaseCreatedRoute(); delete (globalThis as any).__releaseCreatedRoute })
  expect(navigated.pathname).toMatch(/\/ttrpg\/rules$/)
  expect(navigated.searchParams.get('project')).toBe(saved.searchParams.get('project'))
  expect(navigated.searchParams.get('work')).toBe(saved.searchParams.get('work'))
  await expect(page.getByLabel('战役名称', { exact: true })).toHaveValue(title)
  const proof = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    return { drafts: await db.ttrpgAuthoringDrafts.toArray(), works: await db.works.toArray(),
      runs: await db.agentRuns.count(), builds: await db.productBuilds.count() }
  })
  expect(proof.drafts).toHaveLength(1); expect(proof.works.filter((work: any) => work.kind === 'ttrpg')).toHaveLength(1)
  expect(proof.drafts[0].workId).toBe(Number(saved.searchParams.get('work')))
  expect(proof.runs).toBe(0); expect(proof.builds).toBe(0)
  if (format === 'open') await expect(page.getByRole('button', { name: '预览内置开放 2d6 规则', exact: true })).toBeVisible()
  await info.attach('real-save-unpublished-route-and-next-owner', { body: JSON.stringify({ saved: saved.href, navigated: navigated.href, proof }), contentType: 'application/json' })
})
