/** Ephemeral human review; no model artifact, stored authority or permission is inferred from a hash. */
import type { WorkspaceScope } from '../types'
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { parseTtrpgOpenOracleFactProposalV1, type TtrpgOpenOracleFactProposalV1 } from './open-fact-ledger'
import * as p from './open-contract-parse'

export const TTRPG_FACT_PREDICATE_LABELS_V1 = { exists: '存在', 'located-at': '位于', owns: '拥有', knows: '了解',
  'allied-with': '结盟', 'hostile-to': '敌对', owes: '欠有债务', promised: '有承诺', damaged: '受损', destroyed: '已毁坏', blocked: '受阻', open: '开放' }
export const TTRPG_FACT_KIND_LABELS_V1 = { entity: '对象', relation: '关系', state: '状态', 'event-truth': '事件真相', location: '地点', item: '物品' }
export const TTRPG_FACT_AUDIENCE_LABELS_V1 = { 'gm-only': '仅主持', private: '指定角色', party: '本次队伍', public: '公开' }
export const ttrpgOpenFactScalarLabelV1 = (value: string | number | boolean) => typeof value === 'boolean' ? value ? '成立' : '不成立' : String(value)
export type TtrpgOpenFactDeskChangeV1 = { kind: 'assert'; oracleSourceRef: TtrpgOpenSourceRefV1; proposal: TtrpgOpenOracleFactProposalV1;
  referencePolicy: 'release-only-v1' | 'committed-runtime-entities-v1'; candidateHash: string } | { kind: 'retire'; factKey: string; reason: string }
export interface TtrpgOpenFactDeskReviewV1 {
  schema: 'storyforge.ttrpg-open-human-fact-review'; version: 1; scope: WorkspaceScope; sessionId: number; sessionKey: string;
  viewerKey: string; runtimeSourceHash: string; envelope: { commandId: string; baseSequence: number; baseStateHash: string };
  change: TtrpgOpenFactDeskChangeV1; rows: Array<{ label: string; value: string }>; reviewHash: string;
}
export function parseTtrpgOpenFactDeskReviewV1(value: unknown): TtrpgOpenFactDeskReviewV1 {
  const r = p.record(value, ['schema', 'version', 'scope', 'sessionId', 'sessionKey', 'viewerKey', 'runtimeSourceHash', 'envelope', 'change', 'rows', 'reviewHash'], 'human fact review')
  const scope = p.record(r.scope, ['projectId', 'worldId', 'workId'], 'fact review scope'), envelope = p.record(r.envelope, ['commandId', 'baseSequence', 'baseStateHash'], 'fact review command')
  const action = p.object(r.change, 'fact review change')
  let change: TtrpgOpenFactDeskChangeV1
  if (action.kind === 'assert') {
    p.exact(action, ['kind', 'oracleSourceRef', 'proposal', 'referencePolicy', 'candidateHash'], 'fact assertion review')
    change = { kind: 'assert', oracleSourceRef: parseTtrpgOpenSourceRefV1(action.oracleSourceRef), proposal: parseTtrpgOpenOracleFactProposalV1(action.proposal),
      referencePolicy: p.oneOf(action.referencePolicy, ['release-only-v1', 'committed-runtime-entities-v1'], 'fact reference decision'), candidateHash: p.hash(action.candidateHash, 'fact assertion candidate') }
  } else {
    p.exact(action, ['kind', 'factKey', 'reason'], 'fact retirement review')
    change = { kind: p.literal(action.kind, 'retire', 'fact review action'), factKey: p.key(action.factKey, 'retired fact'), reason: p.text(action.reason, 'retirement reason', 1000) }
  }
  return { schema: p.literal(r.schema, 'storyforge.ttrpg-open-human-fact-review', 'fact review schema'), version: p.literal(r.version, 1, 'fact review version'),
    scope: { projectId: p.integer(scope.projectId, 'fact project', 1), worldId: p.integer(scope.worldId, 'fact world', 1), workId: p.integer(scope.workId, 'fact work', 1) },
    sessionId: p.integer(r.sessionId, 'fact session', 1), sessionKey: p.key(r.sessionKey, 'fact session identity'), viewerKey: p.key(r.viewerKey, 'fact human viewer'),
    runtimeSourceHash: p.hash(r.runtimeSourceHash, 'fact runtime source'), envelope: { commandId: p.key(envelope.commandId, 'fact original command'),
      baseSequence: p.integer(envelope.baseSequence, 'fact original sequence'), baseStateHash: p.hash(envelope.baseStateHash, 'fact original state') }, change,
    rows: p.list(r.rows, 'fact review rows', row => { const v = p.record(row, ['label', 'value'], 'fact review row'); return { label: p.text(v.label, 'review label', 200), value: p.text(v.value, 'review text', 2_000_000) } }, 30, 1),
    reviewHash: p.hash(r.reviewHash, 'human fact review digest') }
}
