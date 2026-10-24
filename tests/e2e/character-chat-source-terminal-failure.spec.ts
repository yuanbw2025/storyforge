import {test, expect, type Page} from '@playwright/test'

async function localBridge(page: Page, status = 'failed') {
  const requests: Array<{id: string; model: string}> = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'codex', apiKey: '', baseUrl: '/storyforge/local-codex/v1', model: 'test', maxTokens: 6000}))
  })
  await page.route('**/local-codex/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path.endsWith('/status')) return route.fulfill({json: {state: 'ready'}})
    if (path.endsWith('/requests') && request.method() === 'POST') {
      const body = request.postDataJSON(); requests.push({id: body.id, model: body.model})
      return route.fulfill({json: {id: body.id}, status: 202})
    }
    const sent = requests.find(row => path.endsWith(`/requests/${row.id}`))
    if (sent && request.method() === 'GET') return route.fulfill({json: {...sent, status, text: 'partial output must not be a candidate', dispatched: true,
      providerTurn: {threadId: 'thread', turnId: 'turn', status: status === 'cancelled' ? 'interrupted' : 'failed'}, error: '本机回执：本次生成未完成。'}})
    throw new Error(`Unexpected local bridge route: ${request.method()} ${path}`)
  })
  return requests
}

for (const kind of ['consultation', 'profile', 'source'] as const) test(`${kind} shows the matched Codex failure after reload without a new request or candidate`, async ({page}) => {
  const requests = await localBridge(page, kind === 'profile' ? 'cancelled' : 'failed')
  await page.goto('./chat/library')
  const f = await page.evaluate(async kind => {
    const load = new Function('p', 'return import(p)')
    const f = kind === 'consultation' ? await (await load('/storyforge/tests/helpers/chat-consultation.ts')).seedChatConsultationFixtureV2()
      : await (await load('/storyforge/tests/helpers/chat-role-profile.ts')).seedChatRoleProfileFixture()
    const {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {scope: f.scope, draft: await db.chatAuthoringDrafts.where('workId').equals(f.scope.workId).first(), worlds: await db.worldReleases.toArray()}
  }, kind)
  await page.goto(`./chat/${kind === 'consultation' ? 'agent' : 'cast'}?project=${f.scope.projectId}&work=${f.scope.workId}`)
  if (kind === 'consultation') {
    await page.getByRole('textbox', {name: '角色聊天 会谈输入', exact: true}).fill('讨论一个角色可以自己行动的开场。')
    await page.getByRole('button', {name: '发送', exact: true}).click()
  } else {
    await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
    await page.getByTestId('chat-source-fragment').filter({has: page.locator('pre').filter({hasText: '谨慎而固执'})}).getByRole('checkbox', {name: /加入整理建议$/}).check()
    if (kind === 'profile') await page.getByRole('combobox', {name: '整理人物', exact: true}).selectOption({label: '林舟'})
    await page.getByRole('button', {name: kind === 'profile' ? 'AI整理人物特征' : '生成所选资料的建议', exact: true}).click()
  }
  const message = kind === 'profile' ? 'Codex 已确认本次生成中断' : 'Codex 已确认本次生成失败'
  await expect(page.getByRole('status').filter({hasText: message})).toBeVisible()
  expect(requests).toHaveLength(1)
  await page.reload()
  if (kind !== 'consultation') await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(page.getByRole('status').filter({hasText: message})).toBeVisible()
  await expect(page.getByText(/结果尚未留存/)).toHaveCount(0)
  await expect(page.getByTestId('chat-plan-change')).toHaveCount(0)
  await expect(page.getByTestId('chat-source-suggestion')).toHaveCount(0)
  await expect(page.getByRole('button', {name: '检查并编辑AI人物候选', exact: true})).toHaveCount(0)
  await page.getByText('查看失败记录', {exact: true}).click()
  await expect(page.getByText(`请求：${requests[0].id}`, {exact: true})).toBeVisible()
  const read = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    return {draft: await db.chatAuthoringDrafts.where('workId').equals(scope.workId).first(), worlds: await db.worldReleases.toArray()}
  }, f.scope)
  expect(read).toEqual({draft: f.draft, worlds: f.worlds}); expect(requests).toHaveLength(1)
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const boundary of ['failure.saved', 'failure.recorded']) test(`author recovers the saved failure after ${boundary} and backup import with zero further calls`, async ({page}) => {
  const requests = await localBridge(page)
  await page.goto('./chat/library')
  const scope = await page.evaluate(async boundary => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const f = await (await load('/storyforge/tests/helpers/chat-consultation.ts')).seedChatConsultationFixtureV2()
    const api = await load('/storyforge/src/lib/character-interaction/consultation-harness.ts')
    const {useAIConfigStore} = await load('/storyforge/src/stores/ai-config.ts')
    try {await api.generateChatConsultationV2({scope: f.scope, request: f.request, config: useAIConfigStore.getState().config,
      onBoundary: (point: string) => {if (point === boundary) throw new Error('isolated interruption')}})} catch (error) {
      if (!(error instanceof Error) || error.message !== 'isolated interruption') throw error
    }
    const exports = await load('/storyforge/src/lib/export/json-export.ts')
    const projectId = await exports.importProjectJSON(await exports.exportProjectJSON(f.scope.projectId))
    const draft = await db.chatAuthoringDrafts.where('projectId').equals(projectId).first()
    return {projectId, worldId: draft.worldId, workId: draft.workId}
  }, boundary)
  await page.goto(`./chat/agent?project=${scope.projectId}&work=${scope.workId}`)
  await expect(page.getByRole('status').filter({hasText: 'Codex 已确认本次生成失败'})).toBeVisible()
  await expect(page.getByText('失败回执已保存，运行记录尚未结束；恢复记录不会调用模型。', {exact: true})).toBeVisible()
  await page.getByRole('textbox', {name: '角色聊天 会谈输入', exact: true}).fill('此时不能另发请求')
  await expect(page.getByRole('button', {name: '发送', exact: true})).toBeDisabled()
  expect(requests).toHaveLength(1)
  await page.getByRole('button', {name: '恢复失败记录', exact: true}).click()
  await expect(page.getByRole('button', {name: '恢复失败记录', exact: true})).toHaveCount(0)
  await expect(page.getByRole('button', {name: '发送', exact: true})).toBeEnabled()
  await page.reload()
  await expect(page.getByRole('status').filter({hasText: 'Codex 已确认本次生成失败'})).toBeVisible()
  await expect(page.getByRole('button', {name: '恢复失败记录', exact: true})).toHaveCount(0)
  await expect(page.getByText(/结果尚未留存/)).toHaveCount(0)
  expect(requests).toHaveLength(1)
})

test('a receipt without a definitive outcome stays unknown after reload and does not enable a new request', async ({page}) => {
  const requests = await localBridge(page, 'unknown')
  await page.goto('./chat/library')
  const scope = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    return (await (await load('/storyforge/tests/helpers/chat-consultation.ts')).seedChatConsultationFixtureV2()).scope
  })
  await page.goto(`./chat/agent?project=${scope.projectId}&work=${scope.workId}`)
  const input = page.getByRole('textbox', {name: '角色聊天 会谈输入', exact: true}), send = page.getByRole('button', {name: '发送', exact: true})
  await input.fill('讨论开场'); await send.click()
  await expect(page.getByText(/这次请求的结果尚未留存/)).toBeVisible()
  await page.reload(); await input.fill('不能自动重发')
  await expect(page.getByText(/这次请求的结果尚未留存/)).toBeVisible()
  await expect(send).toBeDisabled()
  await expect(page.getByText(/Codex 已确认本次生成/)).toHaveCount(0)
  expect(requests).toHaveLength(1)
})
