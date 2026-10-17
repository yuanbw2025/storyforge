import { expect, test } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))

test('API-prepared model plan shows its actual origin and still needs a separate human UI approval and create action', async ({ page }) => {
  test.setTimeout(180000)
  let externalSends = 0
  page.on('request', r => { if (r.url().includes('/chat/completions')) externalSends++ })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { setupOpenEntityModelV1 } = await load('/storyforge/tests/helpers/open-entity-model.ts')
    const { openEnvelopeV1 } = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts'), core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const s = await setupOpenEntityModelV1('private')
    s.selection.templateKeys = ['dynamic.npc']; s.proposal.templateKey = 'dynamic.npc'
    s.proposal.name = '模型候选守灯人'; s.proposal.description = '本次私密范围的模型候选，尚未创建。'
    const read = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey }
    const prepared = await api.prepareTtrpgOpenEntityInputV1({ ...await openEnvelopeV1(s.f.sessionId, 'native.model.entity.prepare'), ...read,
      selection: s.selection, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.2 })
    const request = { ...read, runId: prepared.runId, requestKey: prepared.requestKey }; let simulatedSends = 0
    const result = await api.executeTtrpgOpenEntityRequestV1({ ...request, runAI: async () => { simulatedSends++; return JSON.stringify({ proposals: [s.proposal] }) } })
    if (result.status !== 'candidate') throw new Error('expected exact entity candidate')
    await api.acceptTtrpgOpenEntityCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'native.model.entity.adopt'), ...request,
      candidateHash: result.candidate.candidateHash, decision: 'reviewed-this-model-entity-candidate' })
    const state = await core.readProductRuntimeState(s.f.sessionId), plan = state.ttrpg.openRun.entityOperations[0].plan
    return { sessionId: s.f.sessionId, projectId: s.f.scope.projectId, entityKey: plan.items[0].entityKey, planHash: plan.planHash,
      exists: Boolean(state.entities[plan.items[0].entityKey]), audience: plan.items[0].audience, simulatedSends }
  })
  expect(f.exists).toBe(false); expect(f.audience).toBe('private'); expect(f.simulatedSends).toBe(1)
  async function enter() {
    await page.goto('./play/session/' + f.sessionId)
    await page.getByLabel('我的角色', { exact: true }).selectOption('viewer.seat.hero')
    await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
    const card = page.getByTestId('ttrpg-open-entity-desk'); await expect(card).toBeVisible({ timeout: 30000 })
    await card.locator('summary').first().click(); return card
  }
  let card = await enter()
  await expect(card.getByRole('region', { name: '待确认实体计划' })).toContainText('本计划来自 AI 候选')
  await expect(card.getByRole('button', { name: '明确创建已确认对象', exact: true })).toBeDisabled()
  await page.reload(); card = await enter()
  await expect(card.getByLabel('我已审阅本版本对相关角色的影响。', { exact: true })).not.toBeChecked()
  await card.getByLabel('我已审阅本版本对相关角色的影响。', { exact: true }).check()
  await card.getByRole('button', { name: /同意为「.*」创建本次对象/, exact: true }).click()
  const create = card.getByRole('button', { name: '明确创建已确认对象', exact: true })
  await expect(create).toBeEnabled({ timeout: 30000 }); await create.click()
  await expect(card.getByRole('region', { name: '已创建的本局对象' })).toContainText('模型候选守灯人', { timeout: 30000 })
  const actual = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const core = await load('/storyforge/src/lib/product/runtime-core.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const { loadTtrpgOpenPlayerContextV1 } = await load('/storyforge/src/lib/ttrpg/open-player-context.ts')
    const state = await core.readProductRuntimeState(f.sessionId), session = await db.productRuntimeSessions.get(f.sessionId)
    const other = await loadTtrpgOpenPlayerContextV1({ scope: { projectId: f.projectId, worldId: session.worldId, workId: session.workId }, sessionId: f.sessionId, actorKey: 'companion.1' })
    return { entity: state.entities[f.entityKey], callCount: state.ttrpg.openRun.coordination.calls.length, worldTurn: state.ttrpg.openRun.worldTime.worldTurn,
      planHash: state.ttrpg.openRun.entityOperations[0].plan.planHash, otherView: JSON.stringify(other.view) }
  }, f)
  expect(actual.entity.kind).toBe('npc'); expect(actual.planHash).toBe(f.planHash); expect(actual.callCount).toBe(1); expect(actual.worldTurn).toBe(0)
  expect(actual.otherView).not.toContain('模型候选守灯人'); expect(externalSends).toBe(0)
  await page.screenshot({ path: test.info().outputPath('model-entity-confirmed-native-v1.png'), fullPage: true })
})

test('native model entity provenance survives parent and Run deletion and complete backup readback without new call authority', async ({ page }) => {
  test.setTimeout(180000)
  await page.goto('./')
  const actual = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { setupOpenEntityModelV1 } = await load('/storyforge/tests/helpers/open-entity-model.ts'), { openEnvelopeV1 } = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts'), core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const desk = await load('/storyforge/src/lib/ttrpg/open-entity-desk.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const backup = await load('/storyforge/src/lib/export/json-export.ts'), artifacts = await load('/storyforge/src/lib/memory/artifact-store.ts')
    const s = await setupOpenEntityModelV1(), read = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: s.viewerKey }
    const prepared = await api.prepareTtrpgOpenEntityInputV1({ ...await openEnvelopeV1(s.f.sessionId, 'native.model.backup.prepare'), ...read,
      selection: s.selection, modelIdentity: { provider: 'test-adapter', model: 'injected' }, maximumOutputTokens: 1000, maximumCostUsd: 0.2 })
    const request = { ...read, runId: prepared.runId, requestKey: prepared.requestKey }
    const result = await api.executeTtrpgOpenEntityRequestV1({ ...request, runAI: async () => JSON.stringify({ proposals: [s.proposal] }) })
    await api.acceptTtrpgOpenEntityCandidateV1({ ...await openEnvelopeV1(s.f.sessionId, 'native.model.backup.adopt'), ...request,
      candidateHash: result.candidate.candidateHash, decision: 'reviewed-this-model-entity-candidate' })
    const p = (await desk.readTtrpgOpenEntityDeskV1(read)).pending
    for (const a of p.approvals) await desk.confirmTtrpgOpenEntityDeskV1({ ...read, operationKey: p.operationKey, planHash: p.planHash, actorKey: a.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
    await desk.materializeTtrpgOpenEntityDeskV1({ ...read, operationKey: p.operationKey, planHash: p.planHash, decision: 'create-this-confirmed-plan' })
    const original = await core.readProductRuntimeState(s.f.sessionId), plan = original.ttrpg.openRun.entityOperations[0].plan
    const child = await core.branchProductRuntimeSession({ parentSessionId: s.f.sessionId, throughSequence: original.lastSequence, title: 'Native model entity child' })
    await core.deleteProductRuntimeSession(s.f.sessionId)
    await artifacts.markAndSweepAgentRunArtifactsV1(s.f.scope.projectId)
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(s.f.scope.projectId))
    const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find((r: any) => r.title === child.title)
    const state = await core.readProductRuntimeState(imported.id), raw = plan.modelOrigin.artifactRefs.find((r: any) => r.artifactKind === 'raw-response')
    await (await load('/storyforge/src/lib/ttrpg/open-entity-proof.ts')).verifyTtrpgOpenEntityStateV1(state, s.input.content)
    return { parentGone: !await db.productRuntimeSessions.get(s.f.sessionId), sourceRunGone: !await db.agentRuns.get(prepared.runId),
      sameEntities: JSON.stringify(state.entities) === JSON.stringify(original.entities), samePlan: JSON.stringify(state.ttrpg.openRun.entityOperations[0].plan) === JSON.stringify(plan),
      raw: await artifacts.inspectAgentRunArtifactAvailabilityV1({ projectId, ...raw }),
      inheritedCalls: state.ttrpg.openRun.coordination.calls.length, importedRuns: await db.agentRuns.where('productRuntimeSessionId').equals(imported.id).count() }
  })
  expect(actual).toMatchObject({ parentGone: true, sourceRunGone: true, sameEntities: true, samePlan: true, raw: { state: 'available' }, inheritedCalls: 0, importedRuns: 0 })
})
