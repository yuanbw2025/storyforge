import {expect, it} from 'vitest'
import {createHash} from 'node:crypto'
import Ajv from 'ajv'
import real from '../fixtures/character-chat-natural-disclosure-v356.json'
import {chatConsolidatedActionPromptV1} from '../../src/lib/character-interaction/action-instructions'
import type {InteractionVisibilityView} from '../../src/lib/character-interaction/runtime'
import {chatActionRequestOptionsV1} from '../../src/lib/character-interaction/action-output-contract'
import {compileChatActionWireV1} from '../../src/lib/character-interaction/action-wire'
import {bindChatOwnEvidenceV1} from '../../src/lib/character-interaction/action-evidence-binding'
import {applyReviewedChatNarrativeActionV1, parseChatNarrativeActionV1, previewChatNarrativeActionV1} from '../../src/lib/character-interaction/narrative-actions'
import {chatActionReviewFixture} from '../helpers/chat-narrative-fixture'
import type {CharacterInteractionRuntimeState} from '../../src/lib/types'

const versions = [
  ['chat-narrative-action-v69', 'chat-narrative-action-v68'],
  ['chat-narrative-options-v41', 'chat-narrative-options-v40'],
  ['chat-action-revision-v24', 'chat-action-revision-v23'],
] as const
const state = () => structuredClone(real.state.interaction) as unknown as CharacterInteractionRuntimeState
const natural = () => ({...structuredClone(real.response.action), disclosures: real.response.action.disclosures.map(d => ({...d, wording: 'equivalent'}))})
function output(version: string, equivalent: boolean) {
  const action: Record<string, unknown> = equivalent ? natural() : structuredClone(real.response.action)
  if (version.startsWith('chat-narrative-action-')) return {...real.response, action}
  delete action.turnCompletion
  return version.startsWith('chat-narrative-options-') ? {options: [action, structuredClone(action)]} : action
}
function canonical(value: unknown, version: string) {
  value = structuredClone(value)
  if (!version.startsWith('chat-narrative-action-')) delete (value as Record<string, unknown>).turnCompletion
  return parseChatNarrativeActionV1(bindChatOwnEvidenceV1(compileChatActionWireV1(value, version, ['player', 'participant.001']), version))
}
const envelope = (action: ReturnType<typeof canonical>) => ({sequence: real.state.lastSequence + 1,
  triggerSequence: real.state.interaction.chatNarrative.triggers.at(-1)!.requestedSequence,
  actorKey: 'participant.001', messageId: 'retained-expression-regression', action})

it('retains the exact original raw failure and does not silently repair its old contract', () => {
  expect(createHash('sha256').update(real.rawText).digest('hex')).toBe(real.rawSha256)
  expect(JSON.parse(real.rawText)).toEqual(real.response)
  const before = state(), action = canonical(real.response.action, versions[0][1])
  const fact = before.chatNarrative!.situation.facts.find(f => f.factKey === action.disclosures[0].factKey)!
  expect(action.disclosures[0].evidenceExcerpt).not.toContain(fact.text)
  expect(action.disclosures[0].evidenceExcerpt).toContain(JSON.parse(fact.text))
  expect(() => previewChatNarrativeActionV1(before, envelope(action))).toThrow(real.expectedFailure)
  expect(before).toEqual(state())
})

it.each(versions)('preserves the %s predecessor transport byte for byte', (_current, legacy) => {
  const options = chatActionRequestOptionsV1(legacy, 'codex')!
  const hash = createHash('sha256').update(JSON.stringify(options)).digest('hex')
  const expected = (real.legacySchemaHashes as Record<string, string>)[legacy]
  expect(expected).toBeDefined()
  expect(hash).toBe(expected)
  const validate = new Ajv().compile(options.jsonSchema!.schema)
  expect(validate(output(legacy, false))).toBe(true)
  expect(validate(output(legacy, true))).toBe(true)
})

it.each(versions)('requires explicit independently reviewed disclosure in %s for both provider schemas', (current) => {
  for (const provider of ['codex', 'agnes'] as const) {
    const options = chatActionRequestOptionsV1(current, provider)
    expect(options, 'new version must provide a strict transport schema').toBeDefined()
    const validate = new Ajv().compile(options!.jsonSchema!.schema)
    expect(validate(output(current, false))).toBe(false)
    expect(validate(output(current, true))).toBe(true)
  }
})

it.each(versions)('rejects missing disclosure mode before retaining a new %s candidate', (current) => {
  const missing: Record<string, unknown> = structuredClone(real.response.action)
  if (!current.startsWith('chat-narrative-action-')) delete missing.turnCompletion
  expect(() => compileChatActionWireV1(missing, current, ['player', 'participant.001'])).toThrow('披露必须显式声明完整等义审查')
  expect(canonical(natural(), current).disclosures[0].wording).toBe('equivalent')
})

it('requires the existing per-fact independent review before applying a new natural expression', () => {
  const before = state(), action = canonical(natural(), versions[0][0]), input = envelope(action)
  expect(() => previewChatNarrativeActionV1(before, input)).not.toThrow()
  expect(() => applyReviewedChatNarrativeActionV1(before, {...input, review: chatActionReviewFixture(action)})).toThrow()
  for (const passed of [false, true]) {
    const review = {...chatActionReviewFixture(action), disclosureChecks: [{factKey: action.disclosures[0].factKey, passed, reason: 'Engineering fixture; actual semantic quality remains a real-model obligation.'}]}
    if (!passed) expect(() => applyReviewedChatNarrativeActionV1(before, {...input, review})).toThrow()
    else {
      const after = applyReviewedChatNarrativeActionV1(before, {...input, review})
      expect(after.chatNarrative!.situation.goals[0].status).toBe('fulfilled')
      expect(after.chatNarrative!.situation.facts.find(f => f.factKey === action.disclosures[0].factKey)!.audienceKeys).toContain('player')
    }
    expect(before).toEqual(state())
  }
})

it('preserves the original v68 expression prompt bytes retained from the failed real run', () => {
  const saved = real.legacyPrompt
  expect(createHash('sha256').update(saved.systemText).digest('hex')).toBe(saved.systemSha256)
  expect(chatConsolidatedActionPromptV1(saved.view as unknown as InteractionVisibilityView, saved.audience, saved.wireExample)).toBe(saved.systemText)
})
