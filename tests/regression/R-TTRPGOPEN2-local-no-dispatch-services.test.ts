import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openContentRevisionFixtureV1 } from '../helpers/open-ttrpg-content-revision'
import { inspectTtrpgOpenContentRevisionV1 as inspect, readTtrpgOpenContentRevisionDraftV1 as read,
  prepareTtrpgOpenContentRevisionProposalV1 as prepareContent, prepareTtrpgOpenLocalNoDispatchProposalV1 as prepare,
  submitTtrpgOpenLocalNoDispatchV1 as submit } from '../../src/lib/ttrpg/open-production-content-revision-service'
import * as service from '../../src/lib/product-production/service'
beforeEach(async () => { await db.delete(); await db.open(); vi.stubGlobal('fetch', vi.fn(async () => { throw Error('No provider in local bookkeeping facade fixture') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
const snapshot = async () => JSON.stringify({ builds: await db.productBuilds.toArray(), productions: await db.productProductions.toArray(),
  commands: await db.productProductionCommands.toArray(), runs: await db.agentRuns.toArray(), events: await db.agentRunEvents.toArray(),
  raw: await db.agentRunArtifacts.toArray(), artifacts: await db.productBuildArtifacts.toArray(), worlds: await db.worldReleases.toArray() })
async function fixture() {
  const f = await openContentRevisionFixtureV1({ legacyNoDispatch: true }), build = (await db.productBuilds.get(f.buildId))!, p = (await db.productProductions.get(f.productionId))!
  const view = { scope: f.scope, productionId: f.productionId, buildId: f.buildId, controlEpoch: build.controlEpoch,
    expectedStateRevision: p.stateRevision, planHash: build.planHash }
  const inspection = await inspect(view), source = await read({ owner: inspection.owner, artifactKey: 'ttrpg.open.situation-layer' })
  return { ...f, build, p, view, inspection, source }
}
it('previews all proven historical records without writes, then books them separately and leaves author repair explicitly pending', async () => {
  const f = await fixture(), before = await snapshot()
  expect(f.inspection.unreportedFailedCount).toBe(2)
  const prepared = await prepare({ source: f.source, commandId: 'facade.local.explicit' })
  expect(prepared.attempts.map(row => row.classification)).toEqual(['preflight-before-dispatch', 'empty-media-kernel'])
  expect(await snapshot()).toBe(before); expect(fetch).not.toHaveBeenCalled()
  await expect(prepareContent({ source: f.source, authorDraftJson: f.source.authorDraftJson, note: '尚未核对', commandId: 'not-yet-repair' })).rejects.toThrow('旧失败')
  const result = await submit(prepared)
  expect(result.receipt.ok).toBe(true); expect(result.details.production.status).toBe('paused'); expect(result.details.build?.status).toBe('paused')
  expect(result.details.production.controlEpoch).toBe(f.p.controlEpoch)
  expect(result.details.production.stateRevision).toBe(f.p.stateRevision + 1)
  await expect(read({ owner: f.source.owner, artifactKey: f.source.artifactKey })).rejects.toThrow('已变化')
  const next = await inspect({ ...f.view, expectedStateRevision: result.details.production.stateRevision })
  expect(next.unreportedFailedCount).toBe(0)
  const source = await read({ owner: next.owner, artifactKey: f.source.artifactKey }), draft = JSON.parse(source.authorDraftJson)
  draft.metadata.visualBible.characters[0].expressionBaselines = [{ expressionKey: 'neutral', prompt: '平静注视前方' }]
  const repair = await prepareContent({ source, authorDraftJson: JSON.stringify(draft), note: '作者单独核对返修', commandId: 'separate.repair' })
  expect(repair.tasks.filter(row => row.execution === 'model')).toHaveLength(0)
  expect((await db.productProductions.get(f.productionId))!.status).toBe('paused'); expect(f.calls).toHaveLength(3)
}, 30000)
it('replays the original bookkeeping receipt after the committed readback return is lost', async () => {
  const f = await fixture(), prepared = await prepare({ source: f.source, commandId: 'facade.local.lost-return' })
  const original = service.readProductProductionDetailsV1; let cut = true
  vi.spyOn(service, 'readProductProductionDetailsV1').mockImplementation(async (...args) => {
    const value = await original(...args)
    if (cut && value.production.stateRevision > f.p.stateRevision) { cut = false; throw Error('local booking committed return lost') }
    return value
  })
  await expect(submit(prepared)).rejects.toThrow('return lost')
  const build = (await db.productBuilds.get(f.buildId))!, replay = await submit(prepared)
  expect(replay.receipt).toMatchObject({ ok: true, replayed: true }); expect(await db.productBuilds.get(f.buildId)).toEqual(build)
  expect(await db.productProductionCommands.where('[productionId+commandId]').equals([f.productionId, prepared.command.commandId]).count()).toBe(1)
  expect(fetch).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(3)
}, 30000)
it('rejects altered proofs, foreign owner and an unknown in-flight provider pause without changing the ledger', async () => {
  const f = await fixture(), prepared = await prepare({ source: f.source, commandId: 'facade.local.bad-proof' }), before = await snapshot()
  await expect(submit({ ...prepared, command: { ...prepared.command, proofs: [] } })).rejects.toThrow()
  await expect(prepare({ source: { ...f.source, owner: { ...f.source.owner, scope: { ...f.scope, workId: f.scope.workId + 1 } } }, commandId: 'foreign.local' })).rejects.toThrow()
  expect(await snapshot()).toBe(before)
  await db.productBuilds.update(f.buildId, { failureJson: JSON.stringify({ code: 'pause-provider-result-unknown', retained: f.build.failureJson }) })
  const inspection = await inspect(f.view), source = await read({ owner: inspection.owner, artifactKey: f.source.artifactKey }), paused = await snapshot()
  await expect(prepare({ source, commandId: 'cannot.replace.provider.billing' })).rejects.toThrow('在途')
  expect(await snapshot()).toBe(paused); expect(fetch).not.toHaveBeenCalled()
}, 30000)
