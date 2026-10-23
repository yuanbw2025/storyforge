import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProductBuildRootTerminalReceiptV1, createLegacyProductBuildRootTerminalReceiptV1 } from '../../src/lib/product-production/receipts'
import { parseProductBuildRootBudgetEvidenceV1 } from '../../src/lib/product-production/root-budget-evidence'
import type { TextOpenWorldCreatorDerivedBuildAuthorityV1 } from '../../src/lib/open-world/creator-derived-authority'
import type { ProductBuildTerminalCasReadSetV1 } from '../../src/lib/product-production/artifact-store'
import {
  assertTextOpenWorldCalibrationLineageUnchangedV1,
  projectTextOpenWorldCalibrationUsageV1,
  readTextOpenWorldCalibrationLineageV1,
  textOpenWorldCalibrationLineageChecksV1,
} from '../../src/lib/open-world/creator-calibration-usage'

const mocks = vi.hoisted(() => ({
  authorities: new Map<number, unknown>(),
  derived: vi.fn(),
  terminal: vi.fn(),
  prefix: vi.fn(),
  seal: vi.fn(),
  cas: vi.fn(),
}))
vi.mock('../../src/lib/open-world/creator-derived-authority', () => ({
  readTextOpenWorldCreatorDerivedBuildAuthorityV1: mocks.derived,
}))
vi.mock('../../src/lib/product-production/artifact-store', async original => ({
  ...await original<typeof import('../../src/lib/product-production/artifact-store')>(),
  verifyProductBuildTerminalArtifactSetV1: mocks.terminal,
  verifyTextOpenWorldBudgetRecoveryPrefixV1: mocks.prefix,
  assertProductBuildTerminalReadSetUnchangedV1: mocks.cas,
}))
vi.mock('../../src/lib/product-production/root-budget-evidence-store', () => ({
  verifyStoredProductBuildRootBudgetEvidenceV1: mocks.seal,
}))

const HASH = 'a'.repeat(64)
const SCOPE = { projectId: 51, worldId: 52, workId: 53 }
function attempt(runId: number, modelCalls = 1) {
  return {
    controlEpoch: 1, taskKey: 'p9.scene-scripts', runId, attempt: 1,
    idempotencyKey: HASH, outcome: 'settled', errorCode: null, usageKnown: true,
    usage: { modelCalls, inputTokens: modelCalls * 100, outputTokens: modelCalls * 10,
      durationMs: modelCalls * 20, mediaCalls: 0, costUsd: null, storageBytes: 0 },
  }
}
function authority(id: number, origin: TextOpenWorldCreatorDerivedBuildAuthorityV1['origin'],
  attempts: unknown[] = [], parent?: TextOpenWorldCreatorDerivedBuildAuthorityV1) {
  const value = {
    origin, production: { id: 71 },
    build: { id, buildNumber: id, productionId: 71, briefHash: HASH, planHash: HASH,
      controlEpoch: 1, status: 'preview-ready', rootTerminalReceiptHash: HASH,
      rootBudgetEvidenceJson: 'stored preimage verified by adapter',
      manifestHash: HASH, packageHash: HASH, qualityReportHash: HASH,
      parentBuildNumber: parent?.build.buildNumber ?? null,
      budgetLedgerJson: JSON.stringify({ schema: 'storyforge.product-production-budget-ledger', version: 2,
        rootRunId: id * 100, rootClaim: null, tasks: {}, attempts }) },
    contracts: {
      start: { preflight: { priceQuote: { quoteHash: HASH, source: 'storyforge-catalog', asOf: '2026-10-21',
        inputUsdPerMillionTokens: 1, outputUsdPerMillionTokens: 2 } } },
      executionBrief: { productionBudget: { maximumModelCalls: 10, maximumInputTokens: 1000,
        maximumOutputTokens: 1000, maximumDurationMs: 1000, maximumCostUsd: 1 } },
    },
    commandChain: [],
    repair: origin === 'creator-repair-v1' ? { sourceBuild: parent?.build } : null,
    media: origin === 'creator-media-v1' ? { sourceBuild: parent?.build } : null,
    budgetRecovery: origin === 'creator-budget-recovery-v1' ? { source: parent } : undefined,
  } as unknown as TextOpenWorldCreatorDerivedBuildAuthorityV1
  mocks.authorities.set(id, value)
  return value
}
function proof(buildId: number) {
  const derived = mocks.authorities.get(buildId) as TextOpenWorldCreatorDerivedBuildAuthorityV1
  return { artifacts: [], casReadSet: {
    targetBuildId: buildId, buildRows: [structuredClone(derived.build)],
  } as ProductBuildTerminalCasReadSetV1 }
}
const read = (buildId: number) => readTextOpenWorldCalibrationLineageV1({
  scope: SCOPE, productionId: 71, buildId,
})

describe('G7-11 制作来源用量（验真适配器边界，不冒充模型证据）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authorities.clear()
    mocks.derived.mockImplementation(async ({ buildId }) => mocks.authorities.get(buildId))
    mocks.terminal.mockImplementation(async ({ buildId }) => proof(buildId))
    mocks.prefix.mockImplementation(async ({ buildId }) => ({ ...proof(buildId), prefixHash: 'b'.repeat(64) }))
    mocks.seal.mockResolvedValue(undefined)
    mocks.cas.mockResolvedValue(undefined)
  })

  it('零调用媒资子版本继承真实制作来源，失败尝试计一次且当前版本仍为零', async () => {
    const root = authority(1, 'creator-start-v1', [
      attempt(101, 2), { ...attempt(102), outcome: 'failed', errorCode: 'provider-output-invalid' },
    ])
    const child = authority(2, 'creator-media-v1', [], root)
    const before = JSON.stringify([root, child])
    const lineage = await read(2)
    expect(lineage.sources.map(source => [source.buildNumber, source.observedModelCalls])).toEqual([[1, 3], [2, 0]])
    expect(lineage.sources[1].usage.modelCalls).toBe(0)
    expect(textOpenWorldCalibrationLineageChecksV1(lineage.sources).every(check => check.passed)).toBe(true)
    expect(mocks.terminal).toHaveBeenCalledTimes(2)
    expect(mocks.seal).toHaveBeenCalledTimes(2)
    expect(JSON.stringify([root, child])).toBe(before)
    await assertTextOpenWorldCalibrationLineageUnchangedV1(lineage)
    expect(mocks.cas.mock.calls.map(([input]) => input.readSet.targetBuildId)).toEqual([2, 1])
  })

  it('历史完整v2封存缺少后来新增的可选原像时，只在内存验证且仍核对全部Run归属', async () => {
    const root = authority(1, 'creator-start-v1', [attempt(101)])
    delete root.build.rootBudgetEvidenceJson
    root.build.rootTerminalReceiptHash = await createProductBuildRootTerminalReceiptV1({
      ...root.build, artifacts: [],
    })
    const before = JSON.stringify(root.build)
    const lineage = await read(1)
    expect(mocks.terminal).toHaveBeenCalledOnce()
    expect(mocks.seal).toHaveBeenCalledOnce()
    const verifiedBuild = mocks.seal.mock.calls[0][0].build
    expect(verifiedBuild).not.toBe(root.build)
    const evidence = parseProductBuildRootBudgetEvidenceV1(verifiedBuild.rootBudgetEvidenceJson)
    expect(evidence.rootTerminalReceiptHash).toBe(root.build.rootTerminalReceiptHash)
    expect(JSON.parse(evidence.budgetLedgerJson)).toEqual(JSON.parse(root.build.budgetLedgerJson))
    expect(JSON.stringify(root.build)).toBe(before)
    expect(lineage.readSets[0].buildRows[0].rootBudgetEvidenceJson).toBeUndefined()
    expect(lineage.sources[0].observedModelCalls).toBe(1)
    mocks.seal.mockRejectedValueOnce(new Error('wrong current Run owner'))
    await expect(read(1)).rejects.toThrow('wrong current Run owner')
    expect(JSON.stringify(root.build)).toBe(before)
  })

  it.each(['changed-usage', 'remapped-run', 'legacy-v1'] as const)(
    '缺少原像时不能补造%s的封存证明', async problem => {
      const root = authority(1, 'creator-start-v1', [attempt(101)])
      delete root.build.rootBudgetEvidenceJson
      const receiptInput = { ...root.build, artifacts: [] }
      root.build.rootTerminalReceiptHash = problem === 'legacy-v1'
        ? await createLegacyProductBuildRootTerminalReceiptV1(receiptInput)
        : await createProductBuildRootTerminalReceiptV1(receiptInput)
      if (problem !== 'legacy-v1') {
        const ledger = JSON.parse(root.build.budgetLedgerJson)
        if (problem === 'changed-usage') ledger.attempts[0].usage.outputTokens++
        else ledger.attempts[0].runId = 901
        root.build.budgetLedgerJson = JSON.stringify(ledger)
      }
      const before = JSON.stringify(root.build)
      await expect(read(1)).rejects.toThrow('不能补造证据')
      expect(mocks.seal).not.toHaveBeenCalled()
      expect(JSON.stringify(root.build)).toBe(before)
    },
  )

  it('预算续建只接受正式已完成前缀，经过repair/media仍不重复计来源', async () => {
    const root = authority(1, 'creator-start-v1', [attempt(101)])
    root.build.status = 'recovery-required'
    const recovery = authority(2, 'creator-budget-recovery-v1', [attempt(201)], root)
    const repair = authority(3, 'creator-repair-v1', [attempt(301)], recovery)
    authority(4, 'creator-media-v1', [], repair)
    const lineage = await read(4)
    expect(lineage.sources.map(source => source.observedModelCalls)).toEqual([1, 1, 1, 0])
    expect(lineage.sources[0].proofHash).toBe('b'.repeat(64))
    expect(mocks.prefix).toHaveBeenCalledTimes(1)
    expect(mocks.prefix).toHaveBeenCalledWith(expect.objectContaining({ buildId: 1 }))
    expect(mocks.seal).toHaveBeenCalledTimes(3)
  })

  it('同一Run的真实重试分别计入用量，不能误判为跨Build重复归属', async () => {
    const root = authority(1, 'creator-start-v1', [
      { ...attempt(101, 2), outcome: 'failed', errorCode: 'provider-output-invalid' },
      { ...attempt(101), attempt: 2 },
    ])
    authority(2, 'creator-media-v1', [], root)
    const lineage = await read(2)
    expect(lineage.sources.map(source => source.observedModelCalls)).toEqual([3, 0])
    expect(lineage.sources[0].observedInputTokens).toBe(300)
    expect(lineage.sources[0].observedOutputTokens).toBe(30)
    expect(textOpenWorldCalibrationLineageChecksV1(lineage.sources).every(check => check.passed)).toBe(true)
    const projected = await projectTextOpenWorldCalibrationUsageV1({ derived: root, proofHash: HASH })
    expect(projected.chargedRunIds).toEqual([101])
  })

  it('同一Run同一轮次同一attempt被重复记录时仍拒绝', async () => {
    authority(1, 'creator-start-v1', [attempt(101), attempt(101)])
    await expect(read(1)).rejects.toThrow('attempts 身份重复')
  })

  it('重新确认的新Brief从新Start开始，不把旧作品草稿或旧失败Build摊入', async () => {
    const old = authority(1, 'creator-start-v1', [attempt(101, 9)])
    old.build.briefHash = 'c'.repeat(64)
    authority(2, 'creator-start-v1', [attempt(201)], old)
    const lineage = await read(2)
    expect(lineage.sources.map(source => source.buildNumber)).toEqual([2])
    expect(mocks.derived).toHaveBeenCalledTimes(1)
  })

  it.each(['unknown', 'upper-bound'] as const)('保留%s占用但不把它算作实测调用', async kind => {
    const uncertain = { ...attempt(102, 2),
      ...(kind === 'unknown' ? { usageKnown: false } : { resolution: 'author-charged-reservation-upper-bound' }) }
    const root = authority(1, 'creator-start-v1', [attempt(101), uncertain])
    const { source } = await projectTextOpenWorldCalibrationUsageV1({ derived: root, proofHash: HASH })
    expect(source.usage.modelCalls).toBe(3)
    expect(source.observedModelCalls).toBe(1)
    expect(textOpenWorldCalibrationLineageChecksV1([source])[0].passed).toBe(false)
  })

  it('一个版本超额不能借用另一个版本的剩余额度掩盖', async () => {
    const root = authority(1, 'creator-start-v1', [attempt(101, 11)])
    authority(2, 'creator-media-v1', [], root)
    const lineage = await read(2)
    expect(textOpenWorldCalibrationLineageChecksV1(lineage.sources)[1].passed).toBe(false)
  })

  it.each(['scope', 'brief', 'parent', 'duplicate-run'] as const)('拒绝%s来源污染', async problem => {
    const root = authority(1, 'creator-start-v1', [attempt(101)])
    const child = authority(2, 'creator-media-v1', problem === 'duplicate-run' ? [attempt(101)] : [], root)
    if (problem === 'scope') root.build.productionId = 999
    if (problem === 'brief') root.build.briefHash = 'b'.repeat(64)
    if (problem === 'parent') child.build.parentBuildNumber = 999
    await expect(read(2)).rejects.toThrow()
  })

  it('封存证明失败、来源读取期间变化或写入期间变化均停止，不能仅信累计数值', async () => {
    authority(1, 'creator-start-v1', [attempt(101)])
    mocks.seal.mockRejectedValueOnce(new Error('root seal mismatch'))
    await expect(read(1)).rejects.toThrow('root seal mismatch')
    mocks.terminal.mockImplementationOnce(async () => {
      const result = proof(1)
      result.casReadSet.buildRows[0].stateRevision = 999
      return result
    })
    await expect(read(1)).rejects.toThrow('验真期间已变化')
    const lineage = await read(1)
    mocks.cas.mockRejectedValueOnce(new Error('terminal CAS Run events/checkpoints 已变化'))
    await expect(assertTextOpenWorldCalibrationLineageUnchangedV1(lineage)).rejects.toThrow('terminal CAS')
  })

  it('同一封存账本重新定位Run不会改变可移植统计指纹，费用和实际用量变化仍改变指纹', async () => {
    const root = authority(1, 'creator-start-v1', [attempt(101)])
    const first = await projectTextOpenWorldCalibrationUsageV1({ derived: root, proofHash: HASH })
    const ledger = JSON.parse(root.build.budgetLedgerJson)
    ledger.attempts[0].runId = 987
    root.build.budgetLedgerJson = JSON.stringify(ledger)
    const remapped = await projectTextOpenWorldCalibrationUsageV1({ derived: root, proofHash: HASH })
    expect(remapped.source).toEqual(first.source)
    ledger.attempts[0].usage.outputTokens++
    root.build.budgetLedgerJson = JSON.stringify(ledger)
    const changed = await projectTextOpenWorldCalibrationUsageV1({ derived: root, proofHash: HASH })
    expect(changed.source.usage.ledgerHash).not.toBe(first.source.usage.ledgerHash)
  })
})
