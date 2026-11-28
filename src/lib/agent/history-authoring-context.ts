import type { AIConfig, WorkspaceScope } from '../types'
import type { History, HistoricalTimelineEvent, HistoricalKeyword } from '../types/history'
import { readOwnedRows } from '../workspace/scope'
import { canonRowResourceKeysV1 } from '../context-gateway/canon-provider'
import { executeContextGatewayV1 } from '../context-gateway/execution'
import { assembleContextGatewayPacketV1, projectContextGatewayInputStateV1, contextGatewayInputStateSourceKeysV1 } from './context-gateway-input'
import { attachAgentContextInputStateV1, evidenceFromContextResult, resolveAgentContextPolicy, type AgentContextProfile } from './context-policy'
import type { AgentSkillDefinitionV1 } from './skill-registry'

/** Resource identities are resolved here; only the registered Canon Gateway
 * renders formal content. The UI and individual history actions never splice DB text. */
export async function prepareHistoryAuthoringContextV1(input: {
  scope: WorkspaceScope; worldGroupId: number | null; skill: AgentSkillDefinitionV1; config: AIConfig
  label: string; authorRequest: string; includeKeywords?: boolean; profile?: AgentContextProfile; signal?: AbortSignal
}) {
  const profile = input.profile ?? 'balanced', policy = resolveAgentContextPolicy(input.skill.contextTaskKind, profile)
  const [historyRows, eventRows, keywordRows] = await Promise.all([
    readOwnedRows<History>(input.scope, 'histories', { owner: 'world' }),
    readOwnedRows<HistoricalTimelineEvent>(input.scope, 'historicalTimelineEvents', { owner: 'world' }),
    input.includeKeywords ? readOwnedRows<HistoricalKeyword>(input.scope, 'historicalKeywords', { owner: 'world' }) : Promise.resolve([]),
  ])
  const histories = historyRows.filter(row => (row.worldGroupId ?? null) === input.worldGroupId)
  if (histories.length > 1) throw new Error('该历史分区有多条总述记录，请先核对原始数据。')
  const resources = await Promise.all([
    ...histories.map(row => canonRowResourceKeysV1('histories', { ...row })),
    ...eventRows.filter(row => (row.worldGroupId ?? null) === input.worldGroupId).map(row => canonRowResourceKeysV1('historicalTimelineEvents', { ...row })),
    ...keywordRows.filter(row => (row.worldGroupId ?? null) === input.worldGroupId).map(row => canonRowResourceKeysV1('historicalKeywords', { ...row })),
  ])
  const mandatory = resources.map(item => { if (!item.record) throw new Error('历史来源缺少可验证身份，未调用模型。'); return item.record })
  const contextGatewayExecution = await executeContextGatewayV1({ skill: input.skill, modelConfig: input.config, scope: input.scope, worldGroupId: input.worldGroupId,
    query: `${input.label}：${input.authorRequest}。依据当前世界起源、历史、纪年、事件和作者约束创作。`,
    mandatoryResourceKeys: mandatory, mandatoryFullResourceKeys: mandatory, targetResourceKeys: histories.length ? [mandatory[0]] : [],
    budgetTokens: Math.min(policy.maxInputTokens, input.skill.contextGateway!.maxRetrievedTokens), additionalReadsEnabled: false, signal: input.signal })
  const assembled = assembleContextGatewayPacketV1(contextGatewayExecution, contextGatewayExecution.modelBudget?.inputBudget ?? policy.maxInputTokens)
  const state = projectContextGatewayInputStateV1(input.skill, contextGatewayExecution, assembled)
  const contextEvidence = attachAgentContextInputStateV1(evidenceFromContextResult(profile, assembled), state)
  contextEvidence.inputStateSourceKeys = contextGatewayInputStateSourceKeysV1(input.skill, contextGatewayExecution)
  return { assembled, state, contextEvidence, contextGatewayExecution }
}
