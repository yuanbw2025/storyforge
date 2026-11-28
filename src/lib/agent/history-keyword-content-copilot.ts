import { useAIConfigStore } from '../../stores/ai-config'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../types'
import { resolveReadScopeLike } from '../workspace/scope'
import { copyHistoryAuthorSelectionV1 } from '../types/history'
import { assertLongformHistoryScopeV1 } from '../history/authoring-scope'
import { assertHistoryKeywordContentSelectedV1, parseHistoryKeywordContentRequestV1, parseHistoryKeywordContentV1, readHistoryKeywordContentSnapshotV1, parseHistoryKeywordContentSnapshotV1, assertHistoryKeywordContentFreshV1, historyKeywordContentMatchesDraftsV1, type HistoryKeywordContentRequestV1, type HistoryKeywordContentV1, type HistoryKeywordContentSnapshotV1 } from '../history/keyword-content'
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
  scope: WorkspaceScope; worldGroupId: number | null; snapshot: HistoryKeywordContentSnapshotV1; draft: string
}
function verifiedCandidate(input: CandidateInput) {
  const snapshot = parseHistoryKeywordContentSnapshotV1(input.snapshot)
  if (snapshot.scope.projectId !== input.scope.projectId || snapshot.scope.worldId !== input.scope.worldId || snapshot.scope.workId !== input.scope.workId
    || snapshot.worldGroupId !== input.worldGroupId) throw new Error('历史关键词内容不属于当前作品、世界或分区。')
  return { snapshot, candidate: parseHistoryKeywordContentV1(input.draft, snapshot.request) }
}
export async function assertHistoryKeywordContentReadyV1(input: CandidateInput) {
  const { snapshot, candidate } = verifiedCandidate(input)
  assertHistoryKeywordContentSelectedV1(candidate)
  await assertHistoryKeywordContentFreshV1(snapshot)
}
export async function adoptRestoredHistoryKeywordContentCandidateV1(input: CandidateInput & { owner?: { transaction: Transaction } }) {
  const { snapshot, candidate } = verifiedCandidate(input)
  return adopt({ target: 'agentEvents', mode: 'add-many', historyKeywordContent: snapshot, data: candidate }, input.owner)
}
export async function historyKeywordContentCandidateMatchesDraftsV1(input: CandidateInput) {
  const { snapshot, candidate } = verifiedCandidate(input)
  return historyKeywordContentMatchesDraftsV1(snapshot, candidate)
}

export async function prepareHistoryKeywordContentCopilotV1(input: {
  projectId: number; scope?: WorkspaceScope; worldGroupId: number | null; request: HistoryKeywordContentRequestV1; authorRequest: string
  promptExecution?: PromptExecutionOptionsV1; contextProfile?: AgentContextProfile; configOverride?: AIConfig; signal?: AbortSignal
}, dependencies: { runAI?: (messages: ChatMessage[]) => Promise<string> } = {}) {
  input = { ...input, scope: input.scope ? { ...input.scope } : undefined, request: parseHistoryKeywordContentRequestV1(input.request) }
  copyHistoryAuthorSelectionV1({ kind: 'partition', worldGroupId: input.worldGroupId })
  const request = input.request, scope = { ...await (input.scope ?? resolveReadScopeLike(input.projectId)) }
  if (scope.projectId !== input.projectId) throw new Error('历史关键词条目创作项目不匹配。')
  await assertLongformHistoryScopeV1(scope, input.worldGroupId)
  const snapshot = await readHistoryKeywordContentSnapshotV1({ scope, worldGroupId: input.worldGroupId }, request)
  const skill = resolveAgentSkillV1('world-origin', 'world-origin.history-keyword-content')
  const resolution = resolveRequestConfig(input.configOverride ?? useAIConfigStore.getState().config, { category: 'agent.world-foundation.history-keyword-content' })
  const config = resolution.config
  const { assembled, state, contextEvidence, contextGatewayExecution } = await prepareHistoryAuthoringContextV1({ scope, worldGroupId: input.worldGroupId,
    skill, config, includeKeywords: true, label: '历史关键词内容', authorRequest: input.authorRequest, profile: input.contextProfile, signal: input.signal })
  const hardSystem = [
    '你是历史关键词条目创作 Skill。只为主机指定的已有作者草稿及字段生成候选。保留作者已填约束；作者内容是本次输入，尚不是正式设定。创作方向只能作为待确认建议，不声称作者已经同意。',
    '允许纯幻想从零起步，新增前提明确标为待确认设想；不伪造真实史料，不强套地球历法或朝代。',
    `只输出JSON：${JSON.stringify({ version: 1, patches: [{ draftId: request.targets[0].draftId, values: Object.fromEntries(request.targets[0].fields.map(field => [field, '待确认的字段候选文字'])) }] })}`,
    '只能输出请求内draftId与字段，禁止选择采纳、改名、改分类、改时期、自动关联章节、owner和本机记录ID。无法完整返回时只保留已完成字段；不伪造缺失条目，不自动重发。',
    buildAgentSkillInputGuidanceV1(skill, state),
  ].join('\n')
  const requestedDrafts = snapshot.baseline.value.drafts.filter(row => request.targets.some(target => target.draftId === row.draftId))
  const authorInputs = JSON.stringify({ request, drafts: requestedDrafts })
  let messages = appendSimplifiedChineseOutputConstraint([{ role: 'system', content: hardSystem }, { role: 'user', content: `本次作者草稿与固定字段范围：${authorInputs}\n作者要求：${input.authorRequest}\n\n${assembled.text}` }])
  let promptExecutionEvidence: PromptExecutionEvidenceV1 | undefined
  let generationOverrides: { temperature?: number; maxTokens?: number } = { temperature: 0.35 }
  if (input.promptExecution) {
    if (input.promptExecution.moduleKey !== 'history.keyword-content') throw new Error('关键词条目模板与原任务不匹配。')
    const rendered = await renderFrozenPromptExecutionV1({ options: input.promptExecution, context: {
      worldContext: assembled.text, userHint: input.authorRequest,
    }, hardSystem, authorInstruction: input.authorRequest,
    additionalUserMessages: [`本次作者草稿与固定字段范围：${authorInputs}\n已登记正式历史与事件：\n${assembled.text}`] })
    messages = appendSimplifiedChineseOutputConstraint(rendered.messages)
    generationOverrides = { ...generationOverrides, ...rendered.generationOverrides }
    promptExecutionEvidence = { ...rendered.evidence, effectiveTemperature: generationOverrides.temperature ?? null, effectiveMaxTokens: generationOverrides.maxTokens ?? null }
  }
  const assertFresh = () => assertHistoryKeywordContentFreshV1(snapshot)
  const runRaw = async (sent: ChatMessage[], result?: ChatResult) => {
    await assertFresh()
    const observed = result ?? {}; observed.beforeModelDispatch = assertFresh
    const output = dependencies.runAI ? await dependencies.runAI(sent) : await executeRegisteredAIEntryV1('world.history-keyword-content', sent, config,
      { category: 'agent.world-foundation.history-keyword-content', projectId: input.projectId, configOverrides: generationOverrides, contextOverflowPolicy: 'reject' }, input.signal, observed, undefined, resolution)
    return { output }
  }
  const node: GenerationNode<unknown, HistoryKeywordContentV1, unknown> = {
    id: `agent.history-keyword-content:${scope.projectId}`, kind: 'world-origin.history-keyword-content', editableInput: true, assembleInput: () => messages,
    run: async sent => parseHistoryKeywordContentV1((await runRaw(sent)).output, request, false), gate: () => ({ status: 'pass', issues: [] }),
    adopt: output => adoptRestoredHistoryKeywordContentCandidateV1({ scope, worldGroupId: input.worldGroupId, snapshot, draft: JSON.stringify(output) }),
  }
  await assertFresh()
  return { node, prepared: prepareGenerationNode(node, {}), input: { assembled }, snapshot, contextSources: contextEvidence.included,
    contextEvidence, contextGatewayExecution, promptExecutionEvidence, label: '历史关键词内容', modelIdentity: { provider: config.provider, model: config.model }, runRaw }
}
