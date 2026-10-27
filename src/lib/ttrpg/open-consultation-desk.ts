/** General Oracle entry independent of dynamic entity templates. No AI or new domain owner. */
import { loadTtrpgOpenConsultationStateV1, ttrpgOpenConsultationAvailabilityV1, ttrpgOpenConsultationEnvelopeV1,
  type TtrpgOpenConsultationInputV1 } from './open-human-consultation'
import { projectTtrpgOpenClueSharingV1 } from './open-knowledge-share-desk'
import { db } from '../db/schema'
import { startTtrpgOpenEpochV1, closeTtrpgOpenEpochV1, consultTtrpgOracleV1 } from './runtime-commands'

export async function readTtrpgOpenConsultationDeskV1(input: TtrpgOpenConsultationInputV1) {
  const loaded = await loadTtrpgOpenConsultationStateV1(input), { runtime, content, seat, authorization } = loaded, run = runtime.openRun!
  const flags = ttrpgOpenConsultationAvailabilityV1(loaded, input.viewerKey), gm = seat!.role === 'gm', actorKey = seat!.actorKey
  const tables = content.rulePack.content.oracles.filter(table => gm || table.audience !== 'gm-only').map(table => ({ key: table.oracleKey, title: table.title,
    tiers: table.likelihood?.tiers.map(tier => ({ key: tier.tierKey, label: tier.label })) ?? [] }))
  const history = (run.oracleReceipts ?? []).filter(receipt => gm || receipt.audience === 'public' || receipt.audience === 'party' && actorKey !== null
    && (receipt.sourceRef.sessionKey === runtime.sessionKey ? authorization : runtime.branchLineage?.ancestors.find(row => row.sessionKey === receipt.sourceRef.sessionKey)?.snapshot.authorization)?.selectedActorKeys.includes(actorKey))
    .map(receipt => {
      const outcome = receipt.resolution.outcome, result = outcome.rawResult
      const table = receipt.frozenRulePack.oracles.find(row => row.oracleKey === outcome.oracleKey)!
      return { sourceRef: receipt.sourceRef, question: outcome.question, worldTurn: receipt.worldTurn, audience: receipt.audience,
        result: typeof result === 'string' ? ({ yes: '是', 'yes-but': '是，但是…', 'no-but': '否，但是…', no: '否' }[result]) : table.entries?.find(row => row.entryKey === result.entryKey)?.text ?? '原结果已保存' }
    })
  const sharing = await projectTtrpgOpenClueSharingV1(loaded, input.viewerKey)
  await loaded.assertCurrent()
  return { sequence: loaded.state.lastSequence, canStart: flags.canStart, canClose: flags.canClose, canConsult: flags.canConsult && tables.length > 0,
    unavailable: flags.unavailable, remainingConsultations: Math.max(0, 2 - run.consultedThisWorldTurn), tables, history, sharing }
}
export type TtrpgOpenConsultationDeskV1 = Awaited<ReturnType<typeof readTtrpgOpenConsultationDeskV1>>
export async function startTtrpgOpenConsultationDeskV1(input: TtrpgOpenConsultationInputV1 & { submissionKey: string; decision: 'start-this-consultation-and-sharing' }) {
  if (input.decision !== 'start-this-consultation-and-sharing') throw new Error('请明确开始本次咨询与交流')
  const loaded = await loadTtrpgOpenConsultationStateV1(input)
  if (!ttrpgOpenConsultationAvailabilityV1(loaded, input.viewerKey).canStart) throw new Error('请先完成并结束原窗口，或恢复冒险')
  await loaded.assertCurrent()
  return startTtrpgOpenEpochV1({ ...await ttrpgOpenConsultationEnvelopeV1(input, loaded, 'consultation.start', input.submissionKey), viewerKey: input.viewerKey,
    triggerKind: loaded.seat!.role === 'gm' ? 'continue-host' : 'submit-action', rawInput: '真人明确开始本次受限咨询与已知线索交流' })
}
export async function consultTtrpgOpenConsultationDeskV1(input: TtrpgOpenConsultationInputV1 & { submissionKey: string; oracleKey: string; question: string; likelihoodTierKey: string | null }) {
  const loaded = await loadTtrpgOpenConsultationStateV1(input), flags = ttrpgOpenConsultationAvailabilityV1(loaded, input.viewerKey)
  const envelope = await ttrpgOpenConsultationEnvelopeV1(input, loaded, 'consultation.oracle', input.submissionKey)
  const prior = await db.productRuntimeEvents.where('[sessionId+commandId]').equals([input.sessionId, envelope.commandId]).first()
  if (!flags.canConsult && !prior || !loaded.content.rulePack.content.oracles.some(row => row.oracleKey === input.oracleKey && (loaded.seat!.role === 'gm' || row.audience !== 'gm-only'))) throw new Error('当前不能咨询；请核对本人窗口、原结果和本轮剩余次数')
  if (prior) {
    if (prior.type !== 'ttrpg.oracle.consulted' || prior.baseSequence == null || prior.baseStateHash == null) throw new Error('原咨询命令缺少准确的正式事件基线')
    envelope.baseSequence = prior.baseSequence; envelope.baseStateHash = prior.baseStateHash
  }
  await loaded.assertCurrent()
  return consultTtrpgOracleV1({ ...envelope, viewerKey: input.viewerKey,
    askedBy: loaded.seat!.role === 'gm' ? 'gm' : `player:${loaded.seat!.actorKey!}`, oracleKey: input.oracleKey, question: input.question, likelihoodTierKey: input.likelihoodTierKey })
}
export async function closeTtrpgOpenConsultationDeskV1(input: TtrpgOpenConsultationInputV1 & { submissionKey: string }) {
  const loaded = await loadTtrpgOpenConsultationStateV1(input), flags = ttrpgOpenConsultationAvailabilityV1(loaded, input.viewerKey)
  if (!flags.canClose) throw new Error('请先处理原行动、请求或专用窗口，再明确结束')
  await loaded.assertCurrent()
  return closeTtrpgOpenEpochV1({ ...await ttrpgOpenConsultationEnvelopeV1(input, loaded, 'consultation.close', input.submissionKey), viewerKey: input.viewerKey,
    epochKey: flags.epoch!.epochKey, reason: '真人明确结束本次受限咨询与已知线索交流' })
}
