import {afterEach, beforeEach, expect, it} from 'vitest'
import cases from '../acceptance/character-chat-narrative-cases.json'
import {m1CharacterFieldsV1, m1ActorSourceClassificationsV1, assertM1ActorSourceFidelityV1, assertM1ScenarioSourceFidelityV1} from '../acceptance/character-chat-m1-source'
import {db} from '../../src/lib/db/schema'
import {createWorkspace} from '../../src/lib/workspace/create-workspace'
import {stampNewRecord} from '../../src/lib/workspace/scope'
import {createWorldRevision, publishWorldRevision} from '../../src/lib/world-engine/releases'
import {createChatDraftV3, selectChatWorldV1, saveChatDraftV1, loadChatSourceProjectionV1, confirmChatSourceReviewV1} from '../../src/lib/character-interaction/draft-service'
import {DEFAULT_CHAT_SETTINGS_V3, parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2} from '../../src/lib/product-production/world-source'
import {suggestProductStartingPoints, draftProductProductionBriefV3} from '../../src/lib/product-production/consultation'
import {prepareChatNarrativeCompilerSourceV1} from '../../src/lib/product-production/product-module-compilers'

const material = cases.scenarios.find(s => s.id === 'daily-clock-promise')!, role = material.roles[0]
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

async function prepare(legacyMixed = false) {
  const authored = await createWorkspace({name: 'M1 来源语义验证', genres: ['interactive-fiction'], status: 'drafting', description: material.seed, targetWordCount: 10000, enableMultiWorld: false}, {purpose: 'world-engine', kind: 'novel', novelProfile: 'long'})
  const details = m1CharacterFieldsV1(role, material.publicFacts, '邻居，经营修理铺的修钟人'), now = Date.now()
  if (legacyMixed) {details.background = [...role.goals.map(g => '目标：' + g), ...role.privateFacts].join('；'); details.goals = ''}
  await db.characters.add(stampNewRecord(authored.scope, 'characters', {projectId: authored.scope.projectId, ...details,
    appearance: '', abilities: '', relationships: '', arc: '', roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral', createdAt: now, updatedAt: now}, {owner: 'world'}))
  const revision = await createWorldRevision({scope: authored.scope, label: 'M1 来源语义'}), world = await publishWorldRevision(revision.id!)
  const {scope} = await createChatDraftV3('M1 仅来源验证'), linked = await selectChatWorldV1(scope, 0, world.id!)
  const index = await loadProductProductionConsultationSourceV2({scope, worldReleaseId: linked.worldReleaseId!}), actorResourceKey = index.selectionOptions.characters.find(c => c.label === role.name)!.resourceKey
  const saved = await saveChatDraftV1(scope, linked.revision, {...structuredClone(DEFAULT_CHAT_SETTINGS_V3), playerRole: '旧钟的主人沈禾', openingSituation: material.seed,
    characters: [{sourceKey: actorResourceKey, voiceRules: '', privateKnowledge: '', initialTrust: 0}]})
  const projection = await loadChatSourceProjectionV1(scope, saved.revision), classifications = m1ActorSourceClassificationsV1(projection, actorResourceKey)
  if (legacyMixed) for (const row of classifications) if (projection.characters[0].fragments.some(f => f.fragmentKey === row.fragmentKey && f.pointer === '/background')) row.purpose = 'motivation'
  const confirmed = await confirmChatSourceReviewV1(scope, saved.revision, {projectionHash: projection.projectionHash, classifications})
  const settings = parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson)), starting = await suggestProductStartingPoints({scope, worldReleaseId: linked.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope, worldReleaseId: linked.worldReleaseId!, suggestionKey: starting.suggestions[0].suggestionKey,
    productType: 'character-interaction', characterChat: settings, playerRole: settings.playerRole, openingSituation: settings.openingSituation, visualLevel: 'none', audioLevel: 'none'})
  const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope, worldReleaseId: linked.worldReleaseId!, selection: brief.source.selection}), compiled = prepareChatNarrativeCompilerSourceV1({brief, sourceCatalog})
  return {world, scope, input: {source: compiled.content, actorKey: compiled.participantKeys[0], actorResourceKey, role, publicFacts: material.publicFacts}}
}

it('preserves factual private material and separate intentions through real frozen-world/S2 compilation before any model call', async () => {
  const f = await prepare(), before = structuredClone(f.input.source)
  expect(() => assertM1ActorSourceFidelityV1(f.input)).not.toThrow()
  expect(() => assertM1ScenarioSourceFidelityV1({...f.input, authorOnlyFacts: material.authorOnlyFacts, discoveries: []})).not.toThrow()
  expect(f.input.source).toEqual(before)
  expect((await db.worldReleases.get(f.world.id!))!.contentHash).toBe(f.world.contentHash)
  expect(await db.agentRuns.count()).toBe(0)
})

it('rejects the actual mixed background/motivation failure even though the private-fact bytes survive compilation', async () => {
  const f = await prepare(true)
  expect(JSON.stringify(f.input.source)).toContain(role.privateFacts[0])
  expect(() => assertM1ActorSourceFidelityV1(f.input)).toThrow('语义用途错误')
  expect(await db.agentRuns.count()).toBe(0)
})

it('rejects leaked, absent, recast or foreign material without widening product authority or altering the source', async () => {
  const f = await prepare()
  for (const kind of ['leak', 'missing', 'intent-as-fact', 'fact-as-intent', 'foreign-actor', 'public-copy'] as const) {
    const input = structuredClone(f.input), privateFact = input.source.knowledge.find(k => k.source.pointer === '/background')!
    if (kind === 'leak') privateFact.audienceKeys.push('player')
    if (kind === 'missing') input.source.knowledge = input.source.knowledge.filter(k => k !== privateFact)
    if (kind === 'intent-as-fact') input.source.knowledge.find(k => k.source.pointer === '/goals')!.source.purpose = 'knowledge'
    if (kind === 'fact-as-intent') privateFact.source.purpose = 'motivation'
    if (kind === 'foreign-actor') input.actorResourceKey = 'world-release:character:unselected'
    if (kind === 'public-copy') input.source.knowledge.push({...structuredClone(privateFact), key: 'copied-secret', audienceKeys: ['player']})
    const before = structuredClone(input)
    expect(() => assertM1ActorSourceFidelityV1(input), kind).toThrow('[m1-source-fidelity]')
    expect(input).toEqual(before)
  }
  expect(await db.agentRuns.count()).toBe(0)
})
