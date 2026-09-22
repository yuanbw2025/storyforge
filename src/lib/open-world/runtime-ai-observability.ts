import { db } from '../db/schema'
import { readInstanceAgentRunV1 } from '../agent/run/event-store'
import type { WorkspaceScope } from '../types'
import type { AgentRunState } from '../types/agent-run'
import {
  TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1,
  type TextOpenWorldRuntimeAISkillIdV1,
} from './runtime-ai-contract'

const RUNTIME_CATEGORIES = new Set(
  TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1.map(contract => contract.model.routeCategory),
)

const CAPABILITY_LABELS: Record<TextOpenWorldRuntimeAISkillIdV1, string> = {
  'prose.text-open-world-runtime-intent': '自由输入理解',
  'prose.text-open-world-runtime-dialogue': 'NPC 对白',
  'prose.text-open-world-runtime-expression': '结果演绎',
  'prose.text-open-world-runtime-quest-packaging': '地区任务包装',
  'prose.text-open-world-runtime-direction': '叙事导演建议',
  'prose.text-open-world-runtime-memory': '长期记忆整理',
}

export interface TextOpenWorldRuntimeAIBudgetViewV1 {
  skillId: TextOpenWorldRuntimeAISkillIdV1
  label: string
  maxInputTokens: number
  maxOutputTokens: number
  maxDurationMs: number
  maxEstimatedCostUsd: number
}

export interface TextOpenWorldRuntimeAIRecentRunV1 {
  runId: number
  label: string
  state: AgentRunState
  code: string | null
  retryable: boolean
  updatedAt: number
}

export interface TextOpenWorldRuntimeAIObservabilityV1 {
  version: 1
  projectId: number
  productRuntimeSessionId: number
  budgets: TextOpenWorldRuntimeAIBudgetViewV1[]
  successfulCalls: number
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
  latestUsageAt: number | null
  recentRuns: TextOpenWorldRuntimeAIRecentRunV1[]
  refreshedAt: number
}

function capabilityLabel(stepId: string): string {
  const capability = stepId.replace(/^text-open-world-runtime-ai:/, '')
  const contract = TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1.find(item => item.capability === capability)
  return contract ? CAPABILITY_LABELS[contract.skillId] : '运行时 AI'
}

export async function projectTextOpenWorldRuntimeAIObservabilityV1(input: {
  scope: WorkspaceScope
  productRuntimeSessionId: number
}): Promise<TextOpenWorldRuntimeAIObservabilityV1> {
  const rows = (await db.agentRuns
    .where('productRuntimeSessionId')
    .equals(input.productRuntimeSessionId)
    .toArray())
    .sort((left, right) => right.updatedAt - left.updatedAt || (right.id ?? 0) - (left.id ?? 0))
  const snapshots = []
  for (const row of rows.slice(0, 24)) {
    if (row.id == null) continue
    try {
      const snapshot = await readInstanceAgentRunV1(input.scope, row.id)
      const stepId = Object.keys(snapshot.projection.steps)
        .find(key => key.startsWith('text-open-world-runtime-ai:'))
      if (!stepId) continue
      snapshots.push({ snapshot, stepId })
    } catch {
      // Corrupt/unrelated local rows are not projected as trustworthy runtime
      // evidence. Their source rows remain untouched for diagnostics.
    }
    if (snapshots.length >= 8) break
  }
  const usageRows = (await db.aiUsageLog.where('projectId').equals(input.scope.projectId).toArray())
    .filter(row => RUNTIME_CATEGORIES.has(row.category))
  return {
    version: 1,
    projectId: input.scope.projectId,
    productRuntimeSessionId: input.productRuntimeSessionId,
    budgets: TEXT_OPEN_WORLD_RUNTIME_AI_SKILL_CONTRACTS_V1.map(contract => ({
      skillId: contract.skillId,
      label: CAPABILITY_LABELS[contract.skillId],
      maxInputTokens: contract.budget.maxInputTokens,
      maxOutputTokens: contract.budget.maxOutputTokens,
      maxDurationMs: contract.budget.maxDurationMs,
      maxEstimatedCostUsd: contract.budget.maxEstimatedCostUsd,
    })),
    successfulCalls: usageRows.length,
    inputTokens: usageRows.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: usageRows.reduce((sum, row) => sum + row.outputTokens, 0),
    estimatedCostUsd: usageRows.reduce((sum, row) => sum + row.costUsd, 0),
    latestUsageAt: usageRows.reduce<number | null>((latest, row) => (
      latest == null || row.timestamp > latest ? row.timestamp : latest
    ), null),
    recentRuns: snapshots.map(({ snapshot, stepId }) => {
      const failure = [...snapshot.events].reverse().find(event => (
        event.type === 'step.failed' && event.payload.stepId === stepId
      ))
      return {
        runId: snapshot.run.id,
        label: capabilityLabel(stepId),
        state: snapshot.projection.state,
        code: failure?.type === 'step.failed' ? failure.payload.code : null,
        retryable: failure?.type === 'step.failed' ? failure.payload.retryable : false,
        updatedAt: snapshot.run.updatedAt,
      }
    }),
    refreshedAt: Date.now(),
  }
}
