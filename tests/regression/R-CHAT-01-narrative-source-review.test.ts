import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedNarrativeRelationReleaseV4} from '../helpers/narrative-release-fixture'
import {characterChatBaselineInput} from '../helpers/character-chat-baseline'
import {createChatDraftV2, selectChatWorldV1, saveChatDraftV1, loadChatSourceProjectionV1,
  confirmChatSourceReviewV1} from '../../src/lib/character-interaction/draft-service'
import {DEFAULT_CHAT_SETTINGS_V2, parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {loadChatBackgroundOptionsV1} from '../../src/lib/character-interaction/background-source'
import {chatProjectionResourcesV1, createChatSourceProjectionDraftV1, readPreparedChatSourceProjectionViewV1,
  type ChatSourceReviewV1} from '../../src/lib/character-interaction/source-projection'
import {loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2} from '../../src/lib/product-production/world-source'
import {draftProductProductionBriefV3, suggestProductStartingPoints} from '../../src/lib/product-production/consultation'
import {createProductProductionSourcePlanV1} from '../../src/lib/product-production/source-contracts'
import {compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {createInitialInteractionState} from '../../src/lib/character-interaction/runtime'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

it('reviews exact v4 sources and retains the same projection and visibility under a frozen production plan', async () => {
  const world = await seedNarrativeRelationReleaseV4({explicitEntityEvidence: true})
  const {scope} = await createChatDraftV2('新版世界来源确认')
  const linked = await selectChatWorldV1(scope, 0, world.release.id!)
  const index = await loadProductProductionConsultationSourceV2({scope, worldReleaseId: linked.worldReleaseId!, productType: 'character-interaction'})
  const keys = index.selectionOptions.characters.map(row => row.resourceKey)
  const background = await loadChatBackgroundOptionsV1(scope, linked.worldReleaseId!)
  expect(background).toHaveLength(1)
  expect(background[0].resourceKind).toBe('relation')
  expect(background.some(row => keys.includes(row.resourceKey))).toBe(false)
  const settings = {...DEFAULT_CHAT_SETTINGS_V2, mode: 'multi' as const, playerRole: '修桥见证人',
    characters: keys.map(sourceKey => ({sourceKey, voiceRules: '', privateKnowledge: '', initialTrust: 0})),
    backgroundResourceKeys: background.map(row => row.resourceKey)}
  const draft = await saveChatDraftV1(scope, linked.revision, settings)
  const projection = await loadChatSourceProjectionV1(scope, draft.revision)
  expect(projection.characters).toHaveLength(2)
  expect(projection.background![0].relatedResourceKeys).toEqual([...keys].sort())
  const name = (key: string) => JSON.parse(projection.characters.find(row => row.resourceKey === key)!.fragments
    .find(fragment => fragment.pointer === '/atom/canonicalLabel')!.valueJson) as string
  expect(chatProjectionResourcesV1(projection).flatMap(row => row.fragments)
    .some(fragment => fragment.pointer === '/authorSource' || fragment.pointer === '/atom/sourceIdentity')).toBe(false)
  const relation = projection.background![0].fragments.find(fragment => fragment.pointer === '/atom/relationType')!
  const review: ChatSourceReviewV1 = {projectionHash: projection.projectionHash,
    classifications: chatProjectionResourcesV1(projection).flatMap(row => row.fragments.map(fragment => ({
      projectionHash: projection.projectionHash, fragmentKey: fragment.fragmentKey,
      purpose: fragment.pointer === '/atom/canonicalLabel' ? 'identity' as const : 'knowledge' as const,
      visibility: row.resourceKey === keys[0] && fragment.pointer === '/atom/canonicalLabel' ? 'public' as const
        : fragment.fragmentKey === relation.fragmentKey ? 'participants' as const : 'author-only' as const,
      audienceKeys: fragment.fragmentKey === relation.fragmentKey ? [keys[0]] : [],
    })))}
  const confirmed = await confirmChatSourceReviewV1(scope, draft.revision, review)
  const starts = await suggestProductStartingPoints({scope, worldReleaseId: confirmed.worldReleaseId!, productType: 'character-interaction'})
  const brief = await draftProductProductionBriefV3({scope, worldReleaseId: confirmed.worldReleaseId!, productType: 'character-interaction',
    suggestionKey: starts.suggestions[0].suggestionKey, characterChat: parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson)),
    playerRole: settings.playerRole, openingSituation: '在渡口讨论修桥约定', visualLevel: 'none', audioLevel: 'none'})
  const sourcePlan = await createProductProductionSourcePlanV1({scope, productionKey: 'chat.v4.source-review', brief})
  expect(sourcePlan.version).toBe(2)
  const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope, worldReleaseId: confirmed.worldReleaseId!, selection: brief.source.selection, sourcePlan})
  expect(sourceCatalog.chatSourceProjection).toEqual(projection)
  const compiled = compileInteractionModulesV1({brief, sourceCatalog, narrative: characterChatBaselineInput().narrative})
  expect(compiled.profiles.find(row => row.characterKey === keys[0])!.name).toBe(name(keys[0]))
  expect(compiled.profiles.find(row => row.characterKey === keys[1])!.name).toMatch(/^角色 /)
  expect(JSON.stringify(compiled)).not.toContain(name(keys[1]))
  expect(compiled.chatSource!.backgroundSources).toEqual([{resourceKey: projection.background![0].resourceKey,
    sourceHash: projection.background![0].sourceHash, resourceKind: 'relation', relatedResourceKeys: [...keys].sort()}])
  expect(compiled.chatSource!.knowledge.find(row => row.source.pointer === relation.pointer)!.audienceKeys)
    .toEqual([compiled.profiles.find(row => row.characterKey === keys[0])!.participantKey])
  expect(() => createInitialInteractionState(compiled)).not.toThrow()

  const input = {worldReferenceHash: projection.worldReferenceHash, worldReleaseHash: projection.worldReleaseHash,
    characterResourceKeys: keys, backgroundResourceKeys: settings.backgroundResourceKeys, resources: sourceCatalog.resources}
  await expect(createChatSourceProjectionDraftV1({...input, resources: structuredClone(input.resources)})).rejects.toThrow('完整读取证据')
  const read = input.resources.find(row => row.descriptor.kind === 'character')!
  const originalValue = structuredClone(read.value)
  ;(read.value.atom as Record<string, unknown>).canonicalLabel = '核验前的篡改'
  const pendingProjection = createChatSourceProjectionDraftV1(input)
  read.value = originalValue
  await expect(pendingProjection).rejects.toThrow('原文与资源证据不一致')
  await expect(createChatSourceProjectionDraftV1({...input, worldReleaseHash: 'f'.repeat(64)})).rejects.toThrow('世界版本不一致')
  await expect(loadProductProductionWorldSourceCatalogV2({scope, worldReleaseId: confirmed.worldReleaseId!,
    selection: {...brief.source.selection, version: 1}, sourcePlan})).rejects.toThrow('版本或产品不一致')

  const confirmedSettings = parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson))
  if (confirmedSettings.version === 1) throw new Error('Background source review requires version 2 or later')
  const changed = await saveChatDraftV1(scope, confirmed.revision, {...confirmedSettings, backgroundResourceKeys: []})
  expect(JSON.parse(changed.settingsJson).sourceReview).toBeNull()
  const nextProjection = await loadChatSourceProjectionV1(scope, changed.revision)
  expect(() => readPreparedChatSourceProjectionViewV1({draft: nextProjection, review, viewerKey: 'player'})).toThrow('重新检查')
  expect((await db.worldReleases.get(confirmed.worldReleaseId!))!.contentHash).toBe(world.release.contentHash)
})
