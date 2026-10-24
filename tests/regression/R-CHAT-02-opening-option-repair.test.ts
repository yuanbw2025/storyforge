import {afterEach, beforeEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {buildChatOpeningFactCatalogV1, compileChatOpeningReferenceDraftV1} from '../../src/lib/character-interaction/opening-source-references'
import {planChatOpeningRepairV3} from '../../src/lib/character-interaction/opening-reference-repair'
import {applyChatOpeningOptionRepairV1, planChatOpeningRepairV4} from '../../src/lib/character-interaction/opening-option-repair'
import {chatSituationReferenceDraftFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})

async function fixture() {
  const f = await seedChatNarrativeProductionFixture({worldDiscovery: true})
  const catalog = await buildChatOpeningFactCatalogV1(f.source), good = await chatSituationReferenceDraftFixture(f.source)
  const bad = structuredClone(good)
  bad.options[2].situation.threads[0].evidenceFactKeys = [catalog.facts.find(entry => entry.discoverable)!.factKey]
  const raw = JSON.stringify(bad), repair = (await planChatOpeningRepairV4(raw, f.source, catalog, '公开事项使用了私有事实'))!
  const patch = {schema: 'storyforge.chat-opening-repair-patch', version: 2, rawResponseHash: repair.rawResponseHash,
    recoverRootOption: false, applyRepairs: [], appendedOptions: [] as typeof good.options,
    replacementOptions: [{optionIndex: 2, option: good.options[2]}]}
  return {f, catalog, good, bad, raw, repair, patch}
}

it('locates a rejected third opening, retains the first two and all source rights, and leaves v9 stopped', async () => {
  const {f, catalog, good, raw, repair, patch} = await fixture()
  const before = JSON.stringify({source: f.source, catalog, raw, repair, patch})
  expect(repair).toMatchObject({version: 4, format: 'references', originalOptionCount: 3, missingOptions: 0,
    invalidOptions: [{optionIndex: 2, optionKey: good.options[2].optionKey, error: expect.stringContaining('视角不可知')}]})
  expect(await planChatOpeningRepairV3(raw, f.source, catalog, '公开事项使用了私有事实')).toBeNull()
  const result = await applyChatOpeningOptionRepairV1({raw, source: f.source, catalog, repair, candidate: patch})
  expect(result).toEqual(await compileChatOpeningReferenceDraftV1(good, f.source, catalog))
  expect(JSON.stringify({source: f.source, catalog, raw, repair, patch})).toBe(before)
})

it.each(['valid-index', 'duplicate-index', 'missing-replacement', 'identity', 'invalid-replacement', 'extra',
  'whole-response', 'hash', 'move', 'field-edit', 'unexpected-append', 'wrong-version', 'stale-source', 'stale-catalog', 'forged-plan', 'different-raw'] as const)(
  'rejects replacement authority or final validation violations (%s)', async mutation => {
    const {f, catalog, good, raw, repair, patch} = await fixture()
    if (mutation === 'valid-index') patch.replacementOptions[0] = {optionIndex: 0, option: good.options[0]}
    if (mutation === 'duplicate-index') patch.replacementOptions.push(patch.replacementOptions[0])
    if (mutation === 'missing-replacement') patch.replacementOptions = []
    if (mutation === 'identity') patch.replacementOptions[0].option.optionKey = 'different-story'
    if (mutation === 'invalid-replacement') patch.replacementOptions[0].option.situation.threads[0].participantKeys.push('player')
    if (mutation === 'extra') Object.assign(patch, {options: good.options})
    if (mutation === 'hash') patch.rawResponseHash = '0'.repeat(64)
    if (mutation === 'move') patch.recoverRootOption = true
    if (mutation === 'field-edit') Object.assign(patch, {applyRepairs: ['/options/0/title']})
    if (mutation === 'unexpected-append') patch.appendedOptions.push(good.options[0])
    if (mutation === 'wrong-version') patch.version = 1
    if (mutation === 'stale-source') f.source.settings.openingSituation += '来源已变'
    if (mutation === 'stale-catalog') catalog.facts[0].audienceKeys.push('unknown')
    if (mutation === 'forged-plan') repair.invalidOptions[0].optionIndex = 0
    await expect(applyChatOpeningOptionRepairV1({
      raw: mutation === 'different-raw' ? raw + ' ' : raw, source: f.source, catalog, repair,
      candidate: mutation === 'whole-response' ? good : patch,
    })).rejects.toThrow()
  },
)

it('can repair all individually rejected options and append missing ones without changing valid recovered content', async () => {
  const {f, catalog, good, bad} = await fixture()
  const raw = JSON.stringify({...bad, options: [bad.options[2]], ...good.options[1]})
  const repair = (await planChatOpeningRepairV4(raw, f.source, catalog, '错误'))!
  expect(repair).toMatchObject({recoverRootOption: true, missingOptions: 1, invalidOptions: [{optionIndex: 0, optionKey: good.options[2].optionKey}]})
  const patch = {schema: 'storyforge.chat-opening-repair-patch', version: 2, rawResponseHash: repair.rawResponseHash,
    recoverRootOption: true, applyRepairs: [], appendedOptions: [good.options[0]], replacementOptions: [{optionIndex: 0, option: good.options[2]}]}
  const result = await applyChatOpeningOptionRepairV1({raw, source: f.source, catalog, repair, candidate: patch})
  const expected = await compileChatOpeningReferenceDraftV1(good, f.source, catalog)
  expect(result.options).toEqual([expected.options[2], expected.options[1], expected.options[0]])
  for (const option of bad.options) option.situation.threads[0].participantKeys.push('player')
  expect((await planChatOpeningRepairV4(JSON.stringify(bad), f.source, catalog, '错误'))!.invalidOptions).toHaveLength(3)
})

it.each(['extra-root', 'partial-root', 'duplicate-key', 'duplicate-valid-content', 'excess', 'empty', 'invalid-key'] as const)(
  'does not invent a replacement scope for ambiguous envelopes (%s)', async mutation => {
    const {f, catalog, good} = await fixture()
    let value: unknown = good
    if (mutation === 'extra-root') value = {...good, anotherStory: '另一个局面'}
    if (mutation === 'partial-root') value = {...good, optionKey: 'misplaced'}
    if (mutation === 'duplicate-key') good.options[2].optionKey = good.options[0].optionKey
    if (mutation === 'duplicate-valid-content') good.options[2].situation = structuredClone(good.options[0].situation)
    if (mutation === 'excess') good.options.push(good.options[0])
    if (mutation === 'empty') good.options = []
    if (mutation === 'invalid-key') good.options[2].optionKey = ''
    expect(await planChatOpeningRepairV4(JSON.stringify(value), f.source, catalog, '错误')).toBeNull()
  },
)
