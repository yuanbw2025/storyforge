/** Author confirmation for the exact paid import candidate. No model calls here. */
import Dexie from 'dexie'
import { db } from '../db/schema'
import {
  hashImportChunkTextV1, readImportSessionAuthorityInTransactionV1, readImportSessionAuthorityV1,
} from '../../stores/import-session'
import { addReferenceInTransactionV1, importedReferenceDataV1, referenceCreationTablesV1, useReferenceStore } from '../../stores/reference'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../agent/run/checkpoint'
import { parseAgentRunEventV1 } from '../agent/run/event-schema'
import {
  agentRunScopeTransactionTablesV1, appendAgentRunEventWithSettlementInTransactionV1,
  readVerifiedAgentRunInTransactionV1, withAgentRunMutationLockV1,
  type AgentRunSnapshotV1, type appendAgentRunEventV1,
} from '../agent/run/event-store'
import { hashCanonicalValue } from '../agent/run/hash'
import { createVerificationReceiptV1, verifyVerificationReceiptIntegrityV1 } from '../agent/run/verification-receipt'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import type { ImportSession, UnifiedParseResult, WorkspaceScope } from '../types'
import { applyChunkResult, importChunkAdoptionTablesV1, refreshImportedChunkStoresV1 } from './chunk-writer'
import { getChunkText } from './chunk-text-registry'
import { readDocumentImportChunkEvidenceV1 } from './document-parse-durable'
import { buildFinalReport, mergeUnified, normalizeUnified } from './unified-merge'

const STEP = 'document-import.parse'
const VERIFIER = 'document-import-terminal-v1'

interface ConfirmDocumentImportChunkInputV1 {
  projectId: number
  sessionId: number
  chunkIndex: number
  candidateHash: string
  /** Exact result the author reviewed. Optional edits are included in the receipt. */
  reviewedResult?: UnifiedParseResult
}

function append(scope: WorkspaceScope, snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]['type'], payload: unknown) {
  return Dexie.Promise.resolve(appendAgentRunEventWithSettlementInTransactionV1({ scope, snapshot,
    event: parseAgentRunEventV1({ version: 1, runId: snapshot.run.id, sequence: snapshot.projection.lastSequence + 1,
      generation: snapshot.projection.generation, projectId: scope.projectId, worldGroupId: snapshot.run.worldGroupId ?? null,
      contractHash: snapshot.projection.contractHash, type, payload, createdAt: Date.now() }),
  }))
}

function validateReviewedResult(value: UnifiedParseResult): UnifiedParseResult {
  const record = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v)
  if (!record(value) || Object.entries(value).some(([key, field]) => {
    if (['worldview', 'geography', 'history', 'writingTechniques'].includes(key)) return !record(field)
    if (['characters', 'outline', 'codexCandidates'].includes(key)) return !Array.isArray(field) || field.some(item => !record(item))
    return true
  })) throw new Error('请核对候选字段和数据格式。')
  return normalizeUnified(value)
}

export async function confirmDocumentImportChunkV1(input: ConfirmDocumentImportChunkInputV1) {
  input = structuredClone(input)
  const session = await readImportSessionAuthorityV1(input.sessionId, input.projectId)
  const scope = session.targetScope
  const chunk = session.chunks[input.chunkIndex]
  const link = chunk?.durableParse
  if (!link?.runId || chunk.index !== input.chunkIndex) throw new Error('未找到原导入候选。')
  const runId = link.runId
  const evidence = await readDocumentImportChunkEvidenceV1(input)
  const candidate = evidence?.candidate
  if (!candidate || candidate.candidateHash !== input.candidateHash || candidate.runId !== runId)
    throw new Error('候选已变化；请重新打开并确认。')
  const reviewed = validateReviewedResult(input.reviewedResult ? {
    ...input.reviewedResult, codexCandidates: candidate.result.codexCandidates ?? [],
  } : candidate.result)
  const editedHash = await hashCanonicalValue(reviewed)
  const source = getChunkText(input.sessionId, input.chunkIndex)
  const sourceHash = source === undefined ? null : await hashImportChunkTextV1(source)
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(scope, runId)
  if (!checkpoint) throw new Error('原导入候选缺少可核验检查点。')

  const committed = await withAgentRunMutationLockV1(runId, () => db.transaction('rw',
    agentRunScopeTransactionTablesV1(runId, db.importSessions, db.worldGroups, db.agentRuns, db.agentRunEvents,
      db.agentRunCheckpoints, ...(session.importTarget === 'project' ? importChunkAdoptionTablesV1() : referenceCreationTablesV1())), async () => {
      const transaction = Dexie.currentTransaction!
      const live = await Dexie.waitFor(readImportSessionAuthorityInTransactionV1(input.sessionId, input.projectId, session))
      const liveChunk = live.chunks[input.chunkIndex]
      const liveLink = liveChunk?.durableParse
      if (!liveLink || liveLink.runId !== runId || liveLink.claimKey !== link.claimKey ||
        liveChunk.sourceTextHash !== candidate.sourceTextHash || live.status === 'cancelled')
        throw new Error('导入原文、目标或候选已变化。')
      let snapshot = await Dexie.Promise.resolve(readVerifiedAgentRunInTransactionV1(scope, runId))
      const step = snapshot.projection.steps[STEP]
      const liveCheckpoint = await db.agentRunCheckpoints.get(checkpoint.checkpoint.id)
      if (step?.candidateHash !== candidate.candidateHash || liveCheckpoint?.checkpointHash !== checkpoint.checkpoint.checkpointHash ||
        liveCheckpoint.resumePayloadJson !== checkpoint.checkpoint.resumePayloadJson)
        throw new Error('当前运行候选与原确认材料不一致。')

      if (liveLink.confirmation && liveChunk.status === 'done') {
        const stored = liveLink.confirmation
        if (snapshot.projection.state !== 'completed' || snapshot.projection.terminalReceiptHash !== stored.receipt.receiptHash ||
          stored.editedHash !== editedHash)
          throw new Error('已保存另一份确认结果，请刷新查看原收据。')
        if (!await Dexie.waitFor(verifyVerificationReceiptIntegrityV1(stored.receipt))) throw new Error('原收据完整性校验失败。')
        return { receipt: stored.receipt, changed: false }
      }
      if (step.status !== 'awaiting_confirmation' || live.status === 'done' ||
        live.chunks.find(item => item.status !== 'done')?.index !== input.chunkIndex || sourceHash !== candidate.sourceTextHash || getChunkText(input.sessionId, input.chunkIndex) !== source)
        throw new Error('候选未等待确认，或需要重新提供相同原文件后确认。')

      snapshot = await append(scope, snapshot, 'confirmation.recorded', { stepId: STEP, candidateHash: candidate.candidateHash, decision: 'adopt' })
      const intentHash = await Dexie.waitFor(hashCanonicalValue({ kind: 'document-import', candidateHash: candidate.candidateHash, editedHash }))
      snapshot = await append(scope, snapshot, 'adoption.started', { stepId: STEP, candidateHash: candidate.candidateHash, intentHash })
      const writes: { target: string; rows: { id: number; fields: string[] }[] }[] = []
      const counts = live.importTarget === 'project'
        ? await Dexie.Promise.resolve(applyChunkResult(scope, reviewed, live.targetWorldGroupId ?? null, undefined, writes))
        : { worldviewFields: Object.keys(reviewed.worldview ?? {}).length, characters: reviewed.characters?.length ?? 0,
          outlineNodes: reviewed.outline?.length ?? 0, codexCandidates: reviewed.codexCandidates?.length ?? 0 }
      const postRows: unknown[] = []
      for (const write of writes) {
        const table = REGISTRY_BY_NAME.get(write.target)?.table
        if (!table) throw new Error('采纳写入缺少已登记的表。')
        for (const row of write.rows) {
          const post = await table.get(row.id) as Record<string, unknown> | undefined
          if (!post) throw new Error('已采纳内容的正式记录不存在。')
          postRows.push({ target: write.target, id: row.id, fields: Object.fromEntries(row.fields.map(key => [key, post[key]])) })
        }
      }
      // A historical project chunk was already written under its former path;
      // keep its report while excluding unreviewed historical Codex candidates.
      const prior = live.chunks.some(item => item.status === 'done' && !item.durableParse?.confirmation)
        ? { ...live.merged, codexCandidates: [] } : live.merged
      const merged = mergeUnified(prior, reviewed)
      const finished = live.chunks.every(item => item.index === input.chunkIndex || item.status === 'done')
      let publishedReferenceId: number | undefined
      if (finished && live.importTarget === 'reference') {
        if (live.chunks.some(item => item.index !== input.chunkIndex && !item.durableParse?.confirmation) ||
          live.publishedReferenceId != null) throw new Error('旧参考结果没有完整候选确认；不能发布为新参考。')
        const refData = importedReferenceDataV1({ ...live, id: input.sessionId, merged }, live.analysisDepth ?? 'quick')
        publishedReferenceId = await Dexie.Promise.resolve(addReferenceInTransactionV1(refData, { scope, transaction }))
        const published = await transaction.table(db.references.name).get(publishedReferenceId)
        if (!published || published.workId !== scope.workId || published.importSessionId !== input.sessionId)
          throw new Error('项目参考的正式保存未通过原作品校验。')
        postRows.push({ target: 'references', id: publishedReferenceId, importedData: published.importedData })
      }
      const postStateHash = await Dexie.waitFor(hashCanonicalValue({ candidateHash: candidate.candidateHash, editedHash, counts, postRows, merged }))
      snapshot = await append(scope, snapshot, 'adoption.committed', { stepId: STEP, candidateHash: candidate.candidateHash, adoptionHash: postStateHash })
      snapshot = await append(scope, snapshot, 'step.succeeded', { stepId: STEP, attempt: 1, outputHash: postStateHash })
      snapshot = await append(scope, snapshot, 'verification.started', { verifierSetVersion: VERIFIER })
      const manifest = snapshot.events.find(event => event.type === 'context.assembled')
      const adoption = await db.agentRunEvents.where('runId').equals(runId).filter(row => row.type === 'adoption.committed').first()
      if (manifest?.type !== 'context.assembled' || !adoption?.id) throw new Error('缺少导入上下文或采纳事件。')
      const receipt = await Dexie.waitFor(createVerificationReceiptV1({
        version: 1, runId, generation: snapshot.projection.generation, contractHash: snapshot.projection.contractHash,
        contextManifestHashes: [manifest.payload.manifestHash], candidateHashes: [candidate.candidateHash],
        adoptionEventIds: [adoption.id], postStateHash, verifierSetVersion: VERIFIER,
        criteria: [{ id: 'document-import.candidate', status: 'passed', evidenceRefs: [`candidate:${candidate.candidateHash}`] },
          { id: 'document-import.author', status: 'passed', evidenceRefs: [`event:${adoption.id}`] }],
        acceptedAt: Date.now(),
      }))
      await append(scope, snapshot, 'verification.accepted', { receiptHash: receipt.receiptHash })
      const chunks = live.chunks.map(item => item.index !== input.chunkIndex ? item : { ...item, status: 'done' as const,
        attempts: 1, extractedCounts: counts, finishedAt: Date.now(),
        durableParse: { ...liveLink, confirmation: { editedHash, receipt } },
      })
      const next: Partial<ImportSession> = { chunks, merged, rollingContext: '',
        status: finished ? 'done' : 'paused', fatalError: undefined, updatedAt: Date.now(),
        ...(publishedReferenceId == null ? {} : { publishedReferenceId }),
      }
      if (finished) next.finalReport = buildFinalReport({ ...live, ...next })
      if (!await db.importSessions.update(input.sessionId, next)) throw new Error('原导入会话已删除。')
      return { receipt, changed: true, publishedReferenceId }
    }))
  if (committed.changed) {
    const refresh = session.importTarget === 'project'
      ? refreshImportedChunkStoresV1(scope, session.targetWorldGroupId ?? null)
      : committed.publishedReferenceId != null ? useReferenceStore.getState().loadAll(scope) : null
    // Refreshing the page/store is separate from the already committed receipt.
    if (refresh) await Promise.allSettled([refresh])
  }
  return committed.receipt
}
