/** Accepted prose is a product-owned receipt, never world truth or mechanical effects. */
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenNarrationBindingV1, type TtrpgOpenNarrationBindingV1 } from './open-kp-binding'
import { parseTtrpgOpenKpNarrationV1, type TtrpgOpenKpNarrationV1 } from './open-kp-narration'
import * as p from './open-contract-parse'
export interface TtrpgOpenModelNarrationReceiptV1 {
  hostingDelegationRef?: TtrpgOpenSourceRefV1
  sourceRef: TtrpgOpenSourceRefV1; binding: TtrpgOpenNarrationBindingV1; requestKey: string;
  candidateHash: string; rawResponseHash: string; runContractHash: string; inputManifestHash: string; contextHash: string;
  recipientActorKeys: string[]; narration: TtrpgOpenKpNarrationV1; allowedSourceKeys: string[]
}
export interface TtrpgOpenHumanNarrationReceiptV1 {
  sourceKind: 'human'; sourceRef: TtrpgOpenSourceRefV1; binding: TtrpgOpenNarrationBindingV1;
  authorizationRef: TtrpgOpenSourceRefV1; recipientActorKeys: string[];
  reason: 'host-authored' | 'budget-exhausted' | 'model-unavailable' | 'replace-candidate';
  narration: TtrpgOpenKpNarrationV1; allowedSourceKeys: string[];
  basis: { outcome: string; paidWorldTurns: number; previousRequests: Array<{ requestKey: string; status: 'succeeded' | 'failed' | 'unknown'; terminalRef: TtrpgOpenSourceRefV1; responseArtifactHash: string | null }> }
}
export type TtrpgOpenNarrationReceiptV1 = TtrpgOpenModelNarrationReceiptV1 | TtrpgOpenHumanNarrationReceiptV1
export function isTtrpgOpenModelNarrationReceiptV1(receipt: TtrpgOpenNarrationReceiptV1): receipt is TtrpgOpenModelNarrationReceiptV1 { return !('sourceKind' in receipt) }
export function parseTtrpgOpenNarrationReceiptV1(value: unknown): TtrpgOpenNarrationReceiptV1 {
  if (value && typeof value === 'object' && 'sourceKind' in value) {
    const r = p.record(value, ['sourceKind', 'sourceRef', 'binding', 'authorizationRef', 'recipientActorKeys', 'reason', 'narration', 'allowedSourceKeys', 'basis'], 'human narration receipt')
    const basis = p.record(r.basis, ['outcome', 'paidWorldTurns', 'previousRequests'], 'actual narration basis')
    const allowedSourceKeys = p.keys(r.allowedSourceKeys, 'human narration sources', 1, 1)
    if (allowedSourceKeys[0] !== 'action.receipt') p.fail('人工叙述只引用本次真实结算，不可伪造模型来源')
    return { sourceKind: p.literal(r.sourceKind, 'human', 'narration source'), sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef), binding: parseTtrpgOpenNarrationBindingV1(r.binding), authorizationRef: parseTtrpgOpenSourceRefV1(r.authorizationRef),
      recipientActorKeys: p.keys(r.recipientActorKeys, 'actual human narration recipients', 1000, 1), reason: p.oneOf(r.reason, ['host-authored', 'budget-exhausted', 'model-unavailable', 'replace-candidate'], 'manual narration reason'),
      narration: parseTtrpgOpenKpNarrationV1(r.narration, allowedSourceKeys), allowedSourceKeys,
      basis: { outcome: p.oneOf(basis.outcome, ['automatic', 'critical-success', 'extreme-success', 'hard-success', 'success', 'partial-success', 'failure', 'critical-failure', 'not-public'], 'visible actual result'),
        paidWorldTurns: p.integer(basis.paidWorldTurns, 'paid world turns', 0, 1000000), previousRequests: p.list(basis.previousRequests, 'prior KP attempts', value => {
          const row = p.record(value, ['requestKey', 'status', 'terminalRef', 'responseArtifactHash'], 'prior actual KP request')
          return { requestKey: p.key(row.requestKey, 'prior KP request'), status: p.oneOf(row.status, ['succeeded', 'failed', 'unknown'], 'prior KP terminal status'), terminalRef: parseTtrpgOpenSourceRefV1(row.terminalRef), responseArtifactHash: p.nullable(row.responseArtifactHash, p.hash, 'prior raw response') }
        }, 9) } }
  }
  const hasDelegation = Object.prototype.hasOwnProperty.call(p.object(value,'KP narration receipt'),'hostingDelegationRef')
  const r = p.record(value, ['sourceRef', 'binding', 'requestKey', 'candidateHash', 'rawResponseHash', 'runContractHash', 'inputManifestHash', 'contextHash', 'recipientActorKeys', 'narration', 'allowedSourceKeys',...(hasDelegation ? ['hostingDelegationRef'] : [])], 'KP narration receipt')
  const sourceRef = parseTtrpgOpenSourceRefV1(r.sourceRef),hostingDelegationRef = hasDelegation ? parseTtrpgOpenSourceRefV1(r.hostingDelegationRef) : undefined
  if (hostingDelegationRef && (hostingDelegationRef.sessionKey !== sourceRef.sessionKey || hostingDelegationRef.sequence >= sourceRef.sequence)) p.fail('KP 系统采用必须绑定真实先前委托')
  const allowedSourceKeys = p.keys(r.allowedSourceKeys, 'delivered KP sources', 100000, 1)
  return { ...(hostingDelegationRef ? { hostingDelegationRef } : {}),sourceRef, binding: parseTtrpgOpenNarrationBindingV1(r.binding), requestKey: p.key(r.requestKey, 'KP request'),
    candidateHash: p.hash(r.candidateHash, 'KP candidate'), rawResponseHash: p.hash(r.rawResponseHash, 'KP raw response'), runContractHash: p.hash(r.runContractHash, 'KP contract'), inputManifestHash: p.hash(r.inputManifestHash, 'KP manifest'), contextHash: p.hash(r.contextHash, 'KP party projection'),
    recipientActorKeys: p.keys(r.recipientActorKeys, 'actual KP recipients', 1000, 1), allowedSourceKeys, narration: parseTtrpgOpenKpNarrationV1(r.narration, allowedSourceKeys) }
}
