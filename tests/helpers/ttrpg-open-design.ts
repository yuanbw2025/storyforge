/** Isolated engineering input; no provider or real author acceptance. */
import type { ChatMessage } from '../../src/lib/types'
import { createFreshOpenDraftFixtureV1 } from './open-ttrpg-fresh-authoring'
import { openCampaignFixture } from './ttrpg-open-content'
import { saveTtrpgDraft, saveTtrpgSourceSelection } from '../../src/lib/ttrpg/authoring-service'
import { suggestProductStartingPoints } from '../../src/lib/product-production/consultation'

export const openDesignRequestFixture = { schema: 'storyforge.ttrpg-open-authoring-design-request', version: 1,
  instruction: '请提供三种不同的调查压力节奏', sections: ['pressure'] }
export async function createSavedOpenDesignFixtureV1() {
  const f = await createFreshOpenDraftFixtureV1(), settings = structuredClone(f.settings)
  settings.openAuthoring = { ...settings.openAuthoring, factPolicy: [], situationTemplates: [], openingSituationKeys: [],
    effectPlanTemplates: [], pressure: { clocks: [], fronts: [] }, dynamicEntityTemplates: [] }
  let draft = await saveTtrpgDraft(f.scope, f.draft.revision, settings, '作者保留的战役名称')
  const starts = await suggestProductStartingPoints({ scope: f.scope, worldReleaseId: draft.worldReleaseId! })
  const choice = starts.suggestions.find(item => item.recommendedProductTypes.includes('ttrpg'))!
  draft = await saveTtrpgSourceSelection(f.scope, draft.revision, choice.suggestionKey, starts.selectionDefaults[choice.suggestionKey])
  return { ...f, settings, draft, revision: draft.revision, request: openDesignRequestFixture }
}
export function openDesignResponseFixtureV1(messages: ChatMessage[]) {
  const match = messages[1].content.match(/【实际读取资源闭集】([^\n]+)/)
  if (!match) throw new Error('fixture requires actual read keys')
  const keys = JSON.parse(match[1]), campaign = openCampaignFixture()
  return JSON.stringify({ schema: 'storyforge.ttrpg-open-authoring-design-proposals', version: 1, proposals: [0, 1, 2].map(index => ({
    proposalKey: `design.${index}`, title: `候选标题${index}不能重命名作品`, pitch: '依据本次来源起草的工程候选', patch: {
      pressure: { clocks: campaign.clocks.map(clock => ({ ...structuredClone(clock), maximum: 12 + index * 2, sourceRefs: [keys[0]] })),
        fronts: campaign.fronts.map(front => ({ ...structuredClone(front), sourceRefs: [keys[0]] })) },
    },
  })) })
}
