import { expect, test } from '@playwright/test'

/** Explicit simulation transport in native isolated IndexedDB; no real-model or public UI claim. */
test('a governed Oracle candidate survives reload and human confirmation without another model send or world change', async ({ page }) => {
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const harness = await importer('/storyforge/src/lib/ttrpg/open-intent-harness.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const runs = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const fixture = await helper.readyOpenTtrpgSessionV1('native Oracle candidate', (pkg: any) => { pkg.ttrpg.campaign.runtimePolicy.enabled = true })
    const rawInput = '解释守灯人咨询'
    await commands.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(fixture.sessionId, 'oracle.epoch'),
      viewerKey: helper.OPEN_HUMAN_VIEWER, triggerKind: 'continue-host', rawInput })
    await commands.consultTtrpgOracleV1({ ...await helper.openEnvelopeV1(fixture.sessionId, 'oracle.consult'), viewerKey: helper.OPEN_HUMAN_VIEWER,
      askedBy: 'player:hero', oracleKey: 'oracle.yes', question: '守灯人知道港口情况吗？', likelihoodTierKey: 'even' })
    const state = await core.readProductRuntimeState(fixture.sessionId)
    const input = { ...await helper.openEnvelopeV1(fixture.sessionId, 'oracle.interpret'), scope: fixture.scope,
      viewerKey: helper.OPEN_HUMAN_VIEWER, rawInput, oracleSourceRef: state.ttrpg.openRun.oracleReceipts[0].sourceRef,
      maximumOutputTokens: 1000, maximumCostUsd: 0.2 }
    let sends = 0
    const generated = await harness.generateTtrpgOpenOracleCandidateV1({ ...input, runAI: async () => {
      sends += 1
      return JSON.stringify({ interpretation: '守灯人知道港口当前状况。', facts: [{ kind: 'relation', subjectRef: 'keeper', predicateKey: 'knows',
        objectRef: 'harbor', canonicalValue: true, detail: '本次原始结果的候选解释。', sourceFactRefs: ['fact.harbor'], audience: 'party',
        knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null }] })
    } })
    const resume = { scope: fixture.scope, sessionId: fixture.sessionId, viewerKey: helper.OPEN_HUMAN_VIEWER,
      runId: generated.prepared.runId, requestKey: generated.prepared.requestKey }
    return { input, resume, candidate: generated.candidate, sends, pendingRun: (await runs.readInstanceAgentRunV1(fixture.scope, generated.prepared.runId)).projection.state,
      state: await core.readProductRuntimeState(fixture.sessionId),
      world: await db.worldReleases.where('worldId').equals(fixture.scope.worldId).toArray() }
  })
  expect(initial.sends).toBe(1)
  expect(initial.candidate.artifact.status).toBe('usable-with-warnings')
  expect(initial.state.ttrpg.openRun.factLedger).toBeUndefined()
  expect(initial.pendingRun).toBe('awaiting_confirmation')
  await page.reload()
  const adopted = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const harness = await importer('/storyforge/src/lib/ttrpg/open-intent-harness.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const runs = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    let sends = 0
    const restored = await harness.readTtrpgOpenOracleCandidateV1(fixture.resume)
    const repeat = await harness.executeTtrpgOpenOracleRequestV1({ ...fixture.resume, runAI: async () => { sends += 1; return 'unexpected' } })
    const confirmation = { ...await helper.openEnvelopeV1(fixture.resume.sessionId, 'confirm.fact'), ...fixture.resume,
      candidateHash: restored.candidateHash, proposalIndex: 0, decision: 'assert' }
    const event = await commands.commitTtrpgOpenOracleCandidateFactV1(confirmation)
    const repeatedEvent = await commands.commitTtrpgOpenOracleCandidateFactV1({ ...confirmation,
      ...await helper.openEnvelopeV1(fixture.resume.sessionId, 'another.confirmation') })
    return { restored, repeat, sends, event, repeatedEvent,
      completedRun: (await runs.readInstanceAgentRunV1(fixture.resume.scope, fixture.resume.runId)).projection,
      state: await core.readProductRuntimeState(fixture.resume.sessionId),
      world: await db.worldReleases.where('worldId').equals(fixture.resume.scope.worldId).toArray() }
  }, initial)
  expect(adopted.restored).toEqual(initial.candidate)
  expect(adopted.repeat).toEqual({ status: 'not-sent' })
  expect(adopted.sends).toBe(0)
  expect(adopted.repeatedEvent).toEqual(adopted.event)
  expect(adopted.state.ttrpg.openRun.factLedger.entries).toHaveLength(1)
  expect(adopted.completedRun.state).toBe('completed')
  expect(adopted.completedRun.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
  expect(adopted.world).toEqual(initial.world)
  expect(adopted.state.entities).toEqual(initial.state.entities)
  expect(adopted.state.ttrpg.openRun.oracleReceipts).toEqual(initial.state.ttrpg.openRun.oracleReceipts)
  expect(adopted.state.ttrpg.openRun.worldTime).toEqual(initial.state.ttrpg.openRun.worldTime)
  await page.reload()
  const restored = await page.evaluate(async sessionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    return (await importer('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(sessionId)
  }, initial.resume.sessionId)
  expect(restored).toEqual(adopted.state)
})
