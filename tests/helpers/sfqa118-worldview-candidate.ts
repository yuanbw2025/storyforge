import * as conversations from '../../src/lib/agent/conversations'
import type { ExecutedMasterCandidate } from '../../src/lib/agent/orchestrator'
import { runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { formatWorldviewFieldGenerationRequestV1 } from '../../src/lib/agent/worldview-field-copilot'
import { seedCurrentMasterCandidate } from './current-master-candidate'
import { seedCurrentWorkspace } from './current-workspace'
import { currentWorldOriginCandidateFixtureV1 } from './current-worldview-field'
import { prepareRequiredMasterGatewayFixtureV1 } from './master-agent-gateway'

export type Sfqa118CandidateFixture = Awaited<ReturnType<typeof seedCurrentMasterCandidate>>

/** Browser-safe synthetic output, real scoped run, evidence and candidate. */
export async function seedSfqa118ObjectCandidate(): Promise<Sfqa118CandidateFixture> {
  const workspace = await seedCurrentWorkspace('SFQA118 隔离对象候选')
  const conversation = await conversations.getOrCreateAgentConversation({
    purpose: 'master-authoring', projectId: workspace.scope.projectId, worldGroupId: null, scope: workspace.scope,
  })
  if (conversation.id == null) throw new Error('Expected the persisted test conversation')
  const field = 'divineDesign' as const
  const instruction = formatWorldviewFieldGenerationRequestV1({ field, mode: 'expand', hint: '构造可核对的神明对象。' })
  const task = { id: 'divine-candidate', agentId: 'world-origin' as const, skillId: 'world-origin.worldview-field' as const, instruction, dependsOn: [] }
  const output = { field, value: { hasDivinity: true, divineRank: '旧阶序', divineNames: '旧名称', divineRules: '旧法则' } }
  const draft = JSON.stringify(output)
  const base = currentWorldOriginCandidateFixtureV1('仅使用完整的空基线快照。')
  const result = await runDurableMasterAgentPlanV1({
    scope: workspace.scope, worldGroupId: null, conversationId: conversation.id,
    plan: { summary: '形成单字段结构化候选', tasks: [task], workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] } },
    budget: new AgentTeamBudgetTracker('balanced'),
  }, {
    execute: async options => {
      const trace = options.executionTrace, budget = options.budget
      if (!trace?.taskStarted || !trace.candidateReady || !budget) throw new Error('Expected durable fixture hooks')
      await trace.taskStarted(task)
      const reservation = budget.reserveCall({ label: task.id, messages: [{ role: 'user', content: instruction }], maxOutputTokens: 200 })
      budget.settleCall(reservation, draft)
      const gateway = await prepareRequiredMasterGatewayFixtureV1({
        scope: workspace.scope, worldGroupId: options.worldGroupId ?? null, executionTrace: trace,
      }, task, draft)
      const candidate: ExecutedMasterCandidate = {
        payload: { ...base.payload, version: 1, taskId: task.id, agentId: task.agentId, skillId: task.skillId,
          label: '神明与信仰', worldviewField: field, contextSources: gateway.contextSources, contextEvidence: gateway.contextEvidence,
          workspaceScope: workspace.scope, dependsOnTaskIds: [], teamBudgetEvidence: budget.snapshot() },
        draft, runtimeNode: {} as ExecutedMasterCandidate['runtimeNode'],
        runtimeOutput: output, contextGatewayRuntime: gateway.contextGatewayRuntime,
      }
      await trace.candidateReady(task, candidate)
      return [candidate]
    },
  })
  return { ...workspace, conversation, result, candidate: result.candidates[0] }
}
