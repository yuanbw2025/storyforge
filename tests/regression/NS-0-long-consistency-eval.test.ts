import { describe, expect, it } from 'vitest'
import { getFixtures } from '../../src/lib/evals/long-consistency/fixtures'
import {
  NS0_FIXED_MAX_TOKENS,
  NS1_ACCEPTANCE_THRESHOLDS,
  aggregateScores,
  buildEvalCase,
  evaluateNs1Gate,
  runPairedEvalInBrowser,
  scoreOutput,
} from '../../src/lib/evals/long-consistency/runner'
import {
  parseSemanticJudgeVerdict,
  scoreWithSemanticVerdict,
} from '../../src/lib/evals/long-consistency/semantic-judge'

describe('NS-0 long-consistency evaluation harness', () => {
  it('freezes separate development and held-out fixture sets', () => {
    expect(getFixtures('development').map(fixture => fixture.id)).toEqual([
      'dev-completion-bell',
      'dev-continuation-wound',
      'dev-expansion-medicine',
      'held-completion-lantern',
      'held-continuation-ink',
      'held-expansion-compass',
      'held-final-completion-seal',
      'held-final-continuation-tidelock',
      'held-final-expansion-mask',
      'held-v3-completion-ferry',
      'held-v3-continuation-fourth-chime',
      'held-v3-expansion-porcelain',
      'held-v3-completion-salt-pass',
      'held-v4-completion-archive',
      'held-v4-continuation-fifth-drop',
      'held-v4-expansion-bronze-cup',
      'held-v4-continuation-red-flag',
    ])
    expect(getFixtures('held-out').map(fixture => fixture.id)).toEqual([
      'held-v5-completion-mirror-hall',
      'held-v5-continuation-seventh-knock',
      'held-v5-expansion-paper-bird',
      'held-v5-continuation-green-lantern',
    ])
  })

  it('snapshots the current production builders and exact 500-char predecessor tail', () => {
    const fixtures = getFixtures('development')
    const completion = buildEvalCase(fixtures[0], 'legacy-500-tail')
    const continuation = buildEvalCase(fixtures[1], 'legacy-500-tail')
    const expansion = buildEvalCase(fixtures[2], 'legacy-500-tail')

    expect(completion.productionSnapshot).toEqual({
      task: 'completion',
      previousTailChars: 500,
      builder: 'chapter.content',
    })
    expect(completion.messages.at(-1)?.content).toContain(fixtures[0].previousChapterText.slice(-500))
    expect(completion.messages.at(-1)?.content).not.toContain(fixtures[0].previousChapterText.slice(0, 40))
    expect(continuation.productionSnapshot.builder).toBe('chapter.continue')
    expect(expansion.productionSnapshot.builder).toBe('chapter.expand')
  })

  it('quarantines labeled future and foreign-world prose from candidate prompts only', () => {
    const fixture = getFixtures('development')[0]
    const legacy = buildEvalCase(fixture, 'legacy-500-tail')
    const candidate = buildEvalCase(fixture, 'handoff-tail-summary')
    const legacyText = legacy.messages.map(message => message.content).join('\n')
    const candidateText = candidate.messages.map(message => message.content).join('\n')

    expect(legacyText).toContain('未来计划（尚未发生）')
    expect(legacyText).toContain('异世界档案')
    expect(candidateText).not.toContain('银冠加冕')
    expect(candidateText).not.toContain('黑曜石哨')
    expect(candidateText).toContain('雾港通行证是青铜铃')
  })

  it('scores deterministic facts, constraints, future leakage, foreign-world leakage and evidence', () => {
    const fixture = {
      ...getFixtures('development').find(item => item.id === 'held-completion-lantern')!,
      evidenceIds: ['chapter-19:ending'],
    }
    const score = scoreOutput(
      fixture,
      '祁照偏过右耳，踩着熄灭的灯影，把密函交给手腕绕着两圈红绳的人。[证据:chapter-19:ending] 他随后踩发亮的灯，并想起将来烧毁密函。',
    )

    expect(score.requiredFactRecall).toBe(1)
    expect(score.constraintRecall).toBe(1)
    expect(score.futureLeakage).toBe(true)
    expect(score.wrongWorldLeakage).toBe(true)
    expect(score.evidenceCitationRecall).toBe(1)
  })

  it('uses a bounded semantic verdict for behavior constraints and contextual leakage', () => {
    const fixture = getFixtures('development')[0]
    const verdict = parseSemanticJudgeVerdict(fixture, JSON.stringify({
      matchedRequiredFactIds: ['bronze-bell', 'unknown'],
      satisfiedConstraintIds: ['signal', 'protect-identity'],
      leakedFutureFactIds: [],
      leakedForeignWorldFactIds: [],
    }))
    expect(verdict).toEqual({
      matchedRequiredFactIds: ['bronze-bell'],
      satisfiedConstraintIds: ['signal', 'protect-identity'],
      leakedFutureFactIds: [],
      leakedForeignWorldFactIds: [],
    })
    const score = scoreWithSemanticVerdict(fixture, '正文没有逐字复述禁令。', verdict!)
    expect(score.requiredFactRecall).toBe(0.5)
    expect(score.constraintRecall).toBe(1)
    expect(score.futureLeakage).toBe(false)
    expect(score.wrongWorldLeakage).toBe(false)
  })

  it('pre-registers fixed-budget and NS-1 acceptance gates before real baseline calls', () => {
    expect(NS0_FIXED_MAX_TOKENS).toBe(1200)
    expect(NS1_ACCEPTANCE_THRESHOLDS).toEqual({
      futureLeakageRate: 0,
      wrongWorldLeakageRate: 0,
      minimumRequiredFactRecall: 0.85,
      minimumConstraintRecall: 0.85,
      minimumEvidenceCitationRecall: 0.9,
      maximumEstimatedInputTokenMultiplierVsLegacy: 1.6,
      minimumFactRecallImprovementVsLegacy: 0.1,
    })
  })

  it('aggregates a run without treating unavailable citation scores as zero', () => {
    const fixture = getFixtures('development')[0]
    const score = scoreOutput(fixture, '青铜铃藏在左袖，暗号是三短一长，她没有叫出苏禾的名字。')
    const aggregate = aggregateScores([{
      fixtureId: fixture.id,
      messages: [],
      productionSnapshot: {
        task: fixture.task,
        previousTailChars: 0,
        builder: 'chapter.content',
      },
      output: '青铜铃藏在左袖，暗号是三短一长，她没有叫出苏禾的名字。',
      inputChars: 100,
      outputChars: 30,
      inputTokens: 80,
      outputTokens: 20,
      durationMs: 10,
      score,
    }])

    expect(aggregate.requiredFactRecall).toBe(1)
    expect(aggregate.constraintRecall).toBe(1)
    expect(aggregate.evidenceCitationRecall).toBeNull()
    expect(aggregate.futureLeakageRate).toBe(0)
    expect(aggregate.estimatedInputTokens).toBe(80)
    expect(aggregate.estimatedOutputTokens).toBe(20)
  })

  it('runs paired A/B under both fixed-budget and natural-cost modes', async () => {
    const seenMaxTokens: number[] = []
    const fixture = getFixtures('development')[0]
    const records = await runPairedEvalInBrowser({
      fixtures: [fixture],
      split: 'development',
      variants: ['legacy-500-tail', 'handoff-tail-summary'],
      config: {
        provider: 'agnes',
        apiKey: 'test-only',
        model: 'agnes-1.5-flash',
        baseUrl: 'https://example.invalid/v1',
        temperature: 0.7,
        maxTokens: 4096,
      },
      call: async (_messages, config) => {
        seenMaxTokens.push(config.maxTokens)
        return {
          output: '青铜铃藏在左袖，暗号是三短一长，她没有叫出苏禾的名字。',
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
        }
      },
    })

    expect(records.map(record => `${record.budgetMode}:${record.variant}`)).toEqual([
      'fixed:legacy-500-tail',
      'fixed:handoff-tail-summary',
      'natural:legacy-500-tail',
      'natural:handoff-tail-summary',
    ])
    expect(seenMaxTokens).toEqual([1200, 1200, 4096, 4096])
  })

  it('applies the pre-registered NS-1 gate without post-hoc threshold changes', () => {
    const makeRecord = (
      variant: 'legacy-500-tail' | 'handoff-tail-summary',
      fact: number,
      constraint: number,
      inputTokens: number,
    ) => ({
      schemaVersion: 1 as const,
      runId: variant,
      createdAt: new Date(0).toISOString(),
      provider: 'agnes',
      model: 'agnes-1.5-flash',
      variant,
      split: 'held-out' as const,
      budgetMode: 'fixed' as const,
      configuredMaxTokens: 1200,
      results: [],
      aggregate: {
        caseCount: 3,
        requiredFactRecall: fact,
        constraintRecall: constraint,
        futureLeakageRate: 0,
        wrongWorldLeakageRate: 0,
        evidenceCitationRecall: null,
        estimatedInputTokens: inputTokens,
        estimatedOutputTokens: 100,
      },
    })
    expect(evaluateNs1Gate(
      makeRecord('legacy-500-tail', 0.4, 0.5, 1000),
      makeRecord('handoff-tail-summary', 0.9, 0.9, 1500),
    )).toEqual({ passed: true, failures: [] })
    expect(evaluateNs1Gate(
      makeRecord('legacy-500-tail', 0.8, 0.8, 1000),
      makeRecord('handoff-tail-summary', 0.84, 0.9, 1700),
    ).passed).toBe(false)
  })
})
