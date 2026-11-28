import { useAIConfigStore } from '../../stores/ai-config'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../types'
import { resolveReadScopeLike } from '../workspace/scope'
import { copyHistoryAuthorSelectionV1 } from '../types/history'
import { assertLongformHistoryScopeV1 } from '../history/authoring-scope'
import { assertSelectedHistoryEventsCompleteV1, parseHistoryEventCreationRequestV1, parseHistoryEventCandidatesV1, type HistoryEventCreationRequestV1, type HistoryEventCandidatesV1 } from '../history/event-creation-contract'
import { readHistoryEventCreationSnapshotV1, parseHistoryEventCreationSnapshotV1, assertHistoryEventCreationFreshV1, historyEventCreationMatchesBusinessV1, type HistoryEventCreationSnapshotV1 } from '../history/event-creation-adoption'
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
  scope: WorkspaceScope; worldGroupId: number | null; snapshot: HistoryEventCreationSnapshotV1; draft: string
}
function verifiedCandidate(input: CandidateInput) {
  const snapshot = parseHistoryEventCreationSnapshotV1(input.snapshot)
  if (snapshot.scope.projectId !== input.scope.projectId || snapshot.scope.worldId !== input.scope.worldId || snapshot.scope.workId !== input.scope.workId
    || snapshot.scope.worldGroupId !== input.worldGroupId) throw new Error('历史事件候选不属于当前作品、世界或分区。')
  return { snapshot, candidate: parseHistoryEventCandidatesV1(input.draft, snapshot.request) }
}
export async function assertHistoryEventCandidateReadyV1(input: CandidateInput) {
  const { snapshot, candidate } = verifiedCandidate(input)
  assertSelectedHistoryEventsCompleteV1(candidate)
  await assertHistoryEventCreationFreshV1(snapshot)
}
export async function adoptRestoredHistoryEventsCandidateV1(input: CandidateInput & { owner?: { transaction: Transaction } }) {
  const { snapshot, candidate } = verifiedCandidate(input)
  return adopt({ target: 'historicalTimelineEvents', mode: 'add-many', historyEventCreation: snapshot, data: candidate }, input.owner)
}
export async function historyEventsCandidateMatchesBusinessV1(input: CandidateInput) {
  const { snapshot, candidate } = verifiedCandidate(input)
  return historyEventCreationMatchesBusinessV1(snapshot, candidate)
}

export async function prepareHistoryEventsCopilotV1(input: {
  projectId: number; scope?: WorkspaceScope; worldGroupId: number | null; request: HistoryEventCreationRequestV1; authorRequest: string
  promptExecution?: PromptExecutionOptionsV1; contextProfile?: AgentContextProfile; configOverride?: AIConfig; signal?: AbortSignal
}, dependencies: { runAI?: (messages: ChatMessage[]) => Promise<string> } = {}) {
  input = { ...input, scope: input.scope ? { ...input.scope } : undefined, request: parseHistoryEventCreationRequestV1(input.request) }
  copyHistoryAuthorSelectionV1({ kind: 'partition', worldGroupId: input.worldGroupId })
  const request = input.request, scope = { ...await (input.scope ?? resolveReadScopeLike(input.projectId)) }
  if (scope.projectId !== input.projectId) throw new Error('历史事件生成项目不匹配。')
  await assertLongformHistoryScopeV1(scope, input.worldGroupId)
  const snapshot = await readHistoryEventCreationSnapshotV1({ ...scope, worldGroupId: input.worldGroupId }, request)
  const skill = resolveAgentSkillV1('world-origin', 'world-origin.history-events')
  const resolution = resolveRequestConfig(input.configOverride ?? useAIConfigStore.getState().config, { category: 'agent.world-foundation.history-events' })
  const config = resolution.config
  const { assembled, state, contextEvidence, contextGatewayExecution } = await prepareHistoryAuthoringContextV1({ scope, worldGroupId: input.worldGroupId,
    skill, config, label: '历史事件候选', authorRequest: input.authorRequest, profile: input.contextProfile, signal: input.signal })
  const hardSystem = [
    '你是叙事熔炉的历史时间轴起草 Skill。只提出新事件候选，不覆盖、删除或改名已有事件；已有相似事件要避让并补足前因后果。',
    '允许纯幻想从零起步；新增前提在描述中明确标为待确认设想。真实史实与未核实推断分开，不伪造史料或声称考证通过。候选默认没有被核实为史实。',
    'date完整保留架空日期、相对时间或时间待定；不把未知年份写成0，不强套公元、地球天文或中国朝代。不创建章节、人物、势力的假身份。',
    '每条给出完整的名称、时期、时间表达、发生过程（含前因）和影响。draftId只能用主机分配的身份，各项保持独立。',
    `本批最多${request.draftIds.length}项，可以更少。只输出JSON：${JSON.stringify({ version: 1, events: [{ draftId: request.draftIds[0], title: '事件名', era: 'custom', date: '灰潮之前三旬', description: '待确认设想：前因与发生过程', impact: '后果或待核对影响' }] })}`,
    '不得输出selectedIds、数字记录ID、owner、关联章节或其它字段。作者自行选择采纳。', buildAgentSkillInputGuidanceV1(skill, state),
  ].join('\n')
  let messages = appendSimplifiedChineseOutputConstraint([{ role: 'system', content: hardSystem }, { role: 'user', content: `生成方式：${request.mode}\n主机草稿身份：${JSON.stringify(request.draftIds)}\n作者要求：${input.authorRequest}\n\n${assembled.text}` }])
  let promptExecutionEvidence: PromptExecutionEvidenceV1 | undefined
  let generationOverrides: { temperature?: number; maxTokens?: number } = { temperature: 0.35 }
  if (input.promptExecution) {
    if (input.promptExecution.moduleKey !== 'history.timeline') throw new Error('事件候选模板与原任务不匹配。')
    const rendered = await renderFrozenPromptExecutionV1({ options: input.promptExecution, context: {
      worldContext: assembled.text, userHint: input.authorRequest, generationMode: request.mode,
    }, hardSystem, authorInstruction: input.authorRequest,
    additionalUserMessages: [`主机分配的草稿身份：${JSON.stringify(request.draftIds)}\n已登记正式历史与事件：\n${assembled.text}`] })
    messages = appendSimplifiedChineseOutputConstraint(rendered.messages)
    generationOverrides = { ...generationOverrides, ...rendered.generationOverrides }
    promptExecutionEvidence = { ...rendered.evidence, effectiveTemperature: generationOverrides.temperature ?? null, effectiveMaxTokens: generationOverrides.maxTokens ?? null }
  }
  const assertFresh = () => assertHistoryEventCreationFreshV1(snapshot, true)
  const runRaw = async (sent: ChatMessage[], result?: ChatResult) => {
    await assertFresh()
    const observed = result ?? {}; observed.beforeModelDispatch = assertFresh
    const output = dependencies.runAI ? await dependencies.runAI(sent) : await executeRegisteredAIEntryV1('world.history-events', sent, config,
      { category: 'agent.world-foundation.history-events', projectId: input.projectId, configOverrides: generationOverrides, contextOverflowPolicy: 'reject' }, input.signal, observed, undefined, resolution)
    return { output }
  }
  const node: GenerationNode<unknown, HistoryEventCandidatesV1, unknown> = {
    id: `agent.history-events:${scope.projectId}`, kind: 'world-origin.history-events', editableInput: true, assembleInput: () => messages,
    run: async sent => parseHistoryEventCandidatesV1((await runRaw(sent)).output, request, false), gate: () => ({ status: 'pass', issues: [] }),
    adopt: output => adoptRestoredHistoryEventsCandidateV1({ scope, worldGroupId: input.worldGroupId, snapshot, draft: JSON.stringify(output) }),
  }
  await assertFresh()
  return { node, prepared: prepareGenerationNode(node, {}), input: { assembled }, snapshot, contextSources: contextEvidence.included,
    contextEvidence, contextGatewayExecution, promptExecutionEvidence, label: '历史事件候选', modelIdentity: { provider: config.provider, model: config.model }, runRaw }
}
