import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import {db} from '../../src/lib/db/schema'
import * as skills from '../../src/lib/agent/skill-registry'
import {readAgentRunV1} from '../../src/lib/agent/run/event-store'
import {chatSourceUnitsPromptV1} from '../../src/lib/character-interaction/source-observation-units'
import {CHAT_SOURCE_UNITS_REVIEW_PROMPT_V1} from '../../src/lib/character-interaction/source-units-candidate'
import {generateChatSourceUnitsV1, recoverChatSourceUnitsRunV1, reviewChatSourceUnitsV1} from '../../src/lib/character-interaction/source-units-harness'
import {seedChatSourceUnitsFixture, sourceUnitsReviewFixture} from '../helpers/chat-source-units'
import type {ChatMessage} from '../../src/lib/types'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})

it('preserves the historical generator and independent reviewer bytes', () => {
  // Captured from the pre-change worktree, not computed from the new policy.
  expect(createHash('sha256').update(chatSourceUnitsPromptV1('chat-source-units-v1')).digest('hex'))
    .toBe('8ef15d215c66b86b03fd48efe0bc2e7d35006f78741eed794d2b96638ff36744')
  expect(createHash('sha256').update(CHAT_SOURCE_UNITS_REVIEW_PROMPT_V1).digest('hex'))
    .toBe('e61ce8cd94f44b87e53e2894966a94e01198c072c9ff4760c40ee39debbab728')
  expect(() => chatSourceUnitsPromptV1('chat-source-units-v999')).toThrow('不能自动换约')
})

it.each(['chat-source-units-v1', 'chat-source-units-v2'])('dispatches frozen %s and recovers its saved result without changing authority', async version => {
  const getSkill = skills.getAgentSkillV1
  let current = version
  vi.spyOn(skills, 'getAgentSkillV1').mockImplementation(id => {
    const skill = getSkill(id)
    return id === 'chat.source-units.v1' ? {...skill, promptVersion: current} : skill
  })
  const f = await seedChatSourceUnitsFixture(), drafts = await db.chatAuthoringDrafts.toArray(), worlds = await db.worldReleases.toArray()
  let runId = 0, messages: ChatMessage[] = []
  const runAI = vi.fn(async (input: ChatMessage[]) => {messages = structuredClone(input); return JSON.stringify(f.candidate)})
  await expect(generateChatSourceUnitsV1({scope: f.scope, request: f.request, runAI, onBoundary: (boundary, id) => {
    if (boundary === 'response.saved') {runId = id; throw new Error('saved response interruption')}
  }})).rejects.toThrow('saved response interruption')
  expect(messages[0]).toEqual({role: 'system', content: chatSourceUnitsPromptV1(version)})
  current = version.endsWith('v1') ? 'chat-source-units-v2' : 'chat-source-units-v1'
  const restored = await recoverChatSourceUnitsRunV1(f.scope, runId)
  expect(restored.status).toBe('ready'); expect(restored.result?.candidate).toEqual(f.candidate)
  const run = await readAgentRunV1(f.scope, runId)
  expect(run.contract.executionBindings?.[0].promptVersion).toBe(version)
  expect(run.contract.permissions.writeTargets).toEqual([])
  expect(runAI).toHaveBeenCalledTimes(1)
  expect(await db.chatAuthoringDrafts.toArray()).toEqual(drafts); expect(await db.worldReleases.toArray()).toEqual(worlds)
})

it('keeps an unsupported observation fact rejected by the unchanged independent review', async () => {
  const f = await seedChatSourceUnitsFixture()
  const candidate = structuredClone(f.candidate)
  candidate.fragments[0].facts.push({key: 'invented-access', text: '守卫可以随意打开木箱。', quotes: ['柜台下的木箱里']})
  const generated = await generateChatSourceUnitsV1({scope: f.scope, request: f.request, runAI: async () => JSON.stringify(candidate)})
  expect(generated.result?.candidate).toEqual(candidate) // Quotation presence is not semantic truth.
  const report = sourceUnitsReviewFixture(candidate)
  report.fragments[0].facts[report.fragments[0].facts.length - 1].faithful = false
  const reviewed = await reviewChatSourceUnitsV1({scope: f.scope, request: {source: f.request, candidate}, runAI: async messages => {
    expect(messages[0].content).toBe(CHAT_SOURCE_UNITS_REVIEW_PROMPT_V1)
    return JSON.stringify(report)
  }})
  expect(reviewed.result?.passed).toBe(false)
  expect(reviewed.result?.artifact.status).toBe('blocked')
  expect((await db.chatAuthoringDrafts.toArray()).every(row => row.sourceUnitsJson === undefined)).toBe(true)
})
