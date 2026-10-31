import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'
import {inquiryReassurance, inquiryAnswer, inquiryQuestion, inquiryPurpose, inquiryTruth, chatInquiryReviewFixture} from '../helpers/chat-inquiry-output'
import type {ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const inquiryCases = [false, true].flatMap(privateAnswer => [{privateAnswer, splitQuestion: false, playerInterjection: false}, {privateAnswer, splitQuestion: true, playerInterjection: false}, {privateAnswer, splitQuestion: false, playerInterjection: true}])
for (const {privateAnswer, splitQuestion, playerInterjection} of inquiryCases) test(`actual NPC reply is displayed only to its listeners and feeds the next actor turn (private=${privateAnswer}, split=${splitQuestion}, player=${playerInterjection})`, async ({page}) => {
  const twoUtterances = splitQuestion || playerInterjection
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-inquiry.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
  const calls: string[] = []; let actions = 0, totalCalls = 0, sessionId = 0, proposal: ChatSituationDraftV1
  const followup = '叶岑点点头：“我记下了，接下来会核对具体物件。你可以先做自己的事。”'
  await page.route('https://chat-inquiry.invalid/**', async route => {
    totalCalls++; if (await fulfillChatActionChoiceFixture(route)) return
    const messages = route.request().postDataJSON().messages as Array<{content: string}>, prompt = messages.map(m => m.content).join('\n')
    const actionReview = prompt.includes('本次持久化行动候选'), situationReview = prompt.includes('本次持久化情境候选')
    const construction = !situationReview && prompt.includes('你是 StoryForge 受治理的幕后情境构建器')
    calls.push(actionReview ? 'action-review' : situationReview ? 'situation-review' : construction ? 'construction' : 'action')
    let output: unknown
    if (situationReview) {
      expect(messages[0].content).toContain('actual-audience')
      if (playerInterjection) expect(prompt).toContain('respondentEvidenceFactKeys')
      output = chatInquiryReviewFixture(proposal)
    }
    else if (actionReview) output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是语义验收'}))}
    else if (construction) {
      const pending = JSON.parse(prompt.match(/"pendingSituation":(\{[^}]+\})/)![1])
      expect(pending.evidenceFactKeys).not.toContain('lost')
      if (playerInterjection) {
        expect(pending.evidenceFactKeys).not.toContain('clerk-present')
        expect(prompt).toContain('respondentEvidenceFactKeys')
        expect(prompt).toContain('掌柜在柜台另一端，可以当面交谈。')
      }
      expect(prompt).toContain('storyforge.chat-inquiry-evidence')
      expect(prompt).toContain('requiredEvidenceFactKeys')
      const questionSequence = await page.evaluate(async ({id, question}) => {const load = new Function('p', 'return import(p)'); const state = await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(id); return state.interaction.messages.find((m: {text: string}) => m.text === question).eventSequence}, {id: sessionId, question: inquiryQuestion})
      expect(prompt).toContain(`"questionSequence":${questionSequence}`)
      if (twoUtterances) expect(questionSequence).toBeLessThan(pending.sourceEventSequence)
      if (playerInterjection) {expect(prompt).toContain('嗯，我在听。'); expect(prompt).toContain(inquiryQuestion); expect(prompt).toContain(inquiryReassurance)}
      proposal = {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newFacts: [], newGoals: [], newThreads: [], possibilities: [],
        inquiryResult: {actorKey: 'guard', questionSequence, questionExcerpt: inquiryQuestion,
          respondentFactKey: 'clerk-present', respondentExcerpt: '掌柜在柜台另一端，可以当面交谈。', respondentName: '掌柜', statementFactKey: 'clerk-statement',
          answerKind: 'statement', answerText: inquiryAnswer, audienceKeys: privateAnswer ? ['guard'] : ['guard', 'player'], evidenceFactKeys: ['lost', 'clerk-present', 'box'],
          discoveries: [{factKey: 'secret', answerExcerpt: '铜印仍在柜台下的木箱里', reason: '工程条件授权保管人确认此位置，不解锁用途'}]}}
      output = proposal
    } else {
      actions++; expect(prompt).not.toContain(inquiryPurpose); expect(prompt).not.toContain('factEvidence'); expect(prompt).not.toContain('inquiryEvidence')
      const asking = actions <= (twoUtterances ? 2 : 1), requestsAnswer = actions === (twoUtterances ? 2 : 1)
      if (asking) expect(prompt).not.toContain(inquiryTruth)
      else {expect(prompt).toContain(inquiryAnswer); expect(prompt).toContain(inquiryTruth); expect(prompt).not.toContain('他是保管者')}
      const text = actions === 1 ? inquiryQuestion : asking ? inquiryReassurance : followup
      output = {kind: asking ? 'speak' : 'pause', text, goalKey: 'find-seal', audienceKeys: ['guard', 'player'],
        evidenceFactKeys: asking ? ['clerk-present', 'box'] : ['clerk-statement'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
        ...(requestsAnswer ? {situationRequest: {threadKey: 'investigate', direction: '承接向掌柜提出的具体位置问题，不预定答复。', evidenceFactKeys: playerInterjection ? ['box'] : ['clerk-present', 'box'], evidenceExcerpt: text}} : {})}
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async splitQuestion => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({inquiryResults: true, factDiscovery: true, maxActionsPerTrigger: splitQuestion ? 2 : 1})}, splitQuestion)
  sessionId = f.sessionId
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByRole('article').getByText(inquiryQuestion, {exact: true})).toBeVisible()
  if (playerInterjection) {
    await page.getByLabel('发送给角色的消息', {exact: true}).fill('嗯，我在听。')
    await page.getByRole('button', {name: '发送并生成', exact: true}).click()
  }
  if (twoUtterances) await expect(page.getByRole('article').getByText(inquiryReassurance, {exact: true})).toBeVisible()
  await page.getByRole('button', {name: '让角色继续', exact: true}).click()
  await expect(page.getByRole('article').getByText(followup, {exact: true})).toBeVisible()
  const transcript = page.getByRole('region', {name: '对话记录', exact: true})
  await expect(transcript.getByTestId('chat-inquiry-reply')).toHaveCount(privateAnswer ? 0 : 1)
  if (privateAnswer) await expect(transcript.getByText(inquiryAnswer, {exact: true})).toHaveCount(0)
  else {
    const reply = transcript.getByRole('article').filter({has: page.getByTestId('chat-inquiry-reply')})
    await expect(reply).toContainText('掌柜'); await expect(reply).toContainText(inquiryAnswer)
    await expect(reply.getByTestId('chat-message-tools')).toHaveCount(0)
  }
  await expect(page.getByText(inquiryPurpose, {exact: true})).toHaveCount(0)
  expect(calls).toEqual(['action', 'action-review', ...(twoUtterances ? ['action', 'action-review'] : []), 'construction', 'situation-review', 'action', 'action-review'])
  expect(totalCalls).toBe(twoUtterances ? 11 : 8)
  const before = await read()
  expect(before.chatNarrative.inquiryHistory).toHaveLength(1)
  expect(before.chatNarrative.factEvidence).toEqual({version: 1, records: [{factKey: 'clerk-statement', kind: 'observation',
    evidenceFactKeys: ['lost', 'clerk-present', 'box'], actorKey: 'guard', goalKey: 'find-seal', source: 'inquiry'}]})
  expect(before.chatNarrative.situation.facts.find((f: {factKey: string}) => f.factKey === 'secret').audienceKeys).toEqual(privateAnswer ? ['guard'] : ['guard', 'player'])
  expect(before.chatNarrative.situation.facts.find((f: {factKey: string}) => f.factKey === 'purpose').audienceKeys).toEqual([])
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(before); expect(calls).toHaveLength(twoUtterances ? 8 : 6); expect(totalCalls).toBe(twoUtterances ? 11 : 8)
  await expect(transcript.getByTestId('chat-inquiry-reply')).toHaveCount(privateAnswer ? 0 : 1)
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
})

test('author opts into inquiry results explicitly and removing prerequisite permission clears the opt-in', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); const f = await (await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts')).seedChatNarrativeProductionFixture(); return {scope: f.scope}})
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/vision?project=${f.scope.projectId}&work=${f.scope.workId}`)
  const option = page.getByLabel('允许已在场的场景人物回应角色实际提出的问题', {exact: true})
  await expect(option).not.toBeChecked(); await option.check()
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await expect(page.getByText('方案已保存', {exact: true})).toBeVisible(); await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(option).toBeChecked()
  await page.getByLabel('观察到的新细节', {exact: true}).uncheck()
  await expect(option).not.toBeChecked(); await expect(option).toBeDisabled()
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await expect(page.getByText('方案已保存', {exact: true})).toBeVisible()
})
