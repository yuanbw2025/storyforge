import { afterAll, beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'
import { executeProductProductionCommand, isRepairRetryableFailedProductBuildV1 } from '../../src/lib/product-production/commands'
import { isTextOpenWorldEpochReusableDeterministicTaskV1 } from '../../src/lib/product-production/recovery-policy'

beforeEach(async () => { await db.delete(); await db.open() })
afterAll(() => db.close())

it('only the source pin and completed preflight can retain deterministic proof across coherent epochs', () => {
  for (const taskKey of ['p0.source-lock', 'v1.deterministic-preflight']) {
    const task = { taskKey, kind: `text-open-world.${taskKey}`, executionMode: 'deterministic' as const }
    expect(isTextOpenWorldEpochReusableDeterministicTaskV1(task)).toBe(true)
    expect(isTextOpenWorldEpochReusableDeterministicTaskV1({ ...task, kind: 'unrelated.task' })).toBe(false)
    expect(isTextOpenWorldEpochReusableDeterministicTaskV1({ ...task, executionMode: 'model' })).toBe(false)
  }
  for (const taskKey of ['v3.runtime-package', 'qa.release', 'integration.package']) {
    expect(isTextOpenWorldEpochReusableDeterministicTaskV1({ taskKey,
      kind: `text-open-world.${taskKey}`, executionMode: 'deterministic' })).toBe(false)
  }
})

it.each(['task-executor-failed', 'task-executor-nonretryable'])(
  'V3 recovery for %s remains scoped to an unreleased deterministic task and a verifiable failed Run', async code => {
  const world = await seedCurrentProductWorld('assembly-recovery')
  const creator = await seedAuthorizedTextOpenWorldCreatorBuildV1({
    source: { kind: 'world-release', scope: world.scope,
      localReleaseRecordId: world.release.id!, expectedReleaseHash: world.release.contentHash },
    sessionKey: 'assembly-recovery',
  })
  const original = (await db.productBuilds.get(creator.buildId))!
  const failure = { taskKey: 'v3.runtime-package', code, attempt: 1,
    detail: '[text-open-world-media-quality] 导入媒资来源、权利声明或物理校验回执不闭合:text-open-world.media.visual.001',
    failureProvenance: { runId: 999999, rootRunId: 999998,
      controlEpoch: original.controlEpoch, planHash: original.planHash, attempt: 1 } }
  const build = { ...original, status: 'failed' as const, failureJson: JSON.stringify(failure) }
  expect(isRepairRetryableFailedProductBuildV1(build)).toBe(true)
  for (const variant of [
    { ...build, releasedProductReleaseId: 1 },
    { ...build, status: 'cancelled' as const },
    { ...build, failureJson: JSON.stringify({ ...failure, failureProvenance: undefined }) },
    { ...build, failureJson: JSON.stringify({ ...failure, code: 'unknown-result' }) },
    { ...build, failureJson: JSON.stringify({ ...failure, code: 'task-executor-nonretryable', detail: 'unauthorized provider' }) },
    { ...build, planJson: '{}' },
  ]) expect(isRepairRetryableFailedProductBuildV1(variant)).toBe(false)

  await db.productBuilds.put(build)
  await db.productProductions.update(creator.productionId, { status: 'failed' })
  const production = (await db.productProductions.get(creator.productionId))!
  for (const action of ['retry', 'author-edit', 'change-capability'] as const) {
    const receipt = await executeProductProductionCommand({ scope: creator.scope,
      productionId: creator.productionId, command: { type: 'resolve-blocker',
        commandId: `assembly.invalid-run.${action}`, expectedStateRevision: production.stateRevision,
        blockerKey: 'v3.runtime-package', resolution: { action, note: 'isolated invalid Run proof',
          ...(action === 'author-edit' ? { authorDraftJson: '{}' } : {}),
        },
      } })
    expect(receipt).toMatchObject({ ok: false, errorCode: 'invalid-state-transition' })
    expect(await db.productBuilds.get(creator.buildId)).toEqual(build)
    expect(await db.productProductions.get(creator.productionId)).toEqual(production)
  }
})
