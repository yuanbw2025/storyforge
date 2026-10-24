import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {generateInteractionRuntimeCandidateV1, resumeChatNarrativeReviewV1, adoptInteractionRuntimeCandidateV1} from '../../src/lib/character-interaction/harness'
import {readChatCandidateRetrievalVersion} from '../../src/lib/character-interaction/context-reader-version'
import {branchProductRuntimeSession, readProductRuntimeState, readProductRuntimeStateVersion, requestChatNarrativeTrigger} from '../../src/lib/character-interaction/runtime-api'
import {useHistoricalChatReaderFixture, freezeLegacyChatActionContractFixture} from '../helpers/chat-historical-reader'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {chatActionReviewOutputFixture, seedChatNarrativeRuntimeFixture, withChatActionChoiceFixture} from '../helpers/chat-narrative-fixture'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it.each(['current', 'saved-v8', 'saved-v13'] as const)('uses the original producer reader across review recovery and portable adoption: %s', async version => {
  const f = await seedChatNarrativeRuntimeFixture(), v = await readProductRuntimeStateVersion(f.sessionId)
  await requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: crypto.randomUUID(), baseSequence: v.sequence, baseStateHash: v.stateHash,
    kind: 'scene-start', sourceEventSequence: f.sceneSequence})
  const before = await readProductRuntimeState(f.sessionId), worlds = await db.worldReleases.toArray()
  // Produce the original v8 input; recovery must retain its older policy.
  if (version === 'saved-v8') {
    useHistoricalChatReaderFixture('chat-narrative-runtime-view-v8')
  }
  if (version === 'saved-v13') useHistoricalChatReaderFixture('chat-narrative-runtime-view-v13')
  let runId = 0, generated = 0, reviewed = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action',
    objective: '读取版本与恢复工程验证', runAI: withChatActionChoiceFixture(async () => {generated++; return JSON.stringify({kind: 'speak', text: '我会先核对铜印的借用登记。',
      goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null})}),
    onNarrativeActionSaved: id => {runId = id; throw new Error('saved-before-review')}})).rejects.toThrow('saved-before-review')
  expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  vi.restoreAllMocks(); db.close(); await db.open()
  if (version !== 'current') freezeLegacyChatActionContractFixture()
  const resumed = await resumeChatNarrativeReviewV1({scope: f.scope, runId, runReviewAI: async messages => {
    reviewed++
    expect(messages[1].content.includes('dialogueSelection')).toBe(version !== 'saved-v8')
    return JSON.stringify(chatActionReviewOutputFixture())
  }})
  expect(await readChatCandidateRetrievalVersion(resumed.snapshot, f.scope.projectId, 'interactionRuntime', 'guard', before.interaction!))
    .toBe(version === 'current' ? 'chat-relevance-v14' : version === 'saved-v13' ? 'chat-relevance-v9' : 'chat-relevance-v4')
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId})
  const after = await readProductRuntimeState(f.sessionId)
  expect(after.interaction!.messages).toHaveLength(before.interaction!.messages.length + 1)
  expect(after.interaction!.chatNarrative!.situation.facts).toEqual(before.interaction!.chatNarrative!.situation.facts)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: after.lastSequence, title: 'dialogue-policy-branch'})
  const branched = (await readProductRuntimeState(branch.id!)).interaction
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  db.close(); await db.open()
  const imported = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray()).find(s => s.title === branch.title)!
  expect((await readProductRuntimeState(imported.id!)).interaction).toEqual(branched)
  expect((await db.worldReleases.toArray()).filter(w => w.projectId === f.scope.projectId)).toEqual(worlds)
  expect([generated, reviewed]).toEqual([1, 1])
})
