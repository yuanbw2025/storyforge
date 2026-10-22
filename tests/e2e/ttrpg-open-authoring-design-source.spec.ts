import { test, expect } from '@playwright/test'

/** Headless S2 foundation in native isolated IndexedDB. Built-in world and
 * prior authoring fixture are engineering inputs, not normal AI production. */
test('an empty author design freezes only its saved source and reloads without starting a model or production', async ({ page }, info) => {
  const modelRequests: string[] = []
  page.on('request', request => { if (/\/(?:chat\/completions|responses)(?:\?|$)/.test(request.url())) modelRequests.push(request.url()) })
  await page.goto('./')
  const first = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)')
    const f = await (await load('/storyforge/tests/helpers/open-ttrpg-fresh-authoring.ts')).createFreshOpenDraftFixtureV1()
    const api = await load('/storyforge/src/lib/ttrpg/authoring-service.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const settings = structuredClone(f.settings)
    settings.openAuthoring = { ...settings.openAuthoring, factPolicy: [], situationTemplates: [], openingSituationKeys: [],
      effectPlanTemplates: [], pressure: { clocks: [], fronts: [] }, dynamicEntityTemplates: [] }
    let draft = await api.saveTtrpgDraft(f.scope, f.draft.revision, settings, '尚未生成设计的作者')
    const starts = await (await load('/storyforge/src/lib/product-production/consultation.ts')).suggestProductStartingPoints({ scope: f.scope, worldReleaseId: draft.worldReleaseId })
    const choice = starts.suggestions.find((item: any) => item.recommendedProductTypes.includes('ttrpg'))
    draft = await api.saveTtrpgSourceSelection(f.scope, draft.revision, choice.suggestionKey, starts.selectionDefaults[choice.suggestionKey])
    const preparationStartedAt = Date.now()
    const prepared = await (await load('/storyforge/src/lib/ttrpg/open-authoring-design.ts')).prepareTtrpgOpenAuthoringDesignSourceV1({ scope: f.scope, revision: draft.revision })
    await prepared.assertCurrent()
    const { createdAt, planHash, ...semanticPlan } = prepared.source.sourcePlan
    return { scope: f.scope, revision: draft.revision, basisHash: prepared.source.basisHash, planHash,
      preparationStartedAt, preparationEndedAt: Date.now(), createdAt, semanticPlan,
      worldHash: prepared.source.worldReference.referenceHash, ruleHash: prepared.source.rulePackHash,
      settingsJson: (await api.readTtrpgDraft(f.scope)).settingsJson, templates: prepared.source.settings.openAuthoring.situationTemplates.length,
      runs: await db.agentRuns.count(), productions: await db.productProductions.count(), builds: await db.productBuilds.count() }
  })
  expect(first.templates).toBe(0); expect(first.runs).toBe(0); expect(first.productions).toBe(0); expect(first.builds).toBe(0)
  expect(first.createdAt).toBeGreaterThanOrEqual(first.preparationStartedAt)
  expect(first.createdAt).toBeLessThanOrEqual(first.preparationEndedAt)
  await page.reload()
  const second = await page.evaluate(async input => {
    const load = new Function('path', 'return import(path)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const preparationStartedAt = Date.now()
    const prepared = await (await load('/storyforge/src/lib/ttrpg/open-authoring-design.ts')).prepareTtrpgOpenAuthoringDesignSourceV1({ scope: input.scope, revision: input.revision })
    const { createdAt, planHash, ...semanticPlan } = prepared.source.sourcePlan
    return { basisHash: prepared.source.basisHash, planHash,
      preparationStartedAt, preparationEndedAt: Date.now(), createdAt, semanticPlan,
      worldHash: prepared.source.worldReference.referenceHash, ruleHash: prepared.source.rulePackHash,
      settingsJson: (await (await load('/storyforge/src/lib/ttrpg/authoring-service.ts')).readTtrpgDraft(input.scope)).settingsJson,
      runs: await db.agentRuns.count(), productions: await db.productProductions.count(), builds: await db.productBuilds.count() }
  }, first)
  expect(second.createdAt).toBeGreaterThanOrEqual(second.preparationStartedAt)
  expect(second.createdAt).toBeLessThanOrEqual(second.preparationEndedAt)
  expect(second.createdAt).toBeGreaterThan(first.createdAt)
  expect(second.planHash).not.toBe(first.planHash)
  expect(second.basisHash).not.toBe(first.basisHash)
  const { basisHash: _basis, planHash: _plan, createdAt: _created, preparationStartedAt: _start, preparationEndedAt: _end, ...secondContent } = second
  expect(secondContent).toEqual({ semanticPlan: first.semanticPlan, worldHash: first.worldHash, ruleHash: first.ruleHash,
    settingsJson: first.settingsJson, runs: 0, productions: 0, builds: 0 })
  expect(modelRequests).toEqual([])
  await info.attach('empty-author-design-source', { body: JSON.stringify({ first, second, modelRequests }), contentType: 'application/json' })
})
