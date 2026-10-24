import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {expect, test} from '@playwright/test'

for (const shared of [false, true]) for (const rejected of [false, true]) test(`disclosure retains required and redundant review evidence without hiding rejection (shared=${shared}, rejected=${rejected})`, async ({page}) => {
  let spoken = '', rawReview = ''
  const calls: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({provider: 'openai', baseUrl: 'https://review-normalization.invalid/v1', model: 'test', maxTokens: 6000}))
    sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key')
  })
  await page.route('https://review-normalization.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const messages = route.request().postDataJSON().messages as Array<{content: string}>
    const review = messages[1].content.includes('本次持久化行动候选')
    calls.push(review ? 'review' : 'action')
    const value = review
      ? {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '注入工程判定，不是模型质量证据。'})),
        disclosureChecks: [{factKey: shared ? 'road' : 'regret', passed: !rejected, reason: shared ? '既有共同事实的附加检查；失败不可忽略。' : '当前披露须逐事实等义审查；失败不可忽略。'}]}
      : {kind: 'speak', text: spoken, goalKey: 'find-seal', evidenceFactKeys: [shared ? 'road' : 'regret'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
        newFacts: [], disclosures: shared ? [] : [{factKey: 'regret', toParticipantKeys: ['player'], evidenceExcerpt: spoken, wording: 'equivalent'}], threadUpdates: [], goalStatus: null}
    if (review) rawReview = JSON.stringify(value)
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, value)}, finish_reason: 'stop'}]})})
  })
  await page.goto('./chat/library')
  const f = await page.evaluate(async shared => {
    const load = new Function('p', 'return import(p)'), f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture()
    const state = await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)
    return {...f, original: state.interaction.chatNarrative.situation.facts.find((fact: {factKey: string}) => fact.factKey === (shared ? 'road' : 'regret'))}
  }, shared)
  spoken = f.original.text
  await page.goto(`./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  if (rejected) {
    await expect(page.getByText(shared ? /既有共同事实审查未通过/ : /行动语义审查未通过/)).toBeVisible()
    await expect(page.getByRole('article').getByText(spoken, {exact: true})).toHaveCount(0)
  } else await expect(page.getByRole('article').getByText(spoken, {exact: true})).toBeVisible()
  const evidence = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
    const state = await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)
    const artifacts = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()
    return {state, raw: artifacts.filter((a: {artifactKind: string}) => a.artifactKind === 'raw-response').map((a: {content: string}) => a.content),
      reports: artifacts.filter((a: {artifactKind: string; content: string}) => a.artifactKind === 'tool-result' && a.content.includes('storyforge.chat-review-normalization')).map((a: {content: string}) => a.content)}
  }, f)
  expect(evidence.state.interaction.messages).toHaveLength(rejected ? 0 : 1)
  expect(evidence.state.interaction.chatNarrative.situation.facts.find((fact: {factKey: string}) => fact.factKey === f.original.factKey)).toEqual(shared ? f.original : {...f.original, audienceKeys: rejected ? ['guard'] : ['guard', 'player']})
  expect(evidence.raw).toContain(rawReview); expect(evidence.reports).toHaveLength(!rejected && shared ? 1 : 0)
  await page.reload(); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  const restored = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts'), portable = await load('/storyforge/src/lib/export/json-export.ts'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
    const before = await api.readProductRuntimeState(f.sessionId), projectId = await portable.importProjectJSON(await portable.exportProjectJSON(f.scope.projectId))
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((s: {kind: string}) => s.kind === 'character-interaction')
    const after = await api.readProductRuntimeState(session.id), artifacts = await db.agentRunArtifacts.where('projectId').equals(projectId).toArray()
    return {before, after, session, retained: artifacts.map((a: {content: string}) => a.content)}
  }, f)
  expect(restored.before).toEqual(evidence.state); expect(restored.after.interaction).toEqual(evidence.state.interaction)
  expect(restored.retained).toContain(rawReview)
  for (const report of evidence.reports) expect(restored.retained).toContain(report)
  await page.goto(`./chat/play?project=${restored.session.projectId}&work=${restored.session.workId}&session=${restored.session.id}`)
  await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  await expect(page.getByRole('article').getByText(spoken, {exact: true})).toHaveCount(rejected ? 0 : 1)
  expect(calls).toEqual(['action', 'review'])
})
