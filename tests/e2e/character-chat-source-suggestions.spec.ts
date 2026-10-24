import {test, expect, type Page} from '@playwright/test'

async function openReview(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-source-suggestions.invalid/v1', model: 'test', temperature: .2, maxTokens: 6000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.goto('./chat/library')
  const scope = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), helper = await load('/storyforge/tests/helpers/chat-background-source.ts')
    return (await helper.seedChatBackgroundSourceFixture(helper.chatStructuredWorldRulesFixture())).scope
  })
  await page.goto(`./chat/cast?project=${scope.projectId}&work=${scope.workId}`)
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await page.getByRole('checkbox', {name: /规则条目 · harbor\/public · 架空设定 加入整理建议$/}).check()
  return scope
}

test('source suggestions use selected original passages and refresh without granting knowledge or changing the source', async ({page}) => {
  const prompts: string[] = []
  await page.route('https://chat-source-suggestions.invalid/**', async route => {
    const text = route.request().postDataJSON().messages[1].content as string
    prompts.push(text)
    const context = JSON.parse(text.slice(text.indexOf('{')))
    const content = {suggestions: [{fragmentKey: context.fragments[0].fragmentKey, purpose: 'knowledge', interpretation: '铃声触发检查水尺的规则可以作为场景依据，但没有说明谁已经知道。', caution: 'uncertain', evidenceQuotes: ['蓝铃响起时先检查水尺']}]}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify(content)}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 100, total_tokens: 200}})})
  })
  const scope = await openReview(page)
  const before = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {draft: await db.chatAuthoringDrafts.where('workId').equals(scope.workId).first(), worlds: await db.worldReleases.toArray()}
  }, scope)
  await page.getByRole('button', {name: '生成所选资料的建议', exact: true}).click()
  await expect(page.getByTestId('chat-source-suggestion')).toContainText('没有说明谁已经知道')
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).not.toContain('失踪船队的名册')
  expect(prompts[0]).not.toContain('蓝色柜')
  const decision = page.getByRole('combobox', {name: /规则条目 · harbor\/public · 架空设定 可见范围$/})
  await expect(decision).toHaveValue('unclassified')
  expect(await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {draft: await db.chatAuthoringDrafts.where('workId').equals(scope.workId).first(), worlds: await db.worldReleases.toArray()}
  }, scope)).toEqual(before)
  await page.reload()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(page.getByTestId('chat-source-suggestion')).toContainText('蓝铃响起时先检查水尺')
  await expect(decision).toHaveValue('unclassified')
  expect(prompts).toHaveLength(1)
  await decision.selectOption('participants')
  await page.getByRole('button', {name: '确认可见范围并用于新制作', exact: true}).click()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(decision).toHaveValue('participants')
  await expect(page.getByText('方案或来源已经变化，下面是历史建议，请按当前资料重新判断。', {exact: true})).toBeVisible()
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(prompts).toHaveLength(1)
})

test('an unknown source-review request survives refresh without retry and needs explicit dismissal before another request', async ({page}) => {
  let calls = 0
  let reject = false
  await page.route('https://chat-source-suggestions.invalid/**', async route => {
    calls++
    if (reject) await route.fulfill({status: 401, contentType: 'application/json', body: JSON.stringify({error: {message: 'engineering authorization rejection'}})})
    else await route.abort('failed')
  })
  await openReview(page)
  const generate = page.getByRole('button', {name: '生成所选资料的建议', exact: true})
  await generate.click()
  await expect(page.getByText(/这次请求的结果尚未留存/)).toBeVisible()
  expect(calls).toBe(1)
  await page.reload()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await page.getByRole('checkbox', {name: /规则条目 · harbor\/public · 架空设定 加入整理建议$/}).check()
  await expect(generate).toBeDisabled()
  expect(calls).toBe(1)
  await page.getByRole('button', {name: '结束这次整理', exact: true}).click()
  await expect(generate).toBeEnabled()
  expect(calls).toBe(1)
  reject = true
  await generate.click()
  await expect(page.getByText('模型服务拒绝了这次请求，没有生成建议。请检查配置或服务状态后再明确发起新请求。', {exact: true})).toBeVisible()
  await expect(generate).toBeEnabled()
  expect(calls).toBe(2)
})

test('actor-scoped suggestions require saved knowledge, reject unknown selected passages and retain their reading perspective', async ({page}) => {
  const prompts: string[] = []
  await page.route('https://chat-source-suggestions.invalid/**', async route => {
    const text = route.request().postDataJSON().messages[1].content as string
    prompts.push(text)
    const context = JSON.parse(text.slice(text.indexOf('{')))
    expect(context.perspective.actorKey).toBeTruthy()
    expect(context.cast).toEqual([{resourceKey: context.perspective.actorKey, role: 'actor'}])
    expect(context.fragments[0].confirmedClassification).toBeNull()
    expect(context.fragments[0].knownPurpose).toBe('knowledge')
    for (const value of ['authorLabel', 'audienceKeys', 'discovery', '失踪船队的名册', '守潮人']) expect(text).not.toContain(value)
    const content = {suggestions: [{fragmentKey: context.fragments[0].fragmentKey, purpose: 'knowledge', interpretation: '仅按该角色已知的铃声规则整理，没有获得其他资料。', caution: 'ordinary', evidenceQuotes: ['蓝铃响起时先检查水尺']}]}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify(content)}, finish_reason: 'stop'}]})})
  })
  await openReview(page)
  const generate = page.getByRole('button', {name: '生成所选资料的建议', exact: true})
  const perspective = page.getByRole('combobox', {name: '整理视角', exact: true})
  await perspective.selectOption({label: '仅按林舟已知资料整理'})
  await expect(page.getByText('请先确认并保存资料知情范围，再按角色视角整理。', {exact: true})).toBeVisible()
  await expect(generate).toBeDisabled()
  const decision = page.getByRole('combobox', {name: /规则条目 · harbor\/public · 架空设定 可见范围$/})
  await decision.selectOption('public')
  await expect(generate).toBeDisabled() // Unsaved UI permissions do not authorize reading.
  await page.getByRole('button', {name: '确认可见范围并用于新制作', exact: true}).click()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await page.getByRole('checkbox', {name: /规则条目 · harbor\/public · 架空设定 加入整理建议$/}).check()
  await perspective.selectOption({label: '仅按林舟已知资料整理'})
  await expect(generate).toBeEnabled()
  const hidden = page.getByRole('checkbox', {name: /规则条目 · harbor\/private 加入整理建议$/})
  await hidden.check()
  await expect(page.getByText(/所选 1 项不在该角色已保存的知情范围内/)).toBeVisible()
  await expect(generate).toBeDisabled()
  expect(prompts).toHaveLength(0)
  await hidden.uncheck(); await generate.click()
  await expect(page.getByTestId('chat-source-suggestion')).toContainText('仅按该角色已知')
  expect(prompts).toHaveLength(1)
  await page.reload(); await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(page.getByText('下面的建议依据：林舟当时已知的所选资料。', {exact: true})).toBeVisible()
  await expect(perspective).toHaveValue('')
  await decision.selectOption('author-only')
  await page.getByRole('button', {name: '确认可见范围并用于新制作', exact: true}).click()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(page.getByText('方案或来源已经变化，下面是历史建议，请按当前资料重新判断。', {exact: true})).toBeVisible()
  await page.getByRole('checkbox', {name: /规则条目 · harbor\/public · 架空设定 加入整理建议$/}).check()
  await perspective.selectOption({label: '仅按林舟已知资料整理'})
  await expect(generate).toBeDisabled()
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(prompts).toHaveLength(1)
})
