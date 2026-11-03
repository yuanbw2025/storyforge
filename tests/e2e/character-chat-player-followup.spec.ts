import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'

test('author explicitly controls new player followups and the persisted permission cannot outlive situation expansion', async ({page}) => {
  let calls = 0
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/local-codex/v1/requests', async route => {if (route.request().method() === 'POST') {calls++; await route.abort()} else await route.continue()})
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const scope = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts')).seedChatNarrativeProductionFixture()).scope})
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/vision?project=${scope.projectId}&work=${scope.workId}`)
  const expansion = page.getByLabel('允许角色依据未完成事项发展新局面', {exact: true}), followup = page.getByLabel('一件事结束后，允许角色承接我明确提出的新事项', {exact: true})
  await expect(followup).toBeChecked()
  await expansion.uncheck(); await expect(followup).not.toBeChecked(); await expect(followup).toBeDisabled()
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await expect(page.getByText('方案已保存', {exact: true})).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(expansion).not.toBeChecked(); await expect(followup).not.toBeChecked()
  await expansion.check(); await expect(followup).not.toBeChecked(); await followup.check()
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await expect(page.getByText('方案已保存', {exact: true})).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(followup).toBeChecked()
  expect(calls).toBe(0)
})

for (const [continuous, ownGoal] of [[false, false], [true, false], [false, true], [true, true]]) test(`a new player request reaches a reviewed result and survives recovery (continuous=${continuous}, ownGoal=${ownGoal})`, async ({page}, info) => {
  let f: {scope: {projectId: number; worldId: number; workId: number}; sessionId: number}
  let actions = 0, constructions = 0
  const calls: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-followup.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
  await page.route('https://chat-followup.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const actionReview = prompt.includes('本次持久化行动候选'), situationReview = prompt.includes('本次持久化情境候选')
    const construction = !situationReview && prompt.includes('你是 StoryForge 受治理的幕后情境构建器')
    calls.push(actionReview ? 'action-review' : situationReview ? 'situation-review' : construction ? 'construction' : 'action')
    let output: unknown
    if (actionReview || situationReview) output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', ...(actionReview ? ['consequences'] : []), 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是语义质量验收'}))}
    else if (construction) {
      constructions++
      if (constructions === 1 && !ownGoal) {
        expect(prompt).toContain('player-followup')
        output = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-player-followup.ts')).followupSituation()})
      } else {
        expect(prompt).toContain('observation-result')
        output = {kind: 'chat-situation', title: ownGoal ? '暴雨驿站' : '门口的有限观察', location: '驿站', timeLabel: '傍晚',
          newFacts: [{factKey: 'entry-result', kind: 'observation', text: '门口石阶边缘有一小片积水，门内落脚处没有积水。', audienceKeys: ['guard', 'player'], evidenceFactKeys: ['entry-observed'], seedExcerpt: '确认已经完成的门内观察所见'}],
          newGoals: [], newThreads: [], possibilities: []}
      }
    } else {
      actions++; expect(prompt).not.toContain('柜台下'); expect(prompt).not.toContain('resolutionEvidence')
      output = await page.evaluate(async ({f, actions, ownGoal}) => {
        const load = new Function('p', 'return import(p)'), helper = await load('/storyforge/tests/helpers/chat-player-followup.ts')
        const state = (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction
        if (actions === 1 && ownGoal) return helper.followupOwnAction(state.chatNarrative.triggers.at(-1).sourceEventSequence)
        if (actions === 1) return helper.followupAction(state.chatNarrative.triggers.at(-1).sourceEventSequence)
        if (actions === 2 && !ownGoal) return helper.followupResultAction()
        return {kind: 'complete', text: '我已看清门口：门口石阶边缘有一小片积水，门内落脚处没有积水。门口的观察完成了，整条山路如何仍不能由此判断。',
          goalKey: 'check-entry', evidenceFactKeys: ['entry-observed', 'entry-result'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
          newFacts: [], disclosures: [], goalStatus: 'fulfilled', nextPossibilities: [],
          threadUpdates: [{threadKey: 'entry-condition', status: 'resolved', evidenceExcerpt: '门口的观察完成了'}]}
      }, {f, actions, ownGoal})
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  f = await page.evaluate(async continuous => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-player-followup.ts')).seedClosedChatFollowupFixtureV1({maxActionsPerTrigger: continuous ? 3 : 1})}, continuous)
  const open = async () => {
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
    await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  }
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  await open()
  if (continuous) {await page.getByTestId('chat-narrative-tools').locator(':scope > summary').click(); await page.getByLabel('演绎节奏', {exact: true}).selectOption('3')}
  await page.getByPlaceholder('对当前场景中的角色说话…').fill('那可以看看雨停后门口有没有积水吗？我先留在屋里。')
  await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  await expect(page.getByRole('paragraph').filter({hasText: ownGoal ? /^我站在门内向外查看了门口的积水。$/ : /^我可以看看门口的积水。你留在屋里就好，这不需要重新寻找铜印。$/})).toBeVisible()
  if (!continuous) {
  await expect.poll(async () => {
    const story = (await read()).chatNarrative
    return ownGoal ? story.situation.facts.some((fact: {factKey: string}) => fact.factKey === 'entry-result')
      : story.situation.goals.some((goal: {goalKey: string}) => goal.goalKey === 'check-entry')
  }).toBe(true)
  expect(calls).toEqual(['action', 'action-review', 'construction', 'situation-review'])
  expect(actions).toBe(1)
  const settled = await read()
  expect(settled.chatNarrative.pendingSituation).toBeUndefined()
  expect(settled.chatNarrative.situation.goals[0].status).toBe('abandoned')
  expect(settled.chatNarrative.situation.goals.find((g: {goalKey: string}) => g.goalKey === 'check-entry').status).toBe('active')
  expect(settled.chatNarrative.situation.facts.filter((fact: {factKey: string}) => fact.factKey === 'entry-result')).toHaveLength(ownGoal ? 1 : 0)
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(settled); expect(calls).toHaveLength(4)
  f = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), backup = await load('/storyforge/src/lib/export/json-export.ts'), {db} = await load('/storyforge/src/lib/db/schema.ts')
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.scope.projectId)), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    return {scope: {projectId, worldId: session.worldId, workId: session.workId}, sessionId: session.id}
  }, f)
  await open(); expect(calls).toHaveLength(4)
  expect(actions).toBe(1)
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  if (!ownGoal) {
    await expect(page.getByRole('paragraph').filter({hasText: /^我站在门内向外查看了门口的积水。$/})).toBeVisible()
    await expect.poll(async () => (await read()).chatNarrative.situation.facts.some((fact: {factKey: string}) => fact.factKey === 'entry-result')).toBe(true)
    expect(calls).toHaveLength(8)
    expect(actions).toBe(2)
    expect((await read()).chatNarrative.pendingSituation).toBeUndefined()
    await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  }
  }
  await expect(page.getByText('我已看清门口：门口石阶边缘有一小片积水，门内落脚处没有积水。门口的观察完成了，整条山路如何仍不能由此判断。', {exact: true})).toBeVisible()
  expect(calls).toHaveLength(ownGoal ? 6 : 10)
  const final = await read()
  expect(final.chatNarrative.situation.goals.find((g: {goalKey: string}) => g.goalKey === 'check-entry').status).toBe('fulfilled')
  const evidence = final.chatNarrative.resolutionEvidence.goals.find((g: {targetKey: string}) => g.targetKey === 'check-entry')
  expect(evidence.evidenceFactKeys).toContain('entry-result')
  const expression = final.messages.find((m: {messageId: string}) => m.messageId === evidence.source.messageId)
  expect(expression.text.slice(evidence.source.start, evidence.source.end)).toContain('门口的观察完成了')
  expect(expression.eventSequence).toBe(final.chatNarrative.situation.goals.find((g: {goalKey: string}) => g.goalKey === 'check-entry').updatedSequence)
  expect(final.chatNarrative.situation.goals[0].status).toBe('abandoned')
  expect(final.chatNarrative.pendingSituation).toBeUndefined()
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(final); expect(calls).toHaveLength(ownGoal ? 6 : 10)
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await page.getByText('我已看清门口：门口石阶边缘有一小片积水，门内落脚处没有积水。门口的观察完成了，整条山路如何仍不能由此判断。', {exact: true}).scrollIntoViewIfNeeded()
  await page.screenshot({path: info.outputPath('player-followup-mobile.png')})
})
