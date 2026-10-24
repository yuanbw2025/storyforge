import {afterEach, beforeEach, expect, it} from 'vitest'
import Ajv from 'ajv'
import {db} from '../../src/lib/db/schema'
import {buildChatOpeningReviewReferencesV1} from '../../src/lib/character-interaction/opening-review-references'
import {chatOpeningKeyedReviewSchemaV1, parseChatOpeningKeyedReviewV1} from '../../src/lib/character-interaction/opening-review-keyed'
import {chatOpeningDevelopmentReviewFixture, chatOpeningKeyedReviewFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})

it('scopes native decoding to each candidate and preserves all semantic judgments in the original canonical report', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true})
  const draft = chatOpeningDevelopmentReviewFixture(f.candidates, f.candidates.options[1].optionKey)
  const wire = chatOpeningKeyedReviewFixture(f.source, f.candidates, draft)
  const schema = chatOpeningKeyedReviewSchemaV1(f.source, f.candidates)
  expect(new Ajv().compile(schema.schema)(wire)).toBe(true)
  expect(parseChatOpeningKeyedReviewV1(wire, f.source, f.candidates)).toEqual(draft)
  expect(JSON.stringify(schema)).not.toMatch(/"(?:anyOf|oneOf)"/)
  const reversed = {options: Object.fromEntries(Object.entries(wire.options).reverse().map(([key, value]) => [key, {
    ...value, checks: Object.fromEntries(Object.entries(value.checks).reverse()),
  }]))}
  expect(parseChatOpeningKeyedReviewV1(reversed, f.source, f.candidates)).toEqual(draft)
})

it.each(['foreign-option', 'unknown-option', 'missing-option', 'missing-check', 'extra-check', 'extra-identity', 'five-citations', 'empty-citations', 'unknown-ref', 'foreign-goal'] as const)('rejects %s in both native schema and local parsing without changing the original response', async kind => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true})
  const wire = chatOpeningKeyedReviewFixture(f.source, f.candidates)
  const key = f.candidates.options[0].optionKey, first = wire.options[key], check = first.checks['viable-agency']
  if (kind === 'foreign-option') check.evidence = [{refId: buildChatOpeningReviewReferencesV1(f.source, f.candidates).find(ref => ref.optionKey === f.candidates.options[1].optionKey)!.refId}]
  if (kind === 'unknown-option') wire.options['unknown-option'] = structuredClone(first)
  if (kind === 'missing-option') delete wire.options[key]
  if (kind === 'missing-check') delete first.checks['role-motivation']
  if (kind === 'extra-check') first.checks['unknown-check'] = structuredClone(check)
  if (kind === 'extra-identity') Object.assign(first, {optionKey: key})
  if (kind === 'five-citations') check.evidence = Array.from({length: 5}, () => check.evidence[0])
  if (kind === 'empty-citations') check.evidence = []
  if (kind === 'unknown-ref') check.evidence = [{refId: 'unknown'}]
  if (kind === 'foreign-goal') first.agency!.goalKey = 'not-a-current-goal'
  const before = structuredClone(wire)
  expect(new Ajv().compile(chatOpeningKeyedReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(false)
  expect(() => parseChatOpeningKeyedReviewV1(wire, f.source, f.candidates)).toThrow()
  expect(wire).toEqual(before)
})

it.each(['repeated-adaptive', 'null-agency', 'missing-direction-proof'] as const)('retains the original semantic rejection of %s even when the transport schema passes', async kind => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true})
  const wire = chatOpeningKeyedReviewFixture(f.source, f.candidates), first = Object.values(wire.options)[0]
  if (kind === 'repeated-adaptive') first.development!.mode = 'adaptive'
  if (kind === 'null-agency') first.agency = null
  if (kind === 'missing-direction-proof') first.checks['viable-agency'].evidence = [first.checks['seed-purpose'].evidence[0]]
  expect(new Ajv().compile(chatOpeningKeyedReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(() => parseChatOpeningKeyedReviewV1(wire, f.source, f.candidates)).toThrow()
})
