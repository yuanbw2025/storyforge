import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { seedCurrentWorkspace } from './current-workspace'
import { currentWorldOriginCandidateFixtureV1 } from './current-worldview-field'
import { prepareRequiredMasterGatewayFixtureV1 } from './master-agent-gateway'

/**
 * Creates a native current workspace and one real durable Master candidate.
 * Current-path tests must not manufacture detached AgentEvent candidates.
 */
export async function seedCurrentMasterCandidate(
  name = 'Current durable candidate workspace',
  draft = '当前 durable 候选',
) {
  const workspace = await seedCurrentWorkspace(name)
  const conversation = await getOrCreateAgentConversation({
    purpose: 'master-authoring',
    projectId: workspace.scope.projectId,
    worldGroupId: null,
    scope: workspace.scope,
  })
  const budget = new AgentTeamBudgetTracker('balanced')
  const result = await runDurableMasterAgentPlanV1({
    scope: workspace.scope,
    worldGroupId: null,
    conversationId: conversation.id,
    plan: {
      summary: '生成一个可供作者修订的世界来源候选。',
      tasks: [{
        id: 'world-origin-1',
        agentId: 'world-origin',
        skillId: 'world-origin.worldview-field',
        instruction: '生成世界来源候选。',
        dependsOn: [],
      }],
      workflow: {
        version: 1,
        workflowId: 'single-domain-direct',
        reasonCodes: ['single-explicit-domain'],
      },
    },
    budget,
  }, {
    execute: async options => {
      const task = options.plan.tasks[0]
      await options.executionTrace.taskStarted(task)
      const reservation = options.budget.reserveCall({
        label: task.id,
        messages: [{ role: 'user', content: task.instruction }],
        maxOutputTokens: 200,
      })
      options.budget.settleCall(reservation, draft)
      const currentWorld = currentWorldOriginCandidateFixtureV1(draft)
      const gateway = await prepareRequiredMasterGatewayFixtureV1({
        scope: options.scope,
        worldGroupId: options.worldGroupId,
        executionTrace: options.executionTrace!,
      }, task, currentWorld.draft)
      await options.executionTrace.candidateReady(task, {
        payload: {
          version: 1,
          taskId: task.id,
          agentId: task.agentId,
          skillId: task.skillId,
          label: '世界来源候选',
          contextSources: gateway.contextSources,
          contextEvidence: gateway.contextEvidence,
          ...currentWorld.payload,
          workspaceScope: options.scope,
          dependsOnTaskIds: [],
          teamBudgetEvidence: options.budget.snapshot(),
        },
        draft: currentWorld.draft,
        runtimeNode: {} as any,
        runtimeOutput: currentWorld.runtimeOutput,
        contextGatewayRuntime: gateway.contextGatewayRuntime,
      })
    },
  })
  return {
    ...workspace,
    conversation,
    result,
    candidate: result.candidates[0],
  }
}
