import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {normalizeChatReviewResponseV1} from '../../src/lib/character-interaction/review-normalization'
import {parseChatNarrativeActionReviewV1, chatNarrativeActionReviewPassedV1} from '../../src/lib/character-interaction/narrative-actions'
import {bindChatNarrativeOptionsReviewV1} from '../../src/lib/character-interaction/narrative-options'
import {canonicalStringify} from '../../src/lib/agent/run/hash'
import {createInitialInteractionState} from '../../src/lib/character-interaction/runtime'
import {chatNarrativeFixture, chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'
import {db} from '../../src/lib/db/schema'
import {readInstanceAgentRunV1} from '../../src/lib/agent/run/event-store'
import {isImportedCompletedInteractionRunV1, readResumableInteractionRunsV1} from '../../src/lib/character-interaction/runtime-run-recovery'
import {readChatContextInspectionV1} from '../../src/lib/character-interaction/context-inspector'
import {readChatActionRevisionSourceV1} from '../../src/lib/character-interaction/action-revision'
import * as skills from '../../src/lib/agent/skill-registry'
import {generateInteractionRuntimeCandidateV1, adoptInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1, readInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger, branchProductRuntimeSession, deleteProductRuntimeSession} from '../../src/lib/character-interaction/runtime-api'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatNarrativeActionV1} from '../../src/lib/types/chat-narrative'

const originalSkill = skills.getAgentSkillV1
function useSavedLiteralContract() {
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action'
    ? {...originalSkill(id), promptVersion: 'chat-narrative-action-v68'} : id === 'character.chat-narrative-action-review'
      ? {...originalSkill(id), promptVersion: 'chat-narrative-action-review-v41'} : originalSkill(id))
}
const version = 'chat-narrative-action-review-v24'
function action(): ChatNarrativeActionV1 {
  const text = createInitialInteractionState(chatNarrativeFixture()).chatNarrative!.situation.facts.find(f => f.factKey === 'regret')!.text
  return {kind: 'speak', text, goalKey: 'find-seal', evidenceFactKeys: ['regret'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
    newFacts: [], disclosures: [{factKey: 'regret', toParticipantKeys: ['player'], evidenceExcerpt: text}], threadUpdates: [], goalStatus: null}
}
const check = (factKey = 'regret', passed = true) => ({factKey, passed, reason: '注入的工程审查结果，不代表真实语义质量。'})
const output = () => ({...chatActionReviewOutputFixture(), disclosureChecks: [check()]})
function parse(row: Record<string, unknown>, a = action(), promptVersion = version) {
  const normalized = normalizeChatReviewResponseV1({output: row, actions: [a], options: false, promptVersion})
  return {normalized, review: parseChatNarrativeActionReviewV1({...normalized.output, reviewedActionJson: canonicalStringify(a)}, a)}
}

it('accepts a redundant affirmative exact-quotation check without changing the action or raw output', () => {
  const a = action(), row = output(), original = structuredClone({a, row}), {normalized, review} = parse(row, a)
  expect(normalized.removed).toEqual([{optionKey: null, factKey: 'regret'}])
  expect(review.disclosureChecks).toEqual([]); expect(chatNarrativeActionReviewPassedV1(review)).toBe(true)
  expect({a, row}).toEqual(original)
  expect(parseChatNarrativeActionReviewV1({...row, disclosureChecks: [], reviewedActionJson: canonicalStringify(a)}, a)).toEqual(review)
})

it.each([undefined, 'chat-narrative-action-review-v23', 'chat-narrative-options-review-v17'])('keeps frozen %s response parsing unchanged', promptVersion => {
  const row = output(), a = action()
  const normalized = normalizeChatReviewResponseV1({output: row, actions: [a], options: false, promptVersion})
  expect(normalized.output).toBe(row); expect(normalized.removed).toEqual([])
  expect(() => parseChatNarrativeActionReviewV1({...normalized.output, reviewedActionJson: canonicalStringify(a)}, a)).toThrow('不完整')
})

it.each(['rejected', 'unknown-fact', 'duplicate', 'wrong-type', 'empty-reason', 'extra-field', 'null', 'over-limit'] as const)('never masks %s disclosure evidence', kind => {
  const row: Record<string, unknown> = output(), checks = row.disclosureChecks as Array<Record<string, unknown>>
  if (kind === 'rejected') checks[0].passed = false
  if (kind === 'unknown-fact') checks[0].factKey = 'unmentioned-secret'
  if (kind === 'duplicate') checks.push({...checks[0]})
  if (kind === 'wrong-type') checks[0].passed = 'true'
  if (kind === 'empty-reason') checks[0].reason = ' '
  if (kind === 'extra-field') checks[0].override = true
  if (kind === 'null') row.disclosureChecks = null
  if (kind === 'over-limit') row.disclosureChecks = Array.from({length: 13}, () => check())
  const saved = structuredClone(row)
  expect(() => parse(row)).toThrow(); expect(row).toEqual(saved)
})

it('keeps required paraphrase checks and their failures while removing only the redundant literal check', () => {
  const a = action(); a.disclosures.push({factKey: 'other', toParticipantKeys: ['player'], evidenceExcerpt: a.text, wording: 'equivalent'})
  expect(() => parse(output(), a)).toThrow('不完整')
  const row = {...output(), disclosureChecks: [check(), check('other', false)]}, {review} = parse(row, a)
  expect(review.disclosureChecks).toEqual([check('other', false)]); expect(chatNarrativeActionReviewPassedV1(review)).toBe(false)
  const rejected = output(); rejected.checks.find(c => c.check === 'visibility')!.passed = false
  expect(chatNarrativeActionReviewPassedV1(parse(rejected).review)).toBe(false)
})

it('binds reversed option reviews to the right candidate and refuses mixed or duplicate identities', () => {
  const a = action(), b = {...action(), text: action().text + '我们慢慢谈。', disclosures: [{...action().disclosures[0], factKey: 'other'}]}
  const row = {options: [{optionKey: 'option-2', ...output(), disclosureChecks: [check('other')]}, {optionKey: 'option-1', ...output()}]}
  const normalize = (value: Record<string, unknown>) => normalizeChatReviewResponseV1({output: value, actions: [a, b], options: true, promptVersion: 'chat-narrative-options-review-v18'})
  const normalized = normalize(row), bound = bindChatNarrativeOptionsReviewV1(normalized.output, [a, b])
  expect(normalized.removed).toEqual([{optionKey: 'option-2', factKey: 'other'}, {optionKey: 'option-1', factKey: 'regret'}])
  expect(bound.optionReviews.every(r => chatNarrativeActionReviewPassedV1(r.review))).toBe(true)
  expect(() => normalize({options: [{...row.options[0], disclosureChecks: [check()]}, row.options[1]]})).toThrow('当前候选')
  expect(() => normalize({options: [row.options[0], row.options[0]]})).toThrow('重复')
})

const sharedVersion = 'chat-narrative-action-review-v26'
function sharedAction(): ChatNarrativeActionV1 {
  return {...action(), text: '山路被倒树挡住，驿站里暂时安全。', evidenceFactKeys: ['road'], disclosures: []}
}
function sharedInput() {
  const state = createInitialInteractionState(chatNarrativeFixture())
  state.activeScene = {...state.sceneTemplates[0], sceneId: 'inn.current', status: 'active', activeParticipantKeys: ['guard', 'artisan'], startedAtSequence: 1, endedAtSequence: null, playerTurns: 0}
  return {output: {...output(), disclosureChecks: [check('road')]}, actions: [sharedAction()], options: false,
    promptVersion: sharedVersion, state, actorKey: 'guard'}
}
it('normalizes only affirmative checks for cited pre-existing facts already known to every listener', () => {
  const input = sharedInput(), original = structuredClone(input), normalized = normalizeChatReviewResponseV1(input)
  expect(normalized.removed).toEqual([{optionKey: null, factKey: 'road', basis: 'already-known'}])
  expect(input).toEqual(original)
  const review = parseChatNarrativeActionReviewV1({...normalized.output, reviewedActionJson: canonicalStringify(input.actions[0])}, input.actions[0])
  expect(review.disclosureChecks).toEqual([]); expect(chatNarrativeActionReviewPassedV1(review)).toBe(true)
})
it.each(['old-v24', 'old-v25', 'old-options', 'no-state', 'no-actor', 'offstage', 'not-cited', 'not-found', 'duplicate-fact', 'private', 'actor-unaware', 'listener-unaware', 'player-unaware', 'new-fact', 'rejected', 'duplicate-check', 'extra-field'] as const)('rejects invalid common-fact normalization: %s', kind => {
  const input = sharedInput(), a = input.actions[0], fact = input.state.chatNarrative!.situation.facts.find(f => f.factKey === 'road')!
  if (kind === 'old-v24') input.promptVersion = 'chat-narrative-action-review-v24'
  if (kind === 'old-v25') input.promptVersion = 'chat-narrative-action-review-v25'
  if (kind === 'old-options') input.promptVersion = 'chat-narrative-options-review-v19'
  if (kind === 'no-state') Reflect.deleteProperty(input, 'state')
  if (kind === 'no-actor') Reflect.deleteProperty(input, 'actorKey')
  if (kind === 'offstage') input.actorKey = 'outsider'
  if (kind === 'not-cited') a.evidenceFactKeys = ['lost']
  if (kind === 'not-found') input.state.chatNarrative!.situation.facts = []
  if (kind === 'duplicate-fact') input.state.chatNarrative!.situation.facts.push({...fact})
  if (kind === 'private') fact.audienceKeys = []
  if (kind === 'actor-unaware') fact.audienceKeys = ['player']
  if (kind === 'listener-unaware') {a.audienceKeys.push('artisan'); fact.audienceKeys = ['player', 'guard']}
  if (kind === 'player-unaware') fact.audienceKeys = ['guard']
  if (kind === 'new-fact') a.newFacts = [{factKey: 'road', kind: 'observation', text: a.text, evidenceFactKeys: ['lost'], evidenceExcerpt: a.text}]
  if (kind === 'rejected') input.output.disclosureChecks[0].passed = false
  if (kind === 'duplicate-check') input.output.disclosureChecks.push(check('road'))
  if (kind === 'extra-field') Object.assign(input.output.disclosureChecks[0], {ignore: true})
  const original = structuredClone(input)
  expect(() => normalizeChatReviewResponseV1(input)).toThrow(); expect(input).toEqual(original)
})
it('keeps core and required paraphrase rejection alongside redundant common-fact approval', () => {
  const input = sharedInput(), a = input.actions[0]
  a.disclosures = [{factKey: 'regret', toParticipantKeys: ['player'], evidenceExcerpt: '旧日误会', wording: 'equivalent'}]
  expect(() => parseChatNarrativeActionReviewV1({...normalizeChatReviewResponseV1(input).output, reviewedActionJson: canonicalStringify(a)}, a)).toThrow()
  input.output.disclosureChecks.push(check('regret', false)); input.output.checks.find(c => c.check === 'continuity')!.passed = false
  const review = parseChatNarrativeActionReviewV1({...normalizeChatReviewResponseV1(input).output, reviewedActionJson: canonicalStringify(a)}, a)
  expect(review.disclosureChecks).toEqual([check('regret', false)]); expect(chatNarrativeActionReviewPassedV1(review)).toBe(false)
})
it('does not borrow facts or listener knowledge from the other option', () => {
  const input = sharedInput(), b = {...sharedAction(), text: '铜印失踪。', evidenceFactKeys: ['lost']}
  const options = [{optionKey: 'option-2', ...output(), disclosureChecks: [check('lost')]}, {optionKey: 'option-1', ...input.output}]
  const normalize = () => normalizeChatReviewResponseV1({...input, actions: [input.actions[0], b], options: true, promptVersion: 'chat-narrative-options-review-v20', output: {options}})
  expect(bindChatNarrativeOptionsReviewV1(normalize().output, [input.actions[0], b]).optionReviews.every(r => chatNarrativeActionReviewPassedV1(r.review))).toBe(true)
  options[0].disclosureChecks = [check('road')]; expect(normalize).toThrow()
})

describe('durable review normalization', () => {
  beforeEach(async () => {db.close(); await db.delete(); await db.open()})
  afterEach(() => {vi.restoreAllMocks(); db.close()})
  async function prepared() {
    const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
    await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'normalization.start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence})
    return f
  }
  const input = (f: Awaited<ReturnType<typeof prepared>>) => ({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action' as const,
    objective: '逐字披露审查冗余通过项的工程检查', runAI: withChatActionChoiceFixture(async () => JSON.stringify(action())), runReviewAI: async () => JSON.stringify(output())})

  it('saved v68: resumes the saved candidate, retains raw and conversion evidence, adopts once and restores after parent deletion', async () => {
    useSavedLiteralContract()
    const f = await prepared(), before = await readProductRuntimeState(f.sessionId); let runId = 0, calls = 0
    await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(action())}),
      onNarrativeActionSaved: id => {runId = id; throw Error('saved')}})).rejects.toThrow('saved')
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before); db.close(); await db.open()
    await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(output())}})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
    const after = await readProductRuntimeState(f.sessionId), read = await readInteractionRuntimeCandidateV1(f.scope, runId)
    expect(calls).toBe(2); expect(after.interaction!.messages).toHaveLength(1)
    expect(after.interaction!.chatNarrative!.situation.facts.find(f => f.factKey === 'regret')!.audienceKeys).toEqual(['guard', 'player'])
    expect(read.candidate.kind === 'chat-narrative-action-candidate' && read.candidate.review?.disclosureChecks).toEqual([])
    const artifacts = await db.agentRunArtifacts.toArray(), reports = artifacts.filter(a => a.artifactKind === 'tool-result' && a.content?.includes('storyforge.chat-review-normalization'))
    expect(reports).toHaveLength(1); expect(JSON.parse(reports[0].content!).removed).toEqual([{optionKey: null, factKey: 'regret'}])
    expect(artifacts.some(a => a.artifactKind === 'raw-response' && a.content === JSON.stringify(output()))).toBe(true)
    const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: '逐字审查分支'})
    const expected = (await readProductRuntimeState(branch.id!)).interaction; await deleteProductRuntimeSession(f.sessionId)
    const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
    const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
    expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(expected)
    expect((await db.agentRunArtifacts.where('projectId').equals(projectId).toArray()).some(a => a.content === reports[0].content)).toBe(true)
  })

  it('resumes a shared-fact review with the unchanged pre-state, preserving conversion and source across import', async () => {
    const f = await prepared(), a = sharedAction(), row = sharedInput().output; let runId = 0, calls = 0
    await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(a)}), onNarrativeActionSaved: id => {runId = id; throw Error('saved')}})).rejects.toThrow('saved')
    const before = await readProductRuntimeState(f.sessionId); db.close(); await db.open()
    await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async () => {calls++; return JSON.stringify(row)}})
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId}); await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
    const after = await readProductRuntimeState(f.sessionId), artifacts = await db.agentRunArtifacts.toArray()
    expect(calls).toBe(2); expect(after.interaction!.messages).toHaveLength(1)
    expect(after.interaction!.chatNarrative!.situation).toEqual(before.interaction!.chatNarrative!.situation)
    const report = artifacts.find(a => a.artifactKind === 'tool-result' && a.content?.includes('redundant-affirmative-disclosure-checks-v2'))!
    expect(JSON.parse(report.content!).removed).toEqual([{optionKey: null, factKey: 'road', basis: 'already-known'}])
    expect(JSON.parse(report.content!).baseStateHash).toBe((await readInstanceAgentRunV1(f.scope, runId)).contract.scope.runtime!.stateHash)
    const importedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId)), imported = (await db.productRuntimeSessions.where('projectId').equals(importedProject).toArray())[0]
    expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(after.interaction)
    const retained = (await db.agentRunArtifacts.where('projectId').equals(importedProject).toArray()).map(a => a.content)
    expect(retained).toContain(report.content); expect(retained).toContain(JSON.stringify(row))
  })

  it('saved v68: keeps completed runtime and context history across three imports without restarting old calls', async () => {
    useSavedLiteralContract()
    const f = await prepared(), candidate = await generateInteractionRuntimeCandidateV1(input(f))
    await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: candidate.snapshot.run.id})
    const expected = (await readProductRuntimeState(f.sessionId)).interaction
    let currentProjectId = f.scope.projectId
    for (let count = 0; count < 3; count++) {
      const projectId = await importProjectJSON(await exportProjectJSON(currentProjectId))
      const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
      const scope = {projectId, worldId: session.worldId!, workId: session.workId!}
      const row = (await db.agentRuns.where('productRuntimeSessionId').equals(session.id!).toArray())[0]
      const snapshot = await readInstanceAgentRunV1(scope, row.id!), events = await db.productRuntimeEvents.where('sessionId').equals(session.id!).toArray()
      expect(isImportedCompletedInteractionRunV1(snapshot, events)).toBe(true)
      expect(await readResumableInteractionRunsV1(scope, session.id!)).toEqual([])
      expect((await readChatContextInspectionV1(scope, session.id!, row.id!)).available).toBe(true)
      expect((await readProductRuntimeState(session.id!)).interaction).toEqual(expected)
      expect(snapshot.events.filter(e => e.type === 'verification.staled')).toHaveLength(1)
      expect(snapshot.projection.terminalReceiptHash).toBeUndefined()
      currentProjectId = projectId
    }
  })

  it.each(['old-contract', 'literal-rejection', 'missing-paraphrase'] as const)('keeps %s failed and unadopted with no hidden retry', async kind => {
    const f = await prepared(), before = await readProductRuntimeState(f.sessionId), a = action(), row = output(); let calls = 0, runId = 0
    if (kind === 'old-contract') {
      const original = skills.getAgentSkillV1
      vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => id === 'character.chat-narrative-action-review' ? {...original(id), promptVersion: 'chat-narrative-action-review-v23'} : id === 'character.chat-narrative-action' ? {...original(id), promptVersion: 'chat-narrative-action-v45'} : original(id))
    }
    if (kind === 'literal-rejection') {useSavedLiteralContract(); row.disclosureChecks[0].passed = false}
    if (kind === 'missing-paraphrase') {a.disclosures[0].wording = 'equivalent'; row.disclosureChecks = []}
    await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(a)}), runReviewAI: async () => {calls++; return JSON.stringify(row)}, onRunCreated: id => {runId = id}})).rejects.toThrow()
    expect(calls).toBe(2); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
    expect((await db.agentRuns.get(runId))!.status).toBe('failed')
    expect((await db.agentRunArtifacts.toArray()).some(a => a.artifactKind === 'raw-response' && a.content === JSON.stringify(row))).toBe(true)
  })

  it.each([true, false])('keeps current full-equivalence review authoritative without removing its result (passed=%s)', async passed => {
    const f = await prepared(), before = await readProductRuntimeState(f.sessionId), a = action(), row = output()
    a.disclosures[0].wording = 'equivalent'; row.disclosureChecks[0].passed = passed
    let runId = 0, calls = 0
    const request = {...input(f), onRunCreated: (id: number) => {runId = id},
      runAI: withChatActionChoiceFixture(async () => {calls++; return JSON.stringify(a)}),
      runReviewAI: async () => {calls++; return JSON.stringify(row)}}
    if (passed) {
      const generated = await generateInteractionRuntimeCandidateV1(request)
      expect(generated.snapshot.contract.executionBindings?.map(binding => binding.promptVersion))
        .toEqual(['chat-narrative-action-v72', 'chat-narrative-action-v72', 'chat-narrative-action-review-v42'])
      const retained = await readInteractionRuntimeCandidateV1(f.scope, runId)
      expect(retained.candidate.kind === 'chat-narrative-action-candidate' && retained.candidate.review?.disclosureChecks).toEqual(row.disclosureChecks)
      await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
      expect((await readProductRuntimeState(f.sessionId)).interaction!.chatNarrative!.situation.facts.find(fact => fact.factKey === 'regret')!.audienceKeys).toEqual(['guard', 'player'])
    } else {
      await expect(generateInteractionRuntimeCandidateV1(request)).rejects.toThrow('语义审查未通过')
      await expect(adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})).rejects.toThrow()
      expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
      expect((await db.agentRuns.get(runId))!.status).toBe('failed')
    }
    expect(calls).toBe(2)
    const artifacts = await db.agentRunArtifacts.toArray()
    expect(artifacts.some(artifact => artifact.artifactKind === 'raw-response' && artifact.content === JSON.stringify(row))).toBe(true)
    expect(artifacts.filter(artifact => artifact.artifactKind === 'tool-result' && artifact.content?.includes('storyforge.chat-review-normalization'))).toEqual([])
  })

  it('allows only consequence-only revision after common-fact normalization', async () => {
    const f = await prepared(), row = sharedInput().output; let runId = 0
    row.checks.find(c => c.check === 'consequences')!.passed = false
    await expect(generateInteractionRuntimeCandidateV1({...input(f), runAI: withChatActionChoiceFixture(async () => JSON.stringify(sharedAction())), runReviewAI: async () => JSON.stringify(row), onRunCreated: id => {runId = id}})).rejects.toThrow('语义审查未通过')
    expect((await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId}))?.runId).toBe(runId)
    expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(0)
  })

  it('saved v68: retains consequence-only revision eligibility under the same new normalization contract', async () => {
    useSavedLiteralContract()
    const f = await prepared(), row = output(); let runId = 0
    row.checks.find(c => c.check === 'consequences')!.passed = false
    await expect(generateInteractionRuntimeCandidateV1({...input(f), runReviewAI: async () => JSON.stringify(row), onRunCreated: id => {runId = id}})).rejects.toThrow('语义审查未通过')
    expect((await readChatActionRevisionSourceV1({scope: f.scope, sessionId: f.sessionId}))?.runId).toBe(runId)
    expect((await db.agentRuns.get(runId))!.status).toBe('failed')
    expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(0)
  })
})
