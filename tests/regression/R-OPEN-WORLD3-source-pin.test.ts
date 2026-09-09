import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import {
  acceptTextOpenWorldSourcePinBundleV1,
  freezeTextOpenWorldNovelSourceV1,
  freezeTextOpenWorldWorldReleaseSourceV1,
  prepareTextOpenWorldNovelSourceSnapshotV1,
  readAcceptedTextOpenWorldSourcePinBundleV1,
  validateTextOpenWorldSourcePinBundleV1,
  verifyTextOpenWorldSourcePinAvailabilityV1,
} from '../../src/lib/open-world/source-pin'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { WorkspaceScope } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const HASH = 'a'.repeat(64)

async function seedTextOpenWorldBuild(scope: WorkspaceScope, productionKey: string) {
  const now = Date.now()
  const productionId = await db.productProductions.add({
    projectId: scope.projectId,
    worldId: scope.worldId,
    workId: scope.workId,
    productionKey,
    productType: 'text-open-world',
    title: '来源锁定验收游戏',
    status: 'producing',
    stateRevision: 1,
    controlEpoch: 1,
    currentBriefRevision: 1,
    currentBuildNumber: 1,
    currentProductReleaseId: null,
    lastErrorJson: '{}',
    createdAt: now,
    updatedAt: now,
  }) as number
  const buildId = await db.productBuilds.add({
    projectId: scope.projectId,
    worldId: scope.worldId,
    workId: scope.workId,
    productionId,
    buildNumber: 1,
    briefRevision: 1,
    briefHash: HASH,
    parentBuildNumber: null,
    sourceProductReleaseId: null,
    status: 'building',
    resumeState: null,
    stateRevision: 1,
    controlEpoch: 1,
    planRevision: 1,
    planJson: '{}',
    planHash: HASH,
    budgetLedgerJson: '{}',
    manifestJson: '{}',
    manifestHash: HASH,
    packageHash: '',
    previewManifestJson: '{}',
    previewHash: '',
    qualityReportJson: '{}',
    qualityReportHash: '',
    compatibilityJson: '{}',
    rootTerminalReceiptHash: null,
    adoptionIntentHash: null,
    releasedProductReleaseId: null,
    failureJson: '{}',
    authorizedAt: now,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  }) as number
  return { productionId, buildId, controlEpoch: 1 }
}

function authorization(productionKey: string, nonce: string, authorizedAt: number) {
  return {
    productInstanceKey: productionKey,
    briefRevision: 1,
    briefHash: HASH,
    authorStartRevision: 1,
    authorizationNonce: nonce,
    rightsBasis: 'author-owned' as const,
    rightsNote: '作者确认仅用于本文字开放世界产品生产。',
    authorizedAt,
  }
}

async function seedNovelSource() {
  const created = await createWorkspace({
    name: `TOW 小说 SourcePin ${crypto.randomUUID()}`,
    genres: ['fantasy'],
    status: 'drafting',
    description: '盐脊巡井人的长篇故事。',
    targetWordCount: 500_000,
    enableMultiWorld: false,
  }, { purpose: 'longform', kind: 'novel', novelProfile: 'long' })
  const now = Date.now()
  const volumeId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
    projectId: created.scope.projectId,
    parentId: null,
    type: 'volume',
    title: '盐脊卷',
    summary: '巡井人追查断流，并逐步发现城邦隐瞒的代价。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  const chapterOutlineId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
    projectId: created.scope.projectId,
    parentId: volumeId,
    type: 'chapter',
    title: '第一章 断流',
    summary: '巡井人在干涸水渠发现被刻意抹去的盐印。',
    order: 0,
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  const originalBody = `盐井失去了回声。${'巡井人沿着旧渠寻找盐印。'.repeat(18_000)}`
  const chapterId = await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
    projectId: created.scope.projectId,
    outlineNodeId: chapterOutlineId,
    title: '第一章 断流',
    content: `<p>${originalBody}</p>`,
    wordCount: originalBody.length,
    status: 'final',
    order: 0,
    notes: '',
    summary: '巡井人在干涸水渠发现被刻意抹去的盐印。',
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' })) as number
  await db.storyCores.add(stampNewRecord(created.scope, 'storyCores', {
    projectId: created.scope.projectId,
    theme: '成长与守护',
    centralConflict: '巡井人必须在城邦秩序与断流真相之间作出选择。',
    plotPattern: '调查—成长—远行—回归',
    logline: '一名巡井人从盐脊出发，追查正在吞噬各地水源的旧日契约。',
    concept: '从小说拆解为文字开放世界',
    mainPlot: '逐区追查断流源头并完成主线目标。',
    subPlots: '各地角色、势力和地域命运故事。',
    createdAt: now,
    updatedAt: now,
  } as never, { owner: 'work' }))
  return { ...created, chapterId, originalBody, now }
}

describe('R-OPEN-WORLD3 · WorldRelease/小说双来源 SourcePin', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('从冻结 WorldRelease 保存便携版本、Hash、授权与真实目录读取证据，并以 Artifact 组幂等落库', async () => {
    const created = await seedCurrentProductWorld(`TOW 世界 SourcePin ${crypto.randomUUID()}`)
    const productionKey = 'tow.source.world'
    const build = await seedTextOpenWorldBuild(created.scope, productionKey)
    const catalog = await openWorldSemanticResourceCatalogV1({
      localReleaseRecordId: created.release.id!,
      expectedProjectId: created.scope.projectId,
      expectedWorldId: created.scope.worldId,
    })
    const selectedResourceKeys = catalog.resources.slice(0, 5).map(item => item.resourceKey)
    const capturedAt = Date.now()
    const bundle = await freezeTextOpenWorldWorldReleaseSourceV1({
      scope: created.scope,
      localReleaseRecordId: created.release.id!,
      expectedReleaseHash: created.release.contentHash,
      selection: { mode: 'selected-resources', resourceKeys: selectedResourceKeys },
      authorization: authorization(productionKey, 'world-source-authorization', capturedAt),
      createdAt: capturedAt,
    })

    expect(bundle.pin).toMatchObject({
      productType: 'text-open-world',
      productInstanceKey: productionKey,
      sourceKind: 'world-release',
      sourceVersionHash: created.release.contentHash,
      readEvidence: {
        method: 'world-release-index',
        readDepth: 'index',
        unitCount: selectedResourceKeys.length,
        totalChars: 0,
      },
      authorization: {
        rightsBasis: 'author-owned',
        permissions: [
          'derive-text-open-world',
          'read-world-release-catalog',
          'read-world-release-original',
        ],
      },
    })
    expect(bundle.pin.source.kind).toBe('world-release')
    if (bundle.pin.source.kind === 'world-release') {
      expect(bundle.pin.source.worldReference.localReleaseRecordId).toBe(0)
      expect(bundle.pin.source.selection.selectedResourceKeys).toEqual([...selectedResourceKeys].sort())
    }
    expect(JSON.stringify(bundle.pin)).not.toContain('worldReleases')
    expect(bundle.pin.authorization).not.toHaveProperty('authorizationNonce')
    expect(bundle.pin.authorization.authorizationNonceHash).not.toBe('world-source-authorization')
    expect(bundle.units.every(item => item.payload.contentText === null
      && item.payload.readDepth === 'index')).toBe(true)
    expect(bundle.units[0]!.payload.artifactKey).toBe('text-open-world.source-pin-unit')

    const stored = await acceptTextOpenWorldSourcePinBundleV1({
      scope: created.scope,
      buildId: build.buildId,
      controlEpoch: build.controlEpoch,
      bundle,
    })
    expect(stored.unitArtifacts).toHaveLength(selectedResourceKeys.length)
    expect(stored.pinArtifact).toMatchObject({
      artifactKey: 'text-open-world.source-pin',
      kind: 'text-open-world.source-pin',
      contentHash: bundle.pin.pinHash,
    })
    const repeated = await acceptTextOpenWorldSourcePinBundleV1({
      scope: created.scope,
      buildId: build.buildId,
      controlEpoch: build.controlEpoch,
      bundle,
    })
    expect(repeated.pinArtifact.id).toBe(stored.pinArtifact.id)
    expect((await readAcceptedTextOpenWorldSourcePinBundleV1({
      scope: created.scope,
      buildId: build.buildId,
    })).unitArtifacts.map(item => item.contentHash)).toEqual(bundle.units.map(item => item.artifactContentHash))

    const worldview = await db.worldviews.where('projectId').equals(created.scope.projectId).first()
    await db.worldviews.update(worldview!.id!, { worldOrigin: '活动世界已变化，但旧 Release 不变。', updatedAt: Date.now() + 1 })
    await expect(verifyTextOpenWorldSourcePinAvailabilityV1({ scope: created.scope, pin: bundle.pin }))
      .resolves.toMatchObject({ kind: 'world-release', worldReference: { releaseHash: created.release.contentHash } })
  }, 30_000)

  it('把小说正文完整复制为产品私有分片，原小说变化后旧 Build 仍可独立读取且禁止静默换源', async () => {
    const created = await seedNovelSource()
    const productionKey = 'tow.source.novel'
    const build = await seedTextOpenWorldBuild(created.scope, productionKey)
    const preview = await prepareTextOpenWorldNovelSourceSnapshotV1({
      sourceScope: created.scope,
      selection: { mode: 'entire-work' },
    })
    const bundle = await freezeTextOpenWorldNovelSourceV1({
      targetScope: created.scope,
      sourceScope: created.scope,
      selection: { mode: 'entire-work' },
      expectedSourceVersionHash: preview.sourceVersionHash,
      expectedSourceBoundaryHash: preview.sourceBoundaryHash,
      authorization: authorization(productionKey, 'novel-source-authorization', created.now),
      createdAt: created.now,
    })

    expect(bundle.pin).toMatchObject({
      sourceKind: 'novel',
      readEvidence: { method: 'novel-private-full-copy', readDepth: 'full' },
      authorization: {
        permissions: [
          'derive-text-open-world',
          'freeze-product-private-novel',
          'read-frozen-novel',
        ],
      },
    })
    expect(bundle.pin.source).toMatchObject({
      kind: 'novel',
      workTitle: expect.stringContaining('TOW 小说 SourcePin'),
      coverage: 'full-text',
      selection: { mode: 'entire-work', selectedChapterCount: 1, selectedOutlineCount: 2 },
    })
    const chapterUnits = bundle.units.filter(item => item.payload.kind === 'chapter')
    expect(chapterUnits.length).toBeGreaterThan(1)
    expect(chapterUnits.every(item => item.payload.contentText != null
      && item.payload.contentText.length <= 200_000)).toBe(true)
    expect(chapterUnits.map(item => item.payload.contentText).join('')).toContain('盐井失去了回声')
    const portable = JSON.stringify(bundle)
    expect(portable).not.toContain('sourceWorkId')
    expect(portable).not.toContain('sourceChapterId')
    expect(bundle.pin.authorization).not.toHaveProperty('authorizationNonce')
    expect(portable).not.toContain('"authorizationNonce":"')

    await acceptTextOpenWorldSourcePinBundleV1({
      scope: created.scope,
      buildId: build.buildId,
      controlEpoch: build.controlEpoch,
      bundle,
    })
    await db.chapters.update(created.chapterId, {
      content: '<p>来源小说后来被彻底改写。</p>',
      updatedAt: created.now + 1,
    })
    const frozen = await readAcceptedTextOpenWorldSourcePinBundleV1({
      scope: created.scope,
      buildId: build.buildId,
    })
    expect(frozen.unitArtifacts
      .filter(item => JSON.parse(item.payloadJson).kind === 'chapter')
      .map(item => JSON.parse(item.payloadJson).contentText).join('')).toContain('盐井失去了回声')
    await expect(verifyTextOpenWorldSourcePinAvailabilityV1({ scope: created.scope, pin: bundle.pin }))
      .resolves.toEqual({ kind: 'novel', selfContained: true })

    await expect(freezeTextOpenWorldNovelSourceV1({
      targetScope: created.scope,
      sourceScope: created.scope,
      selection: { mode: 'entire-work' },
      expectedSourceVersionHash: preview.sourceVersionHash,
      expectedSourceBoundaryHash: preview.sourceBoundaryHash,
      authorization: authorization(productionKey, 'stale-source-authorization', created.now + 1),
      createdAt: created.now + 1,
    })).rejects.toThrow(/预览后变化/)
    const changedPreview = await prepareTextOpenWorldNovelSourceSnapshotV1({
      sourceScope: created.scope,
      selection: { mode: 'entire-work' },
    })
    const changed = await freezeTextOpenWorldNovelSourceV1({
      targetScope: created.scope,
      sourceScope: created.scope,
      selection: { mode: 'entire-work' },
      expectedSourceVersionHash: changedPreview.sourceVersionHash,
      expectedSourceBoundaryHash: changedPreview.sourceBoundaryHash,
      authorization: authorization(productionKey, 'changed-source-authorization', created.now + 1),
      createdAt: created.now + 1,
    })
    expect(changed.pin.sourceVersionHash).not.toBe(bundle.pin.sourceVersionHash)
    await expect(acceptTextOpenWorldSourcePinBundleV1({
      scope: created.scope,
      buildId: build.buildId,
      controlEpoch: build.controlEpoch,
      bundle: changed,
    })).rejects.toThrow(/来源变化必须创建新 Build/)
  }, 30_000)

  it('拒绝跨项目小说、越界世界资源、篡改 unit 与未明确授权的来源', async () => {
    const world = await seedCurrentProductWorld(`TOW SourcePin 反例 ${crypto.randomUUID()}`)
    const catalog = await openWorldSemanticResourceCatalogV1({
      localReleaseRecordId: world.release.id!,
      expectedProjectId: world.scope.projectId,
      expectedWorldId: world.scope.worldId,
    })
    const capturedAt = Date.now()
    await expect(freezeTextOpenWorldWorldReleaseSourceV1({
      scope: world.scope,
      localReleaseRecordId: world.release.id!,
      expectedReleaseHash: '0'.repeat(64),
      selection: { mode: 'selected-resources', resourceKeys: [catalog.resources[0]!.resourceKey] },
      authorization: authorization('tow.source.stale', 'stale-release', capturedAt),
      createdAt: capturedAt,
    })).rejects.toThrow(/预览后变化/)
    await expect(freezeTextOpenWorldWorldReleaseSourceV1({
      scope: world.scope,
      localReleaseRecordId: world.release.id!,
      expectedReleaseHash: world.release.contentHash,
      selection: { mode: 'selected-resources', resourceKeys: ['world-release:not-present'] },
      authorization: authorization('tow.source.invalid', 'invalid-resource', capturedAt),
      createdAt: capturedAt,
    })).rejects.toThrow(/不属于冻结 WorldRelease/)

    await expect(freezeTextOpenWorldWorldReleaseSourceV1({
      scope: world.scope,
      localReleaseRecordId: world.release.id!,
      expectedReleaseHash: world.release.contentHash,
      selection: { mode: 'selected-resources', resourceKeys: [catalog.resources[0]!.resourceKey] },
      authorization: {
        ...authorization('tow.source.invalid', 'invalid-rights', capturedAt),
        rightsBasis: 'unknown' as never,
      },
      createdAt: capturedAt,
    })).rejects.toThrow(/rightsBasis/)

    const valid = await freezeTextOpenWorldWorldReleaseSourceV1({
      scope: world.scope,
      localReleaseRecordId: world.release.id!,
      expectedReleaseHash: world.release.contentHash,
      selection: { mode: 'selected-resources', resourceKeys: [catalog.resources[0]!.resourceKey] },
      authorization: authorization('tow.source.valid', 'valid-source', capturedAt),
      createdAt: capturedAt,
    })
    const tampered = structuredClone(valid)
    tampered.units[0]!.payload.label = '伪造标题'
    await expect(validateTextOpenWorldSourcePinBundleV1(tampered)).rejects.toThrow(/Artifact Hash/)

    const novel = await seedNovelSource()
    const novelPreview = await prepareTextOpenWorldNovelSourceSnapshotV1({
      sourceScope: novel.scope,
      selection: { mode: 'entire-work' },
    })
    await expect(freezeTextOpenWorldNovelSourceV1({
      targetScope: world.scope,
      sourceScope: novel.scope,
      selection: { mode: 'entire-work' },
      expectedSourceVersionHash: novelPreview.sourceVersionHash,
      expectedSourceBoundaryHash: novelPreview.sourceBoundaryHash,
      authorization: authorization('tow.source.cross-project', 'cross-project', capturedAt),
      createdAt: capturedAt,
    })).rejects.toThrow(/同一项目/)
    await expect(freezeTextOpenWorldNovelSourceV1({
      targetScope: novel.scope,
      sourceScope: novel.scope,
      selection: { mode: 'chapters', chapterIds: [999_999] },
      expectedSourceVersionHash: HASH,
      expectedSourceBoundaryHash: HASH,
      authorization: authorization('tow.source.bad-chapter', 'bad-chapter', capturedAt),
      createdAt: capturedAt,
    })).rejects.toThrow(/越界 ID/)

    const recomputed = await hashProductProductionValueV2(valid.units[0]!.payload)
    expect(recomputed).toBe(valid.units[0]!.artifactContentHash)
  }, 30_000)

  it('v10 导入在任何落库前验证 SourcePin Artifact payload、row hash 与 active 闭包', async () => {
    const world = await seedCurrentProductWorld(`TOW SourcePin import ${crypto.randomUUID()}`)
    const productionKey = 'tow.source.import-preflight'
    const build = await seedTextOpenWorldBuild(world.scope, productionKey)
    const catalog = await openWorldSemanticResourceCatalogV1({
      localReleaseRecordId: world.release.id!,
      expectedProjectId: world.scope.projectId,
      expectedWorldId: world.scope.worldId,
    })
    const bundle = await freezeTextOpenWorldWorldReleaseSourceV1({
      scope: world.scope,
      localReleaseRecordId: world.release.id!,
      expectedReleaseHash: world.release.contentHash,
      selection: {
        mode: 'selected-resources',
        resourceKeys: catalog.resources.slice(0, 2).map(item => item.resourceKey),
      },
      authorization: authorization(productionKey, 'import-preflight-source', Date.now()),
      createdAt: Date.now(),
    })
    await acceptTextOpenWorldSourcePinBundleV1({
      scope: world.scope,
      buildId: build.buildId,
      controlEpoch: build.controlEpoch,
      bundle,
    })
    const backup = await exportProjectJSON(world.scope.projectId)
    const pinIndex = backup.productBuildArtifacts.findIndex(row => (
      row.artifactKey === 'text-open-world.source-pin'
    ))
    const unitIndex = backup.productBuildArtifacts.findIndex(row => (
      row.kind === 'text-open-world.source-pin-unit'
    ))
    expect(pinIndex).toBeGreaterThanOrEqual(0)
    expect(unitIndex).toBeGreaterThanOrEqual(0)

    const expectPreflightFailure = async (
      candidate: typeof backup,
      error: RegExp,
    ): Promise<void> => {
      const before = await Promise.all(db.tables.map(table => table.count()))
      const transaction = vi.spyOn(db, 'transaction')
      try {
        await expect(importProjectJSON(candidate)).rejects.toThrow(error)
        expect(transaction).not.toHaveBeenCalled()
      } finally {
        transaction.mockRestore()
      }
      expect(await Promise.all(db.tables.map(table => table.count()))).toEqual(before)
    }

    const payloadTampered = structuredClone(backup)
    const pinPayload = JSON.parse(payloadTampered.productBuildArtifacts[pinIndex]!.payloadJson)
    pinPayload.readEvidence.totalWords += 1
    payloadTampered.productBuildArtifacts[pinIndex]!.payloadJson = JSON.stringify(pinPayload)
    await expectPreflightFailure(payloadTampered, /SourcePin Artifact payload\/hash 无效/)

    const rowHashTampered = structuredClone(backup)
    rowHashTampered.productBuildArtifacts[unitIndex]!.contentHash = 'f'.repeat(64)
    await expectPreflightFailure(rowHashTampered, /SourcePin Artifact payload\/hash 无效/)

    const closureTampered = structuredClone(backup)
    closureTampered.productBuildArtifacts.splice(unitIndex, 1)
    await expectPreflightFailure(closureTampered, /SourcePin Artifact 闭包无效/)

    const importedProjectId = await importProjectJSON(structuredClone(backup))
    const [scope, importedBuild] = await Promise.all([
      resolveWorkspaceOwnership(importedProjectId).then(value => value.scope),
      db.productBuilds.where('projectId').equals(importedProjectId).first(),
    ])
    const imported = await readAcceptedTextOpenWorldSourcePinBundleV1({
      scope,
      buildId: importedBuild!.id!,
    })
    expect(imported.pinArtifact.contentHash).toBe(bundle.pin.pinHash)
    expect(imported.unitArtifacts.map(row => row.contentHash).sort())
      .toEqual(bundle.units.map(unit => unit.artifactContentHash).sort())
  }, 30_000)
})
