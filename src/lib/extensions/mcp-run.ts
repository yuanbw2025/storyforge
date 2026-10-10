import Dexie from 'dexie'
import { resultFromTaskOutcome, type SerializedTaskReference } from '@modelcontextprotocol/ext-tasks/client'
import { CfWorkerJsonSchemaValidator } from '@modelcontextprotocol/client/validators/cf-worker'
import { db } from '../db/schema'
import type { WorkspaceScope, AgentRunEventTypeV1, AgentRunEventPayloadByTypeV1, AnyAgentRunEventV1 } from '../types'
import { agentRunScopeTransactionTablesV1, appendPrivilegedAgentRunEventInTransactionV1, readVerifiedAgentRunInTransactionV1, appendAgentRunEventV1, createAgentRunV1, readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { createAgentRunCheckpointInTransactionV1, beginAgentRunRecoveryV1, completeAgentRunRecoveryV1, createAgentRunCheckpointV1, readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { hashCanonicalValue } from '../agent/run/hash'
import { connectExtensionMcp } from './mcp-client'
import { checkActiveProfile } from './store'
import { domainScope } from './domain'
import { isExtensionHistoryCopy } from './history'
import { parseManifest } from './package'
import { assertJson, isObject } from './schema'
import type { ExtensionConnector, ExtensionReviewRequest, Json } from './types'

const STEP = 'extension.mcp'
export interface ExtensionToolCheckpoint {
  kind: 'extension-mcp'; version: 1; portable: false; scope: WorkspaceScope
  pluginId: string; digest: string; connector: ExtensionConnector; tool: string; input: Record<string, Json>
  reference?: SerializedTaskReference; result?: Json; remoteStatus?: string
}
export type McpConnection = Awaited<ReturnType<typeof connectExtensionMcp>>
async function event<T extends AgentRunEventTypeV1>(scope: WorkspaceScope, run: AgentRunSnapshotV1, type: T, payload: AgentRunEventPayloadByTypeV1[T]) {
  return appendAgentRunEventV1({ scope, runId: run.run.id, type, payload, expectedLastSequence: run.projection.lastSequence })
}
export async function previewExtensionTool(request: ExtensionReviewRequest) {
  const profile = await db.extensionProfiles.get(request.profileId ?? -1)
  if (!profile || request.kind !== 'tool' || profile.pluginId !== request.pluginId || profile.digest !== request.digest || profile.ownerKey !== request.scope.ownerKey || profile.projectId !== request.scope.projectId) throw new Error('工具请求作用域或插件版本已改变')
  await checkActiveProfile(profile)
  const contract = await db.extensionContracts.where('profileId').equals(profile.id!).filter(row => row.digest === profile.digest).first()
  const manifest = parseManifest(contract?.manifest), connector = manifest.connectors?.find(item => item.id === request.connectorId)
  if (!manifest.permissions.includes('mcp') || !connector || !request.tool || !connector.tools.includes(request.tool) || !isObject(request.toolInput)) throw new Error('工具未声明')
  assertJson(request.toolInput)
  if (JSON.stringify(request.toolInput).length > 100000) throw new Error('工具参数超过 100 KB')
  const checkpoint: ExtensionToolCheckpoint = { kind: 'extension-mcp', version: 1, portable: false, scope: await domainScope(profile), pluginId: manifest.id, digest: profile.digest, connector, tool: request.tool, input: request.toolInput as Record<string, Json> }
  return { checkpoint, hash: await hashCanonicalValue(checkpoint) }
}
async function finish(previous: AgentRunSnapshotV1, checkpoint: ExtensionToolCheckpoint, result: unknown) {
  assertJson(result)
  if (JSON.stringify(result).length > 1_000_000) throw new Error('工具结果超过 1 MB，未采纳为作品内容')
  const { scope } = checkpoint, resultHash = await hashCanonicalValue(result)
  return db.transaction('rw', agentRunScopeTransactionTablesV1(previous.run.id, db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints), async () => {
    let run = await readVerifiedAgentRunInTransactionV1(scope, previous.run.id)
    if (run.projection.state === 'completed') return run
    if (run.projection.lastSequence !== previous.projection.lastSequence) throw new Error('工具记录已由其他窗口推进，请刷新')
    const append = async <T extends AgentRunEventTypeV1>(type: T, payload: AgentRunEventPayloadByTypeV1[T]) => {
      run = await appendPrivilegedAgentRunEventInTransactionV1(run, { version: 1, runId: run.run.id, projectId: run.run.projectId, worldGroupId: run.run.worldGroupId ?? null, contractHash: run.run.contractHash, generation: run.run.generation, sequence: run.projection.lastSequence + 1, createdAt: Date.now(), type, payload } as AnyAgentRunEventV1)
    }
    // Deterministic tool execution has no AI context/adoption. Its typed receipt
    // names the actual request and result instead of inventing a context manifest.
    const receipt = { schema: 'storyforge.extension-tool-receipt', version: 1, runId: run.run.id, contractHash: run.run.contractHash, callHash: run.contract.runtimeBindingHash!, resultHash, modelCalls: 0, recordedAt: Date.now() }
    const receiptHash = await Dexie.waitFor(hashCanonicalValue(receipt))
    run = (await createAgentRunCheckpointInTransactionV1({ snapshot: run, resumePayload: { ...checkpoint, result, remoteStatus: 'completed', receipt, receiptHash } })).snapshot
    await append('tool.returned', { stepId: STEP, attempt: 1, toolName: checkpoint.tool, resultHash })
    if (isObject(result) && result.isError === true) { await append('run.failed', { code: 'extension.tool_error', retryable: false }); return run }
    await append('step.succeeded', { stepId: STEP, attempt: 1, outputHash: resultHash })
    await append('verification.started', { verifierSetVersion: 'extension-mcp-v1' })
    await append('verification.accepted', { receiptHash })
    return run
  })
}
/** One explicit author action creates one durable tools/call. No retry of an unknown outcome. */
export async function executeExtensionTool(request: ExtensionReviewRequest, expectedHash: string, connection: McpConnection, signal?: AbortSignal) {
  const preview = await previewExtensionTool(request)
  if (preview.hash !== expectedHash) throw new Error('工具预览已变化，请重新确认')
  const checkpoint = preview.checkpoint, { scope } = checkpoint
  if (connection.connector.url !== checkpoint.connector.url || connection.connector.protocol !== checkpoint.connector.protocol) throw new Error('工具连接与已确认地址不一致')
  const tool = connection.tools.find(item => item.name === checkpoint.tool)
  if (!tool) throw new Error('服务未提供清单中声明的工具')
  const validator = new CfWorkerJsonSchemaValidator()
  const validate = validator.getValidator(tool.inputSchema as Parameters<typeof validator.getValidator>[0])
  if (!validate(checkpoint.input).valid) throw new Error('参数不符合服务声明的输入格式')
  let run = await createAgentRunV1({ scope, contract: {
    version: 1, objective: `外部工具 ${checkpoint.pluginId}：${checkpoint.tool}`, workflowKind: 'plan-execute', scope: { projectId: scope.projectId, worldGroupId: null },
    permissions: { contextSourceKeys: [], writeTargets: [] }, runtimeBindingHash: preview.hash,
    budget: { maxModelCalls: 0, maxToolCalls: 1, maxInputTokens: 0, maxOutputTokens: 0, maxAttemptsPerStep: 1, maxProtocolErrors: 0 },
    acceptance: [{ id: 'extension.tool-result', kind: 'output-present', required: true }],
    verificationPlan: [{ id: 'extension.tool-terminal', kind: 'terminal', verifier: 'extension-mcp-v1', criterionIds: ['extension.tool-result'] }],
    failurePolicy: { onProtocolError: 'fail', onVerificationFailure: 'fail', onStaleInput: 'pause-for-author' },
  } })
  run = await event(scope, run, 'step.scheduled', { stepId: STEP })
  run = await event(scope, run, 'step.started', { stepId: STEP, attempt: 1 })
  run = (await createAgentRunCheckpointV1({ scope, runId: run.run.id, resumePayload: checkpoint })).snapshot
  run = await event(scope, run, 'tool.called', { stepId: STEP, attempt: 1, toolName: checkpoint.tool, callHash: preview.hash })
  try {
    const execution = await connection.tasks.callTool(checkpoint.tool, checkpoint.input, { signal, requestTimeoutMs: 30000, resetTimeoutOnProgress: false, task: { preference: connection.capabilities.tasks.execution ? 'prefer' : 'forbid' } })
    if (execution.kind === 'task') {
      await execution.handoff(async reference => { run = (await createAgentRunCheckpointV1({ scope, runId: run.run.id, resumePayload: { ...checkpoint, reference, remoteStatus: 'working' } })).snapshot })
      return await event(scope, run, 'run.paused', { reason: '外部任务已登记；可主动查询或取消现有任务，不会重复发起', recoverable: true })
    }
    const result = resultFromTaskOutcome((await execution.settle({ signal })).outcome)
    return await finish(run, checkpoint, result)
  } catch (error) {
    run = await readAgentRunV1(scope, run.run.id)
    if (run.projection.state === 'running') await event(scope, run, 'run.paused', { reason: '工具请求未得到可确认结果。未自动重发；请检查服务端任务记录。', recoverable: false })
    throw error
  }
}
export async function readExtensionToolRun(scope: WorkspaceScope, runId: number) {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!saved || !isObject(saved.resumePayload) || saved.resumePayload.kind !== 'extension-mcp') throw new Error('工具检查点不存在')
  const value = saved.resumePayload as unknown as ExtensionToolCheckpoint
  const historicalOnly = isExtensionHistoryCopy(saved.snapshot, scope, value.scope)
  return { snapshot: saved.snapshot, checkpoint: value, historicalOnly }
}
/** Query/cancel an existing remote ID; never replays the original tools/call. */
export async function refreshExtensionToolRun(scope: WorkspaceScope, runId: number, connection: McpConnection, cancel = false, signal?: AbortSignal) {
  const saved = await readExtensionToolRun(scope, runId), value = saved.checkpoint
  if (saved.historicalOnly) throw new Error('导入的历史副本只能查看，不能查询或取消原作品的外部任务')
  let run = saved.snapshot
  if (['completed','cancelled','failed'].includes(run.projection.state)) return run
  if (!value.reference || value.reference.endpointId !== connection.tasks.endpointId) throw new Error('没有可查询的任务标识或连接不匹配；不会重发原始调用')
  const controller = connection.tasks.task(value.reference.taskId, { requestTimeoutMs: 30000 })
  if (cancel) {
    await controller.cancel(signal)
    return event(scope, run, 'run.cancelled', { reason: '作者取消已登记的外部任务' })
  }
  const remote = await controller.snapshot(signal)
  if (!['completed','failed','cancelled'].includes(remote.status)) {
    return (await createAgentRunCheckpointV1({ scope, runId, resumePayload: { ...value, remoteStatus: remote.status } })).snapshot
  }
  if (remote.status === 'cancelled') return event(scope, run, 'run.cancelled', { reason: '服务报告外部任务已取消' })
  if (remote.status === 'failed') return event(scope, run, 'run.failed', { code: 'extension.remote_task_failed', retryable: false })
  const result = resultFromTaskOutcome(await controller.result({ signal }))
  if (run.projection.state === 'paused' || run.projection.state === 'recovering') {
    const recovery = await beginAgentRunRecoveryV1({ scope, runId, expectedLastSequence: run.projection.lastSequence })
    run = await completeAgentRunRecoveryV1({ scope, runId, checkpointHash: recovery.checkpointHash, expectedLastSequence: recovery.snapshot.projection.lastSequence })
  }
  return finish(run, value, result)
}
