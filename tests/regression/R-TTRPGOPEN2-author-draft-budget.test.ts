import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openContentRevisionFixtureV1 } from '../helpers/open-ttrpg-content-revision'

beforeEach(async () => { await db.delete(); await db.open(); vi.stubGlobal('fetch', vi.fn(async () => { throw Error('No transport in author budget fixture') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
async function fixture(upstream = false, historicalOutput = 98000) {
  const f = await openContentRevisionFixtureV1({ pause: upstream, situationFailure: !upstream })
  const build = (await db.productBuilds.get(f.buildId))!, production = (await db.productProductions.get(f.productionId))!
  const ledger = JSON.parse(build.budgetLedgerJson)
  // Explicit accounting fixture for already charged historical work. It is
  // never promoted to evidence of a provider call or copied into author data.
  ledger.attempts.push({ ...ledger.attempts[0], controlEpoch: 0, runId: 987654, attempt: 1,
    idempotencyKey: 'a'.repeat(64), outcome: 'failed', errorCode: 'fixture-prior-paid', usageKnown: true,
    usage: { modelCalls: 1, inputTokens: 100, outputTokens: historicalOutput, mediaCalls: 0, costUsd: null, durationMs: 1, storageBytes: 0 } })
  await db.productBuilds.update(f.buildId, { budgetLedgerJson: JSON.stringify(ledger) })
  const draft = structuredClone(f.data.situationLayer)
  const visual = draft.metadata.visualBible as { characters: Array<{ expressionBaselines: unknown[] }> }
  visual.characters[0].expressionBaselines = [{ expressionKey: 'neutral', prompt: '专注观察' }]
  const common = { commandId: 'author.budget.explicit', expectedStateRevision: production.stateRevision }
  const artifact = (await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray())
    .find(row => row.artifactKey === 'ttrpg.open.situation-layer' && row.controlEpoch === JSON.parse(build.planJson).controlEpoch && ['accepted', 'carried-forward'].includes(row.status))
  const command = upstream ? { ...common, type: 'resume', ttrpgContentRevision: {
    artifactKey: 'ttrpg.open.situation-layer', expectedArtifactVersion: artifact!.version, expectedArtifactHash: artifact!.contentHash,
    expectedPlanHash: build.planHash, expectedControlEpoch: build.controlEpoch, note: '明确作者返修', authorDraftJson: JSON.stringify(draft) } }
    : { ...common, type: 'resolve-blocker', blockerKey: 'ttrpg.open.situation-layer', resolution: {
      action: 'author-edit', note: '明确作者修订失败原稿', authorDraftJson: JSON.stringify(draft) } }
  return { ...f, preparedCommand: command, previousAttempts: ledger.attempts, callsBefore: f.calls.length }
}

it.each([false, true])('allows an exact zero-provider author draft near the output ceiling (upstream=%s)', async upstream => {
  const f = await fixture(upstream), worlds = JSON.stringify(await db.worldReleases.toArray())
  expect((await f.command(f.preparedCommand)).ok).toBe(true)
  const result = await f.run(), build = (await db.productBuilds.get(f.buildId))!
  expect(result.terminal, build.failureJson).toBe(true)
  const ledger = JSON.parse(build.budgetLedgerJson)
  expect(ledger.attempts.slice(0, f.previousAttempts.length)).toEqual(f.previousAttempts)
  expect(f.calls).toHaveLength(f.callsBefore); expect(fetch).not.toHaveBeenCalled()
  const author = [...ledger.attempts].reverse().find((row: { taskKey: string }) => row.taskKey === 'ttrpg.open.situation-layer')
  expect(author.usage).toMatchObject({ modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 })
  const events = await db.agentRunEvents.where('runId').equals(author.runId).toArray()
  const reserved = events.find(event => event.type === 'budget.reserved')!
  expect(JSON.parse(reserved.payloadJson)).toMatchObject({ modelCalls: 0, toolCalls: 0, tokens: 0 })
  expect(events.some(event => event.type === 'model.requested')).toBe(false)
  expect(JSON.stringify(await db.worldReleases.toArray())).toBe(worlds)
}, 30000)

it('retains the full reservation for a normal retry and stops before another provider invocation', async () => {
  const f = await fixture(), command = { ...f.preparedCommand, resolution: { action: 'retry', note: '明确普通重试' } }
  expect((await f.command(command)).ok).toBe(true)
  const result = await f.run(), build = (await db.productBuilds.get(f.buildId))!
  expect(result.terminal).toBe(false); expect(JSON.parse(build.failureJson).code).toBe('task-budget-exceeded')
  expect(f.calls).toHaveLength(f.callsBefore); expect(fetch).not.toHaveBeenCalled()
  expect(JSON.parse(build.budgetLedgerJson).attempts.slice(0, f.previousAttempts.length)).toEqual(f.previousAttempts)
}, 30000)

it('still refuses an author draft when the historical charged usage already exceeds the lifetime limit', async () => {
  const f = await fixture(false, 120000)
  expect((await f.command(f.preparedCommand)).ok).toBe(true)
  const result = await f.run(), build = (await db.productBuilds.get(f.buildId))!
  expect(result.terminal).toBe(false); expect(JSON.parse(build.failureJson).code).toBe('task-budget-exceeded')
  expect(f.calls).toHaveLength(f.callsBefore)
  expect(JSON.parse(build.budgetLedgerJson).attempts.slice(0, f.previousAttempts.length)).toEqual(f.previousAttempts)
}, 30000)

it('refuses a forged revision receipt before granting the zero-provider reservation', async () => {
  const f = await fixture(true)
  expect((await f.command(f.preparedCommand)).ok).toBe(true)
  const receipt = (await db.productProductionCommands.where('[productionId+commandId]').equals([f.productionId, f.preparedCommand.commandId]).first())!
  await db.productProductionCommands.update(receipt.id!, { payloadHash: 'e'.repeat(64) })
  await expect(f.run()).rejects.toThrow()
  expect(f.calls).toHaveLength(f.callsBefore); expect(fetch).not.toHaveBeenCalled()
}, 30000)
