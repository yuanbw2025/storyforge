import { afterEach, beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedChatRuntimeFixture } from '../helpers/character-chat-fixture'
import { adoptInteractionRuntimeCandidateV1, generateInteractionRuntimeCandidateV1 } from '../../src/lib/character-interaction/harness'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { readProductRuntimeStateVersion } from '../../src/lib/character-interaction/runtime-api'

beforeEach(async () => { db.close(); await db.delete(); await db.open() })
afterEach(() => db.close())

it('retains exact malformed output and the actual role request across refresh, without committing consequences or repeating the call', async () => {
  const f = await seedChatRuntimeFixture()
  const before = await readProductRuntimeStateVersion(f.sessionId)
  const raw = '这是一个不完整的候选：{"kind":"character-reply",'
  let runId = 0, calls = 0
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'aria',
    skillId: 'character.interaction-reply', objective: '回应来信', replyToSequence: f.playerSequence,
    onRunCreated: id => { runId = id }, runAI: async () => { calls++; return raw },
  })).rejects.toThrow()
  expect(calls).toBe(1)
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
  db.close(); await db.open()
  const run = await readInstanceAgentRunV1(f.scope, runId)
  expect(run.projection.state).toBe('failed')
  const response = run.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')!
  const request = run.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'rendered-request')!
  expect(response.type).toBe('evidence.artifact.recorded')
  if (response.type !== 'evidence.artifact.recorded' || request.type !== 'evidence.artifact.recorded') throw new Error('missing artifact')
  expect(await readAgentRunArtifactExactV1({projectId: f.scope.projectId, artifactKind: 'raw-response', contentHash: response.payload.contentHash})).toBe(raw)
  const messages = JSON.parse(await readAgentRunArtifactExactV1({projectId: f.scope.projectId, artifactKind: 'rendered-request', contentHash: request.payload.contentHash}))
  expect(JSON.stringify(messages)).toContain('你收到我的信了吗')
  expect(run.events.some(e => e.type === 'candidate.persisted')).toBe(false)
  await expect(readAgentRunArtifactExactV1({projectId: f.scope.projectId + 1000, artifactKind: 'raw-response', contentHash: response.payload.contentHash})).rejects.toThrow()
})

it('keeps a successful reply trace through candidate adoption and an idempotent second adoption', async () => {
  const f = await seedChatRuntimeFixture()
  const raw = JSON.stringify({kind: 'character-reply', text: '我尚未确认是否收到，先核对一下。', replyToSequence: f.playerSequence, audienceKeys: ['player'], budgetCost: 1, disclosures: []})
  const generated = await generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'aria', skillId: 'character.interaction-reply', objective: '回应来信', replyToSequence: f.playerSequence, runAI: async () => raw})
  const adopted = await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(adopted.snapshot.projection.state).toBe('completed')
  const beforeRetry = await readProductRuntimeStateVersion(f.sessionId)
  await adoptInteractionRuntimeCandidateV1({scope: f.scope, runId: generated.snapshot.run.id})
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(beforeRetry)
  const bodies = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()
  expect(bodies.filter(a => a.artifactKind === 'raw-response').map(a => a.content)).toEqual([raw])
})

it('keeps credential-like material outside exact artifacts and fails the candidate safely', async () => {
  const f = await seedChatRuntimeFixture()
  const before = await readProductRuntimeStateVersion(f.sessionId)
  const raw = JSON.stringify({apiKey: 'synthetic-test-value-only'})
  await expect(generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'aria', skillId: 'character.interaction-reply', objective: '读取测试回执', replyToSequence: f.playerSequence, runAI: async () => raw})).rejects.toThrow('禁止字段')
  expect((await db.agentRunArtifacts.toArray()).some(a => a.content === raw)).toBe(false)
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
})
