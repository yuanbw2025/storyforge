import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  confirmTextOpenWorldCreatorBriefV1,
  generateTextOpenWorldCreatorBriefCandidateV1,
  recoverLatestTextOpenWorldCreatorBriefSessionV1,
  saveTextOpenWorldCreatorBriefDraftV1,
} from '../../src/lib/open-world/creator-brief'
import { textOpenWorldCreatorLocatorFromBriefRowV1 } from '../../src/lib/open-world/creator-brief-persistence'
import { readTextOpenWorldCreatorExecutionBriefV1 } from '../../src/lib/open-world/creator-production-start'
import { createTextOpenWorldSourceLockExecutorV1 } from '../../src/lib/open-world/production-executor'
import { validateTextOpenWorldSourcePinBundleV1 } from '../../src/lib/open-world/source-pin'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { runAuthorizedProductProductionV1, startProductProductionPreviewV1 } from '../../src/lib/product-production/service'
import * as capabilities from '../../src/lib/product-production/capabilities'
import * as commands from '../../src/lib/product-production/commands'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'
import { seedQuality005LegacyNovelV1, snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'

const SOURCE_REQUIRED = /WorldRelease|世界.*封存|派生.*世界|来源.*只读/

describe('SFQA-005 · legacy novel production remains evidence, never new authority', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('keeps the original Brief/SourcePlan/Start/Pin codec and all frozen bytes readable', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const before = await snapshotQuality005RowsV1()
    const briefRow = await db.productProductionBriefs.toCollection().first()
    const build = await db.productBuilds.get(fixture.creator.buildId)
    const contracts = await readTextOpenWorldCreatorExecutionBriefV1({ briefRow: briefRow!, planJson: build!.planJson })
    expect(contracts.sourcePlan).toEqual(fixture.creator.sourcePlan)
    expect(contracts.start).toEqual(fixture.creator.start)
    const pinRow = await db.productBuildArtifacts.where('buildId').equals(fixture.creator.buildId)
      .filter(row => row.artifactKey === 'text-open-world.source-pin').first()
    const unitRows = await db.productBuildArtifacts.where('buildId').equals(fixture.creator.buildId)
      .filter(row => row.artifactKey === 'text-open-world.source-pin-unit' || row.artifactKey.startsWith('text-open-world.source-pin-unit.')).toArray()
    expect(await validateTextOpenWorldSourcePinBundleV1({
      pin: JSON.parse(pinRow!.payloadJson),
      units: unitRows.map(row => ({ payload: JSON.parse(row.payloadJson), artifactContentHash: row.contentHash })),
    })).toMatchObject({ pin: { sourceKind: 'novel', pinHash: JSON.parse(pinRow!.payloadJson).pinHash } })
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('recovers the historical conversation without granting a new AI consultation', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const session = await recoverLatestTextOpenWorldCreatorBriefSessionV1([fixture.scope])
    expect(session?.sourceBinding.kind).toBe('novel')
    const runAI = vi.fn(async () => 'must never dispatch')
    const before = await snapshotQuality005RowsV1()
    await expect(generateTextOpenWorldCreatorBriefCandidateV1({
      session: session!, draft: session!.draft, runAI,
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(runAI).not.toHaveBeenCalled()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it.each(['save', 'confirm'] as const)('does not let a recovered novel Brief %s create a new candidate or formal write', async action => {
    const fixture = await seedQuality005LegacyNovelV1()
    const session = await recoverLatestTextOpenWorldCreatorBriefSessionV1([fixture.scope])
    const before = await snapshotQuality005RowsV1()
    const result = action === 'save'
      ? saveTextOpenWorldCreatorBriefDraftV1({ session: session!, draft: session!.draft })
      : confirmTextOpenWorldCreatorBriefV1({
          session: session!, draft: session!.draft,
          acknowledgements: { sourceIdentityReviewed: true, productBoundaryReviewed: true, unresolvedItemsClosed: true, directPublishWorkflowReviewed: true },
        })
    await expect(result).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects scheduler resume before creating a root/child Run or invoking even an injected executor', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const executor = vi.fn(async () => { throw new Error('must never execute') })
    const before = await snapshotQuality005RowsV1()
    await expect(runProductProductionSchedulerCycleV1({
      scope: fixture.scope, productionId: fixture.creator.productionId, executor,
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(executor).not.toHaveBeenCalled()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects direct P0 execution while preserving the frozen novel codec', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const build = (await db.productBuilds.get(fixture.creator.buildId))!
    const plan = parseProductProductionPlanV3(build.planJson)
    const before = await snapshotQuality005RowsV1()
    await expect(createTextOpenWorldSourceLockExecutorV1()({
      scope: fixture.scope, productionId: fixture.creator.productionId,
      buildId: build.id!, buildNumber: build.buildNumber, controlEpoch: build.controlEpoch,
      planHash: build.planHash, task: plan.tasks.find(task => task.taskKey === 'p0.source-lock')!,
      attempt: 1, idempotencyKey: 'quality005.p0', contextText: '', inputArtifacts: [],
      capabilityBindings: [], authorResolution: null, signal: new AbortController().signal,
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects the actual public execution service before provider resolution or scheduler writes', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const resolve = vi.spyOn(capabilities, 'resolveConfiguredTextCapabilityV1')
    const before = await snapshotQuality005RowsV1()
    try {
      await expect(runAuthorizedProductProductionV1({ scope: f.scope, productionId: f.creator.productionId }))
        .rejects.toThrow(SOURCE_REQUIRED)
      expect(resolve).not.toHaveBeenCalled()
      expect(await snapshotQuality005RowsV1()).toEqual(before)
    } finally { resolve.mockRestore() }
  })

  it('rejects the public new-preview service before creating even a query receipt', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const command = vi.spyOn(commands, 'executeProductProductionCommand')
    const before = await snapshotQuality005RowsV1()
    try {
      await expect(startProductProductionPreviewV1({ scope: f.scope, productionId: f.creator.productionId }))
        .rejects.toThrow(SOURCE_REQUIRED)
      expect(command).not.toHaveBeenCalled()
      expect(await snapshotQuality005RowsV1()).toEqual(before)
    } finally { command.mockRestore() }
  })

  it('permits deterministic queries of the existing legacy preview without creating a Session, Build or schedule', async () => {
    const f = await seedQuality005LegacyNovelV1()
    await db.productBuilds.update(f.creator.buildId, { status: 'preview-ready' })
    const production = (await db.productProductions.get(f.creator.productionId))!
    const build = (await db.productBuilds.get(f.creator.buildId))!
    const before = await snapshotQuality005RowsV1()
    const command = { type: 'request-preview' as const, commandId: '005.query-existing-legacy-preview',
      expectedStateRevision: production.stateRevision, buildNumber: build.buildNumber }
    const result = await executeProductProductionCommand({ scope: f.scope, productionId: production.id!, command })
    expect(result).toMatchObject({ ok: true, result: { buildNumber: build.buildNumber, previewHash: build.previewHash, packageHash: build.packageHash } })
    const afterQuery = await snapshotQuality005RowsV1()
    for (const table of ['productBuilds', 'productBuildArtifacts', 'productRuntimeSessions', 'productRuntimeEvents', 'agentRuns']) {
      expect(afterQuery[table]).toEqual(before[table])
    }
    expect((await executeProductProductionCommand({ scope: f.scope, productionId: production.id!, command })).replayed).toBe(true)
    expect(await snapshotQuality005RowsV1()).toEqual(afterQuery)
  })

  it('keeps an existing sealed legacy preview as a read-only projection without parsing providers or starting work', async () => {
    const f = await seedQuality005LegacyNovelV1()
    // The pre-policy fixture already contains its sealed preview/root proof;
    // as in the existing preview fixtures, expose that persisted preview state.
    await db.productBuilds.update(f.creator.buildId, { status: 'preview-ready' })
    const resolve = vi.spyOn(capabilities, 'resolveConfiguredTextCapabilityV1')
    const before = await snapshotQuality005RowsV1()
    try {
      const result = await runAuthorizedProductProductionV1({ scope: f.scope, productionId: f.creator.productionId })
      expect(result.buildStatus).toBe('preview-ready')
      expect(resolve).not.toHaveBeenCalled()
      expect(await snapshotQuality005RowsV1()).toEqual(before)
    } finally { resolve.mockRestore() }
  })

  it('keeps the true World public preview path and its read-only terminal execution projection', async () => {
    const f = await createTextOpenWorldCreatorReleaseFixtureV1('world-release', 1, { portableRoot: true })
    await db.productBuilds.update(f.creator.buildId, { status: 'preview-ready' })
    const opened = await startProductProductionPreviewV1({ scope: f.scope, productionId: f.creator.productionId })
    expect(opened.productType).toBe('text-open-world')
    expect((await db.productRuntimeSessions.get(opened.sessionId))?.productBuildId).toBe(f.creator.buildId)
    const before = await snapshotQuality005RowsV1()
    expect((await runAuthorizedProductProductionV1({ scope: f.scope, productionId: f.creator.productionId })).buildStatus).toBe('preview-ready')
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  }, 30_000)

  it('reads an existing start receipt without rebuilding, but rejects a genuinely new start command', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const row = (await db.productProductionBriefs.toCollection().first())!
    const old = (await db.productProductionCommands.toArray()).find(command => command.type === 'authorize-text-open-world-creator-start')!
    const sessionKey = fixture.creator.productionKey.slice('text-open-world.'.length, -17)
    const command = {
      type: 'authorize-text-open-world-creator-start' as const, commandId: old.commandId,
      expectedStateRevision: old.expectedStateRevision!, briefRevision: row.revision, briefHash: row.briefHash,
      sourceLocator: textOpenWorldCreatorLocatorFromBriefRowV1(row),
      preflight: fixture.creator.start.preflight, confirmation: fixture.creator.start.confirmation,
      rightsBasis: fixture.creator.start.rightsBasis, rightsNote: fixture.creator.start.rightsNote,
      authorizationNonce: `source-pin-${sessionKey}`, expectedPlanHash: fixture.creator.start.productionPlanHash,
      authorizedAt: fixture.creator.start.authorizedAt,
    }
    const before = await snapshotQuality005RowsV1()
    await expect(executeProductProductionCommand({
      scope: fixture.scope, productionId: fixture.creator.productionId, command,
    })).resolves.toMatchObject({ ok: true, replayed: true, result: { buildId: fixture.creator.buildId } })
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    await expect(executeProductProductionCommand({
      scope: fixture.scope, productionId: fixture.creator.productionId,
      command: { ...command, commandId: `${old.commandId}.new` },
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    await db.productBuilds.delete(fixture.creator.buildId)
    const afterMissingBuild = await snapshotQuality005RowsV1()
    await expect(executeProductProductionCommand({ scope: fixture.scope, productionId: fixture.creator.productionId, command }))
      .resolves.toMatchObject({ ok: true, replayed: true, result: { buildId: fixture.creator.buildId } })
    expect(await snapshotQuality005RowsV1()).toEqual(afterMissingBuild)
  })

  it('still allows an explicit pause and stop, while the matching resume cannot authorize new production', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const production = (await db.productProductions.get(fixture.creator.productionId))!
    const pause = await executeProductProductionCommand({
      scope: fixture.scope, productionId: production.id!,
      command: { type: 'pause', commandId: 'quality005.pause', expectedStateRevision: production.stateRevision, reason: 'Preserve old paid evidence.' },
    })
    expect(pause.ok).toBe(true)
    const paused = (await db.productProductions.get(production.id!))!
    const before = await snapshotQuality005RowsV1()
    await expect(executeProductProductionCommand({
      scope: fixture.scope, productionId: production.id!,
      command: { type: 'resume', commandId: 'quality005.resume', expectedStateRevision: paused.stateRevision },
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    const stop = await executeProductProductionCommand({
      scope: fixture.scope, productionId: production.id!,
      command: { type: 'stop', commandId: 'quality005.stop', expectedStateRevision: paused.stateRevision, retention: 'keep-build' },
    })
    expect(stop.ok).toBe(true)
    expect((await db.productBuilds.get(fixture.creator.buildId))?.status).toBe('cancelled')
    expect(await db.productReleases.count()).toBe(1)
    expect(await db.productRuntimeSessions.count()).toBe(2)
  })
})
