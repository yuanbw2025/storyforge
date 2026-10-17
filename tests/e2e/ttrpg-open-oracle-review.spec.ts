import { expect, test } from '@playwright/test'

/** Native isolated storage with an explicitly simulated transport, not real-model or public UI acceptance. */
test('a complete Oracle review keeps adopted facts and discard reasons across reload without another send or write', async ({ page }) => {
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('path','return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const harness = await importer('/storyforge/src/lib/ttrpg/open-intent-harness.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const runs = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    const fixture = await helper.readyOpenTtrpgSessionV1('native complete Oracle review',(pkg: any) => { pkg.ttrpg.campaign.runtimePolicy.enabled = true })
    const rawInput = '咨询并完整审阅守灯人解释'
    await commands.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'epoch'),viewerKey: helper.OPEN_HUMAN_VIEWER,triggerKind: 'continue-host',rawInput })
    await commands.consultTtrpgOracleV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'oracle'),viewerKey: helper.OPEN_HUMAN_VIEWER,
      askedBy: 'player:hero',oracleKey: 'oracle.yes',question: '守灯人会帮助调查吗？',likelihoodTierKey: 'even' })
    const state = await core.readProductRuntimeState(fixture.sessionId)
    const first = { kind: 'relation',subjectRef: 'keeper',predicateKey: 'knows',objectRef: 'harbor',canonicalValue: true,
      detail: '守灯人知道港口情况。',sourceFactRefs: ['fact.harbor'],audience: 'party',knownByActorKeys: ['hero','companion.1','companion.2'],supersedes: null,supersedeReason: null }
    let sends = 0
    const generated = await harness.generateTtrpgOpenOracleCandidateV1({ ...await helper.openEnvelopeV1(fixture.sessionId,'generate'),scope: fixture.scope,
      viewerKey: helper.OPEN_HUMAN_VIEWER,rawInput,oracleSourceRef: state.ttrpg.openRun.oracleReceipts[0].sourceRef,maximumOutputTokens: 1000,maximumCostUsd: 0.2,
      runAI: async () => { sends += 1;return JSON.stringify({ interpretation: '守灯人可能协助调查。',facts: [first,
        { ...first,predicateKey: 'promised',canonicalValue: '提供地图',detail: '守灯人承诺提供地图。' }] }) } })
    const input = { ...await helper.openEnvelopeV1(fixture.sessionId,'review'),viewerKey: helper.OPEN_HUMAN_VIEWER,runId: generated.prepared.runId,
      requestKey: generated.prepared.requestKey,candidateHash: generated.candidate.candidateHash,interpretationDecision: 'accept',interpretationReason: null,
      choices: [{ proposalIndex: 0,decision: 'adopt',reason: null },{ proposalIndex: 1,decision: 'discard',reason: '尚无充分支持，不采用承诺' }] }
    const event = await commands.reviewTtrpgOpenOracleCandidateV1(input)
    return { scope: fixture.scope,input,event,sends,state: await core.readProductRuntimeState(fixture.sessionId),
      receiptHash: (await runs.readInstanceAgentRunV1(fixture.scope,generated.prepared.runId)).projection.terminalReceiptHash }
  })
  expect(initial.sends).toBe(1)
  expect(initial.state.ttrpg.openRun.factLedger.entries).toHaveLength(1)
  expect(initial.state.ttrpg.openRun.oracleReviews[0].choices[1].reason).toContain('不采用承诺')
  expect(initial.receiptHash).toMatch(/^[a-f0-9]{64}$/)
  await page.reload()
  const restored = await page.evaluate(async fixture => {
    const importer = new Function('path','return import(path)') as (path: string) => Promise<any>
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const runs = await importer('/storyforge/src/lib/agent/run/event-store.ts')
    return { event: await commands.reviewTtrpgOpenOracleCandidateV1(fixture.input),state: await core.readProductRuntimeState(fixture.input.sessionId),
      receiptHash: (await runs.readInstanceAgentRunV1(fixture.scope,fixture.input.runId)).projection.terminalReceiptHash }
  },initial)
  expect(restored).toEqual({ event: initial.event,state: initial.state,receiptHash: initial.receiptHash })
})
