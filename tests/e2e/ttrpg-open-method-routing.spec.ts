import { expect,test } from '@playwright/test'

test.beforeEach(() => { test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1','isolated open preview only') })
for (const clarify of [false,true]) test(`an exact generic method survives ${clarify ? 'human clarification' : 'required binding review'} and reload without being replaced by goal words`,async ({ page }) => {
  test.setTimeout(180000)
  let modelPosts = 0
  page.on('request',r => { if (r.method() === 'POST' && /chat\/completions|local-codex\/v1\/requests/.test(r.url())) modelPosts++ })
  await page.goto('./')
  const f = await page.evaluate(async ambiguous => {
    const load = new Function('p','return import(p)') as (p: string) => Promise<any>
    const h = await load('/storyforge/tests/helpers/open-ttrpg-session.ts'),api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const fixture = await h.readyOpenTtrpgSessionV1('明确方法与原始目标',(p: any) => {
      p.ttrpg.campaign.runtimePolicy.enabled = true;p.ttrpg.campaign.runtimePolicy.maximumEpochTokens = 50000
      p.ttrpg.campaign.effectPlanTemplates[0].parameters = [];p.ttrpg.campaign.effectPlanTemplates[0].effects[0].targetRef = 'hero'
      p.ttrpg.campaign.characterTemplates[1].playerProfile.secret = 'EXACT-METHOD-OTHER-PRIVATE'
    })
    const rawInput = '先明确行动方式',goal = '调查公开线索时先核对自己的状态，不预设成功',check = fixture.runtimePackage.ttrpg.rulePack.content.genericChecks[0]
    await api.startTtrpgOpenEpochV1({ ...await h.openEnvelopeV1(fixture.sessionId,'method.browser.epoch'),viewerKey: h.OPEN_HUMAN_VIEWER,triggerKind: 'submit-action',rawInput })
    const generated = await api.generateTtrpgOpenIntentCandidateV1({ ...await h.openEnvelopeV1(fixture.sessionId,'method.browser.candidate'),scope: fixture.scope,
      viewerKey: h.OPEN_HUMAN_VIEWER,actorKey: 'hero',rawInput,maximumOutputTokens: 800,maximumCostUsd: 0.1,
      runAI: async () => JSON.stringify({ goal: ambiguous ? '需要明确方式与对象' : goal,method: ambiguous ? null : check.checkKey,targetRefs: ambiguous ? [] : ['hero'],
        declaredResources: [],declaredAssumptions: ['不读取未共享秘密，也不替其他角色支配个人资源。'],requestedOutcome: null }) })
    return { sessionId: fixture.sessionId,goal,checkKey: check.checkKey,candidate: generated.candidate,before: await api.readProductRuntimeState(fixture.sessionId) }
  },clarify)
  const enter = async () => {
    await page.goto('./play/session/'+f.sessionId)
    await page.getByLabel('我的角色',{ exact: true }).selectOption('viewer.seat.hero')
    await page.getByRole('button',{ name: '确认身份并进入',exact: true }).click()
    return page.getByTestId('ttrpg-open-intent-review')
  }
  let panel = await enter()
  await expect(page.locator('body')).not.toContainText('EXACT-METHOD-OTHER-PRIVATE')
  if (clarify) {
    await panel.getByLabel('补充后的行动说明',{ exact: true }).fill(f.goal)
    await panel.getByLabel('补充行动规则',{ exact: true }).selectOption(JSON.stringify(['generic-check',f.checkKey,null]))
  } else {
    await expect(panel).toContainText('请先补充并核对本次规则后果的对象')
    await expect(panel.getByRole('button',{ name: '确认这份行动意图',exact: true })).toHaveCount(0)
    await expect(panel.getByLabel('补充后的行动说明',{ exact: true })).toHaveValue(f.goal)
    await expect(panel.getByLabel('补充行动规则',{ exact: true })).toHaveValue(JSON.stringify(['generic-check',f.checkKey,null]))
  }
  await panel.getByRole('button',{ name: '保存补充并重新核对',exact: true }).click()
  await expect(panel.getByLabel('已保存的人工澄清',{ exact: true })).toContainText(f.goal,{ timeout: 30000 })
  await expect(panel.getByRole('button',{ name: '确认这份行动意图',exact: true })).toBeEnabled({ timeout: 30000 })
  await page.reload();panel = await enter()
  await expect(panel).toContainText('已保存人工补充 1/3',{ timeout: 30000 })
  await panel.getByRole('button',{ name: '确认这份行动意图',exact: true }).click()
  await expect(page.getByRole('region',{ name: '当前行动',exact: true })).toContainText('通用观察',{ timeout: 30000 })
  const after = await page.evaluate(async id => {
    const load = new Function('p','return import(p)') as (p: string) => Promise<any>
    const api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts'),{ db } = await load('/storyforge/src/lib/db/schema.ts')
    const state = await api.readProductRuntimeState(id),session = await db.productRuntimeSessions.get(id)
    const events = await db.productRuntimeEvents.where('sessionId').equals(id).sortBy('sequence')
    return { state,replayed: api.replayProductRuntimeEvents(api.parseProductRuntimeState(session.initialStateJson),events) }
  },f.sessionId)
  const run = after.state.ttrpg.openRun,call = run.coordination.calls[0],op = run.operations[0]
  expect(op).toMatchObject({ status: 'awaiting-approval',approvals: [],intentEvidence: { routingVersion: 2,rawResponseHash: f.candidate.rawResponseHash } })
  expect(op.plan.request).toMatchObject({ route: 'generic-check',ruleKey: f.checkKey,targetKey: 'hero' })
  const { intentClarifications: records,...unchanged } = call
  expect(unchanged).toEqual(f.before.ttrpg.openRun.coordination.calls[0])
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ version: 2,selection: { goal: f.goal,method: f.checkKey },request: op.plan.request })
  expect(after.state.entities).toEqual(f.before.entities);expect(run.worldTime).toEqual(f.before.ttrpg.openRun.worldTime)
  expect(run.ruleReceipts).toEqual([]);expect(after.replayed).toEqual(after.state);expect(modelPosts).toBe(0)
  await page.screenshot({ path: test.info().outputPath('exact-method-pending-risk.png'),fullPage: true })
})
