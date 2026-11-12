import { installEvalWebLocksFixtureV1 } from '../helpers/eval-web-locks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { RACES_GATEWAY_EVAL_FIXTURES_V1 } from '../../src/lib/evals/races-gateway/fixtures'
import {
  parseRacesGatewayBlindGradeCompletionV2,
  parseRacesGatewayBlindGradeV1,
  scoreRacesGatewayEvalV1,
} from '../../src/lib/evals/races-gateway/scoring'
import {
  cleanupRacesGatewayEvalProjectsV1,
  loadRacesGatewayEvalCheckpointV1,
  runRacesGatewayEvalV1,
  verifyRacesGatewayEvalCheckpointV1,
} from '../../src/lib/evals/races-gateway/runner'
import type { RacesGatewayEvalResultV1 } from '../../src/lib/evals/races-gateway/types'
import { RacesGatewayBlindGraderFailureV1 } from '../../src/lib/evals/races-gateway/protocol'
import type { AIConfig } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'

const GENERATOR_CONFIG: AIConfig = {
  provider: 'deepseek', apiKey: 'test-key', baseUrl: 'https://example.invalid/v1',
  model: 'deepseek-chat', temperature: 0.7, maxTokens: 0,
}

function passingResult(index: number): RacesGatewayEvalResultV1 {
  const fixture = RACES_GATEWAY_EVAL_FIXTURES_V1[index]
  return {
    fixtureId: fixture.id,
    kind: fixture.kind,
    status: 'passed',
    failureStage: null,
    projectId: index + 1,
    runId: index + 1,
    candidateEventId: index + 1,
    candidateText: '具体候选',
    contextManifestHash: 'a'.repeat(64),
    transcriptArchive: null,
    selectedResourceKeys: [],
    mandatoryDelivered: fixture.kind === 'pinned-mandatory' ? true : null,
    expectedAnchorDelivered: fixture.kind === 'late-target' ? true : null,
    expectedAnchorInOutcome: fixture.kind === 'late-target' || fixture.kind === 'pinned-mandatory' ? true : null,
    staleBlocked: fixture.kind === 'concurrent-cas' ? true : null,
    crossScopeBlocked: fixture.kind === 'cross-scope-attack' ? true : null,
    grade: fixture.kind === 'empty' || fixture.kind === 'partial-world'
      || fixture.kind === 'pinned-mandatory' ? {
      placeholder: false,
      titleOveranchored: false,
      concrete: true,
      constraintsRespected: true,
      addsUsefulInformation: true,
      irrelevantMaterial: false,
      reason: '满足冻结标准。',
    } : null,
    gradeEvidence: null,
    gradeFailureEvidence: null,
    failureEvidence: null,
    structuredFailureEvidence: null,
    error: null,
    durationMs: 1,
  }
}

function preflightEvidence(provider: string, model: string, promptVersion: string) {
  return {
    provider,
    model,
    promptVersion,
    inputHash: '1'.repeat(64),
    outputHash: '2'.repeat(64),
    inputTokens: 10,
    outputTokens: 10,
    finishReason: 'stop',
    durationMs: 1,
  }
}

let restoreEvalWebLocks: (() => void) | undefined

beforeEach(async () => {
  restoreEvalWebLocks = installEvalWebLocksFixtureV1()
  await db.delete()
  await db.open()
  localStorage.clear()
  sessionStorage.clear()
  useAIConfigStore.setState({
    config: GENERATOR_CONFIG,
    presets: [],
    taskRoutes: {},
  })
})

afterEach(async () => {
  restoreEvalWebLocks?.()
  vi.unstubAllGlobals()
  await db.delete()
})

describe.sequential('RACE-6 · races transcript + outcome eval', () => {
  it('冻结 100 例互异矩阵并以全部门槛计算 sealed score', () => {
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1).toHaveLength(100)
    expect(new Set(RACES_GATEWAY_EVAL_FIXTURES_V1.map(item => item.id)).size).toBe(100)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'empty')).toHaveLength(20)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'partial-world')).toHaveLength(20)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'late-target')).toHaveLength(20)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'pinned-mandatory')).toHaveLength(10)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'cross-scope-attack')).toHaveLength(10)
    expect(RACES_GATEWAY_EVAL_FIXTURES_V1.filter(item => item.kind === 'concurrent-cas')).toHaveLength(10)
    const score = scoreRacesGatewayEvalV1(RACES_GATEWAY_EVAL_FIXTURES_V1.map((_, index) => passingResult(index)))
    expect(score).toMatchObject({ sampleCount: 100, completedCount: 100, passed: true, failures: [] })
    const structuredFailure = {
      ...passingResult(0),
      status: 'failed' as const,
      failureStage: 'generation' as const,
      failureEvidence: {
        version: 1 as const,
        failureClass: 'parse' as const,
        label: '模型输出解析',
        code: 'structured_output_repair_parse',
        retryable: false,
        fingerprint: 'f'.repeat(64),
      },
    }
    expect(scoreRacesGatewayEvalV1(
      RACES_GATEWAY_EVAL_FIXTURES_V1.map((_, index) => passingResult(index)),
      undefined,
      undefined,
      [{ fixtureId: 'empty-01', attempt: 1, recordedAt: 1, result: structuredFailure }],
    )).toMatchObject({
      passed: false,
      nonProviderAttemptFailureCount: 1,
      failures: ['存在非 Provider 的失败尝试'],
    })
  })

  it('盲评 JSON 使用严格闭集合同', () => {
    const valid = JSON.stringify({
      placeholder: false, titleOveranchored: false, concrete: true,
      constraintsRespected: true, addsUsefulInformation: true, irrelevantMaterial: false,
      reason: '给出了两个族群、组织与冲突。',
    })
    expect(parseRacesGatewayBlindGradeV1(valid).concrete).toBe(true)
    expect(() => parseRacesGatewayBlindGradeV1(valid.slice(0, -1))).toThrow('非法 JSON')
    expect(() => parseRacesGatewayBlindGradeV1(JSON.stringify({ ...JSON.parse(valid), extra: true })))
      .toThrow('字段不在闭集')
    expect(parseRacesGatewayBlindGradeCompletionV2(valid, 'length').concrete).toBe(true)
    expect(() => parseRacesGatewayBlindGradeCompletionV2(valid.slice(0, -1), 'length'))
      .toThrow('grader 输出被截断')
  })

  it('runner 拒绝生成模型自评，不能依赖 UI 约束', async () => {
    await expect(runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      generatorConfig: GENERATOR_CONFIG,
      graderIdentity: { provider: 'deepseek', model: 'deepseek-chat', promptVersion: 'test-grader-v1' },
      graderPreflight: preflightEvidence('deepseek', 'deepseek-chat', 'test-grader-v1'),
      fixtures: [RACES_GATEWAY_EVAL_FIXTURES_V1[0]],
      grade: vi.fn(),
    })).rejects.toThrow('必须使用不同提供商身份')
  })

  it('冻结 generator 预设贯穿 durable 执行并保留 V20 历史 key', async () => {
    const frozenGenerator: AIConfig = {
      provider: 'agnes', apiKey: 'agnes-test', baseUrl: 'https://agnes.invalid/v1',
      model: 'agnes-2.5-flash', temperature: 0.7, maxTokens: 0,
    }
    const routedElsewhere: AIConfig = {
      provider: 'deepseek', apiKey: 'routed-test', baseUrl: 'https://routed.invalid/v1',
      model: 'deepseek-v4-flash', temperature: 0.7, maxTokens: 0,
    }
    useAIConfigStore.setState({
      config: routedElsewhere,
      presets: [{ id: 'routed-elsewhere', name: '错误路由', config: routedElsewhere }],
      taskRoutes: { 'agent-world-origin': 'routed-elsewhere' },
    })
    localStorage.setItem('storyforge-races-gateway-eval-v20', 'archived-v20')
    const requestedModels: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      requestedModels.push(JSON.parse(String(init?.body)).model)
      return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
          field: 'races',
          value: '潮岸民以盐誓确认亲缘，塔城迁民以钟谱登记身份；双方围绕航道裁决形成长期冲突。',
        }) } }],
        usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
      }), { status: 200 })
    }))
    const fixture = RACES_GATEWAY_EVAL_FIXTURES_V1[0]
    const checkpoint = await runRacesGatewayEvalV1({
      modelIdentity: { provider: frozenGenerator.provider, model: frozenGenerator.model },
      generatorConfig: frozenGenerator,
      graderIdentity: { provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v13' },
      graderPreflight: preflightEvidence('nvidia', 'mistralai/mistral-nemotron', 'test-grader-v13'),
      fixtures: [fixture],
      grade: async () => ({
        grade: {
          placeholder: false, titleOveranchored: false, concrete: true,
          constraintsRespected: true, addsUsefulInformation: true, irrelevantMaterial: false,
          reason: '满足冻结标准。',
        },
        evidence: {
          provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v13',
          inputHash: 'b'.repeat(64), outputHash: 'c'.repeat(64),
          inputTokens: 10, outputTokens: 10, finishReason: 'stop', durationMs: 1,
        },
      }),
    })

    expect(requestedModels).toEqual(['agnes-2.5-flash'])
    expect(checkpoint).toMatchObject({
      version: 'races-gateway-eval-v21',
      modelIdentity: { provider: 'agnes', model: 'agnes-2.5-flash' },
    })
    expect(localStorage.getItem('storyforge-races-gateway-eval-v20')).toBe('archived-v20')
    expect(localStorage.getItem('storyforge-races-gateway-eval-v21')).toContain('races-gateway-eval-v21')
  })

  it('真实 grader 失败时签名失败 checkpoint，并立即清理当前隔离项目', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        field: 'races',
        value: '潮岸民以盐誓登记亲属，钟港民以师徒谱继承身份；双方共享航道，却长期争夺司法证言权。',
      }) } }],
      usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
    }), { status: 200 })))
    await expect(runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      generatorConfig: GENERATOR_CONFIG,
      graderIdentity: { provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v2' },
      graderPreflight: preflightEvidence('nvidia', 'mistralai/mistral-nemotron', 'test-grader-v2'),
      fixtures: [RACES_GATEWAY_EVAL_FIXTURES_V1[0]],
      grade: async () => {
        const rawOutput = '{"placeholder":false'
        throw new RacesGatewayBlindGraderFailureV1({
          provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v2',
          inputHash: 'a'.repeat(64), outputHash: await hashCanonicalValue(rawOutput),
          inputTokens: 10, outputTokens: 10, finishReason: 'length', durationMs: 1,
          rawOutput, parseError: 'grader 输出被截断',
        })
      },
    })).rejects.toThrow('empty-01 执行失败')
    const checkpoint = loadRacesGatewayEvalCheckpointV1()
    expect(checkpoint?.results[0]).toMatchObject({
      status: 'failed',
      failureStage: 'grader',
      projectId: null,
      candidateText: '潮岸民以盐誓登记亲属，钟港民以师徒谱继承身份；双方共享航道，却长期争夺司法证言权。',
      error: 'grader 输出被截断',
      gradeFailureEvidence: {
        rawOutput: '{"placeholder":false',
        finishReason: 'length',
      },
    })
    expect(checkpoint?.results[0].contextManifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(checkpoint?.results[0].transcriptArchive).not.toBeNull()
    expect(checkpoint?.attemptFailures).toHaveLength(1)
    expect(checkpoint?.attemptFailures[0]).toMatchObject({
      fixtureId: 'empty-01',
      attempt: 1,
      result: { status: 'failed', error: 'grader 输出被截断' },
    })
    expect(await verifyRacesGatewayEvalCheckpointV1(
      checkpoint!,
      [RACES_GATEWAY_EVAL_FIXTURES_V1[0]],
    )).toBe(true)
    const resumed = await runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      generatorConfig: GENERATOR_CONFIG,
      graderIdentity: { provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v2' },
      graderPreflight: preflightEvidence('nvidia', 'mistralai/mistral-nemotron', 'test-grader-v2'),
      fixtures: [RACES_GATEWAY_EVAL_FIXTURES_V1[0]],
      resumeFrom: checkpoint,
      grade: async () => ({
        grade: {
          placeholder: false, titleOveranchored: false, concrete: true,
          constraintsRespected: true, addsUsefulInformation: true, irrelevantMaterial: false,
          reason: '显式继续后完成。',
        },
        evidence: {
          provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v2',
          inputHash: 'b'.repeat(64), outputHash: 'c'.repeat(64),
          inputTokens: 10, outputTokens: 10, finishReason: 'stop', durationMs: 1,
        },
      }),
    })
    expect(resumed).toMatchObject({ status: 'completed', nextIndex: 1 })
    expect(resumed.results[0].status).toBe('passed')
    expect(resumed.attemptFailures).toHaveLength(1)
    expect(await verifyRacesGatewayEvalCheckpointV1(
      resumed,
      [RACES_GATEWAY_EVAL_FIXTURES_V1[0]],
    )).toBe(true)
    expect(await db.projects.count()).toBe(0)
    expect(await cleanupRacesGatewayEvalProjectsV1()).toBe(0)
  })

  it('结构化生成与唯一修复都失败时，在清理隔离项目之前归档 exact 原始响应', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: '这不是可解析的 JSON' } }],
      usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
    }), { status: 200 })))
    const fixtures = [RACES_GATEWAY_EVAL_FIXTURES_V1[0]]
    await expect(runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      generatorConfig: GENERATOR_CONFIG,
      graderIdentity: { provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v2' },
      graderPreflight: preflightEvidence('nvidia', 'mistralai/mistral-nemotron', 'test-grader-v2'),
      fixtures,
      grade: vi.fn(),
    })).rejects.toThrow('empty-01 执行失败')
    const checkpoint = loadRacesGatewayEvalCheckpointV1()!
    const failure = checkpoint.attemptFailures[0].result
    expect(failure).toMatchObject({
      status: 'failed',
      failureStage: 'generation',
      failureEvidence: { failureClass: 'parse', code: 'structured_output_repair_parse' },
      structuredFailureEvidence: {
        status: 'manual-repair',
        attempts: [
          { callIndex: 1, evidence: { originalText: '这不是可解析的 JSON' } },
          { callIndex: 2, evidence: { originalText: '这不是可解析的 JSON' } },
        ],
        repair: { result: 'failed' },
      },
      transcriptArchive: { version: 2 },
    })
    expect(await verifyRacesGatewayEvalCheckpointV1(checkpoint, fixtures)).toBe(true)
    expect(await db.projects.count()).toBe(0)
  })

  it('通过正式 durable races Harness 生成、保存 exact manifest，并拒绝 checkpoint 篡改', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        field: 'races',
        value: '雾港人以潮声确认亲缘，塔城迁民以钟谱登记身份；两群共享盐路，却因船籍继承长期冲突。',
      }) } }],
      usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
    }), { status: 200 })))
    const fixtures = [RACES_GATEWAY_EVAL_FIXTURES_V1[0]]
    const checkpoint = await runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      generatorConfig: GENERATOR_CONFIG,
      graderIdentity: { provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v1' },
      graderPreflight: preflightEvidence('nvidia', 'mistralai/mistral-nemotron', 'test-grader-v1'),
      fixtures,
      grade: async () => ({
        grade: {
          placeholder: false, titleOveranchored: false, concrete: true,
          constraintsRespected: true, addsUsefulInformation: true, irrelevantMaterial: false,
          reason: '有可用于故事的族群差异和冲突。',
        },
        evidence: {
          provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v1',
          inputHash: 'b'.repeat(64), outputHash: 'c'.repeat(64),
          inputTokens: 10, outputTokens: 10, finishReason: 'stop', durationMs: 1,
        },
      }),
    })
    expect(checkpoint.status).toBe('completed')
    expect(checkpoint.results[0]).toMatchObject({ status: 'passed', kind: 'empty' })
    expect(checkpoint.results[0].contextManifestHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await verifyRacesGatewayEvalCheckpointV1(checkpoint, fixtures)).toBe(true)
    expect(await verifyRacesGatewayEvalCheckpointV1({
      ...checkpoint,
      results: [{ ...checkpoint.results[0], candidateText: '篡改' }],
    }, fixtures)).toBe(false)
    expect(await cleanupRacesGatewayEvalProjectsV1()).toBe(0)
  })

  it('在同一冻结运行中以错误 scope 与并发 Canon 修改攻击真实候选', async () => {
    const responses = [
      '雾港人以潮声确认亲缘，塔城迁民以钟谱登记身份；两群因船籍继承长期冲突。',
      '海水保存死者遗言，因此听潮族负责司法取证，封耳族拒绝亡者证言；双方围绕港口审判权冲突。',
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        field: 'races', value: responses.shift(),
      }) } }],
      usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
    }), { status: 200 })))
    const fixtures = [
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'empty-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'partial-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'scope-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'cas-01')!,
    ]
    const checkpoint = await runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      generatorConfig: GENERATOR_CONFIG,
      graderIdentity: { provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v1' },
      graderPreflight: preflightEvidence('nvidia', 'mistralai/mistral-nemotron', 'test-grader-v1'),
      fixtures,
      grade: async () => ({
        grade: {
          placeholder: false, titleOveranchored: false, concrete: true,
          constraintsRespected: true, addsUsefulInformation: true, irrelevantMaterial: false,
          reason: '满足约束。',
        },
        evidence: {
          provider: 'nvidia', model: 'mistralai/mistral-nemotron', promptVersion: 'test-grader-v1',
          inputHash: 'b'.repeat(64), outputHash: 'c'.repeat(64),
          inputTokens: 10, outputTokens: 10, finishReason: 'stop', durationMs: 1,
        },
      }),
    })
    expect(checkpoint.results.map(item => item.status)).toEqual(['passed', 'passed', 'passed', 'passed'])
    expect(checkpoint.results[2].crossScopeBlocked).toBe(true)
    expect(checkpoint.results[3].staleBlocked).toBe(true)
    expect(await db.worldviews.toArray()).toSatisfy((rows: Array<{ races?: string }>) => (
      rows.every(row => !row.races?.trim())
    ))
    expect(await cleanupRacesGatewayEvalProjectsV1()).toBe(0)
  })

  it('以确定性模型替身覆盖八类编排，并在自包含证据落盘后清理隔离项目', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }
      const prompt = body.messages.map(message => message.content).join('\n')
      const late = /末位航契守卫\d+/.exec(prompt)?.[0]
      const pinned = /已确认成年仪式\d+/.exec(prompt)?.[0]
      const semanticPinned = pinned ? `${pinned.replace('已确认', '')}（已确认）` : undefined
      const retreat = /潮民以第\s*\d+\s*次退潮为成年界线，与钟民共用一座港口。/.exec(prompt)?.[0]
      const partial = [
        '这个世界的海水会记住死者最后一句话。',
        '大陆每五十年会失去一种颜色。',
        '城市依靠借来的影子供暖。',
        '魔法只能改变已经被人记录的事物。',
        '所有河流都从内陆流向天空。',
      ].find(item => prompt.includes(item))
      const anchor = late ?? semanticPinned ?? retreat ?? partial ?? ''
      const value = `${anchor}${anchor ? ' ' : ''}潮岸民以航季区分共同体，钟塔迁民以师徒谱登记身份；两群共享盐港，却因通行权、继承与司法证言形成可推动人物选择的长期冲突。`
      return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ field: 'races', value }) } }],
        usage: { prompt_tokens: 80, completion_tokens: 60, total_tokens: 140 },
      }), { status: 200 })
    }))
    const fixtures = [
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'empty-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'partial-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'late-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'pinned-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'compare-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'compare-02')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'scope-01')!,
      RACES_GATEWAY_EVAL_FIXTURES_V1.find(item => item.id === 'cas-01')!,
    ]
    const checkpoint = await runRacesGatewayEvalV1({
      modelIdentity: { provider: 'deepseek', model: 'deepseek-chat' },
      generatorConfig: GENERATOR_CONFIG,
      graderIdentity: { provider: 'fixture', model: 'deterministic', promptVersion: 'test-grader-v1' },
      graderPreflight: preflightEvidence('fixture', 'deterministic', 'test-grader-v1'),
      fixtures,
      grade: async () => ({
        grade: {
          placeholder: false, titleOveranchored: false, concrete: true,
          constraintsRespected: true, addsUsefulInformation: true, irrelevantMaterial: false,
          reason: '确定性替身用于验证矩阵，不作为模型质量结论。',
        },
        evidence: {
          provider: 'fixture', model: 'deterministic', promptVersion: 'test-grader-v1',
          inputHash: 'd'.repeat(64), outputHash: 'e'.repeat(64),
          inputTokens: 1, outputTokens: 1, finishReason: 'stop', durationMs: 1,
        },
      }),
    })
    expect(checkpoint.results).toHaveLength(8)
    expect(checkpoint.score).toMatchObject({ passed: true, completedCount: 8 })
    expect(checkpoint.results.filter(item => item.kind === 'late-target' && item.expectedAnchorDelivered)).toHaveLength(1)
    const pinnedResult = checkpoint.results.find(item => item.kind === 'pinned-mandatory')!
    const pinnedFixture = fixtures.find(item => item.kind === 'pinned-mandatory')!
    expect(pinnedResult.candidateText).not.toContain(pinnedFixture.expectedAnchor)
    expect(pinnedResult.expectedAnchorInOutcome).toBe(true)
    expect(checkpoint.results.filter(item => item.kind === 'late-target')
      .every(item => item.selectedResourceKeys.length <= 20)).toBe(true)
    expect(checkpoint.results.filter(item => item.kind === 'cross-scope-attack' && item.crossScopeBlocked)).toHaveLength(1)
    expect(checkpoint.results.filter(item => item.kind === 'concurrent-cas' && item.staleBlocked)).toHaveLength(1)
    expect(JSON.stringify(checkpoint).length).toBeLessThan(4_500_000)
    expect(await cleanupRacesGatewayEvalProjectsV1()).toBe(0)
  }, 30_000)
})
