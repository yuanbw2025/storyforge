import { test, expect } from '@playwright/test'

/** Native persistence of the new explicit author contract. Plan/source inputs
 * are engineering fixtures, not normal human approval UI or real model evidence. */
test('an explicit saved author seat plan reloads without grants and stale controller edits block a new source before any model request', async ({ page }, info) => {
  await page.goto('./')
  const prepared = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const f = await (await load('/storyforge/tests/helpers/ttrpg-open-design.ts')).createSavedOpenDesignFixtureV1()
    const helper = await load('/storyforge/tests/helpers/ttrpg-open-seat-plan.ts')
    const settings = helper.withOpenAuthoringSeatPlanFixtureV1(f.settings)
    const world = JSON.stringify(await db.worldReleases.toArray())
    const api = await load('/storyforge/src/lib/ttrpg/authoring-service.ts')
    const draft = await api.saveTtrpgDraft(f.scope, f.revision, settings, '本人预留的未来角色')
    const source = await (await load('/storyforge/src/lib/ttrpg/open-authoring-design.ts')).prepareTtrpgOpenAuthoringDesignSourceV1({ scope: f.scope, revision: draft.revision })
    return { scope: f.scope, revision: draft.revision, settingsJson: draft.settingsJson, plan: source.source.settings.authoringSeatPlan,
      worldUnchanged: world === JSON.stringify(await db.worldReleases.toArray()), runs: await db.agentRuns.count(), builds: await db.productBuilds.count(), productions: await db.productProductions.count() }
  })
  expect(prepared.worldUnchanged).toBe(true); expect(prepared.runs).toBe(0); expect(prepared.builds).toBe(0); expect(prepared.productions).toBe(0)
  await page.reload()
  const reloaded = await page.evaluate(async input => {
    const load = new Function('p', 'return import(p)'), api = await load('/storyforge/src/lib/ttrpg/authoring-service.ts')
    const { db } = await load('/storyforge/src/lib/db/schema.ts')
    const draft = await api.readTtrpgDraft(input.scope)
    const settings = (await load('/storyforge/src/lib/ttrpg/authoring-contract.ts')).settingsFromTtrpgDraft(draft)
    const plan = structuredClone(settings.authoringSeatPlan)
    settings.wizard.seats[1].controller = 'human'
    const saved = await api.saveTtrpgDraft(input.scope, draft.revision, settings, '保留尚待核对的席位修改')
    let rejection = ''
    try { await (await load('/storyforge/src/lib/ttrpg/open-authoring-design.ts')).prepareTtrpgOpenAuthoringDesignSourceV1({ scope: input.scope, revision: saved.revision }) }
    catch (error) { rejection = error instanceof Error ? error.message : String(error) }
    return { originalJson: draft.settingsJson, plan, saved, rejection, actual: await api.readTtrpgDraft(input.scope),
      runs: await db.agentRuns.count(), builds: await db.productBuilds.count(), productions: await db.productProductions.count() }
  }, prepared)
  expect(reloaded.originalJson).toBe(prepared.settingsJson); expect(reloaded.plan).toEqual(prepared.plan)
  expect(reloaded.rejection).toContain('席位或控制者已变化'); expect(reloaded.actual).toEqual(reloaded.saved)
  expect(reloaded.runs).toBe(0); expect(reloaded.builds).toBe(0); expect(reloaded.productions).toBe(0)
  await info.attach('native-plan-and-stale-controller', { body: JSON.stringify({ prepared, reloaded }), contentType: 'application/json' })
})

test('the real frozen Brief preserves an explicit plan while the preceding absent-field Brief bytes remain unchanged', async ({ page }, info) => {
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const f = await (await load('/storyforge/tests/helpers/open-ttrpg-fresh-authoring.ts')).createFreshOpenDraftFixtureV1()
    const api = await load('/storyforge/src/lib/ttrpg/authoring-service.ts'), contract = await load('/storyforge/src/lib/ttrpg/authoring-contract.ts')
    const id = await api.prepareTtrpgBrief(f.scope, f.draft.revision)
    const before = await db.productProductionBriefs.where('productionId').equals(id).toArray()
    const old = await api.readTtrpgDraft(f.scope), settings = (await load('/storyforge/tests/helpers/ttrpg-open-seat-plan.ts')).withOpenAuthoringSeatPlanFixtureV1(contract.settingsFromTtrpgDraft(old))
    const draft = await api.saveTtrpgDraft(f.scope, old.revision, settings, '明确预留后另存新版本')
    const nextId = await api.prepareTtrpgBrief(f.scope, draft.revision)
    const after = await db.productProductionBriefs.where('productionId').equals(id).toArray()
    const parsed = (await load('/storyforge/src/lib/product-production/contracts.ts')).parseProductProductionBriefV3(after[after.length - 1].briefJson)
    return { id, nextId, before, after, plan: parsed.ttrpgOpen.settings.authoringSeatPlan, expected: settings.authoringSeatPlan,
      runs: await db.agentRuns.count(), builds: await db.productBuilds.count() }
  })
  expect(result.nextId).toBe(result.id); expect(result.after).toHaveLength(result.before.length + 1)
  for (const original of result.before) expect(result.after.find((row: any) => row.id === original.id)).toEqual(original)
  expect(result.plan).toEqual(result.expected); expect(result.runs).toBe(0); expect(result.builds).toBe(0)
  await info.attach('native-old-and-opt-in-Brief', { body: JSON.stringify(result), contentType: 'application/json' })
})
