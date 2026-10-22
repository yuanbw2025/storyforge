import { test, expect } from '@playwright/test'

/** Native transaction/Run locks and the real registered HTTP client, with a
 * local response fixture. Normal author UI and real provider acceptance stay separate. */
test('two native tabs adopt one selection once and terminal repair preserves later author edits after reload', async ({ page }, info) => {
  await page.goto('./')
  const setup = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)')
    const f = await (await load('/storyforge/tests/helpers/ttrpg-open-design.ts')).createSavedOpenDesignFixtureV1()
    const campaign = (await load('/storyforge/tests/helpers/ttrpg-open-content.ts')).openCampaignFixture()
    return { scope: f.scope, revision: f.revision, clocks: campaign.clocks, fronts: campaign.fronts }
  })
  let requests = 0
  await page.route('**/fixture-adoption/v1/chat/completions', async route => {
    requests++
    const messages = route.request().postDataJSON().messages, keys = JSON.parse(messages[1].content.match(/【实际读取资源闭集】([^\n]+)/)[1])
    const output = JSON.stringify({ schema: 'storyforge.ttrpg-open-authoring-design-proposals', version: 1,
      proposals: [0, 1, 2].map(index => ({ proposalKey: `design.${index}`, title: `模型方向${index}`, pitch: '工程压力候选', patch: {
        pressure: { clocks: setup.clocks.map((clock: any) => ({ ...clock, maximum: 12 + index * 2, sourceRefs: [keys[0]] })),
          fronts: setup.fronts.map((front: any) => ({ ...front, sourceRefs: [keys[0]] })) },
      } })) })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: output }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) })
  })
  const candidate = await page.evaluate(async input => {
    const load = new Function('path', 'return import(path)'), api = await load('/storyforge/src/lib/ttrpg/open-authoring-design.ts')
    return api.generateTtrpgOpenAuthoringDesignCandidateV1({ scope: input.scope, revision: input.revision,
      request: { schema: 'storyforge.ttrpg-open-authoring-design-request', version: 1, instruction: '起草三种压力节奏', sections: ['pressure'] },
      aiConfig: { provider: 'custom', model: 'fixture-model', baseUrl: `${location.origin}/fixture-adoption/v1`, apiKey: 'fixture-only', temperature: 0.7, maxTokens: 16000, contextWindow: 131072 } })
  }, setup)
  const other = await page.context().newPage(); await other.goto('./')
  const adoption = { scope: setup.scope, runId: candidate.runId, candidateHash: candidate.candidateHash,
    selection: { pressure: 'design.1' }, confirmedFactKeys: [], confirmation: 'confirm-design-selection-v1' }
  const results = await Promise.all([page, other].map(tab => tab.evaluate(async input => {
    const load = new Function('path', 'return import(path)')
    return (await load('/storyforge/src/lib/ttrpg/open-authoring-design.ts')).adoptTtrpgOpenAuthoringDesignV1(input)
  }, adoption)))
  expect(results[0].adoption.adoptionHash).toBe(results[1].adoption.adoptionHash)
  const saved = await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const draft = await (await load('/storyforge/src/lib/ttrpg/authoring-service.ts')).readTtrpgDraft(scope)
    return { draft, title: (await db.works.get(scope.workId)).title, productions: await db.productProductions.count(), builds: await db.productBuilds.count() }
  }, setup.scope)
  expect(saved.draft.revision).toBe(setup.revision + 1)
  expect(JSON.parse(saved.draft.settingsJson).openAuthoring.pressure.clocks[0].maximum).toBe(14)
  expect(saved.title).toBe('作者保留的战役名称'); expect(saved.productions).toBe(0); expect(saved.builds).toBe(0)
  await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)'), api = await load('/storyforge/src/lib/ttrpg/authoring-service.ts')
    const draft = await api.readTtrpgDraft(scope), settings = JSON.parse(draft.settingsJson)
    settings.wizard.savedRulePackId = draft.savedRulePackId; settings.openingSituation = '采纳后真实人工修改的开场'
    await api.saveTtrpgDraft(scope, draft.revision, settings, '人工最新名称')
  }, setup.scope)
  await page.reload()
  const repaired = await page.evaluate(async input => {
    const load = new Function('path', 'return import(path)'), api = await load('/storyforge/src/lib/ttrpg/open-authoring-design.ts')
    const result = await api.reconcileTtrpgOpenAuthoringDesignAdoptionV1(input)
    const snapshot = await (await load('/storyforge/src/lib/agent/run/event-store.ts')).readAgentRunV1(input.scope, input.runId)
    const draft = await (await load('/storyforge/src/lib/ttrpg/authoring-service.ts')).readTtrpgDraft(input.scope)
    return { result, draft, status: snapshot.run.status, adoptions: snapshot.events.filter((event: any) => event.type === 'adoption.committed').length }
  }, adoption)
  expect(repaired.result.receiptPending).toBe(false); expect(repaired.status).toBe('completed')
  expect(repaired.result.adoption.adoptionHash).toBe(results[0].adoption.adoptionHash)
  expect(repaired.draft.revision).toBe(setup.revision + 2)
  expect(JSON.parse(repaired.draft.settingsJson).openingSituation).toBe('采纳后真实人工修改的开场')
  expect(repaired.adoptions).toBe(1); expect(requests).toBe(1)
  await info.attach('one-author-adoption-and-historical-repair', { body: JSON.stringify({ results, saved, repaired, requests }), contentType: 'application/json' })
})
