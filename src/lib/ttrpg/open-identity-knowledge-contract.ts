/** Versioned semantic identity knowledge. It does not amend original F13 scope. */
import { parseTtrpgOpenSourceRefV1, type TtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgOpenAudience, TtrpgOpenEntityKind } from './open-contract'
import * as p from './open-contract-parse'

export interface TtrpgOpenIdentityKnowledgeRequestV1 {
  mode: 'observation' | 'share'; actorKey: string | null; sourceKnowledgeKey: string
  entityRefs: string[]; audience: Exclude<TtrpgOpenAudience, 'gm-only'>; recipientActorKeys: string[]
}
export interface TtrpgOpenLearnedIdentityV1 {
  entityRef: string; kind: TtrpgOpenEntityKind; name: string
  sourceRef: TtrpgOpenSourceRefV1; operationKey: string; planHash: string
}
export interface TtrpgOpenKnowledgeIdentityGrantV1 {
  schema: 'storyforge.ttrpg-open-knowledge-identities'; version: 1; mode: TtrpgOpenIdentityKnowledgeRequestV1['mode']
  runtimeSourceHash: string; rulePackContentHash: string
  sourceKnowledgeKey: string; sourceAcquisitionRef: TtrpgOpenSourceRefV1; sourceKnowledgeHash: string
  viewerKey: string; actorKey: string | null; authorizationRef: TtrpgOpenSourceRefV1; authorizationEpochKey: string
  submissionKey: string; baseStateHash: string; confirmationHash: string; identities: TtrpgOpenLearnedIdentityV1[]
}
const entityRef = (value: unknown, label: string) => {
  const key = p.key(value, label)
  if (!/^entity\.[a-f0-9]{48}(?:\.equipment\.(?:0|[1-9][0-9]*))?$/.test(key)) p.fail('已知身份必须引用原已创建的运行实例')
  return key
}
export function parseTtrpgOpenIdentityKnowledgeRequestV1(value: unknown): TtrpgOpenIdentityKnowledgeRequestV1 {
  const row = p.record(value, ['mode', 'actorKey', 'sourceKnowledgeKey', 'entityRefs', 'audience', 'recipientActorKeys'], 'identity knowledge request')
  const mode = p.oneOf(row.mode, ['observation', 'share'], 'identity knowledge mode'), audience = p.oneOf(row.audience, ['private', 'party', 'public'], 'identity knowledge audience')
  const actorKey = p.nullable(row.actorKey, p.key, 'identity knowledge actor'), recipientActorKeys = p.keys(row.recipientActorKeys, 'identity knowledge recipients', 1000, audience === 'public' ? 0 : 1)
  const entityRefs = p.list(row.entityRefs, 'learned identity references', value => entityRef(value, 'learned entity'), 20, 1)
  p.unique(entityRefs, 'learned identities')
  if (mode === 'share' && actorKey === null || audience === 'public' && recipientActorKeys.length) p.fail('身份分享需要准确角色，公开知识不伪装私密接收者列表')
  return { mode, actorKey, sourceKnowledgeKey: p.key(row.sourceKnowledgeKey, 'identity knowledge source'), entityRefs, audience, recipientActorKeys }
}
export function parseTtrpgOpenKnowledgeIdentityGrantV1(value: unknown): TtrpgOpenKnowledgeIdentityGrantV1 {
  const row = p.record(value, ['schema', 'version', 'mode', 'runtimeSourceHash', 'rulePackContentHash', 'sourceKnowledgeKey', 'sourceAcquisitionRef', 'sourceKnowledgeHash',
    'viewerKey', 'actorKey', 'authorizationRef', 'authorizationEpochKey', 'submissionKey', 'baseStateHash', 'confirmationHash', 'identities'], 'identity knowledge grant')
  const identities = p.list(row.identities, 'learned identity records', value => {
    const r = p.record(value, ['entityRef', 'kind', 'name', 'sourceRef', 'operationKey', 'planHash'], 'learned identity')
    return { entityRef: entityRef(r.entityRef, 'learned entity'), kind: p.oneOf(r.kind, ['actor', 'location', 'item'], 'learned entity kind'), name: p.text(r.name, 'learned identity name', 1000),
      sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef), operationKey: p.key(r.operationKey, 'original identity operation'), planHash: p.hash(r.planHash, 'original identity plan') }
  }, 20, 1)
  p.unique(identities.map(r => r.entityRef), 'learned identity records')
  if (identities.some((r, i) => i > 0 && identities[i - 1].entityRef >= r.entityRef)) p.fail('已知身份须保留规范顺序')
  return { schema: p.literal(row.schema, 'storyforge.ttrpg-open-knowledge-identities', 'identity knowledge schema'), version: p.literal(row.version, 1, 'identity knowledge version'),
    mode: p.oneOf(row.mode, ['observation', 'share'], 'identity knowledge mode'), runtimeSourceHash: p.hash(row.runtimeSourceHash, 'identity runtime source'), rulePackContentHash: p.hash(row.rulePackContentHash, 'identity rules'),
    sourceKnowledgeKey: p.key(row.sourceKnowledgeKey, 'identity knowledge source'), sourceAcquisitionRef: parseTtrpgOpenSourceRefV1(row.sourceAcquisitionRef), sourceKnowledgeHash: p.hash(row.sourceKnowledgeHash, 'original knowledge hash'),
    viewerKey: p.key(row.viewerKey, 'identity knowledge viewer'), actorKey: p.nullable(row.actorKey, p.key, 'identity knowledge actor'), authorizationRef: parseTtrpgOpenSourceRefV1(row.authorizationRef), authorizationEpochKey: p.key(row.authorizationEpochKey, 'identity knowledge window'),
    submissionKey: p.key(row.submissionKey, 'identity knowledge submission'), baseStateHash: p.hash(row.baseStateHash, 'identity review basis'), confirmationHash: p.hash(row.confirmationHash, 'identity review confirmation'), identities }
}
