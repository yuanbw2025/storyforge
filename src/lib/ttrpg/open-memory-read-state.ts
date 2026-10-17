import { verifyTtrpgOpenCommonOracleEpochsV1 } from './open-common-oracle-request'
import { verifyTtrpgOpenEntityStateV1 } from './open-entity-proof'
import { verifyTtrpgOpenIdentityKnowledgeV1 } from './open-identity-knowledge-proof'
import { verifyTtrpgOpenSessionSituationHashesV1 } from './open-session-situation-proof'
/** Trusted read evidence shared by the human desk and distinct model consumers. No grants are inferred from host ownership. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertInstanceBinding } from '../product/runtime-instances'
import { hashProductRuntimeStateV1, readProductRuntimeStateVersion, readSessionEvents } from '../product/runtime-core'
import { replayTtrpgOpenReadEventsV1 } from './open-read-replay'
import { verifyProductRuntimeSessionSourceV1 } from '../product-production/preview-source'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { assertTtrpgOpenAuthorizationCurrentV1, assertTtrpgOpenAuthorizationRowsCurrentV1, assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { projectTtrpgOpenMemoryRowV1, verifyTtrpgOpenMemoryReceiptsV1, assertTtrpgOpenMemoryLocatorV1 } from './open-memory-proof'
import { TtrpgOpenReadConflictV1 } from './open-read-conflict'
import { isTtrpgRuntimeContentV2 } from './content-version'
import { hashProductProductionValueV2 } from '../product-production/hash'

export type TtrpgOpenMemoryReaderV1 = { kind: 'human'; viewerKey: string } | { kind: 'actor'; actorKey: string } | { kind: 'party' }

export async function loadTtrpgOpenMemoryReadStateV1(input: { scope: WorkspaceScope; sessionId: number; reader: TtrpgOpenMemoryReaderV1 }) {
  const session = await assertInstanceBinding(input.sessionId, input.scope)
  if (session.kind !== 'ttrpg') throw new Error('[ttrpg-memory] 当前实例不是跑团')
  const source = await verifyProductRuntimeSessionSourceV1({ scope: input.scope, session, ttrpgProtocol: 2 })
  const content = source.runtimePackage.ttrpg
  if (!content || !isTtrpgRuntimeContentV2(content) || source.runtimeSourceHash !== session.runtimeSourceHash) throw new Error('[ttrpg-memory] 当前来源不是有效冻结开放跑团')
  // Memory authority comes from actual events, including inherited evidence, never a self-hashed head alone.
  const events = await readSessionEvents(session)
  const state = replayTtrpgOpenReadEventsV1(session.initialStateJson, events)
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg), stateHash = await hashProductRuntimeStateV1(state)
  if (!runtime?.authorization || !runtime.openRun || runtime.product.rulePackContentHash !== content.rulePack.contentHash
    || runtime.product.campaignKey !== content.campaign.campaignKey) throw new Error('[ttrpg-memory] 请先完成当前分支的有效开团授权')
  await verifyTtrpgOpenSessionSituationHashesV1(runtime.openRun.situationReceipts ?? [])
  await verifyTtrpgOpenEntityStateV1(state, content)
  await verifyTtrpgOpenIdentityKnowledgeV1({ runtime, runtimeSourceHash: source.runtimeSourceHash, events })
  await verifyTtrpgOpenCommonOracleEpochsV1(runtime.openRun.coordination.epochs)
  const authorization = runtime.authorization, participants = await readTtrpgSessionParticipantsV2(input.sessionId)
  assertTtrpgOpenAuthorizationRowsCurrentV1({ authorization, participants })
  const reader = input.reader
  const seat = reader.kind === 'human'
    ? assertTtrpgOpenAuthorizationCurrentV1({ authorization, participants, viewerKey: reader.viewerKey })
    : reader.kind === 'actor' ? authorization.seats.find(s => s.role === 'player' && s.actorKey === reader.actorKey) : undefined
  let humanHost = false
  if (reader.kind === 'human') {
    try { assertTtrpgOpenHumanHostV1(authorization, reader.viewerKey); humanHost = true } catch { /* Own notes remain readable. */ }
  } else {
    if (!content.campaign.runtimePolicy.enabled || runtime.product.safety.status !== 'active') throw new Error('[ttrpg-memory] 本桌当前未允许模型读取记忆')
    if (reader.kind === 'actor' && (!seat || !authorization.selectedActorKeys.includes(reader.actorKey)
      || !state.entities[reader.actorKey] || !content.campaign.characterTemplates.some(a => a.characterKey === reader.actorKey)
      || !seat.consent.aiAdviceAllowed || !seat.consent.sessionLoggingAllowed)) throw new Error('[ttrpg-memory] 角色未获当前记忆读取授权')
    if (reader.kind === 'party' && authorization.seats.some(s => !s.consent.sessionLoggingAllowed)) throw new Error('[ttrpg-memory] 共同叙述未获本桌记忆读取同意')
  }
  // No private-row metadata is returned before actual consumer authorization above.
  await verifyTtrpgOpenMemoryReceiptsV1({ runtime, runtimeSourceHash: source.runtimeSourceHash, events })
  const rows = await db.ttrpgNarrativeMemories.where('sessionId').equals(input.sessionId).toArray()
  if (rows.length !== (runtime.openRun.memoryReceipts?.length ?? 0)) throw new Error('[ttrpg-memory] 记忆表投影缺失或多出未确认内容，请修复原记录')
  const byRevision = new Map(rows.map(row => [row.revisionKey, row]))
  const entries = []
  for (const receipt of runtime.openRun.memoryReceipts ?? []) {
    const row = byRevision.get(receipt.draft.revisionKey)
    if (!row) throw new Error('[ttrpg-memory] 已确认记忆原记录缺失')
    if (row.sourceSessionId !== null) assertTtrpgOpenMemoryLocatorV1(receipt, await db.productRuntimeSessions.get(row.sourceSessionId), session)
    const { id: _id, ...fields } = row
    if (stable(fields) !== stable(projectTtrpgOpenMemoryRowV1(receipt, session, row.sourceSessionId))) throw new Error('[ttrpg-memory] 记忆行与原确认不一致')
    entries.push({ row, receipt })
  }
  const immutable = source.source.kind === 'release'
    ? { table: 'productReleases' as const, recordId: source.source.productReleaseId, field: 'manifestJson' as const,
      raw: (await db.productReleases.get(source.source.productReleaseId))?.manifestJson }
    : { table: 'productBuilds' as const, recordId: source.source.productBuildId, field: 'previewManifestJson' as const,
      raw: (await db.productBuilds.get(source.source.productBuildId))?.previewManifestJson }
  if (!immutable.raw || await hashProductProductionValueV2(JSON.parse(immutable.raw).runtimePackage) !== source.packageHash) throw new Error('[ttrpg-memory] 冻结来源原记录缺失或已变化')
  const assertCurrent = async () => {
    const current = await readProductRuntimeStateVersion(input.sessionId)
    const latestParticipants = await readTtrpgSessionParticipantsV2(input.sessionId)
    const latestSession = await assertInstanceBinding(input.sessionId, input.scope)
    const latestRows = await db.ttrpgNarrativeMemories.where('sessionId').equals(input.sessionId).toArray()
    const latestEvents = await readSessionEvents(latestSession)
    const latestRaw = immutable.table === 'productReleases' ? (await db.productReleases.get(immutable.recordId))?.manifestJson
      : (await db.productBuilds.get(immutable.recordId))?.previewManifestJson
    if (current.sequence !== state.lastSequence || current.stateHash !== stateHash || latestSession.runtimeSourceHash !== session.runtimeSourceHash
      || latestSession.productReleaseId !== session.productReleaseId || latestSession.productBuildId !== session.productBuildId
      || latestSession.initialStateJson !== session.initialStateJson || stable(latestParticipants) !== stable(participants)
      || stable(latestRows) !== stable(rows) || stable(latestEvents) !== stable(events) || latestRaw !== immutable.raw) throw new TtrpgOpenReadConflictV1('读取记忆期间进度、来源、原记录或身份已变化')
  }
  await assertCurrent()
  return { session, source, content, state, stateHash, runtime, authorization, seat, humanHost, entries, immutable, assertCurrent }
}
