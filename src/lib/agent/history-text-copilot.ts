import { renderFrozenPromptExecutionV1, type PromptExecutionOptionsV1, type PromptExecutionEvidenceV1 } from './prompt-execution'
import Dexie, { type Transaction } from 'dexie'
import { db } from '../db/schema'
import { historyAuthorRecordV1, copyHistoryAuthorOriginV1, copyHistoryAuthorSelectionV1, type History, type HistoricalTimelineEvent } from '../types/history'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../types'
import { readOwnedRows, resolveReadScopeLike, assertRecordInScope } from '../workspace/scope'
import { adopt } from '../registry/adopt'
import { hashCanonicalValue } from './run/hash'
import { canonRowResourceKeysV1 } from '../context-gateway/canon-provider'
import { executeContextGatewayV1 } from '../context-gateway/execution'
import { resolveAgentSkillV1, buildAgentSkillInputGuidanceV1 } from './skill-registry'
import { assembleContextGatewayPacketV1, projectContextGatewayInputStateV1, contextGatewayInputStateSourceKeysV1 } from './context-gateway-input'
import { attachAgentContextInputStateV1, evidenceFromContextResult, resolveAgentContextPolicy, type AgentContextProfile } from './context-policy'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig, type ChatResult } from '../ai/client'
import { executeRegisteredAIEntryV1 } from './formal-ai-entry'
import { appendSimplifiedChineseOutputConstraint } from '../ai/adapters/prompt-guards'
import { prepareGenerationNode, type GenerationNode } from '../generation/generation-node'

export type HistoryTextFieldV1 = 'overview' | 'eraSystem'
export interface HistoryTextRequestV1 { field: HistoryTextFieldV1; mode: 'expand' | 'rewrite' | 'polish' }
export interface HistoryTextSnapshotV1 {
  version: 1; scope: WorkspaceScope; worldGroupId: number | null; request: HistoryTextRequestV1
  baseline: { recordId: number | null; overview: string; eraSystem: string }; baselineHash: string
}
export const HISTORY_TEXT_LABELS_V1 = { overview: '历史总述', eraSystem: '纪年体系' } as const
export function parseHistoryTextRequestV1(value: unknown): HistoryTextRequestV1 {
  const row = historyAuthorRecordV1(value, ['field', 'mode'], '生成请求')
  if (!['overview', 'eraSystem'].includes(String(row.field)) || !['expand', 'rewrite', 'polish'].includes(String(row.mode))) throw new Error('历史生成须选择总述或纪年及生成方式。')
  return { field: row.field as HistoryTextFieldV1, mode: row.mode as HistoryTextRequestV1['mode'] }
}
export function parseHistoryTextSnapshotV1(value: unknown): HistoryTextSnapshotV1 {
  const row = historyAuthorRecordV1(value, ['version', 'scope', 'worldGroupId', 'request', 'baseline', 'baselineHash'], '候选快照')
  const origin = copyHistoryAuthorOriginV1({ version: 1, kind: 'work', scope: row.scope })
  if (origin.kind !== 'work') throw new Error('历史生成需要原长篇作品。')
  copyHistoryAuthorSelectionV1({ kind: 'partition', worldGroupId: row.worldGroupId })
  const baseline = historyAuthorRecordV1(row.baseline, ['recordId', 'overview', 'eraSystem'], '文字基线')
  if (row.version !== 1 || typeof row.baselineHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.baselineHash)
    || (baseline.recordId !== null && (!Number.isSafeInteger(baseline.recordId) || Number(baseline.recordId) < 1))
    || typeof baseline.overview !== 'string' || typeof baseline.eraSystem !== 'string') throw new Error('历史候选基线无效。')
  return { version: 1, scope: origin.scope, worldGroupId: row.worldGroupId as number | null, request: parseHistoryTextRequestV1(row.request),
    baseline: { recordId: baseline.recordId as number | null, overview: baseline.overview, eraSystem: baseline.eraSystem }, baselineHash: row.baselineHash }
}
export function parseHistoryTextCandidateV1(raw: string): { version: 1; value: string } {
  let input: unknown
  try { input = JSON.parse(raw) } catch { throw new Error('历史候选需要完整 JSON；原响应保留，可修改后再采纳。') }
  const row = historyAuthorRecordV1(input, ['version', 'value'], '文字候选')
  if (row.version !== 1 || typeof row.value !== 'string') throw new Error('历史候选只能包含本次字段的文字。')
  return { version: 1, value: row.value }
}
export function assertHistoryTextAdmissionV1(scope: WorkspaceScope, worldGroupId: number | null, transaction?: Transaction) {
  const projects = transaction ? transaction.table(db.projects.name) : db.projects
  const works = transaction ? transaction.table(db.works.name) : db.works
  return Dexie.Promise.all([projects.get(scope.projectId), works.get(scope.workId)]).then(([project, work]) => {
    if (project?.enableMultiWorld && worldGroupId === null) throw new Error('请选择具体历史分区后生成。')
    if (!project || project.workspacePurpose === 'world-engine' || project.activeWorldId !== scope.worldId || project.activeWorkId !== scope.workId
      || work?.kind !== 'novel' || work.novelProfile !== 'long' || work.projectId !== scope.projectId || work.worldId !== scope.worldId) throw new Error('请回到原长篇作品核对历史生成目标。')
  })
}
async function readBaseline(scope: WorkspaceScope, worldGroupId: number | null) {
  if (worldGroupId !== null && !await assertRecordInScope(scope, 'worldGroups', await db.worldGroups.get(worldGroupId), { owner: 'world' })) throw new Error('历史分区不属于当前世界。')
  const rows = (await readOwnedRows<History>(scope, 'histories', { owner: 'world' })).filter(row => (row.worldGroupId ?? null) === worldGroupId)
  if (rows.length > 1) throw new Error('该历史分区有多条记录，请先核对原始数据。')
  const row = rows[0]
  return { row, baseline: { recordId: row?.id ?? null, overview: row?.overview ?? '', eraSystem: row?.eraSystem ?? '' } }
}
async function verified(input: { scope: WorkspaceScope; worldGroupId: number | null; snapshot: HistoryTextSnapshotV1; draft: string }) {
  const snapshot = parseHistoryTextSnapshotV1(input.snapshot)
  if (snapshot.scope.projectId !== input.scope.projectId || snapshot.scope.worldId !== input.scope.worldId || snapshot.scope.workId !== input.scope.workId
    || snapshot.worldGroupId !== input.worldGroupId) throw new Error('历史候选不属于当前作品、世界或分区。')
  if (await hashCanonicalValue(snapshot.baseline) !== snapshot.baselineHash) throw new Error('历史候选基线哈希不匹配。')
  return { snapshot, candidate: parseHistoryTextCandidateV1(input.draft) }
}
export async function assertHistoryTextCandidateReadyV1(input: { scope: WorkspaceScope; worldGroupId: number | null; snapshot: HistoryTextSnapshotV1; draft: string }) {
  input = { ...input, scope: { ...input.scope }, snapshot: parseHistoryTextSnapshotV1(input.snapshot) }
  const { snapshot } = await verified(input)
  await assertHistoryTextAdmissionV1(input.scope, input.worldGroupId)
  const { baseline } = await readBaseline(input.scope, input.worldGroupId)
  if (await hashCanonicalValue(baseline) !== snapshot.baselineHash) throw new Error('[HistoryText] 原历史内容已变化，候选保留，请重新对照。')
}
export async function adoptRestoredHistoryTextCandidateV1(input: { scope: WorkspaceScope; worldGroupId: number | null; snapshot: HistoryTextSnapshotV1; draft: string; owner?: { transaction: Transaction } }) {
  input = { ...input, scope: { ...input.scope }, snapshot: parseHistoryTextSnapshotV1(input.snapshot) }
  const result = input.owner ? await Dexie.waitFor(verified(input)) : await verified(input)
  if (input.owner) await Dexie.waitFor(assertHistoryTextAdmissionV1(input.scope, input.worldGroupId, input.owner.transaction))
  else await assertHistoryTextAdmissionV1(input.scope, input.worldGroupId)
  return adopt({ target: 'histories', mode: 'replace', projectId: input.scope.projectId, scope: input.scope,
    worldGroupId: input.worldGroupId, historyTextBaseline: result.snapshot.baseline,
    data: result.snapshot.request.field === 'overview' ? { overview: result.candidate.value } : { eraSystem: result.candidate.value } }, input.owner)
}
export async function historyTextCandidateMatchesBusinessV1(input: { scope: WorkspaceScope; worldGroupId: number | null; snapshot: HistoryTextSnapshotV1; draft: string }) {
  input = { ...input, scope: { ...input.scope }, snapshot: parseHistoryTextSnapshotV1(input.snapshot) }
  const { snapshot, candidate } = await verified(input), { baseline } = await readBaseline(input.scope, input.worldGroupId)
  return baseline[snapshot.request.field] === candidate.value && baseline[otherField(snapshot.request.field)] === snapshot.baseline[otherField(snapshot.request.field)]
}
function otherField(field: HistoryTextFieldV1): HistoryTextFieldV1 { return field === 'overview' ? 'eraSystem' : 'overview' }

export async function prepareHistoryTextCopilotV1(input: { projectId: number; scope?: WorkspaceScope; worldGroupId: number | null; request: HistoryTextRequestV1; authorRequest: string; promptExecution?: PromptExecutionOptionsV1; contextProfile?: AgentContextProfile; configOverride?: AIConfig; signal?: AbortSignal }, dependencies: { runAI?: (messages: ChatMessage[]) => Promise<string> } = {}) {
  input = { ...input, scope: input.scope ? { ...input.scope } : undefined, request: parseHistoryTextRequestV1(input.request) }
  copyHistoryAuthorSelectionV1({ kind: 'partition', worldGroupId: input.worldGroupId })
  const request = input.request
  const scope = { ...await (input.scope ?? resolveReadScopeLike(input.projectId)) }
  if (scope.projectId !== input.projectId) throw new Error('历史生成项目不匹配。')
  await assertHistoryTextAdmissionV1(scope, input.worldGroupId)
  const { baseline, row } = await readBaseline(scope, input.worldGroupId)
  const snapshot: HistoryTextSnapshotV1 = { version: 1, scope, worldGroupId: input.worldGroupId, request, baseline, baselineHash: await hashCanonicalValue(baseline) }
  const skill = resolveAgentSkillV1('world-origin', 'world-origin.history-text')
  const resolution = resolveRequestConfig(input.configOverride ?? useAIConfigStore.getState().config, { category: 'agent.world-foundation.history-text' })
  const config = resolution.config
  const profile = input.contextProfile ?? 'balanced', policy = resolveAgentContextPolicy(skill.contextTaskKind, profile)
  // Resolve registered resource identities only; Canon Gateway supplies every formal source text.
  const rows = await readOwnedRows<HistoricalTimelineEvent>(scope, 'historicalTimelineEvents', { owner: 'world' })
  const resources = await Promise.all([
    ...(row ? [canonRowResourceKeysV1('histories', { ...row })] : []),
    ...rows.filter(item => (item.worldGroupId ?? null) === input.worldGroupId).map(item => canonRowResourceKeysV1('historicalTimelineEvents', { ...item })),
  ])
  const mandatory = resources.map(item => { if (!item.record) throw new Error('历史来源缺少可验证身份，未调用模型。'); return item.record })
  const contextGatewayExecution = await executeContextGatewayV1({ skill, modelConfig: config, scope, worldGroupId: input.worldGroupId,
    query: `${HISTORY_TEXT_LABELS_V1[request.field]}：${input.authorRequest}。依据当前世界起源、历史、纪年、事件和作者约束创作。`,
    mandatoryResourceKeys: mandatory, mandatoryFullResourceKeys: mandatory, targetResourceKeys: row ? [mandatory[0]] : [],
    budgetTokens: Math.min(policy.maxInputTokens, skill.contextGateway!.maxRetrievedTokens), additionalReadsEnabled: false, signal: input.signal })
  const assembled = assembleContextGatewayPacketV1(contextGatewayExecution, contextGatewayExecution.modelBudget?.inputBudget ?? policy.maxInputTokens)
  const state = projectContextGatewayInputStateV1(skill, contextGatewayExecution, assembled)
  const contextEvidence = attachAgentContextInputStateV1(evidenceFromContextResult(profile, assembled), state)
  contextEvidence.inputStateSourceKeys = contextGatewayInputStateSourceKeysV1(skill, contextGatewayExecution)
  const assertFresh = () => assertHistoryTextCandidateReadyV1({ scope, worldGroupId: input.worldGroupId, snapshot, draft: '{"version":1,"value":""}' })
  let messages = appendSimplifiedChineseOutputConstraint([{ role: 'system', content: [
    '你是叙事熔炉历史文本创作 Skill。只输出本次固定字段的可编辑候选，不直接写正式设定。',
    '总述组织时代、文明兴衰与转折因果；纪年组织起点、跨纪元、年/月/日和示例。保留作者已确认事实与幻想前提，不默认套地球历法、朝代或太阳。',
    '没有既有资料时允许纯幻想起步，把新增前提明确写成待确认设想；真实史实、未核实推断与创作假设分开，不伪造考证来源。',
    request.mode === 'expand' ? '扩写：完整保留原事实与因果边界，补充细节；输出完整替代文字，不能只给补丁。' : request.mode === 'polish' ? '润色：保留原事实，只改善表达。' : '按作者要求重写选中字段，保持未选字段约束。',
    buildAgentSkillInputGuidanceV1(skill, state), '只输出 JSON：{"version":1,"value":"完整候选文字"}。不要输出其他字段或事件数组。',
  ].join('\n') }, { role: 'user', content: `目标：${HISTORY_TEXT_LABELS_V1[request.field]}\n作者要求：${input.authorRequest}\n\n${assembled.text}` }])
  let promptExecutionEvidence: PromptExecutionEvidenceV1 | undefined
  let generationOverrides: { temperature?: number; maxTokens?: number } = { temperature: 0.35 }
  if (input.promptExecution) {
    const expectedModule = request.field === 'overview' ? 'history.overview' : 'history.calendar'
    if (input.promptExecution.moduleKey !== expectedModule) throw new Error('历史模板与原字段不匹配。')
    const rendered = await renderFrozenPromptExecutionV1({ options: input.promptExecution,
      context: { dimension: HISTORY_TEXT_LABELS_V1[request.field], generationMode: request.mode,
        currentValue: baseline[request.field], worldContext: assembled.text, userHint: input.authorRequest },
      hardSystem: messages[0].content, authorInstruction: input.authorRequest,
      // The editable template cannot omit or replace the registered formal packet.
      additionalUserMessages: [`目标：${HISTORY_TEXT_LABELS_V1[request.field]}\n【已登记正式上下文】\n${assembled.text}`],
    })
    messages = rendered.messages
    generationOverrides = { ...generationOverrides, ...rendered.generationOverrides }
    promptExecutionEvidence = { ...rendered.evidence, effectiveTemperature: generationOverrides.temperature ?? null,
      effectiveMaxTokens: generationOverrides.maxTokens ?? null }
  }
  const runRaw = async (sent: ChatMessage[], result?: ChatResult) => {
    await assertFresh()
    const observedResult = result ?? {}
    observedResult.beforeModelDispatch = assertFresh
    const output = dependencies.runAI ? await dependencies.runAI(sent) : await executeRegisteredAIEntryV1('world.history-text', sent, config, {
      category: 'agent.world-foundation.history-text', projectId: input.projectId,
      configOverrides: generationOverrides, contextOverflowPolicy: 'reject',
    }, input.signal, observedResult, undefined, resolution)
    return { output }
  }
  const node: GenerationNode<unknown, { version: 1; value: string }, unknown> = {
    id: `agent.history-text:${scope.projectId}:${request.field}`, kind: 'world-origin.history-text', editableInput: true,
    assembleInput: () => messages, run: async sent => parseHistoryTextCandidateV1((await runRaw(sent)).output),
    gate: () => ({ status: 'pass', issues: [] }),
    adopt: output => adoptRestoredHistoryTextCandidateV1({ scope, worldGroupId: input.worldGroupId, snapshot, draft: JSON.stringify(output) }),
  }
  await assertFresh()
  return { node, prepared: prepareGenerationNode(node, {}), input: { assembled }, snapshot, contextSources: contextEvidence.included,
    contextEvidence, contextGatewayExecution, promptExecutionEvidence, label: HISTORY_TEXT_LABELS_V1[request.field], modelIdentity: { provider: config.provider, model: config.model }, runRaw }
}
