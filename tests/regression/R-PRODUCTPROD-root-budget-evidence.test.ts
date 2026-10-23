import { describe, expect, it, vi } from 'vitest'
import { createProductBuildRootTerminalReceiptV1, createLegacyProductBuildRootTerminalReceiptV1 } from '../../src/lib/product-production/receipts'
import { createProductBuildRootBudgetEvidenceV1, verifyProductBuildRootBudgetEvidenceV1,
  type ProductBuildBudgetRunReferenceV1 } from '../../src/lib/product-production/root-budget-evidence'

const h = (c: string) => c.repeat(64)
const usage = { modelCalls: 1, inputTokens: 10, outputTokens: 20, mediaCalls: 0,
  costUsd: 0.1, durationMs: 200, storageBytes: 30 }

async function fixture() {
  const task = { runId: 102, attempt: 1, status: 'settled', idempotencyKey: h('a'),
    candidateHash: h('b'), terminalReceiptHash: h('c'), passedGateIds: ['content.ready'],
    usage, errorCode: null }
  const ledger = { schema: 'storyforge.product-production-budget-ledger', version: 2,
    rootRunId: 101, rootClaim: null, tasks: { p1: task }, attempts: [
      { controlEpoch: 1, taskKey: 'p1', runId: 92, attempt: 1, idempotencyKey: h('d'),
        outcome: 'failed', usage: null, usageKnown: false, errorCode: 'task-result-unknown' },
      { controlEpoch: 2, taskKey: 'p1', runId: 102, attempt: 1, idempotencyKey: h('a'),
        outcome: 'settled', usage, usageKnown: true, errorCode: null },
    ] }
  const input = { planHash: h('1'), manifestHash: h('2'), packageHash: h('3'),
    qualityReportHash: h('4'), controlEpoch: 2, budgetLedgerJson: JSON.stringify(ledger),
    artifacts: [{ artifactKey: 'story', requirementKey: null, version: 1, kind: 'story-architecture' as never,
      mediaKind: null, status: 'accepted' as const, producerReceiptHash: h('c'), controlEpoch: 2,
      inputHash: h('a'), contentHash: h('5'), payloadJson: '{"story":"原文"}',
      metadataJson: '{}', qualityJson: '{}', rightsJson: '{"basis":"author-owned"}',
      blobObjectId: null, mimeType: null, byteSize: 20, parentArtifactHash: null, carriedFrom: null }] }
  const expectedReceiptHash = await createProductBuildRootTerminalReceiptV1(input)
  const evidenceJson = await createProductBuildRootBudgetEvidenceV1({ ...input, expectedReceiptHash })
  return { input, ledger, expectedReceiptHash, evidenceJson }
}

describe('Product Build original root seal portability', () => {
  it('verifies a complete bijective remap while preserving the original receipt', async () => {
    const f = await fixture()
    f.ledger.rootRunId = 5101
    f.ledger.tasks.p1.runId = 5102
    f.ledger.attempts[0].runId = 5092
    f.ledger.attempts[1].runId = 5102
    const verifyCurrentRun = vi.fn(async (_reference: ProductBuildBudgetRunReferenceV1) => {})
    await verifyProductBuildRootBudgetEvidenceV1({ ...f.input,
      budgetLedgerJson: JSON.stringify(f.ledger), expectedReceiptHash: f.expectedReceiptHash,
      evidenceJson: f.evidenceJson, verifyCurrentRun })
    expect(verifyCurrentRun.mock.calls.map(([r]) => r)).toEqual([
      { runId: 5101, taskKey: '$root', controlEpoch: 2 },
      { runId: 5102, taskKey: 'p1', controlEpoch: 2 },
      { runId: 5092, taskKey: 'p1', controlEpoch: 1 },
    ])
  })

  it('cannot promote a legacy v1 seal into full-envelope v2 evidence', async () => {
    const f = await fixture()
    const legacy = await createLegacyProductBuildRootTerminalReceiptV1(f.input)
    await expect(createProductBuildRootBudgetEvidenceV1({ ...f.input, expectedReceiptHash: legacy }))
      .rejects.toThrow(/不能补造证据/)
  })

  it('cannot invent a missing preimage from the already remapped ledger', async () => {
    const f = await fixture()
    f.ledger.rootRunId = 999
    await expect(createProductBuildRootBudgetEvidenceV1({ ...f.input,
      budgetLedgerJson: JSON.stringify(f.ledger), expectedReceiptHash: f.expectedReceiptHash,
    })).rejects.toThrow(/不能补造证据/)
  })

  it.each(['known-cost', 'unknown-hold', 'task-receipt', 'attempt-order', 'claim'])(
    'rejects changed nonlocator budget data: %s', async mutation => {
      const f = await fixture()
      if (mutation === 'known-cost') f.ledger.tasks.p1.usage = { ...usage, costUsd: 0 }
      if (mutation === 'unknown-hold') f.ledger.attempts[0].usageKnown = true
      if (mutation === 'task-receipt') f.ledger.tasks.p1.terminalReceiptHash = h('9')
      if (mutation === 'attempt-order') f.ledger.attempts.reverse()
      if (mutation === 'claim') Object.assign(f.ledger, { rootClaim: { owner: 'other', expiresAt: 1 } })
      await expect(verifyProductBuildRootBudgetEvidenceV1({ ...f.input,
        budgetLedgerJson: JSON.stringify(f.ledger), expectedReceiptHash: f.expectedReceiptHash,
        evidenceJson: f.evidenceJson, verifyCurrentRun: async () => {},
      })).rejects.toThrow(/账本|Run/)
    },
  )

  it('rejects aliases, changed sibling envelopes, forged evidence and wrong current ownership', async () => {
    const f = await fixture()
    const verify = (changes: Record<string, unknown>) => verifyProductBuildRootBudgetEvidenceV1({
      ...f.input, expectedReceiptHash: f.expectedReceiptHash, evidenceJson: f.evidenceJson,
      verifyCurrentRun: async () => {}, ...changes,
    })
    const alias = structuredClone(f.ledger)
    alias.attempts[0].runId = alias.tasks.p1.runId
    await expect(verify({ budgetLedgerJson: JSON.stringify(alias) })).rejects.toThrow(/冒用/)
    const artifacts = structuredClone(f.input.artifacts)
    artifacts[0].rightsJson = '{"basis":"changed"}'
    await expect(verify({ artifacts })).rejects.toThrow(/包络/)
    const evidence = JSON.parse(f.evidenceJson)
    evidence.budgetLedgerJson = f.input.budgetLedgerJson.replace('0.1', '0.2')
    await expect(verify({ evidenceJson: JSON.stringify(evidence) })).rejects.toThrow()
    await expect(verify({ verifyCurrentRun: async () => { throw new Error('wrong owner') } }))
      .rejects.toThrow('wrong owner')
  })
})
