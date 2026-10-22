import { expect, test } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
for (const audience of ['party', 'gm-only'] as const) test(`native ${audience} API: original accepted interpretation reaches normalization HTTP once, review survives reload and full backup`, async ({ page }) => {
  test.setTimeout(240000)
  const sends: string[] = []
  await page.goto('./')
  const f = await page.evaluate(async audience => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const s = await (await load('/storyforge/tests/helpers/open-normalization-runtime-model.ts')).setupNormalizationRuntimeModelV1(audience)
    return { input: s.normalizationInput, owner: s.owner, npc: s.npc, place: s.place, fact: s.normalizedFact, output: s.output,
      originalReview: JSON.stringify(s.review), originalEntities: JSON.stringify(s.state.entities), originalProduct: JSON.stringify(s.state.ttrpg.product) }
  }, audience)
  await page.route('https://normalization-runtime-model.invalid/v1/chat/completions', async route => {
    sends.push(route.request().postData() ?? '')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'native-normalization-runtime', model: 'native-normalization-runtime',
      choices: [{ index: 0, message: { role: 'assistant', content: f.output }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 150, total_tokens: 1150 } }) })
  })
  const prepared = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const generated = await api.generateTtrpgOpenFactNormalizationCandidateV2({ ...f.input, aiConfig: { provider: 'custom', model: 'native-normalization-runtime',
      apiKey: 'test-only-key', baseUrl: 'https://normalization-runtime-model.invalid/v1', maxTokens: 1000, contextWindow: 50000 } })
    const state = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.input.sessionId)
    return { runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, hash: generated.candidate.candidateHash,
      status: generated.candidate.artifact.status, factsBeforeConfirmation: state.ttrpg.openRun.factLedger?.entries.length ?? 0,
      originalReviewUnchanged: JSON.stringify(state.ttrpg.openRun.oracleReviews[0]) === f.originalReview }
  }, f)
  expect(prepared).toMatchObject({ status: 'usable-with-warnings', factsBeforeConfirmation: 0, originalReviewUnchanged: true })
  expect(sends).toHaveLength(1); expect(sends[0]).toContain(f.npc); expect(sends[0]).toContain('discardedProposals')
  expect(sends[0]).not.toContain('ORACLE-POLICY-PRIVATE-PROFILE'); expect(sends[0]).not.toContain('dynamicTemplateKey'); expect(sends[0]).not.toContain('operationKey')
  if (audience === 'party') { expect(sends[0]).not.toContain(f.place); expect(sends[0]).not.toContain('.equipment.0') }
  await page.reload()
  const result = await page.evaluate(async ({ f, prepared }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts'), helper = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const read = { ...f.owner, runId: prepared.runId, requestKey: prepared.requestKey }, candidate = await api.readTtrpgOpenFactNormalizationCandidateV1(read)
    if (candidate.candidateHash !== prepared.hash) throw new Error('reload changed the original normalized candidate')
    let secondSends = 0
    const repeated = await api.executeTtrpgOpenFactNormalizationRequestV1({ ...read, runAI: async () => { secondSends++; return 'must not send' } })
    const command = { ...await helper.openEnvelopeV1(f.input.sessionId, 'native.normalization.instance.confirm'), ...read,
      candidateHash: candidate.candidateHash, interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] }
    await api.reviewTtrpgOpenOracleCandidateV1(command); await api.reviewTtrpgOpenOracleCandidateV1(command)
    await api.closeTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(f.input.sessionId, 'native.normalization.instance.close'), viewerKey: f.owner.viewerKey,
      epochKey: candidate.epochKey, reason: '真实 API 路径明确确认原归一并结束' })
    const state = await core.readProductRuntimeState(f.input.sessionId), entry = state.ttrpg.openRun.factLedger.entries[0]
    const backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.input.scope.projectId)), session = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    const restored = await core.readProductRuntimeState(session.id)
    return { sameLedger: JSON.stringify(restored.ttrpg.openRun.factLedger) === JSON.stringify(state.ttrpg.openRun.factLedger),
      sameEntities: JSON.stringify(state.entities) === f.originalEntities, sameProduct: JSON.stringify(state.ttrpg.product) === f.originalProduct,
      modelRequest: entry.modelCandidate.requestKey, runtimeRefs: entry.runtimeEntityReferences.references.map((row: any) => row.entityRef),
      originalPolicyEqual: JSON.stringify(state.ttrpg.openRun.coordination.calls.at(-1).supportSlot.runtimeReferencePolicy) === JSON.stringify(restored.ttrpg.openRun.coordination.calls.at(-1).supportSlot.runtimeReferencePolicy),
      originalReviewUnchanged: JSON.stringify(state.ttrpg.openRun.oracleReviews[0]) === f.originalReview,
      normalizationSourceEqual: entry.modelCandidate.normalizationOf.reviewHash === state.ttrpg.openRun.oracleReviews[0].reviewHash,
      worldTurn: state.ttrpg.openRun.worldTime.worldTurn, facts: state.ttrpg.openRun.factLedger.entries.length, repeated, secondSends }
  }, { f, prepared })
  expect(result).toMatchObject({ sameLedger: true, sameEntities: true, sameProduct: true, originalPolicyEqual: true, originalReviewUnchanged: true,
    normalizationSourceEqual: true, facts: 1, worldTurn: 0, modelRequest: prepared.requestKey, repeated: { status: 'not-sent' }, secondSends: 0 })
  expect(result.runtimeRefs).toContain(f.npc); expect(sends).toHaveLength(1)
})
