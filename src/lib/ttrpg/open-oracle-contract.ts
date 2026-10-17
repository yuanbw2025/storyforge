/** Oracle is a zero-time consultation; it never commits interpretation or mechanical facts. */
import type { RulePackV2 } from './open-contract'
import { parseRulePackV2 } from './rule-pack-v2'
import { parseTtrpgOracleResolutionV1, verifyTtrpgOracleOutcomeV1, type TtrpgOracleResolutionV1 } from './oracle'
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import * as p from './open-contract-parse'

export interface TtrpgOpenOracleReceiptV1 {
  sourceRef: TtrpgOpenSourceRefV1
  previousOracleRef: TtrpgOpenSourceRefV1 | null
  authorizationEpochKey: string
  viewerKey: string
  worldTurn: number
  audience: 'gm-only' | 'party' | 'public'
  frozenRulePack: RulePackV2
  resolution: TtrpgOracleResolutionV1
}
export function parseTtrpgOpenOracleReceiptV1(value: unknown): TtrpgOpenOracleReceiptV1 {
  const r = p.record(value, ['sourceRef', 'previousOracleRef', 'authorizationEpochKey', 'viewerKey', 'worldTurn', 'audience', 'frozenRulePack', 'resolution'], 'open oracle receipt')
  const frozenRulePack = parseRulePackV2(r.frozenRulePack)
  const resolution = parseTtrpgOracleResolutionV1(r.resolution, frozenRulePack)
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef)
  const previousOracleRef = r.previousOracleRef === null ? null : parseTtrpgOpenSourceRefV1(r.previousOracleRef)
  const audience = p.oneOf(r.audience, ['gm-only', 'party', 'public'], 'oracle audience')
  if (resolution.rollReceipt.eventSequence !== sourceRef.sequence
    || audience !== frozenRulePack.oracles.find(table => table.oracleKey === resolution.outcome.oracleKey)?.audience
    || (previousOracleRef?.sessionKey === sourceRef.sessionKey && previousOracleRef.sequence >= sourceRef.sequence)) p.fail('Oracle 身份、前序或受众不一致')
  return { sourceRef, previousOracleRef, frozenRulePack, resolution, audience,
    authorizationEpochKey: p.key(r.authorizationEpochKey, 'oracle epoch'), viewerKey: p.key(r.viewerKey, 'oracle viewer'),
    worldTurn: p.integer(r.worldTurn, 'oracle turn', 0, Number.MAX_SAFE_INTEGER) }
}

export function assertTtrpgOpenOracleCallerV1(input: {
  authorization: TtrpgOpenAuthorizationV1; viewerKey: string; askedBy: string; audience: TtrpgOpenOracleReceiptV1['audience']
}): string {
  const seat = input.authorization.seats.find(seat => seat.viewerKey === input.viewerKey)
  if (!seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed') p.fail('Oracle 需要 claimed 真人提交授权')
  if (input.askedBy === 'gm') {
    if (seat.role !== 'gm') p.fail('Oracle 主持咨询需要真人 GM 席位')
    return seat.actorKey ?? 'gm'
  }
  const match = /^(player|companion):(.+)$/.exec(input.askedBy)
  const actorKey = match?.[2]
  const actorSeat = input.authorization.seats.find(seat => seat.role === 'player' && seat.actorKey === actorKey)
  if (!match || !actorKey || !actorSeat || !input.authorization.selectedActorKeys.includes(actorKey)
    || input.audience === 'gm-only') p.fail('Oracle 请求身份或受众不可读')
  if (match[1] === 'player') {
    if (seat.actorKey !== actorKey || actorSeat.controller === 'ai') p.fail('Oracle 不能代替其他真人提交咨询')
  } else if (actorSeat.controller === 'human' || !actorSeat.consent.aiAdviceAllowed
    || !input.authorization.approvalBindings.some(binding => binding.companionActorKey === actorKey && binding.approverSeatKeys.includes(seat.seatKey))) {
    p.fail('队友 Oracle 缺少本人的真人批准关系')
  }
  return actorKey
}

/** Re-read frozen source and original branch seed before exposing or using historical results. */
export async function verifyTtrpgOpenOracleJournalV1(input: {
  receipts: readonly TtrpgOpenOracleReceiptV1[]; rulePack: RulePackV2; sessionKey: string; seed: string;
  ancestors: readonly { sessionKey: string; randomSource: { seed: string } }[];
}): Promise<void> {
  for (const receipt of input.receipts) {
    const seed = receipt.sourceRef.sessionKey === input.sessionKey ? input.seed
      : input.ancestors.find(ancestor => ancestor.sessionKey === receipt.sourceRef.sessionKey)?.randomSource.seed
    if (seed === undefined || !await verifyTtrpgOracleOutcomeV1({ rulePack: input.rulePack, seed, ...receipt.resolution })) {
      p.fail('Oracle 历史没有当前冻结规则及原始 session seed 的真实复算证据')
    }
  }
}
