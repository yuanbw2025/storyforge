import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  buildTextOpenWorldCreatorCalibrationContextV1,
  projectTextOpenWorldTemplateDifferentiationV1,
  runTextOpenWorldCreatorIndependentCalibrationReviewV1,
  TextOpenWorldCreatorCalibrationOutputErrorV1,
  type TextOpenWorldCreatorCalibrationReviewContextV1,
} from '../../src/lib/open-world/creator-quality-calibration'
import {
  parseTextOpenWorldCreatorCalibrationEvidence,
  parseTextOpenWorldCreatorCalibrationEvidenceV1,
} from '../../src/lib/open-world/creator-quality-contract'
import { projectProductProductionObservedTextLatencyV1 } from '../../src/lib/product-production/scheduler'

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

function templateInputs() {
  return {
    regions: {
      regionNarrativePacksHash: HASH,
      packs: [{ regionKey: 'region.ridge', identity: {}, taskTemplateSeeds: [
        { key: 'seed.one', title: '井边求助', storyFrame: '井边生活', variationAxes: ['障碍'] },
        { key: 'seed.two', title: '商队委托', storyFrame: '商路生活', variationAxes: ['来源'] },
      ] }],
    },
    quests: {
      regionNarrativePacksHash: HASH, questSkeletonsHash: HASH,
      // Deliberately reordered; identity is established by references.
      quests: [
        { key: 'quest.second', type: 'template', source: { kind: 'template-seed', sourceKey: 'seed.two' } },
        { key: 'quest.first', type: 'template', source: { kind: 'template-seed', sourceKey: 'seed.one' } },
      ],
    },
    director: {
      regionNarrativePacksHash: HASH, directorDecksHash: HASH,
      templates: [
        { key: 'runtime.beta', questKey: 'quest.second', variantTextRequirementKeys: ['b1', 'b2', 'b3'] },
        { key: 'runtime.alpha', questKey: 'quest.first', variantTextRequirementKeys: ['a1', 'a2', 'a3'] },
      ],
    },
    scenes: {
      regionNarrativePacksHash: HASH, questSkeletonsHash: HASH, directorDecksHash: HASH,
      templateTextVariants: [
        { templateKey: 'runtime.alpha', requirementKey: 'a1', title: '寻找盐袋', description: '帮助老人寻找丢失的盐袋。' },
        { templateKey: 'runtime.alpha', requirementKey: 'a2', title: '寻找盐袋', description: '帮助老人寻找丢失的盐袋。' },
        { templateKey: 'runtime.alpha', requirementKey: 'a3', title: '断裂井绳', description: '修好风中断裂的井绳。' },
        { templateKey: 'runtime.beta', requirementKey: 'b1', title: '水票争执', description: '调解商队的水票争执。' },
        { templateKey: 'runtime.beta', requirementKey: 'b2', title: '潮井异响', description: '调查夜间潮井异响。' },
        { templateKey: 'runtime.beta', requirementKey: 'b3', title: '盐蜥踪迹', description: '追踪盐蜥留下的脚印。' },
      ],
    },
  }
}

describe('TOW-G7-11 · 发布候选叙事、重复、时长和成本校准', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => { vi.unstubAllGlobals(); db.close() })

  it('校准复用正式尝试账本，保留已知失败调用并排除未知预留和作者上限计费', () => {
    const attempt = (runId: number, modelCalls: number, durationMs: number) => ({
      controlEpoch: runId, taskKey: 'p9.scene-scripts', runId, attempt: 1,
      idempotencyKey: HASH, outcome: 'settled', errorCode: null, usageKnown: true,
      usage: { modelCalls, durationMs, inputTokens: 100, outputTokens: 10,
        mediaCalls: 0, costUsd: null, storageBytes: 0 },
    })
    const ledger = { schema: 'storyforge.product-production-budget-ledger', version: 2,
      rootRunId: 1, rootClaim: null, tasks: {}, attempts: [
        attempt(2, 2, 1000),
        { ...attempt(3, 1, 1500), outcome: 'failed', errorCode: 'provider-output-invalid' },
        { ...attempt(4, 10, 100000), usageKnown: false },
        { ...attempt(5, 10, 100000), resolution: 'author-charged-reservation-upper-bound' },
        { ...attempt(6, 0, 0), outcome: 'failed', usageKnown: false, usage: null },
      ] }
    const source = JSON.stringify(ledger)
    expect(projectProductProductionObservedTextLatencyV1(source)).toEqual({
      modelCalls: 3, averageCallDurationMs: 833, p95CallDurationMs: 1500, maximumCallDurationMs: 1500,
    })
    expect(JSON.stringify(ledger)).toBe(source)
    ledger.attempts.push(ledger.attempts[0]!)
    expect(() => projectProductProductionObservedTextLatencyV1(JSON.stringify(ledger))).toThrow('身份重复')
  })

  it('旧版正式任务账本经同一解析器兼容，不接受虚构charges格式或损坏的用量', () => {
    const ledger = { schema: 'storyforge.product-production-budget-ledger', version: 1,
      rootRunId: 1, rootClaim: null, tasks: { 'p1.foundation': {
        runId: 2, attempt: 1, status: 'settled', idempotencyKey: HASH,
        candidateHash: HASH, terminalReceiptHash: HASH, passedGateIds: [], errorCode: null,
        usage: { modelCalls: 2, durationMs: 600, inputTokens: 100, outputTokens: 10,
          mediaCalls: 0, costUsd: null, storageBytes: 0 },
      } } }
    expect(projectProductProductionObservedTextLatencyV1(JSON.stringify(ledger)))
      .toEqual({ modelCalls: 2, averageCallDurationMs: 300, p95CallDurationMs: 300, maximumCallDurationMs: 300 })
    expect(() => projectProductProductionObservedTextLatencyV1(JSON.stringify({ ...ledger, charges: {} }))).toThrow()
    ledger.tasks['p1.foundation'].usage.modelCalls = -1
    expect(() => projectProductProductionObservedTextLatencyV1(JSON.stringify(ledger))).toThrow('modelCalls')
  })

  it.each(['plain', 'fenced'] as const)('独立grader走登记的只读入口并冻结用量、延迟和原始输出Hash (%s)', async format => {
    const grade = {
      schema: 'storyforge.text-open-world-creator-calibration-grade', version: 1,
      scores: [
        { metricKey: 'mainline-quality', score: 91, rationale: '目标、揭示和结局回收闭合。' },
        { metricKey: 'significant-stories', score: 88, rationale: '配角冲突具备三段升级。' },
        { metricKey: 'template-differentiation', score: 86, rationale: '三份变体的动机和阻碍不同。' },
      ], findings: [],
    }
    const output = format === 'fenced' ? '```json\n' + JSON.stringify(grade) + '\n```' : JSON.stringify(grade)
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'tow-g7-11', object: 'chat.completion',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: output } }],
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
    const { hashCanonicalValue } = await import('../../src/lib/agent/run/hash')
    expect(evidence.outputHash).toBe(await hashCanonicalValue(output))
    expect(JSON.stringify(evidence)).not.toContain('must-not-enter-evidence')
  })

  it.each(['说明\n```json\n{}\n```', '```json\n{}', '{}\n{}'])('不修补含额外正文、截断或多个对象的grader输出: %s', async output => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: output } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const failure = await runTextOpenWorldCreatorIndependentCalibrationReviewV1({ projectId: 701,
      config: { provider: 'agnes', apiKey: 'secret-must-not-be-exported', model: 'independent-grader',
        baseUrl: 'https://grader.example/v1', temperature: 0.7, maxTokens: 0 },
      context: reviewContext(),
    }).catch(cause => cause)
    expect(failure).toBeInstanceOf(TextOpenWorldCreatorCalibrationOutputErrorV1)
    expect(failure.diagnostic).toMatchObject({ rawOutput: output, buildPackageHash: HASH,
      provider: 'agnes', model: 'independent-grader', finishReason: 'stop', inputTokens: null, outputTokens: null })
    expect(failure.message).toContain('合法JSON')
    expect(JSON.stringify(failure.diagnostic)).not.toContain('secret-must-not-be-exported')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['unescaped-quote', '合法JSON'],
    ['input-schema', '身份或数量无效'],
    ['misspelled-rationale', '字段不精确'],
  ] as const)('真实评审暴露的%s仍保留失败原文和用量，不修补或自动重发', async (defect, issue) => {
    const grade = {
      schema: 'storyforge.text-open-world-creator-calibration-grade', version: 1,
      scores: [
        { metricKey: 'mainline-quality', score: 90, rationale: 'quote-marker' },
        { metricKey: 'significant-stories', score: 90, rationale: '冲突逐步升级。' },
        { metricKey: 'template-differentiation', score: 90, rationale: '动机与阻碍具有差异。' },
      ], findings: [],
    }
    if (defect === 'input-schema') grade.schema = 'storyforge.text-open-world-creator-calibration-review-input'
    let output = JSON.stringify(grade)
    if (defect === 'unescaped-quote') output = output.replace('quote-marker', '目标"共同生存"闭合。')
    if (defect === 'misspelled-rationale') output = output.replace('"rationale"', '"rationage"')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: output } }],
      usage: { prompt_tokens: 4503, completion_tokens: 1356 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const failure = await runTextOpenWorldCreatorIndependentCalibrationReviewV1({
      projectId: 701,
      config: { provider: 'agnes', apiKey: 'fake-local-test-key', model: 'independent-grader',
        baseUrl: 'https://grader.example/v1', temperature: 0.7, maxTokens: 0 },
      context: reviewContext(),
    }).catch(cause => cause)
    expect(failure).toBeInstanceOf(TextOpenWorldCreatorCalibrationOutputErrorV1)
    expect(failure.message).toContain(issue)
    expect(failure.diagnostic).toMatchObject({
      rawOutput: output, buildPackageHash: HASH, inputTokens: 4503, outputTokens: 1356,
      finishReason: 'stop', promptVersion: 'text-open-world-release-calibration-grader.v3',
    })
    const { hashCanonicalValue } = await import('../../src/lib/agent/run/hash')
    expect(failure.diagnostic.outputHash).toBe(await hashCanonicalValue(output))
    expect(JSON.stringify(failure.diagnostic)).not.toContain('fake-local-test-key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('代码量化每模板三份变体，并识别精确重复与近似重复', () => {
    const result = projectTextOpenWorldTemplateDifferentiationV1(templateInputs() as never)
    expect(result).toMatchObject({
      templateCount: 2, variantCount: 6, minimumVariantsPerTemplate: 3,
      exactDuplicateTitleCount: 1, exactDuplicateDescriptionCount: 1,
      maximumPairSimilarityBasisPoints: 10_000,
    })
  })

  it('独立grader输入沿种子到任务到运行模板链携带真实变体', () => {
    const context = buildTextOpenWorldCreatorCalibrationContextV1({
      ...templateInputs(), buildPackageHash: HASH,
      mainline: { thread: {}, stages: [], endingRoutes: [] }, significant: { threads: [] },
      contentBudget: { inventory: {}, singlePlaythrough: {}, requested: { requiredPlayMinuteRange: {}, optionalInventoryMinuteRange: {} } },
    } as never)
    expect(context.templateVariants.map(group => [group.templateKey, group.variants.map(variant => variant.title)])).toEqual([
      ['seed.one', ['寻找盐袋', '寻找盐袋', '断裂井绳']],
      ['seed.two', ['水票争执', '潮井异响', '盐蜥踪迹']],
    ])
  })

  it('缺少变体仍按实际零份计算，不从另一个模板借用', () => {
    const input = templateInputs()
    input.scenes.templateTextVariants = input.scenes.templateTextVariants.filter(row => row.templateKey === 'runtime.alpha')
    expect(projectTextOpenWorldTemplateDifferentiationV1(input as never)).toMatchObject({
      templateCount: 2, variantCount: 3, minimumVariantsPerTemplate: 0,
    })
  })

  it.each([
    ['来源Hash不闭合', (input: ReturnType<typeof templateInputs>) => { input.scenes.directorDecksHash = 'b'.repeat(64) }],
    ['任务来源丢失', (input: ReturnType<typeof templateInputs>) => { input.quests.quests[0]!.source.sourceKey = 'missing' }],
    ['重复运行模板', (input: ReturnType<typeof templateInputs>) => { input.director.templates[0]!.key = 'runtime.alpha' }],
    ['两个运行模板绑定同一任务', (input: ReturnType<typeof templateInputs>) => { input.director.templates[0]!.questKey = 'quest.first' }],
    ['变体来源越界', (input: ReturnType<typeof templateInputs>) => { input.scenes.templateTextVariants[0]!.templateKey = 'seed.one' }],
    ['变体要求重复', (input: ReturnType<typeof templateInputs>) => { input.scenes.templateTextVariants[1]!.requirementKey = 'a1' }],
    ['变体要求跨模板', (input: ReturnType<typeof templateInputs>) => { input.scenes.templateTextVariants[0]!.requirementKey = 'b1' }],
  ] as const)('%s时不向独立评审伪装有效模板输入', (_label, mutate) => {
    const input = templateInputs()
    mutate(input)
    expect(() => projectTextOpenWorldTemplateDifferentiationV1(input as never)).toThrow(/模板/)
    expect(() => buildTextOpenWorldCreatorCalibrationContextV1({ ...input } as never)).toThrow(/模板/)
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
    base.passed = false
    expect(parseTextOpenWorldCreatorCalibrationEvidence(base)).toEqual(parseTextOpenWorldCreatorCalibrationEvidenceV1(base))
    const source = {
      buildNumber: base.build.buildNumber, briefHash: HASH, planHash: HASH,
      origin: 'creator-start-v1', proofHash: HASH, usage: base.productionUsage,
      observedModelCalls: 1, observedInputTokens: 1, observedOutputTokens: 1,
      unknownAttemptCount: 0, chargedUpperBoundAttemptCount: 0,
    }
    const v2 = { ...base, version: 2, productionLineage: [source], reusedReviewReceiptHash: null }
    expect(parseTextOpenWorldCreatorCalibrationEvidence(v2).version).toBe(2)
    expect(() => parseTextOpenWorldCreatorCalibrationEvidenceV1(v2)).toThrow()
    expect(() => parseTextOpenWorldCreatorCalibrationEvidence({ ...v2, productionLineage: [] })).toThrow()
    expect(() => parseTextOpenWorldCreatorCalibrationEvidence({ ...v2,
      productionLineage: [{ ...source, observedModelCalls: 2 }] })).toThrow('实测用量')
    expect(() => parseTextOpenWorldCreatorCalibrationEvidence({ ...v2,
      productionLineage: [{ ...source, buildNumber: source.buildNumber + 1 }] })).toThrow('不闭合')
  })
})
