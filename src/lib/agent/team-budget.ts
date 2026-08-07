import { estimateTokens } from '../ai/context-budget'
import type { ChatMessage } from '../types'

export const AGENT_TEAM_BUDGET_PROFILES = ['economy', 'balanced', 'expanded'] as const
export type AgentTeamBudgetProfile = typeof AGENT_TEAM_BUDGET_PROFILES[number]

export interface AgentTeamBudgetPolicy {
  profile: AgentTeamBudgetProfile
  maxTokens: number
  maxCalls: number
  maxCanonRetries: number
}

export interface AgentTeamBudgetEvidence extends AgentTeamBudgetPolicy {
  usedTokens: number
  calls: number
  canonRetries: number
}

export interface AgentTeamCallReservation {
  label: string
  estimatedInputTokens: number
  reservedOutputTokens: number
}

const POLICIES: Record<AgentTeamBudgetProfile, AgentTeamBudgetPolicy> = {
  economy: { profile: 'economy', maxTokens: 80_000, maxCalls: 7, maxCanonRetries: 1 },
  balanced: { profile: 'balanced', maxTokens: 160_000, maxCalls: 7, maxCanonRetries: 1 },
  expanded: { profile: 'expanded', maxTokens: 240_000, maxCalls: 7, maxCanonRetries: 1 },
}

export class AgentTeamBudgetExceededError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentTeamBudgetExceededError'
  }
}

export function sanitizeAgentTeamBudgetProfile(value: unknown): AgentTeamBudgetProfile {
  return AGENT_TEAM_BUDGET_PROFILES.includes(value as AgentTeamBudgetProfile)
    ? value as AgentTeamBudgetProfile
    : 'balanced'
}

export function resolveAgentTeamBudgetPolicy(
  profile: AgentTeamBudgetProfile,
): AgentTeamBudgetPolicy {
  return { ...POLICIES[profile] }
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export class AgentTeamBudgetTracker {
  readonly policy: AgentTeamBudgetPolicy
  private usedTokens = 0
  private calls = 0
  private canonRetries = 0

  constructor(profile: AgentTeamBudgetProfile, restored?: AgentTeamBudgetEvidence) {
    this.policy = resolveAgentTeamBudgetPolicy(profile)
    if (restored) {
      const matchesPolicy = restored.profile === this.policy.profile
        && restored.maxTokens === this.policy.maxTokens
        && restored.maxCalls === this.policy.maxCalls
        && restored.maxCanonRetries === this.policy.maxCanonRetries
      const validUsage = Number.isInteger(restored.usedTokens)
        && restored.usedTokens >= 0
        && restored.usedTokens <= this.policy.maxTokens
        && Number.isInteger(restored.calls)
        && restored.calls >= 0
        && restored.calls <= this.policy.maxCalls
        && Number.isInteger(restored.canonRetries)
        && restored.canonRetries >= 0
        && restored.canonRetries <= this.policy.maxCanonRetries
      if (!matchesPolicy || !validUsage) {
        throw new AgentTeamBudgetExceededError('持久化的 Agent 团队预算证据无效或与当前策略不一致。')
      }
      this.usedTokens = restored.usedTokens
      this.calls = restored.calls
      this.canonRetries = restored.canonRetries
    }
  }

  reserveCall(input: {
    label: string
    messages: readonly ChatMessage[]
    maxOutputTokens: number
  }): AgentTeamCallReservation {
    const estimatedInputTokens = input.messages
      .reduce((sum, message) => sum + estimateTokens(message.content), 0)
    const reservedOutputTokens = Math.max(1, Math.floor(input.maxOutputTokens))
    if (this.calls + 1 > this.policy.maxCalls) {
      throw new AgentTeamBudgetExceededError(
        `本轮 Agent 团队已达到 ${this.policy.maxCalls} 次模型调用上限，已在发起“${input.label}”前停止。`,
      )
    }
    const projected = this.usedTokens + estimatedInputTokens + reservedOutputTokens
    if (projected > this.policy.maxTokens) {
      throw new AgentTeamBudgetExceededError(
        `本轮 Agent 团队预算不足：已用约 ${this.usedTokens.toLocaleString()} tokens，`
        + `“${input.label}”最坏还需约 ${(estimatedInputTokens + reservedOutputTokens).toLocaleString()}，`
        + `上限为 ${this.policy.maxTokens.toLocaleString()}。已在调用前停止，没有产生这次费用。`,
      )
    }
    this.calls += 1
    return { label: input.label, estimatedInputTokens, reservedOutputTokens }
  }

  settleCall(reservation: AgentTeamCallReservation, output: unknown): void {
    this.usedTokens += reservation.estimatedInputTokens + estimateTokens(outputText(output))
  }

  settleFailedCall(reservation: AgentTeamCallReservation): void {
    this.usedTokens += reservation.estimatedInputTokens
  }

  claimCanonRetry(issues: readonly { message: string }[]): void {
    if (this.canonRetries >= this.policy.maxCanonRetries) {
      throw new AgentTeamBudgetExceededError(
        `确定性 Canon 校验仍未通过，且本轮 ${this.policy.maxCanonRetries} 次受控打回机会已经用完：`
        + issues.map(issue => issue.message).join('；'),
      )
    }
    this.canonRetries += 1
  }

  snapshot(): AgentTeamBudgetEvidence {
    return {
      ...this.policy,
      usedTokens: this.usedTokens,
      calls: this.calls,
      canonRetries: this.canonRetries,
    }
  }
}
