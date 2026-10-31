import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {expect, test} from '@playwright/test'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {chatInquiryReviewFixture} from '../helpers/chat-inquiry-output'
import type {ChatSituationDraftV1} from '../../src/lib/types/chat-narrative'

const questions = ['叶岑问掌柜：“你最后一次见到铜印是什么时候？”', '叶岑接着问掌柜：“那之后你有没有留意谁靠近柜台？”']
const answers = ['我记得傍晚还看见过，具体时间没留意。', '我没有留意谁靠近柜台，无法指认。']
const respondent = {respondentFactKey: 'clerk-present', respondentExcerpt: '掌柜在柜台另一端，可以当面交谈。', respondentName: '掌柜'}
for (const {width, rejectSecond} of [{width: 390, rejectSecond: false}, {width: 1440, rejectSecond: false}, {width: 390, rejectSecond: true}]) {
  test(`two actual questions settle within one two-action turn, including final review and reload (${width}, reject=${rejectSecond})`, async ({page}) => {
    test.setTimeout(120000)
    await page.setViewportSize({width, height: 900})
    await page.addInitScript(() => {
      localStorage.setItem('storyforge_guide_completed', 'isolated-inquiry-settlement')
    })
    registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://inquiry-settlement.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-fixture-key' })
    let sessionId = 0, actionCount = 0, answerCount = 0, totalCalls = 0, proposal: ChatSituationDraftV1
    const calls: string[] = []
    const read = () => page.evaluate(async id => {
      const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts')
      const {db} = await load('/storyforge/src/lib/db/schema.ts')
      return {state: await api.readProductRuntimeState(id), runs: await db.agentRuns.where('productRuntimeSessionId').equals(id).toArray()}
    }, sessionId)
    await page.route('https://inquiry-settlement.invalid/**', async route => {
      totalCalls++; if (await fulfillChatActionChoiceFixture(route)) return
      const messages = route.request().postDataJSON().messages as Array<{content: string}>, prompt = messages.map(m => m.content).join('\n')
      const actionReview = prompt.includes('本次持久化行动候选'), situationReview = prompt.includes('本次持久化情境候选')
      const construction = !situationReview && prompt.includes('你是 StoryForge 受治理的幕后情境构建器')
      calls.push(actionReview ? 'action-review' : situationReview ? 'situation-review' : construction ? 'construction' : 'action')
      let output: unknown
      if (situationReview) {
        expect(messages[0].content).toContain('只结算已提交问题')
        const report = chatInquiryReviewFixture(proposal)
        if (rejectSecond && answerCount === 2) report.inquiryReview.checks.find(c => c.check === 'meaningful-result')!.passed = false
        output = report
      } else if (actionReview) {
        expect(messages[0].content).toContain('独立核对正文已实际向同一在场')
        output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '隔离工程响应，不是模型质量评分'}))}
      } else if (construction) {
        const state = (await read()).state.interaction, story = state.chatNarrative, pending = story.pendingSituation
        expect(pending.purpose).toBe('inquiry-result')
        expect(messages[1].content).toContain('"version":5')
        expect(messages[0].content).toContain('只结算这一条已问出的问题')
        proposal = {kind: 'chat-situation', title: story.situation.title, location: story.situation.location, timeLabel: story.situation.timeLabel,
          newFacts: [], newGoals: [], newThreads: [], possibilities: [], inquiryResult: {actorKey: pending.actorKey, questionSequence: pending.sourceEventSequence,
            questionExcerpt: pending.evidenceExcerpt, ...respondent, statementFactKey: `inquiry-answer-${answerCount + 1}`,
            answerKind: 'uncertain', answerText: answers[answerCount], audienceKeys: ['guard', 'player'], evidenceFactKeys: pending.evidenceFactKeys, discoveries: []}}
        answerCount++; expect(answerCount).toBeLessThanOrEqual(2); output = proposal
      } else {
        expect(messages[0].content).toContain('同一行动登记 situationRequest')
        if (actionCount) expect(messages[1].content).toContain(answers[0])
        const text = questions[actionCount], evidenceFactKeys = ['lost', 'clerk-present', ...(actionCount ? ['inquiry-answer-1'] : [])]
        output = {kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys, audienceKeys: ['guard', 'player'], waitingForPlayer: false,
          newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
          situationRequest: {purpose: 'inquiry-result', threadKey: 'investigate', direction: '只回应本次已向掌柜问出的问题。', evidenceFactKeys, evidenceExcerpt: text, ...respondent}}
        actionCount++; expect(actionCount).toBeLessThanOrEqual(2)
      }
      await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
    })
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
    const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({inquiryResults: true, maxActionsPerTrigger: 2})})
    sessionId = f.sessionId
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${sessionId}`)
    await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
    const before = await read()
    await page.getByRole('button', {name: '让角色开场', exact: true}).click()
    await expect.poll(async () => (await read()).runs.map((r: {status: string}) => r.status), {timeout: 60000}).toEqual(['completed', 'completed', 'completed', rejectSecond ? 'failed' : 'completed'])
    await expect(page.getByRole('article').getByText(questions[1], {exact: true})).toBeVisible()
    await expect(page.getByTestId('chat-inquiry-reply')).toHaveCount(rejectSecond ? 1 : 2)
    if (rejectSecond) await expect(page.getByText(answers[1], {exact: true})).toHaveCount(0)
    else await expect(page.getByRole('article').getByText(answers[1], {exact: true})).toBeVisible()
    const after = await read(), story = after.state.interaction.chatNarrative
    expect(after.state.interaction.messages.map((m: {text: string}) => m.text)).toEqual(questions)
    expect(story.inquiryHistory).toHaveLength(rejectSecond ? 1 : 2)
    expect(story.triggers.at(-1).actionSequences).toHaveLength(2)
    expect(story.situation.goals).toEqual(before.state.interaction.chatNarrative.situation.goals)
    if (rejectSecond) expect(story.pendingSituation).toMatchObject({purpose: 'inquiry-result', evidenceExcerpt: questions[1], ...respondent})
    else {expect(story.pendingSituation).toBeUndefined(); expect(story.triggers.at(-1).status).toBe('complete')}
    expect(calls).toEqual(['action', 'action-review', 'construction', 'situation-review', 'action', 'action-review', 'construction', 'situation-review'])
    expect(totalCalls).toBe(10)
    await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
    expect((await read()).state).toEqual(after.state); expect(totalCalls).toBe(10)
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  })
}
