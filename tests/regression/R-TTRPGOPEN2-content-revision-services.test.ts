import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openContentRevisionFixtureV1 } from '../helpers/open-ttrpg-content-revision'
import { inspectTtrpgOpenContentRevisionV1 as inspect, readTtrpgOpenContentRevisionDraftV1 as read,
  prepareTtrpgOpenContentRevisionProposalV1 as prepare, submitTtrpgOpenContentRevisionV1 as submit } from '../../src/lib/ttrpg/open-production-content-revision-service'
import * as service from '../../src/lib/product-production/service'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import type { ProductProductionTaskExecutionInputV1 } from '../../src/lib/product-production/scheduler'
beforeEach(async () => { await db.delete(); await db.open(); vi.stubGlobal('fetch', vi.fn(async () => { throw Error('No real provider in revision facade fixture') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
const snapshot = async () => JSON.stringify({ builds: await db.productBuilds.toArray(), productions: await db.productProductions.toArray(),
  commands: await db.productProductionCommands.toArray(), artifacts: await db.productBuildArtifacts.toArray(), runs: await db.agentRuns.toArray(),
  events: await db.agentRunEvents.toArray(), raw: await db.agentRunArtifacts.toArray(), worlds: await db.worldReleases.toArray() })
async function fixture() {
  const f = await openContentRevisionFixtureV1(), build = (await db.productBuilds.get(f.buildId))!, p = (await db.productProductions.get(f.productionId))!
  const view = { scope: f.scope, productionId: f.productionId, buildId: f.buildId, controlEpoch: build.controlEpoch,
    expectedStateRevision: p.stateRevision, planHash: build.planHash }
  return { ...f, view }
}
async function proposal(f: Awaited<ReturnType<typeof fixture>>) {
  const inspection = await inspect(f.view), source = await read({ owner: inspection.owner, artifactKey: 'ttrpg.open.situation-layer' })
  const draft = JSON.parse(source.authorDraftJson)
  draft.metadata.visualBible.characters[0].expressionBaselines = [{ expressionKey: 'neutral', prompt: '平静注视前方' }]
  return prepare({ source, authorDraftJson: JSON.stringify(draft), note: '明确补齐角色表情，不改变其他作者内容', commandId: 'normal.author.revision' })
}
it('loads the exact proven original and previews real dependency impact without DB writes or model calls', async () => {
  const f = await fixture(), before = await snapshot(), inspected = await inspect(f.view)
  expect(inspected.choices.map(row => row.artifactKey)).toEqual(['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer'])
  const failedMedia = JSON.parse((await db.productBuilds.get(f.buildId))!.budgetLedgerJson).attempts.find((row: { taskKey: string }) => row.taskKey === 'ttrpg.open.media-plan')
  expect(failedMedia).toMatchObject({ usageKnown: true, usage: { modelCalls: 0, mediaCalls: 0, costUsd: 0 } })
  const prepared = await proposal(f)
  expect(prepared.tasks).toEqual([{ taskKey: 'ttrpg.open.situation-layer', execution: 'author' },
    { taskKey: 'ttrpg.open.media-plan', execution: 'deterministic' }, { taskKey: 'ttrpg.open.integration', execution: 'deterministic' },
    { taskKey: 'ttrpg.open.quality', execution: 'deterministic' }])
  expect(JSON.parse(prepared.source.authorDraftJson).metadata.visualBible.characters[0].expressionBaselines).toEqual([])
  expect(await snapshot()).toBe(before); expect(f.calls).toHaveLength(3); expect(fetch).not.toHaveBeenCalled()
}, 30000)

it.each(['ttrpg.open.media-plan', 'ttrpg.open.integration', 'ttrpg.open.quality'])(
  'retains the real error and known zero-provider usage when pure kernel %s fails before returning', async taskKey => {
    const f = await fixture(), build = (await db.productBuilds.get(f.buildId))!, plan = JSON.parse(build.planJson), before = await snapshot()
    const runText = vi.fn(async () => { throw Error('kernel must not call a provider') })
    const execute = createConfiguredProductProductionExecutorV1({ production: (await db.productProductions.get(f.productionId))!, brief: f.brief, runText })
    const input: ProductProductionTaskExecutionInputV1 = { scope: f.scope, productionId: f.productionId, buildId: f.buildId,
      buildNumber: build.buildNumber, controlEpoch: build.controlEpoch, planHash: build.planHash,
      task: plan.tasks.find((row: { taskKey: string }) => row.taskKey === taskKey), attempt: 1, idempotencyKey: 'fixture.kernel.failure',
      contextText: '', inputArtifacts: [], capabilityBindings: [], authorResolution: null, signal: new AbortController().signal }
    let failure: (Error & { productProductionUsage?: { modelCalls: number; mediaCalls: number; durationMs: number } }) | undefined
    try { await execute(input) } catch (error) { failure = error as typeof failure }
    expect(failure).toBeInstanceOf(Error)
    expect(failure?.productProductionUsage).toMatchObject({ modelCalls: 0, mediaCalls: 0, inputTokens: 0, outputTokens: 0, storageBytes: 0, costUsd: 0 })
    expect(failure?.productProductionUsage?.durationMs).toBeGreaterThanOrEqual(0)
    expect(runText).not.toHaveBeenCalled(); expect(await snapshot()).toBe(before)
  }, 30000)
it('blocks invalid metadata before submission and rejects stale raw ledger/owner without silently normalizing it', async () => {
  const f = await fixture(), inspected = await inspect(f.view), source = await read({ owner: inspected.owner, artifactKey: 'ttrpg.open.situation-layer' }), before = await snapshot()
  await expect(prepare({ source, authorDraftJson: source.authorDraftJson, note: '未补齐的原表情', commandId: 'invalid.metadata' })).rejects.toThrow('表情基线')
  expect(await snapshot()).toBe(before)
  const build = (await db.productBuilds.get(f.buildId))!
  await db.productBuilds.update(f.buildId, { budgetLedgerJson: build.budgetLedgerJson + ' ' })
  await expect(read({ owner: inspected.owner, artifactKey: 'ttrpg.open.situation-layer' })).rejects.toThrow('用量')
  await expect(inspect({ ...f.view, scope: { ...f.scope, workId: f.scope.workId + 1 } })).rejects.toThrow()
}, 30000)
it('reuses the exact explicit resume after the post-commit view return is lost, without authorizing another revision', async () => {
  const f = await fixture(), prepared = await proposal(f), original = service.readProductProductionDetailsV1
  let cut = true
  vi.spyOn(service, 'readProductProductionDetailsV1').mockImplementation(async (...args) => {
    const result = await original(...args)
    if (cut && result.production.status === 'producing') { cut = false; throw Error('fixture committed view return lost') }
    return result
  })
  await expect(submit(prepared)).rejects.toThrow('view return lost')
  const build = (await db.productBuilds.get(f.buildId))!, replay = await submit(prepared)
  expect(replay.receipt).toMatchObject({ ok: true, replayed: true })
  expect(await db.productBuilds.get(f.buildId)).toEqual(build); expect(f.calls).toHaveLength(3)
  expect(await db.productProductionCommands.where('[productionId+commandId]').equals([f.productionId, prepared.command.commandId]).count()).toBe(1)
}, 30000)
it('does not turn a paused unknown-provider receipt into free author execution', async () => {
  const f = await fixture(), build = (await db.productBuilds.get(f.buildId))!
  // Explicit malformed/unknown pause fixture: the facade must stop before
  // any attempt at accounting or execution, not infer a billing disposition.
  await db.productBuilds.update(f.buildId, { failureJson: JSON.stringify({ code: 'pause-provider-result-unknown', retained: build.failureJson }) })
  const inspected = await inspect(f.view), source = await read({ owner: inspected.owner, artifactKey: 'ttrpg.open.situation-layer' }), before = await snapshot()
  expect(inspected.needsAccounting).toBe(true)
  await expect(prepare({ source, authorDraftJson: source.authorDraftJson, note: '明确返修', commandId: 'unknown.pause' })).rejects.toThrow('在途')
  expect(await snapshot()).toBe(before); expect(f.calls).toHaveLength(3)
}, 30000)
