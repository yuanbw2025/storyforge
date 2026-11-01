import { describe, expect, it, vi } from 'vitest'
import historicalOverlap from '../fixtures/quality113-overlapping-report.json'
import {
  createLongConsistencyFixtureBindingV1,
  exportLongConsistencyEvalArtifactV1,
  importLongConsistencyEvalArtifactV1,
  runLongConsistencySemanticAuditV1,
  verifyLongConsistencyEvalArtifactV1,
} from '../../src/lib/evals/long-consistency/evidence-report'

async function auditCase(text: string, quote: string) {
  const sources = [
    { id: 'narrative:fact', kind: 'narrative' as const, content: text },
    { id: 'narrative:later', kind: 'narrative' as const, content: '他始终没有笑。' },
  ]
  const rawJudgeOutput = JSON.stringify({ schemaVersion: 1, issues: [{
    id: 'tone', subtype: 'tone-inconsistency', severity: 'medium', intentClassification: 'ambiguous',
    summary: '合成逐字定位样本；不代表文学或矛盾语义正确。',
    factEvidence: { sourceId: 'narrative:fact', quote },
    contradictionEvidence: { sourceId: 'narrative:later', quote: '他始终没有笑。' },
  }] })
  const call = vi.fn(async () => ({ output: rawJudgeOutput,
    usage: { inputTokens: 1, outputTokens: 1, durationMs: 1, costUsd: 0 } }))
  const fixture = await createLongConsistencyFixtureBindingV1({ id: 'sfqa113-locatability-only',
    split: 'development', task: 'generation', modelInput: { sources }, hiddenLabels: { locatabilityOnly: true } })
  return {
    sources, rawJudgeOutput, call,
    run: () => runLongConsistencySemanticAuditV1({
      runId: 'sfqa113-correctness', createdAt: new Date(0).toISOString(),
      codeRevision: 'fc597c48e41d470e3f5449403b8044714b071df5', fixture,
      generator: { provider: 'synthetic-a', model: 'generator', promptVersion: 'synthetic-v1' },
      verifier: { provider: 'synthetic-b', model: 'verifier', promptVersion: 'h4-long-consistency-judge-v7' },
      generationUsage: { inputTokens: 0, outputTokens: 0, durationMs: 0, costUsd: 0 },
      sources, traceHashes: ['a'.repeat(64)], call,
    }),
  }
}

describe('SFQA113 literal evidence uniqueness through the public v7 report protocol', () => {
  it.each([
    { text: '哈哈哈', quote: '哈哈' },
    { text: 'abababa', quote: 'ababa' },
    { text: '🌙🌙🌙', quote: '🌙🌙' },
  ])('rejects overlapping occurrences in $text without another model call', async ({ text, quote }) => {
    const sample = await auditCase(text, quote)
    await expect(sample.run()).rejects.toMatchObject({ code: 'ambiguous_evidence' })
    expect(sample.call).toHaveBeenCalledTimes(1)
  })

  it('continues to reject separate repeated quotations', async () => {
    const sample = await auditCase('哈哈，哈哈', '哈哈')
    await expect(sample.run()).rejects.toMatchObject({ code: 'ambiguous_evidence' })
    expect(sample.call).toHaveBeenCalledTimes(1)
  })

  it.each([
    { text: '前文哈哈。后文', quote: '哈哈', start: 2, end: 4 },
    { text: 'A🌙B', quote: '🌙', start: 1, end: 3 },
  ])('keeps unique quotations and UTF-16 offsets in $text', async ({ text, quote, start, end }) => {
    const sample = await auditCase(text, quote), artifact = await sample.run()
    const options = { sources: sample.sources, rawJudgeOutput: sample.rawJudgeOutput }
    expect(sample.call).toHaveBeenCalledTimes(1)
    expect(artifact.issues[0].pair.fact).toMatchObject({ quote, startOffset: start, endOffset: end })
    expect(await verifyLongConsistencyEvalArtifactV1(artifact, options)).toBe(true)
    const raw = await exportLongConsistencyEvalArtifactV1(artifact, options)
    expect(await importLongConsistencyEvalArtifactV1(raw, options)).toEqual(artifact)
  })

  it('rejects the actual old overlapping report on source recheck without rewriting it', async () => {
    // Captured through the old public v7 audit/export at fc597c48, before the
    // fix. Its authentic synthetic hashes are retained, not regenerated here.
    const sample = await auditCase('哈哈哈', '哈哈'), before = JSON.stringify(historicalOverlap)
    const options = { sources: sample.sources, rawJudgeOutput: sample.rawJudgeOutput }
    expect(await verifyLongConsistencyEvalArtifactV1(historicalOverlap, options)).toBe(false)
    await expect(exportLongConsistencyEvalArtifactV1(historicalOverlap, options))
      .rejects.toMatchObject({ code: 'integrity_mismatch' })
    await expect(importLongConsistencyEvalArtifactV1(before, options))
      .rejects.toMatchObject({ code: 'integrity_mismatch' })
    expect(JSON.stringify(historicalOverlap)).toBe(before)
    expect(sample.call).not.toHaveBeenCalled()
  })
})
