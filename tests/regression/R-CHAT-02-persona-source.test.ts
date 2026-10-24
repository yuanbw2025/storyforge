import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'
import {chatNarrativeShellV1, parseChatSituationCandidatesV1, selectChatNarrativeCandidateV1} from '../../src/lib/character-interaction/narrative-production'
import {parseChatAuthoringSettings} from '../../src/lib/character-interaction/authoring-contract'
import {loadChatSourceProjectionV1, saveChatDraftV1, selectChatWorldV1} from '../../src/lib/character-interaction/draft-service'
import {chatProjectionResourcesV1, readChatSourceProjectionViewV1} from '../../src/lib/character-interaction/source-projection'
import {createChatPersonaV1} from '../../src/lib/character-interaction/persona-source'
import {compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'
import {buildInteractionContextWindow, createInitialInteractionState, interactionVisibilityView, parseFrozenChatSourceV1} from '../../src/lib/character-interaction/runtime'
import {formatInteractionRuntimeContextV1} from '../../src/lib/character-interaction/context-format'
import {createProductProductionSourcePlanV1, executeProductProductionWorldGatewayV1} from '../../src/lib/product-production/source-contracts'
import {createProductProductionPlanV3} from '../../src/lib/product-production/plan'
import {seedCurrentProductWorld} from '../helpers/current-product-world'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
async function selected(f: Awaited<ReturnType<typeof seedChatNarrativeProductionFixture>>) {
  const content = await selectChatNarrativeCandidateV1({source: f.source, candidates: f.candidates, selection: {
    schema: 'storyforge.chat-situation-selection', version: 1, candidatesHash: await hashProductProductionValueV2(f.candidates),
    sourceHash: await hashProductProductionValueV2(f.source), selectedOptionKey: 'option-1', authorCommandId: 'author.choose',
  }})
  const input = {brief: f.brief, sourceCatalog: f.sourceCatalog, narrative: chatNarrativeShellV1(content), chatNarrative: content}
  return {content, input, compiled: compileInteractionModulesV1(input)}
}

it('binds a separate player source without adding an AI actor or exposing the player private history', async () => {
  const f = await seedChatNarrativeProductionFixture({mappedPlayer: true}), key = f.settings.narrative.playerCharacterKey!
  const projection = f.sourceCatalog.chatSourceProjection!
  expect(projection.playerCharacter?.resourceKey).toBe(key)
  expect(projection.characters.map(c => c.resourceKey)).not.toContain(key)
  expect(f.brief.source.selection.roleBindings.chatPlayer).toEqual([key])
  expect(f.source.source.version).toBe(3)
  expect(f.source.participants).toHaveLength(1)
  expect(f.source.source.knowledge.find(k => k.content.includes('来自旧港议会'))?.audienceKeys).toEqual(['player'])
  const {content, compiled} = await selected(f), state = createInitialInteractionState(compiled)
  expect(content.persona).toEqual({...createChatPersonaV1(f.settings, f.source.source), source: {resourceKey: key, sourceHash: projection.playerCharacter!.sourceHash}})
  expect(state.profiles.map(p => p.characterKey)).not.toContain(key)
  expect(JSON.stringify(interactionVisibilityView(state, 'player'))).toContain('来自旧港议会')
  const roleInput = formatInteractionRuntimeContextV1(state.profiles[0], buildInteractionContextWindow(state, state.profiles[0].participantKey))
  expect(roleInput).not.toContain('来自旧港议会')
  expect(roleInput).not.toContain('知道失踪船队真相')
  expect(roleInput).toContain('所属角色=player')
  expect(content.persona.description).not.toContain('来自旧港议会')
  expect((await db.worldReleases.get(f.world.release.id!))!.contentHash).toBe(f.world.release.contentHash)
})

it('rejects a duplicate AI/player identity, invalid keys and non-character or foreign sources', async () => {
  const f = await seedChatNarrativeProductionFixture({mappedPlayer: true})
  for (const key of ['', ' ', f.settings.characters[0].sourceKey]) expect(() => parseChatAuthoringSettings({...f.settings, narrative: {...f.settings.narrative, playerCharacterKey: key}})).toThrow()
  for (const key of ['foreign', f.sourceCatalog.locations[0].resourceKey]) {
    const saved = await saveChatDraftV1(f.scope, f.confirmed.revision, {...f.settings, sourceReview: null, narrative: {...f.settings.narrative, playerCharacterKey: key}})
    await expect(loadChatSourceProjectionV1(f.scope, saved.revision)).rejects.toThrow()
    f.confirmed = saved
  }
})

it('keeps the mapped player outside AI motivation, voice and goal assignment', async () => {
  const f = await seedChatNarrativeProductionFixture({mappedPlayer: true}), draft = f.sourceCatalog.chatSourceProjection!
  const fragment = draft.playerCharacter!.fragments[0]
  for (const purpose of ['motivation', 'voice'] as const) await expect(readChatSourceProjectionViewV1({draft, viewerKey: 'player', classifications: [
    {projectionHash: draft.projectionHash, fragmentKey: fragment.fragmentKey, purpose, visibility: 'public', audienceKeys: []},
  ]})).rejects.toThrow('代演玩家')
  const wrongGoal = structuredClone(f.candidates)
  wrongGoal.options[0].situation.goals[0].actorKey = 'player'
  expect(() => parseChatSituationCandidatesV1(wrongGoal, f.source)).toThrow('不能替玩家')
  const secret = f.source.source.knowledge.find(k => k.content.includes('来自旧港议会'))!
  const expanded = structuredClone(f.candidates)
  expanded.options[0].situation.facts.push({factKey: 'player-history', text: secret.content, sourceKnowledgeKey: secret.key, origin: 'reviewed-world', sourceEventSequence: 0, audienceKeys: ['player', f.source.participants[0].participantKey]})
  expect(() => parseChatSituationCandidatesV1(expanded, f.source)).toThrow('扩大了知情者')
})

it('checks the player identity and source hash at compilation and installation without accepting a forged v2 package', async () => {
  const f = await seedChatNarrativeProductionFixture({mappedPlayer: true}), {content, input, compiled} = await selected(f)
  for (const change of ['hash', 'purpose', 'alias', 'version', 'version-string'] as const) {
    const source = structuredClone(compiled.chatSource!)
    if (change === 'hash') source.playerCharacterSource!.sourceHash = 'f'.repeat(64)
    if (change === 'purpose') source.knowledge.find(k => k.source.resourceKey === source.playerCharacterSource!.resourceKey)!.source.purpose = 'voice'
    if (change === 'alias') source.playerCharacterSource!.resourceKey = compiled.profiles[0].characterKey
    if (change === 'version') source.version = 2
    if (change === 'version-string') Object.assign(source, {version: '3'})
    expect(() => parseFrozenChatSourceV1(source, compiled.profiles.map(p => p.participantKey), compiled.profiles.map(p => p.characterKey))).toThrow()
  }
  const tampered = structuredClone(content); tampered.persona.source!.sourceHash = 'e'.repeat(64)
  expect(() => compileInteractionModulesV1({...input, chatNarrative: tampered})).toThrow('来源证据')
  const wrongBrief = structuredClone(input.brief); wrongBrief.source.selection.roleBindings.chatPlayer = []
  expect(() => compileInteractionModulesV1({...input, brief: wrongBrief})).toThrow('玩家人物投影')
  const noBinding = structuredClone(f.source); delete noBinding.settings.narrative.playerCharacterKey
  expect(() => parseChatSituationCandidatesV1(f.candidates, noBinding)).toThrow('玩家人物')
})

it('invalidates source consent on unmapping, clears the mapping on world change and preserves the portable key in project transfer', async () => {
  const f = await seedChatNarrativeProductionFixture({mappedPlayer: true})
  const id = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const imported = (await db.chatAuthoringDrafts.where('projectId').equals(id).first())!
  expect(JSON.parse(imported.settingsJson)).toEqual(f.settings)
  expect((await loadChatSourceProjectionV1({projectId: id, worldId: imported.worldId, workId: imported.workId}, imported.revision)).projectionHash).toBe(f.sourceCatalog.chatSourceProjection!.projectionHash)
  const next = structuredClone(f.settings); delete next.narrative.playerCharacterKey
  const saved = await saveChatDraftV1(f.scope, f.confirmed.revision, next)
  expect(JSON.parse(saved.settingsJson).sourceReview).toBeNull()
  const remapped = await saveChatDraftV1(f.scope, saved.revision, {...f.settings, sourceReview: null})
  expect(JSON.parse(remapped.settingsJson).narrative.playerCharacterKey).toBe(f.settings.narrative.playerCharacterKey)
  const world = await seedCurrentProductWorld('new mapped persona world')
  const changed = await selectChatWorldV1(f.scope, remapped.revision, world.release.id!)
  expect(JSON.parse(changed.settingsJson).narrative).not.toHaveProperty('playerCharacterKey')
})

it('declares the player resource in the frozen Gateway read while keeping legacy persona/projection shapes unchanged', async () => {
  const f = await seedChatNarrativeProductionFixture({mappedPlayer: true})
  const sourcePlan = await createProductProductionSourcePlanV1({scope: f.scope, productionKey: 'mapped-persona', brief: f.brief})
  const plan = await createProductProductionPlanV3({buildNumber: 1, briefHash: await hashProductProductionValueV2(f.brief), brief: f.brief})
  const execution = await executeProductProductionWorldGatewayV1({scope: f.scope, sourcePlan, brief: f.brief,
    task: plan.tasks.find(t => t.taskKey === 'content.design')!, requireCompilationResources: true, budgetTokens: 50000})
  expect(execution.selector.selected.find(r => r.resourceKey === f.settings.narrative.playerCharacterKey)?.hardRequirement).toBe(true)
  expect(execution.sourceSnapshots.some(r => r.resourceKey === f.settings.narrative.playerCharacterKey)).toBe(true)
  const old = await seedChatNarrativeProductionFixture(), {content} = await selected(old)
  expect(old.source.source.version).toBe(1)
  expect(old.source.source).not.toHaveProperty('playerCharacterSource')
  expect(old.sourceCatalog.chatSourceProjection).not.toHaveProperty('playerCharacter')
  expect(chatProjectionResourcesV1(old.sourceCatalog.chatSourceProjection!)).toEqual(old.sourceCatalog.chatSourceProjection!.characters)
  expect(content.persona).toEqual({playerKey: 'player', name: old.settings.narrative.personaName, description: old.settings.playerRole, origin: 'product-private'})
})
