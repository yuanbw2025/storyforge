/** Optional additive operation history. Legacy operation bytes stay unchanged. */
import { parseTtrpgOpenSourceRefV1,type TtrpgOpenSourceRefV1 } from './open-coordination'
import * as p from './open-contract-parse'
export interface TtrpgOpenPrivateChoiceBodyV1 {
  kind: 'effect' | 'knowledge'; templateKey: string; actorKey: string
  authorizationEpochKey: string; planHash: string; riskHash: string
  ruleSourceRef: TtrpgOpenSourceRefV1; mechanicalBasisJson: string
  alternatives: Array<{ alternativeKey: string; title: string; lines: string[] }>
}
export interface TtrpgOpenPrivateChoiceDisclosureV1 {
  body: TtrpgOpenPrivateChoiceBodyV1; reviewHash: string; viewerKey: string; sourceRef: TtrpgOpenSourceRefV1
}
export function parseTtrpgOpenPrivateChoiceBodyV1(value: unknown): TtrpgOpenPrivateChoiceBodyV1 {
  const r = p.record(value,['kind','templateKey','actorKey','authorizationEpochKey','planHash','riskHash','ruleSourceRef','mechanicalBasisJson','alternatives'],'private choice body')
  const alternatives = p.list(r.alternatives,'private choice alternatives',value => {
    const a = p.record(value,['alternativeKey','title','lines'],'private choice alternative')
    return { alternativeKey: p.key(a.alternativeKey,'private alternative'),title: p.text(a.title,'private alternative label',300),lines: p.list(a.lines,'private consequence lines',v => p.text(v,'private consequence',2000),100,0) }
  },100,1)
  if (new Set(alternatives.map(a => a.alternativeKey)).size !== alternatives.length) p.fail('保密后果选项重复')
  return { kind: p.oneOf(r.kind,['effect','knowledge'],'private choice kind'),templateKey: p.key(r.templateKey,'private choice template'),actorKey: p.key(r.actorKey,'private choice actor'),
    authorizationEpochKey: p.key(r.authorizationEpochKey,'private choice epoch'),planHash: p.hash(r.planHash,'private choice plan'),riskHash: p.hash(r.riskHash,'private choice risk'),
    ruleSourceRef: parseTtrpgOpenSourceRefV1(r.ruleSourceRef),mechanicalBasisJson: p.text(r.mechanicalBasisJson,'private choice mechanical basis',8_000_000),alternatives }
}
export function parseTtrpgOpenPrivateChoiceDisclosureV1(value: unknown): TtrpgOpenPrivateChoiceDisclosureV1 {
  const r = p.record(value,['body','reviewHash','viewerKey','sourceRef'],'private choice disclosure')
  return { body: parseTtrpgOpenPrivateChoiceBodyV1(r.body),reviewHash: p.hash(r.reviewHash,'private disclosure hash'),viewerKey: p.key(r.viewerKey,'private disclosure viewer'),sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef) }
}
