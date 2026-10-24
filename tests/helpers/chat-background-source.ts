import {seedCurrentProductWorld} from './current-product-world'
import {createChatDraftV2, selectChatWorldV1, saveChatDraftV1, loadChatSourceProjectionV1, confirmChatSourceReviewV1} from '../../src/lib/character-interaction/draft-service'
import {DEFAULT_CHAT_SETTINGS_V2, parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {loadChatBackgroundOptionsV1} from '../../src/lib/character-interaction/background-source'
import {chatProjectionResourcesV1, type ChatSourceReviewV1} from '../../src/lib/character-interaction/source-projection'
import {loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2} from '../../src/lib/product-production/world-source'
import {draftProductProductionBriefV3, suggestProductStartingPoints} from '../../src/lib/product-production/consultation'
import {compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {characterChatBaselineInput} from './character-chat-baseline'

export function chatStructuredWorldRulesFixture() {
  return {
    entries: {
      'harbor/public': {historicalAnchors: '潮门每天由当班守灯人检查。\n'.repeat(600), fictionalAdaptations: '末段规则：蓝铃响起时先检查水尺。', priority: 'fictional' as const},
      'harbor/private': {historicalAnchors: '作者秘密：旧船舱里保存着失踪船队的名册。', fictionalAdaptations: '', priority: 'fictional' as const},
      constructor: {historicalAnchors: '同名自定义条目仍须作者单独确认。', fictionalAdaptations: '', priority: 'fictional' as const},
    },
    customNodes: Array.from({length: 12}, (_, i) => ({id: `harbor-${i}`, parentId: null, label: `港口约定 ${i}`,
      hints: ['日常安排需先查看值班记录。'.repeat(50), i === 11 ? '末项线索：晚班记录放在蓝色柜中。' : `保留原序号 ${i}`]})),
  }
}

export async function seedChatBackgroundSourceFixture(worldRules?: NonNullable<Parameters<typeof seedCurrentProductWorld>[1]>['worldRules']) {
  const world = await seedCurrentProductWorld('CHAT-BACKGROUND', {worldRules})
  const {scope} = await createChatDraftV2('世界背景资料工程夹具')
  const linked = await selectChatWorldV1(scope, 0, world.release.id!)
  const index = await loadProductProductionConsultationSourceV2({scope, worldReleaseId: linked.worldReleaseId!})
  const keys = index.selectionOptions.characters.map(c => c.resourceKey)
  const options = await loadChatBackgroundOptionsV1(scope, linked.worldReleaseId!)
  const settings = {...DEFAULT_CHAT_SETTINGS_V2, mode: 'multi' as const, playerRole: '学徒沈禾',
    characters: keys.map(sourceKey => ({sourceKey, voiceRules: '', privateKnowledge: '', initialTrust: 0})),
    backgroundResourceKeys: options.filter(o => ['location', 'codex-entry', 'character-relation', 'story-core', 'world-rules'].includes(o.resourceKind)).map(o => o.resourceKey)}
  const draft = await saveChatDraftV1(scope, linked.revision, settings)
  const projection = await loadChatSourceProjectionV1(scope, draft.revision)
  const review: ChatSourceReviewV1 = {projectionHash: projection.projectionHash, classifications: chatProjectionResourcesV1(projection).flatMap(resource => resource.fragments.map(f => {
    const kind = projection.background?.find(r => r.resourceKey === resource.resourceKey)?.resourceKind
    const visibility = kind === 'location' || (!kind && f.pointer === '/name') ? 'public' : kind === 'codex-entry' ? 'participants' : kind === 'character-relation' ? 'author-only' : 'unclassified'
    return {projectionHash: projection.projectionHash, fragmentKey: f.fragmentKey, purpose: 'knowledge' as const, visibility,
      audienceKeys: visibility === 'participants' ? [keys[0]] : []}
  }))}
  return {world, scope, keys, options, draft, settings, projection, review}
}

export async function compileChatBackgroundSourceFixture(input: Awaited<ReturnType<typeof seedChatBackgroundSourceFixture>>) {
  const confirmed = await confirmChatSourceReviewV1(input.scope, input.draft.revision, input.review)
  const settings = parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson))
  const start = await suggestProductStartingPoints({scope: input.scope, worldReleaseId: confirmed.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope: input.scope, worldReleaseId: confirmed.worldReleaseId!, suggestionKey: start.suggestions[0].suggestionKey,
    productType: 'character-interaction', characterChat: settings, playerRole: settings.playerRole, openingSituation: '共同修理潮汐钟', visualLevel: 'none', audioLevel: 'none'})
  const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope: input.scope, worldReleaseId: confirmed.worldReleaseId!, selection: brief.source.selection})
  const narrative = characterChatBaselineInput().narrative
  narrative.beats[0].speakerKey = input.keys[0]
  const compilerInput = {brief, sourceCatalog, narrative}
  return {confirmed, settings, compilerInput, compiled: compileInteractionModulesV1(compilerInput)}
}
