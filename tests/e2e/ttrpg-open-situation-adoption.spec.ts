import { expect, test } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
/** Formal mocked transport + explicit human-GM API disclosure; actual player discovery uses the real UI. */
test('a session-owned generated situation reaches the player discovery UI without exposing its private GM input or goal', async ({ page }) => {
  test.setTimeout(120000)
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const f = await (await importer('/storyforge/tests/helpers/open-situation-generation.ts')).setupSituationGenerationV1(true, (pkg: any) => {
      pkg.ttrpg.rulePack.content.actions[0].effects = []
      const c = pkg.ttrpg.campaign, template = c.situationTemplates[0]
      template.evidence[0].audience = 'gm-only'; template.evidence[0].knownByActorKeys = []
      template.evidence[0].discoveryPolicy.allowedAudience = 'private'; template.evidence[0].discoveryPolicy.recipientActorKeys = ['hero']
      template.evidence[0].discoveryPolicy.requiresPlayerConfirmation = true
      c.clocks[0].onCompleteEffectPlanRef = null; c.fronts[0].escalationStages[0].newSituationTemplateKey = null
    })
    return { input: f.input, request: f.request, value: f.value }
  })
  let sends = 0
  await page.route('https://ttrpg-situation-adoption.invalid/v1/chat/completions', route => {
    sends++
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'isolated-adoption', model: 'situation-adoption-browser',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(f.value) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 } }) })
  })
  const adopted = await page.evaluate(async f => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts'), helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const result = await api.generateTtrpgOpenSituationCandidateV1({ ...f.request, aiConfig: { provider: 'custom', model: 'situation-adoption-browser',
      apiKey: 'test-only-key', baseUrl: 'https://ttrpg-situation-adoption.invalid/v1', maxTokens: 4000, contextWindow: 50000 } })
    if (result.status !== 'candidate') throw new Error('fixture original candidate missing')
    const id = { ...f.input, runId: result.summary.runId, requestKey: result.summary.requestKey, candidateHash: result.summary.candidateHash }
    const candidate = await api.readTtrpgOpenSituationCandidateV1(id)
    const { hashCanonicalValue } = await importer('/storyforge/src/lib/agent/run/hash.ts')
    await api.acceptTtrpgOpenSituationV1({ ...await helper.openEnvelopeV1(id.sessionId, 'native.human.gm.disclosure'), ...id,
      templateHash: await hashCanonicalValue(candidate.review.proposal.template), disclosure: 'player-and-discovery-text-reviewed' })
    await api.finishTtrpgOpenSituationDraftV1(id)
    await api.activateTtrpgOpenSessionSituationV1({ ...await helper.openEnvelopeV1(id.sessionId, 'native.human.gm.admission'),
      viewerKey: id.viewerKey, templateKey: candidate.review.proposal.template.templateKey })
    return { id, templateKey: candidate.review.proposal.template.templateKey, evidenceRef: candidate.review.proposal.template.evidence[0].clueRef }
  }, f)
  await page.reload()
  await page.goto('./play/session/' + f.input.sessionId)
  await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  // Directions display a numbered label and the exact hint in one paragraph.
  await expect(page.getByRole('region', { name: '当前可知线索与方向', exact: true })
    .getByText(/ · 可以检查这里$/).first()).toBeVisible()
  await expect(page.locator('body')).not.toContainText('PRIVATE-GM-SITUATION-SOURCE')
  await expect(page.locator('body')).not.toContainText('PRIVATE-GENERATED-SITUATION-GOAL')
  await expect(page.locator('body')).not.toContainText('有人刚刚来过')
  const selection = await page.evaluate(async ({ scope, sessionId, evidenceRef }) => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const catalog = await (await importer('/storyforge/src/lib/ttrpg/open-table-service.ts')).readTtrpgOpenManualActionCatalogV1({ scope, sessionId, viewerKey: 'viewer.seat.hero' })
    const discovery = catalog.discoveries.find((d: any) => d.evidenceRef === evidenceRef)
    if (!discovery) throw new Error('generated discovery missing from actual manual catalog')
    const rule = catalog.rules.find((r: any) => r.ruleKey === discovery.ruleKey && r.route === discovery.route && r.available && r.targets.length)
    return { discovery: discovery.key, rule: JSON.stringify([rule.route, rule.ruleKey]), target: JSON.stringify(rule.targets[0].key),
      parameters: rule.parameters.map((p: any) => JSON.stringify(p.options[0]?.key ?? null)) }
  }, { ...f.input, evidenceRef: adopted.evidenceRef })
  await page.getByLabel('行动规则', { exact: true }).selectOption(selection.rule)
  await page.getByLabel('行动对象', { exact: true }).selectOption(selection.target)
  for (let i = 0; i < selection.parameters.length; i++) await page.getByLabel('行动后果对象 ' + (i + 1), { exact: true }).selectOption(selection.parameters[i])
  await page.getByLabel('检查线索', { exact: true }).selectOption(selection.discovery)
  await page.getByLabel('人工行动说明', { exact: true }).fill('我检查这个新局势的门口线索。')
  await page.getByRole('button', { name: '提出行动，查看风险', exact: true }).click()
  await expect(page.getByRole('region', { name: '当前行动', exact: true })).toBeVisible()
  for (let n = 0; n < 4 && await page.getByRole('button', { name: '同意以上风险与代价', exact: true }).count(); n++) {
    const buttons = page.getByRole('button', { name: '同意以上风险与代价', exact: true }), count = await buttons.count()
    await buttons.first().click(); await expect(buttons).toHaveCount(count - 1)
  }
  await page.getByRole('button', { name: '继续结算已确认的行动', exact: true }).click()
  await expect(page.locator('body')).toContainText('有人刚刚来过')
  await expect(page.locator('body')).not.toContainText('PRIVATE-GENERATED-SITUATION-GOAL')
  const final = await page.evaluate(async adopted => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts'), actors = await importer('/storyforge/src/lib/ttrpg/open-player-context.ts')
    return { state: await core.readProductRuntimeState(adopted.id.sessionId), companion: (await actors.loadTtrpgOpenPlayerContextV1({ ...adopted.id, actorKey: 'companion.1' })).view.knowledge }
  }, adopted)
  expect(final.state.ttrpg!.openRun!.situationReceipts).toHaveLength(1)
  expect(final.state.ttrpg!.openRun!.knowledge[0]).toMatchObject({ evidenceRef: adopted.evidenceRef, recipientActorKeys: ['hero'] })
  expect(final.companion).toEqual([]); expect(sends).toBe(1)
})
