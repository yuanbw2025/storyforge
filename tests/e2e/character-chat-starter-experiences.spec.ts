import {expect, test} from '@playwright/test'

for (const {width, title, actors} of [{width: 390, title: '潮汐前的灯', actors: 1}, {width: 1440, title: '末班渡轮的空座', actors: 3}]) {
  test(`an original starter creates an editable unapproved Work at ${width}px`, async ({page}, info) => {
    await page.setViewportSize({width, height: 844})
    await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
    let calls = 0
    for (const pattern of ['**/chat/completions', '**/images/generations', '**/local-codex/v1/requests']) await page.route(pattern, async route => {
      if (route.request().method() === 'POST') {calls++; await route.abort()} else await route.continue()
    })
    await page.goto('./chat/library')
    const read = () => page.evaluate(async () => {
      const {db} = await (new Function('p', 'return import(p)'))('/storyforge/src/lib/db/schema.ts')
      return {works: await db.works.toArray(), drafts: await db.chatAuthoringDrafts.toArray(), productions: await db.productProductions.count(),
        releases: await db.productReleases.count(), worlds: await db.worldReleases.count(), runs: await db.agentRuns.count()}
    })
    const count = (await read()).works.length, panel = page.getByLabel('原创体验起稿', {exact: true})
    await expect(panel.getByRole('button', {name: `查看《${title}》方案`, exact: true})).toHaveCount(0)
    await panel.getByLabel('查看原创体验起稿（实验性）', {exact: true}).check()
    await panel.getByRole('button', {name: `查看《${title}》方案`, exact: true}).click()
    await expect(panel.getByLabel('原创体验方案预览', {exact: true})).toBeVisible()
    expect((await read()).works).toHaveLength(count)
    await panel.getByRole('button', {name: '取消起稿', exact: true}).click()
    expect((await read()).works).toHaveLength(count)
    await panel.getByRole('button', {name: `查看《${title}》方案`, exact: true}).click()
    await panel.getByRole('button', {name: '使用此方案新建作品（实验性）', exact: true}).click()
    await expect(page).toHaveURL(/chat\/vision\?/)
    await expect(page.getByLabel('作品名称', {exact: true})).toHaveValue(title)
    const first = await read(), work = first.works.find((row: {title: string}) => row.title === title)!
    const draft = first.drafts.find((row: {workId: number}) => row.workId === work.id)!, settings = JSON.parse(draft.settingsJson)
    expect(first.works).toHaveLength(count + 1)
    expect(settings.version).toBe(3); expect(settings.sourceReview).toBeNull(); expect(settings.privateCharacters).toHaveLength(actors)
    expect(draft.worldReleaseId).toBeNull(); expect(draft.productionId).toBeNull()
    await expect(page.getByLabel('随体验包提供作品署名与使用说明', {exact: true})).not.toBeChecked()
    await page.getByLabel('随体验包提供作品署名与使用说明', {exact: true}).check()
    await page.getByLabel('作品署名', {exact: true}).fill('原创起稿工程作者')
    await page.getByLabel('素材归属与致谢', {exact: true}).fill('所有文字仅用于工程验证')
    await page.getByLabel('作品使用说明', {exact: true}).fill('尚未发布，不作对外使用授权')
    await page.getByLabel('开场与场景目标', {exact: true}).fill('作者改写：先让大家安顿下来，再决定下一步。')
    await page.getByRole('button', {name: '保存方案', exact: true}).click()
    await expect(page.getByRole('status')).toContainText('方案已保存')
    await page.reload()
    await expect(page.getByLabel('作品署名', {exact: true})).toHaveValue('原创起稿工程作者')
    await expect(page.getByLabel('作品使用说明', {exact: true})).toHaveValue('尚未发布，不作对外使用授权')
    await expect(page.getByLabel('开场与场景目标', {exact: true})).toHaveValue('作者改写：先让大家安顿下来，再决定下一步。')
    await page.getByRole('navigation', {name: '角色聊天页内目录'}).getByRole('button', {name: '角色与场景', exact: true}).click()
    const names = page.getByRole('region', {name: '本体验新角色', exact: true}).getByRole('textbox', {name: /^新角色 \d+ 姓名$/})
    await expect(names).toHaveCount(actors)
    for (let index = 0; index < actors; index++) await expect(names.nth(index)).toHaveValue(settings.privateCharacters[index].name)
    const final = await read()
    expect(final.worlds).toBe(0); expect(final.productions).toBe(0); expect(final.releases).toBe(0); expect(final.runs).toBe(0); expect(calls).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({path: info.outputPath(`chat-starter-${width}.png`), fullPage: false})
  })
}
