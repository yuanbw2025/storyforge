import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {test, expect} from '@playwright/test'

test('inspects the exact historical player-visible context after refresh without secrets or extra calls', async ({page}) => {
  let calls = 0
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-context.invalid/v1', model: 'test', maxTokens: 8000, apiKey: 'isolated-test-key' })
  await page.route('https://chat-context.invalid/**', async route => {calls++; await route.abort()})
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const fixture = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts')
    const f = await fixture.seedChatNarrativeRuntimeFixture({contextKnowledge: [
      ...Array.from({length: 35}, (_, i) => ({key: `old-${i}`, content: `旧资料编号${i}：` + '公开饮食服饰记录。'.repeat(130), audienceKeys: ['guard', 'player', 'artisan']})),
      {key: 'late-map', content: '靛蓝地图的出口就在北墙。', audienceKeys: ['guard', 'player']},
      {key: 'private-map', content: '靛蓝地图私密暗号：青鹭。', audienceKeys: ['artisan']},
    ]})
    const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
    await api.commitInteractionPlayerMessage({...await command(), messageId: 'excluded', text: '排除标记：我刚才提到窗户。'})
    await api.setChatMessageRetrieval({...await command(), messageId: 'excluded', excluded: true})
    await api.commitInteractionPlayerMessage({...await command(), messageId: 'shared', text: '请先留意门口。靛蓝地图的出口在哪里？'})
    await api.requestChatNarrativeTrigger({...await command(), kind: 'continue', sourceEventSequence: (await api.readProductRuntimeStateVersion(f.sessionId)).sequence})
    const result = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '页面工程夹具',
      runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async (messages: unknown) => {
        const text = JSON.stringify(messages)
        if (!text.includes('靛蓝地图的出口就在北墙。') || text.includes('私密暗号')) throw new Error('模型实际输入的检索或角色边界错误')
        return JSON.stringify({kind: 'speak', text: '我先查看门边。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})}),
      runReviewAI: async () => JSON.stringify(fixture.chatActionReviewOutputFixture())})
    await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: result.snapshot.run.id})
    await api.commitInteractionPlayerMessage({...await command(), messageId: 'future', text: '未来标记：现在再看另一边。'})
    return {...f, runId: result.snapshot.run.id}
  })
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)}, f)
  const before = await read()
  await page.getByRole('button', {name: '查看本次上下文', exact: true}).click()
  const inspector = page.getByTestId('chat-context-inspector')
  await expect(inspector).toContainText('行动角色：叶岑')
  await expect(inspector).toContainText('你扮演：沈禾')
  await expect(inspector).toContainText('请先留意门口。')
  await expect(inspector).toContainText('用户排除 1 条，长度预算省略 0 条')
  const selection = page.getByTestId('chat-context-selection')
  await expect(selection).toContainText('已知事实的选入与省略')
  await expect(selection).toContainText('共同事项的选入与省略')
  await selection.locator('summary').filter({hasText: '来源知识的选入与省略'}).click()
  await expect(selection).toContainText('本轮省略 · 按相关性排序和长度预算选择')
  while (await selection.getByRole('button', {name: '再显示 12 条资料'}).count()) await selection.getByRole('button', {name: '再显示 12 条资料'}).click()
  await expect(selection).toContainText('靛蓝地图的出口就在北墙。')
  await expect(selection).toContainText('已选入 · 与本轮对话相关')
  for (const hidden of ['无辜旅人', '柜台下', '可以建议查看后门', '担心再次错怪人', '排除标记', '未来标记', '私密暗号']) await expect(inspector).not.toContainText(hidden)
  expect(await read()).toEqual(before)
  expect(calls).toBe(0)
  await reloadWithBrowserFixtureAIConfigV1(page)
  await page.getByRole('button', {name: '查看本次上下文', exact: true}).click()
  await expect(inspector).toContainText('行动角色：叶岑')
  await page.getByRole('button', {name: '重新读取上下文记录', exact: true}).click()
  await expect(inspector).toContainText('用户排除 1 条，长度预算省略 0 条')
  await expect(selection).toContainText('来源知识的选入与省略')
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(calls).toBe(0)
  await page.evaluate(async projectId => {
    const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const body = (await db.agentRunArtifacts.where('projectId').equals(projectId).toArray()).find((row: {artifactKind: string}) => row.artifactKind === 'context-packet')
    await db.agentRunArtifacts.update(body.id, {content: '{}'})
  }, f.scope.projectId)
  await page.getByRole('button', {name: '重新读取上下文记录', exact: true}).click()
  await expect(inspector.getByRole('alert')).toContainText('无法核验')
  await expect(inspector).not.toContainText('请先留意门口。')
  expect(await read()).toEqual(before)
  expect(calls).toBe(0)
})
