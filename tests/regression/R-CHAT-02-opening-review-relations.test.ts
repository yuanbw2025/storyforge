import {afterEach, beforeEach, expect, it} from 'vitest'
import Ajv from 'ajv'
import {db} from '../../src/lib/db/schema'
import {chatOpeningRelationalReviewPromptV1, chatOpeningRelationalReviewSchemaV1} from '../../src/lib/character-interaction/opening-review-relations'
import {chatOpeningProofReviewPromptV1, chatOpeningProofReviewSchemaV1, parseChatOpeningProofReviewV1} from '../../src/lib/character-interaction/opening-review-proof-citations'
import {chatOpeningDevelopmentReviewFixture, chatOpeningProofReviewFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})

it('keeps the same proof wire, original report, full sources and historical v13 schema', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true})
  const before = structuredClone(f), originalSchema = JSON.stringify(chatOpeningProofReviewSchemaV1(f.source, f.candidates)), originalPrompt = chatOpeningProofReviewPromptV1()
  const draft = chatOpeningDevelopmentReviewFixture(f.candidates), wire = chatOpeningProofReviewFixture(f.source, f.candidates, draft)
  expect(new Ajv().compile(chatOpeningRelationalReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toEqual(draft)
  expect(f).toEqual(before)
  expect(JSON.stringify(chatOpeningProofReviewSchemaV1(f.source, f.candidates))).toBe(originalSchema)
  expect(chatOpeningProofReviewPromptV1()).toBe(originalPrompt)
  expect(chatOpeningRelationalReviewPromptV1()).toContain('顶层必须且只能是 {"options":{...}}')
})

it.each(['repeated-adaptive', 'same-text-adaptive', 'wrong-direction-fact', 'different-actor', 'wrong-goal', 'unexpected-wait', 'wait-to-act'] as const)('excludes %s before decoding and still rejects it locally without rewriting the proof', async kind => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true,
    ...(['different-actor', 'wrong-goal'].includes(kind) ? {privateCast: 'mixed' as const} : {}),
  }), option = f.candidates.options[0]
  const firstDirection = option.situation.possibilities[0]
  option.situation.possibilities.push({...firstDirection, text: '检查已经获准打开的蓝色布包，核对实际内容。', evidenceFactKeys: ['parcel']})
  const wire = chatOpeningProofReviewFixture(f.source, f.candidates), first = Object.values(wire.options)[0]
  if (kind === 'repeated-adaptive') first.development!.mode = 'adaptive'
  if (kind === 'same-text-adaptive') {
    option.situation.possibilities[1].text = firstDirection.text
    first.development!.mode = 'adaptive'; first.development!.possibilityIndex = 1; first.development!.basisFactKeys = ['parcel']
  }
  if (kind === 'wrong-direction-fact') first.agency!.basisFactKeys = ['parcel']
  if (kind === 'different-actor' || kind === 'wrong-goal') {
    const otherActor = f.source.participants[1].participantKey
    option.situation.goals.push({...option.situation.goals[0], actorKey: otherActor, goalKey: 'other-goal'})
    option.situation.possibilities[1].actorKey = otherActor
    if (kind === 'wrong-goal') first.agency!.goalKey = 'other-goal'
    else {first.development!.possibilityIndex = 1; first.development!.basisFactKeys = ['parcel']}
  }
  if (kind === 'unexpected-wait') first.development!.mode = 'wait'
  if (kind === 'wait-to-act') first.agency!.mode = 'wait'
  const original = structuredClone(wire)
  expect(new Ajv().compile(chatOpeningRelationalReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(false)
  expect(() => parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toThrow()
  expect(wire).toEqual(original)
})

it.each(['direct', 'conversation', 'adaptive', 'wait'] as const)('retains structurally valid %s with its own declared facts and unchanged verdict', async mode => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true}), option = f.candidates.options[0]
  option.situation.possibilities.push({...option.situation.possibilities[0], text: '检查获准打开的蓝色布包，确认实际内容。', evidenceFactKeys: ['parcel']})
  const wire = chatOpeningProofReviewFixture(f.source, f.candidates), first = Object.values(wire.options)[0]
  first.development!.mode = mode
  if (mode === 'adaptive') {first.development!.possibilityIndex = 1; first.development!.basisFactKeys = ['parcel']}
  if (mode === 'wait') first.agency!.mode = 'wait'
  const original = structuredClone(wire)
  expect(new Ajv().compile(chatOpeningRelationalReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  const report = parseChatOpeningProofReviewV1(wire, f.source, f.candidates)
  expect(report.options[0].development!.mode).toBe(mode)
  expect(report.options[0].checks.every(check => check.passed)).toBe(true)
  expect(wire).toEqual(original)
})

it('retains explicit negative null proofs, including no usable direction, without inventing an action', async () => {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true}), option = f.candidates.options[0]
  const draft = chatOpeningDevelopmentReviewFixture(f.candidates, option.optionKey), first = draft.options[0]
  first.development = null
  const check = first.checks.find(check => check.check === 'open-development')!
  check.passed = false; check.evidence = [{target: 'option', pointer: '/title', quote: option.title}]
  option.situation.possibilities = []
  const wire = chatOpeningProofReviewFixture(f.source, f.candidates, draft)
  expect(new Ajv().compile(chatOpeningRelationalReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(true)
  expect(parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toEqual(draft)
})

it('rejects copied input metadata rather than silently discarding extra response fields', async () => {
  const f = await seedChatNarrativeProductionFixture(), wire = {...chatOpeningProofReviewFixture(f.source, f.candidates), schema: 'copied-input', version: 1, buildNumber: 1, summary: 'extra'}
  expect(new Ajv().compile(chatOpeningRelationalReviewSchemaV1(f.source, f.candidates).schema)(wire)).toBe(false)
  expect(() => parseChatOpeningProofReviewV1(wire, f.source, f.candidates)).toThrow()
})
