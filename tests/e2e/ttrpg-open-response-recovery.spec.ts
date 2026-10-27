import { expect, test } from '@playwright/test'

/** Native DB + real UI recovery from an explicitly simulated retained provider response. */
test('refreshes after paid response receipt, then restores original output without another request', async ({ page }) => {
  test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated experimental preview required')
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helpers = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const table = await importer('/storyforge/src/lib/ttrpg/open-table-service.ts')
    const inputs = await importer('/storyforge/src/lib/ttrpg/open-intent-input.ts')
    const events = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    const artifacts = await importer('/storyforge/src/lib/memory/artifact-store.ts')
    const f = await helpers.readyOpenTtrpgSessionV1('灯塔回复恢复', (pkg: any) => { pkg.ttrpg.campaign.title = '灯塔回复恢复'; pkg.ttrpg.campaign.runtimePolicy.enabled = true; pkg.ttrpg.campaign.runtimePolicy.maximumEpochTokens = 20000 })
    const input = { scope: f.scope, sessionId: f.sessionId, viewerKey: helpers.OPEN_HUMAN_VIEWER }
    await table.startTtrpgOpenTableV1({ ...input, acceptedItemKeys: [] })
    await api.startTtrpgOpenEpochV1({ ...await helpers.openEnvelopeV1(f.sessionId, 'native.response.epoch'), viewerKey: input.viewerKey, triggerKind: 'submit-action', rawInput: '调查河港' })
    const prepared = await inputs.prepareTtrpgOpenIntentInputV1({ ...await helpers.openEnvelopeV1(f.sessionId, 'native.response.prepare'), ...input,
      actorKey: 'hero', rawInput: '调查河港', maximumOutputTokens: 800, maximumCostUsd: 0.1,
      modelIdentity: { provider: 'test-adapter', model: 'injected' } })
    const request = { ...input, runId: prepared.runId, requestKey: prepared.requestKey }
    const permit = await api.dispatchTtrpgOpenModelCallV1({ ...await helpers.openEnvelopeV1(f.sessionId, 'native.response.dispatch'), ...request })
    if (!permit.sendAuthorized) throw new Error('no original send permit')
    const rawText = JSON.stringify({ goal: '调查河港', method: '观察岸边', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
    const snapshot = await events.readInstanceAgentRunV1(f.scope, prepared.runId)
    const call = (await api.readProductRuntimeState(f.sessionId)).ttrpg.openRun.coordination.calls[0]
    const raw = await artifacts.recordAgentRunArtifactV1({ ...input, productRuntimeSessionId: f.sessionId, runId: prepared.runId,
      artifactKind: 'raw-response', content: rawText, stepId: call.stepId, attempt: call.attempt, expectedLastSequence: snapshot.projection.lastSequence })
    await events.appendAgentRunEventV1({ ...input, productRuntimeSessionId: f.sessionId, runId: prepared.runId,
      type: 'model.responded', payload: { stepId: call.stepId, attempt: call.attempt, outputHash: raw.artifact.contentHash }, expectedLastSequence: raw.snapshot.projection.lastSequence })
    await api.finishTtrpgOpenModelCallV1({ ...await helpers.openEnvelopeV1(f.sessionId, 'native.response.finish'), ...request, status: 'succeeded',
      responseArtifactHash: raw.artifact.contentHash, usage: { source: 'provider', inputTokens: 2200, outputTokens: 40, actualCostUsd: null }, terminalReason: 'response-recorded' })
    return { ...request, rawHash: raw.artifact.contentHash, before: await api.readProductRuntimeState(f.sessionId) }
  })
  await page.goto(`./play/session/${fixture.sessionId}`)
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption(fixture.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByRole('button', { name: '恢复已保存的回复', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '结束本轮主持，准备下一次行动', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '恢复已保存的回复', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认这份行动意图', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复已保存的回复', exact: true })).toHaveCount(0)
  await page.reload()
  await page.getByLabel('我的角色', { exact: true }).selectOption(fixture.viewerKey)
  await page.getByRole('button', { name: '确认身份并进入', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认这份行动意图', exact: true })).toBeVisible()
  const evidence = await page.evaluate(async f => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const api = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const events = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    const candidate = await api.recoverTtrpgOpenRuntimeCandidateV1(f)
    return { candidate, state: await api.readProductRuntimeState(f.sessionId), snapshot: await events.readInstanceAgentRunV1(f.scope, f.runId) }
  }, fixture)
  expect(evidence.state).toEqual(fixture.before)
  expect(evidence.candidate.rawResponseHash).toBe(fixture.rawHash)
  expect(evidence.candidate.artifact.callEvidence[0]).toMatchObject({ inputTokens: 2200, outputTokens: 40, usageSource: 'provider', latencyMs: null })
  for (const type of ['model.requested', 'model.responded', 'candidate.persisted', 'context.assembled']) {
    expect(evidence.snapshot.events.filter((event: any) => event.type === type)).toHaveLength(1)
  }
  expect(evidence.snapshot.events.some((event: any) => event.type === 'confirmation.recorded')).toBe(false)
})
