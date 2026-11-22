/** Existing Master entry point with one exact opt-in product branch. It owns
 * no data, client, budget tracker, Run format or adoption writer. */
import { runDurableMasterAgentPlanV1, findResumableMasterAgentRunV1 as findLegacyResumableMasterAgentRunV1 } from './master-durable'
import { commitMasterAgentCandidateAdoptionV1, rejectMasterAgentCandidateV1, recoverPendingMasterAgentAdoptionsV1,
  type MasterAgentCandidateAdoptionRefV1 } from './master-adoption'
import { verifyMasterAgentRunV1 } from './master-verification'
import { readAgentRunV1 } from './event-store'
import type { WorkspaceScope } from '../../types'
import type { MasterAgentPlan } from '../orchestrator'
import { splitLongformPlanAtChapterV1 } from '../longform-stage-queue'
import { parseMasterWorkflowSelectionV1 } from '../workflow-catalog'
import { parseWorldviewFieldTaskV2 } from '../worldview-field-v2-contract'
import { isWorldviewFieldPlanV2, isWorldviewFieldRunV2, runWorldviewFieldMasterV2,
  adoptWorldviewMasterCandidateV2, rejectWorldviewMasterCandidateV2, verifyWorldviewMasterV2,
  recoverWorldviewMasterAdoptionsV2, type WorldviewMasterInputV2 } from './worldview-field-v2-durable'

/** New closed product tasks must be validated by their own strict DTO before
 * the frozen V1 splitter, which deliberately knows none of these fields. */
export async function admitPreparedMasterPlanV2(plan: MasterAgentPlan): Promise<{ current: MasterAgentPlan; remaining: MasterAgentPlan | null }> {
  const frozen = structuredClone(plan)
  if (Array.isArray(frozen.tasks) && frozen.tasks.length === 1 && frozen.tasks[0]?.skillId === 'world-origin.worldview-field.v2') {
    if (!frozen || typeof frozen !== 'object' || Object.keys(frozen).some(key => !['summary','tasks','workflow'].includes(key))
      || typeof frozen.summary !== 'string' || !frozen.summary.trim()) throw new Error('世界基座新计划的外层身份无效。')
    const workflow = parseMasterWorkflowSelectionV1(frozen.workflow)
    if (workflow.workflowId !== 'single-domain-direct') throw new Error('世界基座新计划必须是准确的单字段任务。')
    const task = await parseWorldviewFieldTaskV2(frozen.tasks[0])
    return { current: { summary: frozen.summary, tasks: [task], workflow }, remaining: null }
  }
  return splitLongformPlanAtChapterV1(frozen)
}

export async function runMasterWithWorldviewV2(input: WorldviewMasterInputV2) {
  const exact = input.runId == null ? isWorldviewFieldPlanV2(input.plan) : isWorldviewFieldRunV2(await readAgentRunV1(input.scope,input.runId))
  return exact ? runWorldviewFieldMasterV2(input) : runDurableMasterAgentPlanV1(input)
}
export async function adoptMasterWithWorldviewV2(input:MasterAgentCandidateAdoptionRefV1) {
  return isWorldviewFieldRunV2(await readAgentRunV1(input.scope,input.runId))
    ? adoptWorldviewMasterCandidateV2(input) : commitMasterAgentCandidateAdoptionV1(input)
}
export async function rejectMasterWithWorldviewV2(input:MasterAgentCandidateAdoptionRefV1) {
  return isWorldviewFieldRunV2(await readAgentRunV1(input.scope,input.runId))
    ? rejectWorldviewMasterCandidateV2(input) : rejectMasterAgentCandidateV1(input)
}
export async function verifyMasterWithWorldviewV2(input:{scope:WorkspaceScope;runId:number;now?:number}) {
  return isWorldviewFieldRunV2(await readAgentRunV1(input.scope,input.runId))
    ? verifyWorldviewMasterV2(input) : verifyMasterAgentRunV1(input)
}
export async function recoverMasterWithWorldviewV2(scope:WorkspaceScope) {
  const native=await recoverWorldviewMasterAdoptionsV2(scope),legacy=await recoverPendingMasterAgentAdoptionsV1(scope)
  return {recoveredRunIds:[...native.recoveredRunIds,...legacy.recoveredRunIds],failed:[...native.failed,...legacy.failed]}
}
export async function findResumableMasterAgentRunV1(input:{scope:WorkspaceScope;conversationId:number}) {
  const {findPreparedWorldviewResumeV2}=await import('./worldview-field-v2-durable')
  return await findPreparedWorldviewResumeV2(input) ?? findLegacyResumableMasterAgentRunV1(input)
}

export {
  projectWorldviewImportedHistoryV2, findEndableWorldviewRunV2, endWorldviewMasterRunV2,
  findWorldviewReceivedRunV2, readWorldviewReceivedContentV2,
  type EndableWorldviewRunV2, type WorldviewReceivedRunV2, type WorldviewReceivedContentV2,
} from './worldview-field-v2-durable'

export function formatMasterBudgetSummaryV2(evidence:import('../team-budget').AgentTeamBudgetEvidence|import('./worldview-field-v2-durable').WorldviewTaskBudgetEvidenceV2):string {
  if ('usedTokens' in evidence) {
    const tokens = evidence.profile === 'service-capacity'
      ? `本轮团队约使用 ${evidence.usedTokens.toLocaleString()} tokens，`
      : `本轮团队约使用 ${evidence.usedTokens.toLocaleString()} / ${evidence.maxTokens.toLocaleString()} tokens，`
    return tokens + `${evidence.calls} 次调用，Canon 受控打回 ${evidence.canonRetries} 次。`
  }
  return `本轮 ${evidence.calls} 次调用；实际输入 ${evidence.observedInputTokens ?? '服务未报告'} tokens，实际输出 ${evidence.observedOutputTokens ?? '服务未报告'} tokens。`
}
