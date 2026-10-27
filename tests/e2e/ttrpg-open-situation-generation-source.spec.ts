import { expect, test } from '@playwright/test'
test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only') })
test('explicit drafting authority survives native reload, keeps GM input private, and can be cancelled from the player desk', async ({ page }) => {
  test.setTimeout(120000)
  const sent: string[] = []
  page.on('request', r => { if (/\/v1\/(?:chat\/completions|responses)/.test(r.url())) sent.push(r.url()) })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const h = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const context = await importer('/storyforge/src/lib/ttrpg/open-generated-situation-context.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const f = await h.readyOpenTtrpgSessionV1('Native situation drafting', (p: any) => {
      p.ttrpg.campaign.runtimePolicy.enabled = true
      p.ttrpg.campaign.characterTemplates.find((c: any) => c.role === 'npc').gmProfile.secret = 'NATIVE-GM-SITUATION-PRIVATE'
    })
    const before = { world: await db.worldReleases.toArray(), releases: await db.productReleases.toArray(), runs: await db.agentRuns.toArray() }
    const input = { scope: f.scope, sessionId: f.sessionId, actorKey: 'gm' }
    await commands.startTtrpgOpenEpochV1({ ...await h.openEnvelopeV1(f.sessionId, 'native.situation'), viewerKey: h.OPEN_HUMAN_VIEWER, triggerKind: 'request-situation', rawInput: '结合现有身份拟定一个新局势' })
    const loaded = await context.loadTtrpgOpenSituationContextV1(input)
    if (JSON.stringify(loaded).includes('viewerKey')) throw new Error('private model source exposed the human authority key')
    if (!JSON.stringify(loaded.resources).includes('NATIVE-GM-SITUATION-PRIVATE')) throw new Error('test requires an actual private GM input')
    return { input, sessionId: f.sessionId, before, resources: loaded.resources, frame: loaded.frame }
  })
  await page.reload()
  const actual = await page.evaluate(async input => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const context = await importer('/storyforge/src/lib/ttrpg/open-generated-situation-context.ts')
    const { loadTtrpgOpenSituationProposalBasisV1 } = await importer('/storyforge/src/lib/ttrpg/open-generated-situation-basis.ts')
    const value = await context.loadTtrpgOpenSituationContextV1(input)
    let fallbackDenied = false
    try { await loadTtrpgOpenSituationProposalBasisV1({ ...input, viewerKey: 'viewer.seat.hero', proposalKey: 'native.denied' }) } catch { fallbackDenied = true }
    return { resources: value.resources, frame: value.frame, fallbackDenied }
  }, f.input)
  expect(actual.resources).toEqual(f.resources); expect(actual.frame).toEqual(f.frame); expect(actual.fallbackDenied).toBe(true)
  await page.goto('./play/session/' + f.sessionId)
  await expect(page.getByLabel('我的角色', { exact: true })).toBeVisible()
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByText('当前正在拟定新局势', { exact: true })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('NATIVE-GM-SITUATION-PRIVATE')
  const desk = page.getByTestId('ttrpg-open-situation-desk')
  if (!await desk.evaluate(element => (element as HTMLDetailsElement).open)) await desk.locator('summary').first().click()
  await desk.getByRole('button', { name: '取消本次局势拟定', exact: true }).click()
  await expect(desk.getByText('本次局势拟定已结束，已采用定义和原记录保留。', { exact: true })).toBeVisible()
  const end = await page.evaluate(async input => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { loadTtrpgOpenSituationContextV1 } = await importer('/storyforge/src/lib/ttrpg/open-generated-situation-context.ts')
    const { readProductRuntimeState } = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    let closed = false
    try { await loadTtrpgOpenSituationContextV1(input) } catch { closed = true }
    const state = await readProductRuntimeState(input.sessionId)
    return { closed, activeEpochKey: state.ttrpg.openRun.coordination.activeEpochKey, worldTurn: state.ttrpg.openRun.worldTime.worldTurn,
      owners: { world: await db.worldReleases.toArray(), releases: await db.productReleases.toArray(), runs: await db.agentRuns.toArray() } }
  }, f.input)
  expect(end.closed).toBe(true); expect(end.activeEpochKey).toBeNull(); expect(end.worldTurn).toBe(f.frame.worldTurn)
  expect(end.owners).toEqual(f.before); expect(sent).toEqual([])
})
