import { expect, test } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))

for (const audience of ['party', 'public'] as const) test(`native ${audience} common API: original human authorization sends once, refresh retains an unconfirmed candidate and explicit review closes the original Run`, async ({ page }) => {
  test.setTimeout(240000)
  await page.goto('./')
  const fixture = await page.evaluate(async audience => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const s = await (await load('/storyforge/tests/helpers/open-common-oracle-model.ts')).setupCommonOracleModelV1(audience, { provider: 'custom', model: 'common-oracle-native' })
    const proposal = { kind: 'relation', subjectRef: audience === 'party' ? s.npc : 'keeper', predicateKey: 'knows', objectRef: 'harbor', canonicalValue: true,
      detail: '原共同候选，刷新后仍由真人明确确认。', sourceFactRefs: [], audience, knownByActorKeys: audience === 'party' ? s.grant.basis.recipientActorKeys : [], supersedes: null, supersedeReason: null }
    return { read: s.read, epochKey: s.grant.epochKey, npc: s.npc, privatePlace: s.privatePlace,
      output: JSON.stringify({ interpretation: '依原共同 Oracle 最终结果提出解释。', facts: [proposal] }), beforeEntities: JSON.stringify(s.before.entities), beforeProduct: JSON.stringify(s.before.ttrpg.product) }
  }, audience)
  const sends: string[] = []
  await page.route('https://common-oracle-native.invalid/v1/chat/completions', async route => {
    sends.push(route.request().postData() ?? '')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ id: 'common-native-original', model: 'common-oracle-native',
      choices: [{ index: 0, message: { role: 'assistant', content: fixture.output }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } }) })
  })
  const candidate = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const result = await api.generateTtrpgOpenCommonOracleCandidateV1({ ...f.read, aiConfig: { provider: 'custom', model: 'common-oracle-native', apiKey: 'test-only-key',
      baseUrl: 'https://common-oracle-native.invalid/v1', maxTokens: 1000, contextWindow: 50000 } })
    const state = await (await load('/storyforge/src/lib/product/runtime-core.ts')).readProductRuntimeState(f.read.sessionId)
    return { hash: result.candidate.candidateHash, status: result.candidate.artifact.status, schema: result.candidate.schema, unconfirmedFacts: state.ttrpg.openRun.factLedger?.entries.length ?? 0 }
  }, fixture)
  expect(candidate).toMatchObject({ status: 'usable-with-warnings', schema: 'storyforge.ttrpg-open-common-oracle-candidate', unconfirmedFacts: 0 }); expect(sends).toHaveLength(1)
  for (const secret of ['COMMON-ORACLE-GM-', 'COMMON-ORACLE-PRIVATE-', 'COMMON-ORACLE-FULL-', fixture.privatePlace, 'characterSheet', 'operationKey', '.equipment.0']) expect(sends[0]).not.toContain(secret)
  if (audience === 'party') expect(sends[0]).toContain(fixture.npc); else expect(sends[0]).not.toContain(fixture.npc)
  await page.reload()
  const final = await page.evaluate(async ({ f, hash }) => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts'), helper = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const value = await api.readTtrpgOpenCommonOracleCandidateV1(f.read)
    if (value.candidateHash !== hash) throw new Error('refresh changed original common candidate')
    const before = await core.readProductRuntimeState(f.read.sessionId)
    let extra = 0
    const repeated = await api.executeTtrpgOpenCommonOracleRequestV1({ ...f.read, runAI: async () => { extra++; return f.output } })
    await api.reviewTtrpgOpenCommonOracleCandidateV1({ ...f.read, ...await helper.openEnvelopeV1(f.read.sessionId, 'native.common.review'), candidateHash: hash,
      interpretationDecision: 'accept', interpretationReason: null, choices: [{ proposalIndex: 0, decision: 'adopt', reason: null }] })
    await api.closeTtrpgOpenReviewedCommonOracleWindowV1({ ...f.read, epochKey: f.epochKey, decision: 'close-this-reviewed-common-oracle-window' })
    const state = await core.readProductRuntimeState(f.read.sessionId), entry = state.ttrpg.openRun.factLedger.entries[0]
    const backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.read.scope.projectId)), copy = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    const restored = await core.readProductRuntimeState(copy.id)
    const run = await (await load('/storyforge/src/lib/agent/run/event-store.ts')).readInstanceAgentRunV1(f.read.scope, f.read.runId)
    return { beforeFacts: before.ttrpg.openRun.factLedger?.entries.length ?? 0, finalFacts: state.ttrpg.openRun.factLedger.entries.length,
      sameEntities: JSON.stringify(state.entities) === f.beforeEntities, sameProduct: JSON.stringify(state.ttrpg.product) === f.beforeProduct,
      backupLedgerEqual: JSON.stringify(restored.ttrpg.openRun.factLedger) === JSON.stringify(state.ttrpg.openRun.factLedger),
      originalGrantEqual: JSON.stringify(restored.ttrpg.openRun.coordination.epochs.at(-1).commonOracle) === JSON.stringify(state.ttrpg.openRun.coordination.epochs.at(-1).commonOracle),
      runtimeRefs: entry.runtimeEntityReferences?.references.map((row: any) => row.entityRef) ?? [], active: state.ttrpg.openRun.coordination.activeEpochKey,
      worldTurn: state.ttrpg.openRun.worldTime.worldTurn, runState: run.projection.state, repeated, extra }
  }, { f: fixture, hash: candidate.hash })
  expect(final).toMatchObject({ beforeFacts: 0, finalFacts: 1, sameEntities: true, sameProduct: true, backupLedgerEqual: true, originalGrantEqual: true,
    active: null, worldTurn: 0, runState: 'completed', repeated: { status: 'not-sent' }, extra: 0 })
  if (audience === 'party') expect(final.runtimeRefs).toContain(fixture.npc); else expect(final.runtimeRefs).toEqual([])
  expect(sends).toHaveLength(1)
})

test('native clean-database import reuses physical ids but retains only history until a fresh human authorization', async ({ page }) => {
  test.setTimeout(240000)
  await page.goto('./')
  const result = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const s = await (await load('/storyforge/tests/helpers/open-common-oracle-model.ts')).setupCommonOracleModelV1()
    const backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const json = await backup.exportProjectJSON(s.f.scope.projectId)
    await db.delete(); await db.open()
    const projectId = await backup.importProjectJSON(json), copy = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    const scope = await (await load('/storyforge/src/lib/workspace/scope.ts')).resolveScope({ scope: { projectId, worldId: copy.worldId, workId: copy.workId } })
    const run = await db.agentRuns.where('productRuntimeSessionId').equals(copy.id).first(), owner = { scope, sessionId: copy.id, viewerKey: s.owner.viewerKey }
    let rejected = false
    try { await api.prepareTtrpgOpenCommonOracleInputV1({ ...owner, runId: run.id, requestKey: s.authorized.requestKey }) } catch { rejected = true }
    const closed = await api.finishTtrpgOpenEmptyCommonOracleWindowV1({ ...owner, epochKey: s.grant.epochKey, decision: 'close-this-empty-common-oracle-window' })
    const current = await (await load('/storyforge/src/lib/ttrpg/open-common-oracle-context.ts')).loadTtrpgOpenCommonOracleContextV1({ ...owner, actorKey: 'gm' })
    const selected = current.directory[0], helper = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const fresh = await api.startTtrpgOpenCommonOracleWindowV1({ ...owner, ...await helper.openEnvelopeV1(copy.id, 'native.common.import.fresh'),
      oracleSourceRef: selected.oracleSourceRef, oracleInputHash: selected.contentHash, snapshotHash: selected.snapshotHash,
      decision: 'request-this-one-common-oracle-candidate', modelIdentity: s.grant.basis.modelIdentity, ...s.grant.basis.budget })
    await api.finishTtrpgOpenEmptyCommonOracleWindowV1({ ...owner, epochKey: fresh.epochKey, decision: 'close-this-empty-common-oracle-window' })
    return { sameProjectId: projectId === s.f.scope.projectId, sameSessionId: copy.id === s.f.sessionId, sameRunId: run.id === s.read.runId,
      rejected, importedStatus: run.status, closedAs: closed.originalRun, freshRun: fresh.runId !== run.id,
      importedCancellation: (await db.agentRunEvents.where('runId').equals(run.id).toArray()).some((row: any) => row.type === 'run.cancelled' && JSON.parse(row.payloadJson).reason === 'project-import-nonportable-checkpoint') }
  })
  expect(result).toEqual({ sameProjectId: true, sameSessionId: true, sameRunId: true, rejected: true, importedStatus: 'cancelled',
    closedAs: 'missing-or-imported', freshRun: true, importedCancellation: true })
})

test('native human archive closes an imported formal request, retains its original slot and survives refresh and another backup without writing either Run', async ({ page }) => {
  test.setTimeout(240000)
  await page.goto('./')
  const fixture = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const s = await (await load('/storyforge/tests/helpers/open-common-oracle-model.ts')).setupCommonOracleModelV1()
    await api.prepareTtrpgOpenCommonOracleInputV1(s.read)
    const backup = await load('/storyforge/src/lib/export/json-export.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(s.f.scope.projectId)), copy = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    const scope = await (await load('/storyforge/src/lib/workspace/scope.ts')).resolveScope({ scope: { projectId, worldId: copy.worldId, workId: copy.workId } })
    return { owner: { scope, sessionId: copy.id, viewerKey: s.owner.viewerKey, epochKey: s.grant.epochKey, requestKey: s.read.requestKey },
      originalRuns: JSON.stringify(await db.agentRuns.toArray()), originalRunEvents: JSON.stringify(await db.agentRunEvents.toArray()) }
  })
  await page.reload()
  const result = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>, api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const input = { ...f.owner, decision: 'archive-this-unresumable-common-oracle-window' }, core = await load('/storyforge/src/lib/product/runtime-core.ts')
    const first = await api.archiveTtrpgOpenUnresumableCommonOracleWindowV1(input), second = await api.archiveTtrpgOpenUnresumableCommonOracleWindowV1(input)
    const state = await core.readProductRuntimeState(f.owner.sessionId), run = state.ttrpg.openRun
    const { db } = await load('/storyforge/src/lib/db/schema.ts'), backup = await load('/storyforge/src/lib/export/json-export.ts')
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.owner.scope.projectId)), restored = await db.productRuntimeSessions.where('projectId').equals(projectId).first()
    const restoredState = await core.readProductRuntimeState(restored.id)
    // Compare only the two original project scopes; the additional backup import has its own copies.
    const rows = (await db.agentRuns.toArray()).filter((row: any) => row.projectId !== projectId)
    const ids = new Set(rows.map((row: any) => row.id)), events = (await db.agentRunEvents.toArray()).filter((row: any) => ids.has(row.runId))
    return { sameReceipt: JSON.stringify(first) === JSON.stringify(second), active: run.coordination.activeEpochKey,
      archived: run.coordination.epochs.at(-1).commonOracleArchive, call: run.coordination.calls.at(-1),
      backupEqual: JSON.stringify(restoredState.ttrpg.openRun) === JSON.stringify(run),
      runsUnchanged: JSON.stringify(rows) === f.originalRuns, runEventsUnchanged: JSON.stringify(events) === f.originalRunEvents }
  }, fixture)
  expect(result).toMatchObject({ sameReceipt: true, active: null, backupEqual: true, runsUnchanged: true, runEventsUnchanged: true,
    archived: { producer: 'imported', observation: 'not-dispatched', priorStatus: 'prepared' }, call: { status: 'failed', terminalReason: 'cancelled-before-dispatch', usage: { actualCostUsd: 0 } } })
  expect(result.call.commonOracle.basisHash).toBe(result.archived.basisHash)
})
