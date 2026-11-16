import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  readLatestTextAdventureHumanVisualReviewGateV1, recordTextAdventureHumanVisualReviewV1,
  requirePassedTextAdventureHumanVisualReviewGateV1, verifyPortableProductQualityGateReceiptV1,
  verifyTextAdventureHumanVisualReviewReceiptV1,
} from '../../src/lib/product-production/quality-receipts'
import { seedTextAdventureMediaRevisionWorkbenchV1 } from '../helpers/text-adventure-media-revision-workbench'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WgWQAAAABJRU5ErkJggg=='
async function ready(rejected = false) {
  const f = await seedTextAdventureMediaRevisionWorkbenchV1(PNG)
  const images = (await db.productBuildArtifacts.where('buildId').equals(f.parentBuildId).toArray())
    .filter(row => row.kind === 'image').sort((a, b) => a.artifactKey.localeCompare(b.artifactKey))
  const decisions = images.map((row, index) => ({
    assetKey: String(JSON.parse(row.metadataJson).assetKey),
    decision: rejected && index === 0 ? 'rejected' as const : 'approved' as const,
    note: rejected && index === 0 ? '修正已经确认的人物视觉身份。' : '作者确认此图可用。',
  }))
  const gate = await recordTextAdventureHumanVisualReviewV1({ scope: f.scope, productBuildId: f.parentBuildId, decisions })
  const binding = { buildNumber: gate.evidence.buildNumber, packageHash: gate.evidence.packageHash,
    previewHash: gate.evidence.previewHash, briefHash: gate.evidence.briefHash, targetPlayMinutes: 20,
    humanVisual: { mediaAuditHash: gate.evidence.mediaAuditHash, visualReviewHash: gate.evidence.visualReviewHash,
      assets: gate.evidence.assets.map(asset => {
        const row = images.find(row => row.artifactKey === asset.artifactKey)
        if (!row?.byteSize) throw new Error('Expected the real frozen image')
        return { ...asset, byteSize: row.byteSize }
      }) } }
  return { ...f, images, decisions, gate, binding }
}

beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No model or external network authorized') }))
})
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled() }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() }
})

describe('SFQA061 complete immutable author-visual receipt integrity', () => {
  it.each(['note', 'decision', 'time', 'binding'] as const)('rejects changed %s under the old hash at every receipt reader', async field => {
    const f = await ready()
    if (!f.gate.row.id) throw new Error('Expected the immutable receipt row')
    const receipt = structuredClone(f.gate.gateReceipt), evidence = structuredClone(f.gate.evidence)
    if (field === 'note') evidence.assets[0].note = '没有经过作者确认的改写意见。'
    if (field === 'decision') { evidence.assets[0].decision = 'rejected'; evidence.passed = false; receipt.status = 'failed' }
    if (field === 'time') { evidence.confirmedAt += 1; receipt.createdAt = evidence.confirmedAt }
    if (field === 'binding') evidence.packageHash = 'f'.repeat(64)
    receipt.measuredJson = canonicalProductProductionJsonV2(evidence)
    const corrupt = { ...f.gate.row, status: receipt.status, createdAt: receipt.createdAt, receiptJson: canonicalProductProductionJsonV2(receipt) }
    await db.productQualityGateReceipts.put(corrupt)
    const input = { scope: f.scope, productBuildId: f.parentBuildId }
    await expect(readLatestTextAdventureHumanVisualReviewGateV1(input)).rejects.toThrow(/receiptHash 校验失败/)
    await expect(verifyTextAdventureHumanVisualReviewReceiptV1({ ...input, receiptHash: f.gate.gateReceipt.receiptHash })).rejects.toThrow(/receiptHash 校验失败/)
    await expect(requirePassedTextAdventureHumanVisualReviewGateV1(input)).rejects.toThrow(/receiptHash 校验失败/)
    await expect(recordTextAdventureHumanVisualReviewV1({ ...input, decisions: f.decisions })).rejects.toThrow(/receiptHash 校验失败/)
    await expect(verifyPortableProductQualityGateReceiptV1({ receipt, binding: f.binding })).rejects.toThrow(/receiptHash 校验失败/)
    expect(await db.productQualityGateReceipts.get(f.gate.row.id)).toEqual(corrupt)
    expect(await db.productQualityGateReceipts.where('buildId').equals(f.parentBuildId).count()).toBe(1)
  })

  it('checks immutable row indexes too, while legitimate approval and rejection stay idempotent', async () => {
    const f = await ready()
    const input = { scope: f.scope, productBuildId: f.parentBuildId }
    expect((await recordTextAdventureHumanVisualReviewV1({ ...input, decisions: f.decisions })).row.id).toBe(f.gate.row.id)
    await expect(verifyPortableProductQualityGateReceiptV1({ receipt: f.gate.gateReceipt, binding: f.binding })).resolves.toMatchObject({ gateReceipt: f.gate.gateReceipt })
    const decisions = f.decisions.map((row, index) => index === 0 ? { ...row, decision: 'rejected' as const, note: '作者要求保留身份后返修。' } : row)
    const rejected = await recordTextAdventureHumanVisualReviewV1({ ...input, decisions })
    expect(rejected.gateReceipt.status).toBe('failed')
    expect((await recordTextAdventureHumanVisualReviewV1({ ...input, decisions })).row.id).toBe(rejected.row.id)
    if (!rejected.row.id) throw new Error('Expected the rejected receipt')
    await db.productQualityGateReceipts.update(rejected.row.id, { createdAt: rejected.row.createdAt + 1 })
    await expect(verifyTextAdventureHumanVisualReviewReceiptV1({ ...input, receiptHash: rejected.row.receiptHash })).rejects.toThrow(/索引字段/)
  })

  it('cannot turn a damaged author note into a successful public repair command or a new Build', async () => {
    const f = await ready(true)
    if (!f.gate.row.id) throw new Error('Expected the original rejected receipt')
    const evidence = structuredClone(f.gate.evidence)
    evidence.assets[0].note = '攻击者后来替换的返修指令。'
    const receipt = { ...f.gate.gateReceipt, measuredJson: canonicalProductProductionJsonV2(evidence) }
    const corrupt = { ...f.gate.row, receiptJson: canonicalProductProductionJsonV2(receipt) }
    await db.productQualityGateReceipts.put(corrupt)
    const production = await db.productProductions.get(f.productionId), target = f.images[0]
    if (!production) throw new Error('Expected the actual production')
    const builds = await db.productBuilds.toArray(), artifacts = await db.productBuildArtifacts.toArray()
    const result = await executeProductProductionCommand({ scope: f.scope, productionId: f.productionId,
      command: { type: 'revise-media-asset', commandId: 'sfqa061.corrupt-repair', expectedStateRevision: production.stateRevision,
        buildNumber: f.parentBuildNumber, artifactKey: target.artifactKey, expectedArtifactHash: target.contentHash,
        action: 'regenerate', replacement: null,
        repairFeedback: { sourceGateReceiptHash: receipt.receiptHash,
          sourceEvidenceHash: await hashProductProductionValueV2(evidence), priorContentHash: target.contentHash, note: evidence.assets[0].note } } })
    expect(result).toMatchObject({ ok: false, errorCode: 'media-revision-invalid' })
    expect(JSON.stringify(result)).toMatch(/receiptHash 校验失败/)
    expect(await db.productBuilds.toArray()).toEqual(builds)
    expect(await db.productBuildArtifacts.toArray()).toEqual(artifacts)
    expect(await db.productQualityGateReceipts.get(f.gate.row.id)).toEqual(corrupt)
  })
})
