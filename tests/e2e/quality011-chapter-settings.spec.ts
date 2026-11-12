import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

async function stored(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ db }, { resolveScope, readOwnedRows }, { readWorkPostAdoptionSettingsV1 }] = await Promise.all([
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
      load<typeof import('../../src/lib/prose/post-adoption-policy')>('/storyforge/src/lib/prose/post-adoption-policy.ts'),
    ])
    if (await db.projects.count() !== 1) throw new Error('SFQA011 requires its isolated single workspace')
    const project = await db.projects.toCollection().first()
    if (!project?.id) throw new Error('Missing isolated workspace')
    const scope = await resolveScope({ projectId: project.id })
    if (!scope.workId) throw new Error('Missing active Work owner')
    return { scope, settings: await readWorkPostAdoptionSettingsV1(scope),
      chaptersJson: JSON.stringify(await readOwnedRows(scope, 'chapters', { owner: 'work' })),
      runs: await db.agentRuns.count(), events: await db.agentRunEvents.count() }
  })
}

test.use({ serviceWorkers: 'block' })
test('SFQA011 · chapter policy controls persist, recover a failed save and remain idle across refresh', async ({ page, context, baseURL }, info) => {
  test.setTimeout(150_000)
  if (!baseURL || !['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname)) {
    throw new Error('SFQA011 requires an isolated loopback browser')
  }
  const origin = new URL(baseURL).origin, forbidden: string[] = []
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin && ['GET', 'HEAD', 'OPTIONS'].includes(request.method())) await route.continue()
    else { forbidden.push(`${request.method()} ${url.origin}${url.pathname}`); await route.abort('blockedbyclient') }
  })
  try {
    await createLongform(page, '011 章后设置组件边界')
    await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
    await page.getByRole('button', { name: '添加卷', exact: true }).click()
    await page.getByRole('button', { name: '添加章节', exact: true }).click()
    await page.getByLabel('章节摘要', { exact: true }).fill('作者只修改运行策略，不生成正文。')
    await page.getByTitle('编辑本章细纲', { exact: true }).click()
    await page.getByRole('button', { name: '添加场景', exact: true }).click()
    await page.getByPlaceholder('一句话场景概要...', { exact: true }).fill('关门，保留原章纲。')
    await page.getByRole('button', { name: '写本章正文', exact: true }).click()
    await page.getByText('正文采纳后的演化策略', { exact: true }).click()
    const policy = page.getByRole('combobox', { name: '运行方式', exact: true })
    await expect(policy).toBeVisible()
    const before = await stored(page)
    await policy.selectOption('auto-with-budget')
    await expect.poll(async () => (await stored(page)).settings.policy).toBe('auto-with-budget')
    await page.getByLabel('调用上限', { exact: true }).fill('3')
    await page.getByLabel('调用上限', { exact: true }).blur()
    await expect.poll(async () => (await stored(page)).settings.budget.maxModelCalls).toBe(3)
    await page.getByLabel('七域候选', { exact: true }).click()
    await expect.poll(async () => (await stored(page)).settings.taskTypes.includes('organization')).toBe(false)
    await expect(page.getByLabel('七域候选', { exact: true })).not.toBeChecked()
    await page.evaluate(async scope => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const fail = (changes: object, key: unknown) => {
        if (key !== scope.workId || !Object.prototype.hasOwnProperty.call(changes, 'postAdoptionPolicy')) return
        db.works.hook('updating').unsubscribe(fail)
        throw new Error('SFQA011 policy save failure')
      }
      db.works.hook('updating', fail)
    }, before.scope)
    await policy.selectOption('off')
    await expect(page.getByText('SFQA011 policy save failure', { exact: true })).toBeVisible()
    expect((await stored(page)).settings.policy).toBe('auto-with-budget')
    await expect(policy).toHaveValue('auto-with-budget')
    await policy.selectOption('off')
    await expect.poll(async () => (await stored(page)).settings.policy).toBe('off')
    await expect(page.getByText('SFQA011 policy save failure', { exact: true })).toHaveCount(0)
    const saved = await stored(page)
    await page.reload()
    await page.getByText('正文采纳后的演化策略', { exact: true }).click()
    await expect(policy).toBeVisible()
    await expect(policy).toHaveValue('off')
    await expect(page.getByLabel('七域候选', { exact: true })).not.toBeChecked()
    const after = await stored(page)
    expect(after.settings).toEqual(saved.settings)
    expect(after.chaptersJson).toBe(before.chaptersJson)
    expect({ runs: after.runs, events: after.events }).toEqual({ runs: before.runs, events: before.events })
    expect(forbidden).toEqual([])
    await info.attach('sfqa011-settings-proof', { body: JSON.stringify({ scope: after.scope,
      settings: after.settings, chapterUnchanged: true, runsBefore: before.runs, runsAfter: after.runs,
      eventsBefore: before.events, eventsAfter: after.events, recoveredSave: true }), contentType: 'application/json' })
  } finally {
    await info.attach('sfqa011-network', { body: JSON.stringify({ forbidden, actualExternalRequests: 0 }), contentType: 'application/json' })
  }
})
