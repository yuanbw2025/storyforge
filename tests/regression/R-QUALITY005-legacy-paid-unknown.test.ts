import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1, recordAgentRunArtifactV1 } from '../../src/lib/memory/artifact-store'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { createTextOpenWorldSourceCurationExecutorV1 } from '../../src/lib/open-world/source-curation'
import { readAcceptedTextOpenWorldSourcePinBundleV1 } from '../../src/lib/open-world/source-pin'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { readProductProductionDetailsV1, recoverImportedProductProductionProofsV1, runAuthorizedProductProductionV1 } from '../../src/lib/product-production/service'
import { seedQuality005LegacyAttemptsV1 } from '../helpers/quality005-legacy-attempts'
import { snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'

describe('SFQA-005 · actual old novel P0/P1 evidence survives the new policy', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it.each(['observed', 'unknown'] as const)('reads strict %s Run/raw/usage without dispatch or rewriting history', async mode => {
    const fixture = await seedQuality005LegacyAttemptsV1()
    const f = fixture.cases.find(row => row.mode === mode)!
    const before = await snapshotQuality005RowsV1()
    const run = await readAgentRunV1(f.scope, f.runId)
    expect(run.run.contractHash).toBe(f.runContractHash)
    expect(run.run.projectionHash).toBe(f.runProjectionHash)
    expect(JSON.parse((await readAcceptedTextOpenWorldSourcePinBundleV1({ scope: f.scope, buildId: f.creator.buildId })).pinArtifact.payloadJson).sourceKind).toBe('novel')
    const details = await readProductProductionDetailsV1(f.scope, f.creator.productionId)
    expect(JSON.parse(details.build!.budgetLedgerJson).attempts.filter((row: { runId: number }) => row.runId === f.runId)).toEqual(f.attempts)
    expect(f.attempts[0].usageKnown).toBe(mode === 'observed')
    for (const raw of f.raw) expect(JSON.parse(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId,
      artifactKind: 'raw-response', contentHash: raw.contentHash })).output).toBe(f.output)
    if (mode === 'unknown') expect(f.raw).toHaveLength(0)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it.each(['observed', 'unknown'] as const)('declines new %s execution and commands without releasing prior charges or raw output', async mode => {
    const fixture = await seedQuality005LegacyAttemptsV1()
    const f = fixture.cases.find(row => row.mode === mode)!
    const build = (await db.productBuilds.get(f.creator.buildId))!
    const production = (await db.productProductions.get(f.creator.productionId))!
    const task = parseProductProductionPlanV3(build.planJson).tasks.find(row => row.taskKey === 'p1.source-curation')!
    const runModel = vi.fn(async () => { throw new Error('must not dispatch') })
    const before = await snapshotQuality005RowsV1()
    await expect(createTextOpenWorldSourceCurationExecutorV1({ runModel })({ scope: f.scope,
      productionId: production.id!, buildId: build.id!, buildNumber: build.buildNumber,
      controlEpoch: build.controlEpoch, planHash: build.planHash, task, attempt: 2, taskRunId: f.runId,
      idempotencyKey: '005-forbidden-retry', contextText: '{}', authorResolution: null, inputArtifacts: [], capabilityBindings: [],
      signal: new AbortController().signal })).rejects.toThrow(/WorldRelease|派生/)
    await expect(executeProductProductionCommand({ scope: f.scope, productionId: production.id!, command: {
      type: 'resume', commandId: `005-forbidden-${mode}`, expectedStateRevision: production.stateRevision,
    } })).rejects.toThrow(/WorldRelease|派生/)
    expect(runModel).not.toHaveBeenCalled()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('can stop a legacy unknown attempt while retaining the old reservation and all source/candidate evidence', async () => {
    const fixture = await seedQuality005LegacyAttemptsV1()
    const f = fixture.cases.find(row => row.mode === 'unknown')!
    const production = (await db.productProductions.get(f.creator.productionId))!
    const rawBefore = await db.agentRunArtifacts.toArray()
    const receipt = await executeProductProductionCommand({ scope: f.scope, productionId: production.id!, command: {
      type: 'stop', commandId: '005-stop-old-unknown', expectedStateRevision: production.stateRevision, retention: 'keep-build',
    } })
    expect(receipt.ok).toBe(true)
    const build = (await db.productBuilds.get(f.creator.buildId))!
    expect(build.status).toBe('cancelled')
    expect(JSON.parse(build.budgetLedgerJson).attempts.filter((row: { runId: number }) => row.runId === f.runId)).toEqual(f.attempts)
    expect(await db.agentRunArtifacts.toArray()).toEqual(rawBefore)
    expect(JSON.parse((await readAcceptedTextOpenWorldSourcePinBundleV1({ scope: f.scope, buildId: build.id! })).pinArtifact.payloadJson).sourceKind).toBe('novel')
  })

  it('preserves the existing failed-terminal immutability rule and does not fabricate late evidence or rewrite unknown charges', async () => {
    const fixture = await seedQuality005LegacyAttemptsV1()
    const f = fixture.cases.find(row => row.mode === 'unknown')!
    const run = await readAgentRunV1(f.scope, f.runId)
    const request = run.events.find(event => event.type === 'model.requested')!
    if (request.type !== 'model.requested') throw new Error('missing real historical request')
    const before = await snapshotQuality005RowsV1()
    const output = ' \nlate already-sent response — retained exact bytes 🌊\n '
    await expect(recordAgentRunArtifactV1({ scope: f.scope, runId: f.runId, artifactKind: 'raw-response',
      content: output, stepId: request.payload.stepId, attempt: request.payload.attempt,
      expectedLastSequence: run.projection.lastSequence })).rejects.toThrow(/终态 failed/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('retains an already-sent in-flight raw response using the original writer while rejecting new formal work', async () => {
    const fixture = await seedQuality005LegacyAttemptsV1({ inFlight: true })
    const f = fixture.cases.find(row => row.mode === 'unknown')!
    const run = await readAgentRunV1(f.scope, f.runId)
    expect(run.projection.state).toBe('running')
    const request = run.events.find(event => event.type === 'model.requested')!
    if (request.type !== 'model.requested') throw new Error('missing original dispatched request')
    const beforeBuild = await db.productBuilds.get(f.creator.buildId)
    const beforeAccepted = await db.productBuildArtifacts.toArray()
    const beforeDenial = await snapshotQuality005RowsV1()
    await expect(runAuthorizedProductProductionV1({ scope: f.scope, productionId: f.creator.productionId }))
      .rejects.toThrow(/WorldRelease|派生/)
    expect(await snapshotQuality005RowsV1()).toEqual(beforeDenial)
    // A synthetic transport packet, not a fabricated supplier booking receipt.
    const output = JSON.stringify({ output: ' \nlate already-sent response — exact retained bytes 🌊\n ',
      usage: { inputTokens: 13, outputTokens: 7 } })
    const recorded = await recordAgentRunArtifactV1({ scope: f.scope, runId: f.runId, artifactKind: 'raw-response',
      content: output, stepId: request.payload.stepId, attempt: request.payload.attempt,
      expectedLastSequence: run.projection.lastSequence })
    expect(await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: 'raw-response',
      contentHash: recorded.artifact.contentHash })).toBe(output)
    expect(await db.productBuildArtifacts.toArray()).toEqual(beforeAccepted)
    expect(await db.productBuilds.get(f.creator.buildId)).toEqual(beforeBuild)
    expect(recorded.snapshot.events.slice(0, run.events.length)).toEqual(run.events)
  })

  it.each(['observed', 'unknown'] as const)('exports/imports %s old evidence and revalidates only its already completed prefix', async mode => {
    const fixture = await seedQuality005LegacyAttemptsV1()
    const f = fixture.cases.find(row => row.mode === mode)!
    const backup = await exportProjectJSON(f.scope.projectId)
    const importedId = await importProjectJSON(backup)
    const production = (await db.productProductions.where('projectId').equals(importedId).first())!
    const scope = { projectId: importedId, worldId: production.worldId, workId: production.workId }
    const build = (await db.productBuilds.where('productionId').equals(production.id!).first())!
    const beforeRuntime = await db.productRuntimeEvents.count()
    const beforeAccepted = await db.productBuildArtifacts.where('buildId').equals(build.id!).count()
    const recovered = await recoverImportedProductProductionProofsV1({ scope, productionId: production.id! })
    expect(recovered.terminal).toBe(false)
    expect(await db.productRuntimeEvents.count()).toBe(beforeRuntime)
    expect(await db.productBuildArtifacts.where('buildId').equals(build.id!).count()).toBe(beforeAccepted)
    for (const raw of f.raw) expect(await readAgentRunArtifactExactV1({ projectId: importedId, artifactKind: 'raw-response',
      contentHash: raw.contentHash })).toBe(raw.content)
    expect(recovered.tasks.find(task => task.taskKey === 'p0.source-lock')?.status).toBe('completed')
    expect(recovered.tasks.find(task => task.taskKey === 'p1.source-curation')?.status).not.toBe('completed')
    const afterLedger = JSON.parse((await db.productBuilds.get(build.id!))!.budgetLedgerJson)
    const prior = afterLedger.attempts.find((row: { taskKey: string }) => row.taskKey === 'p1.source-curation')
    expect(prior.usageKnown).toBe(f.attempts[0].usageKnown)
    expect(prior.usage).toEqual(f.attempts[0].usage)
  }, 30_000)
})
