import {seedChatBackgroundSourceFixture} from './chat-background-source'
import {DEFAULT_CHAT_SETTINGS_V3} from '../../src/lib/character-interaction/authoring-contract'
import {saveChatDraftV1, loadChatSourceProjectionV1} from '../../src/lib/character-interaction/draft-service'
import type {ChatSourceUnitsCandidateV1, ChatSourceUnitsReviewV1} from '../../src/lib/character-interaction/source-units'

/** Synthetic engineering fixture, never a replacement for the retained V97 source/cohort. */
export const SOURCE_UNITS_FIXTURE_TEXT = '铜印被掌柜拿去拓印破损的通行单，放在柜台下的木箱里；守卫和玩家起初都不知道。'
export async function seedChatSourceUnitsFixture() {
  const f = await seedChatBackgroundSourceFixture({entries: {
    // Force existing lossless structural projection down to individual fields.
    seal: {historicalAnchors: SOURCE_UNITS_FIXTURE_TEXT, fictionalAdaptations: '本轮不选择的港口记录。'.repeat(700), priority: 'fictional'},
  }})
  const settings = {...f.settings, version: 3 as const, narrative: structuredClone(DEFAULT_CHAT_SETTINGS_V3.narrative)}
  const draft = await saveChatDraftV1(f.scope, f.draft.revision, settings)
  const projection = await loadChatSourceProjectionV1(f.scope, draft.revision)
  const fragment = projection.background!.flatMap(row => row.fragments).find(row => row.valueJson === JSON.stringify(SOURCE_UNITS_FIXTURE_TEXT))!
  if (!fragment) throw new Error('Missing source-unit fixture passage')
  const request = {draftRevision: draft.revision, projectionHash: projection.projectionHash, fragmentKeys: [fragment.fragmentKey]}
  const candidate: ChatSourceUnitsCandidateV1 = {fragments: [{fragmentKey: fragment.fragmentKey, facts: [
    {key: 'location', text: '铜印放在柜台下的木箱里。', quotes: ['铜印被掌柜拿去拓印破损的通行单，放在柜台下的木箱里']},
    {key: 'handler', text: '铜印被掌柜拿走。', quotes: ['铜印被掌柜拿去拓印破损的通行单']},
    {key: 'purpose', text: '掌柜拿走铜印是为了拓印破损的通行单。', quotes: ['铜印被掌柜拿去拓印破损的通行单']},
  ], constraints: [{key: 'initial-knowledge', text: '守卫和玩家起初都不知道原文中的铜印去向、经手者与用途。', quotes: ['守卫和玩家起初都不知道']}]}]}
  return {...f, settings, draft, projection, fragment, request, candidate}
}
/** Schema/transport fixture only. A scripted affirmative report is not semantic/model acceptance. */
export function sourceUnitsReviewFixture(candidate: ChatSourceUnitsCandidateV1): ChatSourceUnitsReviewV1 {
  return {fragments: candidate.fragments.map(row => ({fragmentKey: row.fragmentKey, complete: true, reason: '工程夹具：模拟完整复核报告。',
    facts: row.facts.map(item => ({key: item.key, faithful: true, atomic: true, standalone: true, established: true, reason: '工程夹具：模拟逐项检查。'})),
    constraints: row.constraints.map(item => ({key: item.key, faithful: true, reason: '工程夹具：模拟限制检查。'}))}))}
}
