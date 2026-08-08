import { describe, expect, it } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  buildLongConsistencyJudgeMessagesV1,
  createLongConsistencyEvalArtifactV1,
  createLongConsistencyFixtureBindingV1,
  exportLongConsistencyEvalArtifactV1,
  importLongConsistencyEvalArtifactV1,
  parseLongConsistencyEvalArtifactV1,
  parseLongConsistencyJudgeResponseV1,
  runLongConsistencySemanticAuditV1,
  verifyLongConsistencyEvalArtifactV1,
} from '../../src/lib/evals/long-consistency/evidence-report'
import type {
  LongConsistencyEvalArtifactV1,
  LongConsistencyReportSourceInputV1,
} from '../../src/lib/evals/long-consistency/report-types'
import {
  LONG_CONSISTENCY_CATEGORIES_V1,
  LONG_CONSISTENCY_SUBTYPES_V1,
  LONG_CONSISTENCY_TAXONOMY_V1,
} from '../../src/lib/evals/long-consistency/taxonomy'

const SOURCES: LongConsistencyReportSourceInputV1[] = [{
  id: 'world:moon-well',
  kind: 'world',
  content: '<p>月井律规定：太阳升起后，任何人都无法使用影渡。</p>',
}, {
  id: 'chapter:12',
  kind: 'narrative',
  content: '<p>正午钟响时，苏禾踏入自己的影子，瞬间越过了封锁线。</p><p>她说自己从未见过守井人。</p>',
}, {
  id: 'author-intent:12',
  kind: 'author-intent',
  content: '作者明确计划：苏禾谎称从未见过守井人，这是后续揭示的伏笔。',
}]

function rawReport(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    issues: [{
      id: 'rule-violation-1',
      subtype: 'core-rules-violation',
      severity: 'high',
      intentClassification: 'unintentional',
      summary: '正午使用影渡违反已声明的月井律。',
      factEvidence: {
        sourceId: 'world:moon-well',
        quote: '太阳升起后，任何人都无法使用影渡',
      },
      contradictionEvidence: {
        sourceId: 'chapter:12',
        quote: '正午钟响时，苏禾踏入自己的影子，瞬间越过了封锁线',
      },
      ...overrides,
    }],
  })
}

async function fixtureBinding() {
  return await createLongConsistencyFixtureBindingV1({
    id: 'h4-dev-core-rule-1',
    split: 'development',
    task: 'generation',
    modelInput: { prompt: '写一章月井故事', sourceIds: SOURCES.map(source => source.id) },
    hiddenLabels: { expectedSubtype: 'core-rules-violation', marker: 'hidden-marker' },
  })
}

async function createArtifact(
  rawJudgeOutput = rawReport(),
  sources: LongConsistencyReportSourceInputV1[] = SOURCES,
): Promise<LongConsistencyEvalArtifactV1> {
  return await createLongConsistencyEvalArtifactV1({
    runId: 'h4-run-1',
    createdAt: new Date(0).toISOString(),
    codeRevision: 'test-revision',
    fixture: await fixtureBinding(),
    generator: {
      provider: 'provider-a',
      model: 'generator-a',
      promptVersion: 'prose.generate-v1',
    },
    verifier: {
      provider: 'provider-b',
      model: 'verifier-b',
      promptVersion: 'h4-long-consistency-judge-v1',
    },
    generationUsage: { inputTokens: 4_000, outputTokens: 8_000, durationMs: 12_000, costUsd: 0.4 },
    verifierUsage: { inputTokens: 9_000, outputTokens: 400, durationMs: 3_000, costUsd: 0.2 },
    sources,
    rawJudgeOutput,
    traceHashes: ['a'.repeat(64), 'b'.repeat(64)],
  })
}

describe('R-HARNESS28 · H4 long-consistency evidence report', () => {
  it('freezes the five ConStory categories and all 19 official subtypes', () => {
    expect(LONG_CONSISTENCY_CATEGORIES_V1).toHaveLength(5)
    expect(LONG_CONSISTENCY_SUBTYPES_V1).toHaveLength(19)
    expect(new Set(LONG_CONSISTENCY_SUBTYPES_V1).size).toBe(19)
    expect(Object.fromEntries(LONG_CONSISTENCY_CATEGORIES_V1.map(category => [
      category,
      LONG_CONSISTENCY_TAXONOMY_V1.filter(entry => entry.category === category).length,
    ]))).toEqual({
      'timeline-plot-logic': 6,
      characterization: 4,
      'world-building-setting': 3,
      'factual-detail-consistency': 3,
      'narrative-style': 3,
    })
    expect(LONG_CONSISTENCY_TAXONOMY_V1.map(entry => entry.subtypeLabel)).toEqual([
      'Absolute Time Contradictions',
      'Duration Contradictions',
      'Simultaneity Contradictions',
      'Causeless Effects',
      'Causal Logic Violations',
      'Abandoned Plot Elements',
      'Memory Contradictions',
      'Knowledge Contradictions',
      'Skill Fluctuations',
      'Forgotten Abilities',
      'Core Rules Violations',
      'Social Norms Violations',
      'Geographical Contradictions',
      'Appearance Mismatches',
      'Nomenclature Confusions',
      'Quantitative Mismatches',
      'Perspective Confusions',
      'Tone Inconsistencies',
      'Style Shifts',
    ])
  })

  it('shows only normalized sources and taxonomy to the judge, never hidden fixture labels', async () => {
    const messages = await buildLongConsistencyJudgeMessagesV1(SOURCES)
    const prompt = messages.map(message => message.content).join('\n')
    expect(prompt).toContain('constory-bench-19-v1')
    expect(prompt).toContain('core-rules-violation')
    expect(prompt).toContain('月井律规定：太阳升起后')
    expect(prompt).not.toContain('<p>')
    expect(prompt).not.toContain('hidden-marker')
    expect(prompt).toContain('不要输出字符偏移')
  })

  it('derives category, offsets, source hashes, disposition and metrics in code', async () => {
    const artifact = await createArtifact()
    const issue = artifact.issues[0]
    expect(issue.category).toBe('world-building-setting')
    expect(issue.disposition).toBe('hard-conflict')
    expect(issue.pair.fact.startOffset).toBe('月井律规定：'.length)
    expect(issue.pair.fact.endOffset - issue.pair.fact.startOffset).toBe(issue.pair.fact.quote.length)
    expect(issue.pair.contradiction.startOffset).toBe(0)
    expect(issue.pair.fact.sourceHash).toBe(artifact.sources[0].contentHash)
    expect(artifact.metrics).toEqual({
      issueCount: 1,
      hardConflictCount: 1,
      highSeverityHardConflictCount: 1,
      advisoryCount: 0,
      intentionalCount: 0,
      ambiguousCount: 0,
    })
    expect(artifact.execution.modelIdentitySeparated).toBe(true)
    await expect(verifyLongConsistencyEvalArtifactV1(artifact, {
      sources: SOURCES,
      rawJudgeOutput: rawReport(),
    })).resolves.toBe(true)
  })

  it('runs the verifier through the same prompt and artifact path', async () => {
    let visiblePrompt = ''
    const artifact = await runLongConsistencySemanticAuditV1({
      runId: 'h4-runner-1',
      createdAt: new Date(0).toISOString(),
      codeRevision: 'test-revision',
      fixture: await fixtureBinding(),
      generator: {
        provider: 'provider-a',
        model: 'generator-a',
        promptVersion: 'prose.generate-v1',
      },
      verifier: {
        provider: 'provider-b',
        model: 'verifier-b',
        promptVersion: 'h4-long-consistency-judge-v1',
      },
      generationUsage: { inputTokens: 4_000, outputTokens: 8_000, durationMs: 12_000, costUsd: 0.4 },
      sources: SOURCES,
      traceHashes: ['c'.repeat(64)],
      call: async messages => {
        visiblePrompt = messages.map(message => message.content).join('\n')
        return {
          output: rawReport(),
          usage: { inputTokens: 321, outputTokens: 45, durationMs: 678, costUsd: 0.01 },
        }
      },
    })
    expect(visiblePrompt).toContain('intentional 和 ambiguous')
    expect(artifact.execution.verifierUsage).toEqual({
      inputTokens: 321,
      outputTokens: 45,
      durationMs: 678,
      costUsd: 0.01,
    })
    expect(artifact.issues).toHaveLength(1)
  })

  it.each(['intentional', 'ambiguous'] as const)(
    'never upgrades %s author intent to a hard conflict',
    async intentClassification => {
      const artifact = await createArtifact(rawReport({ intentClassification }))
      expect(artifact.issues[0].disposition).toBe('advisory')
      expect(artifact.metrics.hardConflictCount).toBe(0)
      expect(artifact.metrics.advisoryCount).toBe(1)
    },
  )

  it('rejects model-owned offsets, unknown subtypes and duplicate candidate ids', () => {
    const withOffset = JSON.parse(rawReport())
    withOffset.issues[0].factEvidence.startOffset = 0
    expect(() => parseLongConsistencyJudgeResponseV1(JSON.stringify(withOffset))).toThrowError(
      expect.objectContaining({ code: 'unknown_field' }),
    )

    expect(() => parseLongConsistencyJudgeResponseV1(rawReport({ subtype: 'invented-subtype' }))).toThrowError(
      expect.objectContaining({ code: 'invalid_value' }),
    )

    const duplicate = JSON.parse(rawReport())
    duplicate.issues.push({ ...duplicate.issues[0] })
    expect(() => parseLongConsistencyJudgeResponseV1(JSON.stringify(duplicate))).toThrowError(
      expect.objectContaining({ code: 'duplicate_value' }),
    )
  })

  it('fails closed for absent, wrong-source and ambiguous verbatim quotes', async () => {
    await expect(createArtifact(rawReport({
      factEvidence: { sourceId: 'world:moon-well', quote: '来源中根本不存在' },
    }))).rejects.toMatchObject({ code: 'evidence_not_found' })

    await expect(createArtifact(rawReport({
      factEvidence: {
        sourceId: 'world:moon-well',
        quote: '正午钟响时，苏禾踏入自己的影子，瞬间越过了封锁线',
      },
    }))).rejects.toMatchObject({ code: 'evidence_not_found' })

    const repeatedSources: LongConsistencyReportSourceInputV1[] = [{
      id: 'chapter:duplicate',
      kind: 'narrative',
      content: '银铃响了。过了片刻，银铃响了。最后门开了。',
    }, SOURCES[0]]
    await expect(createArtifact(JSON.stringify({
      schemaVersion: 1,
      issues: [{
        id: 'duplicate-quote',
        subtype: 'causal-logic-violation',
        severity: 'medium',
        intentClassification: 'unintentional',
        summary: '重复引文无法确定位置。',
        factEvidence: { sourceId: 'chapter:duplicate', quote: '银铃响了' },
        contradictionEvidence: { sourceId: 'chapter:duplicate', quote: '最后门开了' },
      }],
    }), repeatedSources)).rejects.toMatchObject({ code: 'ambiguous_evidence' })
  })

  it('exports and imports a versioned artifact while detecting payload and source tampering', async () => {
    const artifact = await createArtifact()
    const exported = await exportLongConsistencyEvalArtifactV1(artifact, {
      sources: SOURCES,
      rawJudgeOutput: rawReport(),
    })
    const imported = await importLongConsistencyEvalArtifactV1(exported, { sources: SOURCES })
    expect(imported).toEqual(artifact)

    const payloadTamper = structuredClone(artifact)
    payloadTamper.issues[0].summary = '篡改后的结论'
    await expect(verifyLongConsistencyEvalArtifactV1(payloadTamper)).resolves.toBe(false)

    const sourceTamper = SOURCES.map(source => ({ ...source }))
    sourceTamper[0].content = `${sourceTamper[0].content} 新增规则。`
    await expect(verifyLongConsistencyEvalArtifactV1(artifact, { sources: sourceTamper })).resolves.toBe(false)

    const offsetTamper = structuredClone(artifact)
    offsetTamper.issues[0].pair.fact.startOffset += 1
    offsetTamper.issues[0].pair.fact.endOffset += 1
    const { artifactHash: _artifactHash, ...body } = offsetTamper
    offsetTamper.artifactHash = await hashCanonicalValue(body)
    await expect(verifyLongConsistencyEvalArtifactV1(offsetTamper, { sources: SOURCES })).resolves.toBe(false)
  })

  it('rejects re-signed intent escalation and accepts a hashed clean control', async () => {
    const intentional = await createArtifact(rawReport({ intentClassification: 'intentional' }))
    const escalated = structuredClone(intentional)
    escalated.issues[0].disposition = 'hard-conflict'
    expect(() => parseLongConsistencyEvalArtifactV1(escalated)).toThrowError(
      expect.objectContaining({ code: 'intent_escalation' }),
    )

    const clean = await createArtifact(JSON.stringify({ schemaVersion: 1, issues: [] }))
    expect(clean.metrics.issueCount).toBe(0)
    expect(clean.metrics.hardConflictCount).toBe(0)
    await expect(verifyLongConsistencyEvalArtifactV1(clean, { sources: SOURCES })).resolves.toBe(true)
  })
})
