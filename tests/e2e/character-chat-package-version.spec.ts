import {expect, test} from '@playwright/test'

for (const width of [390, 1440]) test(`a first installation of version 2 keeps its identity through UI backup and independent restore at ${width}px`, async ({page, browser}) => {
  await page.goto('./chat/library')
  const base = page.url().replace(/chat\/library.*$/, '')
  const packages = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await load('/storyforge/tests/helpers/chat-experience-package-fixture.ts')).seedChatExperiencePackageFixture({
      experienceInfo: {version: 1, author: '版本工程作者', attribution: '', usageTerms: '测试内容，不授予对外分发许可'},
    })
  })
  const receiving = await browser.newContext({viewport: {width, height: 844}})
  const restoring = await browser.newContext({viewport: {width, height: 844}})
  let calls = 0
  try {
    for (const context of [receiving, restoring]) {
      await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
      for (const pattern of ['**/chat/completions', '**/images/generations', '**/local-codex/v1/requests']) await context.route(pattern, async route => {
        if (route.request().method() === 'POST') {calls++; await route.abort()} else await route.continue()
      })
    }
    const receiver = await receiving.newPage()
    await receiver.goto(base + 'chat/library')
    await receiver.getByLabel('作品名称', {exact: true}).fill('先装新版的作品')
    await receiver.getByRole('button', {name: '新建角色聊天', exact: true}).click()
    await expect(receiver).toHaveURL(/chat\/vision\?/)
    const query = new URL(receiver.url()).search
    await receiver.goto(base + 'chat/play' + query)
    const panel = receiver.getByLabel('角色聊天体验包', {exact: true})
    await panel.locator('summary').first().click()
    await panel.getByLabel('体验包文件', {exact: true}).setInputFiles({
      name: 'version-2.game.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(packages.illustrated)),
    })
    await panel.getByRole('button', {name: '确认安装此体验包', exact: true}).click()
    const card = receiver.getByRole('article', {name: '驿站工程核验 · 版本 2', exact: true})
    await expect(card).toBeVisible()
    await card.getByRole('button', {name: '新建会话', exact: true}).click()
    await expect(receiver.getByRole('region', {name: '对话记录', exact: true})).toBeVisible()
    await receiver.goto(base + 'chat/release' + query)
    const pending = receiver.waitForEvent('download')
    await receiver.getByRole('button', {name: '导出制作与存档备份', exact: true}).click()
    const stream = await (await pending).createReadStream(), chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    expect(backup.productReleases).toHaveLength(1)
    expect(backup.productReleases[0].version).toBe(2)
    const restored = await restoring.newPage()
    await restored.goto(base + 'chat/library')
    const scope = await restored.evaluate(async backup => {
      const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
      const projectId = await (await load('/storyforge/src/lib/export/json-export.ts')).importProjectJSON(backup)
      const work = await db.works.where('projectId').equals(projectId).first()
      return {projectId, workId: work.id, releases: await db.productReleases.where('projectId').equals(projectId).toArray(),
        sessions: await db.productRuntimeSessions.where('projectId').equals(projectId).toArray(),
        worlds: await db.worldReleases.where('projectId').equals(projectId).count(),
        runs: await db.agentRuns.where('projectId').equals(projectId).count()}
    }, backup)
    expect(scope.releases.map((release: {version: number}) => release.version)).toEqual([2])
    expect(scope.sessions).toHaveLength(1)
    expect(scope.worlds).toBe(0); expect(scope.runs).toBe(0); expect(calls).toBe(0)
    await restored.goto(`${base}chat/play?project=${scope.projectId}&work=${scope.workId}`)
    await expect(restored.getByRole('region', {name: '对话记录', exact: true})).toBeVisible()
    await restored.getByRole('button', {name: '作品与存档', exact: true}).click()
    const restoredCard = restored.getByRole('article', {name: '驿站工程核验 · 版本 2', exact: true})
    await expect(restoredCard).toBeVisible()
    await restoredCard.getByLabel('作者与使用说明', {exact: true}).locator('summary').click()
    await expect(restoredCard).toContainText('版本工程作者')
    expect(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(calls).toBe(0)
  } finally {
    await receiving.close()
    await restoring.close()
  }
})
