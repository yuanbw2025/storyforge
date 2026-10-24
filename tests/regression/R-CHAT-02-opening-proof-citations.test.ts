import {createHash} from 'node:crypto'
import {afterEach, beforeEach, expect, it} from 'vitest'
import Ajv from 'ajv'
import {db} from '../../src/lib/db/schema'
import {chatOpeningProofReviewSchemaV1, parseChatOpeningProofReviewV1} from '../../src/lib/character-interaction/opening-review-proof-citations'
import {chatOpeningKeyedReviewSchemaV1, chatOpeningKeyedReviewPromptV1, parseChatOpeningKeyedReviewV1} from '../../src/lib/character-interaction/opening-review-keyed'
import {chatOpeningDevelopmentReviewFixture, chatOpeningKeyedReviewFixture, chatOpeningProofReviewFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})

it('expands only explicit proof identities into exact original excerpts while preserving every verdict, proof and source', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true})
  const draft = chatOpeningDevelopmentReviewFixture(f.candidates, f.candidates.options[1].optionKey)
  const wire = chatOpeningProofReviewFixture(f.source, f.candidates, draft), before = structuredClone({wire, source: f.source, candidates: f.candidates})
  expect(new Ajv().compile(chatOpeningProofReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toEqual(draft)
  expect({wire, source: f.source, candidates: f.candidates}).toEqual(before)
  const old = chatOpeningKeyedReviewFixture(f.source, f.candidates, draft)
  expect(() => parseChatOpeningProofReviewV1(old, f.source, f.candidates)).toThrow()
  expect(() => parseChatOpeningKeyedReviewV1(wire, f.source, f.candidates)).toThrow()
})

it('preserves independently captured v12 prompt and schema bytes even after constructing v13', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true}), hash = (text: string) => createHash('sha256').update(text).digest('hex')
  chatOpeningProofReviewSchemaV1(f.source, f.candidates)
  expect(hash(chatOpeningKeyedReviewPromptV1())).toBe('f9fb242efe185860c9d9719860e55fbb8fae97c6aee05eb00bc1d2248bd2168e')
  expect(hash(JSON.stringify(chatOpeningKeyedReviewSchemaV1(f.source, f.candidates)))).toBe('71fc458a95c1758276753346dbabcf240b992091ae9e193d85b16c0f01c81b8a')
})

it.each(['known-but-undeclared', 'secret', 'unknown', 'wrong-proof', 'mixed-proof-and-refs', 'missing-evidence', 'missing-proof', 'wrong-actor', 'repeated-adaptive', 'duplicate-fact'] as const)('rejects %s without adding facts, replacing proof or repairing the raw response', async kind => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true})
  const wire = chatOpeningProofReviewFixture(f.source, f.candidates), first = Object.values(wire.options)[0]
  if (kind === 'known-but-undeclared') first.agency!.basisFactKeys = ['parcel']
  if (kind === 'secret') first.agency!.basisFactKeys = ['hidden-note']
  if (kind === 'unknown') first.agency!.basisFactKeys = ['missing-fact']
  if (kind === 'wrong-proof') first.checks['viable-agency'].evidence = {proof: 'development'}
  if (kind === 'mixed-proof-and-refs') Object.assign(first.checks['viable-agency'].evidence, {refs: []})
  if (kind === 'missing-evidence') Reflect.deleteProperty(first.checks['viable-agency'], 'evidence')
  if (kind === 'missing-proof') first.agency = null
  if (kind === 'wrong-actor') first.agency!.actorKey = 'not-the-actor'
  if (kind === 'repeated-adaptive') first.development!.mode = 'adaptive'
  if (kind === 'duplicate-fact') first.agency!.basisFactKeys.push(first.agency!.basisFactKeys[0])
  const before = structuredClone(wire)
  if (kind !== 'missing-proof') expect(new Ajv().compile(chatOpeningProofReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(false)
  expect(() => parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toThrow()
  expect(wire).toEqual(before)
})

it('keeps complete explicit references valid and rejects an omitted development excerpt instead of silently completing it', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true}), draft = chatOpeningDevelopmentReviewFixture(f.candidates)
  const original = chatOpeningKeyedReviewFixture(f.source, f.candidates, draft), wire = chatOpeningProofReviewFixture(f.source, f.candidates, draft)
  const first = Object.values(wire.options)[0], prior = Object.values(original.options)[0]
  for (const key of ['viable-agency', 'open-development']) first.checks[key].evidence = {refs: structuredClone(prior.checks[key].evidence)}
  expect(parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toEqual(draft)
  first.checks['open-development'].evidence = {refs: [prior.checks['seed-purpose'].evidence[0]]}
  expect(new Ajv().compile(chatOpeningProofReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(() => parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toThrow('发展依据缺少')
})

it('allows a rejected null proof with explicit rejection references, including a candidate with no usable direction', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true}), draft = chatOpeningDevelopmentReviewFixture(f.candidates, f.candidates.options[0].optionKey)
  const first = draft.options[0]
  first.development = null
  const check = first.checks.find(check => check.check === 'open-development')!
  check.passed = false; check.evidence = [{target: 'option', pointer: '/title', quote: f.candidates.options[0].title}]
  f.candidates.options[0].situation.possibilities = []
  const wire = chatOpeningProofReviewFixture(f.source, f.candidates, draft)
  expect(new Ajv().compile(chatOpeningProofReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toEqual(draft)
  Object.values(wire.options)[0].checks['viable-agency'].passed = true
  expect(() => parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toThrow('必须有可核验')
})

it('retains exact bounded excerpts and the complete original when a selected proof cites long Unicode text', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true}), option = f.candidates.options[0]
  option.situation.facts[0].text = '甲'.repeat(799) + '😀' + '乙'.repeat(500)
  const sourceBefore = structuredClone(f), draft = chatOpeningDevelopmentReviewFixture(f.candidates)
  // The engineering encoder chooses only a bounded original excerpt; the
  // product wire explicitly cites the fact identity through the complete proof.
  for (const check of draft.options[0].checks) for (const evidence of check.evidence) if (evidence.pointer === '/situation/facts/0/text') evidence.quote = option.situation.facts[0].text.slice(0, 799)
  const result = parseChatOpeningProofReviewV1(chatOpeningProofReviewFixture(f.source, f.candidates, draft), f.source, f.candidates)
  const proof = result.options[0].checks.find(check => check.check === 'viable-agency')!
  expect(proof.evidence.find(ref => ref.pointer === '/situation/facts/0/text')!.quote).toBe('甲'.repeat(799))
  expect(f).toEqual(sourceBefore)
})

it('keeps per-direction fact scope and adaptive semantics local even when union-based native choices allow another direction', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true}), option = f.candidates.options[0]
  option.situation.possibilities.push({actorKey: option.situation.possibilities[0].actorKey, text: '打开获准检查的蓝色布包，核对实际内容。', evidenceFactKeys: ['parcel']})
  const wire = chatOpeningProofReviewFixture(f.source, f.candidates), first = Object.values(wire.options)[0]
  first.development!.mode = 'adaptive'; first.development!.possibilityIndex = 1; first.development!.basisFactKeys = ['parcel']
  expect(new Ajv().compile(chatOpeningProofReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(parseChatOpeningProofReviewV1(wire, f.source, f.candidates).options[0].development!.possibilityIndex).toBe(1)
  first.agency!.basisFactKeys = ['parcel']
  expect(new Ajv().compile(chatOpeningProofReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(() => parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toThrow('方向未引用')
})
