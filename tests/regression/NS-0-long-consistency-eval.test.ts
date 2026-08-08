import { describe, expect, it } from 'vitest'
import { getFixtures, LONG_CONSISTENCY_FIXTURES } from '../../src/lib/evals/long-consistency/fixtures'
import {
  NS0_FIXED_MAX_TOKENS,
  NS1_ACCEPTANCE_THRESHOLDS,
  aggregateScores,
  buildEvalCase,
  evaluateNs1Gate,
  scoreOutput,
} from '../../src/lib/evals/long-consistency/runner'

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

  it('quarantines labeled future/foreign prose and never injects the scoring answer key', () => {
    const fixture = getFixtures('development')[0]
    const legacy = buildEvalCase(fixture, 'legacy-500-tail')
    const candidate = buildEvalCase(fixture, 'handoff-tail-summary')
    const legacyText = legacy.messages.map(message => message.content).join('\n')
    const candidateText = candidate.messages.map(message => message.content).join('\n')

    expect(legacyText).toContain('未来计划（尚未发生）')
    expect(legacyText).toContain('异世界档案')
    expect(candidateText).not.toContain('银冠加冕')
    expect(candidateText).not.toContain('黑曜石哨')

    // 去污染铁证：候选 prompt 不再含"喂答案"脚手架（旧实现把 requiredFacts 注进 prompt，
    // 评测变成"抄答案 → 复述答案"的自我实现）。
    expect(candidateText).not.toContain('为自动验收')
    expect(candidateText).not.toContain('实验性交接约束')
    expect(candidateText).not.toContain('实验性历史摘要')

    // 真实 handoff 才会被注入：用 stub 抽取记忆验证生产同款序列化进了 prompt。
    const withHandoff = buildEvalCase(fixture, 'handoff-tail-summary', {
      handoffText: '结尾地点：雾港码头\n最后动作：把青铜铃藏进左袖',
      summaryText: '本章林砚与苏禾约定暗号。',
      extractionInputTokens: null,
      extractionOutputTokens: null,
      extractionInputChars: 0,
      extractionOutputChars: 0,
    })
    const withHandoffText = withHandoff.messages.map(message => message.content).join('\n')
    expect(withHandoffText).toContain('结尾地点：雾港码头')
    expect(withHandoffText).toContain('本章林砚与苏禾约定暗号')
  })

  it('fixtures are discriminating: legacy-visible text misses facts that only the full prior chapter carries', () => {
    // 尺子的硬性质：legacy（500 字尾巴 / existingContent）必须【漏掉】requiredFacts，
    // 而 handoff 的抽取源（previousChapterText 全文）必须【含有】它们。
    // 否则两个变体得分一样高，A/B 测不出 handoff 的价值（旧夹具就栽在这）。
    for (const fixture of LONG_CONSISTENCY_FIXTURES) {
      if (fixture.task === 'expansion') continue // expansion 的 handoff 收益边际，不做严格守卫
      const fullSource = fixture.previousChapterText
      const legacyVisible = fixture.task === 'completion'
        ? fixture.previousChapterText.slice(-500)
        : fixture.existingContent

      for (const fact of fixture.requiredFacts) {
        expect(
          fact.aliases.some(alias => fullSource.includes(alias)),
          `${fixture.id} 全文应含事实 ${fact.id}`,
        ).toBe(true)
        expect(
          fact.aliases.some(alias => legacyVisible.includes(alias)),
          `${fixture.id} legacy 可见部分不应含事实 ${fact.id}（否则无分辨力）`,
        ).toBe(false)
      }
    }
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
    expect(evaluateNs1Gate(
      makeRecord('legacy-500-tail', 1, 0.9, 1000),
      makeRecord('handoff-tail-summary', 1, 1, 1500),
      { requireFactImprovement: false },
    )).toEqual({ passed: true, failures: [] })
  })
})
