import {test, expect} from '@playwright/test'

test('historical relationship causes reach actor, review and player inspection after portable restore', async ({page}, info) => {
  let externalCalls = 0
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/chat/completions', async route => {externalCalls++; await route.abort()})
  await page.route('**/local-codex/v1/requests', async route => {externalCalls++; await route.abort()})
  await page.goto('./chat/library')
  const result = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const helpers = await load('/storyforge/tests/helpers/chat-narrative-fixture.ts'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
    const harness = await load('/storyforge/src/lib/character-interaction/harness.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const portable = await load('/storyforge/src/lib/export/json-export.ts'), f = await helpers.seedChatNarrativeRuntimeFixture({relationships: true})
    const command = async () => {const v = await api.readProductRuntimeStateVersion(f.sessionId); return {sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash}}
    const exchanges = [
      ['别只凭旅人着急就认定有罪，先核对证据吧。', '你提醒我先核对证据，这让我更愿意听取你的判断。'],
      ['你慢慢核对，我愿意听你把顾虑说完。', '你耐心听我的顾虑，让我更愿意和你商量。'],
      ['之前关于核对证据的提醒，影响你怎么看我了吗？', '关于先核对证据的提醒，我仍记得；我会继续认真考虑你的判断。'],
    ]
    let expressionAndReviewCalls = 0, lastRunId = 0
    for (let i = 0; i < exchanges.length; i++) {
      const [text, reply] = exchanges[i]
      const source = await api.commitInteractionPlayerMessage({...await command(), messageId: `relationship-input-${i}`, text, audienceKeys: ['guard']})
      await api.requestChatNarrativeTrigger({...await command(), kind: 'player-response', sourceEventSequence: source.sequence})
      const candidate = await harness.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '关系历史读取页面工程验证',
        runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async (messages: Array<{content: string}>) => {
          expressionAndReviewCalls++
          if (i === 2 && (!messages[1].content.includes(exchanges[0][1]) || !messages[1].content.includes(exchanges[1][1]))) throw new Error('Actor lost a relationship cause')
          return JSON.stringify({kind: 'speak', text: reply, goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
            newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
            relationshipUpdates: i < 2 ? [{dimensionKey: 'trust', delta: 1, sourceEventSequence: source.sequence, playerExcerpt: text, evidenceExcerpt: reply}] : []})
        }), runReviewAI: async (messages: Array<{content: string}>) => {
          expressionAndReviewCalls++
          if (i === 2 && !messages[1].content.includes(exchanges[0][1])) throw new Error('Review lost actor-delivered cause')
          return JSON.stringify(helpers.chatActionReviewOutputFixture())
        }})
      lastRunId = candidate.snapshot.run.id
      await harness.adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: lastRunId})
    }
    const before = await api.readProductRuntimeState(f.sessionId), title = (await db.productRuntimeSessions.get(f.sessionId)).title
    const projectId = await portable.importProjectJSON(await portable.exportProjectJSON(f.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: {title: string}) => s.title === title)
    const after = await api.readProductRuntimeState(restored.id)
    if (JSON.stringify(before.interaction) !== JSON.stringify(after.interaction)) throw new Error('Portable state changed')
    return {projectId, workId: restored.workId, sessionId: restored.id, expressionAndReviewCalls, state: after, oldReason: exchanges[0][1], latestReason: exchanges[1][1]}
  })
  expect(result.expressionAndReviewCalls).toBe(6)
  await page.goto(`./chat/play?project=${result.projectId}&work=${result.workId}&session=${result.sessionId}`)
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 844})
    await page.getByRole('button', {name: '开始对话', exact: true}).click()
    await page.getByRole('button', {name: '查看本次上下文', exact: true}).click()
    const inspector = page.getByTestId('chat-context-inspector')
    const causes = inspector.locator('details').filter({has: page.locator('summary', {hasText: '关系变化原因的选入与省略'})})
    await causes.locator('summary').click()
    await expect(causes).toContainText(result.oldReason)
    await expect(causes).toContainText(result.latestReason)
    await expect(causes).toContainText('已选入')
    for (const secret of ['柜台下', '无辜旅人', '担心再次错怪人']) await expect(inspector).not.toContainText(secret)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole('button', {name: '收起本次上下文', exact: true}).click()
    await page.getByRole('button', {name: '关系与记忆', exact: true}).click()
    const relationships = page.getByTestId('chat-relationship-panel')
    await relationships.getByText('共同经历（2）', {exact: true}).click()
    const history = relationships.getByTestId('chat-relationship-cause')
    await expect(history).toHaveCount(2)
    await expect(history.nth(0)).toContainText(result.latestReason)
    await expect(history.nth(1)).toContainText(result.oldReason)
    await history.nth(1).getByText('查看双方原话', {exact: true}).click()
    await expect(history.nth(1).locator('blockquote')).toHaveText(['别只凭旅人着急就认定有罪，先核对证据吧。', result.oldReason])
    for (const secret of ['柜台下', '无辜旅人', '担心再次错怪人']) await expect(relationships).not.toContainText(secret)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await relationships.screenshot({path: info.outputPath(`relationship-history-${width}.png`)})
    await page.reload()
  }
  const after = await page.evaluate(async id => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id)}, result.sessionId)
  expect(after).toEqual(result.state)
  expect(externalCalls).toBe(0)
})
