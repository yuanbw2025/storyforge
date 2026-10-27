import { expect, test } from '@playwright/test'
test.beforeEach(() => test.skip(process.env.VITE_ENABLE_TTRPG_OPEN_PREVIEW !== '1', 'isolated open preview only'))
test('native F13 identity supports one explicit semantic fact, real storage rollback, reload and a complete backup without a model send', async ({ page }) => {
  test.setTimeout(180000)
  let sends = 0; page.on('request', r => { if (r.url().includes('/chat/completions')) sends++ })
  await page.goto('./')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { setupOpenEntityPlanningV1 } = await load('/storyforge/tests/helpers/open-entity-runtime.ts')
    const { openEnvelopeV1 } = await load('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const desk = await load('/storyforge/src/lib/ttrpg/open-entity-desk.ts'), api = await load('/storyforge/src/lib/ttrpg/runtime-api.ts')
    const { hashTtrpgOpenOracleFactCandidateV1 } = await load('/storyforge/src/lib/ttrpg/open-fact-ledger.ts')
    const core = await load('/storyforge/src/lib/product/runtime-core.ts'), { db } = await load('/storyforge/src/lib/db/schema.ts')
    const s = await setupOpenEntityPlanningV1((pkg: any) => { pkg.ttrpg.campaign.gmMode = 'human' }, 'viewer.gm')
    const input = { scope: s.f.scope, sessionId: s.f.sessionId, viewerKey: 'viewer.gm' }
    await desk.proposeTtrpgOpenEntityDeskV1({ ...input, submissionKey: 'native.runtime.fact.entities', oracleSourceRef: s.input.oracleSourceRef, proposals: [s.proposals[0], s.proposals[1]] })
    const pending = (await desk.readTtrpgOpenEntityDeskV1(input)).pending
    for (const a of pending.approvals) await desk.confirmTtrpgOpenEntityDeskV1({ ...input, operationKey: pending.operationKey, planHash: pending.planHash,
      actorKey: a.actorKey, decision: 'approve', review: 'reviewed-this-plan' })
    await desk.materializeTtrpgOpenEntityDeskV1({ ...input, operationKey: pending.operationKey, planHash: pending.planHash, decision: 'create-this-confirmed-plan' })
    const before = await core.readProductRuntimeState(s.f.sessionId), items = before.ttrpg.openRun.entityOperations[0].plan.items
    const proposal = { kind: 'relation', subjectRef: items[0].entityKey, predicateKey: 'knows', objectRef: items[1].entityKey, canonicalValue: true,
      detail: '原生浏览器确认的新守灯人与新地点关系', sourceFactRefs: ['fact.harbor'], audience: 'party',
      knownByActorKeys: ['hero', 'companion.1', 'companion.2'], supersedes: null, supersedeReason: null }
    const envelope = await openEnvelopeV1(s.f.sessionId, 'native.runtime.fact.confirm')
    const command = { ...envelope, viewerKey: 'viewer.gm', oracleSourceRef: s.input.oracleSourceRef, proposal, referencePolicy: 'committed-runtime-entities-v1',
      candidateHash: await hashTtrpgOpenOracleFactCandidateV1({ proposal, oracleSourceRef: s.input.oracleSourceRef,
        runtimeSourceHash: s.f.session.runtimeSourceHash, viewerKey: 'viewer.gm', baseStateHash: envelope.baseStateHash }) }
    const add = db.productRuntimeEvents.add.bind(db.productRuntimeEvents); let rejected = false
    db.productRuntimeEvents.add = async (row: any, ...args: any[]) => {
      if (!rejected && row.type === 'ttrpg.fact.asserted') { rejected = true; throw new Error('NATIVE-RUNTIME-FACT-STORAGE-CUT') }
      return add(row, ...args)
    }
    let error = ''
    try { await api.commitTtrpgOpenOracleRuntimeEntityFactV1(command) } catch (cause) { error = String(cause) }
    finally { db.productRuntimeEvents.add = add }
    const rolledBack = JSON.stringify(await core.readProductRuntimeState(s.f.sessionId)) === JSON.stringify(before)
    const event = await api.commitTtrpgOpenOracleRuntimeEntityFactV1(command), repeated = await api.commitTtrpgOpenOracleRuntimeEntityFactV1(command)
    const after = await core.readProductRuntimeState(s.f.sessionId), saved = await db.productRuntimeSessions.get(s.f.sessionId)
    return { projectId: s.f.scope.projectId, sessionId: s.f.sessionId, error, rolledBack, once: event.id === repeated.id,
      sameEntities: JSON.stringify(after.entities) === JSON.stringify(before.entities), sameProduct: JSON.stringify(after.ttrpg.product) === JSON.stringify(before.ttrpg.product),
      sameTime: JSON.stringify(after.ttrpg.openRun.worldTime) === JSON.stringify(before.ttrpg.openRun.worldTime),
      canonical: saved.runtimeHeadStateJson === JSON.stringify(after), ledger: after.ttrpg.openRun.factLedger, content: s.input.content }
  })
  expect(f).toMatchObject({ error: expect.stringContaining('NATIVE-RUNTIME-FACT-STORAGE-CUT'), rolledBack: true, once: true, sameEntities: true, sameProduct: true, sameTime: true, canonical: true })
  expect(f.ledger.entries).toHaveLength(1); expect(f.ledger.entries[0].runtimeEntityReferences.references).toHaveLength(2)
  await page.reload()
  const actual = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const core = await load('/storyforge/src/lib/product/runtime-core.ts'), backup = await load('/storyforge/src/lib/export/json-export.ts')
    const { db } = await load('/storyforge/src/lib/db/schema.ts'), { loadTtrpgOpenPlayerContextV1 } = await load('/storyforge/src/lib/ttrpg/open-player-context.ts')
    const { verifyTtrpgOpenFactLedgerV1 } = await load('/storyforge/src/lib/ttrpg/open-fact-ledger.ts')
    const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.projectId))
    const session = await db.productRuntimeSessions.where('projectId').equals(projectId).first(), state = await core.readProductRuntimeState(session.id), run = state.ttrpg.openRun
    await verifyTtrpgOpenFactLedgerV1({ ledger: run.factLedger, content: f.content, runtimeSourceHash: session.runtimeSourceHash,
      oracleReceipts: run.oracleReceipts, entityOperations: run.entityOperations, storyFacts: state.ttrpg.product.effectLedger.storyFacts })
    const context = await loadTtrpgOpenPlayerContextV1({ scope: { projectId, worldId: session.worldId, workId: session.workId }, sessionId: session.id, actorKey: 'hero' })
    return { original: (await core.readProductRuntimeState(f.sessionId)).ttrpg.openRun.factLedger, imported: run.factLedger,
      facts: context.view.sessionFacts, runs: await db.agentRuns.count() }
  }, f)
  expect(actual.original).toEqual(f.ledger); expect(actual.imported).toEqual(f.ledger)
  expect(actual.facts[0].detail).toBe('原生浏览器确认的新守灯人与新地点关系'); expect(actual.runs).toBe(0); expect(sends).toBe(0)
})
