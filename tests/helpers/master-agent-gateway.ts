import { assembleContextGatewayPacketV1 } from '../../src/lib/agent/context-gateway-input'
import type { AgentContextEvidence } from '../../src/lib/agent/context-policy'
import type {
  MasterAgentExecutionTrace,
  MasterAgentTask,
  MasterContextGatewayRuntimeV1,
} from '../../src/lib/agent/orchestrator'
import { resolveAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { executeContextGatewayV1 } from '../../src/lib/context-gateway/execution'
import { stampCurrentFixtureResourceUidsV1 } from './current-resource-identity'
import type { WorkspaceScope } from '../../src/lib/types'
import type { ContextResourceDescriptorV1 } from '../../src/lib/registry/types'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'

interface MasterGatewayFixtureOptions {
  scope: WorkspaceScope
  worldGroupId: number | null
  chapterId?: number | null
  characterId?: number | null
  executionTrace: MasterAgentExecutionTrace
  excludedResourceKinds?: readonly ContextResourceDescriptorV1['kind'][]
}

/**
 * Builds real deterministic Gateway evidence for durable-master unit fixtures.
 * The fixture still owns the model output, but it may no longer bypass the
 * production preflight/manifest boundary when its Skill is Gateway-required.
 */
export async function prepareRequiredMasterGatewayFixtureV1(
  options: MasterGatewayFixtureOptions,
  task: MasterAgentTask,
  rawResponse: unknown,
): Promise<{
  contextSources: string[]
  contextEvidence: AgentContextEvidence
  contextGatewayRuntime: MasterContextGatewayRuntimeV1
}> {
  const skill = resolveAgentSkillV1(task.agentId, task.skillId)
  if (skill.contextGateway?.rollout !== 'required') {
    throw new Error(`测试任务 ${task.id} 的 Skill ${skill.id} 不是 required Gateway`)
  }
  await resolveWorkspaceOwnership(options.scope.projectId)
  await stampCurrentFixtureResourceUidsV1(options.scope.projectId)
  const execution = await executeContextGatewayV1({
    skill,
    scope: options.scope,
    worldGroupId: options.worldGroupId,
    chapterId: options.chapterId,
    characterId: options.characterId,
    query: task.instruction,
    budgetTokens: Math.min(8_000, skill.contextGateway.maxRetrievedTokens),
    additionalReadsEnabled: false,
    excludedResourceKinds: options.excludedResourceKinds,
  })
  const assembled = assembleContextGatewayPacketV1(execution, 8_000)
  const renderedRequest = [{ role: 'user', content: task.instruction }]
  await options.executionTrace.contextGatewayPrepared?.(task, {
    execution,
    assembled,
    renderedRequest,
  })
  return {
    contextSources: assembled.included,
    contextEvidence: {
      profile: 'balanced',
      included: assembled.included,
      omitted: assembled.omitted,
      trimmed: assembled.trimmed,
      estimatedInputTokens: assembled.totalInputTokens,
      inputBudgetTokens: assembled.inputBudget,
    },
    contextGatewayRuntime: {
      execution,
      assembled,
      renderedRequest,
      rawResponse,
    },
  }
}
