/** Imported/orphaned request bookkeeping. No provider, candidate writer or Run mutation. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { loadTtrpgOpenMemoryReadStateV1 } from './open-memory-read-state'
import { readTtrpgOpenImportedCallOwnerV1 } from './open-run-portability'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { estimateTokens } from '../ai/context-budget'
import { estimateTtrpgOpenRuntimeFallbackInputV1 } from './open-runtime-wire-budget'
import { hashCanonicalValue } from '../agent/run/hash'
import { assertTtrpgOpenCommonOracleCallOriginV1, parseTtrpgOpenModelCallV1 } from './open-model-calls'
import { assertTtrpgOpenCommonOracleArchiveReaderV1, parseTtrpgOpenCommonOracleArchiveReceiptV1,
  TTRPG_OPEN_COMMON_ORACLE_ARCHIVE_DECISION_V1 } from './open-common-oracle-archive-contract'
import { closeTtrpgOpenEpochV1 } from './runtime-commands'

type ArchiveInput = { scope: WorkspaceScope; sessionId: number; viewerKey: string; epochKey: string; requestKey: string }
/** Called only by the existing formal-command builder; the transaction rechecks every witness. */
export async function prepareTtrpgOpenCommonOracleArchiveForKernelV1(input: ArchiveInput & { sequence: number }) {
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const run = loaded.runtime.openRun!, epoch = run.coordination.epochs.find(row => row.epochKey === input.epochKey), grant = epoch?.commonOracle
  if (!epoch || !grant || grant.requestKey !== input.requestKey || epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey
    || run.coordination.calls.filter(row => row.authorizationEpochKey === epoch.epochKey).length !== 1
    || input.sequence !== loaded.state.lastSequence + 1) throw new Error('只能归档本桌准确的单个未关闭共同请求')
  assertTtrpgOpenCommonOracleArchiveReaderV1(loaded.runtime, epoch, input.viewerKey)
  const previous = run.coordination.calls.find(row => row.requestKey === input.requestKey)!
  assertTtrpgOpenCommonOracleCallOriginV1(loaded.runtime, previous)
  const originalRun = await db.agentRuns.get(grant.run.runId)
  const sessionRuns = await db.agentRuns.where('productRuntimeSessionId').equals(input.sessionId).sortBy('id')
  const originalHere = originalRun?.projectId === input.scope.projectId && originalRun.productRuntimeSessionId === input.sessionId
  if (originalHere && !originalRun.portableRuntimeOriginJson) throw new Error('原本地 Run 仍存在；请使用原恢复、审阅或停止路径，损坏记录须先核对')
  const owner = await readTtrpgOpenImportedCallOwnerV1(input)
  if (owner && (owner.origin.sourceRunId !== grant.run.runId || owner.origin.contractJson !== grant.run.contractJson
    || owner.origin.contractHash !== grant.run.contractHash)) throw new Error('导入共同请求的准确原 Run 来源不一致')
  if (!owner && sessionRuns.some(row => row.portableRuntimeOriginJson && row.contractHash === grant.run.contractHash)) throw new Error('导入共同请求缺少完整唯一来源，不能改记为原 Run 缺失')
  const producer = owner ? 'imported' as const : 'unavailable' as const
  const sourceRef = { sessionKey: loaded.runtime.sessionKey, sequence: input.sequence }
  let call = structuredClone(previous)
  let observation: 'not-dispatched' | 'retained-response' | 'unverifiable-response' | 'terminal-retained' = 'terminal-retained'
  const rawRefs = owner?.origin.events.flatMap(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response'
    && event.payload.stepId === previous.stepId && event.payload.attempt === previous.attempt ? [event.payload] : []) ?? []
  const rawHashes = [...new Set(rawRefs.map(row => row.contentHash))]
  if (rawHashes.length > 1) throw new Error('原回答存在多个版本，须先核对，不能猜测归档')
  if (previous.status === 'prepared') {
    if (rawRefs.length || owner?.origin.events.some(event => event.type === 'model.responded' && event.payload.stepId === previous.stepId && event.payload.attempt === previous.attempt)) throw new Error('未发送状态与原回答证据矛盾')
    observation = 'not-dispatched'
    call = parseTtrpgOpenModelCallV1({ ...previous, status: 'failed', terminalRef: sourceRef, terminalReason: 'cancelled-before-dispatch',
      usage: { source: 'estimated', inputTokens: 0, outputTokens: 0, actualCostUsd: 0 } })
  } else if (previous.status === 'dispatched') {
    if (owner && rawHashes.length === 1) {
      const responseArtifactHash = rawHashes[0]!
      const raw = await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'raw-response', contentHash: responseArtifactHash })
      if (rawRefs.some(row => row.byteLength !== new TextEncoder().encode(raw).byteLength)
        || owner.origin.events.some(event => event.type === 'model.responded' && event.payload.stepId === previous.stepId && event.payload.attempt === previous.attempt && event.payload.outputHash !== responseArtifactHash)) throw new Error('原回答不完整或回执冲突')
      const rendered = JSON.parse(await readAgentRunArtifactExactV1({ projectId: input.scope.projectId, artifactKind: 'rendered-request', contentHash: previous.requestHash })) as { messages?: Array<{ content: string }> }
      if (!Array.isArray(rendered.messages) || rendered.messages.some(row => typeof row.content !== 'string')) throw new Error('缺少原完整请求正文')
      observation = 'retained-response'
      call = parseTtrpgOpenModelCallV1({ ...previous, status: 'succeeded', terminalRef: sourceRef, responseArtifactHash,
        usage: { source: 'estimated', inputTokens: estimateTtrpgOpenRuntimeFallbackInputV1(rendered), outputTokens: estimateTokens(raw), actualCostUsd: null },
        terminalReason: 'imported-response-retained-by-human-archive' })
    } else {
      if (owner?.origin.events.some(event => event.type === 'model.responded' && event.payload.stepId === previous.stepId && event.payload.attempt === previous.attempt)) throw new Error('原回答回执存在但完整正文缺失，须先核对')
      observation = 'unverifiable-response'
      call = parseTtrpgOpenModelCallV1({ ...previous, status: 'unknown', terminalRef: sourceRef, responseArtifactHash: null,
        usage: { source: 'unknown', inputTokens: null, outputTokens: null, actualCostUsd: null }, terminalReason: 'human-archived-unverifiable-common-request' })
    }
  }
  const body = { schema: 'storyforge.ttrpg-open-common-oracle-archive' as const, version: 1 as const,
    decision: TTRPG_OPEN_COMMON_ORACLE_ARCHIVE_DECISION_V1, sourceRef, epochKey: epoch.epochKey, requestKey: previous.requestKey, viewerKey: input.viewerKey,
    basisHash: grant.basisHash, producer, observation, priorStatus: previous.status, originHash: owner?.origin.originHash ?? null, responseArtifactHash: call.responseArtifactHash }
  const receipt = parseTtrpgOpenCommonOracleArchiveReceiptV1({ ...body, receiptHash: await hashCanonicalValue(body) })
  await loaded.assertCurrent()
  return { archive: { receipt, call }, witness: { sessionId: input.sessionId, originalRunId: grant.run.runId, originalRun, sessionRuns },
    ...(owner ? { agentEvidence: owner.evidence } : {}) }
}

export async function archiveTtrpgOpenUnresumableCommonOracleWindowV1(input: ArchiveInput & { decision: typeof TTRPG_OPEN_COMMON_ORACLE_ARCHIVE_DECISION_V1 }) {
  try { return await archiveOriginal(input) } catch { throw new Error('当前不能归档本人的原共同请求；请刷新并核对原记录、准确身份与恢复路径。') }
}
async function archiveOriginal(input: ArchiveInput & { decision: typeof TTRPG_OPEN_COMMON_ORACLE_ARCHIVE_DECISION_V1 }) {
  if (input.decision !== TTRPG_OPEN_COMMON_ORACLE_ARCHIVE_DECISION_V1) throw new Error('请明确归档本次不能继续执行的原共同请求')
  const loaded = await loadTtrpgOpenMemoryReadStateV1({ ...input, reader: { kind: 'human', viewerKey: input.viewerKey } })
  const epoch = loaded.runtime.openRun!.coordination.epochs.find(row => row.epochKey === input.epochKey)
  if (!epoch || epoch.commonOracle?.requestKey !== input.requestKey) throw new Error('共同归档没有准确原窗口和请求')
  assertTtrpgOpenCommonOracleArchiveReaderV1(loaded.runtime, epoch, input.viewerKey)
  if (epoch.commonOracleArchive) return { sequence: epoch.closedRef!.sequence, epochKey: epoch.epochKey, requestKey: input.requestKey }
  const event = await closeTtrpgOpenEpochV1({ ...input, commandId: 'common-oracle.archive.' + input.epochKey,
    baseSequence: loaded.state.lastSequence, baseStateHash: loaded.stateHash,
    reason: '本人明确归档无法续行的共同请求；原回答、决定、费用和解释槽保留。', commonOracleArchive: input.decision })
  return { sequence: event.sequence, epochKey: epoch.epochKey, requestKey: input.requestKey }
}
