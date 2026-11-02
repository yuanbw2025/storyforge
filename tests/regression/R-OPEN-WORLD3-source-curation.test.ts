import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { AICompletionResponseErrorV1 } from '../../src/lib/ai/completion-response'
import { ConfiguredProductionTextCallErrorV1 } from '../../src/lib/product-production/capabilities'
import * as productionCapabilities from '../../src/lib/product-production/capabilities'
import { AIError } from '../../src/lib/types'
import {
  createTextOpenWorldSourceCurationExecutorV1,
  readTextOpenWorldSourcePinContextV1,
  validateTextOpenWorldSourceCurationArtifactsV1,
  type TextOpenWorldSourceCurationModelRunnerV1,
} from '../../src/lib/open-world/source-curation'
import {
  acceptTextOpenWorldSourcePinBundleV1,
  freezeTextOpenWorldWorldReleaseSourceV1,
} from '../../src/lib/open-world/source-pin'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import type {
  StoryCore,
  ProductProductionPlanTaskV3,
  TextOpenWorldSourceGapReportV1,
  TextOpenWorldSourceLedgerV1,
  TextOpenWorldSourceManifestV1,
} from '../../src/lib/types'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { seedAuthorizedTextOpenWorldCreatorBuildV1 } from '../helpers/text-open-world-creator-build'

const HASH = 'a'.repeat(64)
const CAPABILITY_HASH = 'b'.repeat(64)

async function seedWorldFixture(theme?: string, large = false) {
  const created = await seedCurrentProductWorld(`TOW P1 WorldRelease ${crypto.randomUUID()}`, {
    characterDetails: large ? { background: `巡井人走入干涸盐渠。${'他沿着契约刻痕前进。'.repeat(22_000)}` } : undefined,
  })
  let release = created.release
  if (theme) {
    const core = (await readOwnedRows<StoryCore>(created.scope, 'storyCores', { owner: 'work' }))[0]!
    await db.storyCores.update(core.id!, { theme: theme.normalize('NFC') })
    const revision = await createWorldRevision({ scope: created.scope, label: 'P1 Unicode evidence World' })
    release = await publishWorldRevision(revision.id!)
  }
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: release.id!,
    expectedProjectId: created.scope.projectId,
    expectedWorldId: created.scope.worldId,
  })
  const build = await seedAuthorizedTextOpenWorldCreatorBuildV1({
    source: {
      kind: 'world-release',
      scope: created.scope,
      localReleaseRecordId: release.id!,
      expectedReleaseHash: release.contentHash,
    },
    sessionKey: `curation-world-${crypto.randomUUID()}`,
  })
  const selectedResourceKeys = catalog.resources.map(item => item.resourceKey)
  const capturedAt = Math.max(Date.now(), build.start.authorizedAt)
  const bundle = await freezeTextOpenWorldWorldReleaseSourceV1({
    scope: created.scope,
    localReleaseRecordId: release.id!,
    expectedReleaseHash: release.contentHash,
    selection: { mode: 'entire-release' },
    authorization: build.authorization,
    createdAt: capturedAt,
  })
  await acceptTextOpenWorldSourcePinBundleV1({
    scope: created.scope,
    buildId: build.buildId,
    controlEpoch: build.controlEpoch,
    bundle,
  })
  return { ...created, release, ...build, bundle, selectedResourceKeys, now: capturedAt }
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

  it.each([
    ['exact', null],
    ['missing', /未读单元或非逐字证据/],
    ['ambiguous', /引文在来源单元中不唯一/],
    ['unread', /未读单元或非逐字证据/],
    ['offsets', /字段不精确/],
    ['fractional-confidence', /不是 0-100 整数/],
    ['combined-coverage', /coverageTags\[0\] 枚举无效/],
    ['spliced-quote', /未读单元或非逐字证据/],
    ['extra-character', /未读单元或非逐字证据/],
    ['provider-empty', /没有可用的回答文本/],
    ['provider-transient', /暂时不可用/],
  ] as const)('V2逐字引文由系统定位，保留Unicode并拒绝无效证据：%s', async (mode, error) => {
    const fixture = await seedWorldFixture('🌊 序 e\u0301 共同维护潮门；共同维护潮门；唯一证据。')
    // The author-sealed World fixture contains NFC text with the same
    // leading-space and astral-prefix evidence cases as the legacy codec.
    const exactQuote = ' é 共同维护潮门'
    let selectedContent = ''
    const executor = createTextOpenWorldSourceCurationExecutorV1({
      now: () => fixture.now + 1,
      runModel: async input => {
        if (mode === 'provider-empty' || mode === 'provider-transient') throw new ConfiguredProductionTextCallErrorV1({
          kind: 'response-observed', responseStatus: mode === 'provider-empty' ? 200 : 503,
          usage: { inputTokens: 6647, outputTokens: 2122 },
        }, mode === 'provider-empty'
          ? new AICompletionResponseErrorV1('empty', 'finish=length; reasoning=true')
          : new AIError(503, '暂时不可用'))
        const context = JSON.parse(input.contextText) as {
          selectedUnits?: Array<{ unitKey: string; content: string }>
          units?: Array<{ unitKey: string; content: string }>
        }
        const units = context.selectedUnits ?? context.units ?? []
        const selected = units.find(unit => unit.content.includes(exactQuote))!
        selectedContent = selected.content
        const quote = mode === 'missing' ? '未提供的来源证据'
          : mode === 'ambiguous' ? '共同维护潮门'
            : mode === 'spliced-quote' ? '共同维护...潮门'
              : mode === 'extra-character' ? exactQuote.replace('潮门', '潮水门') : exactQuote
        return {
          output: JSON.stringify({
            schema: 'storyforge.text-open-world-source-curation-draft', version: 2,
            unitKeys: units.map(unit => unit.unitKey),
            claims: [{
              claimKind: 'theme', canonicalName: '共同维护', statement: '共同维护潮门是来源主题。',
              entityKeys: [], coverageTags: mode === 'combined-coverage' ? ['story-core/core-conflict'] : ['story-core'],
              confidence: mode === 'fractional-confidence' ? 0.95 : 95,
              evidence: [{
                unitKey: mode === 'unread' ? 'source.unread' : selected.unitKey, quote,
                ...(mode === 'offsets' ? { start: 0, end: quote.length } : {}),
              }],
            }], gaps: [],
          }),
          bindingReceipt: receipt(input.requirementKey), usage: { inputTokens: 300, outputTokens: 180 },
        }
      },
    })
    const execution = executor({
      scope: fixture.scope, productionId: fixture.productionId, buildId: fixture.buildId,
      buildNumber: fixture.buildNumber, controlEpoch: fixture.controlEpoch,
      planHash: fixture.planHash, task: p1Task(), authorResolution: null, attempt: 1, idempotencyKey: HASH,
      contextText: '', inputArtifacts: [],
      capabilityBindings: [{ requirementKey: 'text.primary', bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1' }],
      signal: new AbortController().signal,
    })
    if (error) {
      await expect(execution).rejects.toThrow(error)
      await expect(execution).rejects.toMatchObject({
        name: mode === 'provider-empty'
          ? 'ProductProductionDraftRejectedErrorV1' : 'ProductProductionRetryableExecutionErrorV1',
        usage: { modelCalls: 1, ...(mode.startsWith('provider-') ? { inputTokens: 6647, outputTokens: 2122 } : {}) },
      })
    } else {
      const result = await execution
      const ledger = result.artifacts.find(item => item.artifactKey === 'text-open-world.source-ledger')!
        .payload as TextOpenWorldSourceLedgerV1
      const anchor = ledger.entries[0]!.evidence[0]!
      expect(anchor.quote).toBe(exactQuote)
      expect(anchor.start).toBeGreaterThan(0)
      expect(selectedContent.slice(anchor.start, anchor.end)).toBe(exactQuote)
      expect(anchor.end - anchor.start).toBe(exactQuote.length)
      expect(result.usage.modelCalls).toBe(1)
    }
  }, 30_000)

  it.each(['modelCalls', 'inputTokens', 'outputTokens'] as const)(
    'P1 剩余 %s 不足时明确记录零新增调用，不以未知用量占满预留', async exhaustedBudget => {
      const fixture = await seedWorldFixture()
      const task = p1Task()
      const runModel = vi.fn(groundedRunner())
      const executor = createTextOpenWorldSourceCurationExecutorV1({ runModel, now: () => fixture.now + 1 })
      await expect(executor({
        scope: fixture.scope, productionId: fixture.productionId, buildId: fixture.buildId,
        buildNumber: fixture.buildNumber, controlEpoch: fixture.controlEpoch,
        planHash: fixture.planHash, task, authorResolution: null, attempt: 2,
        attemptBudgetReservation: { ...task.budgetReservation, [exhaustedBudget]: 0 },
        idempotencyKey: HASH, contextText: '', inputArtifacts: [],
        capabilityBindings: [{ requirementKey: 'text.primary', bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1' }],
        signal: new AbortController().signal,
      })).rejects.toMatchObject({
        name: 'ProductProductionDraftRejectedErrorV1',
        usage: { modelCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0, storageBytes: 0 },
      })
      expect(runModel).not.toHaveBeenCalled()
    }, 30_000,
  )

  it('P1 默认执行器把非思考 JSON 提取及冻结批次预算传入正式能力边界', async () => {
    const fixture = await seedWorldFixture()
    const controller = new AbortController()
    const capability = vi.spyOn(productionCapabilities, 'runConfiguredProductionTextWithOutcomeV1')
      .mockRejectedValue(new Error('adapter-probe'))
    try {
      const executor = createTextOpenWorldSourceCurationExecutorV1({ now: () => fixture.now + 1 })
      await expect(executor({
        scope: fixture.scope, productionId: fixture.productionId, buildId: fixture.buildId,
        buildNumber: fixture.buildNumber, controlEpoch: fixture.controlEpoch,
        planHash: fixture.planHash, task: p1Task(), authorResolution: null, attempt: 1,
        idempotencyKey: HASH, contextText: '', inputArtifacts: [],
        capabilityBindings: [{ requirementKey: 'text.primary', bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1' }],
        signal: controller.signal,
      })).rejects.toThrow('adapter-probe')
      expect(capability).toHaveBeenCalledTimes(1)
      expect(capability.mock.calls[0]![0]).toMatchObject({
        category: 'text-open-world.production.source-curation',
        expectedCapabilityHash: CAPABILITY_HASH,
        responseFormat: 'json_object', thinkingMode: 'disabled', signal: controller.signal,
      })
      const budget = capability.mock.calls[0]![0].maximumOutputTokens
      expect(Number.isInteger(budget)).toBe(true)
      expect(budget).toBeGreaterThan(0)
      expect(budget).toBeLessThanOrEqual(p1Task().budgetReservation.outputTokens)
    } finally {
      capability.mockRestore()
    }
  }, 30_000)

  it('分批读取冻结世界，逐字证据进入Ledger，未读大资源只能进入显式缺口', async () => {
    const fixture = await seedWorldFixture(undefined, true)
    const controller = new AbortController()
    const executor = createTextOpenWorldSourceCurationExecutorV1({
      runModel: groundedRunner(), now: () => fixture.now + 1,
    })
    const result = await executor({
      scope: fixture.scope, productionId: fixture.productionId, buildId: fixture.buildId,
      buildNumber: fixture.buildNumber, controlEpoch: fixture.controlEpoch,
      planHash: fixture.planHash, task: p1Task(), authorResolution: null, attempt: 1,
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
    await expect(validateTextOpenWorldSourceCurationArtifactsV1({
      bundle: fixture.bundle, artifacts: { manifest, ledger, gapReport },
    })).resolves.toMatchObject({
      manifest: { sourcePinHash: fixture.bundle.pin.pinHash },
      ledger: { sourceManifestHash: manifest.manifestHash },
      gapReport: { sourceLedgerHash: ledger.ledgerHash },
    })
  }, 30_000)

  it('注册来源未选择单元时只返回Pin边界，不把世界原文隐式送入模型', async () => {
    const fixture = await seedWorldFixture()
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
    const fixture = await seedWorldFixture(undefined, false)
    const task = p1Task()
    task.budgetReservation.inputTokens = 100_000
    const executor = createTextOpenWorldSourceCurationExecutorV1({
      runModel: groundedRunner(),
      now: () => fixture.now + 1,
    })
    const result = await executor({
      scope: fixture.scope, productionId: fixture.productionId, buildId: fixture.buildId,
      buildNumber: fixture.buildNumber, controlEpoch: fixture.controlEpoch,
      planHash: fixture.planHash, task, authorResolution: null, attempt: 1,
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
    const fixture = await seedWorldFixture()
    const executor = createTextOpenWorldSourceCurationExecutorV1({
      runModel: groundedRunner({ corruptQuote: true }), now: () => fixture.now + 1,
    })
    await expect(executor({
      scope: fixture.scope, productionId: fixture.productionId, buildId: fixture.buildId,
      buildNumber: fixture.buildNumber, controlEpoch: fixture.controlEpoch,
      planHash: fixture.planHash, task: p1Task(), authorResolution: null, attempt: 1,
      idempotencyKey: await hashProductProductionValueV2('negative'), contextText: '', inputArtifacts: [],
      capabilityBindings: [{ requirementKey: 'text.primary', bindingHash: CAPABILITY_HASH, adapterId: 'configured-text.v1' }],
      signal: new AbortController().signal,
    })).rejects.toThrow(/未读单元或非逐字证据/)
  }, 30_000)
})
