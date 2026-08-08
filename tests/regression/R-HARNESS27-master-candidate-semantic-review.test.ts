import { describe, expect, it } from 'vitest'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import { createAgentSkillExecutionBindingV1 } from '../../src/lib/agent/execution-binding'
import {
  buildMasterCandidateSemanticReviewPromptV1,
  createMasterCandidateSemanticReviewArtifactV1,
  masterCandidateReviewStepIdV1,
  parseMasterCandidateSemanticReviewArtifactV1,
  verifyMasterCandidateSemanticReviewArtifactV1,
} from '../../src/lib/agent/master-candidate-semantic-review'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { parseMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'

const GENERATION_MANIFEST = 'a'.repeat(64)
const REVIEW_MANIFEST = 'b'.repeat(64)
const CANDIDATE = '盐城由永不退去的潮汐维持，所有居民都记得海神的真名。'

function assembled(): AssembleContextResult {
  return {
    text: '盐城每夜退潮。居民从未知道海神真名。',
    segments: [{
      key: 'worldview',
      label: '世界观',
      content: '盐城每夜退潮。居民从未知道海神真名。',
      tokens: 18,
      priority: 100,
      required: true,
    }],
    included: ['worldview'],
    omitted: ['powerSystem'],
    trimmed: [],
    sourceEvidence: [
      {
        key: 'worldview',
        status: 'included',
        delivery: 'full',
        originalTokens: 18,
        inputTokens: 18,
      },
      {
        key: 'powerSystem',
        status: 'omitted',
        delivery: 'none',
        originalTokens: 0,
        inputTokens: 0,
      },
    ],
    totalInputTokens: 18,
    inputBudget: 10_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

function reviewer() {
  const skill = getAgentSkillV1('world-origin.review', 'world-origin')
  return {
    provider: 'review-provider',
    model: 'review-model',
    promptVersion: skill.promptVersion,
    executionBinding: createAgentSkillExecutionBindingV1(skill),
    correlatedJudge: false as const,
  }
}

function rawReview(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    verdict: 'block',
    findings: [{
      code: 'registered-source-contradiction',
      severity: 'blocking',
      message: '潮汐与居民知识均和登记世界观冲突。',
      candidateQuote: '永不退去的潮汐',
      sourceKey: 'worldview',
      sourceQuote: '盐城每夜退潮',
    }],
    ...overrides,
  })
}

async function artifact(raw = rawReview()) {
  return createMasterCandidateSemanticReviewArtifactV1({
    raw,
    taskId: 'world-1',
    domain: 'world-origin',
    runGeneration: 1,
    candidateStepId: 'master:world-1',
    reviewStepId: masterCandidateReviewStepIdV1('world-1', 1),
    attempt: 1,
    candidateText: CANDIDATE,
    generationContextManifestHash: GENERATION_MANIFEST,
    reviewContextManifestHash: REVIEW_MANIFEST,
    assembled: assembled(),
    reviewer: reviewer(),
    createdAt: 1_786_377_600_000,
  })
}

describe('R-HARNESS27 · fan-out 叶子证据型语义终验协议', () => {
  it('review Skill 只能由 Harness 调用，不能伪装成主计划生成任务取得采纳权限', () => {
    expect(() => parseMasterAgentPlanV1({
      summary: '错误地把 reviewer 当生成器。',
      tasks: [{
        id: 'review-as-generation',
        agentId: 'world-origin',
        skillId: 'world-origin.review',
        instruction: '执行 review。',
        dependsOn: [],
      }],
    })).toThrow('不是主计划可直接执行的生成 Skill')
  })

  it('按领域 Skill 形成独立 review Prompt，不把 reviewer 变成续写入口', () => {
    const messages = buildMasterCandidateSemanticReviewPromptV1({
      domain: 'world-origin',
      authorRequest: '建立潮汐世界。',
      candidateText: CANDIDATE,
      assembled: assembled(),
    })

    expect(messages).toHaveLength(2)
    expect(messages[0].content).toContain('不续写、不润色、不补设定')
    expect(messages[0].content).toContain('blocking 必须同时给出候选逐字引文')
    expect(messages[1].content).toContain('【worldview】')
    expect(messages[1].content).toContain(CANDIDATE)
  })

  it('blocking 必须同时绑定候选、登记来源、两个 manifest 和独立 reviewer', async () => {
    const result = await artifact()

    expect(result.verdict).toBe('block')
    expect(result.findings[0]).toMatchObject({
      candidateQuote: '永不退去的潮汐',
      sourceKey: 'worldview',
      sourceQuote: '盐城每夜退潮',
    })
    expect(result.generationContextManifestHash).toBe(GENERATION_MANIFEST)
    expect(result.reviewContextManifestHash).toBe(REVIEW_MANIFEST)
    expect(await verifyMasterCandidateSemanticReviewArtifactV1({
      artifact: result,
      candidateText: CANDIDATE,
      generator: { provider: 'generation-provider', model: 'generation-model' },
    })).toBe(true)
  })

  it('无登记来源证据的质量判断只能 warning，不能伪装成 blocking', async () => {
    const noSource = rawReview({
      findings: [{
        code: 'low-specificity',
        severity: 'blocking',
        message: '不够具体。',
        candidateQuote: '所有居民',
        sourceKey: null,
        sourceQuote: null,
      }],
    })
    await expect(artifact(noSource)).rejects.toThrow('blocking 缺少登记来源逐字证据')

    const warning = await artifact(JSON.stringify({
      verdict: 'pass',
      findings: [{
        code: 'low-specificity',
        severity: 'warning',
        message: '居民范围过于笼统。',
        candidateQuote: '所有居民',
        sourceKey: null,
        sourceQuote: null,
      }],
    }))
    expect(warning.verdict).toBe('pass')
  })

  it('模型伪造候选引文、来源引文、问题码或 verdict 时 fail closed', async () => {
    await expect(artifact(rawReview({
      findings: [{
        code: 'registered-source-contradiction',
        severity: 'blocking',
        message: '冲突。',
        candidateQuote: '候选中不存在',
        sourceKey: 'worldview',
        sourceQuote: '盐城每夜退潮',
      }],
    }))).rejects.toThrow('候选引文无法逐字定位')

    await expect(artifact(rawReview({
      findings: [{
        code: 'registered-source-contradiction',
        severity: 'blocking',
        message: '冲突。',
        candidateQuote: '永不退去的潮汐',
        sourceKey: 'worldview',
        sourceQuote: '来源中不存在',
      }],
    }))).rejects.toThrow('来源引文无法在 worldview 逐字定位')

    await expect(artifact(rawReview({
      findings: [{
        code: 'invented-code',
        severity: 'warning',
        message: '未知。',
        candidateQuote: '所有居民',
        sourceKey: null,
        sourceQuote: null,
      }],
    }))).rejects.toThrow('未登记问题码')

    await expect(artifact(rawReview({ verdict: 'pass' }))).rejects.toThrow('verdict 与 blocking')
  })

  it('候选、artifact、执行版本或 reviewer 独立性任一漂移都会失效', async () => {
    const result = await artifact()
    expect(await verifyMasterCandidateSemanticReviewArtifactV1({
      artifact: result,
      candidateText: `${CANDIDATE}篡改`,
      generator: { provider: 'generation-provider', model: 'generation-model' },
    })).toBe(false)
    expect(await verifyMasterCandidateSemanticReviewArtifactV1({
      artifact: result,
      candidateText: CANDIDATE,
      generator: { provider: 'review-provider', model: 'review-model' },
    })).toBe(false)

    const tampered = structuredClone(result)
    tampered.findings[0].message = '篡改后的结论'
    expect(await verifyMasterCandidateSemanticReviewArtifactV1({ artifact: tampered })).toBe(false)

    const unknown = { ...result, hiddenLabel: '不可进入 artifact' }
    expect(() => parseMasterCandidateSemanticReviewArtifactV1(unknown)).toThrow('字段不符合严格协议')
  })
})
