import {afterEach, beforeEach, expect, it} from 'vitest'
import cases from '../acceptance/character-chat-narrative-cases.json'
import {m1CharacterFieldsV1, m1ScenarioSourceClassificationsV1, assertM1ScenarioSourceFidelityV1} from '../acceptance/character-chat-m1-source'
import {db} from '../../src/lib/db/schema'
import {createWorkspace} from '../../src/lib/workspace/create-workspace'
import {stampNewRecord} from '../../src/lib/workspace/scope'
import {createWorldRevision, publishWorldRevision} from '../../src/lib/world-engine/releases'
import {createChatDraftV3, selectChatWorldV1, saveChatDraftV1, loadChatSourceProjectionV1, confirmChatSourceReviewV1} from '../../src/lib/character-interaction/draft-service'
import {DEFAULT_CHAT_SETTINGS_V3, parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {loadChatBackgroundOptionsV1} from '../../src/lib/character-interaction/background-source'
import {readChatSourceProjectionViewV1} from '../../src/lib/character-interaction/source-projection'
import {loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2} from '../../src/lib/product-production/world-source'
import {suggestProductStartingPoints, draftProductProductionBriefV3} from '../../src/lib/product-production/consultation'
import {prepareChatNarrativeCompilerSourceV1} from '../../src/lib/product-production/product-module-compilers'

const material = cases.scenarios.find(s => s.id === 'inn-missing-seal')!, role = material.roles[0]
// This compound source cannot be disclosed on location evidence alone.
const condition = '角色实际核对柜台下木箱中的铜印，并通过掌柜的明确说明核实由他拿去拓印破损通行单；仅看到铜印位置不能证明持有人与用途，必须满足整条事实的依据。'
beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())

async function prepare(omitHiddenSource = false) {
  const authored = await createWorkspace({name: 'M1 调查来源准入', genres: ['interactive-fiction'], status: 'drafting', description: material.seed, targetWordCount: 10000, enableMultiWorld: false}, {purpose: 'world-engine', kind: 'novel', novelProfile: 'long'}), now = Date.now()
  await db.characters.add(stampNewRecord(authored.scope, 'characters', {projectId: authored.scope.projectId,
    ...m1CharacterFieldsV1(role, material.publicFacts, '被暴雨困在驿站的守卫'), appearance: '', abilities: '', relationships: '', arc: '',
    roleWeight: 'main', moralAxis: 'good', orderAxis: 'neutral', createdAt: now, updatedAt: now}, {owner: 'world'}))
  const categoryId = await db.codexCategories.add(stampNewRecord(authored.scope, 'codexCategories', {projectId: authored.scope.projectId,
    domain: 'humanity', parentId: null, name: '作者背景', builtInKey: 'artifact', fieldSchema: '[]', hidden: false, order: 0, worldGroupId: null, createdAt: now, updatedAt: now}, {owner: 'world'})) as number
  await db.codexEntries.add(stampNewRecord(authored.scope, 'codexEntries', {projectId: authored.scope.projectId, categoryId, name: '驿站既定隐情', summary: '',
    description: material.authorOnlyFacts[0], fields: '{}', refs: '{}', tags: '[]', importance: 5, order: 0, worldGroupId: null, createdAt: now, updatedAt: now}, {owner: 'world'}))
  const revision = await createWorldRevision({scope: authored.scope, label: 'M1 既定真相'}), world = await publishWorldRevision(revision.id!)
  const {scope} = await createChatDraftV3('M1 隐情来源核验'), linked = await selectChatWorldV1(scope, 0, world.id!)
  const index = await loadProductProductionConsultationSourceV2({scope, worldReleaseId: linked.worldReleaseId!})
  const actorResourceKey = index.selectionOptions.characters.find(c => c.label === role.name)!.resourceKey
  const background = (await loadChatBackgroundOptionsV1(scope, linked.worldReleaseId!)).find(r => r.resourceKind === 'codex-entry' && r.label === '驿站既定隐情')!
  const base = structuredClone(DEFAULT_CHAT_SETTINGS_V3)
  const saved = await saveChatDraftV1(scope, linked.revision, {...base, playerRole: '被暴雨困在驿站的旅人', openingSituation: material.seed,
    backgroundResourceKeys: [background.resourceKey], characters: [{sourceKey: actorResourceKey, voiceRules: '', privateKnowledge: '', initialTrust: 0}],
    narrative: {...base.narrative, permissions: {...base.narrative.permissions, maxDiscoveriesPerSituation: 1}}})
  const projection = await loadChatSourceProjectionV1(scope, saved.revision)
  const discoveries = [{resourceKey: background.resourceKey, pointer: '/description', text: material.authorOnlyFacts[0], condition}]
  const classifications = m1ScenarioSourceClassificationsV1(projection, actorResourceKey, omitHiddenSource ? [] : discoveries)
  const confirmed = await confirmChatSourceReviewV1(scope, saved.revision, {projectionHash: projection.projectionHash, classifications})
  const settings = parseChatAuthoringSettings(JSON.parse(confirmed.settingsJson)), starting = await suggestProductStartingPoints({scope, worldReleaseId: linked.worldReleaseId!})
  const brief = await draftProductProductionBriefV3({scope, worldReleaseId: linked.worldReleaseId!, suggestionKey: starting.suggestions[0].suggestionKey,
    productType: 'character-interaction', characterChat: settings, playerRole: settings.playerRole, openingSituation: settings.openingSituation, visualLevel: 'none', audioLevel: 'none'})
  const sourceCatalog = await loadProductProductionWorldSourceCatalogV2({scope, worldReleaseId: linked.worldReleaseId!, selection: brief.source.selection}), compiled = prepareChatNarrativeCompilerSourceV1({brief, sourceCatalog})
  return {world, projection, classifications, input: {source: compiled.content, actorKey: compiled.participantKeys[0], actorResourceKey, role, publicFacts: material.publicFacts, authorOnlyFacts: material.authorOnlyFacts, discoveries}}
}

it('keeps the full authored hidden truth and its discovery authority through the real frozen-world/S2 compiler, with neither role initially knowing it', async () => {
  const f = await prepare(), before = structuredClone(f.input)
  expect(() => assertM1ScenarioSourceFidelityV1(f.input)).not.toThrow()
  const secret = f.input.source.knowledge.find(k => k.discovery)!
  expect(secret.content).toBe(JSON.stringify(material.authorOnlyFacts[0])); expect(secret.audienceKeys).toEqual([])
  expect(secret.discovery!.condition).toBe(condition)
  for (const viewerKey of ['player', f.input.actorResourceKey]) {
    const view = await readChatSourceProjectionViewV1({draft: f.projection, classifications: f.classifications, viewerKey})
    expect(JSON.stringify(view)).not.toContain('木箱'); expect(JSON.stringify(view)).not.toContain('拓印')
  }
  expect(f.input).toEqual(before)
  expect((await db.worldReleases.get(f.world.id!))!.contentHash).toBe(f.world.contentHash)
  expect(await db.agentRuns.count()).toBe(0)
})

it('stops the old actor-only setup before generation because author-only exclusion loses the investigation truth', async () => {
  const f = await prepare(true)
  expect(f.input.source.knowledge.some(k => k.discovery)).toBe(false)
  expect(() => assertM1ScenarioSourceFidelityV1(f.input)).toThrow('既定隐情缺失')
  expect(await db.agentRuns.count()).toBe(0)
})

it('rejects incomplete, leaked, duplicated or weakened truth mappings without altering evidence or calling a model', async () => {
  const f = await prepare()
  for (const kind of ['missing', 'player-knows', 'actor-knows', 'weakened-condition', 'foreign-actor', 'missing-prerequisite', 'wrong-prerequisite', 'public-copy', 'undeclared', 'missing-background', 'wrong-pointer', 'wrong-purpose', 'changed-truth', 'no-declaration', 'no-original-truth', 'duplicate-original', 'missing-name', 'changed-values', 'public-values', 'wrong-values-purpose'] as const) {
    const input = structuredClone(f.input), secret = input.source.knowledge.find(k => k.discovery)!
    if (kind === 'missing') input.source.knowledge = input.source.knowledge.filter(k => k !== secret)
    if (kind === 'player-knows') secret.audienceKeys = ['player']
    if (kind === 'actor-knows') secret.audienceKeys = [input.actorKey]
    if (kind === 'weakened-condition') secret.discovery!.condition = '看见木箱即可'
    if (kind === 'foreign-actor') secret.discovery!.actorKeys = ['other']
    if (kind === 'missing-prerequisite') secret.discovery!.prerequisiteKnowledgeKeys = []
    if (kind === 'wrong-prerequisite') secret.discovery!.prerequisiteKnowledgeKeys = [secret.key]
    if (kind === 'public-copy') input.source.knowledge.push({...structuredClone(secret), key: 'copied', audienceKeys: ['player'], discovery: undefined})
    if (kind === 'undeclared') input.source.knowledge.push({...structuredClone(secret), key: 'extra', content: JSON.stringify('未登记的隐藏答案。')})
    if (kind === 'missing-background') input.source.backgroundSources = []
    if (kind === 'wrong-pointer') secret.source.pointer = '/summary'
    if (kind === 'wrong-purpose') secret.source.purpose = 'motivation'
    if (kind === 'changed-truth') secret.content = JSON.stringify('铜印改放在后门。')
    if (kind === 'no-declaration') input.discoveries = []
    if (kind === 'no-original-truth') input.authorOnlyFacts = []
    if (kind === 'duplicate-original') input.authorOnlyFacts.push(input.authorOnlyFacts[0])
    if (kind === 'missing-name') input.source.knowledge = input.source.knowledge.filter(k => k.source.pointer !== '/name')
    if (kind === 'changed-values') input.source.knowledge.find(k => k.source.pointer === '/personality')!.content = JSON.stringify('不顾证据地怀疑所有人')
    if (kind === 'public-values') input.source.knowledge.find(k => k.source.pointer === '/personality')!.audienceKeys.push('player')
    if (kind === 'wrong-values-purpose') input.source.knowledge.find(k => k.source.pointer === '/personality')!.source.purpose = 'knowledge'
    const before = structuredClone(input)
    expect(() => assertM1ScenarioSourceFidelityV1(input), kind).toThrow('[m1-source-fidelity]'); expect(input).toEqual(before)
  }
  expect(await db.agentRuns.count()).toBe(0)
})

it('rejects missing, changed, duplicate or role-owned discovery resources before source confirmation', async () => {
  const f = await prepare()
  for (const kind of ['foreign', 'wrong-pointer', 'truncated', 'no-condition', 'duplicate', 'role-resource'] as const) {
    const truths = structuredClone(f.input.discoveries)
    if (kind === 'foreign') truths[0].resourceKey = 'absent'
    if (kind === 'wrong-pointer') truths[0].pointer = '/summary'
    if (kind === 'truncated') truths[0].text = '铜印在柜台下的木箱里。'
    if (kind === 'no-condition') truths[0].condition = ''
    if (kind === 'duplicate') truths.push({...truths[0]})
    if (kind === 'role-resource') {truths[0].resourceKey = f.input.actorResourceKey; truths[0].pointer = '/background'; truths[0].text = role.privateFacts.join('；')}
    expect(() => m1ScenarioSourceClassificationsV1(f.projection, f.input.actorResourceKey, truths), kind).toThrow('[m1-source-fidelity]')
  }
  expect(await db.agentRuns.count()).toBe(0)
})
