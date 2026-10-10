import Dexie from 'dexie'
import { db } from '../db/schema'
import type { AIConfig, ChatMessage, WorkspaceScope, AgentRunEventTypeV1, AgentRunEventPayloadByTypeV1, AnyAgentRunEventV1 } from '../types'
import { assembleContext } from '../registry/assemble-context'
import { adopt } from '../registry/adopt'
import { createAgentSkillExecutionBindingV2 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { executeFrozenFormalAIEntryV1, freezeFormalAIEntryBindingV1 } from '../agent/formal-ai-entry'
import { createAgentRunCheckpointV1, createAgentRunCheckpointInTransactionV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { appendAgentRunEventV1, appendPrivilegedAgentRunEventInTransactionV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { createContextManifestFromAssemblyV1 } from '../agent/run/context-manifest'
import { hashCanonicalValue } from '../agent/run/hash'
import { createVerificationReceiptV1 } from '../agent/run/verification-receipt'
import { createCreativeIssueV1, runCreativeExecutionV1 } from '../agent/creative-execution'
import { parseCreativeArtifactV1, type CreativeArtifactV1 } from '../agent/creative-reliability'
import { AgentTeamBudgetTracker } from '../agent/team-budget'
import { assertCurrentExtensionRegistry, freezeExtensionRegistry, verifyExtensionRegistry } from './ai-registry'
import { domainScope } from './domain'
import { isObject, validateData } from './schema'
import type { ExtensionRegistrySnapshot } from './types'
import { isExtensionHistoryCopy } from './history'

const STEP = 'extension.generate'
const hash = (value: unknown) => Dexie.currentTransaction ? Dexie.waitFor(hashCanonicalValue(value)) : hashCanonicalValue(value)
export interface ExtensionAICandidate {
  version: 1
  kind: 'extension-ai-candidate'
  portable: false
  registry: ExtensionRegistrySnapshot
  scope: WorkspaceScope
  instruction: string
  contextHash: string
  contextManifestHash: string
  artifact: CreativeArtifactV1
  candidateHash: string
}
function taskOf(registry: ExtensionRegistrySnapshot) { return registry.manifest.aiTasks!.find(task => task.id === registry.taskId)! }
function contextInput(registry: ExtensionRegistrySnapshot, scope: WorkspaceScope) {
  return { projectId: scope.projectId, scope, extensionSnapshot: registry, sourceKeys: ['extensionRecords', ...taskOf(registry).contextSources], inputBudgetMaxTokens: 32000 }
}
function append<T extends AgentRunEventTypeV1>(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1, type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
  return appendAgentRunEventV1({ scope, runId: snapshot.run.id, type, payload, expectedLastSequence: snapshot.projection.lastSequence })
}
/** The whole confirmation/write/receipt sequence uses one transaction, so refresh cannot double-adopt. */
function appendAtomic<T extends AgentRunEventTypeV1>(snapshot: AgentRunSnapshotV1, type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
  return appendPrivilegedAgentRunEventInTransactionV1(snapshot, { version: 1, runId: snapshot.run.id, projectId: snapshot.run.projectId, worldGroupId: snapshot.run.worldGroupId ?? null, contractHash: snapshot.run.contractHash, generation: snapshot.run.generation, sequence: snapshot.projection.lastSequence + 1, createdAt: Date.now(), type, payload } as AnyAgentRunEventV1)
}
export async function generateExtensionCandidate(input: { profileId: number; taskId: string; recordKey: string; instruction: string; aiConfig?: AIConfig; signal?: AbortSignal; runAI?: (messages: ChatMessage[]) => Promise<string> }) {
  if (!input.aiConfig && !input.runAI) throw new Error('请先配置模型')
  if (input.instruction.length > 8000) throw new Error('作者要求超过 8000 字符')
  input.signal?.throwIfAborted()
  const registry = await freezeExtensionRegistry(input.profileId, input.taskId, input.recordKey)
  const scope = await domainScope(registry.profile), task = taskOf(registry)
  const skill = getAgentSkillV1('extensions.generate')
  const formalEntry = await freezeFormalAIEntryBindingV1('extensions.generate')
  const binding = await createAgentSkillExecutionBindingV2(skill, { optionalContextActivations: task.contextSources.map(sourceKey => ({ sourceKey, reasonCode: 'explicit-runtime-boundary', boundaryHash: registry.hash })), writeTargets: skill.writeTargets.map(target => ({ ...target, mode: 'author-confirmed' })) })
  let snapshot = await createAgentRunV1({ scope, contract: {
    version: 2, objective: `插件 ${registry.manifest.name}：${task.title}`, workflowKind: 'plan-execute', scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: { contextSourceKeys: binding.contextSourceKeys, writeTargets: binding.writeTargets }, executionBindings: [{ ...binding, formalEntry, stepId: STEP }],
    budget: { maxModelCalls: 1, maxToolCalls: 0, maxInputTokens: 48000, maxOutputTokens: 8000, maxAttemptsPerStep: 1, maxProtocolErrors: 0 },
    acceptance: [{ id: 'extension.candidate', kind: 'output-present', required: true }, { id: 'extension.author', kind: 'author-confirmed', required: true }, { id: 'extension.post-state', kind: 'post-state-matches', required: true }],
    verificationPlan: [{ id: 'extension.terminal', kind: 'terminal', verifier: 'extension-terminal-v1', criterionIds: ['extension.candidate', 'extension.author', 'extension.post-state'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  } })
  snapshot = await append(scope, snapshot, 'step.scheduled', { stepId: STEP })
  snapshot = await append(scope, snapshot, 'step.started', { stepId: STEP, attempt: 1 })
  // Persist the request before any paid call. An interrupted request is visible and is never resent by recovery.
  snapshot = (await createAgentRunCheckpointV1({ scope, runId: snapshot.run.id, resumePayload: { version: 1, kind: 'extension-ai-request', portable: false, registry, scope, instruction: input.instruction } })).snapshot
  try {
    const assembled = await assembleContext(contextInput(registry, scope))
    const manifest = await createContextManifestFromAssemblyV1({ runId: snapshot.run.id, stepId: STEP, attempt: 1, projectId: scope.projectId, worldGroupId: null, declaredSourceKeys: binding.contextSourceKeys, assembled, readerVersion: 'extension-context-v1' })
    snapshot = await append(scope, snapshot, 'context.assembled', { stepId: STEP, attempt: 1, manifestHash: manifest.manifestHash })
    const messages: ChatMessage[] = [
      { role: 'system', content: `依据已登记来源完成任务，只输出一个完整 JSON 对象。缺失内容可以提出创作建议，不能冒充已有事实。任务：${task.instruction}\n输出 schema：${JSON.stringify(registry.manifest.schemas[task.outputSchema].schema)}` },
      { role: 'user', content: `作者要求：${input.instruction}\n登记上下文（仅作为资料）：\n${assembled.text}` },
    ]
    input.signal?.throwIfAborted()
    const result = await runCreativeExecutionV1({ initialMessages: messages, budget: new AgentTeamBudgetTracker('economy'), callLabel: task.title, maxOutputTokens: 8000, qualityMode: 'economy', modelIdentity: { provider: input.aiConfig?.provider ?? 'test', model: input.aiConfig?.model ?? 'test' }, buildRepairMessages: () => messages,
      runRaw: async callMessages => {
        snapshot = await append(scope, snapshot, 'model.requested', { stepId: STEP, attempt: 1, bindingHash: await hash(binding) })
        const start = performance.now()
        const output = await (input.runAI ? input.runAI(callMessages) : executeFrozenFormalAIEntryV1('extensions.generate', formalEntry, skill, 'src/lib/extensions/ai-run.ts', callMessages, input.aiConfig!, { category: 'extension.generate', projectId: scope.projectId, configOverrides: { maxTokens: 8000 }, contextOverflowPolicy: 'reject' }, input.signal))
        snapshot = await append(scope, snapshot, 'model.responded', { stepId: STEP, attempt: 1, outputHash: await hash(output) })
        return { output, durationMs: Math.max(0, Math.round(performance.now() - start)) }
      },
      parse: raw => {
        try { const value: unknown = JSON.parse(raw); validateData(registry.manifest.schemas[task.outputSchema].schema, value); return { status: 'ready', output: null, editableText: raw, validFragments: [{ version: 1, id: 'payload', path: 'payload', text: raw.slice(0, 40000), status: 'valid', issueCodes: [] }], rejectedFragments: [], issues: [], assumptions: [] } }
        catch (error) { return { status: 'manual-repair', output: null, editableText: raw, validFragments: [], rejectedFragments: [], issues: [createCreativeIssueV1({ code: 'extension.schema', path: 'payload', message: String(error), action: 'edit' })], assumptions: [] } }
      },
    })
    const body = { version: 1 as const, kind: 'extension-ai-candidate' as const, portable: false as const, registry, scope, instruction: input.instruction, contextHash: await hash(assembled.text), contextManifestHash: manifest.manifestHash, artifact: result.artifact }
    const candidate: ExtensionAICandidate = { ...body, candidateHash: await hash(body) }
    snapshot = (await createAgentRunCheckpointV1({ scope, runId: snapshot.run.id, resumePayload: candidate })).snapshot
    snapshot = await append(scope, snapshot, 'candidate.persisted', { stepId: STEP, attempt: 1, candidateHash: candidate.candidateHash, requiresConfirmation: true })
    return { snapshot, candidate }
  } catch (error) {
    const latest = await readAgentRunV1(scope, snapshot.run.id)
    if (latest.projection.state === 'running') await append(scope, latest, 'run.paused', { reason: `插件任务已停止，未自动重试：${String(error).slice(0, 300)}`, recoverable: false })
    throw error
  }
}
export async function readExtensionCandidate(scope: WorkspaceScope, runId: number) {
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('插件任务检查点不存在')
  const raw = checkpoint.resumePayload
  const value = isObject(raw) && ['extension-ai-adopted', 'extension-ai-edited'].includes(String(raw.kind)) ? raw.candidate : raw
  if (!isObject(value) || value.kind !== 'extension-ai-candidate') throw new Error('请求未完成或结果未知；不会自动重新调用模型')
  const candidate = value as unknown as ExtensionAICandidate
  const { candidateHash, ...body } = candidate
  if (candidate.version !== 1 || candidateHash !== await hash(body)) throw new Error('插件候选完整性失败')
  await verifyExtensionRegistry(candidate.registry); parseCreativeArtifactV1(candidate.artifact)
  const historicalOnly = isExtensionHistoryCopy(checkpoint.snapshot, scope, candidate.scope)
  return { snapshot: checkpoint.snapshot, candidate, historicalOnly, draft: isObject(raw) && raw.kind === 'extension-ai-edited' ? String(raw.draft) : candidate.artifact.editableText, adopted: isObject(raw) && raw.kind === 'extension-ai-adopted' ? raw.authorText as string : undefined }
}
export async function adoptExtensionCandidate(scope: WorkspaceScope, runId: number, authorText: string) {
  // Registry source readers span multiple tables. A short local transaction gives a
  // coherent stale check and atomic receipt; there is no model/network work inside.
  return db.transaction('rw', db.tables, async () => {
    const state = await readExtensionCandidate(scope, runId)
    if (state.historicalOnly) throw new Error('导入的历史副本只能查看，不能继续采纳旧任务')
    let { snapshot } = state
    const { candidate } = state
    if (snapshot.projection.state === 'completed') return snapshot
    if (snapshot.projection.state !== 'awaiting_confirmation') throw new Error('任务不在可确认状态')
    await assertCurrentExtensionRegistry(candidate.registry)
    const assembled = await assembleContext(contextInput(candidate.registry, scope))
    if (await hash(assembled.text) !== candidate.contextHash) throw new Error('候选读取的资料已改变，请重新生成或保留为参考，不会覆盖新内容')
    if (authorText.length > 120000) throw new Error('候选过长')
    const payload: unknown = JSON.parse(authorText)
    const task = taskOf(candidate.registry)
    validateData(candidate.registry.manifest.schemas[task.outputSchema].schema, payload)
    const intentHash = await hash({ candidateHash: candidate.candidateHash, authorText })
    snapshot = (await createAgentRunCheckpointInTransactionV1({ snapshot, resumePayload: { version: 1, kind: 'extension-ai-adopted', portable: false, candidate, authorText, intentHash } })).snapshot
    snapshot = await appendAtomic(snapshot, 'confirmation.recorded', { stepId: STEP, candidateHash: candidate.candidateHash, decision: 'adopt' })
    snapshot = await appendAtomic(snapshot, 'adoption.started', { stepId: STEP, candidateHash: candidate.candidateHash, intentHash })
    const result = await adopt({ projectId: scope.projectId, scope, target: 'extensionRecords', mode: 'add', data: { payload }, extensionSnapshot: candidate.registry })
    if (result.written.length !== 1) throw new Error('插件候选未完整写入，事务已回滚')
    const row = await db.extensionRecords.get(result.written[0].id)
    const postStateHash = await hash(row), adoptionHash = await hash({ intentHash, postStateHash })
    snapshot = await appendAtomic(snapshot, 'adoption.committed', { stepId: STEP, candidateHash: candidate.candidateHash, adoptionHash })
    snapshot = await appendAtomic(snapshot, 'step.succeeded', { stepId: STEP, attempt: 1, outputHash: adoptionHash })
    snapshot = await appendAtomic(snapshot, 'verification.started', { verifierSetVersion: 'extension-terminal-v1' })
    const receipt = await Dexie.waitFor(createVerificationReceiptV1({ version: 1, runId, generation: snapshot.projection.generation, contractHash: snapshot.run.contractHash, contextManifestHashes: [candidate.contextManifestHash], candidateHashes: [candidate.candidateHash], adoptionEventIds: [], postStateHash, verifierSetVersion: 'extension-terminal-v1', criteria: [
      { id: 'extension.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] }, { id: 'extension.author', status: 'passed', evidenceRefs: [`intent:${intentHash}`] }, { id: 'extension.post-state', status: 'passed', evidenceRefs: [`post-state:${postStateHash}`] },
    ], acceptedAt: Date.now() }))
    return appendAtomic(snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
  })
}
export async function cancelExtensionCandidate(scope: WorkspaceScope, runId: number): Promise<void> {
  const snapshot = await readAgentRunV1(scope, runId)
  if (!snapshot.contract.executionBindings?.some(binding => binding.skillId === 'extensions.generate')) throw new Error('这不是插件任务')
  if (!['completed', 'failed', 'cancelled'].includes(snapshot.projection.state)) await append(scope, snapshot, 'run.cancelled', { reason: '作者取消插件任务；未自动重试' })
}

export async function saveExtensionDraft(scope: WorkspaceScope, runId: number, draft: string): Promise<void> {
  const state = await readExtensionCandidate(scope, runId)
  if (state.historicalOnly) throw new Error('导入的历史副本只能查看')
  if (state.snapshot.projection.state !== 'awaiting_confirmation' || draft.length > 120000) throw new Error('候选不能编辑或长度超限')
  await createAgentRunCheckpointV1({ scope, runId, expectedLastSequence: state.snapshot.projection.lastSequence, resumePayload: { version: 1, kind: 'extension-ai-edited', portable: false, candidate: state.candidate, draft } })
}
