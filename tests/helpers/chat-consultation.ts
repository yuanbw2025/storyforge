import {seedChatNarrativeProductionFixture} from './chat-narrative-production-fixture'
import type {ChatConsultationRequestV2} from '../../src/lib/character-interaction/consultation-context'
import type {ChatPlanCandidateV1} from '../../src/lib/character-interaction/consultation-plan'

export async function seedChatConsultationFixtureV2() {
  const f = await seedChatNarrativeProductionFixture({privateCast: 'mixed'})
  const fragment = f.sourceCatalog.chatSourceProjection!.characters.find(c => c.origin === 'product-private')!.fragments.find(f => f.pointer === '/background')!
  const request: ChatConsultationRequestV2 = {draftRevision: f.confirmed.revision, question: '让苏禾有可以自己推进、也能接受玩家拒绝的开场。', priorRunId: null,
    source: {draftRevision: f.confirmed.revision, projectionHash: f.settings.sourceReview!.projectionHash, fragmentKeys: [fragment.fragmentKey]}}
  const candidate: ChatPlanCandidateV1 = {answer: '苏禾已有修钟的愿望。可提议雨天接到修理委托，由她自己检查，旅人可以只看书。', changes: [
    {field: 'openingSituation', value: '雨天，苏禾想修好店里的旧钟；她可以自己检查，旅人也可提出另一种办法或只看书。', reason: '保留她的愿望与独立行动空间，不替旅人答应。', basis: 'proposal', evidence: [{fragmentKey: fragment.fragmentKey, quote: '希望修好旧钟，愿意自己检查工具。'}]},
    {field: 'playerRole', value: '来借书的旅人，还没有答应参与修理。', reason: '供作者选择的虚构身份。', basis: 'proposal', evidence: []},
  ]}
  return {...f, request, candidate}
}
