import type { AssembleContextSourceEvidence } from '../registry/types'

export const AGENT_CONTEXT_PROFILES = ['lean', 'balanced', 'full'] as const
export type AgentContextProfile = typeof AGENT_CONTEXT_PROFILES[number]

export const AGENT_CONTEXT_TASK_KINDS = [
  'agent-world-origin',
  'agent-character',
  'agent-inspiration',
  'agent-outline',
  'agent-prose',
] as const
export type AgentContextTaskKind = typeof AGENT_CONTEXT_TASK_KINDS[number]

export type AgentContextProfiles = Record<AgentContextTaskKind, AgentContextProfile>

export interface AgentContextPolicy {
  profile: AgentContextProfile
  /** 每个登记源自身软上限的比例，只允许收窄，不允许突破注册表。 */
  sourceBudgetScale: number
  /** 当前领域一次上下文装配的上限；实际还会受模型窗口约束。 */
  maxInputTokens: number
}

export interface AgentContextEvidence {
  profile: AgentContextProfile
  included: string[]
  omitted: string[]
  trimmed: string[]
  sourceEvidence?: AssembleContextSourceEvidence[]
  inputState?: AgentContextInputStateEvidenceV1
  estimatedInputTokens: number
  inputBudgetTokens: number
}

export const AGENT_CONTEXT_INPUT_STATES = ['empty', 'partial', 'complete'] as const
export type AgentContextInputStateV1 = typeof AGENT_CONTEXT_INPUT_STATES[number]

export const AGENT_CONTEXT_INPUT_HANDLINGS = [
  'create-from-request',
  'reference-and-create',
  'grounded-transform',
  'require-upstream',
  'require-author-input',
] as const
export type AgentContextInputHandlingV1 = typeof AGENT_CONTEXT_INPUT_HANDLINGS[number]

export interface AgentContextInputStateEvidenceV1 {
  version: 1
  state: AgentContextInputStateV1
  handling: AgentContextInputHandlingV1
  consideredSourceKeys: string[]
  availableSourceKeys: string[]
  missingSourceKeys: string[]
  truncatedSourceKeys: string[]
  trimmedSourceKeys: string[]
}

interface ContextEvidenceInput {
  included: readonly string[]
  omitted: readonly string[]
  trimmed: readonly string[]
  sourceEvidence?: readonly AssembleContextSourceEvidence[]
  totalInputTokens: number
  inputBudget: number
}

function mergeSourceEvidence(
  results: readonly ContextEvidenceInput[],
): AssembleContextSourceEvidence[] | undefined {
  const evidence = results.flatMap(result => result.sourceEvidence ?? [])
  if (!evidence.length) return undefined
  const byKey = new Map<string, AssembleContextSourceEvidence>()
  for (const source of evidence) {
    const current = byKey.get(source.key)
    if (!current) {
      byKey.set(source.key, { ...source })
      continue
    }
    const status = current.status === 'included' || source.status === 'included'
      ? 'included'
      : current.status === 'trimmed' || source.status === 'trimmed'
        ? 'trimmed'
        : 'omitted'
    const inputTokens = current.inputTokens + source.inputTokens
    const originalTokens = current.originalTokens + source.originalTokens
    byKey.set(source.key, {
      key: source.key,
      status,
      delivery: status !== 'included'
        ? 'none'
        : current.delivery === 'truncated' || source.delivery === 'truncated'
          ? 'truncated'
          : current.delivery === 'compressed' || source.delivery === 'compressed'
            ? 'compressed'
          : 'full',
      originalTokens,
      inputTokens,
      ...(
        current.sourceHash && source.sourceHash && current.sourceHash === source.sourceHash
          ? { sourceHash: current.sourceHash }
          : current.sourceHash && !source.sourceHash
            ? { sourceHash: current.sourceHash }
            : source.sourceHash && !current.sourceHash
              ? { sourceHash: source.sourceHash }
              : {}
      ),
      ...((current.compression ?? source.compression)
        ? { compression: current.compression ?? source.compression }
        : {}),
    })
  }
  return [...byKey.values()]
}

export const DEFAULT_AGENT_CONTEXT_PROFILES: AgentContextProfiles = {
  'agent-world-origin': 'balanced',
  'agent-character': 'balanced',
  'agent-inspiration': 'balanced',
  'agent-outline': 'balanced',
  'agent-prose': 'balanced',
}

const PROFILE_SCALE: Record<AgentContextProfile, number> = {
  lean: 0.45,
  balanced: 0.72,
  full: 1,
}

const ROLE_MAX_INPUT_TOKENS: Record<AgentContextTaskKind, Record<AgentContextProfile, number>> = {
  'agent-world-origin': { lean: 9_000, balanced: 14_000, full: 19_400 },
  'agent-character': { lean: 13_000, balanced: 20_000, full: 28_500 },
  'agent-inspiration': { lean: 5_000, balanced: 8_000, full: 11_000 },
  'agent-outline': { lean: 18_000, balanced: 32_000, full: 48_000 },
  'agent-prose': { lean: 24_000, balanced: 42_000, full: 64_000 },
}

export function sanitizeAgentContextProfiles(value: unknown): AgentContextProfiles {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const profiles = { ...DEFAULT_AGENT_CONTEXT_PROFILES }
  for (const taskKind of AGENT_CONTEXT_TASK_KINDS) {
    const profile = raw[taskKind]
    if (AGENT_CONTEXT_PROFILES.includes(profile as AgentContextProfile)) {
      profiles[taskKind] = profile as AgentContextProfile
    }
  }
  return profiles
}

export function resolveAgentContextPolicy(
  taskKind: AgentContextTaskKind,
  profile: AgentContextProfile,
): AgentContextPolicy {
  return {
    profile,
    sourceBudgetScale: PROFILE_SCALE[profile],
    maxInputTokens: ROLE_MAX_INPUT_TOKENS[taskKind][profile],
  }
}

/** 多个正式 read tool 共同服务一个领域时，按权重拆分同一总预算，避免各工具重复拿满上限。 */
export function splitAgentContextPolicy(
  policy: AgentContextPolicy,
  weights: readonly number[],
): AgentContextPolicy[] {
  const safeWeights = weights.map(weight => Number.isFinite(weight) && weight > 0 ? weight : 1)
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0)
  let remaining = policy.maxInputTokens
  return safeWeights.map((weight, index) => {
    const maxInputTokens = index === safeWeights.length - 1
      ? remaining
      : Math.max(1, Math.floor(policy.maxInputTokens * weight / totalWeight))
    remaining -= maxInputTokens
    return { ...policy, maxInputTokens }
  })
}

export function evidenceFromContextResult(
  profile: AgentContextProfile,
  result: {
    included: readonly string[]
    omitted: readonly string[]
    trimmed: readonly string[]
    sourceEvidence?: readonly AssembleContextSourceEvidence[]
    totalInputTokens: number
    inputBudget: number
  },
): AgentContextEvidence {
  return {
    profile,
    included: [...new Set(result.included)],
    omitted: [...new Set(result.omitted)],
    trimmed: [...new Set(result.trimmed)],
    ...(result.sourceEvidence?.length
      ? { sourceEvidence: result.sourceEvidence.map(source => ({ ...source })) }
      : {}),
    estimatedInputTokens: result.totalInputTokens,
    inputBudgetTokens: result.inputBudget,
  }
}

export function mergeContextEvidence(
  profile: AgentContextProfile,
  results: ContextEvidenceInput[],
): AgentContextEvidence {
  const sourceEvidence = mergeSourceEvidence(results)
  return {
    profile,
    included: [...new Set(results.flatMap(result => result.included))],
    omitted: [...new Set(results.flatMap(result => result.omitted))],
    trimmed: [...new Set(results.flatMap(result => result.trimmed))],
    ...(sourceEvidence ? { sourceEvidence } : {}),
    estimatedInputTokens: results.reduce((sum, result) => sum + result.totalInputTokens, 0),
    inputBudgetTokens: results.reduce((sum, result) => sum + result.inputBudget, 0),
  }
}

export function classifyAgentContextInputStateV1(input: {
  consideredSourceKeys: readonly string[]
  handling: Record<AgentContextInputStateV1, AgentContextInputHandlingV1>
  results: readonly ContextEvidenceInput[]
}): AgentContextInputStateEvidenceV1 {
  const consideredSourceKeys = [...new Set(input.consideredSourceKeys)]
  if (!consideredSourceKeys.length) throw new Error('Agent Skill 输入状态来源不得为空')
  const included = new Set(input.results.flatMap(result => result.included))
  const trimmed = new Set(input.results.flatMap(result => result.trimmed))
  const sourceEvidence = mergeSourceEvidence(input.results) ?? []
  const sourceByKey = new Map(sourceEvidence.map(source => [source.key, source]))
  const availableSourceKeys = consideredSourceKeys.filter(key => {
    const evidence = sourceByKey.get(key)
    return included.has(key) || trimmed.has(key) || Boolean(evidence && evidence.originalTokens > 0)
  })
  const missingSourceKeys = consideredSourceKeys.filter(key => !availableSourceKeys.includes(key))
  const state: AgentContextInputStateV1 = availableSourceKeys.length === 0
    ? 'empty'
    : missingSourceKeys.length === 0
      ? 'complete'
      : 'partial'
  return {
    version: 1,
    state,
    handling: input.handling[state],
    consideredSourceKeys,
    availableSourceKeys,
    missingSourceKeys,
    truncatedSourceKeys: consideredSourceKeys.filter(key => sourceByKey.get(key)?.delivery === 'truncated'),
    trimmedSourceKeys: consideredSourceKeys.filter(key => trimmed.has(key)),
  }
}

export function attachAgentContextInputStateV1(
  evidence: AgentContextEvidence,
  inputState: AgentContextInputStateEvidenceV1,
): AgentContextEvidence {
  return { ...evidence, inputState }
}
