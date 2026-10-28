import {test, expect, type Page} from '@playwright/test'
import type {ChatSourceUnitsCandidateV1} from '../../src/lib/character-interaction/source-units'
import type {ChatSourceUnitPermissionV1} from '../../src/lib/character-interaction/source-unit-authorization'

async function openWorkbench(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://chat-source-confirmation.invalid/v1', model: 'test', maxTokens: 6000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.goto('./chat/library')
  const fixture = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), helper = await load('/storyforge/tests/helpers/chat-source-unit-confirmation.ts')
    const f = await helper.seedChatSourceUnitConfirmationFixture(), {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {scope: f.scope, candidate: f.candidate as ChatSourceUnitsCandidateV1, permissions: f.permissions as ChatSourceUnitPermissionV1[], worlds: await db.worldReleases.toArray()}
  })
  await page.goto(`./chat/cast?project=${fixture.scope.projectId}&work=${fixture.scope.workId}`)
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await page.getByRole('checkbox', {name: /规则条目 · seal · 历史依据 加入整理建议$/}).check()
  return fixture
}
function report(candidate: ChatSourceUnitsCandidateV1, permissions: ChatSourceUnitPermissionV1[]) {
  return {interpretation: {fragments: candidate.fragments.map(row => ({fragmentKey: row.fragmentKey, complete: true, reason: '工程模拟覆盖报告',
    facts: row.facts.map(item => ({key: item.key, faithful: true, atomic: true, standalone: true, established: true, reason: '工程模拟逐项报告'})),
    constraints: row.constraints.map(item => ({key: item.key, faithful: true, reason: '工程模拟限制报告'}))}))},
  permissions: permissions.map(row => ({fragmentKey: row.fragmentKey, unitKey: row.unitKey, initialKnowledgeFaithful: true, discoverySupported: true, reason: '工程模拟权限报告'}))}
}

test('explicit per-fact review and confirmation survive refresh, compile into v6 and can be explicitly removed', async ({page}) => {
  const f = await openWorkbench(page), requests: string[] = []
  await page.route('https://chat-source-confirmation.invalid/**', async route => {
    const text = route.request().postDataJSON().messages[1].content as string
    requests.push(text)
    const context = JSON.parse(text.slice(text.indexOf('{')))
    const result = context.permissions ? report(context.candidate, context.permissions) : f.candidate
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {content: JSON.stringify(result)}, finish_reason: 'stop'}]})})
  })
  const panel = page.getByRole('region', {name: '事实拆分与复核'}), confirm = panel.getByRole('region', {name: '事实知情确认'})
  await panel.getByRole('button', {name: '整理所选原文的事实', exact: true}).click()
  const location = confirm.getByRole('group', {name: '铜印放在柜台下的木箱里。', exact: true})
  await location.getByRole('checkbox', {name: '允许调查后获知此事实', exact: true}).check()
  await location.getByLabel('实际发现条件').fill(f.permissions[0].discovery!.condition)
  await location.getByRole('group', {name: '调查者已知的前提', exact: true}).getByRole('checkbox').first().check()
  await confirm.getByRole('button', {name: '复核事实和知情范围', exact: true}).click()
  await expect(confirm.getByText('事实与权限复核通过，等待你确认保存。', {exact: true})).toBeVisible()
  expect(requests).toHaveLength(2)
  expect(requests[1]).toContain('掌柜拿去拓印'); expect(requests[1]).toContain('prerequisites')
  const save = confirm.getByRole('button', {name: '确认保存事实与知情范围', exact: true})
  await location.getByRole('checkbox', {name: '玩家', exact: true}).check()
  await expect(save).toBeDisabled()
  await location.getByRole('checkbox', {name: '玩家', exact: true}).uncheck()
  await expect(save).toBeEnabled()
  expect(await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), {readChatDraftV1} = await load('/storyforge/src/lib/character-interaction/draft-service.ts')
    return (await readChatDraftV1(scope)).sourceUnitsJson
  }, f.scope)).toBeUndefined()
  await page.reload()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(location.getByLabel('实际发现条件')).toHaveValue(f.permissions[0].discovery!.condition)
  await expect(save).toBeEnabled(); expect(requests).toHaveLength(2)
  await save.click()
  // Saving advances the draft revision and invalidates the open source view.
  // Reopen the committed revision before inspecting its confirmed facts.
  await expect.poll(() => page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), {readChatDraftV1} = await load('/storyforge/src/lib/character-interaction/draft-service.ts')
    return (await readChatDraftV1(scope)).sourceUnitsJson !== undefined
  }, f.scope)).toBe(true)
  await expect(confirm).toBeHidden()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(confirm.getByTestId('chat-saved-source-units')).toContainText('铜印放在柜台下的木箱里')
  const frozen = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), helper = await load('/storyforge/tests/helpers/chat-role-profile.ts')
    const compiler = await load('/storyforge/src/lib/product-production/product-module-compilers.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const result = compiler.prepareChatNarrativeCompilerSourceV1(await helper.chatRoleProfileCompilerInput(scope))
    return {source: result.content, worlds: await db.worldReleases.toArray()}
  }, f.scope)
  expect(frozen.source.version).toBe(6)
  expect(frozen.source.knowledge.filter((row: {source: {unit?: unknown}}) => row.source.unit)).toHaveLength(3)
  expect(frozen.worlds).toEqual(f.worlds)
  await page.reload()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(confirm.getByTestId('chat-saved-source-units')).toBeVisible()
  expect(requests).toHaveLength(2)
  await page.goto(`./chat/vision?project=${f.scope.projectId}&work=${f.scope.workId}`)
  await expect(page.getByRole('checkbox', {name: '允许角色依据未完成事项发展新局面', exact: true})).toBeDisabled()
  await expect(page.getByLabel('每次调查最多揭示').locator('option[value="0"]')).toHaveJSProperty('disabled', true)
  await page.goto(`./chat/cast?project=${f.scope.projectId}&work=${f.scope.workId}`)
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await confirm.getByRole('button', {name: '移除此批已确认事实整理', exact: true}).click()
  await expect(confirm.getByTestId('chat-saved-source-units')).toHaveCount(0)
  await page.goto(`./chat/vision?project=${f.scope.projectId}&work=${f.scope.workId}`)
  await expect(page.getByRole('checkbox', {name: '允许角色依据未完成事项发展新局面', exact: true})).toBeEnabled()
})

test('unknown permission review does not resend on refresh; a later denial cannot be confirmed', async ({page}) => {
  const f = await openWorkbench(page)
  let calls = 0, unknown = true
  await page.route('https://chat-source-confirmation.invalid/**', async route => {
    calls++
    const text = route.request().postDataJSON().messages[1].content as string, context = JSON.parse(text.slice(text.indexOf('{')))
    if (context.permissions && unknown) return route.abort('failed')
    const result = context.permissions ? report(context.candidate, context.permissions) : f.candidate
    if ('permissions' in result) {result.permissions[0].initialKnowledgeFaithful = false; result.permissions[0].reason = '必须保留初始未知限制'}
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {content: JSON.stringify(result)}, finish_reason: 'stop'}]})})
  })
  const panel = page.getByRole('region', {name: '事实拆分与复核'}), confirm = panel.getByRole('region', {name: '事实知情确认'})
  await panel.getByRole('button', {name: '整理所选原文的事实', exact: true}).click()
  const review = confirm.getByRole('button', {name: '复核事实和知情范围', exact: true})
  await review.click()
  await expect(confirm.getByText('本次请求尚未结束，结果未知时不会自动重发。可恢复已留存的回复或明确结束等待。', {exact: true})).toBeVisible()
  await page.reload()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(review).toBeDisabled(); expect(calls).toBe(2)
  await confirm.getByRole('button', {name: '结束这次事实确认', exact: true}).click()
  await expect(review).toBeEnabled()
  unknown = false
  await review.click()
  await confirm.getByText('逐项复核依据', {exact: true}).click()
  await expect(confirm.getByText(/初知：未通过；发现：通过 · 必须保留初始未知限制/)).toBeVisible()
  await expect(confirm.getByRole('button', {name: '确认保存事实与知情范围', exact: true})).toBeDisabled()
  expect(calls).toBe(3)
  await expect(confirm.getByTestId('chat-saved-source-units')).toHaveCount(0)
})
