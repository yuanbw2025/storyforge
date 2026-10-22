/** Human archival proof only. It never grants model execution or fact adoption. */
import * as p from './open-contract-parse'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenEpochV1 } from './open-coordination'
import { parseTtrpgOpenModelCallV1, updateTtrpgOpenEpochCallTotalsV1, assertTtrpgOpenCommonOracleCallOriginV1, type TtrpgOpenModelCallV1 } from './open-model-calls'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'

export const TTRPG_OPEN_COMMON_ORACLE_ARCHIVE_DECISION_V1 = 'archive-this-unresumable-common-oracle-window'
export function parseTtrpgOpenCommonOracleArchiveReceiptV1(value: unknown) {
  const r = p.record(value, ['schema', 'version', 'decision', 'sourceRef', 'epochKey', 'requestKey', 'viewerKey', 'basisHash',
    'producer', 'observation', 'priorStatus', 'originHash', 'responseArtifactHash', 'receiptHash'], 'common Oracle human archive')
  return {
    schema: p.literal(r.schema, 'storyforge.ttrpg-open-common-oracle-archive', 'common archive schema'),
    version: p.literal(r.version, 1, 'common archive version'),
    decision: p.literal(r.decision, TTRPG_OPEN_COMMON_ORACLE_ARCHIVE_DECISION_V1, 'explicit common archive decision'),
    sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef), epochKey: p.key(r.epochKey, 'archive epoch'), requestKey: p.key(r.requestKey, 'archive request'),
    viewerKey: p.key(r.viewerKey, 'archive human'), basisHash: p.hash(r.basisHash, 'archive original basis'),
    producer: p.oneOf(r.producer, ['imported', 'unavailable'], 'unresumable producer'),
    observation: p.oneOf(r.observation, ['not-dispatched', 'retained-response', 'unverifiable-response', 'terminal-retained'], 'archive observation'),
    priorStatus: p.oneOf(r.priorStatus, ['prepared', 'dispatched', 'succeeded', 'failed', 'unknown'], 'archive prior status'),
    originHash: p.nullable(r.originHash, p.hash, 'archive imported origin'),
    responseArtifactHash: p.nullable(r.responseArtifactHash, p.hash, 'archive retained answer'), receiptHash: p.hash(r.receiptHash, 'archive receipt hash'),
  }
}
export type TtrpgOpenCommonOracleArchiveReceiptV1 = ReturnType<typeof parseTtrpgOpenCommonOracleArchiveReceiptV1>

export function assertTtrpgOpenCommonOracleArchiveReaderV1(runtime: TtrpgRuntimeStateV2, epoch: TtrpgOpenEpochV1, viewerKey: string) {
  const seat = assertTtrpgOpenHumanHostV1(runtime.authorization!, viewerKey), grant = epoch.commonOracle
  if (!grant || epoch.viewerKey !== viewerKey || epoch.startedRef.sessionKey !== runtime.sessionKey || grant.basis.sessionKey !== runtime.sessionKey
    || grant.basis.requester.viewerKey !== viewerKey || grant.basis.requester.seatKey !== seat.seatKey || grant.basis.requester.seatRevision !== seat.revision
    || grant.basis.authorizationRevision !== runtime.authorization!.revision
    || stable(grant.basis.recipientActorKeys) !== stable([...runtime.authorization!.selectedActorKeys].sort())) p.fail('只能由准确本桌原本人及全体原接收者归档共同请求')
  return seat
}

/** State/backup validation is independent of the continued existence of the original Run. */
export function assertTtrpgOpenCommonOracleArchiveStateV1(epoch: TtrpgOpenEpochV1, call: TtrpgOpenModelCallV1 | undefined) {
  const r = epoch.commonOracleArchive
  if (!r) return
  const grant = epoch.commonOracle
  if (!grant || !call || epoch.status !== 'closed' || stable(r.sourceRef) !== stable(epoch.closedRef) || epoch.reservedCalls !== 0
    || r.epochKey !== epoch.epochKey || r.viewerKey !== epoch.viewerKey || r.requestKey !== grant.requestKey || r.basisHash !== grant.basisHash
    || call.requestKey !== r.requestKey || call.authorizationEpochKey !== epoch.epochKey || call.responseArtifactHash !== r.responseArtifactHash
    || ['prepared', 'dispatched'].includes(call.status) || (r.producer === 'imported') !== Boolean(r.originHash)
    || r.priorStatus === 'prepared' && (r.observation !== 'not-dispatched' || call.status !== 'failed' || call.terminalReason !== 'cancelled-before-dispatch')
    || r.priorStatus === 'dispatched' && (r.observation === 'retained-response' ? r.producer !== 'imported' || call.status !== 'succeeded'
      : r.observation !== 'unverifiable-response' || call.status !== 'unknown')
    || !['prepared', 'dispatched'].includes(r.priorStatus) && (r.observation !== 'terminal-retained' || call.status !== r.priorStatus)) p.fail('共同请求归档必须保留准确原终态、响应与费用来源')
  assertTtrpgOpenCommonOracleCallOriginV1({ openRun: { coordination: { epochs: [epoch] } } } as Pick<TtrpgRuntimeStateV2, 'openRun'>, call)
  if (r.observation === 'terminal-retained' && (!call.terminalRef || call.terminalRef.sessionKey !== r.sourceRef.sessionKey || call.terminalRef.sequence >= r.sourceRef.sequence)) p.fail('归档不能借用未来终态')
  if (['prepared', 'dispatched'].includes(r.priorStatus) && stable(call.terminalRef) !== stable(r.sourceRef)) p.fail('未完成共同请求必须与本人归档原子终结')
}

/** Exact new close variant; old epoch.closed payloads keep their original shape. */
export function applyTtrpgOpenCommonOracleArchiveV1(runtime: TtrpgRuntimeStateV2, epoch: TtrpgOpenEpochV1, value: unknown, sequence: number, viewerKey: string) {
  const body = p.record(value, ['receipt', 'call'], 'common archive close payload'), receipt = parseTtrpgOpenCommonOracleArchiveReceiptV1(body.receipt)
  const call = parseTtrpgOpenModelCallV1(body.call), run = runtime.openRun!
  assertTtrpgOpenCommonOracleArchiveReaderV1(runtime, epoch, viewerKey)
  const owned = run.coordination.calls.filter(row => row.authorizationEpochKey === epoch.epochKey), previous = owned[0]
  if (epoch.status !== 'active' || run.coordination.activeEpochKey !== epoch.epochKey || epoch.commonOracleArchive || owned.length !== 1 || !previous
    || receipt.priorStatus !== previous.status || receipt.viewerKey !== viewerKey
    || stable(receipt.sourceRef) !== stable({ sessionKey: runtime.sessionKey, sequence })) p.fail('归档只允许本桌尚未关闭的单个原共同请求')
  assertTtrpgOpenCommonOracleCallOriginV1(runtime, previous)
  const identity = (c: TtrpgOpenModelCallV1) => {
    const copy = { ...c }; delete (copy as Partial<TtrpgOpenModelCallV1>).status; delete (copy as Partial<TtrpgOpenModelCallV1>).terminalRef
    delete (copy as Partial<TtrpgOpenModelCallV1>).responseArtifactHash; delete (copy as Partial<TtrpgOpenModelCallV1>).usage; delete (copy as Partial<TtrpgOpenModelCallV1>).terminalReason
    return copy
  }
  if (stable(identity(call)) !== stable(identity(previous)) || !['prepared', 'dispatched'].includes(previous.status) && stable(call) !== stable(previous)) p.fail('归档不能修改原请求、派发、预算或既有终态')
  if (previous.status === 'dispatched' && call.status === 'succeeded' && (call.usage?.source !== 'estimated' || call.usage.actualCostUsd !== null
    || call.terminalReason !== 'imported-response-retained-by-human-archive')) p.fail('归档保留回答只能记录估算用量和未知实际费用')
  run.coordination.calls[run.coordination.calls.findIndex(row => row.requestKey === previous.requestKey)] = call
  epoch.commonOracleArchive = receipt
  updateTtrpgOpenEpochCallTotalsV1(epoch, run.coordination.calls)
  // Validate the final shape without mutating the closing fields before the normal close reducer.
  assertTtrpgOpenCommonOracleArchiveStateV1({ ...epoch, status: 'closed', closedRef: receipt.sourceRef }, call)
}
