import { canonRowResourceKeysV1 } from '../context-gateway/canon-provider'
import { db } from '../db/schema'
import { executeRegisteredAIEntryV1 } from './formal-ai-entry'
import Dexie, { type Transaction } from 'dexie'
import { useAIConfigStore } from '../../stores/ai-config'
import { resolveRequestConfig, type ChatResult } from '../ai/client'
import { appendSimplifiedChineseOutputConstraint } from '../ai/adapters/prompt-guards'
import { prepareGenerationNode, type GenerationNode } from '../generation/generation-node'
import { adopt } from '../registry/adopt'
import type { AIConfig, ChatMessage, WorkspaceScope, Worldview, PowerSystem } from '../types'
import { readOwnedRows, resolveReadScopeLike } from '../workspace/scope'
import { readPowerAuthoringBaselineV1, powerRemovalImpactHashV1, type PowerAuthoringBaselineV1 } from '../cultivation/power-authoring-adoption'
import { decodePowerStagesStrictV1, preparePowerAuthoringEditV1, type PowerAuthoringScopeV1, type PowerAuthoringTargetV1 } from '../cultivation/power-authoring-contract'
import { executeContextGatewayV1 } from '../context-gateway/execution'
import { assembleContextGatewayPacketV1, projectContextGatewayInputStateV1, contextGatewayInputStateSourceKeysV1 } from './context-gateway-input'
import { attachAgentContextInputStateV1, evidenceFromContextResult, resolveAgentContextPolicy, type AgentContextProfile } from './context-policy'
import { buildAgentSkillInputGuidanceV1, resolveAgentSkillV1 } from './skill-registry'
import { canonicalStringify, hashCanonicalValue } from './run/hash'

export interface PowerAuthoringRequestV1 {
  target: PowerAuthoringTargetV1
  /** Host allocated before dispatch, frozen in the original task, never model-selected. */
  allocatedStageIds: string[]
}
export interface PowerAuthoringCandidateV1 {
  version: 1
  value: unknown
  /** Only the author editor may add this after displaying the exact impact. */
  confirmedRemovalHash?: string
}
export interface PowerAuthoringCopilotSnapshotV1 {
  version: 1
  scope: PowerAuthoringScopeV1
  request: PowerAuthoringRequestV1
  baseline: PowerAuthoringBaselineV1
}
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是对象。`)
  const row = value as Record<string, unknown>
  if (Object.keys(row).some(key => !keys.includes(key))) throw new Error(`${label}包含未登记字段。`)
  return row
}
export function parsePowerAuthoringRequestV1(value: unknown): PowerAuthoringRequestV1 {
  const row = object(value, ['target', 'allocatedStageIds'], '力量生成请求')
  const target = object(row.target, ['table', 'recordId', 'field', 'stageId', 'stageField'], '力量生成目标')
  const fields: Record<string, readonly string[]> = { worldviews: ['powerHierarchy'], powerSystems: ['name', 'description', 'rules', 'levels'], cultivationSystems: ['name', 'description', 'stages'] }
  if (typeof target.table !== 'string' || !Object.prototype.hasOwnProperty.call(fields, target.table) || !fields[target.table].includes(String(target.field))
    || !Number.isSafeInteger(target.recordId) || Number(target.recordId) < 1) throw new Error('力量生成必须固定原记录与登记字段。')
  const hasStage = Object.prototype.hasOwnProperty.call(target, 'stageId') || Object.prototype.hasOwnProperty.call(target, 'stageField')
  if (hasStage && (target.table !== 'cultivationSystems' || target.field !== 'stages'
    || typeof target.stageId !== 'string' || !target.stageId.trim()
    || !['name', 'features', 'breakthrough', 'parentStageIds', 'branchLabel', 'tier'].includes(String(target.stageField)))) throw new Error('力量阶段目标不完整。')
  if (!Array.isArray(row.allocatedStageIds) || row.allocatedStageIds.some(id => typeof id !== 'string' || !id.trim())
    || new Set(row.allocatedStageIds).size !== row.allocatedStageIds.length
    || (target.field !== 'stages' || hasStage) && row.allocatedStageIds.length) throw new Error('新增阶段 ID 白名单无效。')
  return { target: { table: target.table, recordId: target.recordId, field: target.field,
    ...(hasStage ? { stageId: target.stageId, stageField: target.stageField } : {}) } as PowerAuthoringTargetV1, allocatedStageIds: [...row.allocatedStageIds] }
}
export function powerAuthoringLabelV1(target: PowerAuthoringTargetV1): string {
  if (target.table === 'cultivationSystems' && target.field === 'stages') {
    return target.stageId ? ({ name: '阶段名称', features: '能力与限制', breakthrough: '突破与代价', parentStageIds: '前置阶段', tier: '阶段层级', branchLabel: '分支名称' })[target.stageField] : '整路径阶段规划'
  }
  return ({ name: target.table === 'cultivationSystems' ? '路径名称' : '体系名称', description: target.table === 'cultivationSystems' ? '路径原理' : '规则明细·体系描述', rules: '规则与代价', levels: '旧版层级说明', powerHierarchy: '世界力量概览' } as Record<string, string>)[target.field]
}
export function powerAuthoringCurrentValueV1(snapshot: PowerAuthoringCopilotSnapshotV1): unknown {
  const { target } = snapshot.request
  const record = snapshot.baseline.snapshot.record as unknown as Record<string, unknown>
  if (target.table === 'cultivationSystems' && target.field === 'stages') {
    const stages = decodePowerStagesStrictV1(record.stages)
    if (!target.stageId) return { version: 1, updates: [], additions: [], removals: [] }
    const stage = stages.find(item => item.id === target.stageId)
    if (!stage) throw new Error('原阶段已不存在。')
    return stage[target.stageField] ?? (target.stageField === 'tier' ? 0 : target.stageField === 'parentStageIds' ? [] : '')
  }
  return record[target.field] ?? ''
}
export function preparePowerCandidateV1(snapshot: PowerAuthoringCopilotSnapshotV1, candidate: PowerAuthoringCandidateV1) {
  return preparePowerAuthoringEditV1({ scope: snapshot.scope, target: snapshot.request.target, snapshot: snapshot.baseline.snapshot,
    allocatedStageIds: snapshot.request.allocatedStageIds, value: candidate.value })
}
export function parsePowerAuthoringCandidateV1(raw: string, snapshot: PowerAuthoringCopilotSnapshotV1, authorEdit = true): PowerAuthoringCandidateV1 {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('力量候选需要完整 JSON；原响应已保留，请修正后重试。') }
  const row = object(value, ['version', 'value', ...(authorEdit ? ['confirmedRemovalHash'] : [])], '力量候选')
  if (row.version !== 1 || !Object.prototype.hasOwnProperty.call(row, 'value') || row.confirmedRemovalHash !== undefined && (typeof row.confirmedRemovalHash !== 'string' || !/^[a-f0-9]{64}$/.test(row.confirmedRemovalHash))) throw new Error('力量候选版本或作者确认无效。')
  const candidate = row as unknown as PowerAuthoringCandidateV1
  const prepared = preparePowerCandidateV1(snapshot, candidate)
  if (snapshot.request.target.field === 'name' && !String(prepared.patch.name).trim()) throw new Error('体系或路径名称不能为空。')
  return candidate
}
export function parsePowerAuthoringSnapshotV1(value: unknown): PowerAuthoringCopilotSnapshotV1 {
  const row = object(value, ['version', 'scope', 'request', 'baseline'], '力量候选快照')
  if (row.version !== 1) throw new Error('力量候选快照版本无效。')
  const scope = object(row.scope, ['projectId', 'worldId', 'workId', 'worldGroupId'], '力量候选作用域')
  for (const key of ['projectId', 'worldId', 'workId']) if (!Number.isSafeInteger(scope[key]) || Number(scope[key]) < 1) throw new Error('力量候选缺少作品作用域。')
  if (scope.worldGroupId !== null && (!Number.isSafeInteger(scope.worldGroupId) || Number(scope.worldGroupId) < 1)) throw new Error('力量候选分区无效。')
  const request = parsePowerAuthoringRequestV1(row.request)
  const baseline = object(row.baseline, ['snapshot', 'recordHash', 'references', 'referenceHash'], '力量采纳基线')
  if (![baseline.recordHash, baseline.referenceHash].every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) || !Array.isArray(baseline.references)) throw new Error('力量候选基线证据不完整。')
  const result = structuredClone({ version: 1, scope, request, baseline }) as unknown as PowerAuthoringCopilotSnapshotV1
  // Validate target, native owner, raw numeric fidelity and the original DAG before any paid call or restore.
  preparePowerCandidateV1(result, { version: 1, value: powerAuthoringCurrentValueV1(result) })
  return result
}
function assertPowerAuthoringAdmissionV1(scope: WorkspaceScope, transaction?: Transaction) {
  const projects = transaction ? transaction.table(db.projects.name) : db.projects
  const works = transaction ? transaction.table(db.works.name) : db.works
  return Dexie.Promise.all([projects.get(scope.projectId), works.get(scope.workId)]).then(([project, work]) => {
    if (!project || project.activeWorldId !== scope.worldId || project.activeWorkId !== scope.workId
      || work?.kind !== 'novel' || work.novelProfile !== 'long' || work.projectId !== scope.projectId || work.worldId !== scope.worldId) throw new Error('力量创作入口需要当前活动的长篇作品；请回到原作品重新核对。')
  })
}
async function assertSnapshotIntegrity(snapshot: PowerAuthoringCopilotSnapshotV1) {
  if (await hashCanonicalValue(snapshot.baseline.snapshot.record) !== snapshot.baseline.recordHash
    || await hashCanonicalValue(snapshot.baseline.references) !== snapshot.baseline.referenceHash) throw new Error('力量候选基线哈希不匹配。')
}
function assertSameScope(scope: WorkspaceScope, worldGroupId: number | null, snapshot: PowerAuthoringCopilotSnapshotV1) {
  if (scope.projectId !== snapshot.scope.projectId || scope.worldId !== snapshot.scope.worldId || scope.workId !== snapshot.scope.workId
    || worldGroupId !== snapshot.scope.worldGroupId) throw new Error('力量候选不属于当前作品、世界或分区。')
}
export async function assertPowerAuthoringCandidateReadyV1(input: { scope: WorkspaceScope; worldGroupId: number | null; snapshot: PowerAuthoringCopilotSnapshotV1; draft: string }) {
  const snapshot = parsePowerAuthoringSnapshotV1(input.snapshot)
  assertSameScope(input.scope, input.worldGroupId, snapshot)
  await assertPowerAuthoringAdmissionV1(input.scope)
  await assertSnapshotIntegrity(snapshot)
  const candidate = parsePowerAuthoringCandidateV1(input.draft, snapshot), prepared = preparePowerCandidateV1(snapshot, candidate)
  if (prepared.removedStageIds.length && candidate.confirmedRemovalHash !== await powerRemovalImpactHashV1(snapshot.baseline, prepared.removedStageIds)) throw new Error('请先核对并确认当前删除阶段及引用影响。')
  const current = await readPowerAuthoringBaselineV1(snapshot.scope, snapshot.request.target)
  if (current.recordHash !== snapshot.baseline.recordHash || current.referenceHash !== snapshot.baseline.referenceHash) throw new Error('力量原记录或引用已变化，请重新生成。')
}
export async function adoptRestoredPowerAuthoringCandidateV1(input: {
  scope: WorkspaceScope; worldGroupId: number | null; snapshot: PowerAuthoringCopilotSnapshotV1; draft: string; owner?: { transaction: Transaction }
}) {
  const snapshot = parsePowerAuthoringSnapshotV1(input.snapshot)
  assertSameScope(input.scope, input.worldGroupId, snapshot)
  if (input.owner) {
    await Dexie.waitFor(assertPowerAuthoringAdmissionV1(input.scope, input.owner.transaction))
    await Dexie.waitFor(assertSnapshotIntegrity(snapshot))
  } else {
    await assertPowerAuthoringAdmissionV1(input.scope)
    await assertSnapshotIntegrity(snapshot)
  }
  const candidate = parsePowerAuthoringCandidateV1(input.draft, snapshot)
  return adopt({ target: snapshot.request.target.table, mode: 'replace', data: candidate.value, powerAuthoring: {
    scope: snapshot.scope, edit: snapshot.request.target, recordHash: snapshot.baseline.recordHash,
    referenceHash: snapshot.baseline.referenceHash, allocatedStageIds: snapshot.request.allocatedStageIds,
    ...(candidate.confirmedRemovalHash ? { confirmedRemovalHash: candidate.confirmedRemovalHash } : {}),
  } }, input.owner)
}
export async function powerAuthoringCandidateMatchesBusinessV1(input: { scope: WorkspaceScope; worldGroupId: number | null; snapshot: PowerAuthoringCopilotSnapshotV1; draft: string }) {
  const snapshot = parsePowerAuthoringSnapshotV1(input.snapshot)
  assertSameScope(input.scope, input.worldGroupId, snapshot)
  await assertSnapshotIntegrity(snapshot)
  const prepared = preparePowerCandidateV1(snapshot, parsePowerAuthoringCandidateV1(input.draft, snapshot))
  const current = await readPowerAuthoringBaselineV1(snapshot.scope, snapshot.request.target)
  const before = snapshot.baseline.snapshot.record, after = current.snapshot.record
  return Reflect.get(before, 'ragDocumentId') === Reflect.get(after, 'ragDocumentId')
    && Object.entries(prepared.patch).every(([key, value]) => Reflect.get(after, key) === value)
}

export async function preparePowerAuthoringCopilotV1(input: {
  projectId: number; scope?: WorkspaceScope; worldGroupId: number | null; request: PowerAuthoringRequestV1; authorRequest: string
  contextProfile?: AgentContextProfile; configOverride?: AIConfig; signal?: AbortSignal
}, dependencies: { runAI?: (messages: ChatMessage[]) => Promise<string> } = {}) {
  const request = parsePowerAuthoringRequestV1(input.request)
  const scope = { ...await (input.scope ?? resolveReadScopeLike(input.projectId)), worldGroupId: input.worldGroupId }
  if (scope.projectId !== input.projectId) throw new Error('力量任务项目不匹配。')
  await assertPowerAuthoringAdmissionV1(scope)
  const baseline = await readPowerAuthoringBaselineV1(scope, request.target)
  const snapshot = parsePowerAuthoringSnapshotV1({ version: 1, scope, request, baseline })
  await assertSnapshotIntegrity(snapshot)
  const skill = resolveAgentSkillV1('world-origin', 'world-origin.power-authoring')
  const resolution = resolveRequestConfig(input.configOverride ?? useAIConfigStore.getState().config, { category: 'agent.world-foundation.power-authoring' })
  const config = resolution.config
  const profile = input.contextProfile ?? 'balanced', policy = resolveAgentContextPolicy(skill.contextTaskKind, profile)
  // Reuse the existing registered Canon record provider. Power and cultivation
  // records already publish worldview-field resources; no duplicate source/store.
  const targetKey = `worldview-field:${Reflect.get(baseline.snapshot.record, 'ragDocumentId')}`
  const workspace = { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId }
  const [worldviews, powerRules] = await Promise.all([
    readOwnedRows<Worldview>(workspace, 'worldviews', { owner: 'world' }), readOwnedRows<PowerSystem>(workspace, 'powerSystems', { owner: 'world' }),
  ])
  const overviewKeys = await Promise.all(worldviews.filter(row => (row.worldGroupId ?? null) === input.worldGroupId && row.powerHierarchy?.trim()).map(async row => {
    const key = (await canonRowResourceKeysV1('worldviews', { ...row })).fields.powerHierarchy
    if (!key) throw new Error('共享力量概述缺少可验证原文来源，未调用模型。')
    return key
  }))
  const ruleKeys = await Promise.all(powerRules.filter(row => (row.worldGroupId ?? null) === input.worldGroupId
    && [row.name, row.description, row.levels, row.rules].some(value => value?.trim())).map(async row => {
      const key = (await canonRowResourceKeysV1('powerSystems', { ...row })).record
      if (!key) throw new Error('共享力量规则缺少可验证来源，未调用模型。')
      return key
    }))
  const mandatoryKeys = [...new Set([targetKey, ...overviewKeys, ...ruleKeys])]

  const contextGatewayExecution = await executeContextGatewayV1({ modelConfig: config, skill, scope: { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId }, worldGroupId: input.worldGroupId,
    budgetTokens: Math.min(policy.maxInputTokens, skill.contextGateway!.maxRetrievedTokens),
    query: `为${powerAuthoringLabelV1(request.target)}生成候选。${input.authorRequest}。世界力量概览仅是背景，体系规则是通用机制，各路径 stages 是稳定 ID 阶段图；旧 levels 说明或词条不得替代 stages。`,
    mandatoryResourceKeys: mandatoryKeys, mandatoryFullResourceKeys: mandatoryKeys, targetResourceKeys: [targetKey],
    additionalReadsEnabled: false, signal: input.signal })
  const assembled = assembleContextGatewayPacketV1(contextGatewayExecution, contextGatewayExecution.modelBudget?.inputBudget ?? policy.maxInputTokens)
  const state = projectContextGatewayInputStateV1(skill, contextGatewayExecution, assembled)
  if (state.state === 'empty') throw new Error('力量目标的已登记原文未读入，未调用模型。')
  const contextEvidence = attachAgentContextInputStateV1(evidenceFromContextResult(profile, assembled), state)
  contextEvidence.inputStateSourceKeys = contextGatewayInputStateSourceKeysV1(skill, contextGatewayExecution)
  const assertFresh = async () => {
    await assertPowerAuthoringAdmissionV1(scope)
    const current = await readPowerAuthoringBaselineV1(scope, request.target)
    if (current.recordHash !== baseline.recordHash || current.referenceHash !== baseline.referenceHash) throw new Error('力量原记录或引用已变化，未继续生成；请重新核对。')
  }
  await assertFresh()
  const example = request.target.field === 'stages' && !('stageId' in request.target)
    ? { version: 1, updates: [], additions: request.allocatedStageIds.slice(0, 1).map(id => ({ id, name: '阶段名', parentStageIds: [], features: '能力与限制', breakthrough: '突破与代价' })), removals: [] }
    : powerAuthoringCurrentValueV1(snapshot)
  const messages = appendSimplifiedChineseOutputConstraint([{ role: 'system', content: [
    '你是叙事熔炉的力量体系定点创作 Skill。只建议本次固定目标的 value；输出先进入可编辑候选，作者确认后才成为正式设定。',
    '保持已有身份和所有未选字段。世界力量概览、通用力量规则、路径阶段图是不同层次，冲突应由作者裁决，不得擅自镜像或以旧线性 levels 覆盖路径。',
    '阶段前置只能使用原 stages 的稳定 ID 或本次分配的新 ID，保留分叉汇合；不得把名称当 ID。整路径使用 updates/additions/removals 明确操作，不返回替换数组；未改的阶段不要重新抄写。',
    '只输出完整 JSON 对象 {"version":1,"value":...}，不要额外字段或解释，不得附带删除确认。',
  ].join('\n') }, { role: 'user', content: [buildAgentSkillInputGuidanceV1(skill, state),
    `作者要求：${input.authorRequest}`, `本次目标：${JSON.stringify(request.target)}`,
    `允许新增阶段 ID：${JSON.stringify(request.allocatedStageIds)}`, `正式上下文：\n${assembled.text}`,
    `输出结构示例（不要求照抄）：${JSON.stringify({ version: 1, value: example })}`,
  ].join('\n\n') }])
  const runRaw = async (sent: ChatMessage[], result?: ChatResult) => {
    await assertFresh()
    const observedResult = result ?? {}
    observedResult.beforeModelDispatch = assertFresh
    const output = dependencies.runAI ? await dependencies.runAI(sent) : await executeRegisteredAIEntryV1('world.power-authoring', sent, config, {
      category: 'agent.world-foundation.power-authoring', projectId: input.projectId,
      configOverrides: { temperature: 0.35 }, contextOverflowPolicy: 'reject',
    }, input.signal, observedResult, undefined, resolution)
    return { output }
  }
  const node: GenerationNode<unknown, PowerAuthoringCandidateV1, unknown> = {
    id: `agent.power-authoring:${input.projectId}:${request.target.table}:${request.target.recordId}`, kind: 'world-origin.power-authoring', editableInput: true,
    assembleInput: () => messages,
    run: async sent => parsePowerAuthoringCandidateV1((await runRaw(sent)).output, snapshot, false),
    gate: output => { try { preparePowerCandidateV1(snapshot, output); return { status: 'pass', issues: [] } } catch (cause) { return { status: 'blocked', issues: [{ code: 'power-authoring-contract', message: cause instanceof Error ? cause.message : String(cause) }] } } },
    adopt: output => adoptRestoredPowerAuthoringCandidateV1({ scope, worldGroupId: input.worldGroupId, snapshot, draft: JSON.stringify(output) }),
  }
  return { node, prepared: prepareGenerationNode(node, {}), input: { assembled }, snapshot, contextSources: contextEvidence.included, contextEvidence,
    contextGatewayExecution, label: powerAuthoringLabelV1(request.target), modelIdentity: { provider: config.provider, model: config.model }, runRaw }
}

export function samePowerAuthoringTargetV1(left: PowerAuthoringTargetV1, right: PowerAuthoringTargetV1) { return canonicalStringify(left) === canonicalStringify(right) }
