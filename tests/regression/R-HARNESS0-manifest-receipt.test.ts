import { describe, expect, it } from 'vitest'
import {
  createContextManifestFromAssemblyV1,
  parseContextManifestV1,
  verifyContextManifestIntegrityV1,
} from '../../src/lib/agent/run/context-manifest'
import {
  createVerificationReceiptV1,
  isVerificationReceiptFreshV1,
  parseVerificationReceiptV1,
  verifyVerificationReceiptIntegrityV1,
} from '../../src/lib/agent/run/verification-receipt'
import type { AssembleContextResult } from '../../src/lib/registry/types'

const CONTRACT_HASH = 'a'.repeat(64)
const POST_STATE_HASH = 'b'.repeat(64)
const CANDIDATE_HASH = 'c'.repeat(64)

function assembled(): AssembleContextResult {
  return {
    text: '【世界观】潮汐决定城市迁徙。',
    segments: [
      {
        label: '世界观',
        layer: 'L1',
        content: '【世界观】潮汐决定城市迁徙。',
        tokens: 14,
        trimmable: true,
      },
    ],
    included: ['worldview'],
    omitted: ['storyCore'],
    trimmed: ['characters'],
    totalInputTokens: 14,
    inputBudget: 4_000,
    overBudgetBeforeTrim: true,
    overBudgetAfterTrim: false,
  }
}

describe('R-HARNESS0-manifest-receipt · 输入与完成证据', () => {
  it('从真实 assembleContext 结果生成不复制全文的 Context Manifest', async () => {
    const manifest = await createContextManifestFromAssemblyV1({
      runId: 9,
      stepId: 'outline.generate',
      attempt: 1,
      projectId: 7,
      worldGroupId: null,
      declaredSourceKeys: ['worldview', 'storyCore', 'characters'],
      assembled: assembled(),
      boundary: { outlineNodeId: 12 },
      readerVersion: 'assemble-context-v1',
    })

    expect(manifest.sources).toMatchObject([
      { key: 'worldview', status: 'included', tokens: 14 },
      { key: 'storyCore', status: 'omitted', tokens: 0 },
      { key: 'characters', status: 'trimmed', tokens: 0 },
    ])
    expect(manifest.sources[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(manifest)).not.toContain('潮汐决定城市迁徙')
    expect(await verifyContextManifestIntegrityV1(manifest)).toBe(true)
  })

  it('拒绝装配旁路、token 伪报和 omitted 内容伪装', async () => {
    await expect(createContextManifestFromAssemblyV1({
      runId: 9,
      stepId: 'outline.generate',
      attempt: 1,
      projectId: 7,
      worldGroupId: null,
      declaredSourceKeys: ['storyCore', 'characters'],
      assembled: assembled(),
    })).rejects.toThrow('装配结果包含未授权来源 worldview')

    const manifest = await createContextManifestFromAssemblyV1({
      runId: 9,
      stepId: 'outline.generate',
      attempt: 1,
      projectId: 7,
      worldGroupId: null,
      declaredSourceKeys: ['worldview', 'storyCore', 'characters'],
      assembled: assembled(),
    })
    expect(() => parseContextManifestV1({ ...manifest, totalInputTokens: 99 })).toThrow('来源合计为 14')
    expect(() => parseContextManifestV1({
      ...manifest,
      sources: manifest.sources.map(source => source.key === 'storyCore'
        ? { ...source, contentHash: 'd'.repeat(64) }
        : source),
    })).toThrow('omitted 来源没有实际模型输入')
  })

  it('Manifest 任一绑定字段变化都会使完整性校验失败', async () => {
    const manifest = await createContextManifestFromAssemblyV1({
      runId: 9,
      stepId: 'outline.generate',
      attempt: 1,
      projectId: 7,
      worldGroupId: null,
      declaredSourceKeys: ['worldview', 'storyCore', 'characters'],
      assembled: assembled(),
    })
    const tampered = {
      ...manifest,
      sources: manifest.sources.map(source => source.key === 'worldview'
        ? { ...source, contentHash: 'e'.repeat(64) }
        : source),
    }

    expect(await verifyContextManifestIntegrityV1(tampered)).toBe(false)
  })

  it('accepted receipt 只允许全通过标准，并绑定所有新鲜度输入', async () => {
    const manifestHash = 'd'.repeat(64)
    const receipt = await createVerificationReceiptV1({
      version: 1,
      runId: 9,
      generation: 1,
      contractHash: CONTRACT_HASH,
      contextManifestHashes: [manifestHash],
      candidateHashes: [CANDIDATE_HASH],
      adoptionEventIds: [31],
      postStateHash: POST_STATE_HASH,
      verifierSetVersion: 'terminal-v1',
      lineage: {
        runId: 8,
        receiptHash: '8'.repeat(64),
        relation: 'prose-post-adoption',
        artifactHash: '7'.repeat(64),
      },
      criteria: [
        { id: 'outline.output', status: 'passed', evidenceRefs: ['candidate:c'] },
        { id: 'outline.adoption', status: 'passed', evidenceRefs: ['event:31'] },
      ],
      acceptedAt: 1_786_111_000_000,
    })
    const current = {
      runId: 9,
      generation: 1,
      contractHash: CONTRACT_HASH,
      contextManifestHashes: [manifestHash],
      candidateHashes: [CANDIDATE_HASH],
      adoptionEventIds: [31],
      postStateHash: POST_STATE_HASH,
      verifierSetVersion: 'terminal-v1',
    }

    expect(await verifyVerificationReceiptIntegrityV1(receipt)).toBe(true)
    expect(await verifyVerificationReceiptIntegrityV1({
      ...receipt,
      lineage: { ...receipt.lineage!, receiptHash: '9'.repeat(64) },
    })).toBe(false)
    expect(isVerificationReceiptFreshV1(receipt, current)).toBe(true)
    expect(isVerificationReceiptFreshV1(receipt, { ...current, postStateHash: 'f'.repeat(64) })).toBe(false)
    expect(isVerificationReceiptFreshV1(receipt, { ...current, generation: 2 })).toBe(false)
  })

  it('拒绝 failed 标准和 receipt 篡改', async () => {
    const body = {
      version: 1 as const,
      runId: 9,
      generation: 1,
      contractHash: CONTRACT_HASH,
      contextManifestHashes: ['d'.repeat(64)],
      candidateHashes: [CANDIDATE_HASH],
      adoptionEventIds: [31],
      postStateHash: POST_STATE_HASH,
      verifierSetVersion: 'terminal-v1',
      criteria: [{ id: 'outline.output', status: 'passed' as const, evidenceRefs: ['candidate:c'] }],
      acceptedAt: 1_786_111_000_000,
    }
    const receipt = await createVerificationReceiptV1(body)
    expect(() => parseVerificationReceiptV1({
      ...receipt,
      criteria: [{ id: 'outline.output', status: 'failed', evidenceRefs: ['candidate:c'] }],
    })).toThrow('accepted receipt 不得包含 failed 验收项')
    expect(await verifyVerificationReceiptIntegrityV1({
      ...receipt,
      verifierSetVersion: 'terminal-v2',
    })).toBe(false)
  })
})
