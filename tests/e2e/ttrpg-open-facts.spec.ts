import { expect, test } from '@playwright/test'

/** Native isolated API path, with explicit human confirmation; not public UI or model acceptance. */
test('a confirmed session fact survives reload and withdraws atomically without changing its world or Oracle result', async ({ page }) => {
  await page.goto('./')
  const initial = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const facts = await importer('/storyforge/src/lib/ttrpg/open-fact-ledger.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const fixture = await helper.readyOpenTtrpgSessionV1('native facts', (pkg: any) => { pkg.ttrpg.campaign.gmMode = 'human' })
    await commands.startTtrpgOpenEpochV1({ ...await helper.openEnvelopeV1(fixture.sessionId, 'facts.gm.epoch'),
      viewerKey: 'viewer.gm', triggerKind: 'continue-host', rawInput: '审阅原始结果与解释' })
    await commands.consultTtrpgOracleV1({ ...await helper.openEnvelopeV1(fixture.sessionId, 'facts.oracle'), viewerKey: 'viewer.gm',
      askedBy: 'gm', oracleKey: 'oracle.yes', question: '守灯人知道港口情况吗？', likelihoodTierKey: 'even' })
    const state = await core.readProductRuntimeState(fixture.sessionId)
    const oracleSourceRef = state.ttrpg.openRun.oracleReceipts[0].sourceRef
    const proposal = { kind: 'relation', subjectRef: 'keeper', predicateKey: 'knows', objectRef: 'harbor', canonicalValue: true,
      detail: '真人主持人确认的一条解释。', sourceFactRefs: ['fact.harbor'], audience: 'private', knownByActorKeys: ['hero'], supersedes: null, supersedeReason: null }
    const envelope = await helper.openEnvelopeV1(fixture.sessionId, 'facts.confirm')
    const input = { ...envelope, viewerKey: 'viewer.gm', oracleSourceRef, proposal,
      candidateHash: await facts.hashTtrpgOpenOracleFactCandidateV1({ proposal, oracleSourceRef,
        runtimeSourceHash: fixture.session.runtimeSourceHash, viewerKey: 'viewer.gm', baseStateHash: envelope.baseStateHash }) }
    return { scope: fixture.scope, sessionId: fixture.sessionId, input, event: await commands.commitTtrpgOpenOracleFactV1(input),
      state: await core.readProductRuntimeState(fixture.sessionId), world: await db.worldReleases.where('worldId').equals(fixture.scope.worldId).toArray() }
  })
  await page.reload()
  const restored = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const actors = await importer('/storyforge/src/lib/ttrpg/open-player-context.ts')
    return { event: await commands.commitTtrpgOpenOracleFactV1(fixture.input), state: await core.readProductRuntimeState(fixture.sessionId),
      hero: (await actors.loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'hero' })).view.sessionFacts,
      companion: (await actors.loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'companion.1' })).view.sessionFacts }
  }, initial)
  expect(restored.event).toEqual(initial.event)
  expect(restored.state).toEqual(initial.state)
  expect(restored.hero).toHaveLength(1)
  expect(restored.companion).toEqual([])
  const withdrawn = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const helper = await importer('/storyforge/tests/helpers/open-ttrpg-session.ts')
    const commands = await importer('/storyforge/src/lib/ttrpg/runtime-commands.ts')
    const core = await importer('/storyforge/src/lib/product/runtime-core.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    await commands.retireTtrpgOpenSessionFactV1({ ...await helper.openEnvelopeV1(fixture.sessionId, 'facts.withdraw'), viewerKey: 'viewer.gm',
      factKey: fixture.state.ttrpg.openRun.factLedger.entries[0].fact.factKey, reason: '撤回当前解释，保留原始结果' })
    return { state: await core.readProductRuntimeState(fixture.sessionId), world: await db.worldReleases.where('worldId').equals(fixture.scope.worldId).toArray() }
  }, initial)
  expect(withdrawn.world).toEqual(initial.world)
  expect(withdrawn.state.ttrpg.openRun.worldTime.worldTurn).toBe(0)
  expect(withdrawn.state.ttrpg.openRun.oracleReceipts).toEqual(initial.state.ttrpg.openRun.oracleReceipts)
  expect(withdrawn.state.ttrpg.openRun.factLedger.retirements).toHaveLength(1)
  await page.reload()
  const final = await page.evaluate(async fixture => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    return (await importer('/storyforge/src/lib/ttrpg/open-player-context.ts')).loadTtrpgOpenPlayerContextV1({ scope: fixture.scope, sessionId: fixture.sessionId, actorKey: 'hero' })
  }, initial)
  expect(final.view.sessionFacts).toEqual([])
})
