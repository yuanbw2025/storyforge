import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import H86HumanReviewPanel from '../../src/components/settings/H86HumanReviewPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { db } from '../../src/lib/db/schema'
import {
  H86_AGENT_PROMPT_VERSION_V1,
  H86_GENERATOR_PAIR_VERSION_V1,
  H86_LEGACY_PROMPT_VERSION_V1,
  H86_VERIFIER_PROMPT_VERSION_V1,
  buildH86VerifierMessagesV1,
  createH86CallEvidenceV1,
  evaluateH86MachineGateV1,
  exportH86CheckpointV1,
  importH86CheckpointV1,
  parseH86LegacyStoryArcOutputV1,
  parseH86VerifierAssessmentV1,
  runH86StoryArcMainPathEvalV1,
  verifyH86CheckpointV1,
  type H86GenerationAttemptV1,
  type H86ModelIdentityV1,
  type H86VerificationAttemptV1,
} from '../../src/lib/evals/agent-harness/story-arc-main-path'
import {
  cleanupStrandedH86WorkspacesV1,
  createH86BrowserRunDependenciesV1,
} from '../../src/lib/evals/agent-harness/story-arc-main-path-browser'
import {
  __h86HumanReviewTestUtils,
  createH86HumanReviewV1,
  h86CheckpointHasCompletePairedOutputsV1,
  loadH86HumanReviewV1,
  persistH86HumanReviewV1,
  updateH86HumanReviewItemV1,
  verifyH86HumanReviewV1,
} from '../../src/lib/evals/agent-harness/story-arc-human-review'
import {
  H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1,
} from '../../src/lib/evals/agent-harness/story-arc-main-path-fixtures'
import type { AIConfig } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function waitForUi(assertion: () => void, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now()
  let lastError: unknown
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion()
      return
    } catch (cause) {
      lastError = cause
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}

const generator: H86ModelIdentityV1 = {
  provider: 'agnes',
  model: 'agnes-2.5-flash',
  promptVersion: H86_GENERATOR_PAIR_VERSION_V1,
}

const verifier: H86ModelIdentityV1 = {
  provider: 'doubao',
  model: 'deepseek-v4-pro-260425',
  promptVersion: H86_VERIFIER_PROMPT_VERSION_V1,
}

function generatedOutput(name: string): string {
  return JSON.stringify([{
    name,
    type: 'main',
    description: '一条尊重世界硬规则并形成因果递进的故事线。',
    stages: [
      { title: '触发', description: '角色遇到公开冲突并确认不可逆代价。', keyEvents: ['发现异常'] },
      { title: '追索', description: '角色依据现有证据追查来源并承担选择后果。', keyEvents: ['核对证据'] },
      { title: '抉择', description: '角色在既定限制下完成选择，不使用规则外捷径。', keyEvents: ['作出选择'] },
    ],
  }], null, 2)
}

async function generationAttempt(input: {
  variant: 'legacy-direct' | 'agent-harness'
  fixtureId: string
  attempt: number
  status?: 'succeeded' | 'provider-failed'
  promptVersion?: string
}): Promise<H86GenerationAttemptV1> {
  const promptVersion = input.variant === 'legacy-direct'
    ? H86_LEGACY_PROMPT_VERSION_V1
    : input.promptVersion ?? H86_AGENT_PROMPT_VERSION_V1
  const output = input.status === 'provider-failed' ? null : generatedOutput(input.fixtureId)
  const call = await createH86CallEvidenceV1({
    stage: 'generation',
    variant: input.variant,
    identity: { ...generator, promptVersion },
    messages: [{ role: 'user', content: input.fixtureId }],
    output,
    usage: output ? { inputTokens: 100, outputTokens: 50, durationMs: input.variant === 'legacy-direct' ? 100 : 90 } : null,
    status: output ? 'succeeded' : 'provider-failed',
    ...(output ? {} : { failureCode: 'provider_error', failureMessage: 'temporary outage' }),
  })
  if (!output) {
    return {
      attempt: input.attempt,
      status: 'provider-failed',
      output: '',
      outputHash: null,
      parserPassed: false,
      calls: [call],
      failureCode: 'provider_error',
      failureMessage: 'temporary outage',
    }
  }
  return {
    attempt: input.attempt,
    status: 'succeeded',
    output,
    outputHash: await hashCanonicalValue(output),
    parserPassed: true,
    calls: [call],
    ...(input.variant === 'agent-harness' ? {
      durableEvidence: {
        runEvidenceHash: await hashCanonicalValue({ fixtureId: input.fixtureId }),
        candidateHash: await hashCanonicalValue({ output, fixtureId: input.fixtureId }),
        contextSources: ['worldview', 'storyCore', 'characters', 'storyArcs'],
        projectionState: 'awaiting_confirmation',
        modelCalls: 1,
        candidatePersisted: true,
      },
    } : {}),
  }
}

async function verificationAttempt(input: {
  variant: 'legacy-direct' | 'agent-harness'
  fixtureIndex: number
  attempt: number
}): Promise<H86VerificationAttemptV1> {
  const fixture = H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1[input.fixtureIndex]
  const output = JSON.stringify({ fixtureId: fixture.id, variant: input.variant })
  const call = await createH86CallEvidenceV1({
    stage: 'verification',
    variant: input.variant,
    identity: verifier,
    messages: [{ role: 'user', content: output }],
    output,
    usage: { inputTokens: 80, outputTokens: 20, durationMs: 60 },
    status: 'succeeded',
  })
  return {
    attempt: input.attempt,
    status: 'succeeded',
    assessment: {
      semanticScore: input.variant === 'agent-harness' ? 0.92 : 0.9,
      causalCoherence: 0.9,
      specificity: 0.88,
      matchedRequiredFactIds: fixture.requiredFacts.map(item => item.id),
      missingRequiredFactIds: [],
      futureLeakage: false,
      wrongWorldLeakage: false,
    },
    calls: [call],
  }
}

async function completedCheckpoint() {
  return runH86StoryArcMainPathEvalV1({
    runId: 'h86-human-review-base',
    codeRevision: 'test-revision',
    generator,
    verifier,
    dependencies: {
      generate: async input => generationAttempt({
        variant: input.variant,
        fixtureId: input.fixture.id,
        attempt: input.attempt,
      }),
      verify: async input => verificationAttempt({
        variant: input.variant,
        fixtureIndex: H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.findIndex(item => item.id === input.fixture.id),
        attempt: input.attempt,
      }),
    },
  })
}

describe.sequential('R-HARNESS86 · 真实故事线主路径配对评测', { timeout: 30_000 }, () => {
  beforeEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    await db.delete()
    await db.open()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('冻结 6 个合成 development，并严格解析旧入口和独立 verifier 协议', () => {
    expect(H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1).toHaveLength(6)
    expect(new Set(H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.map(item => item.id)).size).toBe(6)
    const fixture = H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1[0]
    const legacy = parseH86LegacyStoryArcOutputV1(JSON.stringify({
      name: '潮汐主线',
      description: '守灯人查明真相。',
      stages: [
        { title: '一', description: '发现线索', keyEvents: ['退潮'] },
        { title: '二', description: '查明代价', keyEvents: ['查钟'] },
        { title: '三', description: '完成抉择', keyEvents: ['救城'] },
      ],
    }), fixture)
    expect(JSON.parse(legacy)[0]).toMatchObject({ type: 'main', name: '潮汐主线' })

    const assessment = parseH86VerifierAssessmentV1(JSON.stringify({
      semanticScore: 0.9,
      causalCoherence: 0.8,
      specificity: 0.7,
      matchedRequiredFactIds: ['f1', 'f2'],
      missingRequiredFactIds: ['f3', 'f4'],
      futureLeakage: false,
      wrongWorldLeakage: false,
    }), fixture)
    expect(assessment.matchedRequiredFactIds).toEqual(['f1', 'f2'])
    expect(() => parseH86VerifierAssessmentV1(JSON.stringify({
      ...assessment,
      hiddenLabel: 'leak',
    }), fixture)).toThrow('unknown_fields')
    expect(() => parseH86VerifierAssessmentV1(JSON.stringify({
      ...assessment,
      missingRequiredFactIds: ['f3'],
    }), fixture)).toThrow('fact_partition')
    expect(buildH86VerifierMessagesV1({ fixture, variant: 'agent-harness', output: legacy })[1].content)
      .not.toContain('hiddenLabel')
  })

  it('交叉执行 6 组配对、逐调用计量、durable 证据和 checkpoint 验签形成机器门', async () => {
    const checkpoints: string[] = []
    const record = await runH86StoryArcMainPathEvalV1({
      runId: 'h86-test-run',
      codeRevision: 'test-revision',
      generator,
      verifier,
      dependencies: {
        generate: async input => generationAttempt({
          variant: input.variant,
          fixtureId: input.fixture.id,
          attempt: input.attempt,
        }),
        verify: async input => verificationAttempt({
          variant: input.variant,
          fixtureIndex: H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.findIndex(item => item.id === input.fixture.id),
          attempt: input.attempt,
        }),
      },
      onCheckpoint: async checkpoint => { checkpoints.push(checkpoint.checkpointHash) },
    })

    expect(record.status).toBe('completed')
    expect(record.cases.map(item => item.executionOrder[0])).toEqual([
      'legacy-direct', 'agent-harness', 'legacy-direct', 'agent-harness', 'legacy-direct', 'agent-harness',
    ])
    expect(record.aggregate?.legacyDirect.totalCalls).toBe(12)
    expect(record.aggregate?.agentHarness.totalCalls).toBe(12)
    expect(record.aggregate?.agentHarness.durableEvidenceCoverage).toBe(1)
    expect(record.machineGate).toEqual({ passed: true, failures: [], humanReviewRequired: true })
    expect(evaluateH86MachineGateV1(record.aggregate!).passed).toBe(true)
    expect(checkpoints.length).toBeGreaterThanOrEqual(26)
    expect(await verifyH86CheckpointV1(record)).toBe(true)
    expect(await importH86CheckpointV1(await exportH86CheckpointV1(record))).toEqual(record)

    const tampered = structuredClone(record)
    tampered.cases[0].variants['agent-harness'].generationAttempts[0].output += '篡改'
    expect(await verifyH86CheckpointV1(tampered)).toBe(false)

    const unknownField = structuredClone(record) as typeof record & { hiddenLabel?: string }
    unknownField.hiddenLabel = 'must-not-enter-artifact'
    const { checkpointHash: _checkpointHash, ...body } = unknownField
    unknownField.checkpointHash = await hashCanonicalValue(body)
    expect(await verifyH86CheckpointV1(unknownField)).toBe(false)
  })

  it('新 Prompt 上线后仍能验签并导入所有已归档的 outline.story-arcs checkpoint', async () => {
    for (const promptVersion of [
      'outline.story-arcs-current-v1',
      'outline.story-arcs-v2',
      'outline.story-arcs-v3',
    ]) {
      const archived = await runH86StoryArcMainPathEvalV1({
        runId: `h86-archive-compatibility-${promptVersion}`,
        codeRevision: 'archived-revision',
        generator,
        verifier,
        dependencies: {
          generate: async input => generationAttempt({
            variant: input.variant,
            fixtureId: input.fixture.id,
            attempt: input.attempt,
            ...(input.variant === 'agent-harness' ? { promptVersion } : {}),
          }),
          verify: async input => verificationAttempt({
            variant: input.variant,
            fixtureIndex: H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.findIndex(item => item.id === input.fixture.id),
            attempt: input.attempt,
          }),
        },
      })

      expect(await verifyH86CheckpointV1(archived)).toBe(true)
      await expect(importH86CheckpointV1(await exportH86CheckpointV1(archived))).resolves.toEqual(archived)
    }
  })

  it('provider failure 单次停在可恢复 checkpoint，显式继续只重跑失败位置', async () => {
    let generationCalls = 0
    const first = await runH86StoryArcMainPathEvalV1({
      runId: 'h86-resume-run',
      codeRevision: 'test-revision',
      generator,
      verifier,
      dependencies: {
        generate: async input => {
          generationCalls += 1
          return generationAttempt({
            variant: input.variant,
            fixtureId: input.fixture.id,
            attempt: input.attempt,
            status: generationCalls === 1 ? 'provider-failed' : 'succeeded',
          })
        },
        verify: async input => verificationAttempt({
          variant: input.variant,
          fixtureIndex: H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.findIndex(item => item.id === input.fixture.id),
          attempt: input.attempt,
        }),
      },
    })
    expect(first.status).toBe('provider-blocked')
    expect(first.cases[0].variants['legacy-direct'].generationAttempts).toHaveLength(1)
    expect(await verifyH86CheckpointV1(first)).toBe(true)

    const callsBeforeNoRetry = generationCalls
    const unchanged = await runH86StoryArcMainPathEvalV1({
      runId: 'h86-resume-run',
      codeRevision: 'test-revision',
      generator,
      verifier,
      resumeFrom: first,
      dependencies: {
        generate: async input => {
          generationCalls += 1
          return generationAttempt({
            variant: input.variant,
            fixtureId: input.fixture.id,
            attempt: input.attempt,
          })
        },
        verify: async input => verificationAttempt({
          variant: input.variant,
          fixtureIndex: H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.findIndex(item => item.id === input.fixture.id),
          attempt: input.attempt,
        }),
      },
    })
    expect(unchanged).toEqual(first)
    expect(generationCalls).toBe(callsBeforeNoRetry)

    const resumed = await runH86StoryArcMainPathEvalV1({
      runId: 'h86-resume-run',
      codeRevision: 'test-revision',
      generator,
      verifier,
      resumeFrom: first,
      retryFailed: true,
      dependencies: {
        generate: async input => {
          generationCalls += 1
          return generationAttempt({
            variant: input.variant,
            fixtureId: input.fixture.id,
            attempt: input.attempt,
          })
        },
        verify: async input => verificationAttempt({
          variant: input.variant,
          fixtureIndex: H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.findIndex(item => item.id === input.fixture.id),
          attempt: input.attempt,
        }),
      },
    })
    expect(resumed.status).toBe('completed')
    expect(resumed.cases[0].variants['legacy-direct'].generationAttempts).toHaveLength(2)
    expect(resumed.cases[0].variants['agent-harness'].generationAttempts).toHaveLength(1)
    expect(generationCalls).toBe(13)
  })

  it('模型返回可计量但不可解析的协议失败会计入完成率并继续剩余配对，不被伪装成环境阻断', async () => {
    let injected = false
    const record = await runH86StoryArcMainPathEvalV1({
      runId: 'h86-protocol-failure-run',
      codeRevision: 'test-revision',
      generator,
      verifier,
      dependencies: {
        generate: async input => {
          const success = await generationAttempt({
            variant: input.variant,
            fixtureId: input.fixture.id,
            attempt: input.attempt,
          })
          if (!injected && input.variant === 'legacy-direct') {
            injected = true
            return {
              ...success,
              status: 'protocol-failed',
              output: '',
              outputHash: null,
              parserPassed: false,
              failureCode: 'legacy_parse_failed',
              failureMessage: 'invalid JSON',
            }
          }
          return success
        },
        verify: async input => verificationAttempt({
          variant: input.variant,
          fixtureIndex: H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.findIndex(item => item.id === input.fixture.id),
          attempt: input.attempt,
        }),
      },
    })

    expect(record.status).toBe('completed')
    expect(record.aggregate?.legacyDirect.completionRate).toBe(5 / 6)
    expect(record.aggregate?.legacyDirect.verifierCompletionRate).toBe(5 / 6)
    expect(record.aggregate?.agentHarness.completionRate).toBe(1)
    expect(record.machineGate?.passed).toBe(false)
    expect(record.machineGate?.failures).toContain('legacy-completion')
    expect(h86CheckpointHasCompletePairedOutputsV1(record)).toBe(false)
    expect(await verifyH86CheckpointV1(record)).toBe(true)
  })

  it('人工复核按 A/B 盲序记录四维评分、修订量和偏好，完成后才揭示聚合且不授权生产发布', async () => {
    const checkpoint = await completedCheckpoint()
    expect(h86CheckpointHasCompletePairedOutputsV1(checkpoint)).toBe(true)
    let review = await createH86HumanReviewV1({ checkpoint, reviewer: 'independent-human', now: 1 })
    expect(review.status).toBe('running')
    expect(review.items).toHaveLength(6)
    expect(review.items.every(item => new Set(item.blindOrder).size === 2)).toBe(true)

    for (const [index, item] of review.items.entries()) {
      const score = {
        constraintFaithfulness: 4,
        causalCoherence: 4,
        specificity: 4,
        authorUsability: 4,
        editedOutput: item.candidateA,
        notes: '',
      }
      review = await updateH86HumanReviewItemV1({
        record: review,
        fixtureId: item.fixtureId,
        reviewA: score,
        reviewB: { ...score, editedOutput: item.candidateB },
        preference: 'tie',
        now: index + 2,
      })
    }
    expect(review.status).toBe('completed')
    expect(review.aggregate).toMatchObject({
      legacyDirect: { reviewedCases: 6, averageLineEditRatio: 0 },
      agentHarness: { reviewedCases: 6, averageLineEditRatio: 0 },
      ties: 6,
    })
    expect(review.gate).toEqual({ passed: true, failures: [], productionReleaseAllowed: false })
    expect(await verifyH86HumanReviewV1(review)).toBe(true)
    expect(__h86HumanReviewTestUtils.lineEditRatio('a\nb', 'a\nc')).toBeGreaterThan(0)

    const tampered = structuredClone(review)
    tampered.items[0].reviewA!.authorUsability = 5
    expect(await verifyH86HumanReviewV1(tampered)).toBe(false)
  })

  it('人工盲评 UI 只暴露 A/B 与公开约束，并逐例持久化而不提前揭盲', async () => {
    const checkpoint = await completedCheckpoint()
    const review = await createH86HumanReviewV1({ checkpoint, reviewer: 'external-reviewer', now: 1 })
    await persistH86HumanReviewV1(review)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(createElement(DialogProvider, null, createElement(H86HumanReviewPanel, { checkpoint })))
      })
      await waitForUi(() => {
        expect(host.querySelector('[data-testid="h86-human-current-case"]')).not.toBeNull()
      })
      const section = host.querySelector('[data-testid="h86-human-review"]')
      expect(section?.textContent).toContain('候选 A')
      expect(section?.textContent).toContain('候选 B')
      expect(section?.textContent).toContain('作者请求')
      expect(section?.textContent).not.toContain('旧直连')
      expect(section?.textContent).not.toContain('Agent/Harness')

      await act(async () => {
        section?.querySelector<HTMLButtonElement>('[data-testid="h86-save-human-case"]')?.click()
      })
      await waitForUi(() => {
        expect(host.querySelector('[data-testid="h86-human-progress"]')?.textContent).toBe('1/6')
      })
      expect(host.querySelector('[data-testid="h86-human-progress"]')?.textContent).toBe('1/6')
      expect((await loadH86HumanReviewV1())?.items.filter(item => item.reviewA != null)).toHaveLength(1)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('浏览器执行器使用隔离项目跑旧 Prompt 与真实 durable 候选，并沿注册表清理全部临时数据', async () => {
    const config: AIConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      model: 'generator-test',
      temperature: 0.55,
      maxTokens: 6_000,
      contextWindow: 128_000,
    }
    let agentCalls = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>
        response_format?: { type: string }
      }
      const prompt = body.messages.map(message => message.content).join('\n')
      const isAgent = prompt.includes('当前执行 story-arcs Skill')
      if (isAgent) {
        agentCalls += 1
        expect(body.response_format).toEqual({ type: 'json_object' })
      } else {
        expect(body.response_format).toBeUndefined()
      }
      const content = isAgent
        ? agentCalls === 1
          ? '这不是 JSON'
          : JSON.stringify({ storyArcs: JSON.parse(generatedOutput('Agent 候选')) })
        : JSON.stringify({
            name: '旧入口候选',
            description: '旧入口生成的故事线。',
            stages: [
              { title: '触发', description: '触发冲突', keyEvents: ['事件一'] },
              { title: '升级', description: '升级冲突', keyEvents: ['事件二'] },
              { title: '解决', description: '解决冲突', keyEvents: ['事件三'] },
            ],
          })
      return new Response(JSON.stringify({
        choices: [{ message: { content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const dependencies = createH86BrowserRunDependenciesV1({
      generatorConfig: config,
      verifierConfig: { ...config, model: 'verifier-test' },
    })
    const fixture = H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1[0]
    const legacy = await dependencies.generate({
      fixture,
      variant: 'legacy-direct',
      generator: { provider: 'openai', model: 'generator-test', promptVersion: H86_GENERATOR_PAIR_VERSION_V1 },
      attempt: 1,
    })
    const agent = await dependencies.generate({
      fixture,
      variant: 'agent-harness',
      generator: { provider: 'openai', model: 'generator-test', promptVersion: H86_GENERATOR_PAIR_VERSION_V1 },
      attempt: 1,
    })

    expect(legacy).toMatchObject({ status: 'succeeded', parserPassed: true })
    expect(agent).toMatchObject({
      status: 'succeeded',
      parserPassed: true,
      durableEvidence: {
        candidatePersisted: true,
        modelCalls: 2,
        projectionState: 'awaiting_confirmation',
      },
    })
    expect(agent.calls).toHaveLength(2)
    expect(agent.durableEvidence?.contextSources).toEqual(expect.arrayContaining([
      'projectStatus', 'worldview', 'storyCore', 'characters',
    ]))
    expect(await db.projects.filter(project => project.name.startsWith('[H86-EVAL] ')).count()).toBe(0)
    expect(await cleanupStrandedH86WorkspacesV1()).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('verifier 仅对中央能力表已验证的 provider 发送 JSON object 模式', async () => {
    const requestBodies: Array<{ response_format?: { type: string } }> = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as { response_format?: { type: string } })
      const fixture = H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1[0]
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              semanticScore: 0.9,
              causalCoherence: 0.8,
              specificity: 0.7,
              matchedRequiredFactIds: fixture.requiredFacts.map(item => item.id),
              missingRequiredFactIds: [],
              futureLeakage: false,
              wrongWorldLeakage: false,
            }),
          },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const baseConfig: AIConfig = {
      provider: 'openai',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      model: 'verifier-test',
      temperature: 0,
      maxTokens: 2_000,
      contextWindow: 128_000,
    }
    const fixture = H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1[0]
    const verify = async (provider: AIConfig['provider']) => createH86BrowserRunDependenciesV1({
      generatorConfig: baseConfig,
      verifierConfig: { ...baseConfig, provider },
    }).verify({
      fixture,
      variant: 'agent-harness',
      output: generatedOutput('待验证候选'),
      outputHash: await hashCanonicalValue(generatedOutput('待验证候选')),
      verifier: { provider, model: 'verifier-test', promptVersion: H86_VERIFIER_PROMPT_VERSION_V1 },
      attempt: 1,
    })

    await expect(verify('openai')).resolves.toMatchObject({ status: 'succeeded' })
    await expect(verify('custom')).resolves.toMatchObject({ status: 'succeeded' })
    expect(requestBodies[0].response_format).toEqual({ type: 'json_object' })
    expect(requestBodies[1].response_format).toBeUndefined()
  })
})
