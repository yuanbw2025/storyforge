import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {readAgentRunV1} from '../../src/lib/agent/run/event-store'
import {chatSourceUnitConfirmationPromptV1} from '../../src/lib/character-interaction/source-unit-discovery-policy'
import {reviewChatSourceUnitConfirmationV1, recoverChatSourceUnitConfirmationV1} from '../../src/lib/character-interaction/source-unit-confirmation-harness'
import {seedChatSourceUnitConfirmationFixture, sourceUnitAuthorizationReportFixture} from '../helpers/chat-source-unit-confirmation'
import type {ChatMessage} from '../../src/lib/types'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it('keeps the actual historical review prompt and refuses unknown policies', () => {
  // Independently read from V253's immutable server, without a model request.
  const legacy = chatSourceUnitConfirmationPromptV1('chat-source-unit-confirmation-v1')
  expect(createHash('sha256').update(legacy).digest('hex')).toBe('bef2a6943848522b01141b6f261fc0dd1d518aa2492417bdab6cd2a894c780e2')
  expect(chatSourceUnitConfirmationPromptV1('chat-source-unit-confirmation-v2').endsWith(legacy)).toBe(true)
  expect(() => chatSourceUnitConfirmationPromptV1('chat-source-unit-confirmation-v999')).toThrow('不能自动换约')
})

it.each(['chat-source-unit-confirmation-v1', 'chat-source-unit-confirmation-v2'])('binds %s to the actual request and recovers its saved answer after a registry change', async version => {
  const original = skills.getAgentSkillV1
  let current = version
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
    const skill = original(id)
    return id === 'chat.source-unit-confirmation.v1' ? {...skill, promptVersion: current} : skill
  })
  const f = await seedChatSourceUnitConfirmationFixture()
  let runId = 0, messages: ChatMessage[] = []
  const runAI = vi.fn(async (input: ChatMessage[]) => {
    messages = structuredClone(input)
    return JSON.stringify(sourceUnitAuthorizationReportFixture(f.candidate, f.permissions))
  })
  await expect(reviewChatSourceUnitConfirmationV1({scope: f.scope, request: f.request, runAI,
    onBoundary: (boundary, id) => {if (boundary === 'response.saved') {runId = id; throw new Error('saved response interruption')}},
  })).rejects.toThrow('saved response interruption')
  expect(messages[0]).toEqual({role: 'system', content: chatSourceUnitConfirmationPromptV1(version)})
  expect((await readAgentRunV1(f.scope, runId)).contract.executionBindings?.[0].promptVersion).toBe(version)
  current = version.endsWith('v1') ? 'chat-source-unit-confirmation-v2' : 'chat-source-unit-confirmation-v1'
  const recovered = await recoverChatSourceUnitConfirmationV1(f.scope, runId)
  expect(recovered.status).toBe('ready')
  expect(recovered.result?.report).toEqual(sourceUnitAuthorizationReportFixture(f.candidate, f.permissions))
  expect((await readAgentRunV1(f.scope, runId)).contract.executionBindings?.[0].promptVersion).toBe(version)
  expect(runAI).toHaveBeenCalledTimes(1)
})
