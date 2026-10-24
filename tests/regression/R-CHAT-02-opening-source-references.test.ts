import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {buildChatOpeningFactCatalogV1, compileChatOpeningReferenceDraftV1, parseChatOpeningSourceBoundOutputV1} from '../../src/lib/character-interaction/opening-source-references'
import {planChatOpeningRepairV3, applyChatOpeningReferenceRepairV1} from '../../src/lib/character-interaction/opening-reference-repair'
import {seedChatNarrativeProductionFixture, chatSituationReferenceDraftFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})

it('materializes selected exact source facts and mandatory discovery with unchanged visibility, conditions and prerequisites', async () => {
  const f = await seedChatNarrativeProductionFixture({worldDiscovery: true})
  const before = JSON.stringify(f.source), catalog = await buildChatOpeningFactCatalogV1(f.source), wire = await chatSituationReferenceDraftFixture(f.source)
  const publicEntry = catalog.facts.find(entry => entry.audienceKeys.includes('player'))!
  for (const option of wire.options) option.situation.worldFactKeys = [publicEntry.factKey]
  const result = await compileChatOpeningReferenceDraftV1(wire, f.source, catalog)
  for (const option of result.options) {
    for (const entry of catalog.facts.filter(entry => entry.required || entry.factKey === publicEntry.factKey)) {
      const knowledge = f.source.source.knowledge.find(k => k.key === entry.sourceKnowledgeKey)!
      const fact = option.situation.facts.find(fact => fact.factKey === entry.factKey)!
      expect(fact).toMatchObject({text: knowledge.content, audienceKeys: knowledge.audienceKeys, sourceKnowledgeKey: knowledge.key, origin: 'reviewed-world', sourceEventSequence: 0})
      if (knowledge.discovery) expect(fact.discovery).toEqual({
        sceneKey: option.situation.sceneKey, actorKeys: knowledge.discovery.actorKeys, condition: knowledge.discovery.condition,
        prerequisiteFactKeys: knowledge.discovery.prerequisiteKnowledgeKeys.map(key => catalog.facts.find(entry => entry.sourceKnowledgeKey === key)!.factKey),
      })
    }
    expect(option.situation.goals).toEqual(f.candidates.options.find(o => o.optionKey === option.optionKey)!.situation.goals)
    expect(option.situation.facts.find(f => f.factKey === 'clock')).toMatchObject({origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  }
  expect(JSON.stringify(f.source)).toBe(before)
  expect(JSON.stringify(catalog)).not.toContain(f.source.source.knowledge.find(k => k.discovery)!.content)
  expect(catalog.facts.every(entry => ['identity', 'knowledge'].includes(f.source.source.knowledge.find(k => k.key === entry.sourceKnowledgeKey)!.source.purpose))).toBe(true)
})

it.each(['unknown-ref', 'duplicate-ref', 'alias-collision', 'private-thread', 'private-goal', 'player-scheduling', 'world-write', 'status-write', 'catalog-tamper', 'source-stale', 'incomplete'] as const)(
  'does not weaken original candidate boundaries through source references (%s)', async mutation => {
    const f = await seedChatNarrativeProductionFixture({worldDiscovery: true}), catalog = await buildChatOpeningFactCatalogV1(f.source), wire = await chatSituationReferenceDraftFixture(f.source)
    const hidden = catalog.facts.find(entry => entry.discoverable)!, s = wire.options[0].situation
    if (mutation === 'unknown-ref') s.worldFactKeys.push('world-fact.foreign')
    if (mutation === 'duplicate-ref') s.worldFactKeys.push(s.worldFactKeys[0])
    if (mutation === 'alias-collision') s.localFacts[0].factKey = hidden.factKey
    if (mutation === 'private-thread') s.threads[0].evidenceFactKeys = [hidden.factKey]
    if (mutation === 'private-goal') s.goals[0].evidenceFactKeys = [hidden.factKey]
    if (mutation === 'player-scheduling') s.threads[0].participantKeys.push('player')
    if (mutation === 'world-write') Object.assign(s.localFacts[0], {sourceKnowledgeKey: hidden.sourceKnowledgeKey})
    if (mutation === 'status-write') Object.assign(s.goals[0], {status: 'completed'})
    if (mutation === 'catalog-tamper') hidden.audienceKeys.push('player')
    if (mutation === 'source-stale') f.source.settings.openingSituation += '世界已有变化'
    if (mutation === 'incomplete') wire.options.pop()
    await expect(compileChatOpeningReferenceDraftV1(wire, f.source, catalog)).rejects.toThrow()
  },
)

it('retains strict full-candidate support without normalizing incorrect source fields', async () => {
  const f = await seedChatNarrativeProductionFixture({worldDiscovery: true}), catalog = await buildChatOpeningFactCatalogV1(f.source)
  expect(await parseChatOpeningSourceBoundOutputV1(f.candidates, f.source, catalog)).toEqual(f.candidates)
  f.candidates.options[0].situation.facts.find(fact => fact.origin === 'reviewed-world')!.origin = 'author-private'
  await expect(parseChatOpeningSourceBoundOutputV1(f.candidates, f.source, catalog)).rejects.toThrow()
})

it('repairs only missing or misplaced reference options with exact raw/source/catalog binding', async () => {
  const f = await seedChatNarrativeProductionFixture({worldDiscovery: true}), catalog = await buildChatOpeningFactCatalogV1(f.source), wire = await chatSituationReferenceDraftFixture(f.source)
  const raw = JSON.stringify({...wire, options: wire.options.slice(0, 1), ...wire.options[1]})
  const repair = (await planChatOpeningRepairV3(raw, f.source, catalog, '字段错误'))!
  expect(repair).toMatchObject({version: 3, format: 'references', recoverRootOption: true, missingOptions: 1, repairs: []})
  const patch = {schema: 'storyforge.chat-opening-repair-patch', version: 1, rawResponseHash: repair.rawResponseHash,
    recoverRootOption: true, applyRepairs: [], appendedOptions: [wire.options[2]]}
  expect(await applyChatOpeningReferenceRepairV1({raw, candidate: patch, source: f.source, catalog, repair}))
    .toEqual(await compileChatOpeningReferenceDraftV1(wire, f.source, catalog))
  await expect(applyChatOpeningReferenceRepairV1({raw, candidate: {...patch, options: wire.options}, source: f.source, catalog, repair})).rejects.toThrow()
  await expect(applyChatOpeningReferenceRepairV1({raw, candidate: patch, source: f.source, catalog, repair: {...repair, catalogHash: '0'.repeat(64)}})).rejects.toThrow()
  const hidden = catalog.facts.find(entry => entry.discoverable)!
  wire.options[0].situation.threads[0].evidenceFactKeys = [hidden.factKey]
  expect(await planChatOpeningRepairV3(JSON.stringify({...wire, options: wire.options.slice(0, 1)}), f.source, catalog, '数量错误')).toBeNull()
})
