import { useAIConfigStore } from '../../stores/ai-config'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../types'
import { resolveReadScopeLike } from '../workspace/scope'
import { copyHistoryAuthorSelectionV1 } from '../types/history'
import { assertLongformHistoryScopeV1 } from '../history/authoring-scope'
import { assertHistoryKeywordSuggestionsSelectedV1, parseHistoryKeywordSuggestionRequestV1, parseHistoryKeywordSuggestionsV1, readHistoryKeywordSuggestionsSnapshotV1, parseHistoryKeywordSuggestionsSnapshotV1, assertHistoryKeywordSuggestionsFreshV1, historyKeywordSuggestionsMatchDraftsV1, type HistoryKeywordSuggestionRequestV1, type HistoryKeywordSuggestionsV1, type HistoryKeywordSuggestionsSnapshotV1 } from '../history/keyword-suggestions'
import { adopt } from '../registry/adopt'
import type { Transaction } from 'dexie'
import { prepareHistoryAuthoringContextV1 } from './history-authoring-context'
import { resolveAgentSkillV1, buildAgentSkillInputGuidanceV1 } from './skill-registry'
import { resolveRequestConfig, type ChatResult } from '../ai/client'
import { executeRegisteredAIEntryV1 } from './formal-ai-entry'
import { appendSimplifiedChineseOutputConstraint } from '../ai/adapters/prompt-guards'
import { prepareGenerationNode, type GenerationNode } from '../generation/generation-node'
import type { AgentContextProfile } from './context-policy'
import { renderFrozenPromptExecutionV1, type PromptExecutionOptionsV1, type PromptExecutionEvidenceV1 } from './prompt-execution'

interface CandidateInput {
  scope: WorkspaceScope; worldGroupId: number | null; snapshot: HistoryKeywordSuggestionsSnapshotV1; draft: string
}
function verifiedCandidate(input: CandidateInput) {
  const snapshot = parseHistoryKeywordSuggestionsSnapshotV1(input.snapshot)
  if (snapshot.scope.projectId !== input.scope.projectId || snapshot.scope.worldId !== input.scope.worldId || snapshot.scope.workId !== input.scope.workId
    || snapshot.worldGroupId !== input.worldGroupId) throw new Error('历史关键词建议不属于当前作品、世界或分区。')
  return { snapshot, candidate: parseHistoryKeywordSuggestionsV1(input.draft, snapshot.request) }
}
export async function assertHistoryKeywordSuggestionsReadyV1(input: CandidateInput) {
  const { snapshot, candidate } = verifiedCandidate(input)
  assertHistoryKeywordSuggestionsSelectedV1(candidate)
  await assertHistoryKeywordSuggestionsFreshV1(snapshot)
}
export async function adoptRestoredHistoryKeywordSuggestionsCandidateV1(input: CandidateInput & { owner?: { transaction: Transaction } }) {
  const { snapshot, candidate } = verifiedCandidate(input)
  return adopt({ target: 'agentEvents', mode: 'add-many', historyKeywordSuggestions: snapshot, data: candidate }, input.owner)
}
export async function historyKeywordSuggestionsCandidateMatchesDraftsV1(input: CandidateInput) {
  const { snapshot, candidate } = verifiedCandidate(input)
  return historyKeywordSuggestionsMatchDraftsV1(snapshot, candidate)
}

export async function prepareHistoryKeywordSuggestionsCopilotV1(input: {
  projectId: number; scope?: WorkspaceScope; worldGroupId: number | null; request: HistoryKeywordSuggestionRequestV1; authorRequest: string
  promptExecution?: PromptExecutionOptionsV1; contextProfile?: AgentContextProfile; configOverride?: AIConfig; signal?: AbortSignal
}, dependencies: { runAI?: (messages: ChatMessage[]) => Promise<string> } = {}) {
  input = { ...input, scope: input.scope ? { ...input.scope } : undefined, request: parseHistoryKeywordSuggestionRequestV1(input.request) }
  copyHistoryAuthorSelectionV1({ kind: 'partition', worldGroupId: input.worldGroupId })
  const request = input.request, scope = { ...await (input.scope ?? resolveReadScopeLike(input.projectId)) }
  if (scope.projectId !== input.projectId) throw new Error('历史关键词推荐项目不匹配。')
  await assertLongformHistoryScopeV1(scope, input.worldGroupId)
  const snapshot = await readHistoryKeywordSuggestionsSnapshotV1({ scope, worldGroupId: input.worldGroupId }, request)
  const skill = resolveAgentSkillV1('world-origin', 'world-origin.history-keyword-suggestions')
  const resolution = resolveRequestConfig(input.configOverride ?? useAIConfigStore.getState().config, { category: 'agent.world-foundation.history-keyword-suggestions' })
  const config = resolution.config
  const { assembled, state, contextEvidence, contextGatewayExecution } = await prepareHistoryAuthoringContextV1({ scope, worldGroupId: input.worldGroupId,
    skill, config, includeKeywords: true, label: '历史关键词建议', authorRequest: input.authorRequest, profile: input.contextProfile, signal: input.signal })
  const hardSystem = [
    '你是叙事熔炉的历史关键词推荐 Skill。只推荐不同维度的关键词，解释适合当前设定的理由；避开已登记的相同词条，不生成条目正文、不替作者写个人意见。',
    '允许纯幻想从零起步，新增前提明确标为待确认设想；不伪造真实史料，不强套地球历法或朝代。',
    `最多${request.draftIds.length}项，可以更少。只输出JSON：${JSON.stringify({ version: 1, suggestions: [{ draftId: request.draftIds[0], keyword: '灰潮飞钱', category: 'economy', era: 'custom', reason: '待确认设想：可丰富商路和市井生活。' }] })}`,
    'category只能为technology/institution/culture/economy/architecture。draftId只使用主机分配的身份；不得输出selectedIds、正文、创作方向、owner或本机记录ID。',
    buildAgentSkillInputGuidanceV1(skill, state),
  ].join('\n')
  let messages = appendSimplifiedChineseOutputConstraint([{ role: 'system', content: hardSystem }, { role: 'user', content: `主机草稿身份：${JSON.stringify(request.draftIds)}\n作者要求：${input.authorRequest}\n\n${assembled.text}` }])
  let promptExecutionEvidence: PromptExecutionEvidenceV1 | undefined
  let generationOverrides: { temperature?: number; maxTokens?: number } = { temperature: 0.35 }
  if (input.promptExecution) {
    if (input.promptExecution.moduleKey !== 'history.keyword-suggestions') throw new Error('关键词建议模板与原任务不匹配。')
    const rendered = await renderFrozenPromptExecutionV1({ options: input.promptExecution, context: {
      worldContext: assembled.text, userHint: input.authorRequest,
    }, hardSystem, authorInstruction: input.authorRequest,
    additionalUserMessages: [`主机分配的草稿身份：${JSON.stringify(request.draftIds)}\n已登记正式历史与事件：\n${assembled.text}`] })
    messages = appendSimplifiedChineseOutputConstraint(rendered.messages)
    generationOverrides = { ...generationOverrides, ...rendered.generationOverrides }
    promptExecutionEvidence = { ...rendered.evidence, effectiveTemperature: generationOverrides.temperature ?? null, effectiveMaxTokens: generationOverrides.maxTokens ?? null }
  }
  const assertFresh = () => assertHistoryKeywordSuggestionsFreshV1(snapshot)
  const runRaw = async (sent: ChatMessage[], result?: ChatResult) => {
    await assertFresh()
    const observed = result ?? {}; observed.beforeModelDispatch = assertFresh
    const output = dependencies.runAI ? await dependencies.runAI(sent) : await executeRegisteredAIEntryV1('world.history-keyword-suggestions', sent, config,
      { category: 'agent.world-foundation.history-keyword-suggestions', projectId: input.projectId, configOverrides: generationOverrides, contextOverflowPolicy: 'reject' }, input.signal, observed, undefined, resolution)
    return { output }
  }
  const node: GenerationNode<unknown, HistoryKeywordSuggestionsV1, unknown> = {
    id: `agent.history-keyword-suggestions:${scope.projectId}`, kind: 'world-origin.history-keyword-suggestions', editableInput: true, assembleInput: () => messages,
    run: async sent => parseHistoryKeywordSuggestionsV1((await runRaw(sent)).output, request, false), gate: () => ({ status: 'pass', issues: [] }),
    adopt: output => adoptRestoredHistoryKeywordSuggestionsCandidateV1({ scope, worldGroupId: input.worldGroupId, snapshot, draft: JSON.stringify(output) }),
  }
  await assertFresh()
  return { node, prepared: prepareGenerationNode(node, {}), input: { assembled }, snapshot, contextSources: contextEvidence.included,
    contextEvidence, contextGatewayExecution, promptExecutionEvidence, label: '历史关键词建议', modelIdentity: { provider: config.provider, model: config.model }, runRaw }
}
