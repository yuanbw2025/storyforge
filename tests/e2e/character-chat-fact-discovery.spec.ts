import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {test, expect} from '@playwright/test'

test('author explicitly enables hidden-fact discovery and reviews conditions in the formal initial-situation gate', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  let networkCalls = 0
  await page.route('**/chat/completions', async route => {networkCalls++; await route.abort()})
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const f = await (await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts')).seedChatNarrativeProductionFixture()
    return {scope: f.scope, worldReleaseId: f.confirmed.worldReleaseId}
  })
  const query = `project=${f.scope.projectId}&work=${f.scope.workId}`
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/vision?${query}`)
  await expect(page.getByLabel('每次调查最多揭示', {exact: true})).toHaveValue('0')
  await page.getByLabel('每次调查最多揭示', {exact: true}).selectOption('2')
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await expect(page.getByText('方案已保存', {exact: true})).toBeVisible()
  await reloadWithBrowserFixtureAIConfigV1(page)
  await expect(page.getByLabel('每次调查最多揭示', {exact: true})).toHaveValue('2')
  const productionId = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)'), db = (await load('/storyforge/src/lib/db/schema.ts')).db
    const draft = await (await load('/storyforge/src/lib/character-interaction/draft-service.ts')).readChatDraftV1(f.scope), settings = JSON.parse(draft.settingsJson)
    const consultation = await load('/storyforge/src/lib/product-production/consultation.ts')
    const starting = await consultation.suggestProductStartingPoints({scope: f.scope, worldReleaseId: f.worldReleaseId})
    const brief = await consultation.draftProductProductionBriefV3({scope: f.scope, worldReleaseId: f.worldReleaseId, suggestionKey: starting.suggestions[0].suggestionKey,
      productType: 'character-interaction', characterChat: settings, playerRole: settings.playerRole, openingSituation: settings.openingSituation, visualLevel: 'none', audioLevel: 'none'})
    const execute = (await load('/storyforge/src/lib/product-production/commands.ts')).executeProductProductionCommand
    const created = await execute({scope: f.scope, command: {type: 'create-intent', commandId: 'discovery.intent', productionKey: 'chat.discovery', productType: 'character-interaction', worldReleaseId: f.worldReleaseId, userText: '制作调查开场'}})
    const productionId = created.productionId
    const saved = await execute({scope: f.scope, productionId, command: {type: 'save-brief-revision', commandId: 'discovery.brief', expectedStateRevision: 0, parentRevision: null, brief}})
    await execute({scope: f.scope, productionId, command: {type: 'authorize-start', commandId: 'discovery.start', expectedStateRevision: 1, briefRevision: 1, briefHash: saved.result.briefHash, authorizationNonce: 'author.start'}})
    const requirementKey = brief.capabilityRequirements.find((r: {mediaClass: string}) => r.mediaClass === 'text').requirementKey, bindingHash = 'a'.repeat(64)
    const executor = (await load('/storyforge/src/lib/product-production/production-executor.ts')).createConfiguredProductProductionExecutorV1({production: await db.productProductions.get(productionId), brief,
      runText: async (request: {system: string}) => {
        const source = JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'design.game').last()).payloadJson)
        const helper = await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts'), candidates = request.system.includes('开场的语义审查者') ? JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'content.chat-candidates').last()).payloadJson) : helper.chatSituationCandidatesFixture(source)
        const output = request.system.includes('开场的语义审查者') ? helper.chatOpeningPerspectiveReviewFixture(source, candidates) : candidates
        return {output: JSON.stringify(output), usage: {inputTokens: 100, outputTokens: 100}, bindingReceipt: {schema: 'storyforge.provider-binding-receipt', version: 1, requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1, provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid', executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true, capabilityHash: bindingHash, boundAt: 1, receiptHash: 'b'.repeat(64)}}
      }})
    await (await load('/storyforge/src/lib/product-production/scheduler.ts')).runProductProductionUntilBlockedV1({scope: f.scope, productionId, capabilityBindings: [{requirementKey, adapterId: 'configured-text.v1', bindingHash}], executor})
    return productionId
  }, f)
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/production?${query}&production=${productionId}`)
  await expect(page.getByTestId('chat-situation-selection')).toBeVisible()
  const first = page.getByTestId('chat-situation-selection').locator('article').first()
  await first.getByText('查看完整背景与角色视角（作者可见）', {exact: true}).click()
  await expect(first.getByTestId('chat-discovery-rule')).toContainText('店主实际打开并查看获准检查的蓝色布包内部')
  await expect(first.getByTestId('chat-discovery-rule')).toContainText('必要前提：工作台上的蓝色布包获准由店主自行打开查看。')
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/vision?${query}`)
  await page.getByLabel('允许角色依据未完成事项发展新局面', {exact: true}).uncheck()
  await expect(page.getByLabel('每次调查最多揭示', {exact: true})).toBeDisabled()
  await expect(page.getByLabel('每次调查最多揭示', {exact: true})).toHaveValue('0')
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await expect(page.getByText('方案已保存', {exact: true})).toBeVisible()
  expect(networkCalls).toBe(0)
})

for (const rejected of [false, true]) test(`a completed investigation only reveals the same fact after review, then the role decides to disclose (rejected=${rejected})`, async ({page}) => {
  const calls: string[] = []
  let actionCount = 0
  const investigated = '叶岑独自打开并查看获准检查的木箱内部。', truth = '铜印在柜台下的木箱里。'
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
  })
  registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-discovery.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
  await page.route('https://chat-discovery.invalid/**', async route => {
          if (await fulfillChatActionChoiceFixture(route)) return
    const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n')
    const actionReview = prompt.includes('本次持久化行动候选'), situationReview = prompt.includes('本次持久化情境候选')
    const construction = !situationReview && prompt.includes('你是 StoryForge 受治理的幕后情境构建器')
    calls.push(actionReview ? 'action-review' : situationReview ? 'situation-review' : construction ? 'construction' : 'action')
    let output: unknown
    if (actionReview || situationReview) output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', ...(actionReview ? ['consequences'] : []), 'meaningful-direction'].map(check => ({check, passed: !(rejected && situationReview && check === 'permissions'), reason: '工程审查夹具，不是剧情质量验收'})),
      ...(actionReview && actionCount === 2 ? {disclosureChecks: [{factKey: 'secret', passed: true, reason: '本次正文完整传达已获知的铜印位置，核验逐事实审查路径。'}]} : {})}
    else if (construction) {
      const pending = JSON.parse(prompt.match(/"pendingSituation":(\{[^}]+\})/)![1])
      expect(prompt).toContain(truth)
      output = {kind: 'chat-situation', title: '暴雨驿站', location: '驿站', timeLabel: '傍晚', newFacts: [], newGoals: [], newThreads: [], possibilities: [],
        discoveries: [{factKey: 'secret', actorKey: 'guard', actionSequence: pending.sourceEventSequence, evidenceFactKeys: ['lost', 'box', 'inspected'], evidenceExcerpt: investigated, result: 'discovered', reason: '条件核验工程夹具'}]}
    } else {
      actionCount++
      if (actionCount === 1) {
        expect(prompt).not.toContain(truth)
        output = {kind: 'complete', text: investigated, goalKey: 'find-seal', evidenceFactKeys: ['lost', 'box'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
          newFacts: [{factKey: 'inspected', kind: 'observation', text: investigated, evidenceFactKeys: ['box'], evidenceExcerpt: investigated}], disclosures: [], threadUpdates: [], goalStatus: null,
          situationRequest: {threadKey: 'investigate', direction: '依据实际检查木箱的结果确认可观察的发现，不预定找到铜印。', evidenceFactKeys: ['lost', 'box', 'inspected'], evidenceExcerpt: investigated}}
      } else {
        expect(prompt).toContain(truth)
        expect(prompt).not.toContain('打算检查或只打开而未查看不足以发现')
        output = {kind: 'complete', text: truth, goalKey: 'find-seal', evidenceFactKeys: ['secret'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
          newFacts: [], disclosures: [{factKey: 'secret', toParticipantKeys: ['player'], evidenceExcerpt: truth, wording: 'equivalent'}], threadUpdates: [], goalStatus: 'fulfilled', nextPossibilities: []}
      }
    }
    await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})})
  })
  await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
  const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({factDiscovery: true})})
  const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction}, f)
  await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`)
  await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
  await page.getByRole('button', {name: '让角色开场', exact: true}).click()
  await expect(page.getByRole('article').getByText(investigated, {exact: true})).toBeVisible()
  // The bounded opening now settles its reviewed observation before handing
  // control back. Discovery belongs to the investigator, not yet to the player.
  if (rejected) await expect(page.getByText(/情境语义审查未通过/)).toBeVisible()
  else await expect.poll(async () => (await read()).chatNarrative.discoveryHistory?.length ?? 0).toBe(1)
  await expect(page.getByText(truth, {exact: true})).toHaveCount(0)
  expect(calls).toEqual(['action', 'action-review', 'construction', 'situation-review'])
  expect(actionCount).toBe(1)
  const settled = await read()
  expect(settled.chatNarrative.situation.facts.filter((fact: {text: string}) => fact.text === truth)).toHaveLength(1)
  expect(settled.chatNarrative.situation.facts.find((fact: {factKey: string}) => fact.factKey === 'secret').audienceKeys).toEqual(rejected ? [] : ['guard'])
  expect(settled.chatNarrative.discoveryHistory?.length ?? 0).toBe(rejected ? 0 : 1)
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(settled)
  expect(calls).toHaveLength(4)
  await expect(page.getByText(truth, {exact: true})).toHaveCount(0)
  if (!rejected) {
    await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard')
    await page.getByRole('button', {name: '让角色继续', exact: true}).click()
    await expect(page.getByRole('article').getByText(truth, {exact: true})).toBeVisible()
  }
  const before = await read()
  expect(before.chatNarrative.situation.facts.filter((fact: {text: string}) => fact.text === truth)).toHaveLength(1)
  expect(before.chatNarrative.situation.facts.find((fact: {factKey: string}) => fact.factKey === 'secret').audienceKeys).toEqual(rejected ? [] : ['guard', 'player'])
  expect(before.chatNarrative.discoveryHistory?.length ?? 0).toBe(rejected ? 0 : 1)
  expect(calls).toHaveLength(rejected ? 4 : 6)
  expect(actionCount).toBe(rejected ? 1 : 2)
  await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible()
  expect(await read()).toEqual(before)
  expect(calls).toHaveLength(rejected ? 4 : 6)
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
})
