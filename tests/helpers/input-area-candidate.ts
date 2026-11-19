import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import type { ExecutedMasterCandidate } from '../../src/lib/agent/orchestrator'
import { runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { AgentTeamBudgetTracker } from '../../src/lib/agent/team-budget'
import { formatWorldviewFieldGenerationRequestV1, prepareWorldviewFieldCopilot, type WorldviewFieldOperationV1 } from '../../src/lib/agent/worldview-field-copilot'
import { useWorldviewStore } from '../../src/stores/worldview'
import { seedCurrentWorkspace } from './current-workspace'
import { prepareRequiredMasterGatewayFixtureV1 } from './master-agent-gateway'
import { formatStoryCoreGenerationRequestV1, prepareStoryCoreCopilot } from '../../src/lib/agent/story-core-copilot'

/** Synthetic model output, actual baseline, Gateway and durable candidate.
 * The requested operation is frozen before candidateReady, never patched into
 * a previously frozen run just to select a review branch. */
export async function seedInputAreaCandidate(operation: Exclude<WorldviewFieldOperationV1, 'create'>) {
  const workspace = await seedCurrentWorkspace(`047 ${operation} 候选测试`)
  await useWorldviewStore.getState().loadAll(workspace.scope)
  await useWorldviewStore.getState().saveWorldview({ projectId: workspace.scope.projectId, worldOrigin: '## 原文\n盐约生效后才开放城门。\n\n## 旧俗\n守潮人敲钟。\n\n## 潮期\n每月退潮时封存航路。' }, workspace.scope)
  const conversation = await getOrCreateAgentConversation({ purpose: 'master-authoring', projectId: workspace.scope.projectId, worldGroupId: null, scope: workspace.scope })
  if (conversation.id == null) throw new Error('Expected persisted test conversation')
  const instruction = formatWorldviewFieldGenerationRequestV1({ field: 'worldOrigin', mode: operation, hint: '保留盐约。' })
  const prepared = await prepareWorldviewFieldCopilot({ projectId: workspace.scope.projectId, scope: workspace.scope, worldGroupId: null, authorRequest: instruction, skillId: 'world-origin.worldview-field' })
  const output = { field: 'worldOrigin' as const, value: '## 候选\n盐约生效后开放城门。\n\n## 新俗\n守潮人敲三声钟。\n\n## 潮期\n每月退潮时封存航路。' }
  const base = { draft: JSON.stringify(output), runtimeOutput: output, payload: { worldviewField: prepared.targetField, worldviewFieldOperation: prepared.input.mode, worldviewFieldOutputBudget: prepared.input.outputBudget, baseSnapshot: prepared.snapshot } }
  const task = { id: 'input-area-review', agentId: 'world-origin' as const, skillId: 'world-origin.worldview-field' as const, instruction, dependsOn: [] }
  const result = await runDurableMasterAgentPlanV1({
    scope: workspace.scope, worldGroupId: null, conversationId: conversation.id,
    plan: { summary: '形成可核对的世界来源候选', tasks: [task], workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] } },
    budget: new AgentTeamBudgetTracker('balanced'),
  }, {
    execute: async options => {
      const trace = options.executionTrace, budget = options.budget
      if (!trace?.taskStarted || !trace.candidateReady || !budget) throw new Error('Expected durable fixture hooks')
      await trace.taskStarted(task)
      const reservation = budget.reserveCall({ label: task.id, messages: [{ role: 'user', content: instruction }], maxOutputTokens: 200 })
      budget.settleCall(reservation, base.draft)
      const gateway = await prepareRequiredMasterGatewayFixtureV1({ scope: workspace.scope, worldGroupId: null, executionTrace: trace }, task, base.draft)
      const candidate: ExecutedMasterCandidate = {
        payload: { ...base.payload, worldviewFieldOperation: operation, version: 1, taskId: task.id, agentId: task.agentId, skillId: task.skillId,
          label: '世界来源', contextSources: gateway.contextSources, contextEvidence: gateway.contextEvidence,
          workspaceScope: workspace.scope, dependsOnTaskIds: [], teamBudgetEvidence: budget.snapshot() },
        draft: base.draft, runtimeNode: {} as ExecutedMasterCandidate['runtimeNode'], runtimeOutput: base.runtimeOutput, contextGatewayRuntime: gateway.contextGatewayRuntime,
      }
      await trace.candidateReady(task, candidate)
      return [candidate]
    },
  })
  return { scope: workspace.scope, runId: result.runId, eventId: result.candidates[0].event.id! }
}

/** Reach the existing raw-toggle consumer through a valid StoryCore run. */
export async function seedInputAreaStoryCandidate() {
  const workspace = await seedCurrentWorkspace('047 故事核心原始结构测试')
  const conversation = await getOrCreateAgentConversation({ purpose: 'master-authoring', projectId: workspace.scope.projectId, worldGroupId: null, scope: workspace.scope })
  if (conversation.id == null) throw new Error('Expected persisted test conversation')
  const instruction = formatStoryCoreGenerationRequestV1({ field: 'logline', mode: 'expand', hint: '盐约与守潮人。' })
  const task = { id: 'input-area-story', agentId: 'world-origin' as const, skillId: 'world-origin.story-core' as const, instruction, dependsOn: [] }
  const output = { field: 'logline' as const, value: '守潮人追查一份不属于任何人的盐约。' }, draft = JSON.stringify(output)
  const result = await runDurableMasterAgentPlanV1({
    scope: workspace.scope, worldGroupId: null, conversationId: conversation.id,
    plan: { summary: '形成故事核心候选', tasks: [task], workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] } },
    budget: new AgentTeamBudgetTracker('balanced'),
  }, {
    execute: async options => {
      const trace = options.executionTrace, budget = options.budget
      if (!trace?.taskStarted || !trace.candidateReady || !budget) throw new Error('Expected durable fixture hooks')
      await trace.taskStarted(task)
      const prepared = await prepareStoryCoreCopilot({ projectId: workspace.scope.projectId, scope: workspace.scope, worldGroupId: null, authorRequest: instruction, skillId: task.skillId })
      const reservation = budget.reserveCall({ label: task.id, messages: [{ role: 'user', content: instruction }], maxOutputTokens: 200 })
      budget.settleCall(reservation, draft)
      const gateway = await prepareRequiredMasterGatewayFixtureV1({ scope: workspace.scope, worldGroupId: null, executionTrace: trace }, task, draft)
      const candidate: ExecutedMasterCandidate = {
        payload: { version: 1, taskId: task.id, agentId: task.agentId, skillId: task.skillId, storyCoreField: prepared.targetField,
          baseSnapshot: prepared.snapshot, label: prepared.label, contextSources: gateway.contextSources, contextEvidence: gateway.contextEvidence,
          workspaceScope: workspace.scope, dependsOnTaskIds: [], teamBudgetEvidence: budget.snapshot() },
        draft, runtimeNode: prepared.node, runtimeOutput: output, contextGatewayRuntime: gateway.contextGatewayRuntime,
      }
      await trace.candidateReady(task, candidate)
      return [candidate]
    },
  })
  return { scope: workspace.scope, runId: result.runId }
}
