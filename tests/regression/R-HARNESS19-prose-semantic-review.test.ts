import { describe, expect, it, vi } from 'vitest'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import {
  runProseSemanticReviewCycleV1,
  verifyProseSemanticReviewArtifactV1,
  verifyProseSemanticRevisionArtifactV1,
} from '../../src/lib/agent/prose-semantic-review'
import { createAgentSkillExecutionBindingV1 } from '../../src/lib/agent/execution-binding'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'

const HASH = 'a'.repeat(64)

function assembled(): AssembleContextResult {
  return {
    text: '【章纲】潮门守卫不知道月井密钥。',
    segments: [{
      key: 'chapterOutline',
      label: '章纲',
      content: '潮门守卫不知道月井密钥。',
      tokens: 12,
      priority: 100,
      required: true,
    }],
    included: ['chapterOutline'],
    omitted: [],
    trimmed: [],
    sourceEvidence: [{
      key: 'chapterOutline',
      status: 'included',
      delivery: 'full',
      originalTokens: 12,
      inputTokens: 12,
    }],
    totalInputTokens: 12,
    inputBudget: 16_000,
  }
}

function reviewJson(candidateQuote: string, blocking = true): string {
  return JSON.stringify({
    issues: blocking ? [{
      code: 'pov-knowledge-leak',
      severity: 'blocking',
      candidateQuote,
      evidence: [{ sourceKey: 'chapterOutline', quote: '潮门守卫不知道月井密钥' }],
      reason: '守卫使用了尚未知晓的密钥。',
      revisionInstruction: '改为守卫只观察井门，不说出密钥。',
      autoRevisable: true,
    }] : [],
  })
}

function options(overrides: Partial<Parameters<typeof runProseSemanticReviewCycleV1>[0]> = {}) {
  const reviewerBinding = createAgentSkillExecutionBindingV1(getAgentSkillV1('prose.review'))
  const revisionBinding = createAgentSkillExecutionBindingV1(getAgentSkillV1('prose.revise'))
  return {
    chapterTitle: '潮门',
    originalText: '守卫说出了月井密钥。',
    generationMessages: [{ role: 'user' as const, content: '写潮门章节。' }],
    assembled: assembled(),
    contextManifestHashes: { initial: HASH, final: 'c'.repeat(64) },
    reviewer: {
      provider: 'test',
      model: 'reviewer-v1',
      promptVersion: 'prose-semantic-review-v1' as const,
      executionBinding: reviewerBinding,
      correlatedJudge: true,
    },
    revisionExecutionBinding: revisionBinding,
    budget: new AgentTeamBudgetTracker('balanced'),
    review: vi.fn(async () => reviewJson('守卫说出了月井密钥。', false)),
    revise: vi.fn(async () => '守卫只观察月井门。'),
    validateRevision: vi.fn(async () => []),
    now: () => 1_786_118_400_000,
    ...overrides,
  }
}

describe('R-HARNESS19 · 正文语义评审与一次定向修订', () => {
  it('无阻断问题时只评审一次并签发绑定候选与上下文的产物', async () => {
    const input = options()
    const result = await runProseSemanticReviewCycleV1(input)

    expect(result.status).toBe('passed')
    expect(result.outputText).toBe(input.originalText)
    expect(input.review).toHaveBeenCalledTimes(1)
    expect(input.revise).not.toHaveBeenCalled()
    expect(result.budget.calls).toBe(1)
    expect(await verifyProseSemanticReviewArtifactV1({
      artifact: result.finalReview,
      candidateText: result.outputText,
      contextManifestHash: HASH,
    })).toBe(true)
  })

  it('明确且可修订的 blocking 问题只修一次，并对修订稿重新评审', async () => {
    const review = vi.fn()
      .mockResolvedValueOnce(reviewJson('守卫说出了月井密钥。'))
      .mockResolvedValueOnce(reviewJson('守卫只观察月井门。', false))
    const input = options({ review })
    const result = await runProseSemanticReviewCycleV1(input)

    expect(result.status).toBe('passed')
    expect(result.outputText).toBe('守卫只观察月井门。')
    expect(review).toHaveBeenCalledTimes(2)
    expect(input.revise).toHaveBeenCalledTimes(1)
    expect(result.budget.calls).toBe(3)
    expect(result.initialReview.verdict).toBe('revise')
    expect(result.finalReview.verdict).toBe('pass')
    expect(result.revision?.issueCodes).toEqual(['pov-knowledge-leak'])
    expect(await verifyProseSemanticRevisionArtifactV1(result.revision!)).toBe(true)
  })

  it('修订稿触发确定性硬门时不允许语义复核覆盖，也不会无限修订', async () => {
    const input = options({
      review: vi.fn(async () => reviewJson('守卫说出了月井密钥。')),
      validateRevision: vi.fn(async () => [{ code: 'future-leak', message: '泄漏后续剧情' }]),
    })
    const result = await runProseSemanticReviewCycleV1(input)

    expect(result.status).toBe('blocked')
    expect(result.deterministicIssues).toEqual([{ code: 'future-leak', message: '泄漏后续剧情' }])
    expect(input.review).toHaveBeenCalledTimes(1)
    expect(input.revise).toHaveBeenCalledTimes(1)
  })

  it('第二次评审仍阻断时保留修订稿作为证据，但不返回可采纳状态', async () => {
    const review = vi.fn()
      .mockResolvedValueOnce(reviewJson('守卫说出了月井密钥。'))
      .mockResolvedValueOnce(reviewJson('守卫只观察月井门。'))
    const result = await runProseSemanticReviewCycleV1(options({ review }))

    expect(result.status).toBe('blocked')
    expect(result.outputText).toBe('守卫只观察月井门。')
    expect(result.finalReview.verdict).toBe('revise')
    expect(review).toHaveBeenCalledTimes(2)
  })

  it('伪造候选引文或来源归属时 fail closed，不把无证据意见当 blocking', async () => {
    const badCandidateQuote = options({
      review: vi.fn(async () => reviewJson('候选中不存在的句子。')),
    })
    await expect(runProseSemanticReviewCycleV1(badCandidateQuote))
      .rejects.toThrow('candidateQuote 不是候选逐字引文')

    const badEvidence = options({
      review: vi.fn(async () => JSON.stringify({
        issues: [{
          code: 'continuity-conflict',
          severity: 'blocking',
          candidateQuote: '守卫说出了月井密钥。',
          evidence: [{ sourceKey: 'storyCore', quote: '潮门守卫不知道月井密钥' }],
          reason: '冲突',
          revisionInstruction: '修复',
          autoRevisable: true,
        }],
      })),
    })
    await expect(runProseSemanticReviewCycleV1(badEvidence))
      .rejects.toThrow('不是声明来源的逐字引文')
  })

  it('评审产物、候选或 manifest 任一漂移都会失效', async () => {
    const result = await runProseSemanticReviewCycleV1(options())
    expect(await verifyProseSemanticReviewArtifactV1({
      artifact: result.finalReview,
      candidateText: `${result.outputText}篡改`,
      contextManifestHash: HASH,
    })).toBe(false)
    expect(await verifyProseSemanticReviewArtifactV1({
      artifact: result.finalReview,
      candidateText: result.outputText,
      contextManifestHash: 'b'.repeat(64),
    })).toBe(false)
  })
})
