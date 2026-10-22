import { expect, test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
test('P9 preflight uses real source receipts after refresh without accepting, activating, calling a model or changing owners', async ({ page }) => {
  test.setTimeout(120000)
  const sent: string[] = []
  page.on('request', r => { if (/\/v1\/(?:chat\/completions|responses)/.test(r.url())) sent.push(r.url()) })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { seedGeneratedSituationProposalV1 } = await importer('/storyforge/tests/helpers/open-generated-situation-proposal.ts')
    const { preflightTtrpgOpenGeneratedSituationV1 } = await importer('/storyforge/src/lib/ttrpg/open-generated-situation-basis.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { input, value } = await seedGeneratedSituationProposalV1()
    const owners = async () => JSON.stringify({ world: await db.worldReleases.toArray(), releases: await db.productReleases.toArray(), sessions: await db.productRuntimeSessions.toArray(), events: await db.productRuntimeEvents.toArray(), runs: await db.agentRuns.toArray() })
    const before = await owners(), result = await preflightTtrpgOpenGeneratedSituationV1({ ...input, value })
    if (before !== await owners()) throw new Error('read-only P9 preflight changed an owner')
    return { input, value, proposalHash: result.proposalHash, basisHash: result.basisHash, accepted: result.evaluation.accepted, grantsAcceptance: result.grantsAcceptance, before }
  })
  expect(f.accepted).toBe(true); expect(f.grantsAcceptance).toBe(false)
  await page.reload()
  const after = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/open-generated-situation-basis.ts'), { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const result = await api.preflightTtrpgOpenGeneratedSituationV1({ ...f.input, value: f.value })
    const errors: string[] = []
    for (const request of [ { ...f.input, value: { ...f.value, accepted: true } }, { ...f.input, value: { ...f.value, personalizationSourceKeys: ['forged.player.choice'] } }, { ...f.input, viewerKey: 'viewer.seat.hero', value: f.value } ]) {
      try { await api.preflightTtrpgOpenGeneratedSituationV1(request) } catch (cause) { errors.push(String(cause)) }
    }
    const owners = JSON.stringify({ world: await db.worldReleases.toArray(), releases: await db.productReleases.toArray(), sessions: await db.productRuntimeSessions.toArray(), events: await db.productRuntimeEvents.toArray(), runs: await db.agentRuns.toArray() })
    return { proposalHash: result.proposalHash, basisHash: result.basisHash, grantsAcceptance: result.grantsAcceptance, errors, owners }
  }, f)
  expect(after.proposalHash).toBe(f.proposalHash); expect(after.basisHash).toBe(f.basisHash); expect(after.grantsAcceptance).toBe(false)
  expect(after.errors).toHaveLength(3); expect(after.owners).toBe(f.before); expect(sent).toEqual([])
})
