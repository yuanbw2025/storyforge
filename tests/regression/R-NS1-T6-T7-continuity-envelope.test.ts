import { afterEach, describe, expect, it } from 'vitest'
import { buildChapterContentPrompt } from '../../src/lib/ai/adapters/chapter-adapter'
import {
  CONTINUITY_CORE_END,
  CONTINUITY_CORE_START,
} from '../../src/lib/ai/chapter-memory/continuity-envelope'
import { trimMessagesToFit } from '../../src/lib/ai/context-budget'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { usePromptStore } from '../../src/stores/prompt'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const originalPromptState = usePromptStore.getState()

afterEach(() => {
  usePromptStore.setState(originalPromptState, true)
})

describe('NS-1 T6/T7 · minimum continuity envelope and template contract', () => {
  it('injects one bounded continuity block near the user-message tail', () => {
    const messages = buildChapterContentPrompt(
      '当前章',
      '必须从门后异响接着写',
      `普通世界上下文${'很长'.repeat(5000)}`,
      '林砚：谨慎',
      '旧参数尾部',
      '',
      undefined,
      {
        continuityBudgetTokens: 3000,
        continuity: {
          handoff: `承诺：天亮前抵达雾港。${'状态变化'.repeat(1000)}`,
          previousTail: `${'尾部细节'.repeat(1000)}真实尾部：苏禾推开门。`,
          recentSummaries: `最近摘要：赤钥仍在林砚手中。${'历史'.repeat(1000)}`,
        },
      },
    )
    const user = messages.at(-1)?.content ?? ''
    expect(user.match(new RegExp(CONTINUITY_CORE_START, 'g'))).toHaveLength(1)
    expect(user).toContain(CONTINUITY_CORE_END)
    expect(user).toContain('天亮前抵达雾港')
    expect(user).toContain('苏禾推开门')
    expect(user).toContain('赤钥仍在林砚手中')
    const block = user.slice(user.indexOf(CONTINUITY_CORE_START), user.indexOf(CONTINUITY_CORE_END))
    expect(block.length).toBeLessThan(5_000)
  })

  it('preserves the complete protected block in final 8K request-side trimming', () => {
    const messages = buildChapterContentPrompt(
      '当前章',
      '承接上一章',
      `可裁普通上下文${'普通资料'.repeat(6000)}`,
      '',
      '',
      '',
      undefined,
      {
        continuityBudgetTokens: 2400,
        continuity: {
          handoff: '硬约束：青铜铃仍在左袖。',
          previousTail: '真实尾部：她说三短一长。',
          recentSummaries: '已验证摘要：苏禾身份未公开。',
        },
      },
    )
    const result = trimMessagesToFit(messages, 'custom', '8k-test', 2048, 8192)
    const finalUser = result.messages.at(-1)?.content ?? ''

    expect(result.trimmed).toBe(true)
    expect(result.protectedEnvelopePreserved).toBe(true)
    expect(finalUser).toContain(CONTINUITY_CORE_START)
    expect(finalUser).toContain(CONTINUITY_CORE_END)
    expect(finalUser).toContain('青铜铃仍在左袖')
    expect(finalUser).toContain('三短一长')
  })

  it.each([
    { label: '32K', contextWindow: 32_768, maxOutput: 8_192, continuityBudgetTokens: 6_000 },
    { label: '128K', contextWindow: 131_072, maxOutput: 16_384, continuityBudgetTokens: 10_000 },
  ])('preserves the target envelope in a $label final request', ({
    contextWindow,
    maxOutput,
    continuityBudgetTokens,
  }) => {
    const messages = buildChapterContentPrompt(
      '当前章',
      `必须完成本章终点${'章纲'.repeat(2_000)}`,
      `可裁普通上下文${'普通资料'.repeat(20_000)}`,
      '',
      '',
      '',
      undefined,
      {
        continuityBudgetTokens,
        continuity: {
          handoff: `硬约束：青铜铃仍在左袖。${'交接'.repeat(2_000)}`,
          previousTail: `${'前驱正文'.repeat(2_000)}真实尾部：她说三短一长。`,
          recentSummaries: `已验证摘要：苏禾身份未公开。${'摘要'.repeat(3_000)}`,
        },
      },
    )
    const result = trimMessagesToFit(messages, 'custom', 'target-window', maxOutput, contextWindow)
    const finalUser = result.messages.at(-1)?.content ?? ''

    expect(result.protectedEnvelopePreserved).toBe(true)
    expect(finalUser).toContain(CONTINUITY_CORE_START)
    expect(finalUser).toContain(CONTINUITY_CORE_END)
    expect(finalUser).toContain('青铜铃仍在左袖')
    expect(finalUser).toContain('三短一长')
  })

  it('reports an unsupported physical window instead of claiming the envelope survived', () => {
    const messages = buildChapterContentPrompt(
      '当前章',
      '极小窗口测试',
      '',
      '',
      '',
      '',
      undefined,
      {
        continuityBudgetTokens: 3000,
        continuity: {
          handoff: '硬约束'.repeat(1000),
          previousTail: '真实尾部'.repeat(1000),
        },
      },
    )
    const result = trimMessagesToFit(messages, 'custom', 'tiny', 800, 1800)
    expect(result.protectedEnvelopePreserved).toBe(false)
  })

  it('allows a user template to explicitly turn continuity injection off', () => {
    const system = usePromptStore.getState().getActive('chapter.content')
    usePromptStore.setState({
      ...usePromptStore.getState(),
      templates: [{
        ...system,
        id: 999,
        scope: 'user',
        isActive: true,
        continuityMode: 'off',
      }],
      loaded: true,
    })
    const messages = buildChapterContentPrompt(
      '当前章',
      '章纲',
      '',
      '',
      '',
      '',
      undefined,
      { continuity: { handoff: '不应出现的 handoff' } },
    )
    expect(messages.at(-1)?.content).not.toContain(CONTINUITY_CORE_START)
    expect(messages.at(-1)?.content).not.toContain('不应出现的 handoff')
  })

  it('keeps protected assembleContext sources while trimming optional layers', async () => {
    await db.delete()
    await db.open()
    const projectId = (await seedCurrentWorkspace('Continuity envelope')).scope.projectId
    const result = await assembleContext({
      projectId,
      chapterId: 2,
      inputBudgetTokens: 200,
      continuitySnapshot: {
        current: null,
        predecessor: null,
        previousTailText: '必须保留的真实 tail',
        handoffText: '必须保留的 handoff',
        recentSummariesText: `可压缩摘要${'历史内容'.repeat(500)}`,
        memoryRebuildCandidateIds: [],
        anomalies: [],
      },
      sourceKeys: ['chapterContinuityHandoff', 'previousChapterEnding', 'recentChapterSummaries'],
    })
    expect(result.included).toEqual(['chapterContinuityHandoff', 'previousChapterEnding'])
    expect(result.trimmed).toContain('recentChapterSummaries')
    expect(result.text).toContain('必须保留的 handoff')
    expect(result.text).toContain('必须保留的真实 tail')
    expect(result.overBudgetAfterTrim).toBe(false)
    db.close()
  })
})
