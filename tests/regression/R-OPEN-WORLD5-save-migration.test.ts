import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import {
  migrateTextOpenWorldSaveToReleaseV1,
  previewTextOpenWorldSaveMigrationV1,
} from '../../src/lib/open-world/player-save-migration'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type { ProductRelease, ProductRuntimePackageV1 } from '../../src/lib/types'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

async function fixture(name: string) {
  return createGovernedTextOpenWorldSessionFixtureV1({
    name: `${name}-${crypto.randomUUID()}`,
    textOpenWorldVNext: createTextOpenWorldVNextFixture(),
    runtimeShape: 'vnext-only',
    title: '盐脊旧版旅程',
    seed: 'g5-11-save-migration',
  })
}

async function addChildRelease(input: {
  created: Awaited<ReturnType<typeof fixture>>
  runtimePackage: ProductRuntimePackageV1
  version?: number
  parentRelease?: { releaseUid: string; releaseHash: string }
}) {
  const version = input.version ?? 2
  const manifest = await createFixtureProductReleaseManifestV1({
    runtimePackage: input.runtimePackage,
    productionKey: input.created.release.productionKey,
    releaseVersion: version,
    parentRelease: input.parentRelease ?? {
      releaseUid: input.created.manifest.lineage.releaseUid,
      releaseHash: input.created.manifest.releaseIdentityHash,
    },
  })
  const release: ProductRelease = {
    ...input.created.scope,
    productionKey: input.created.release.productionKey,
    productType: 'text-open-world',
    worldReleaseId: null,
    version,
    label: `盐脊 v${version}`,
    manifestJson: JSON.stringify(manifest),
    contentHash: await hashProductProductionValueV2(manifest),
    createdAt: input.created.release.createdAt + version * 1_000,
  }
  release.id = await db.productReleases.add(release) as number
  return { release, manifest }
}

function presentationOnlyUpdate(source: ProductRuntimePackageV1): ProductRuntimePackageV1 {
  const target = structuredClone(source)
  if (!target.textOpenWorldVNext) throw new Error('fixture缺少vNext包')
  const presentation = target.textOpenWorldVNext.modules.presentation
  const payload = presentation.payload as { tutorials: Array<{ body: string }> }
  payload.tutorials[0]!.body = '新版本补充了更清晰的调查提示。'
  presentation.contentHash = 'd'.repeat(64)
  return target
}

describe('Text Open World G5-11 · 新Release存档迁移', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('预演通过后创建绑定新Release的子Session，保留原分支、原事件与玩家进度', async () => {
    const created = await fixture('兼容迁移')
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.investigate-channel',
      targetKey: 'location.salt-port',
      commandId: 'command.g5-11.progress',
    })
    const sourceStateBefore = await readProductRuntimeState(created.session.id!)
    const sourceEventsBefore = await db.productRuntimeEvents
      .where('sessionId').equals(created.session.id!).toArray()
    const childRelease = await addChildRelease({
      created,
      runtimePackage: presentationOnlyUpdate(created.runtimePackage),
    })

    const preview = await previewTextOpenWorldSaveMigrationV1({
      scope: created.scope,
      sourceSessionId: created.session.id!,
      targetProductReleaseId: childRelease.release.id!,
    })
    expect(preview).toMatchObject({
      status: 'ready',
      source: { releaseVersion: 1, throughSequence: sourceStateBefore.lastSequence },
      target: { releaseVersion: 2 },
      guarantees: {
        originalSessionUnchanged: true,
        originalReleasePinned: true,
        createsChildSession: true,
        stateValidatedAgainstTargetPackage: true,
      },
    })
    expect(preview.summary.locationLabel).toBe('盐港广场')
    expect(await db.productRuntimeSessions.count()).toBe(1)

    const migrated = await migrateTextOpenWorldSaveToReleaseV1({
      scope: created.scope,
      sourceSessionId: created.session.id!,
      targetProductReleaseId: childRelease.release.id!,
      expectedPreviewHash: preview.previewHash,
    })
    expect(migrated.session).toMatchObject({
      productReleaseId: childRelease.release.id,
      productBuildId: null,
      parentSessionId: created.session.id,
      parentThroughSequence: sourceStateBefore.lastSequence,
      runtimeSourceHash: childRelease.manifest.packageHash,
    })
    expect(migrated.receipt).toMatchObject({
      parentSessionId: created.session.id,
      targetReleaseVersion: 2,
      previewHash: preview.previewHash,
      preservedOriginalBranch: true,
    })
    expect(migrated.receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await db.productRuntimeEvents.where('sessionId').equals(migrated.session.id).count()).toBe(0)

    const migratedState = await readProductRuntimeState(migrated.session.id)
    expect(migratedState.lastSequence).toBe(0)
    expect(migratedState.textOpenWorld?.state).toEqual(sourceStateBefore.textOpenWorld?.state)
    expect(migratedState.textOpenWorld?.runtimePackage.modules.presentation.contentHash)
      .toBe('d'.repeat(64))
    expect(await readProductRuntimeState(created.session.id!)).toEqual(sourceStateBefore)
    expect(await db.productRuntimeEvents.where('sessionId').equals(created.session.id!).toArray())
      .toEqual(sourceEventsBefore)
    expect(await db.productReleases.get(created.release.id!)).toEqual(created.release)
    expect(JSON.parse(migrated.session.canonSnapshotJson)).toMatchObject({
      migration: {
        schema: 'storyforge.text-open-world-save-migration-plan',
        previewHash: preview.previewHash,
        policy: { sourceEventsCopied: false, originalSessionMutated: false },
      },
    })
  }, 30_000)

  it('语义模块变化即使伪称lineage兼容也会复算为破坏性并拒绝迁移', async () => {
    const created = await fixture('破坏性变更')
    const changed = structuredClone(created.runtimePackage)
    changed.textOpenWorldVNext!.modules.world.contentHash = 'e'.repeat(64)
    const childRelease = await addChildRelease({ created, runtimePackage: changed })

    await expect(previewTextOpenWorldSaveMigrationV1({
      scope: created.scope,
      sourceSessionId: created.session.id!,
      targetProductReleaseId: childRelease.release.id!,
    })).rejects.toThrow('实际运行语义未通过保守兼容复算')
    expect(await db.productRuntimeSessions.count()).toBe(1)
  })

  it('预演后源Session前进会使提交CAS失败，且不会留下半成品子Session', async () => {
    const created = await fixture('预演过期')
    const childRelease = await addChildRelease({
      created,
      runtimePackage: presentationOnlyUpdate(created.runtimePackage),
    })
    const preview = await previewTextOpenWorldSaveMigrationV1({
      scope: created.scope,
      sourceSessionId: created.session.id!,
      targetProductReleaseId: childRelease.release.id!,
    })
    await executeTextOpenWorldActionV1({
      sessionId: created.session.id!,
      actionKey: 'action.investigate-channel',
      targetKey: 'location.salt-port',
      commandId: 'command.g5-11.stale',
    })

    await expect(migrateTextOpenWorldSaveToReleaseV1({
      scope: created.scope,
      sourceSessionId: created.session.id!,
      targetProductReleaseId: childRelease.release.id!,
      expectedPreviewHash: preview.previewHash,
    })).rejects.toThrow('预演已过期')
    expect(await db.productRuntimeSessions.count()).toBe(1)
  })

  it('不允许跨Work、非直接子版本或Build Preview进入迁移边界', async () => {
    const created = await fixture('作用域')
    const foreign = await fixture('外部作品')
    const childRelease = await addChildRelease({
      created,
      runtimePackage: presentationOnlyUpdate(created.runtimePackage),
    })
    await expect(previewTextOpenWorldSaveMigrationV1({
      scope: foreign.scope,
      sourceSessionId: created.session.id!,
      targetProductReleaseId: childRelease.release.id!,
    })).rejects.toThrow('源Session不存在或不属于当前Work')

    const previewSession = structuredClone(created.session)
    delete previewSession.id
    previewSession.productReleaseId = null
    previewSession.productBuildId = 999_991
    previewSession.id = await db.productRuntimeSessions.add(previewSession) as number
    await expect(previewTextOpenWorldSaveMigrationV1({
      scope: created.scope,
      sourceSessionId: previewSession.id,
      targetProductReleaseId: childRelease.release.id!,
    })).rejects.toThrow('正式Release存档')

    const unrelated = await addChildRelease({
      created,
      runtimePackage: presentationOnlyUpdate(created.runtimePackage),
      version: 3,
      parentRelease: {
        releaseUid: childRelease.manifest.lineage.releaseUid,
        releaseHash: childRelease.manifest.releaseIdentityHash,
      },
    })
    await expect(previewTextOpenWorldSaveMigrationV1({
      scope: created.scope,
      sourceSessionId: created.session.id!,
      targetProductReleaseId: unrelated.release.id!,
    })).rejects.toThrow('直接兼容子版本')
  }, 30_000)
})
