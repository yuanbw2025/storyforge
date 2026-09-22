import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
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
import { acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { WorkspaceScope } from '../../src/lib/types'
import type {
  TextOpenWorldSourcePinBundleV1,
  TextOpenWorldSourcePinUnitRefV1,
  TextOpenWorldSourcePinV1,
} from '../../src/lib/types/text-open-world-production'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'

const HASH = 'a'.repeat(64)

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

function sourceUnitIdentityForTest(ref: TextOpenWorldSourcePinUnitRefV1) {
  return {
    unitKey: ref.unitKey,
    kind: ref.kind,
    order: ref.order,
    partIndex: ref.partIndex,
    partCount: ref.partCount,
    readDepth: ref.readDepth,
    sourceResourceKey: ref.sourceResourceKey,
    sourceArea: ref.sourceArea,
    sourceResourceKind: ref.sourceResourceKind,
    label: ref.label,
    sourceContentHash: ref.sourceContentHash,
    charCount: ref.charCount,
    wordCount: ref.wordCount,
  }
}

/** Re-seal every Pin-level hash after a hostile ref-only mutation. This keeps
 * the regression focused on the Bundle closure instead of merely exercising
 * the outer pinHash guard. */
async function resealSourcePinForTest(pin: TextOpenWorldSourcePinV1): Promise<void> {
  const unitIdentities = pin.units.map(sourceUnitIdentityForTest)
  pin.sourceBoundaryHash = await hashProductProductionValueV2({
    sourceVersionHash: pin.sourceVersionHash,
    source: pin.source,
    units: unitIdentities,
  })
  pin.authorization.sourceBoundaryHash = pin.sourceBoundaryHash
  const authorizationBody: Record<string, unknown> = { ...pin.authorization }
  delete authorizationBody.authorizationHash
  pin.authorization.authorizationHash = await hashProductProductionValueV2(authorizationBody)

  pin.readEvidence.unitCount = pin.units.length
  pin.readEvidence.totalChars = pin.units.reduce((sum, unit) => sum + unit.charCount, 0)
  pin.readEvidence.totalWords = pin.units.reduce((sum, unit) => sum + unit.wordCount, 0)
  pin.readEvidence.evidenceHash = await hashProductProductionValueV2({
    method: pin.readEvidence.method,
    readDepth: pin.readEvidence.readDepth,
    unitCount: pin.readEvidence.unitCount,
    totalChars: pin.readEvidence.totalChars,
    totalWords: pin.readEvidence.totalWords,
    capturedAt: pin.readEvidence.capturedAt,
    units: unitIdentities,
  })

  const pinBody: Record<string, unknown> = { ...pin }
  delete pinBody.pinHash
  pin.pinHash = await hashProductProductionValueV2(pinBody)
}

async function resealSourceAuthorizationForTest(input: {
  bundle: TextOpenWorldSourcePinBundleV1
  startNonceHash: string
}): Promise<void> {
  const authorization = input.bundle.pin.authorization
  authorization.authorizationNonceHash = await hashProductProductionValueV2({
    nonce: input.startNonceHash,
    productInstanceKey: authorization.productInstanceKey,
    sourceKind: authorization.sourceKind,
    sourceVersionHash: authorization.sourceVersionHash,
    sourceBoundaryHash: authorization.sourceBoundaryHash,
    briefRevision: authorization.briefRevision,
    authorStartRevision: authorization.authorStartRevision,
  })
  const authorizationBody: Record<string, unknown> = { ...authorization }
  delete authorizationBody.authorizationHash
  authorization.authorizationHash = await hashProductProductionValueV2(authorizationBody)
  const pinBody: Record<string, unknown> = { ...input.bundle.pin }
  delete pinBody.pinHash
  input.bundle.pin.pinHash = await hashProductProductionValueV2(pinBody)
}

async function resealOuterPinForTest(pin: TextOpenWorldSourcePinV1): Promise<void> {
  const pinBody: Record<string, unknown> = { ...pin }
  delete pinBody.pinHash
  pin.pinHash = await hashProductProductionValueV2(pinBody)
}

async function databaseTableCounts(): Promise<number[]> {
  return Promise.all(db.tables.map(table => table.count()))
}

function directUnitAcceptance(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  bundle: TextOpenWorldSourcePinBundleV1
  unit: TextOpenWorldSourcePinBundleV1['units'][number]
  proof?: TextOpenWorldSourcePinBundleV1
}) {
  return acceptProductBuildArtifact({
    scope: input.scope,
    buildId: input.buildId,
    controlEpoch: input.controlEpoch,
    artifactKey: input.unit.payload.artifactKey,
    requirementKey: 'text-open-world.source-pin',
    kind: 'text-open-world.source-pin-unit',
    payload: input.unit.payload,
    metadata: {
      sourceKind: input.bundle.pin.sourceKind,
      sourceUnitKey: input.unit.payload.unitKey,
      readDepth: input.unit.payload.readDepth,
    },
    quality: { gates: ['tow.source-pin.schema', 'tow.source-pin.hash'] },
    rights: {
      authorizationHash: input.bundle.pin.authorization.authorizationHash,
      rightsBasis: input.bundle.pin.authorization.rightsBasis,
      rightsNote: input.bundle.pin.authorization.rightsNote,
    },
    contentHash: input.unit.artifactContentHash,
    inputHash: input.bundle.pin.authorization.authorizationHash,
    ...(input.proof ? { sourcePinBundleProof: input.proof } : {}),
  })
}

function directPinAcceptance(input: {
  scope: WorkspaceScope
  buildId: number
  controlEpoch: number
  bundle: TextOpenWorldSourcePinBundleV1
  proof?: TextOpenWorldSourcePinBundleV1
}) {
  const pin = input.bundle.pin
  return acceptProductBuildArtifact({
    scope: input.scope,
    buildId: input.buildId,
    controlEpoch: input.controlEpoch,
    artifactKey: 'text-open-world.source-pin',
    requirementKey: 'text-open-world.source-pin',
    kind: 'text-open-world.source-pin',
    payload: pin,
    metadata: {
      sourceKind: pin.sourceKind,
      sourceVersionHash: pin.sourceVersionHash,
      sourceBoundaryHash: pin.sourceBoundaryHash,
      readEvidenceHash: pin.readEvidence.evidenceHash,
      unitArtifactHashes: pin.units.map(item => item.artifactContentHash),
    },
    quality: {
      gates: ['tow.source-pin.schema', 'tow.source-pin.hash', 'tow.source-pin.authorization'],
    },
    rights: {
      authorizationHash: pin.authorization.authorizationHash,
      rightsBasis: pin.authorization.rightsBasis,
      rightsNote: pin.authorization.rightsNote,
    },
    contentHash: pin.pinHash,
    inputHash: pin.authorization.authorizationHash,
    ...(input.proof ? { sourcePinBundleProof: input.proof } : {}),
  })
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

async function seedAuthorizedWorldBundle(sessionKey: string) {
  const world = await seedCurrentProductWorld(`TOW SourcePin ${sessionKey} ${crypto.randomUUID()}`)
  const build = await seedAuthorizedTextOpenWorldCreatorBuildV1({
    source: {
      kind: 'world-release',
      scope: world.scope,
      localReleaseRecordId: world.release.id!,
      expectedReleaseHash: world.release.contentHash,
    },
    sessionKey: `${sessionKey}-${crypto.randomUUID()}`,
  })
  const capturedAt = Math.max(Date.now(), build.start.authorizedAt)
  const bundle = await freezeTextOpenWorldWorldReleaseSourceV1({
    scope: world.scope,
    localReleaseRecordId: world.release.id!,
    expectedReleaseHash: world.release.contentHash,
    selection: { mode: 'entire-release' },
    authorization: build.authorization,
    createdAt: capturedAt,
  })
  return { world, build, bundle }
}

describe('R-OPEN-WORLD3 · WorldRelease/小说双来源 SourcePin', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('从冻结 WorldRelease 保存便携版本、Hash、授权与真实目录读取证据，并以 Artifact 组幂等落库', async () => {
    const created = await seedCurrentProductWorld(`TOW 世界 SourcePin ${crypto.randomUUID()}`)
    const catalog = await openWorldSemanticResourceCatalogV1({
      localReleaseRecordId: created.release.id!,
      expectedProjectId: created.scope.projectId,
      expectedWorldId: created.scope.worldId,
    })
    const build = await seedAuthorizedTextOpenWorldCreatorBuildV1({
      source: {
        kind: 'world-release',
        scope: created.scope,
        localReleaseRecordId: created.release.id!,
        expectedReleaseHash: created.release.contentHash,
      },
      sessionKey: `source-pin-world-${crypto.randomUUID()}`,
    })
    const selectedResourceKeys = catalog.resources.map(item => item.resourceKey)
    const capturedAt = Math.max(Date.now(), build.start.authorizedAt)
    const bundle = await freezeTextOpenWorldWorldReleaseSourceV1({
      scope: created.scope,
      localReleaseRecordId: created.release.id!,
      expectedReleaseHash: created.release.contentHash,
      selection: { mode: 'entire-release' },
      authorization: build.authorization,
      createdAt: capturedAt,
    })

    expect(bundle.pin).toMatchObject({
      productType: 'text-open-world',
      productInstanceKey: build.productionKey,
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
    expect(bundle.pin.authorization.authorizationNonceHash).not.toBe(build.start.authorizationNonceHash)
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
    const preview = await prepareTextOpenWorldNovelSourceSnapshotV1({
      sourceScope: created.scope,
      selection: { mode: 'entire-work' },
    })
    const build = await seedAuthorizedTextOpenWorldCreatorBuildV1({
      source: { kind: 'novel', scope: created.scope, selection: { mode: 'entire-work' } },
      sessionKey: `source-pin-novel-${crypto.randomUUID()}`,
    })
    const capturedAt = Math.max(Date.now(), build.start.authorizedAt)
    const bundle = await freezeTextOpenWorldNovelSourceV1({
      targetScope: created.scope,
      sourceScope: created.scope,
      selection: { mode: 'entire-work' },
      expectedSourceVersionHash: preview.sourceVersionHash,
      expectedSourceBoundaryHash: preview.sourceBoundaryHash,
      authorization: build.authorization,
      createdAt: capturedAt,
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
      updatedAt: capturedAt + 1,
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
      authorization: build.authorization,
      createdAt: capturedAt + 1,
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
      authorization: build.authorization,
      createdAt: capturedAt + 1,
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

  it('即使重封 Pin 证据，也拒绝与 SourcePinUnit Artifact 不一致的全部 ref 治理字段', async () => {
    const world = await seedCurrentProductWorld(`TOW SourcePin ref 闭包 ${crypto.randomUUID()}`)
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
        resourceKeys: [catalog.resources[0]!.resourceKey],
      },
      authorization: authorization('tow.source.ref-closure', 'ref-closure-source', Date.now()),
      createdAt: Date.now(),
    })

    const cases: Array<{
      name: string
      mutate: (candidate: TextOpenWorldSourcePinBundleV1) => void
      expectedError: RegExp
    }> = [
      {
        name: 'unitKey',
        mutate: candidate => { candidate.pin.units[0]!.unitKey += '.forged' },
        expectedError: /Artifact 未闭合/,
      },
      {
        name: 'artifactKey',
        mutate: candidate => { candidate.pin.units[0]!.artifactKey = 'text-open-world.source-pin-unit.99999' },
        expectedError: /Artifact 未闭合/,
      },
      {
        name: 'artifactContentHash',
        mutate: candidate => { candidate.pin.units[0]!.artifactContentHash = 'f'.repeat(64) },
        expectedError: /Artifact 未闭合/,
      },
      {
        name: 'label',
        mutate: candidate => { candidate.pin.units[0]!.label += '（伪造）' },
        expectedError: /Artifact 未闭合/,
      },
      {
        name: 'kind',
        mutate: candidate => { candidate.pin.units[0]!.kind = 'story-core' },
        expectedError: /WorldRelease SourcePin 身份、选择或 unit 闭包不一致/,
      },
      {
        name: 'order',
        mutate: candidate => { candidate.pin.units[0]!.order = 1 },
        expectedError: /Pin unit 引用字段非法/,
      },
      {
        name: 'partIndex',
        mutate: candidate => {
          candidate.pin.units[0]!.partIndex = 2
          candidate.pin.units[0]!.partCount = 2
        },
        expectedError: /Artifact 未闭合/,
      },
      {
        name: 'partCount',
        mutate: candidate => { candidate.pin.units[0]!.partCount = 2 },
        expectedError: /Artifact 未闭合/,
      },
      {
        name: 'readDepth',
        mutate: candidate => { candidate.pin.units[0]!.readDepth = 'full' },
        expectedError: /WorldRelease SourcePin 身份、选择或 unit 闭包不一致/,
      },
      {
        name: 'sourceResourceKey',
        mutate: candidate => {
          candidate.pin.units[0]!.sourceResourceKey = 'forged.world.resource'
          if (candidate.pin.source.kind === 'world-release') {
            candidate.pin.source.selection.selectedResourceKeys = ['forged.world.resource']
          }
        },
        expectedError: /Artifact 未闭合/,
      },
      {
        name: 'sourceContentHash',
        mutate: candidate => { candidate.pin.units[0]!.sourceContentHash = 'f'.repeat(64) },
        expectedError: /Artifact 未闭合/,
      },
      {
        name: 'charCount',
        mutate: candidate => { candidate.pin.units[0]!.charCount = 1 },
        expectedError: /Artifact 未闭合/,
      },
      {
        name: 'wordCount',
        mutate: candidate => { candidate.pin.units[0]!.wordCount = 1 },
        expectedError: /Artifact 未闭合/,
      },
    ]

    for (const testCase of cases) {
      const candidate = structuredClone(bundle)
      testCase.mutate(candidate)
      await resealSourcePinForTest(candidate.pin)
      await expect(
        validateTextOpenWorldSourcePinBundleV1(candidate),
        `ref.${testCase.name} 不得绕过 SourcePinUnit Artifact 闭包`,
      ).rejects.toThrow(testCase.expectedError)
    }
  }, 30_000)

  it('完全重签后仍拒绝额外字段与跨时间拼接的 SourcePinUnit，并保持 Build 零写入', async () => {
    const fixture = await seedAuthorizedWorldBundle('exact-schema-and-capture')
    const cases: Array<{
      name: string
      mutate: (candidate: TextOpenWorldSourcePinBundleV1) => Promise<void>
    }> = [
      {
        name: 'pin-extra-field',
        mutate: async candidate => {
          Object.assign(candidate.pin as unknown as Record<string, unknown>, { privateOverride: true })
          await resealOuterPinForTest(candidate.pin)
        },
      },
      {
        name: 'authorization-extra-field',
        mutate: async candidate => {
          const authorization = candidate.pin.authorization as unknown as Record<string, unknown>
          authorization.privateGrant = 'forged'
          const authorizationBody = { ...authorization }
          delete authorizationBody.authorizationHash
          candidate.pin.authorization.authorizationHash = await hashProductProductionValueV2(authorizationBody)
          await resealOuterPinForTest(candidate.pin)
        },
      },
      {
        name: 'read-evidence-extra-field',
        mutate: async candidate => {
          const evidence = candidate.pin.readEvidence as unknown as Record<string, unknown>
          evidence.privateExcerpt = '不得进入正式合同'
          const evidenceBody = { ...evidence }
          delete evidenceBody.evidenceHash
          candidate.pin.readEvidence.evidenceHash = await hashProductProductionValueV2({
            ...evidenceBody,
            units: candidate.pin.units.map(sourceUnitIdentityForTest),
          })
          await resealOuterPinForTest(candidate.pin)
        },
      },
      {
        name: 'unit-extra-field',
        mutate: async candidate => {
          const unit = candidate.units[0]!
          Object.assign(unit.payload as unknown as Record<string, unknown>, { hiddenText: 'forged' })
          unit.artifactContentHash = await hashProductProductionValueV2(unit.payload)
          candidate.pin.units[0]!.artifactContentHash = unit.artifactContentHash
          await resealOuterPinForTest(candidate.pin)
        },
      },
      {
        name: 'unit-captured-at-differs-from-closure',
        mutate: async candidate => {
          const unit = candidate.units[0]!
          unit.payload.capturedAt = candidate.pin.createdAt + 1
          unit.artifactContentHash = await hashProductProductionValueV2(unit.payload)
          candidate.pin.units[0]!.artifactContentHash = unit.artifactContentHash
          await resealOuterPinForTest(candidate.pin)
        },
      },
    ]

    for (const testCase of cases) {
      const candidate = structuredClone(fixture.bundle)
      await testCase.mutate(candidate)
      const before = await databaseTableCounts()
      await expect(
        acceptTextOpenWorldSourcePinBundleV1({
          scope: fixture.world.scope,
          buildId: fixture.build.buildId,
          controlEpoch: fixture.build.controlEpoch,
          bundle: candidate,
        }),
        `${testCase.name} 不得被自洽重签后写入 Build`,
      ).rejects.toThrow()
      expect(await databaseTableCounts()).toEqual(before)
    }
    expect(await db.productBuildArtifacts.where('buildId').equals(fixture.build.buildId).count()).toBe(0)
  }, 30_000)

  it('Creator Brief/Start 授权 revision、hash 或 authorStart 漂移时零写入拒绝 SourcePin', async () => {
    const fixture = await seedAuthorizedWorldBundle('authorization-anchor')
    const cases: Array<{
      name: string
      mutate: (candidate: TextOpenWorldSourcePinBundleV1) => void
    }> = [
      {
        name: 'briefRevision',
        mutate: candidate => { candidate.pin.authorization.briefRevision += 1 },
      },
      {
        name: 'briefHash',
        mutate: candidate => { candidate.pin.authorization.briefHash = 'f'.repeat(64) },
      },
      {
        name: 'authorStartRevision',
        mutate: candidate => { candidate.pin.authorization.authorStartRevision += 1 },
      },
    ]

    for (const testCase of cases) {
      const candidate = structuredClone(fixture.bundle)
      testCase.mutate(candidate)
      await resealSourceAuthorizationForTest({
        bundle: candidate,
        startNonceHash: fixture.build.start.authorizationNonceHash,
      })
      await expect(validateTextOpenWorldSourcePinBundleV1(candidate)).resolves.toBeDefined()
      const before = await databaseTableCounts()
      await expect(
        acceptTextOpenWorldSourcePinBundleV1({
          scope: fixture.world.scope,
          buildId: fixture.build.buildId,
          controlEpoch: fixture.build.controlEpoch,
          bundle: candidate,
        }),
        `${testCase.name} 不得脱离 Creator 授权锚点写入`,
      ).rejects.toThrow(/SourcePin 与 Creator Brief\/SourcePlan\/Start 授权不闭合/)
      expect(await databaseTableCounts()).toEqual(before)
    }
    expect(await db.productBuildArtifacts.where('buildId').equals(fixture.build.buildId).count()).toBe(0)
  }, 30_000)

  it('SourcePin preflight 后新增第二条匹配 Start 回执时，事务内唯一性 CAS 拒绝且零 Artifact 写入', async () => {
    const fixture = await seedAuthorizedWorldBundle('start-command-race')
    const original = await db.productProductionCommands
      .where('[productionId+status]')
      .equals([fixture.build.productionId, 'succeeded'])
      .filter(row => row.type === 'authorize-text-open-world-creator-start')
      .first()
    expect(original?.id).toBeTruthy()
    const { id: _id, ...originalFields } = original!
    const duplicate = {
      ...originalFields,
      commandId: `${original!.commandId}.duplicate`,
      payloadHash: await hashProductProductionValueV2({
        originalPayloadHash: original!.payloadHash,
        duplicate: true,
      }),
      createdAt: original!.createdAt + 1,
      completedAt: (original!.completedAt ?? original!.createdAt) + 1,
    }
    const originalTransaction = db.transaction.bind(db)
    let injected = false
    const transactionSpy = vi.spyOn(db, 'transaction').mockImplementationOnce((async (
      ...args: Parameters<typeof db.transaction>
    ) => {
      injected = true
      await db.productProductionCommands.add(duplicate)
      return originalTransaction(...args)
    }) as typeof db.transaction)
    try {
      await expect(acceptTextOpenWorldSourcePinBundleV1({
        scope: fixture.world.scope,
        buildId: fixture.build.buildId,
        controlEpoch: fixture.build.controlEpoch,
        bundle: fixture.bundle,
      })).rejects.toThrow(/SourcePin Production 在整包验收期间变化/)
    } finally {
      transactionSpy.mockRestore()
    }
    expect(injected).toBe(true)
    expect(await db.productBuildArtifacts.where('buildId').equals(fixture.build.buildId).count()).toBe(0)
    expect(await db.productProductionCommands.where('[productionId+status]')
      .equals([fixture.build.productionId, 'succeeded'])
      .filter(row => row.type === 'authorize-text-open-world-creator-start').count()).toBe(2)
    expect(Dexie.currentTransaction).toBeNull()
  }, 30_000)

  it('generic accept 缺少 Bundle proof，或把完整 B proof 写入已闭合 A Build 时均零写入', async () => {
    const fixtureA = await seedAuthorizedWorldBundle('generic-proof-a')
    await acceptTextOpenWorldSourcePinBundleV1({
      scope: fixtureA.world.scope,
      buildId: fixtureA.build.buildId,
      controlEpoch: fixtureA.build.controlEpoch,
      bundle: fixtureA.bundle,
    })
    const acceptedA = await readAcceptedTextOpenWorldSourcePinBundleV1({
      scope: fixtureA.world.scope,
      buildId: fixtureA.build.buildId,
    })

    const buildB = await seedAuthorizedTextOpenWorldCreatorBuildV1({
      source: {
        kind: 'world-release',
        scope: fixtureA.world.scope,
        localReleaseRecordId: fixtureA.world.release.id!,
        expectedReleaseHash: fixtureA.world.release.contentHash,
      },
      sessionKey: `generic-proof-b-${crypto.randomUUID()}`,
    })
    const bundleB = await freezeTextOpenWorldWorldReleaseSourceV1({
      scope: fixtureA.world.scope,
      localReleaseRecordId: fixtureA.world.release.id!,
      expectedReleaseHash: fixtureA.world.release.contentHash,
      selection: { mode: 'entire-release' },
      authorization: buildB.authorization,
      createdAt: Math.max(Date.now(), buildB.start.authorizedAt),
    })
    await expect(validateTextOpenWorldSourcePinBundleV1(bundleB)).resolves.toBeDefined()

    let before = await databaseTableCounts()
    await expect(directUnitAcceptance({
      scope: fixtureA.world.scope,
      buildId: fixtureA.build.buildId,
      controlEpoch: fixtureA.build.controlEpoch,
      bundle: fixtureA.bundle,
      unit: fixtureA.bundle.units[0]!,
    })).rejects.toThrow(/SourcePin 必须通过整包原子验收入口写入/)
    expect(await databaseTableCounts()).toEqual(before)

    before = await databaseTableCounts()
    await expect(directUnitAcceptance({
      scope: fixtureA.world.scope,
      buildId: fixtureA.build.buildId,
      controlEpoch: fixtureA.build.controlEpoch,
      bundle: bundleB,
      unit: bundleB.units[0]!,
      proof: bundleB,
    })).rejects.toThrow(/SourcePin 必须通过整包原子验收入口写入/)
    expect(await databaseTableCounts()).toEqual(before)

    before = await databaseTableCounts()
    await expect(directPinAcceptance({
      scope: fixtureA.world.scope,
      buildId: fixtureA.build.buildId,
      controlEpoch: fixtureA.build.controlEpoch,
      bundle: bundleB,
      proof: bundleB,
    })).rejects.toThrow(/SourcePin 必须通过整包原子验收入口写入/)
    expect(await databaseTableCounts()).toEqual(before)

    const afterA = await readAcceptedTextOpenWorldSourcePinBundleV1({
      scope: fixtureA.world.scope,
      buildId: fixtureA.build.buildId,
    })
    expect(afterA.pinArtifact).toEqual(acceptedA.pinArtifact)
    expect(afterA.unitArtifacts).toEqual(acceptedA.unitArtifacts)
    expect(await db.productBuildArtifacts.where('buildId').equals(buildB.buildId).count()).toBe(0)
  }, 30_000)

  it('v10 导入在任何落库前验证 SourcePin Artifact payload、row hash 与 active 闭包', async () => {
    const world = await seedCurrentProductWorld(`TOW SourcePin import ${crypto.randomUUID()}`)
    const build = await seedAuthorizedTextOpenWorldCreatorBuildV1({
      source: {
        kind: 'world-release',
        scope: world.scope,
        localReleaseRecordId: world.release.id!,
        expectedReleaseHash: world.release.contentHash,
      },
      sessionKey: `source-pin-import-${crypto.randomUUID()}`,
    })
    const capturedAt = Math.max(Date.now(), build.start.authorizedAt)
    const bundle = await freezeTextOpenWorldWorldReleaseSourceV1({
      scope: world.scope,
      localReleaseRecordId: world.release.id!,
      expectedReleaseHash: world.release.contentHash,
      selection: { mode: 'entire-release' },
      authorization: build.authorization,
      createdAt: capturedAt,
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
