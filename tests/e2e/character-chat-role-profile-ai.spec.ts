import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {test, expect, type Page} from '@playwright/test'
async function open(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-role-profile.invalid/v1', model: 'test', temperature: .2, maxTokens: 6000, apiKey: 'isolated-test-key' })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const fixture = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), helper = await load('/storyforge/tests/helpers/chat-role-profile.ts')
    const f = await helper.seedChatRoleProfileFixture()
    return {scope: f.scope, candidate: f.candidate, actorKey: f.actor.resourceKey}
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/cast?project=${fixture.scope.projectId}&work=${fixture.scope.workId}`)
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await page.getByTestId('chat-source-fragment').filter({has: page.locator('pre').filter({hasText: '谨慎而固执'})}).getByRole('checkbox', {name: /加入整理建议$/}).check()
  await page.getByRole('combobox', {name: '整理人物', exact: true}).selectOption({label: '林舟'})
  return fixture
}

test('AI profile stays a candidate across reload, author edits are adopted once and the correct runtime receives them', async ({page}) => {
  const f = await open(page), prompts: string[] = []
  await page.route('https://chat-role-profile.invalid/**', async route => {
    prompts.push(JSON.stringify(route.request().postDataJSON().messages))
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: JSON.stringify(f.candidate)}, finish_reason: 'stop'}]})})
  })
  const generate = page.getByRole('button', {name: 'AI整理人物特征', exact: true}), edit = page.getByRole('button', {name: '检查并编辑AI人物候选', exact: true})
  await generate.click(); await expect(edit).toBeVisible(); await expect(generate).toBeDisabled()
  expect(prompts).toHaveLength(1); expect(prompts[0]).not.toContain('失踪船队'); expect(JSON.parse(JSON.parse(prompts[0])[1].content).fragments.every((row: {confirmedClassification: unknown}) => row.confirmedClassification === null)).toBe(true)
  await expect(page.getByTestId('chat-role-profile')).toHaveCount(0)
  await reloadWithBrowserFixtureAIConfigV1(page); await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(edit).toBeVisible(); expect(prompts).toHaveLength(1)
  await edit.click()
  const text = '遇到陌生局面先谨慎核实，确认之后坚持自己的立场。'
  await page.getByRole('textbox', {name: '特征 1 内容', exact: true}).fill(text)
  await page.getByRole('button', {name: '确认人物整理并用于新制作', exact: true}).click()
  await expect(page.getByTestId('chat-role-trait-editor')).toHaveCount(0)
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(page.getByTestId('chat-role-profile')).toContainText(text)
  await expect(page.getByTestId('chat-role-profile-candidate')).toContainText('这次候选已采纳')
  const observed = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), helper = await load('/storyforge/tests/helpers/chat-role-profile.ts'), compiler = await load('/storyforge/src/lib/product-production/product-module-compilers.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const runs = await db.agentRuns.where('workId').equals(scope.workId).toArray()
    return {compiled: compiler.compileInteractionModulesV1(await helper.chatRoleProfileCompilerInput(scope)), runs, events: await db.agentRunEvents.where('runId').equals(runs[0].id).toArray()}
  }, f.scope)
  expect(observed.runs).toHaveLength(1); expect(observed.runs[0].status).toBe('completed')
  expect(observed.events.filter((row: {type: string}) => row.type === 'adoption.committed')).toHaveLength(1)
  expect(observed.compiled.profiles.find((row: {characterKey: string}) => row.characterKey === f.actorKey).voiceRules).toContain(text)
  for (const other of observed.compiled.profiles.filter((row: {characterKey: string}) => row.characterKey !== f.actorKey)) expect(other.voiceRules).not.toContain(text)
  await reloadWithBrowserFixtureAIConfigV1(page); await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(page.getByTestId('chat-role-profile')).toContainText(text)
  await page.setViewportSize({width: 390, height: 844}); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(prompts).toHaveLength(1)
})

test('unknown profile requests survive refresh without retry and explicit dismissal allows a separate request', async ({page}) => {
  const f = await open(page); let calls = 0, denied = false
  await page.route('https://chat-role-profile.invalid/**', async route => {
    calls++
    if (denied) await route.fulfill({status: 401, contentType: 'application/json', body: JSON.stringify({error: {message: 'engineering rejection'}})})
    else await route.abort('failed')
  })
  await page.getByRole('button', {name: 'AI整理人物特征', exact: true}).click()
  await expect(page.getByTestId('chat-role-profile-candidate')).toContainText('结果尚未留存')
  await reloadWithBrowserFixtureAIConfigV1(page); await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(page.getByTestId('chat-role-profile-candidate')).toContainText('结果尚未留存'); expect(calls).toBe(1)
  await page.getByRole('button', {name: '结束本次人物候选', exact: true}).click()
  await expect(page.getByTestId('chat-role-profile-candidate')).toContainText('没有自动重发')
  await page.getByRole('combobox', {name: '整理人物', exact: true}).selectOption({label: '林舟'})
  await page.getByTestId('chat-source-fragment').filter({has: page.locator('pre').filter({hasText: '谨慎而固执'})}).getByRole('checkbox', {name: /加入整理建议$/}).check()
  denied = true
  await page.getByRole('button', {name: 'AI整理人物特征', exact: true}).click()
  await expect(page.getByTestId('chat-role-profile-candidate')).toContainText('本次人物整理未通过检查')
  expect(calls).toBe(2)
  expect(await page.evaluate(async scope => {const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts'); return (await db.chatAuthoringDrafts.where('workId').equals(scope.workId).first()).roleProfilesJson}, f.scope)).toBeUndefined()
})
