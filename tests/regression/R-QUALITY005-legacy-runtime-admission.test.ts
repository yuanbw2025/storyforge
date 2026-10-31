import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { commitTextOpenWorldCommandV1, getTextOpenWorldCommandStatusV1 } from '../../src/lib/open-world/commands'
import {
  appendProductRuntimeEvent,
  commitNarrativeChoice,
  branchProductRuntimeSession,
  createProductRuntimeCheckpoint,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  verifyFormalRuntimeSourceV1,
  prepareReleasedProductRuntimeSessionRecordV1,
  insertPreparedProductRuntimeSessionV1,
  parseProductRuntimeState,
} from '../../src/lib/product/runtime-core'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import { generateTextOpenWorldRuntimeIntentV1 } from '../../src/lib/open-world/runtime-intent'
import { resumeTextOpenWorldSystemWorkV1 } from '../../src/lib/open-world/action-executor'
import { projectTextOpenWorldPlayerVersionCompatibilityV1 } from '../../src/lib/open-world/player-version-compatibility'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createTextOpenWorldCreatorReleaseFixtureV1 } from '../helpers/text-open-world-creator-release'
import { seedQuality005LegacyNovelV1, snapshotQuality005RowsV1 } from '../helpers/quality005-legacy-novel'
import { seedQuality005LegacyChoiceV1 } from '../helpers/quality005-legacy-choice'

const SOURCE_REQUIRED = /WorldRelease|世界.*封存|派生.*世界|来源.*只读/

describe('SFQA-005 · historical novel runtime is read-only', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('keeps strict source verification, replay and the exact existing command receipt without writes', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const before = await snapshotQuality005RowsV1()
    const session = (await db.productRuntimeSessions.get(fixture.receiptSessionId))!
    const frozen = await verifyFormalRuntimeSourceV1(session, ['text-open-world'])
    expect(frozen.runtimePackage.textOpenWorldVNext?.sourceManifest.kind).toBe('novel-source-pin')
    const replayed = await readProductRuntimeState(session.id!)
    expect(replayed.lastSequence).toBe(fixture.receipt.eventSequence)
    await expect(getTextOpenWorldCommandStatusV1({
      sessionId: session.id!, commandId: fixture.envelope.commandId,
    })).resolves.toMatchObject({ status: 'committed', receipt: { replayed: true } })
    await expect(commitTextOpenWorldCommandV1(fixture.envelope)).resolves.toEqual({ ...fixture.receipt, replayed: true })
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects a new Session from a strictly valid old novel ProductRelease', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const before = await snapshotQuality005RowsV1()
    await expect(createTextOpenWorldInstance({
      scope: fixture.scope, productReleaseId: fixture.releaseId,
      title: 'New play must first obtain a sealed world source.', seed: 'quality005-new',
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('does not confuse a portable WorldRelease lineage with an absent optional local locator', async () => {
    const fixture = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    const releaseId = await db.productReleases.add({
      projectId: fixture.scope.projectId, worldId: fixture.scope.worldId, workId: fixture.scope.workId,
      productionKey: fixture.creator.productionKey, productType: 'text-open-world', worldReleaseId: null,
      version: 1, label: 'Portable world source', manifestJson: JSON.stringify(fixture.manifest),
      contentHash: await hashProductProductionValueV2(fixture.manifest), createdAt: Date.now(),
    }) as number
    const session = await createTextOpenWorldInstance({
      scope: fixture.scope, productReleaseId: releaseId, title: 'Normal world source', seed: 'quality005-world',
    })
    expect(session.productReleaseId).toBe(releaseId)
    const source = await verifyFormalRuntimeSourceV1(session, ['text-open-world'])
    expect(source.runtimePackage.textOpenWorldVNext?.sourceManifest.kind).toBe('world-release')
  }, 30_000)

  it('rejects a new runtime AI request before allocating a Run or invoking an injected model', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const runAI = vi.fn(async () => 'must not dispatch')
    const before = await snapshotQuality005RowsV1()
    await expect(generateTextOpenWorldRuntimeIntentV1({
      scope: fixture.scope, productRuntimeSessionId: fixture.emptySessionId,
      selectedSceneKey: 'scene.opening', utterance: '我想检查盐渠。', runAI,
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(runAI).not.toHaveBeenCalled()
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rechecks the actual immutable World Release inside Session insertion after successful preparation', async () => {
    const f = await createTextOpenWorldCreatorReleaseFixtureV1('world-release')
    const releaseId = await db.productReleases.add({ ...f.scope, productionKey: f.creator.productionKey,
      productType: 'text-open-world', worldReleaseId: null, version: 1, label: '005 World final CAS',
      manifestJson: JSON.stringify(f.manifest), contentHash: await hashProductProductionValueV2(f.manifest), createdAt: Date.now() }) as number
    const original = await createTextOpenWorldInstance({ scope: f.scope, productReleaseId: releaseId, title: 'Original normal World', seed: '005-world-cas' })
    const prepared = await prepareReleasedProductRuntimeSessionRecordV1({ ...f.scope, kind: 'text-open-world',
      productReleaseId: releaseId, origin: 'release', title: 'Prepared before source drift', seed: '005-world-cas-prepared',
      initialState: parseProductRuntimeState(original.initialStateJson) })
    await db.productReleases.update(releaseId, { label: 'Concurrently replaced source row' })
    const before = await snapshotQuality005RowsV1()
    await expect(insertPreparedProductRuntimeSessionV1(prepared)).rejects.toThrow(/来源.*变化|Release.*变化/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  }, 30_000)

  it('rejects a new valid deterministic command before creating an event', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const base = await readProductRuntimeStateVersion(fixture.emptySessionId)
    const before = await snapshotQuality005RowsV1()
    await expect(commitTextOpenWorldCommandV1({
      ...fixture.envelope, commandId: 'quality005.new-command', sessionId: fixture.emptySessionId,
      baseSequence: base.sequence, baseStateHash: base.stateHash,
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('does not let an explicit background resume append outcomes to a legacy pending command', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const before = await snapshotQuality005RowsV1()
    await expect(resumeTextOpenWorldSystemWorkV1(f.receiptSessionId)).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('keeps version evidence readable while declining execution and migration eligibility for a novel source', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const before = await snapshotQuality005RowsV1()
    const projection = await projectTextOpenWorldPlayerVersionCompatibilityV1({ scope: f.scope, currentSessionId: f.receiptSessionId })
    expect(projection.availability).toBe('ready')
    expect(projection.pinnedRelease?.canContinueWithoutUpgrade).toBe(false)
    expect(projection.releases.every(release => !release.canMigratePinnedSession)).toBe(true)
    expect(projection.migration.available).toBe(false)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects the shared append boundary as well as product command APIs', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const before = await snapshotQuality005RowsV1()
    await expect(appendProductRuntimeEvent({
      sessionId: fixture.emptySessionId, type: 'narrative.recorded',
      payload: { text: 'This valid new narrative would otherwise append to the legacy save.' },
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('rejects a valid generic Narrative Choice bridge before it appends events to an old novel Session', async () => {
    const f = await seedQuality005LegacyNovelV1()
    const state = await readProductRuntimeState(f.emptySessionId)
    const base = await readProductRuntimeStateVersion(f.emptySessionId)
    const before = await snapshotQuality005RowsV1()
    await expect(commitNarrativeChoice({ sessionId: f.emptySessionId, choiceKey: state.narrative!.availableChoiceKeys![0],
      commandId: '005-legacy-generic-choice', baseSequence: base.sequence, baseStateHash: base.stateHash }))
      .rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('still returns an exact original generic Narrative receipt without appending or granting another Choice', async () => {
    const f = await seedQuality005LegacyChoiceV1()
    const before = await snapshotQuality005RowsV1()
    expect(await commitNarrativeChoice(f.command)).toEqual(f.event)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    await expect(commitNarrativeChoice({ ...f.command, choiceKey: 'different-historical-request' }))
      .rejects.toThrow(/不同命令/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('reads an exact old generic receipt even when its Release has since disappeared, without rebuilding or granting new work', async () => {
    const f = await seedQuality005LegacyChoiceV1()
    await db.productReleases.delete(f.base.releaseId)
    const before = await snapshotQuality005RowsV1()
    expect(await commitNarrativeChoice(f.command)).toEqual(f.event)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
    await expect(commitNarrativeChoice({ ...f.command, commandId: '005.missing-release-new-choice' })).rejects.toThrow(/Release|来源|不存在|Hash|hash/)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })

  it('can snapshot old deterministic evidence but cannot branch it into a new writable Session', async () => {
    const fixture = await seedQuality005LegacyNovelV1()
    const checkpoint = await createProductRuntimeCheckpoint({
      sessionId: fixture.emptySessionId, name: 'Existing historical prefix', purpose: 'manual',
    })
    const before = await snapshotQuality005RowsV1()
    await expect(branchProductRuntimeSession({
      parentSessionId: fixture.emptySessionId, throughSequence: checkpoint.throughSequence,
      title: 'Forbidden new branch', seed: 'quality005-branch',
    })).rejects.toThrow(SOURCE_REQUIRED)
    expect(await snapshotQuality005RowsV1()).toEqual(before)
  })
})
