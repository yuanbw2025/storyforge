import { test, expect } from '@playwright/test'

/** Native storage and the real registered client path, with a local HTTP
 * fixture response. This is not real-provider or normal author-UI acceptance. */
test('one registered design request preserves raw evidence and reloads the same candidate without re-sending', async ({ page }, info) => {
  await page.goto('./')
  const setup = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)')
    const f = await (await load('/storyforge/tests/helpers/open-ttrpg-fresh-authoring.ts')).createFreshOpenDraftFixtureV1()
    const api = await load('/storyforge/src/lib/ttrpg/authoring-service.ts')
    const settings = structuredClone(f.settings)
    settings.openAuthoring = { ...settings.openAuthoring, factPolicy: [], situationTemplates: [], openingSituationKeys: [],
      effectPlanTemplates: [], pressure: { clocks: [], fronts: [] }, dynamicEntityTemplates: [] }
    let draft = await api.saveTtrpgDraft(f.scope, f.draft.revision, settings, '设计候选的浏览器工程验证')
    const starts = await (await load('/storyforge/src/lib/product-production/consultation.ts')).suggestProductStartingPoints({ scope: f.scope, worldReleaseId: draft.worldReleaseId })
    const choice = starts.suggestions.find((item: any) => item.recommendedProductTypes.includes('ttrpg'))
    draft = await api.saveTtrpgSourceSelection(f.scope, draft.revision, choice.suggestionKey, starts.selectionDefaults[choice.suggestionKey])
    const campaign = (await load('/storyforge/tests/helpers/ttrpg-open-content.ts')).openCampaignFixture()
    return { scope: f.scope, revision: draft.revision, settingsJson: draft.settingsJson, clocks: campaign.clocks, fronts: campaign.fronts }
  })
  let requests = 0, rawAnswer = ''
  await page.route('**/fixture-design/v1/chat/completions', async route => {
    requests++
    const messages = route.request().postDataJSON().messages
    const keys = JSON.parse(messages[1].content.match(/【实际读取资源闭集】([^\n]+)/)[1])
    rawAnswer = JSON.stringify({ schema: 'storyforge.ttrpg-open-authoring-design-proposals', version: 1,
      proposals: [0, 1, 2].map(index => ({ proposalKey: `design.${index}`, title: `工程候选${index}`, pitch: '演示三种压力节奏',
        patch: { pressure: { clocks: setup.clocks.map((clock: any) => ({ ...clock, maximum: 12 + index * 2, sourceRefs: [keys[0]] })),
          fronts: setup.fronts.map((front: any) => ({ ...front, sourceRefs: [keys[0]] })) } } })) })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      choices: [{ message: { content: rawAnswer }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    }) })
  })
  const first = await page.evaluate(async input => {
    const load = new Function('path', 'return import(path)'), api = await load('/storyforge/src/lib/ttrpg/open-authoring-design.ts')
    const candidate = await api.generateTtrpgOpenAuthoringDesignCandidateV1({ scope: input.scope, revision: input.revision,
      request: { schema: 'storyforge.ttrpg-open-authoring-design-request', version: 1, instruction: '请起草三种压力节奏', sections: ['pressure'] },
      aiConfig: { provider: 'custom', model: 'fixture-model', baseUrl: `${location.origin}/fixture-design/v1`, apiKey: 'fixture-only', temperature: 0.7, maxTokens: 16000, contextWindow: 131072 } })
    return candidate
  }, setup)
  expect(requests).toBe(1); expect(first.artifact.status).toBe('ready'); expect(first.proposals?.proposals).toHaveLength(3)
  expect(first.artifact.originalText).toBe(rawAnswer)
  await page.reload()
  const after = await page.evaluate(async input => {
    const load = new Function('path', 'return import(path)'), api = await load('/storyforge/src/lib/ttrpg/open-authoring-design.ts')
    const candidate = await api.recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: input.scope, runId: input.runId })
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const snapshot = await (await load('/storyforge/src/lib/agent/run/event-store.ts')).readAgentRunV1(input.scope, input.runId)
    const checkpoint = await (await load('/storyforge/src/lib/agent/run/checkpoint.ts')).readLatestVerifiedAgentRunCheckpointV1(input.scope, input.runId)
    return { candidate, status: snapshot.run.status, checkpoint: checkpoint.resumePayload,
      settingsJson: (await (await load('/storyforge/src/lib/ttrpg/authoring-service.ts')).readTtrpgDraft(input.scope)).settingsJson,
      requestedEvents: snapshot.events.filter((event: any) => event.type === 'model.requested').length,
      productions: await db.productProductions.count(), builds: await db.productBuilds.count() }
  }, { scope: setup.scope, runId: first.runId })
  expect(after.candidate).toEqual(first); expect(after.status).toBe('awaiting_confirmation')
  expect(after.checkpoint.candidateHash).toBe(first.candidateHash)
  expect(after.settingsJson).toBe(setup.settingsJson); expect(after.requestedEvents).toBe(1)
  expect(after.productions).toBe(0); expect(after.builds).toBe(0); expect(requests).toBe(1)
  await info.attach('registered-design-raw-and-reload', { body: JSON.stringify({ first, after, requests }), contentType: 'application/json' })
})
