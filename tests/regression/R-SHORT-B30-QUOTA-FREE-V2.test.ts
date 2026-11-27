import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { ShortNovelBriefV1, ShortNovelReviewV1, ShortNovelStoryDesignV1 } from '../../src/lib/types'
import { generateShortNovelCandidateV1 } from '../../src/lib/agent/run/short-novel-durable'
import { parseShortNovelBriefV1, parseShortNovelReviewV1, parseShortNovelStoryDesignV1 } from '../../src/lib/short-novel/contracts'
import { buildShortNovelPromptV1 } from '../../src/lib/short-novel/prompts'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

describe('B30 · 短篇候选不再落固定输入/输出/条数配额', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('Brief 候选的调用不带 8k/16k 输出覆盖，装配不再声明 64k 输入预算', async () => {
    const created = await seedCurrentWorkspace('B30-quota', { targetWordCount: 6_000, novelProfile: 'short' })
    const scope = created.scope
    const brief: ShortNovelBriefV1 = {
      version: 1,
      premise: '守灯人在风暴夜发现一封没有寄件人的信。',
      coreChange: '从遵守时刻表到亲手熄灭航标。',
      dominantEmotion: '克制的悬疑',
      pointOfView: 'third-limited',
      tense: 'past',
      audience: '中文短篇读者',
      storyPromise: '寄件人身份在最后一章兑现。',
      mustKeep: ['风暴夜', '守灯人'],
      forbidden: ['梦醒式结局'],
      targetWordCount: 6_000,
      chapterCount: 3,
    }
    // 缺少 AI 配置与 runAI → 派发前拒绝，不产生付费请求。
    await expect(generateShortNovelCandidateV1({ scope, artifactKind: 'brief' })).rejects.toThrow('缺少 AI 配置')
    expect(await db.agentRuns.where('workId').equals(scope.workId).count()).toBe(0)

    const runAI = vi.fn(async () => JSON.stringify(brief))
    const ok = await generateShortNovelCandidateV1({ scope, artifactKind: 'brief', runAI })
    expect(ok.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(runAI).toHaveBeenCalledTimes(1)
    const contract = ok.snapshot.contract
    // 输入预算来自手稿材料：6,000 字目标、3 章骨架的 sourceJson 远小于 64k tokens。
    expect(contract.budget.maxInputTokens).toBeLessThan(64_000)
    expect(contract.budget.maxInputTokens).toBeGreaterThanOrEqual(4_000)
    // 输出预算随作品总目标与 Skill 结构化预测，不是旧 64k 固定门。
    expect(contract.budget.maxOutputTokens).toBeGreaterThanOrEqual(6_000)
  })

  it('长文本字段与超过旧条数上限的数组完整进入候选，不再被截尾', () => {
    const longPremise = '守灯人在风暴夜收到一封没有寄件人的信，信封上盖着三十年前的邮戳。'.repeat(90)
    const mustKeep = Array.from({ length: 30 }, (_, index) => `必须保留的线索${index + 1}`)
    const forbidden = Array.from({ length: 25 }, (_, index) => `禁止出现的桥段${index + 1}`)
    const brief = parseShortNovelBriefV1({
      version: 1,
      premise: longPremise,
      coreChange: '从遵守时刻表到亲手熄灭航标。',
      dominantEmotion: '克制的悬疑',
      pointOfView: 'third-limited',
      tense: 'past',
      audience: '中文短篇读者',
      storyPromise: '寄件人身份在最后一章兑现。',
      mustKeep,
      forbidden,
      targetWordCount: 6_000,
      chapterCount: 3,
    })
    expect(brief.premise).toBe(longPremise.trim())
    expect(brief.mustKeep).toHaveLength(30)
    expect(brief.forbidden).toHaveLength(25)

    const escalation = Array.from({ length: 12 }, (_, index) => `递进第${index + 1}层`)
    const design: ShortNovelStoryDesignV1 = parseShortNovelStoryDesignV1({
      version: 1,
      protagonist: '林晚',
      desire: '查明寄件人',
      pressure: '风暴即将封港',
      escalation,
      irreversibleTurn: '她烧掉了时刻表。',
      climaxChoice: '熄灭航标或保住信。',
      endingImage: '黎明时分退潮的滩涂。',
      aftertaste: '克制而怅然。',
      thematicQuestion: '秩序是否值得以真相为代价。',
    })
    expect(design.escalation).toHaveLength(12)

    const issues = Array.from({ length: 48 }, (_, index) => ({
      stableKey: `issue-${index + 1}`,
      severity: 'minor',
      category: 'continuity',
      chapterKeys: ['chapter-1', 'chapter-2', 'chapter-3'],
      evidence: '原文写道：“风暴封港”',
      problem: `问题${index + 1}`,
      suggestion: `建议${index + 1}`,
      status: 'open',
    }))
    const review: ShortNovelReviewV1 = parseShortNovelReviewV1({
      version: 1,
      summary: '全篇结构完整。',
      strengths: Array.from({ length: 18 }, (_, index) => `优点${index + 1}`),
      issues,
    })
    expect(review.issues).toHaveLength(48)
    expect(review.strengths).toHaveLength(18)
  })

  it('故事设计提示不再要求 escalation 固定 2～5 个', () => {
    const [system, objective] = buildShortNovelPromptV1({ kind: 'story-design', context: '目标字数：6000', authorInstruction: '' })
    expect(system.content).toContain('SILENT CHECKLIST')
    expect(objective.content).not.toContain('2～5')
    expect(objective.content).toContain('自然安排数量')
    // 供参考的 Skill 输出预测不再被 configOverrides 强制为单次输出上限。
    for (const id of ['short.intent-brief', 'short.story-design', 'short.scene-plan', 'short.chapter-draft', 'short.continuity-review', 'short.targeted-rewrite']) {
      expect(getAgentSkillV1(id).maxOutputTokens).toBeGreaterThan(0)
    }
  })
})
