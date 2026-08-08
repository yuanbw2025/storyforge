import { describe, expect, it, vi } from 'vitest'
import type { GenerationNode } from '../../src/lib/generation/generation-node'
import { prepareGenerationNode } from '../../src/lib/generation/generation-node'
import {
  AgentTeamBudgetExceededError,
  AgentTeamBudgetTracker,
  resolveAgentTeamBudgetPolicy,
  sanitizeAgentTeamBudgetProfile,
} from '../../src/lib/agent/team-budget'
import { runBudgetedGenerationNode } from '../../src/lib/agent/team-execution'

describe('AGENT-1 27.1-e · 跨调用团队预算与 Canon 受控打回', () => {
  it('三档总预算有界且旧配置默认均衡', () => {
    expect(sanitizeAgentTeamBudgetProfile(null)).toBe('balanced')
    expect(sanitizeAgentTeamBudgetProfile('unlimited')).toBe('balanced')
    expect(sanitizeAgentTeamBudgetProfile('economy')).toBe('economy')
    expect(resolveAgentTeamBudgetPolicy('economy').maxTokens)
      .toBeLessThan(resolveAgentTeamBudgetPolicy('balanced').maxTokens)
    expect(resolveAgentTeamBudgetPolicy('balanced').maxTokens)
      .toBeLessThan(resolveAgentTeamBudgetPolicy('expanded').maxTokens)
    expect(resolveAgentTeamBudgetPolicy('expanded').maxCalls).toBe(7)
    expect(resolveAgentTeamBudgetPolicy('expanded').maxCanonRetries).toBe(1)
  })

  it('跨调用累计输入与真实输出估算，并在下一次调用前阻止最坏预算超限', () => {
    const tracker = new AgentTeamBudgetTracker('economy')
    const first = tracker.reserveCall({
      label: '角色 Agent',
      messages: [{ role: 'user', content: '设计角色' }],
      maxOutputTokens: 6_000,
    })
    tracker.settleCall(first, '角色候选')
    expect(tracker.snapshot()).toMatchObject({ calls: 1, canonRetries: 0 })
    expect(tracker.snapshot().usedTokens).toBeGreaterThan(0)

    expect(() => tracker.reserveCall({
      label: '超长正文 Agent',
      messages: [{ role: 'user', content: '文'.repeat(300_000) }],
      maxOutputTokens: 16_000,
    })).toThrow(AgentTeamBudgetExceededError)
    expect(tracker.snapshot().calls).toBe(1)
  })

  it('并发调用把未结算预留计入总预算，且同一预留只能结算一次', () => {
    const tracker = new AgentTeamBudgetTracker('economy')
    const first = tracker.reserveCall({
      label: '并行叶一',
      messages: [{ role: 'user', content: '一'.repeat(35_000) }],
      maxOutputTokens: 10_000,
    })
    expect(() => tracker.reserveCall({
      label: '并行叶二',
      messages: [{ role: 'user', content: '二'.repeat(35_000) }],
      maxOutputTokens: 10_000,
    })).toThrow('预算不足')
    expect(tracker.snapshot().calls).toBe(1)

    tracker.settleCall(first, '完成')
    expect(() => tracker.settleFailedCall(first)).toThrow('已经结算')
  })

  it('确定性 gate 只触发一次带具体证据的受预算返工，第二版通过后才形成结果', async () => {
    const run = vi.fn(async (messages: Array<{ content: string }>) => (
      messages.some(message => message.content.includes('确定性 Canon 校验打回'))
        ? '修复后的有效候选'
        : '短'
    ))
    const node: GenerationNode<string, string> = {
      id: 'canon-retry',
      kind: 'test',
      editableInput: true,
      assembleInput: input => [{ role: 'user', content: input }],
      run,
      gate: output => ({
        status: output.length < 4 ? 'blocked' : 'pass',
        issues: output.length < 4
          ? [{ code: 'too-short', message: '候选少于 4 个字符。' }]
          : [],
      }),
    }
    const prepared = prepareGenerationNode(node, '写一个候选')
    const tracker = new AgentTeamBudgetTracker('balanced')
    const result = await runBudgetedGenerationNode({
      node,
      prepared,
      budget: tracker,
      callLabel: '世界 Agent',
      maxOutputTokens: 3_000,
    })

    expect(result.output).toBe('修复后的有效候选')
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1][0].at(-1)?.content).toContain('too-short')
    expect(tracker.snapshot()).toMatchObject({ calls: 2, canonRetries: 1 })
  })

  it('整轮只有一次 Canon 打回，第二个不合格任务不会开启无限重试', async () => {
    const tracker = new AgentTeamBudgetTracker('balanced')
    tracker.claimCanonRetry([{ message: '第一次冲突' }])
    expect(() => tracker.claimCanonRetry([{ message: '第二次冲突' }]))
      .toThrow('打回机会已经用完')
  })

  it('领域外部确定性 Canon validator 也能带证据打回，不依赖 LLM 自评', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce('守灯人再次获得青铜铃。')
      .mockResolvedValueOnce('守灯人取出一直持有的青铜铃。')
    const node: GenerationNode<string, string> = {
      id: 'external-canon',
      kind: 'test',
      editableInput: true,
      assembleInput: input => [{ role: 'user', content: input }],
      run,
    }
    const result = await runBudgetedGenerationNode({
      node,
      prepared: prepareGenerationNode(node, '续写正文'),
      budget: new AgentTeamBudgetTracker('balanced'),
      callLabel: '正文 Agent',
      maxOutputTokens: 16_000,
      validate: output => output.includes('再次获得')
        ? [{ code: 'held-item:0', message: '青铜铃已经处于持有状态。' }]
        : [],
    })
    expect(result.output).toContain('一直持有')
    expect(run.mock.calls[1][0].at(-1)?.content).toContain('held-item:0')
  })
})
