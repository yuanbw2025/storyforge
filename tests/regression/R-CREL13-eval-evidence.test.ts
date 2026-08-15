import { beforeEach, describe, expect, it } from 'vitest'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1,
  CREATIVE_RELIABILITY_FIXTURE_SET_VERSION_V1,
  CREATIVE_RELIABILITY_HELDOUT_FIXTURES_V1,
  type CreativeReliabilityFixtureV1,
} from '../../src/lib/evals/creative-reliability/fixtures'
import {
  applyCreativeReliabilityHumanReviewsV1,
  claimCreativeReliabilityHeldoutRunV1,
  createCreativeReliabilityEvalRecordV1,
  exportCreativeReliabilityEvalRecordV1,
  importCreativeReliabilityEvalRecordV1,
  verifyCreativeReliabilityEvalRecordV1,
} from '../../src/lib/evals/creative-reliability/evidence'
import {
  buildCreativeReliabilityVerifierMessagesV1,
  parseCreativeReliabilityLegacyOutputV1,
  parseCreativeReliabilityVerifierAssessmentV1,
} from '../../src/lib/evals/creative-reliability/protocol'
import {
  runCreativeReliabilityEvalV1,
  verifyCreativeReliabilityEvalCheckpointV1,
} from '../../src/lib/evals/creative-reliability/runner'
import type {
  CreativeReliabilityEvalCaseV1,
  CreativeReliabilityEvalGenerationV1,
  CreativeReliabilityEvalVerificationV1,
  CreativeReliabilityEvalVariantV1,
  CreativeReliabilityHumanReviewV1,
} from '../../src/lib/evals/creative-reliability/types'

const generator = {
  provider: 'fixture-provider',
  model: 'fixture-generator',
  promptVersion: 'crel-generator-v1',
}
const verifier = {
  provider: 'independent-provider',
  model: 'fixture-verifier',
  promptVersion: 'crel-verifier-v1',
}

async function generation(
  variant: CreativeReliabilityEvalVariantV1,
  index: number,
): Promise<CreativeReliabilityEvalGenerationV1> {
  const presentedText = JSON.stringify({
    storyArcs: [{ name: `${variant}-${index}`, stages: ['行动', '选择', '变化'] }],
  })
  const current = variant === 'creative-reliability'
  const artifactModelCalls = current && index % 2 === 1 ? 2 : 1
  const inputTokens = current ? 90 : 70
  const outputTokens = current ? 45 : 30
  const perCallInput = Math.floor(inputTokens / artifactModelCalls)
  const perCallOutput = Math.floor(outputTokens / artifactModelCalls)
  const calls = await Promise.all(Array.from({ length: artifactModelCalls }, async (_, callIndex) => {
    const callOutput = `${presentedText}:${callIndex + 1}`
    return {
      callIndex: callIndex + 1,
      stage: 'generation' as const,
      purpose: callIndex === 0 ? 'generate' as const : 'repair' as const,
      provider: generator.provider,
      model: generator.model,
      promptVersion: callIndex === 0 ? generator.promptVersion : 'crel-repair-v1',
      inputHash: await hashCanonicalValue({ variant, index, callIndex }),
      outputHash: await hashCanonicalValue(callOutput),
      status: 'succeeded' as const,
      usage: {
        inputTokens: callIndex === artifactModelCalls - 1
          ? inputTokens - perCallInput * callIndex
          : perCallInput,
        outputTokens: callIndex === artifactModelCalls - 1
          ? outputTokens - perCallOutput * callIndex
          : perCallOutput,
        latencyMs: Math.floor((current ? 1_200 + index : 900 + index) / artifactModelCalls),
        costUsd: null,
        usageSource: 'provider' as const,
      },
    }
  }))
  const latencyMs = calls.reduce((sum, call) => sum + call.usage.latencyMs, 0)
  return {
    variant,
    status: current ? index === 1 ? 'usable-with-warnings' : 'ready' : 'legacy-ready',
    presentedText,
    outputHash: await hashCanonicalValue(presentedText),
    editableArtifact: true,
    adoptable: true,
    artifactModelCalls,
    calls,
    usage: {
      inputTokens,
      outputTokens,
      latencyMs,
      costUsd: null,
      usageSource: 'provider',
    },
    issueCodes: current && index === 1 ? ['story-progression-weak'] : [],
  }
}

async function verification(
  fixture: CreativeReliabilityFixtureV1,
  variant: CreativeReliabilityEvalVariantV1,
  overrides: Partial<CreativeReliabilityEvalVerificationV1> = {},
): Promise<CreativeReliabilityEvalVerificationV1> {
  const assessmentBody = {
    status: 'succeeded' as const,
    semanticScore: variant === 'creative-reliability' ? 0.88 : 0.8,
    causalCoherence: variant === 'creative-reliability' ? 0.9 : 0.82,
    specificity: variant === 'creative-reliability' ? 0.86 : 0.8,
    matchedRequiredFactIds: fixture.requiredFacts.map(item => item.id),
    missingRequiredFactIds: [],
    safetyPassed: true,
    narrativeProgressed: true,
    infodumpOnly: false,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => (
      key !== 'usage' && key !== 'assessmentHash'
    ))),
  }
  const usage = overrides.usage ?? {
    inputTokens: 120,
    outputTokens: 30,
    latencyMs: 500,
    costUsd: null,
    usageSource: 'provider' as const,
  }
  return {
    ...assessmentBody,
    calls: [{
      callIndex: 1,
      stage: 'verification',
      purpose: 'verify',
      provider: verifier.provider,
      model: verifier.model,
      promptVersion: verifier.promptVersion,
      inputHash: await hashCanonicalValue({ fixtureId: fixture.id, variant }),
      outputHash: await hashCanonicalValue(assessmentBody),
      status: 'succeeded',
      usage,
    }],
    usage,
    assessmentHash: await hashCanonicalValue(assessmentBody),
  }
}

async function cases(
  fixtures: readonly CreativeReliabilityFixtureV1[],
): Promise<CreativeReliabilityEvalCaseV1[]> {
  return await Promise.all(fixtures.map(async (fixture, index) => ({
    fixtureId: fixture.id,
    executionOrder: index % 2 === 0
      ? ['legacy-direct', 'creative-reliability']
      : ['creative-reliability', 'legacy-direct'],
    generations: {
      'legacy-direct': await generation('legacy-direct', index),
      'creative-reliability': await generation('creative-reliability', index),
    },
    verifications: {
      'legacy-direct': await verification(fixture, 'legacy-direct'),
      'creative-reliability': await verification(fixture, 'creative-reliability'),
    },
    humanReview: null,
  })))
}

async function record(
  fixtures: readonly CreativeReliabilityFixtureV1[] = CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1,
) {
  return await createCreativeReliabilityEvalRecordV1({
    suiteVersion: CREATIVE_RELIABILITY_FIXTURE_SET_VERSION_V1,
    runId: `crel-${fixtures[0].split}-1`,
    createdAt: 1,
    codeRevision: 'test-revision',
    fixtures,
    generator,
    verifier,
    parameters: { temperature: 0.55, maxOutputTokens: 6_000 },
    cases: await cases(fixtures),
  })
}

async function humanReviews(): Promise<Record<string, CreativeReliabilityHumanReviewV1>> {
  const reviewerIdHash = await hashCanonicalValue('reviewer-1')
  return Object.fromEntries(CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1.map((fixture, index) => [
    fixture.id,
    {
      reviewerIdHash,
      completedAt: 10 + index,
      blindOrder: index % 2 === 0
        ? ['legacy-direct', 'creative-reliability']
        : ['creative-reliability', 'legacy-direct'],
      verdicts: index % 2 === 0
        ? [
            { label: 'A', willingToEdit: index < 3, estimatedEditMinutes: 24, retainedRatio: 0.55 },
            { label: 'B', willingToEdit: true, estimatedEditMinutes: 10, retainedRatio: 0.84 },
          ]
        : [
            { label: 'A', willingToEdit: true, estimatedEditMinutes: 10, retainedRatio: 0.84 },
            { label: 'B', willingToEdit: index < 3, estimatedEditMinutes: 24, retainedRatio: 0.55 },
          ],
      preferred: index % 2 === 0 ? 'B' : 'A',
    } satisfies CreativeReliabilityHumanReviewV1,
  ]))
}

describe('CREL-13 · 新 development / sealed holdout 与可验签门槛', () => {
  beforeEach(() => localStorage.clear())

  it('冻结两个不重叠的六样例集合，覆盖部分输入而不复用 H86 ID', () => {
    expect(CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1).toHaveLength(6)
    expect(CREATIVE_RELIABILITY_HELDOUT_FIXTURES_V1).toHaveLength(6)
    const ids = [
      ...CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1,
      ...CREATIVE_RELIABILITY_HELDOUT_FIXTURES_V1,
    ].map(item => item.id)
    expect(new Set(ids)).toHaveLength(12)
    expect(ids.every(id => id.startsWith('crel-') && !id.startsWith('h86-'))).toBe(true)
    expect(new Set(CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1.map(item => item.cohort)))
      .toEqual(new Set(['concept-only', 'world-only', 'character-only', 'partial', 'developed']))
  })

  it('机器门统计可编辑产物、零产出、1+1、token、推进和安全，人工门保持关闭', async () => {
    const created = await record()
    expect(created.machineGate).toMatchObject({ passed: true, failures: [] })
    expect(created.aggregate.creativeReliability).toMatchObject({
      editableArtifactRate: 1,
      zeroOutputRate: 0,
      adoptableRate: 1,
      averageArtifactModelCalls: 1.5,
      maxArtifactModelCalls: 2,
      safetyPassRate: 1,
      narrativeProgressRate: 1,
      infodumpOnlyRate: 0,
    })
    expect(created.aggregate.comparison.tokenPerAdoptableMultiplier).toBeCloseTo(1.35)
    expect(created.aggregate.creativeReliability.knownCostUsd).toBeNull()
    expect(created.communityGate.passed).toBe(false)
    expect(created.communityGate.failures).toEqual(expect.arrayContaining([
      'human-review-incomplete',
      'willing-to-edit-rate',
      'willing-to-edit-improvement',
    ]))
    expect(await verifyCreativeReliabilityEvalRecordV1(
      created,
      CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1,
    )).toBe(true)
  })

  it('应用真正的 A/B 盲评后才可能通过社区体验门', async () => {
    const created = await record()
    const reviewed = await applyCreativeReliabilityHumanReviewsV1(
      created,
      CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1,
      await humanReviews(),
    )
    expect(reviewed.aggregate.legacyDirect.willingToEditRate).toBe(0.5)
    expect(reviewed.aggregate.creativeReliability.willingToEditRate).toBe(1)
    expect(reviewed.aggregate.comparison.willingToEditDelta).toBe(0.5)
    expect(reviewed.communityGate).toMatchObject({ passed: true, failures: [] })

    const exported = await exportCreativeReliabilityEvalRecordV1(
      reviewed,
      CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1,
    )
    const imported = await importCreativeReliabilityEvalRecordV1(
      exported,
      CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1,
    )
    expect(imported.recordHash).toBe(reviewed.recordHash)
  })

  it('篡改输出、评分或调用上限都会验签失败或在创建时被拒绝', async () => {
    const created = await record()
    const tampered = structuredClone(created)
    tampered.cases[0].generations['creative-reliability'].presentedText = '偷偷替换'
    expect(await verifyCreativeReliabilityEvalRecordV1(
      tampered,
      CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1,
    )).toBe(false)

    const invalidCases = await cases(CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1)
    invalidCases[0].generations['creative-reliability'].artifactModelCalls = 3
    await expect(createCreativeReliabilityEvalRecordV1({
      suiteVersion: CREATIVE_RELIABILITY_FIXTURE_SET_VERSION_V1,
      runId: 'invalid-third-call',
      createdAt: 1,
      codeRevision: 'test',
      fixtures: CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1,
      generator,
      verifier,
      parameters: { temperature: 0.55, maxOutputTokens: 6_000 },
      cases: invalidCases,
    })).rejects.toThrow('隐藏第三次调用')
  })

  it('sealed heldout 只允许同一 run 恢复，不允许换 run 重跑', async () => {
    const bindingsHash = await hashCanonicalValue(CREATIVE_RELIABILITY_HELDOUT_FIXTURES_V1)
    claimCreativeReliabilityHeldoutRunV1({ runId: 'held-final-1', fixtureSetHash: bindingsHash })
    expect(() => claimCreativeReliabilityHeldoutRunV1({
      runId: 'held-final-1',
      fixtureSetHash: bindingsHash,
    })).not.toThrow()
    expect(() => claimCreativeReliabilityHeldoutRunV1({
      runId: 'held-final-2',
      fixtureSetHash: bindingsHash,
    })).toThrow('已经被运行过')
  })

  it('真实协议把旧 JSON 归一成可编辑数组，并严格核对独立 verifier 的 fact partition', () => {
    const fixture = CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1[0]
    const output = parseCreativeReliabilityLegacyOutputV1(JSON.stringify({
      name: '坠落倒计时',
      description: '守书人必须在群岛坠落前决定朗读哪一页。',
      stages: Array.from({ length: 3 }, (_, index) => ({
        title: `阶段${index + 1}`,
        description: '行动造成后果并迫使下一次选择。',
        keyEvents: ['寻找书页'],
      })),
    }))
    expect(JSON.parse(output)[0]).toMatchObject({ type: 'main', name: '坠落倒计时' })
    expect(buildCreativeReliabilityVerifierMessagesV1({ fixture, output })[1].content)
      .not.toContain('不能带回人')
    expect(parseCreativeReliabilityVerifierAssessmentV1(JSON.stringify({
      semanticScore: 0.8,
      causalCoherence: 0.75,
      specificity: 0.7,
      matchedRequiredFactIds: ['f1', 'f2'],
      missingRequiredFactIds: ['f3'],
      safetyPassed: true,
      narrativeProgressed: true,
      infodumpOnly: false,
    }), fixture)).toMatchObject({ narrativeProgressed: true, infodumpOnly: false })
    expect(() => parseCreativeReliabilityVerifierAssessmentV1(JSON.stringify({
      semanticScore: 0.8,
      causalCoherence: 0.75,
      specificity: 0.7,
      matchedRequiredFactIds: ['f1'],
      missingRequiredFactIds: ['f2'],
      safetyPassed: true,
      narrativeProgressed: true,
      infodumpOnly: false,
    }), fixture)).toThrow('fact_partition')
  })

  it('逐步落盘并可从 provider-blocked 原样恢复，不抹掉失败后重跑', async () => {
    const fixtures = CREATIVE_RELIABILITY_DEVELOPMENT_FIXTURES_V1
    const checkpoints: string[] = []
    let blockFirst = true
    const dependencies = {
      generate: async ({ variant, fixture }: {
        variant: CreativeReliabilityEvalVariantV1
        fixture: CreativeReliabilityFixtureV1
      }) => {
        if (blockFirst) {
          blockFirst = false
          return {
            variant,
            status: 'provider-failed' as const,
            presentedText: '',
            outputHash: null,
            editableArtifact: false,
            adoptable: false,
            artifactModelCalls: 1,
            calls: [{
              callIndex: 1,
              stage: 'generation' as const,
              purpose: 'generate' as const,
              provider: generator.provider,
              model: generator.model,
              promptVersion: generator.promptVersion,
              inputHash: await hashCanonicalValue({ fixture: fixture.id, variant }),
              outputHash: null,
              status: 'provider-failed' as const,
              usage: null,
              failureCode: 'provider_error',
            }],
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              latencyMs: 0,
              costUsd: null,
              usageSource: 'estimated' as const,
            },
            issueCodes: ['provider-error'],
          }
        }
        return await generation(variant, fixtures.indexOf(fixture))
      },
      verify: async ({ fixture, variant }: {
        fixture: CreativeReliabilityFixtureV1
        variant: CreativeReliabilityEvalVariantV1
      }) => await verification(fixture, variant),
    }
    const first = await runCreativeReliabilityEvalV1({
      suiteVersion: CREATIVE_RELIABILITY_FIXTURE_SET_VERSION_V1,
      runId: 'resume-provider-failure',
      createdAt: 1,
      codeRevision: 'test-revision',
      fixtures,
      generator,
      verifier,
      parameters: { temperature: 0.55, maxOutputTokens: 6_000 },
      dependencies,
      onCheckpoint: checkpoint => { checkpoints.push(checkpoint.checkpointHash) },
    })
    expect(first.status).toBe('provider-blocked')
    expect(first.cases[0].generations['legacy-direct']?.status).toBe('provider-failed')
    expect(await verifyCreativeReliabilityEvalCheckpointV1(first, fixtures)).toBe(true)

    const resumed = await runCreativeReliabilityEvalV1({
      suiteVersion: CREATIVE_RELIABILITY_FIXTURE_SET_VERSION_V1,
      runId: 'resume-provider-failure',
      codeRevision: 'test-revision',
      fixtures,
      generator,
      verifier,
      parameters: { temperature: 0.55, maxOutputTokens: 6_000 },
      dependencies,
      resumeFrom: first,
      onCheckpoint: checkpoint => { checkpoints.push(checkpoint.checkpointHash) },
    })
    expect(resumed.status).toBe('completed')
    expect(resumed.record?.cases[0].generations['legacy-direct'].status).toBe('provider-failed')
    expect(resumed.record?.machineGate.passed).toBe(false)
    expect(new Set(checkpoints).size).toBeGreaterThan(10)
    expect(await verifyCreativeReliabilityEvalCheckpointV1(resumed, fixtures)).toBe(true)
  })
})
