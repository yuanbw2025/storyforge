import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openContentRevisionFixtureV1 } from '../helpers/open-ttrpg-content-revision'
import { parseProductProductionCommandV1 } from '../../src/lib/product-production/contracts'
import { recoveryInvalidatedTaskKeys } from '../../src/lib/product-production/scheduler'
import { prepareTtrpgOpenContentRevisionV1 } from '../../src/lib/ttrpg/open-production-content-revision'
import { validateProductProductionRecoveryDirectiveV1 } from '../../src/lib/product-production/context'
import { publishProductProductionV1 } from '../../src/lib/product-production/service'
import type { TtrpgOpenContentRevisionV1 } from '../../src/lib/types'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
beforeEach(async () => { await db.delete(); await db.open(); vi.stubGlobal('fetch', vi.fn(async () => { throw Error('No real provider in content revision fixture') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
type Fixture = Awaited<ReturnType<typeof openContentRevisionFixtureV1>>
async function revision(f: Fixture, key: TtrpgOpenContentRevisionV1['artifactKey'] = 'ttrpg.open.situation-layer') {
  const build = (await db.productBuilds.get(f.buildId))!, p = (await db.productProductions.get(f.productionId))!
  const plan = JSON.parse(build.planJson)
  const artifact = (await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray())
    .find(row => row.artifactKey === key && row.controlEpoch === plan.controlEpoch && ['accepted', 'carried-forward'].includes(row.status))!
  const draft = JSON.parse(artifact.payloadJson)
  if (key === 'ttrpg.open.situation-layer') draft.metadata.visualBible.characters[0].expressionBaselines = [{ expressionKey: 'neutral', prompt: '平静注视前方' }]
  const command = { type: 'resume' as const, commandId: 'explicit.author.content-revision.' + key, expectedStateRevision: p.stateRevision,
    ttrpgContentRevision: { artifactKey: key, expectedArtifactVersion: artifact.version, expectedArtifactHash: artifact.contentHash,
      expectedPlanHash: build.planHash, expectedControlEpoch: build.controlEpoch, note: '作者修订原稿并核对下游影响', authorDraftJson: JSON.stringify(draft) } }
  return { command, artifact, build, p }
}

it.each(['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer'] as const)(
  'revises %s through the exact command/producer proof, invalidates its real descendants, and publishes', async key => {
    const f = await openContentRevisionFixtureV1(), r = await revision(f, key)
    expect(f.calls).toHaveLength(3)
    const worlds = JSON.stringify(await db.worldReleases.toArray()), raw = JSON.stringify(await db.agentRunArtifacts.toArray())
    const oldPlan = r.build.planJson, oldAttempts = JSON.parse(r.build.budgetLedgerJson).attempts
    const receipt = await f.command(r.command); expect(receipt.ok, JSON.stringify(receipt)).toBe(true)
    const replay = await f.command(r.command); expect(replay).toMatchObject({ ok: true, replayed: true })
    const resumed = (await db.productBuilds.get(f.buildId))!
    expect(resumed.budgetLedgerJson).toBe(r.build.budgetLedgerJson); expect(resumed.planJson).toBe(oldPlan)
    expect(JSON.stringify(await db.agentRunArtifacts.toArray())).toBe(raw); expect(f.calls).toHaveLength(3)
    const invalidated = await recoveryInvalidatedTaskKeys({ buildId: f.buildId, failureJson: resumed.failureJson,
      previousControlEpoch: JSON.parse(oldPlan).controlEpoch, plan: JSON.parse(oldPlan) })
    expect([...invalidated]).toEqual(key === 'ttrpg.open.situation-layer'
      ? ['ttrpg.open.situation-layer', 'ttrpg.open.media-plan', 'ttrpg.open.integration', 'ttrpg.open.quality']
      : key === 'ttrpg.open.rule-system'
      ? ['ttrpg.open.rule-system', 'ttrpg.open.situation-layer', 'ttrpg.open.media-plan', 'ttrpg.open.integration', 'ttrpg.open.quality']
      : ['ttrpg.open.source-facts', 'ttrpg.open.rule-system', 'ttrpg.open.situation-layer', 'ttrpg.open.media-plan', 'ttrpg.open.integration', 'ttrpg.open.quality'])
    const visual = f.data.situationLayer.metadata.visualBible as { characters: Array<{ expressionBaselines: unknown[] }> }
    visual.characters[0].expressionBaselines = [{ expressionKey: 'neutral', prompt: '平静注视前方' }]
    let result = await f.run()
    for (let n = 0; n < 2 && !result.terminal; n++) {
      const blocked = (await db.productBuilds.get(f.buildId))!, task = JSON.parse(blocked.failureJson).taskKey
      expect(['ttrpg.open.source-facts', 'ttrpg.open.rule-system'], blocked.failureJson).toContain(task)
      await f.review(task, 'new.' + n); result = await f.run()
    }
    const final = (await db.productBuilds.get(f.buildId))!
    expect(result.terminal, final.failureJson).toBe(true)
    expect(f.calls).toHaveLength(key === 'ttrpg.open.source-facts' ? 5 : key === 'ttrpg.open.rule-system' ? 4 : 3)
    expect(JSON.parse(final.budgetLedgerJson).attempts.slice(0, oldAttempts.length)).toEqual(oldAttempts)
    const original = (await db.productBuildArtifacts.get(r.artifact.id!))!
    expect(original).toEqual({ ...r.artifact, status: 'invalid', updatedAt: original.updatedAt })
    const published = await publishProductProductionV1(f); expect(published.receipt.productReleaseId).toBeGreaterThan(0)
    expect(JSON.stringify(await db.worldReleases.toArray())).toBe(worlds); expect(fetch).not.toHaveBeenCalled()
  }, 30000)

it('rejects malformed, foreign, kernel, mixed-product and stale inputs before changing the paused source', async () => {
  const f = await openContentRevisionFixtureV1(), r = await revision(f), before = JSON.stringify(await db.productBuilds.toArray())
  for (const change of [{ artifactKey: 'ttrpg.open.media-plan' }, { expectedArtifactVersion: r.artifact.version + 1 },
    { expectedArtifactHash: 'e'.repeat(64) }, { expectedPlanHash: 'e'.repeat(64) }, { expectedControlEpoch: r.build.controlEpoch + 1 },
    { authorDraftJson: '{}' }, { authorDraftJson: JSON.stringify([]) }, { authorDraftJson: 'x'.repeat(120001) }]) {
    await expect(f.command({ ...r.command, ttrpgContentRevision: { ...r.command.ttrpgContentRevision, ...change } })).rejects.toThrow()
  }
  expect(() => parseProductProductionCommandV1({ ...r.command, contentRevision: {} })).toThrow('只能')
  await expect(prepareTtrpgOpenContentRevisionV1({ scope: { ...f.scope, workId: f.scope.workId + 1 }, productionId: f.productionId,
    build: r.build, command: r.command })).rejects.toThrow()
  expect(JSON.stringify(await db.productBuilds.toArray())).toBe(before); expect(f.calls).toHaveLength(3)
}, 30000)

it('atomically rolls back a lost receipt write, then replays the same successful command without a second revision', async () => {
  const f = await openContentRevisionFixtureV1(), r = await revision(f)
  const update = db.productProductionCommands.update.bind(db.productProductionCommands)
  const spy = vi.spyOn(db.productProductionCommands, 'update').mockImplementation(async (...args) => {
    if ((args[1] as { status?: string }).status === 'succeeded') throw Error('fixture receipt write failure')
    return update(...args)
  })
  await expect(f.command(r.command)).rejects.toThrow('fixture receipt write failure')
  expect(await db.productBuilds.get(f.buildId)).toEqual(r.build)
  expect(await db.productProductions.get(f.productionId)).toEqual(r.p)
  spy.mockRestore()
  const receipts = await Promise.all([f.command(r.command), f.command(r.command)])
  expect(receipts.every(receipt => receipt.ok)).toBe(true)
  expect((await db.productBuilds.get(f.buildId))!.controlEpoch).toBe(r.build.controlEpoch + 1)
  expect(await db.productProductionCommands.where('[productionId+commandId]').equals([f.productionId, r.command.commandId]).count()).toBe(1)
  expect(f.calls).toHaveLength(3)
}, 30000)

it('cannot replace a producer-proven payload or widen a frozen generation by rehashing local rows', async () => {
  const f = await openContentRevisionFixtureV1(), r = await revision(f)
  const payload = JSON.parse(r.artifact.payloadJson); payload.metadata.pitch = 'forged accepted bytes'
  const contentHash = await hashProductProductionValueV2(payload)
  await db.productBuildArtifacts.update(r.artifact.id!, { payloadJson: JSON.stringify(payload), contentHash })
  await expect(f.command({ ...r.command, ttrpgContentRevision: { ...r.command.ttrpgContentRevision,
    expectedArtifactHash: contentHash } })).rejects.toThrow()
  await db.productBuildArtifacts.put(r.artifact)
  const plan = JSON.parse(r.build.planJson); plan.tasks[0].budgetReservation.inputTokens += 1
  const planHash = await hashProductProductionValueV2(plan)
  await db.productBuilds.update(f.buildId, { planJson: JSON.stringify(plan), planHash })
  await expect(f.command({ ...r.command, ttrpgContentRevision: { ...r.command.ttrpgContentRevision, expectedPlanHash: planHash } })).rejects.toThrow('专属任务')
  expect(f.calls).toHaveLength(3)
}, 30000)

it('keeps pending author revision history in a complete backup without granting imported producer authority', async () => {
  const f = await openContentRevisionFixtureV1(), r = await revision(f)
  expect((await f.command(r.command)).ok).toBe(true)
  const sourceBuild = (await db.productBuilds.get(f.buildId))!
  const importedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.productBuilds.where('projectId').equals(importedProject).toArray())
    .find(row => row.buildNumber === sourceBuild.buildNumber)!
  expect(imported.id).not.toBe(f.buildId)
  const failure = JSON.parse(imported.failureJson)
  expect(failure.revisionSource).toEqual(JSON.parse(sourceBuild.failureJson).revisionSource)
  expect(failure.revisionCommand.ttrpgContentRevision).toEqual(r.command.ttrpgContentRevision)
  await expect(validateProductProductionRecoveryDirectiveV1({ scope: { projectId: imported.projectId,
    worldId: imported.worldId, workId: imported.workId }, productProductionId: imported.productionId,
    productBuildId: imported.id!, productProductionTaskKey: 'ttrpg.open.situation-layer', expectedState: 'resolved' })).rejects.toThrow()
  expect(await db.productBuilds.get(f.buildId)).toEqual(sourceBuild)
}, 30000)

it('closes CAS over raw producer events and rejects forged persisted recovery evidence', async () => {
  const f = await openContentRevisionFixtureV1(), r = await revision(f)
  const prepared = await prepareTtrpgOpenContentRevisionV1({ ...f, build: r.build, command: r.command })
  const event = (await db.agentRunEvents.where('runId').equals(r.artifact.producerRunId!).toArray())[0]
  await db.agentRunEvents.update(event.id!, { payloadJson: event.payloadJson + ' ' })
  await expect(prepared.assertCurrent()).rejects.toThrow('已变化')
  await db.agentRunEvents.put(event)
  expect((await f.command(r.command)).ok).toBe(true)
  const build = (await db.productBuilds.get(f.buildId))!, failure = JSON.parse(build.failureJson)
  failure.resolution.authorDraftJson = r.artifact.payloadJson
  await db.productBuilds.update(build.id!, { failureJson: JSON.stringify(failure) })
  await expect(validateProductProductionRecoveryDirectiveV1({ scope: f.scope, productProductionId: f.productionId,
    productBuildId: f.buildId, productProductionTaskKey: 'ttrpg.open.situation-layer', expectedState: 'resolved' })).rejects.toThrow('回执')
}, 30000)
