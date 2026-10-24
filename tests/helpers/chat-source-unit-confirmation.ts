import {seedChatSourceUnitsFixture, sourceUnitsReviewFixture} from './chat-source-units'
import {saveChatDraftV1, confirmChatSourceReviewV1} from '../../src/lib/character-interaction/draft-service'
import {parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import type {ChatSourceUnitPermissionV1, ChatSourceUnitAuthorizationReviewV1} from '../../src/lib/character-interaction/source-unit-authorization'
import type {ChatSourceUnitsCandidateV1} from '../../src/lib/character-interaction/source-units'

export async function seedChatSourceUnitConfirmationFixture() {
  const f = await seedChatSourceUnitsFixture()
  const settings = {...f.settings, openingSituation: '柜台上常放的铜印不见了。', narrative: {...f.settings.narrative,
    permissions: {...f.settings.narrative.permissions, allowActorSituationExpansion: true, maxDiscoveriesPerSituation: 2}}}
  const saved = await saveChatDraftV1(f.scope, f.draft.revision, settings)
  const review = structuredClone(f.review)
  const original = review.classifications.find(row => row.fragmentKey === f.fragment.fragmentKey)!
  original.visibility = 'author-only'; original.purpose = 'knowledge'; original.audienceKeys = []; delete original.discovery
  const draft = await confirmChatSourceReviewV1(f.scope, saved.revision, review)
  const prerequisite = review.classifications.find(row => row.visibility === 'public' && row.purpose === 'knowledge')!
  const source = {...f.request, draftRevision: draft.revision}
  const permissions: ChatSourceUnitPermissionV1[] = f.candidate.fragments.flatMap(row => row.facts.map(fact => ({fragmentKey: row.fragmentKey, unitKey: fact.key, audienceKeys: [],
    ...(fact.key === 'location' ? {discovery: {actorKeys: [f.keys[0]], condition: '角色实际打开并查看柜台下木箱，核对其中的铜印；不证明经手者和用途。', prerequisiteFragmentKeys: [prerequisite.fragmentKey]}} : {})})))
  return {...f, draft, settings: parseChatAuthoringSettings(JSON.parse(draft.settingsJson)), request: {source, candidate: f.candidate, permissions}, permissions}
}
/** Scripted affirmative schema report, not real semantic acceptance. */
export function sourceUnitAuthorizationReportFixture(candidate: ChatSourceUnitsCandidateV1, permissions: ChatSourceUnitPermissionV1[]): ChatSourceUnitAuthorizationReviewV1 {
  return {interpretation: sourceUnitsReviewFixture(candidate), permissions: permissions.map(row => ({fragmentKey: row.fragmentKey, unitKey: row.unitKey, initialKnowledgeFaithful: true, discoverySupported: true, reason: '工程模拟逐项权限报告'}))}
}
