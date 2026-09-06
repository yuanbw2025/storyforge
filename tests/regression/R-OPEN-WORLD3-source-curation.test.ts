import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  createTextOpenWorldSourceCurationExecutorV1,
  readTextOpenWorldSourcePinContextV1,
  validateTextOpenWorldSourceCurationArtifactsV1,
  type TextOpenWorldSourceCurationModelRunnerV1,
} from '../../src/lib/open-world/source-curation'
import {
  acceptTextOpenWorldSourcePinBundleV1,
  freezeTextOpenWorldNovelSourceV1,
  freezeTextOpenWorldWorldReleaseSourceV1,
} from '../../src/lib/open-world/source-pin'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type {
  ProductProductionPlanTaskV3,
  TextOpenWorldSourceGapReportV1,
  TextOpenWorldSourceLedgerV1,
  TextOpenWorldSourceManifestV1,
  WorkspaceScope,
} from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

const HASH = 'a'.repeat(64)
const CAPABILITY_HASH = 'b'.repeat(64)

async function seedBuild(scope: WorkspaceScope, productionKey: string) {
  const now = 1_788_633_600_000
  const productionId = await db.productProductions.add({
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    productionKey, productType: 'text-open-world', title: 'P1来源拆解验收',
    status: 'producing', stateRevision: 1, controlEpoch: 1,
    currentBriefRevision: 1, currentBuildNumber: 1, currentProductReleaseId: null,
    lastErrorJson: '{}', createdAt: now, updatedAt: now,
  }) as number
  const buildId = await db.productBuilds.add({
    projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId,
    productionId, buildNumber: 1, briefRevision: 1, briefHash: HASH,
    parentBuildNumber: null, sourceProductReleaseId: null, status: 'building', resumeState: null,
    stateRevision: 1, controlEpoch: 1, planRevision: 1, planJson: '{}', planHash: HASH,
    budgetLedgerJson: '{}', manifestJson: '{}', manifestHash: HASH, packageHash: '',
    previewManifestJson: '{}', previewHash: '', qualityReportJson: '{}', qualityReportHash: '',
    compatibilityJson: '{}', rootTerminalReceiptHash: null, adoptionIntentHash: null,
    releasedProductReleaseId: null, failureJson: '{}', authorizedAt: now, startedAt: now,
    completedAt: null, createdAt: now, updatedAt: now,
  }) as number
  return { productionId, buildId, now }
}

async function seedNovelFixture() {
  const created = await createWorkspace({
    name: `TOW P1 ${crypto.randomUUID()}`,
    genres: ['fantasy'], status: 'drafting',
    description: '巡井人追查盐脊断流并阻止旧契约吞噬城邦。',
    targetWordCount: 120_000, enableMultiWorld: false,
  }, { purpose: 'longform', kind: 'novel', novelProfile: 'long' })
  const build = await seedBuild(created.scope, 'tow.curation.novel')
  const volumeId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
    projectId: created.scope.projectId, parentId: null, type: 'volume', title: '盐脊卷',
    summary: '巡井人从断流事件进入横跨三地的调查。', order: 0,
    createdAt: build.now, updatedAt: build.now,
  } as never, { owner: 'work' })) as number
  const chapterOutlineId = await db.outlineNodes.add(stampNewRecord(created.scope, 'outlineNodes', {
    projectId: created.scope.projectId, parentId: volumeId, type: 'chapter', title: '断流',
    summary: '巡井人在旧渠发现反派留下的契约印记。', order: 0,
    createdAt: build.now, updatedAt: build.now,
  } as never, { owner: 'work' })) as number
  const longBody = `巡井人走入干涸盐渠。${'他沿着契约刻痕前进。'.repeat(22_000)}`
  await db.chapters.add(stampNewRecord(created.scope, 'chapters', {
    projectId: created.scope.projectId, outlineNodeId: chapterOutlineId,
    title: '第一章 断流', content: `<p>${longBody}</p>`, wordCount: longBody.length,
    status: 'final', order: 0, notes: '', summary: '巡井人发现断流并非天灾。',
    createdAt: build.now, updatedAt: build.now,
  } as never, { owner: 'work' }))
  await db.storyCores.add(stampNewRecord(created.scope, 'storyCores', {
    projectId: created.scope.projectId,
    theme: '成长与守护',
    centralConflict: '巡井人必须阻止旧契约吞噬盐脊，同时决定如何保存城邦秩序。',
    plotPattern: '调查—成长—远行—回归',
    logline: '巡井人追查断流，逐步揭开旧契约与城邦统治者的秘密。',
    concept: '文字开放世界来源', mainPlot: '阻止断流并守护盐脊。',
    subPlots: '沿途角色、势力和地区故事。',
    createdAt: build.now, updatedAt: build.now,
  } as never, { owner: 'work' }))
  const bundle = await freezeTextOpenWorldNovelSourceV1({
    targetScope: created.scope, sourceScope: created.scope, selection: { mode: 'entire-work' },
    authorization: {
      productInstanceKey: 'tow.curation.novel', briefRevision: 1, briefHash: HASH,
      authorStartRevision: 1, authorizationNonce: 'p1-curation-test', rightsBasis: 'author-owned',
      rightsNote: 'P1测试授权', authorizedAt: build.now,
    },
    createdAt: build.now,
  })
  await acceptTextOpenWorldSourcePinBundleV1({
    scope: created.scope, buildId: build.buildId, controlEpoch: 1, bundle,
  })
  return { ...created, ...build, bundle }
}

async function seedWorldFixture() {
  const created = await seedCurrentProductWorld(`TOW P1 WorldRelease ${crypto.randomUUID()}`)
  const build = await seedBuild(created.scope, 'tow.curation.world-release')
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: created.release.id!,
    expectedProjectId: created.scope.projectId,
    expectedWorldId: created.scope.worldId,
  })
  const selectedResourceKeys = catalog.resources.slice(0, 5).map(item => item.resourceKey)
  const bundle = await freezeTextOpenWorldWorldReleaseSourceV1({
    scope: created.scope,
    localReleaseRecordId: created.release.id!,
    selection: { mode: 'selected-resources', resourceKeys: selectedResourceKeys },
    authorization: {
      productInstanceKey: 'tow.curation.world-release',
      briefRevision: 1,
      briefHash: HASH,
      authorStartRevision: 1,
      authorizationNonce: 'p1-world-curation-test',
      rightsBasis: 'author-owned',
      rightsNote: 'P1 WorldRelease测试授权',
      authorizedAt: build.now,
    },
    createdAt: build.now,
  })
  await acceptTextOpenWorldSourcePinBundleV1({
    scope: created.scope,
    buildId: build.buildId,
    controlEpoch: 1,
    bundle,
  })
  return { ...created, ...build, bundle, selectedResourceKeys }
}

function p1Task(): ProductProductionPlanTaskV3 {
  return {
    taskKey: 'p1.source-curation', lane: 'content', kind: 'text-open-world.p1.source-curation',
    skillId: 'text-open-world.production.source-curation.v1', executionMode: 'model',
    dependsOn: ['p0.source-lock'], requiredReceipts: [{ taskKey: 'p0.source-lock', receiptHash: null }],
    inputArtifactKeys: ['text-open-world.source-pin', 'text-open-world.source-pin-unit'],
    outputArtifactKeys: [
      'text-open-world.source-manifest', 'text-open-world.source-ledger', 'text-open-world.source-gap-report',
    ],
    requirementKeys: [], capabilityRequirementKeys: ['text.primary'], concurrencyGroup: 'text-provider',
    subjectLockKeys: ['text-open-world.source-manifest'], priority: 900,
    budgetReservation: {
      modelCalls: 2, inputTokens: 8_000, outputTokens: 8_000, mediaCalls: 0,
      maximumCostUsd: null, durationMs: 120_000, storageBytes: 4_000_000,
    },
    maxAttempts: 2, timeoutMs: 300_000, failurePolicy: 'pause', fallbackTaskKey: null,
    acceptanceGateIds: ['tow.source.coverage', 'tow.source.evidence', 'tow.source.unread-explicit'],
    reuse: null,
  }
}

function receipt(requirementKey: string) {
  return {
    schema: 'storyforge.provider-binding-receipt' as const, version: 1 as const,
    requirementKey, adapterId: 'configured-text.v1' as const, adapterVersion: 1 as const,
    provider: 'test', model: 'test-model', endpointOrigin: 'https://example.invalid',
    executionLocation: 'browser-direct' as const, credentialSource: 'existing-ai-config' as const,
    credentialPresent: true as const, capabilityHash: CAPABILITY_HASH,
    boundAt: 1_788_633_600_000, receiptHash: HASH,
  }
}

function groundedRunner(options: { corruptQuote?: boolean } = {}): TextOpenWorldSourceCurationModelRunnerV1 {
  return async input => {
    const context = JSON.parse(input.contextText) as {
      selectedUnits?: Array<{ unitKey: string; content: string }>
      units?: Array<{ unitKey: string; content: string }>
    }
    const units = context.selectedUnits ?? context.units ?? []
    const target = units.find(unit => unit.content.includes('巡井人')) ?? units[0]!
    const start = target.content.indexOf('巡井人') >= 0 ? target.content.indexOf('巡井人') : 0
    const quote = options.corruptQuote ? '来源里不存在的句子' : target.content.slice(start, start + 3)
    const output = {
      schema: 'storyforge.text-open-world-source-curation-draft', version: 1,
      unitKeys: units.map(unit => unit.unitKey),
      claims: [{
        claimKind: 'plot', canonicalName: '盐脊断流主线',
        statement: '巡井人将围绕盐脊断流展开调查与成长。',
        entityKeys: ['character.protagonist', 'plot.salt-ridge'],
        coverageTags: ['story-core', 'protagonist', 'core-conflict', 'character', 'place'],
        confidence: 90,
        evidence: [{ unitKey: target.unitKey, quote, start, end: start + quote.length }],
      }],
      gaps: [],
    }
    return {
      output: JSON.stringify(output), bindingReceipt: receipt(input.requirementKey),
      usage: { inputTokens: 300, outputTokens: 180 },
    }
  }
}

describe('R-OPEN-WORLD3 · P1 SourceManifest / Ledger / Gap Report', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterAll(() => db.close())

  it('分批读取冻结小说，逐字证据进入Ledger，未读大单元只能进入显式缺口', async () => {
    const fixture = await seedNovelFixture()
    const controller = new AbortController()
    const executor = createTextOpenWorldSourceCurationExecutorV1({
      runModel: groundedRunner(), now: () => fixture.now + 1,
    })
    const result = await executor({
      scope: fixture.scope, productionId: fixture.productionId, buildId: fixture.buildId,
      buildNumber: 1, controlEpoch: 1, planHash: HASH, task: p1Task(), attempt: 1,
      idempotencyKey: HASH, contextText: '',
      inputArtifacts: [],
      capabilityBindings: [{ requirementKey: 'text.primary', bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1' }],
      signal: controller.signal,
    })
    expect(result.passedGateIds).toEqual(p1Task().acceptanceGateIds)
    expect(result.usage.modelCalls).toBeGreaterThan(0)
    expect(result.usage.modelCalls).toBeLessThanOrEqual(2)
    const manifest = result.artifacts.find(item => item.artifactKey === 'text-open-world.source-manifest')!
      .payload as TextOpenWorldSourceManifestV1
    const ledger = result.artifacts.find(item => item.artifactKey === 'text-open-world.source-ledger')!
      .payload as TextOpenWorldSourceLedgerV1
    const gapReport = result.artifacts.find(item => item.artifactKey === 'text-open-world.source-gap-report')!
      .payload as TextOpenWorldSourceGapReportV1
    expect(manifest.readUnitCount).toBeGreaterThan(0)
    expect(manifest.unreadUnitCount).toBeGreaterThan(0)
    expect(manifest.units.filter(unit => unit.curationStatus === 'unread').every(unit => (
      unit.modelBatchKey === null && unit.deliveryEvidenceHash === null
    ))).toBe(true)
    expect(ledger.entries.length).toBeGreaterThan(0)
    expect(ledger.entries.every(entry => entry.evidence.every(anchor => (
      manifest.units.find(unit => unit.unitKey === anchor.unitKey)?.curationStatus === 'read'
    )))).toBe(true)
    expect(gapReport.gaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unread-source', status: 'open' }),
    ]))
    const readContents = new Map(fixture.bundle.units.flatMap(item => (
      item.payload.contentText && manifest.units.find(unit => unit.unitKey === item.payload.unitKey)?.curationStatus === 'read'
        ? [[item.payload.unitKey, item.payload.contentText] as const]
        : []
    )))
    await expect(validateTextOpenWorldSourceCurationArtifactsV1({
      bundle: fixture.bundle, artifacts: { manifest, ledger, gapReport }, readContents,
    })).resolves.toMatchObject({
      manifest: { sourcePinHash: fixture.bundle.pin.pinHash },
      ledger: { sourceManifestHash: manifest.manifestHash },
      gapReport: { sourceLedgerHash: ledger.ledgerHash },
    })
  }, 30_000)

  it('注册来源未选择单元时只返回Pin边界，不把整本小说正文隐式送入模型', async () => {
    const fixture = await seedNovelFixture()
    const indexOnly = JSON.parse(await readTextOpenWorldSourcePinContextV1({
      projectId: fixture.scope.projectId,
      scope: fixture.scope,
      productBuildId: fixture.buildId,
    })) as { selectedUnits: unknown[]; totalUnitCount: number }
    expect(indexOnly.selectedUnits).toEqual([])
    expect(indexOnly.totalUnitCount).toBe(fixture.bundle.units.length)
    expect(JSON.stringify(indexOnly)).not.toContain('巡井人走入干涸盐渠')
  }, 30_000)

  it('WorldRelease只经冻结引用和Context Gateway完整读取，并生成可复验的逐字证据', async () => {
    const fixture = await seedWorldFixture()
    const task = p1Task()
    task.budgetReservation.inputTokens = 100_000
    const executor = createTextOpenWorldSourceCurationExecutorV1({
      runModel: groundedRunner(),
      now: () => fixture.now + 1,
    })
    const result = await executor({
      scope: fixture.scope, productionId: fixture.productionId, buildId: fixture.buildId,
      buildNumber: 1, controlEpoch: 1, planHash: HASH, task, attempt: 1,
      idempotencyKey: await hashProductProductionValueV2('world-curation'), contextText: '', inputArtifacts: [],
      capabilityBindings: [{ requirementKey: 'text.primary', bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1' }],
      signal: new AbortController().signal,
    })
    const manifest = result.artifacts.find(item => item.artifactKey === 'text-open-world.source-manifest')!
      .payload as TextOpenWorldSourceManifestV1
    const ledger = result.artifacts.find(item => item.artifactKey === 'text-open-world.source-ledger')!
      .payload as TextOpenWorldSourceLedgerV1
    const gapReport = result.artifacts.find(item => item.artifactKey === 'text-open-world.source-gap-report')!
      .payload as TextOpenWorldSourceGapReportV1
    expect(manifest.sourceKind).toBe('world-release')
    expect(manifest.readUnitCount).toBe(fixture.selectedResourceKeys.length)
    expect(manifest.unreadUnitCount).toBe(0)
    expect(manifest.units.every(unit => unit.curationDepth === 'full'
      && unit.sourceResourceKey !== null
      && unit.deliveredContentHash === unit.sourceContentHash
      && unit.deliveryEvidenceHash !== null)).toBe(true)
    expect(ledger.entries.length).toBeGreaterThan(0)
    expect(gapReport.gaps.some(gap => gap.kind === 'unread-source')).toBe(false)
    await expect(validateTextOpenWorldSourceCurationArtifactsV1({
      bundle: fixture.bundle,
      artifacts: { manifest, ledger, gapReport },
    })).resolves.toMatchObject({ manifest: { sourceKind: 'world-release' } })
  }, 30_000)

  it('拒绝模型用错误偏移或伪造引文冒充已读证据', async () => {
    const fixture = await seedNovelFixture()
    const executor = createTextOpenWorldSourceCurationExecutorV1({
      runModel: groundedRunner({ corruptQuote: true }), now: () => fixture.now + 1,
    })
    await expect(executor({
      scope: fixture.scope, productionId: fixture.productionId, buildId: fixture.buildId,
      buildNumber: 1, controlEpoch: 1, planHash: HASH, task: p1Task(), attempt: 1,
      idempotencyKey: await hashProductProductionValueV2('negative'), contextText: '', inputArtifacts: [],
      capabilityBindings: [{ requirementKey: 'text.primary', bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1' }],
      signal: new AbortController().signal,
    })).rejects.toThrow(/未读单元或非逐字证据/)
  }, 30_000)
})
