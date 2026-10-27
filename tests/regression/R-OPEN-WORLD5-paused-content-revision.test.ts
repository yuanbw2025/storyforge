import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { parseProductProductionCommandV1 } from '../../src/lib/product-production/contracts'
import { setProductProductionPausedV1 } from '../../src/lib/product-production/service'
import { recoveryInvalidatedTaskKeys } from '../../src/lib/product-production/scheduler'
import { validateProductProductionRecoveryDirectiveV1 } from '../../src/lib/product-production/context'
import {
  listTextOpenWorldPausedRevisionTargetsV1,
  prepareTextOpenWorldPausedRevisionV1,
  assertTextOpenWorldPausedRevisionPreparationCurrentV1,
} from '../../src/lib/open-world/production-content-revision'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'

async function fixture() {
  const world = await seedCurrentProductWorld('paused task revision')
  const seeded = await seedAuthorizedTextOpenWorldCreatorBuildV1({ source: { kind: 'world-release',
    scope: world.scope, localReleaseRecordId: world.release.id!, expectedReleaseHash: world.release.contentHash }, sessionKey: 'paused-revision' })
  const build = (await db.productBuilds.get(seeded.buildId))!
  const plan = JSON.parse(build.planJson)
  const task = plan.tasks.find((row: {taskKey: string}) => row.taskKey === 'p3.story-architecture')
  for (const key of task.outputArtifactKeys) {
    // Synthetic signed-output fixture; the real compiler/Run path is covered by
    // the production suites and real-backup isolation check, not this fixture.
    const payloadJson = JSON.stringify({ fixture: true, key })
    await db.productBuildArtifacts.add(stampNewRecord(seeded.scope, 'productBuildArtifacts', {
      buildId: build.id!, artifactKey: key, version: 1, kind: 'json', mediaKind: null, requirementKey: null,
      status: 'accepted', producerRunId: null, producerReceiptHash: 'a'.repeat(64), controlEpoch: plan.controlEpoch,
      inputHash: 'b'.repeat(64), contentHash: await hashProductProductionValueV2(JSON.parse(payloadJson)), payloadJson,
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null, mimeType: null,
      byteSize: payloadJson.length, parentArtifactHash: null, createdAt: 1, updatedAt: 1,
    } as never, { owner: 'work' }))
  }
  await db.productBuilds.update(build.id!, { status: 'building' })
  const production = (await db.productProductions.get(seeded.productionId))!
  await setProductProductionPausedV1({ scope: seeded.scope, production, build: (await db.productBuilds.get(build.id!))! })
  const target = (await listTextOpenWorldPausedRevisionTargetsV1({ scope: seeded.scope, productionId: seeded.productionId }))[0]
  return { ...seeded, plan, target, revision: { ...target, note: '修正来源冲突', authorDraftJson: '{"schema":"fixture-draft","version":1}' } }
}
async function resume(f: Awaited<ReturnType<typeof fixture>>, change: Record<string, unknown> = {}) {
  const production = (await db.productProductions.get(f.productionId))!
  return executeProductProductionCommand({ scope: f.scope, productionId: f.productionId,
    command: { type: 'resume', commandId: `revision.${crypto.randomUUID()}`, expectedStateRevision: production.stateRevision,
      openWorldContentRevision: { ...f.revision, ...change } } })
}

describe('TOW paused accepted-task revision', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('binds every sibling, preserves originals and invalidates only target descendants', async () => {
    const f = await fixture()
    expect(f.target.taskKey).toBe('p3.story-architecture')
    expect(f.target.expectedArtifacts).toHaveLength(3)
    const before = await db.productBuildArtifacts.toArray()
    expect((await resume(f)).ok).toBe(true)
    expect(await db.productBuildArtifacts.toArray()).toEqual(before)
    const build = (await db.productBuilds.get(f.buildId))!
    await expect(validateProductProductionRecoveryDirectiveV1({ scope: f.scope, productProductionId: f.productionId,
      productBuildId: f.buildId, productProductionTaskKey: f.target.taskKey, expectedState: 'resolved' }))
      .resolves.toMatchObject({ resolvedDirective: true, resolution: { action: 'author-edit' } })
    const invalid = await recoveryInvalidatedTaskKeys({ buildId: f.buildId, failureJson: build.failureJson,
      previousControlEpoch: f.plan.controlEpoch, plan: f.plan })
    expect(invalid).toContain('p3.story-architecture')
    expect(invalid).toContain('p4.region-skeleton')
    expect(invalid).toContain('p5.mainline')
    expect(invalid).not.toContain('p1.source-curation')
    expect(invalid).not.toContain('p2.gameplay-ruleset')
  })

  it.each(['missing-sibling', 'wrong-hash', 'wrong-plan', 'wrong-task', 'wrong-epoch'])(
    'rejects %s before changing the paused Build', async damage => {
      const f = await fixture(); const before = await db.productBuilds.get(f.buildId)
      const change = damage === 'missing-sibling' ? { expectedArtifacts: f.revision.expectedArtifacts.slice(1) }
        : damage === 'wrong-hash' ? { expectedArtifacts: f.revision.expectedArtifacts.map((row, i) => i ? row : { ...row, contentHash: '0'.repeat(64) }) }
        : damage === 'wrong-plan' ? { expectedPlanHash: '0'.repeat(64) }
        : damage === 'wrong-epoch' ? { expectedControlEpoch: f.revision.expectedControlEpoch + 1 }
        : { taskKey: 'p1.source-curation' }
      expect((await resume(f, change)).ok).toBe(false)
      expect(await db.productBuilds.get(f.buildId)).toEqual(before)
    })

  it.each(['preview-ready', 'released', 'foreign-work', 'damaged-original'])(
    'rejects %s without weakening completed-build or owner boundaries', async damage => {
      const f = await fixture()
      if (damage === 'preview-ready') await db.productBuilds.update(f.buildId, { resumeState: 'preview-ready', rootTerminalReceiptHash: 'a'.repeat(64) })
      if (damage === 'released') await db.productBuilds.update(f.buildId, { releasedProductReleaseId: 123 })
      const first = (await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray())[0]
      if (damage === 'foreign-work') await db.productBuildArtifacts.update(first.id!, { workId: 999_999 })
      if (damage === 'damaged-original') await db.productBuildArtifacts.update(first.id!, { payloadJson: '{"tampered":true}' })
      expect((await resume(f)).ok).toBe(false)
    })

  it('rechecks candidate bytes and successful command receipt before execution', async () => {
    const f = await fixture(); expect((await resume(f)).ok).toBe(true)
    const build = (await db.productBuilds.get(f.buildId))!
    const failure = JSON.parse(build.failureJson); failure.resolution.authorDraftJson = '{"tampered":true}'
    await db.productBuilds.update(f.buildId, { failureJson: JSON.stringify(failure) })
    await expect(validateProductProductionRecoveryDirectiveV1({ scope: f.scope, productProductionId: f.productionId,
      productBuildId: f.buildId, productProductionTaskKey: f.target.taskKey, expectedState: 'resolved' })).rejects.toThrow(/修订/)
  })

  it('rejects an invalid origin authority instead of ignoring its returned diagnostic', async () => {
    const f = await fixture()
    const command = (await db.productProductionCommands.where('productionId').equals(f.productionId).toArray())
      .find(row => row.type === 'authorize-text-open-world-creator-start')!
    await db.productProductionCommands.update(command.id!, { resultJson: '{"damaged":true}' })
    const build = await db.productBuilds.get(f.buildId)
    await expect(listTextOpenWorldPausedRevisionTargetsV1({ scope: f.scope, productionId: f.productionId })).rejects.toThrow()
    expect((await resume(f)).ok).toBe(false)
    expect(await db.productBuilds.get(f.buildId)).toEqual(build)
  })

  it.each(['artifact', 'start-command', 'brief'])(
    'rejects a %s race after preparation at the write boundary', async damage => {
      const f = await fixture()
      const production = (await db.productProductions.get(f.productionId))!
      const build = (await db.productBuilds.get(f.buildId))!
      const prepared = await prepareTextOpenWorldPausedRevisionV1({ scope: f.scope, production, build, revision: f.revision })
      if (damage === 'artifact') {
        const row = (await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray())[0]
        await db.productBuildArtifacts.update(row.id!, { payloadJson: '{"raced":true}' })
      } else if (damage === 'start-command') {
        const row = (await db.productProductionCommands.where('productionId').equals(f.productionId).toArray())
          .find(command => command.type === 'authorize-text-open-world-creator-start')!
        await db.productProductionCommands.update(row.id!, { resultJson: '{"raced":true}' })
      } else {
        const row = (await db.productProductionBriefs.where('productionId').equals(f.productionId).toArray())[0]
        await db.productProductionBriefs.update(row.id!, { briefHash: 'e'.repeat(64) })
      }
      await expect(db.transaction('rw', db.productProductions, db.productBuilds, db.productBuildArtifacts,
        db.productProductionBriefs, db.productProductionCommands, () => assertTextOpenWorldPausedRevisionPreparationCurrentV1({
          productionId: f.productionId, buildId: f.buildId, revision: f.revision, prepared,
        }))).rejects.toThrow(/原子恢复边界/)
      expect(await db.productBuilds.get(f.buildId)).toEqual(build)
    })

  it('keeps original proof readable after scheduler invalidation, while rejecting changed bytes', async () => {
    const f = await fixture(); expect((await resume(f)).ok).toBe(true)
    // The scheduler invalidates the preceding epoch before the revised task
    // runs. This must retain readable proof, not authorize a changed original.
    await db.productBuildArtifacts.where('buildId').equals(f.buildId).modify({ status: 'invalid' })
    const verify = () => validateProductProductionRecoveryDirectiveV1({ scope: f.scope,
      productProductionId: f.productionId, productBuildId: f.buildId,
      productProductionTaskKey: f.target.taskKey, expectedState: 'resolved' })
    await expect(verify()).resolves.toMatchObject({ resolvedDirective: true })
    const row = (await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray())[0]
    await db.productBuildArtifacts.update(row.id!, { payloadJson: '{"changed":true}' })
    await expect(verify()).rejects.toThrow(/原稿/)
  })

  it('a second pause cannot silently discard a pending author draft', async () => {
    const f = await fixture(); expect((await resume(f)).ok).toBe(true)
    let production = (await db.productProductions.get(f.productionId))!
    await setProductProductionPausedV1({ scope: f.scope, production, build: (await db.productBuilds.get(f.buildId))! })
    production = (await db.productProductions.get(f.productionId))!
    const lost = await executeProductProductionCommand({ scope: f.scope, productionId: f.productionId,
      command: { type: 'resume', commandId: 'discard-pending', expectedStateRevision: production.stateRevision } })
    expect(lost.ok).toBe(false)
    await expect(setProductProductionPausedV1({ scope: f.scope, production, build: (await db.productBuilds.get(f.buildId))! })).resolves.toBe('resumed')
    const build = (await db.productBuilds.get(f.buildId))!
    expect(JSON.parse(build.failureJson).resolution.authorDraftJson).toBe(f.revision.authorDraftJson)
    await expect(validateProductProductionRecoveryDirectiveV1({ scope: f.scope, productProductionId: f.productionId,
      productBuildId: f.buildId, productProductionTaskKey: f.target.taskKey, expectedState: 'resolved' })).resolves.toMatchObject({ resolvedDirective: true })
  })

  it('strict parser rejects mixed-product revisions and repeated outputs', async () => {
    const f = await fixture()
    expect(() => parseProductProductionCommandV1({ type: 'resume', commandId: 'mixed', expectedStateRevision: 1,
      contentRevision: {}, openWorldContentRevision: f.revision })).toThrow(/混用/)
    expect(() => parseProductProductionCommandV1({ type: 'resume', commandId: 'mixed-ttrpg-open-world', expectedStateRevision: 1,
      ttrpgContentRevision: {}, openWorldContentRevision: f.revision })).toThrow(/混用/)
    expect(() => parseProductProductionCommandV1({ type: 'resume', commandId: 'mixed-ttrpg-adventure', expectedStateRevision: 1,
      ttrpgContentRevision: {}, contentRevision: {} })).toThrow(/混用/)
    expect(() => parseProductProductionCommandV1({ type: 'resume', commandId: 'duplicates', expectedStateRevision: 1,
      openWorldContentRevision: { ...f.revision, expectedArtifacts: [f.revision.expectedArtifacts[0], f.revision.expectedArtifacts[0]] } })).toThrow(/重复/)
  })
})
