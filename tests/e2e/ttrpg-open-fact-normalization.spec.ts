import { expect,test } from '@playwright/test'

/** Isolated native storage with explicit simulation transport; no real-provider or public-UI acceptance. */
test('accepted Oracle text normalizes through its own Run and survives reload before separate fact review',async ({ page }) => {
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('path','return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const fixture = await helper.readyOpenTtrpgSessionV1('native fact normalization',(pkg: any) => { pkg.ttrpg.campaign.runtimePolicy.enabled = true })
    const rawInput = '咨询守灯人的帮助'
    await commands.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'epoch'),viewerKey: helper.OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput })
    await commands.consultTtrpgOracleV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'oracle'),viewerKey: helper.OPEN_HUMAN_VIEWER,
      askedBy: 'player:hero',oracleKey: 'oracle.yes',question: '守灯人会提供地图吗？',likelihoodTierKey: 'even' })
    const state = await core.readProductRuntimeState(fixture.sessionId)
    const oracle = await commands.generateTtrpgOpenOracleCandidateV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'interpret'),scope: fixture.scope,
      viewerKey: helper.OPEN_HUMAN_VIEWER,rawInput,oracleSourceRef: state.ttrpg.openRun.oracleReceipts[0].sourceRef,maximumOutputTokens: 1000,maximumCostUsd: 0.2,
      runAI: async () => JSON.stringify({ interpretation: '守灯人承诺向调查者提供地图。',facts: [] }) })
    await commands.reviewTtrpgOpenOracleCandidateV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'accept.text'),viewerKey: helper.OPEN_HUMAN_VIEWER,
      runId: oracle.prepared.runId,requestKey: oracle.prepared.requestKey,candidateHash: oracle.candidate.candidateHash,
      interpretationDecision: 'accept',interpretationReason: null,choices: [] })
    const reviewed = await core.readProductRuntimeState(fixture.sessionId)
    await commands.closeTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'close'),viewerKey: helper.OPEN_HUMAN_VIEWER,
      epochKey: reviewed.ttrpg.openRun.coordination.activeEpochKey,reason: '解释已审阅' })
    const normalizeInput = '归一已经确认的解释'
    await commands.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'normalize.epoch'),viewerKey: helper.OPEN_HUMAN_VIEWER,
      triggerKind: 'continue-host',rawInput: normalizeInput })
    let sends = 0
    const generated = await commands.generateTtrpgOpenFactNormalizationCandidateV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'normalize'),scope: fixture.scope,
      viewerKey: helper.OPEN_HUMAN_VIEWER,rawInput: normalizeInput,reviewSourceRef: reviewed.ttrpg.openRun.oracleReviews[0].sourceRef,maximumOutputTokens: 1000,maximumCostUsd: 0.2,
      runAI: async () => { sends += 1;return JSON.stringify({ facts: [{ kind: 'relation',subjectRef: 'keeper',predicateKey: 'promised',objectRef: 'harbor',
        canonicalValue: '提供地图',detail: '守灯人承诺提供地图。',sourceFactRefs: ['fact.harbor'],audience: 'party',knownByActorKeys: ['hero','companion.1','companion.2'],supersedes: null,supersedeReason: null }] }) } })
    return { scope: fixture.scope,sessionId: fixture.sessionId,viewerKey: helper.OPEN_HUMAN_VIEWER,runId: generated.prepared.runId,requestKey: generated.prepared.requestKey,
      candidate: generated.candidate,sends,state: await core.readProductRuntimeState(fixture.sessionId) }
  })
  expect(initial.sends).toBe(1)
  expect(initial.candidate.artifact.status).toBe('usable-with-warnings')
  expect(initial.state.ttrpg.openRun.factLedger).toBeUndefined()
  await page.reload()
  const adopted = await page.evaluate(async fixture => {
    const importer = new Function('path','return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const runs = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    const resume = { scope: fixture.scope,sessionId: fixture.sessionId,viewerKey: fixture.viewerKey,runId: fixture.runId,requestKey: fixture.requestKey }
    const candidate = await commands.readTtrpgOpenFactNormalizationCandidateV1(resume)
    let sends = 0
    const repeated = await commands.executeTtrpgOpenFactNormalizationRequestV1({ ...resume,runAI: async () => { sends += 1;return 'unexpected' } })
    await commands.reviewTtrpgOpenOracleCandidateV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'adopt'),...resume,
      candidateHash: candidate.candidateHash,interpretationDecision: 'accept',interpretationReason: null,choices: [{ proposalIndex: 0,decision: 'adopt',reason: null }] })
    return { candidate,repeated,sends,state: await core.readProductRuntimeState(fixture.sessionId),
      runState: (await runs.readInstanceAgentRunV1(fixture.scope,fixture.runId)).projection.state }
  },initial)
  expect(adopted.candidate).toEqual(initial.candidate)
  expect(adopted.repeated).toEqual({ status: 'not-sent' })
  expect(adopted.sends).toBe(0)
  expect(adopted.runState).toBe('completed')
  expect(adopted.state.ttrpg.openRun.factLedger.entries).toHaveLength(1)
  expect(adopted.state.ttrpg.openRun.oracleReceipts).toEqual(initial.state.ttrpg.openRun.oracleReceipts)
  expect(adopted.state.ttrpg.openRun.worldTime).toEqual(initial.state.ttrpg.openRun.worldTime)
})
