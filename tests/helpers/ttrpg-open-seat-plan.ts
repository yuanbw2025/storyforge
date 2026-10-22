/** Explicit isolated input, not real author approval or an actor store. */
import type { TtrpgAuthoringSettingsV2 } from '../../src/lib/ttrpg/authoring-contract-v2'
import type { TtrpgOpenApprovalActorV1 } from '../../src/lib/ttrpg/open-contract'
import { proposeTtrpgOpenAuthoringSeatPlanV1 } from '../../src/lib/ttrpg/open-authoring-seat-plan'
import { openCampaignFixture } from './ttrpg-open-content'

export function withOpenAuthoringSeatPlanFixtureV1(settings: Extract<TtrpgAuthoringSettingsV2, { runFormat: 'open' }>,
  characters: readonly TtrpgOpenApprovalActorV1[] = openCampaignFixture().characterTemplates) {
  return { ...structuredClone(settings), authoringSeatPlan: proposeTtrpgOpenAuthoringSeatPlanV1({ seats: settings.wizard.seats,
    previous: { schema: 'storyforge.ttrpg-open-authoring-seat-plan', version: 1, seats: characters.filter(character => character.role === 'player').map(character => {
      if (character.seatKey == null || !['human', 'ai', 'open'].includes(character.controller)) throw new Error('fixture must use author-selectable seats')
      return { seatKey: character.seatKey, characterKey: character.characterKey, controller: character.controller as 'human' | 'ai' | 'open' }
    }) } }) }
}
