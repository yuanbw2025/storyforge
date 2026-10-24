import {seedChatBackgroundSourceFixture} from './chat-background-source'
import {confirmChatSourceReviewV1, readChatDraftV1} from '../../src/lib/character-interaction/draft-service'
import {parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {draftProductProductionBriefV3, suggestProductStartingPoints} from '../../src/lib/product-production/consultation'
import {loadProductProductionWorldSourceCatalogV2} from '../../src/lib/product-production/world-source'
import {characterChatBaselineInput} from './character-chat-baseline'
import type {ChatRoleProfileCandidateV1} from '../../src/lib/character-interaction/role-profile'

export async function seedChatRoleProfileFixture() {
  const f = await seedChatBackgroundSourceFixture()
  const actor = f.projection.characters.find(row => row.label === '林舟')!
  const personality = actor.fragments.find(row => row.pointer === '/personality')!
  const background = actor.fragments.find(row => row.pointer === '/background')!
  for (const decision of f.review.classifications) if ([personality.fragmentKey, background.fragmentKey].includes(decision.fragmentKey)) {
    decision.visibility = 'participants'; decision.audienceKeys = [actor.resourceKey]
    decision.purpose = decision.fragmentKey === personality.fragmentKey ? 'motivation' : 'knowledge'
  }
  const draft = await confirmChatSourceReviewV1(f.scope, f.draft.revision, f.review)
  const request = {draftRevision: draft.revision, projectionHash: f.projection.projectionHash, actorKey: actor.resourceKey, fragmentKeys: [personality.fragmentKey, background.fragmentKey]}
  const candidate: ChatRoleProfileCandidateV1 = {traits: [{kind: 'value', text: '做判断时保持谨慎；立场不会轻易改变。', evidence: [{fragmentKey: personality.fragmentKey, quote: '谨慎而固执'}]}]}
  return {...f, actor, personality, background, draft, request, candidate}
}

export async function chatRoleProfileCompilerInput(scope: Awaited<ReturnType<typeof seedChatRoleProfileFixture>>['scope']) {
  const draft = await readChatDraftV1(scope), settings = parseChatAuthoringSettings(JSON.parse(draft.settingsJson))
  const suggestions = await suggestProductStartingPoints({scope, worldReleaseId: draft.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope, worldReleaseId: draft.worldReleaseId!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'character-interaction', characterChat: settings, playerRole: settings.playerRole, openingSituation: '修理潮汐钟', visualLevel: 'none', audioLevel: 'none'})
  const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope, worldReleaseId: draft.worldReleaseId!, selection: brief.source.selection})
  const narrative = characterChatBaselineInput().narrative
  narrative.beats[0].speakerKey = settings.characters[0].sourceKey
  return {brief, sourceCatalog, narrative}
}
