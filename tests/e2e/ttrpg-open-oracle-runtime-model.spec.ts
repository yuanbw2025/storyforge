import { expect, test } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
for (const audience of ['party', 'gm-only'] as const) test(`native ${audience} API: exact Oracle instance input reaches actual HTTP, human confirmation survives reload and complete backup`, async ({ page }) => {
  test.setTimeout(240000)
  const sends: string[] = []
  await page.goto('./')
  const f = await page.evaluate(async audience => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const s = await (await load('/storyforge/tests/helpers/open-oracle-runtime-model.ts')).setupOracleRuntimeModelV1(audience)
    return { input: s.input, owner: s.owner, npc: s.npc, place: s.place, fact: s.fact,
      originalEntities: JSON.stringify(s.state.entities), originalProduct: JSON.stringify(s.state.ttrpg.product) }
  }, audience)
  const raw = JSON.stringify({ interpretation: '原咨询保持不变，本次仅提出一条待真人确认的关系。', facts: [f.fact] })
  await page.route('https://oracle-runtime-model.invalid/v1/chat/completions', async route => {
    sends.push(route.request().postData() ?? '')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'native-oracle-runtime', model: 'native-oracle-runtime',
      choices: [{ index: 0, message: { role: 'assistant', content: raw }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1000, completion_tokens: 150, total_tokens: 1150 } }) })
  })
  const prepared = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const generated = await api.generateTtrpgOpenOracleCandidateV2({ ...f.input, aiConfig: { provider: 'custom', model: 'native-oracle-runtime',
      apiKey: 'test-only-key', baseUrl: 'https://oracle-runtime-model.invalid/v1', maxTokens: 1000, contextWindow: 50000 } })
    const state = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.input.sessionId)
    return { runId: generated.prepared.runId, requestKey: generated.prepared.requestKey, hash: generated.candidate.candidateHash,
      status: generated.candidate.artifact.status, factsBeforeConfirmation: state.ttrpg.openRun.factLedger?.entries.length ?? 0 }
  }, f)
  expect(prepared.status).toBe('usable-with-warnings'); expect(prepared.factsBeforeConfirmation).toBe(0)
  expect(sends).toHaveLength(1); expect(sends[0]).toContain(f.npc); expect(sends[0]).not.toContain('ORACLE-POLICY-PRIVATE-PROFILE'); expect(sends[0]).not.toContain('dynamicTemplateKey'); expect(sends[0]).not.toContain('operationKey')
  if (audience === 'party') { expect(sends[0]).not.toContain(f.place); expect(sends[0]).not.toContain('.equipment.0') }
  await page.reload()
  const result = await page.evaluate(async ({ f, prepared }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts'), helper = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const read = { ...f.owner, runId: prepared.runId, requestKey: prepared.requestKey }
    const candidate = await api.readTtrpgOpenOracleCandidateV1(read)
    if (candidate.candidateHash !== prepared.hash) throw new Error('reload changed the original Oracle candidate')
    await api.reviewTtrpgOpenOracleCandidateV1({ ...await helper.openEnvelopeV1(f.input.sessionId, 'native.oracle.instance.confirm'), ...read,
      candidateHash: candidate.candidateHash, interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })
    await api.closeTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(f.input.sessionId, 'native.oracle.instance.close'), viewerKey: f.owner.viewerKey,
      epochKey: candidate.epochKey, reason: '真实 API 工程路径明确确认并结束' })
    const state = await core.readProductRuntimeState(f.input.sessionId), entry = state.ttrpg.openRun.factLedger.entries[0]
    const backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.input.scope.projectId)), session = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    const restored = await core.readProductRuntimeState(session.id), originalCall = state.ttrpg.openRun.coordination.calls[0]
    return { sameLedger: JSON.stringify(restored.ttrpg.openRun.factLedger) === JSON.stringify(state.ttrpg.openRun.factLedger),
      sameEntities: JSON.stringify(state.entities) === f.originalEntities, sameProduct: JSON.stringify(state.ttrpg.product) === f.originalProduct,
      modelRequest: entry.modelCandidate.requestKey, runtimeRefs: entry.runtimeEntityReferences.references.map((row: any) => row.entityRef),
      originalPolicyEqual: JSON.stringify(originalCall.oracleInterpretation.runtimeReferencePolicy) === JSON.stringify(restored.ttrpg.openRun.coordination.calls[0].oracleInterpretation.runtimeReferencePolicy),
      worldTurn: state.ttrpg.openRun.worldTime.worldTurn, facts: state.ttrpg.openRun.factLedger.entries.length }
  }, { f, prepared })
  expect(result).toMatchObject({ sameLedger: true, sameEntities: true, sameProduct: true, originalPolicyEqual: true, facts: 1, worldTurn: 0, modelRequest: prepared.requestKey })
  expect(result.runtimeRefs).toContain(f.npc); expect(sends).toHaveLength(1)
})
