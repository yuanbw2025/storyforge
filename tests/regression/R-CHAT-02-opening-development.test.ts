import {afterEach, beforeEach, expect, it} from 'vitest'
import Ajv from 'ajv'
import {db} from '../../src/lib/db/schema'
import {CHAT_OPENING_DEVELOPMENT_GATE_V3} from '../../src/lib/character-interaction/opening-development'
import {chatOpeningReviewOutputSchemaV2, chatOpeningReviewOutputSchemaV3} from '../../src/lib/character-interaction/opening-review-output'
import {assertChatOpeningReviewedV1, createChatOpeningReviewV1, minimumChatOpeningReviewVersionV1, parseChatOpeningReviewDraftV1, readChatOpeningReviewV1} from '../../src/lib/character-interaction/situation-production-review'
import {chatOpeningAgencyReviewFixture, chatOpeningDevelopmentReviewFixture, seedChatNarrativeProductionFixture} from '../helpers/chat-narrative-production-fixture'

beforeEach(async () => {await db.delete(); await db.open()})
afterEach(async () => {await db.delete()})

async function fixture() {
  const f = await seedChatNarrativeProductionFixture({factDiscovery: true, privateCast: 'mixed'})
  const option = f.candidates.options[0], actor = option.situation.possibilities[0].actorKey
  option.situation.facts.push({factKey: 'spares', text: '柜台备有两种不同规格的旧零件，角色可使用并核对尺寸。', audienceKeys: ['player', actor], origin: 'author-private', sourceKnowledgeKey: null, sourceEventSequence: 0})
  option.situation.possibilities.push({actorKey: actor, text: '若原件不适用，可以核对备用零件的尺寸并权衡是否替换。', evidenceFactKeys: ['spares']})
  const draft = chatOpeningDevelopmentReviewFixture(f.candidates)
  const row = draft.options[0], development = row.development!
  development.mode = 'adaptive'
  development.possibilityIndex = 1
  development.basisFactKeys = ['spares']
  row.checks.find(c => c.check === 'open-development')!.evidence = [
    {target: 'option', pointer: '/situation/possibilities/1/text', quote: option.situation.possibilities[1].text},
    {target: 'option', pointer: `/situation/facts/${option.situation.facts.length - 1}/text`, quote: option.situation.facts[option.situation.facts.length - 1].text},
  ]
  return {...f, draft, row, development}
}

it('stores adaptive background evidence without adding facts or outcomes to the candidate, and reads it after serialization', async () => {
  const f = await fixture(), before = structuredClone(f.candidates)
  const report = await createChatOpeningReviewV1(f.draft, f.source, f.candidates, 3)
  const copied = JSON.parse(JSON.stringify(report))
  expect(readChatOpeningReviewV1(copied, {source: f.source, candidates: f.candidates, sourceHash: report.sourceHash, candidatesHash: report.candidatesHash})).toEqual(report)
  await expect(assertChatOpeningReviewedV1(copied, f.source, f.candidates, 'option-1', 3)).resolves.toEqual(report)
  expect(f.candidates).toEqual(before)
  f.development.expectedChange = 'changed after save'
  expect(report.options[0].development!.expectedChange).not.toBe(f.development.expectedChange)
})

it.each(['direct', 'conversation', 'wait'] as const)('does not require an invented second route for a structurally supported %s verdict', async mode => {
  const f = await seedChatNarrativeProductionFixture(), draft = chatOpeningDevelopmentReviewFixture(f.candidates)
  for (const row of draft.options) {
    row.development!.mode = mode
    row.agency!.mode = mode === 'wait' ? 'wait' : 'act'
  }
  expect(() => parseChatOpeningReviewDraftV1(draft, f.source, f.candidates, 3)).not.toThrow()
  // Modes have semantic requirements which these injected verdicts do not prove.
})

it.each(['missing proof', 'same direction', 'copied direction', 'hidden fact', 'foreign fact', 'wrong actor', 'missing quote', 'fabricated quote', 'invented direction', 'duplicate facts', 'empty change', 'empty unknown', 'fake wait', 'array mode', 'unknown mode', 'extra authority'] as const)('rejects unsupported development evidence: %s', async invalid => {
  const f = await fixture(), option = f.candidates.options[0], check = f.row.checks.find(c => c.check === 'open-development')!
  if (invalid === 'missing proof') f.row.development = null
  if (invalid === 'same direction') {
    f.development.possibilityIndex = 0
    f.development.basisFactKeys = [...f.row.agency!.basisFactKeys]
    check.evidence = structuredClone(f.row.checks.find(c => c.check === 'viable-agency')!.evidence)
  }
  if (invalid === 'copied direction') {
    option.situation.possibilities[1].text = option.situation.possibilities[0].text
    check.evidence[0].quote = option.situation.possibilities[1].text
  }
  if (invalid === 'hidden fact') f.development.basisFactKeys = ['hidden-note']
  if (invalid === 'foreign fact') f.development.basisFactKeys = ['not-in-this-option']
  if (invalid === 'wrong actor') f.development.possibilityIndex = option.situation.possibilities.push({...option.situation.possibilities[1], actorKey: f.source.participants[1].participantKey}) - 1
  if (invalid === 'missing quote') check.evidence.pop()
  if (invalid === 'fabricated quote') check.evidence[1].quote = '所有后续权限均已获得'
  if (invalid === 'invented direction') f.development.possibilityIndex = 99
  if (invalid === 'duplicate facts') f.development.basisFactKeys.push('spares')
  if (invalid === 'empty change') f.development.expectedChange = ''
  if (invalid === 'empty unknown') f.development.unresolved = ' '
  if (invalid === 'fake wait') f.development.mode = 'wait'
  if (invalid === 'array mode') Object.assign(f.development, {mode: ['direct']})
  if (invalid === 'unknown mode') Object.assign(f.development, {mode: 'guaranteed'})
  if (invalid === 'extra authority') Object.assign(f.development, {permission: 'open everything'})
  expect(() => parseChatOpeningReviewDraftV1(f.draft, f.source, f.candidates, 3)).toThrow(['same direction', 'copied direction'].includes(invalid) ? '后续办法' : undefined)
})

it('retains a first-step pass and a development rejection, and prevents choosing that opening', async () => {
  const f = await fixture()
  f.row.development = null
  const check = f.row.checks.find(c => c.check === 'open-development')!
  check.passed = false
  check.reason = '第一步仅支持观察，候选没有支持后续接触或独立办法的背景。'
  const report = await createChatOpeningReviewV1(f.draft, f.source, f.candidates, 3)
  expect(report.options[0].agency).not.toBeNull()
  await expect(assertChatOpeningReviewedV1(report, f.source, f.candidates, 'option-1', 3)).rejects.toThrow('未通过')
  await expect(assertChatOpeningReviewedV1(report, f.source, f.candidates, 'option-2', 3)).resolves.toEqual(report)
})

it('keeps legacy reports and schema readable but cannot promote them to a new development contract', async () => {
  const f = await fixture(), draft = chatOpeningAgencyReviewFixture(f.candidates)
  const old = await createChatOpeningReviewV1(draft, f.source, f.candidates, 2)
  await expect(assertChatOpeningReviewedV1(old, f.source, f.candidates, 'option-1', 2)).resolves.toEqual(old)
  await expect(assertChatOpeningReviewedV1(old, f.source, f.candidates, 'option-1', 3)).rejects.toThrow('旧报告保持原样')
  const ajv = new Ajv(), v2 = ajv.compile(chatOpeningReviewOutputSchemaV2(f.source, f.candidates).schema)
  const schema = chatOpeningReviewOutputSchemaV3(f.source, f.candidates), v3 = ajv.compile(schema.schema)
  expect(v2(draft)).toBe(true)
  expect(v2(f.draft)).toBe(false)
  expect(v3(draft)).toBe(false)
  expect(v3(f.draft)).toBe(true)
  expect(JSON.stringify(schema)).not.toMatch(/"anyOf"|"oneOf"|"\$ref"/)
  expect(minimumChatOpeningReviewVersionV1([CHAT_OPENING_DEVELOPMENT_GATE_V3])).toBe(3)
  expect(minimumChatOpeningReviewVersionV1(['chat.opening-grounded-agency.v2'])).toBe(2)
  expect(minimumChatOpeningReviewVersionV1([])).toBe(1)
})
