import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {hashCanonicalValue} from '../../src/lib/agent/run/hash'
import {buildChatOpeningFactCatalogV1, buildChatOpeningFactCatalogV2, compileChatOpeningReferenceDraftV1,
  compileChatOpeningReferenceDraftV2, parseChatOpeningSourceBoundOutputV2, assertChatOpeningSourceCompletenessV1} from '../../src/lib/character-interaction/opening-source-references'
import {planChatOpeningRepairV5, applyChatOpeningOptionRepairV2} from '../../src/lib/character-interaction/opening-option-repair'
import {selectChatNarrativeCandidateV1, chatNarrativeShellV1} from '../../src/lib/character-interaction/narrative-production'
import {compileInteractionModulesV1} from '../../src/lib/product-production/product-module-compilers'
import {buildInteractionContextWindow, createInitialInteractionState, interactionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {parseChatActionChoiceV1} from '../../src/lib/character-interaction/action-choice-contract'
import {requestChatNarrativeTriggerV1, applyReviewedChatNarrativeActionV1} from '../../src/lib/character-interaction/narrative-actions'
import {CHAT_INITIAL_FACT_CAPACITY_V1} from '../../src/lib/character-interaction/narrative-contract'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'
import {chatActionReviewFixture} from '../helpers/chat-narrative-fixture'
import {seedChatNarrativeProductionFixture, chatSituationReferenceDraftFixture} from '../helpers/chat-narrative-production-fixture'
import {createProductProductionPlanV3} from '../../src/lib/product-production/plan'
import {selectedChatProductionNarrativeV1} from '../../src/lib/product-production/chat-situation-tasks'
import type {ProductProductionTaskExecutionInputV1} from '../../src/lib/product-production/scheduler'
import {chatOpeningOutputSchemaV1} from '../../src/lib/character-interaction/opening-output-schema'
import {estimateChatRequestOptionsTokens} from '../../src/lib/ai/client'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})

it('binds the strict transport shape to the source count, actors, capacity and discovery authorization without duplicating secret prose', async () => {
  const f = await seedChatNarrativeProductionFixture({privateKnownFact: true}), catalog = await buildChatOpeningFactCatalogV2(f.source)
  const schema = await chatOpeningOutputSchemaV1(f.source, catalog)
  expect(schema).toMatchObject({name: 'chat_opening_source_complete_v1', strict: true, schema: {
    additionalProperties: false, properties: {options: {minItems: 3, maxItems: 3, items: {additionalProperties: false, properties: {
      situation: {properties: {localFacts: {maxItems: CHAT_INITIAL_FACT_CAPACITY_V1 - catalog.facts.length}}}}},
    }},
  }})
  expect(JSON.stringify(schema)).toContain(f.source.participants[0].participantKey)
  expect(JSON.stringify(schema)).not.toContain('"discovery"')
  for (const item of f.source.source.knowledge) expect(JSON.stringify(schema)).not.toContain(JSON.stringify(item.content))
  expect(estimateChatRequestOptionsTokens({jsonSchema: schema})).toBeGreaterThan(0)
  f.source.settings.openingSituation += '已改变'
  await expect(chatOpeningOutputSchemaV1(f.source, catalog)).rejects.toThrow('目录')
  const discovery = await seedChatNarrativeProductionFixture({worldDiscovery: true})
  expect(JSON.stringify(await chatOpeningOutputSchemaV1(discovery.source, await buildChatOpeningFactCatalogV2(discovery.source)))).toContain('"discovery"')
})

it('retains every reviewed identity/knowledge fact with exact visibility even when the opening selects none; keeps v9/v10 behavior', async () => {
  const f = await seedChatNarrativeProductionFixture({privateKnownFact: true})
  const before = JSON.stringify(f.source), catalog = await buildChatOpeningFactCatalogV2(f.source)
  const legacy = await buildChatOpeningFactCatalogV1(f.source), wire = await chatSituationReferenceDraftFixture(f.source)
  expect(legacy.facts.some(fact => !fact.required)).toBe(true)
  expect(catalog.version).toBe(2)
  expect(catalog.facts.every(fact => fact.required)).toBe(true)
  const result = await compileChatOpeningReferenceDraftV2(wire, f.source, catalog)
  for (const option of result.options) {
    expect(option.situation.facts.filter(fact => fact.origin === 'reviewed-world')).toHaveLength(catalog.facts.length)
    for (const entry of catalog.facts) {
      const source = f.source.source.knowledge.find(k => k.key === entry.sourceKnowledgeKey)!
      expect(option.situation.facts.find(fact => fact.factKey === entry.factKey)).toMatchObject({
        text: source.content, audienceKeys: source.audienceKeys, sourceKnowledgeKey: source.key, sourceEventSequence: 0,
      })
      expect(['identity', 'knowledge']).toContain(source.source.purpose)
    }
  }
  await expect(assertChatOpeningSourceCompletenessV1(result, f.source)).resolves.toBeUndefined()
  const old = await compileChatOpeningReferenceDraftV1(wire, f.source, legacy)
  expect(old.options[0].situation.facts.some(fact => fact.origin === 'reviewed-world')).toBe(false)
  await expect(assertChatOpeningSourceCompletenessV1(old, f.source)).rejects.toThrow('唯一可用身份')
  await expect(compileChatOpeningReferenceDraftV2(wire, f.source, legacy)).rejects.toThrow('目录')
  await expect(compileChatOpeningReferenceDraftV1(wire, f.source, catalog)).rejects.toThrow('目录')
  expect(JSON.stringify(f.source)).toBe(before)
})

it('carries formerly omitted private source knowledge through selection and compilation into a legal actor choice and reviewed disclosure', async () => {
  const f = await seedChatNarrativeProductionFixture({privateKnownFact: true}), actorKey = f.source.participants[0].participantKey
  const catalog = await buildChatOpeningFactCatalogV2(f.source), wire = await chatSituationReferenceDraftFixture(f.source)
  const entry = catalog.facts.find(fact => fact.audienceKeys.includes(actorKey) && !fact.audienceKeys.includes('player'))!
  expect(entry).toBeDefined()
  const candidates = await compileChatOpeningReferenceDraftV2(wire, f.source, catalog)
  const chatNarrative = await selectChatNarrativeCandidateV1({source: f.source, candidates, selection: {
    schema: 'storyforge.chat-situation-selection', version: 1, selectedOptionKey: candidates.options[0].optionKey,
    authorCommandId: 'choose-source-complete', candidatesHash: await hashCanonicalValue(candidates), sourceHash: await hashCanonicalValue(f.source),
  }})
  const compiled = compileInteractionModulesV1({brief: f.brief, sourceCatalog: f.sourceCatalog, narrative: chatNarrativeShellV1(chatNarrative), chatNarrative})
  const initial = createInitialInteractionState(compiled)
  initial.activeScene = {...initial.sceneTemplates[0], sceneId: 'current', status: 'active', activeParticipantKeys: [actorKey], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  initial.remainingDirectorBudget = 100
  const state = requestChatNarrativeTriggerV1(initial, {sequence: 2, kind: 'scene-start', sourceEventSequence: 1, seed: null})
  const context = buildInteractionContextWindow(state, actorKey)
  const known = state.chatNarrative!.situation.facts.find(fact => fact.factKey === entry.factKey)!
  expect(context.chatNarrative!.facts.some(fact => fact.factKey === known.factKey)).toBe(true)
  const playerBefore = interactionVisibilityView(state, 'player')
  expect(playerBefore.chatNarrative!.facts.some(fact => fact.factKey === known.factKey)).toBe(false)
  expect(playerBefore.knowledge.some(item => item.knowledgeKey === known.sourceKnowledgeKey)).toBe(false)
  const direction = {id: 'spare', action: '说明自己保留的旧发条及其不确定性，不拆钟或试装。', evidenceFactKeys: [entry.factKey],
    changes: '让玩家知道一个尚需验证的备选。', playerDependency: null, unconfirmedConditions: ['适配性和耐久性尚未确认'], kind: 'own-action'}
  expect(parseChatActionChoiceV1({directions: [direction], selectedId: 'spare', decisionSummary: '说明真实持有的备选。'}, context).selectedId).toBe('spare')
  // A source identifier is still not permission to bypass delivered fact identity.
  expect(() => parseChatActionChoiceV1({directions: [{...direction, evidenceFactKeys: [entry.sourceKnowledgeKey]}],
    selectedId: 'spare', decisionSummary: '错误的来源编号'}, context)).toThrow('未交付')
  const action: ChatNarrativeActionV1 = {kind: 'speak', text: known.text, goalKey: state.chatNarrative!.situation.goals[0].goalKey,
    evidenceFactKeys: [known.factKey], audienceKeys: [actorKey, 'player'], waitingForPlayer: false, newFacts: [],
    disclosures: [{factKey: known.factKey, toParticipantKeys: ['player'], evidenceExcerpt: known.text}], threadUpdates: [], goalStatus: null}
  const after = applyReviewedChatNarrativeActionV1(state, {sequence: 3, triggerSequence: 2, actorKey, messageId: 'spare-disclosed', action,
    review: chatActionReviewFixture(action)})
  expect(after.chatNarrative!.situation.facts.find(fact => fact.factKey === entry.factKey)).toEqual({...known, audienceKeys: [actorKey, 'player']})
  expect(interactionVisibilityView(after, 'player').chatNarrative!.facts.find(fact => fact.factKey === known.factKey)?.text).toBe(known.text)
  expect(state.chatNarrative!.situation.facts.find(fact => fact.factKey === entry.factKey)).toEqual(known)
})

it('completes full candidates without changing authored facts, discovery prerequisites or input objects', async () => {
  const f = await seedChatNarrativeProductionFixture({worldDiscovery: true}), before = structuredClone(f.candidates)
  const catalog = await buildChatOpeningFactCatalogV2(f.source)
  const completed = await parseChatOpeningSourceBoundOutputV2(f.candidates, f.source, catalog)
  for (const [index, option] of completed.options.entries()) {
    expect(option.situation.facts.slice(0, before.options[index].situation.facts.length)).toEqual(before.options[index].situation.facts)
    expect(option.situation.goals).toEqual(before.options[index].situation.goals)
  }
  await expect(assertChatOpeningSourceCompletenessV1(completed, f.source)).resolves.toBeUndefined()
  expect(f.candidates).toEqual(before)
})

it.each(['duplicate-source', 'alias-collision', 'private-public-thread', 'source-text', 'source-audience', 'catalog', 'source'] as const)(
  'rejects ambiguous or unauthorized full candidates instead of making them pass (%s)', async mutation => {
    const f = await seedChatNarrativeProductionFixture({privateKnownFact: true}), catalog = await buildChatOpeningFactCatalogV2(f.source)
    const full = await parseChatOpeningSourceBoundOutputV2(f.candidates, f.source, catalog), facts = full.options[0].situation.facts
    const fact = facts.find(fact => fact.origin === 'reviewed-world' && !fact.audienceKeys.includes('player'))!
    if (mutation === 'duplicate-source') facts.push({...fact, factKey: 'duplicate-source'})
    if (mutation === 'alias-collision') {facts.splice(facts.indexOf(fact), 1); facts.push({...facts[0], factKey: fact.factKey})}
    if (mutation === 'private-public-thread') full.options[0].situation.threads[0].evidenceFactKeys = [fact.factKey]
    if (mutation === 'source-text') fact.text += '而且肯定能修好旧钟'
    if (mutation === 'source-audience') fact.audienceKeys.push('player')
    if (mutation === 'catalog') catalog.facts[0].required = false
    if (mutation === 'source') f.source.settings.openingSituation += '已改换'
    await expect(parseChatOpeningSourceBoundOutputV2(full, f.source, catalog)).rejects.toThrow()
  },
)

it.each(['references', 'full'] as const)('completes source facts after the one bounded repair (%s)', async format => {
  const f = await seedChatNarrativeProductionFixture({privateKnownFact: true}), catalog = await buildChatOpeningFactCatalogV2(f.source)
  const good = format === 'references' ? await chatSituationReferenceDraftFixture(f.source) : f.candidates
  const raw = JSON.stringify({...good, options: good.options.slice(0, 2)})
  const repair = (await planChatOpeningRepairV5(raw, f.source, catalog, '缺少开场'))!
  expect(repair).toMatchObject({version: 5, format, missingOptions: 1, invalidOptions: []})
  const candidate = {schema: 'storyforge.chat-opening-repair-patch', version: format === 'references' ? 2 : 1,
    rawResponseHash: repair.rawResponseHash, recoverRootOption: false, applyRepairs: [], appendedOptions: [good.options[2]],
    ...(format === 'references' ? {replacementOptions: []} : {})}
  const result = await applyChatOpeningOptionRepairV2({raw, source: f.source, catalog, repair, candidate})
  await expect(assertChatOpeningSourceCompletenessV1(result, f.source)).resolves.toBeUndefined()
  expect(result.options.map(option => option.title)).toEqual(good.options.map(option => option.title))
})

it('retains complete knowledge while replacing only an invalid reference option', async () => {
  const f = await seedChatNarrativeProductionFixture({privateKnownFact: true}), catalog = await buildChatOpeningFactCatalogV2(f.source)
  const good = await chatSituationReferenceDraftFixture(f.source), bad = structuredClone(good)
  bad.options[2].situation.threads[0].evidenceFactKeys = [catalog.facts.find(fact => !fact.audienceKeys.includes('player'))!.factKey]
  const raw = JSON.stringify(bad), repair = (await planChatOpeningRepairV5(raw, f.source, catalog, '私密依据'))!
  expect(repair.invalidOptions.map(option => option.optionIndex)).toEqual([2])
  const result = await applyChatOpeningOptionRepairV2({raw, source: f.source, catalog, repair, candidate: {
    schema: 'storyforge.chat-opening-repair-patch', version: 2, rawResponseHash: repair.rawResponseHash,
    recoverRootOption: false, applyRepairs: [], appendedOptions: [], replacementOptions: [{optionIndex: 2, option: good.options[2]}],
  }})
  expect(result).toEqual(await compileChatOpeningReferenceDraftV2(good, f.source, catalog))
})

it.each(['content.chat-author-gate', 'content.narrative', 'integration.package'])(
  'rejects incomplete facts at the downstream %s boundary', async taskKey => {
    const f = await seedChatNarrativeProductionFixture({privateKnownFact: true})
    const plan = await createProductProductionPlanV3({brief: f.brief, briefHash: await hashCanonicalValue(f.brief), buildNumber: 1})
    const input = {task: plan.tasks.find(task => task.taskKey === taskKey)!, inputArtifacts: [
      {artifactKey: 'design.game', payloadJson: JSON.stringify(f.source)},
      {artifactKey: 'content.chat-candidates', payloadJson: JSON.stringify(f.candidates)},
      {artifactKey: 'content.chat-selection', payloadJson: JSON.stringify({
        schema: 'storyforge.chat-situation-selection', version: 1, selectedOptionKey: 'option-1', authorCommandId: 'author.choose',
        sourceHash: await hashCanonicalValue(f.source), candidatesHash: await hashCanonicalValue(f.candidates),
      })},
    ]} as ProductProductionTaskExecutionInputV1
    await expect(selectedChatProductionNarrativeV1(input)).rejects.toThrow('唯一可用身份')
  },
)

it('rejects over-capacity reviewed sources before model production instead of dropping knowledge', async () => {
  const f = await seedChatNarrativeProductionFixture({privateKnownFact: true})
  const source = f.source.source.knowledge.find(k => k.source.purpose === 'knowledge')!
  f.source.source.knowledge = Array.from({length: CHAT_INITIAL_FACT_CAPACITY_V1 + 1}, (_, index) => ({...source, key: `capacity-${index}`}))
  await expect(buildChatOpeningFactCatalogV2(f.source)).rejects.toThrow('超过初始情境容量')
})
