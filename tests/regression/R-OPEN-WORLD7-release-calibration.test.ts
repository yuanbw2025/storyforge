import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  projectTextOpenWorldTemplateDifferentiationV1,
  runTextOpenWorldCreatorIndependentCalibrationReviewV1,
  type TextOpenWorldCreatorCalibrationReviewContextV1,
} from '../../src/lib/open-world/creator-quality-calibration'
import { parseTextOpenWorldCreatorCalibrationEvidenceV1 } from '../../src/lib/open-world/creator-quality-contract'

const HASH = 'a'.repeat(64)

function reviewContext(): TextOpenWorldCreatorCalibrationReviewContextV1 {
  return {
    schema: 'storyforge.text-open-world-creator-calibration-review-input', version: 1,
    buildPackageHash: HASH,
    mainline: {
      title: '盐脊主线', summary: '恢复两地共同供水', coreGoal: '不牺牲任一地区恢复潮脉',
      stages: [{
        key: 'stage.1', title: '旧井', summary: '确认供水断裂', dramaticQuestion: '谁关闭了潮井',
        requiredReveal: '两地水脉相连', stageOutcome: '玩家获得修复线索', estimatedMinutes: 15,
      }],
      endings: [{ endingKey: 'ending.share', title: 'ending.share', routeSummary: '两地共享潮脉', decisivePlayerValue: '协作' }],
    },
    significantStories: [{
      key: 'story.keeper', ownerKind: 'actor', ownerTitle: '守井人', title: '守井人的债',
      summary: '守井人面对旧日选择', centralConflict: '职责与亲情冲突', theme: '责任',
      escalationSteps: ['隐瞒', '对质', '选择'], atmosphereSignals: ['井绳', '盐雾'], estimatedMinutes: 35,
    }],
    regions: [{
      regionKey: 'region.ridge', title: '盐脊', fantasy: '盐风荒脊', localConflict: '两地争水',
      distinctivenessStatement: '潮脉机械与盐风生活结合',
      templates: [{ key: 'template.well', title: '井边求助', storyFrame: '地方需求牵出潮脉后果', variationAxes: ['求助者', '阻碍'] }],
    }],
    templateVariants: [{
      templateKey: 'template.well', variants: [
        { title: '盐壳水桶', description: '老人需要清理结盐水桶并追查污染源。' },
        { title: '夜巡井绳', description: '巡夜人请求修补被风割断的井绳。' },
        { title: '失踪的水票', description: '商贩请玩家寻找被偷走的配水凭证。' },
      ],
    }],
    duration: {
      mainlineMinutes: 105, optionalInventoryMinutes: 220, totalAuthoredMinutes: 325,
      typicalPlaythroughMinutes: 240, requestedMainlineMinimum: 90, requestedMainlineMaximum: 120,
      requestedOptionalMinimum: 180, requestedOptionalMaximum: 300,
    },
    evaluationRules: {
      independentFromGenerator: true, noSourceFactInvention: true, noStateMutation: true,
      scoresInClosedMetricOrder: ['mainline-quality', 'significant-stories', 'template-differentiation'],
      passThreshold: 70,
    },
  }
}

describe('TOW-G7-11 · 发布候选叙事、重复、时长和成本校准', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); db.close() })

  it('独立grader走登记的只读入口并冻结用量、延迟和输入输出Hash', async () => {
    const grade = {
      schema: 'storyforge.text-open-world-creator-calibration-grade', version: 1,
      scores: [
        { metricKey: 'mainline-quality', score: 91, rationale: '目标、揭示和结局回收闭合。' },
        { metricKey: 'significant-stories', score: 88, rationale: '配角冲突具备三段升级。' },
        { metricKey: 'template-differentiation', score: 86, rationale: '三份变体的动机和阻碍不同。' },
      ], findings: [],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'tow-g7-11', object: 'chat.completion',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(grade) } }],
      usage: { prompt_tokens: 420, completion_tokens: 90, total_tokens: 510 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const evidence = await runTextOpenWorldCreatorIndependentCalibrationReviewV1({
      projectId: 701,
      config: {
        provider: 'agnes', apiKey: 'must-not-enter-evidence', model: 'independent-narrative-grader-v1',
        baseUrl: 'https://grader.example/v1', temperature: 0.7, maxTokens: 0,
      },
      context: reviewContext(),
    })
    expect(evidence.scores.map(score => score.score)).toEqual([91, 88, 86])
    expect(evidence).toMatchObject({
      provider: 'agnes', model: 'independent-narrative-grader-v1',
      inputTokens: 420, outputTokens: 90, finishReason: 'stop',
    })
    expect(evidence.durationMs).toBeGreaterThan(0)
    expect(evidence.inputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(evidence.outputHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(evidence)).not.toContain('must-not-enter-evidence')
  })

  it('代码量化每模板三份变体，并识别精确重复与近似重复', () => {
    const result = projectTextOpenWorldTemplateDifferentiationV1({
      regions: {
        packs: [{ taskTemplateSeeds: [{ key: 'template.one' }, { key: 'template.two' }] }],
      } as never,
      scenes: {
        templateTextVariants: [
          { templateKey: 'template.one', title: '寻找盐袋', description: '帮助老人寻找丢失的盐袋。' },
          { templateKey: 'template.one', title: '寻找盐袋', description: '帮助老人寻找丢失的盐袋。' },
          { templateKey: 'template.one', title: '断裂井绳', description: '修好风中断裂的井绳。' },
          { templateKey: 'template.two', title: '水票争执', description: '调解商队的水票争执。' },
          { templateKey: 'template.two', title: '潮井异响', description: '调查夜间潮井异响。' },
          { templateKey: 'template.two', title: '盐蜥踪迹', description: '追踪盐蜥留下的脚印。' },
        ],
      } as never,
    })
    expect(result).toMatchObject({
      templateCount: 2, variantCount: 6, minimumVariantsPerTemplate: 3,
      exactDuplicateTitleCount: 1, exactDuplicateDescriptionCount: 1,
      maximumPairSimilarityBasisPoints: 10_000,
    })
  })

  it('回执合同拒绝把失败检查伪装成整体通过', () => {
    const base = {
      schema: 'storyforge.text-open-world-creator-calibration-evidence', version: 1,
      build: {
        productionKey: 'production.fixture', buildNumber: 1, packageHash: HASH,
        previewHash: HASH, manifestHash: HASH, qualityReportHash: HASH, rootTerminalReceiptHash: HASH,
      },
      generator: { provider: 'deepseek', model: 'deepseek-v4-pro', bindingHash: HASH },
      independentReview: {
        provider: 'claude', model: 'claude-sonnet-4-20250514', promptVersion: 'v1',
        inputHash: HASH, outputHash: HASH, inputTokens: 1, outputTokens: 1, finishReason: 'stop', durationMs: 1,
        scores: [
          { metricKey: 'mainline-quality', score: 90, rationale: '主线通过。' },
          { metricKey: 'significant-stories', score: 90, rationale: '支线通过。' },
          { metricKey: 'template-differentiation', score: 90, rationale: '模板通过。' },
        ], findings: [],
      },
      productionSemanticReview: { reviewHash: HASH, scores: [
        { metricKey: 'mainline-arc', score: 90, rationale: '通过。' },
        { metricKey: 'significant-stories', score: 90, rationale: '通过。' },
        { metricKey: 'repetition', score: 90, rationale: '通过。' },
      ] },
      templateDifferentiation: {
        templateCount: 1, variantCount: 3, minimumVariantsPerTemplate: 3,
        exactDuplicateTitleCount: 0, exactDuplicateDescriptionCount: 0, maximumPairSimilarityBasisPoints: 3000,
      },
      contentDuration: {
        mainlineMinutes: 100, optionalInventoryMinutes: 200, totalAuthoredMinutes: 300,
        typicalPlaythroughMinutes: 240, requestedMainlineMinimum: 90, requestedMainlineMaximum: 120,
        requestedOptionalMinimum: 180, requestedOptionalMaximum: 300,
      },
      productionUsage: {
        ledgerHash: HASH, modelCalls: 1, inputTokens: 1, outputTokens: 1, totalDurationMs: 1,
        averageCallDurationMs: 1, p95CallDurationMs: 1, maximumCallDurationMs: 1,
        estimatedTextCostUsd: 0, priceQuoteHash: HASH, priceQuoteSource: 'storyforge-catalog',
        priceQuoteAsOf: '2026-09-09', budgetMaximumCalls: 200, budgetMaximumInputTokens: 1_200_000,
        budgetMaximumOutputTokens: 360_000, budgetMaximumDurationMs: 1, budgetMaximumCostUsd: 30,
      },
      checks: [
        { key: 'a', passed: true, summary: 'a通过' }, { key: 'b', passed: true, summary: 'b通过' },
        { key: 'c', passed: true, summary: 'c通过' }, { key: 'd', passed: true, summary: 'd通过' },
        { key: 'e', passed: false, summary: 'e失败' },
      ], passed: true, evaluatedAt: 1,
    }
    expect(() => parseTextOpenWorldCreatorCalibrationEvidenceV1(base)).toThrow(/checks 与 passed 不一致/)
  })
})
