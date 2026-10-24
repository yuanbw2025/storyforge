import {beforeEach, afterEach, it, expect} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createChatDraftV1, readChatDraftV1} from '../../src/lib/character-interaction/draft-service'
import {DEFAULT_CHAT_SETTINGS} from '../../src/lib/character-interaction/authoring-contract'
import {generateChatConsultationV2, adoptChatConsultationV2, readLatestChatConsultationV2, cancelChatConsultationV2} from '../../src/lib/character-interaction/consultation-harness'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => db.close())
it('discusses without a world, selectively confirms a proposal and carries prior discussion across later questions and import', async () => {
  const {scope} = await createChatDraftV1('会谈作品')
  const candidate = {answer: '可将玩家设为档案员。', changes: [{field: 'playerRole', value: '档案员', reason: '作者提出的虚构身份', basis: 'proposal', evidence: []}]}
  const view = await generateChatConsultationV2({scope, request: {draftRevision: 0, question: '主角是档案员', source: null, priorRunId: null}, runAI: async messages => {
    expect(messages[1].content).toContain('主角是档案员')
    expect(messages[1].content).toContain('"source":null')
    return JSON.stringify(candidate)
  }})
  expect(JSON.parse((await readChatDraftV1(scope)).settingsJson)).toEqual(DEFAULT_CHAT_SETTINGS)
  await adoptChatConsultationV2({scope, runId: view.runId, expectedCandidateHash: view.candidateHash!, fields: ['playerRole']})
  const draft = await readChatDraftV1(scope)
  expect(JSON.parse(draft.settingsJson)).toEqual({...DEFAULT_CHAT_SETTINGS, playerRole: '档案员'})
  await generateChatConsultationV2({scope, request: {draftRevision: draft.revision, question: '继续细化', source: null, priorRunId: view.runId}, runAI: async messages => {
    expect(messages[1].content).toContain('可将玩家设为档案员。')
    return JSON.stringify({answer: '再决定当前矛盾，暂不改变方案。', changes: []})
  }})
  const importedId = await importProjectJSON(await exportProjectJSON(scope.projectId))
  const restored = (await db.chatAuthoringDrafts.where('projectId').equals(importedId).first())!
  expect(restored.settingsJson).toBe(draft.settingsJson)
  const loaded = (await readLatestChatConsultationV2({projectId: importedId, worldId: restored.worldId, workId: restored.workId}))!
  expect(loaded.result?.candidate?.answer).toBe('再决定当前矛盾，暂不改变方案。')
  expect(loaded.context?.history[0].candidate).toEqual(candidate)
})
it('keeps rejected output, permits an explicit new conversation and never silently applies malformed settings', async () => {
  const {scope} = await createChatDraftV1('错误会谈')
  const request = {draftRevision: 0, question: '写个故事', source: null, priorRunId: null}
  let calls = 0
  const view = await generateChatConsultationV2({scope, request, runAI: async () => {calls++; return 'not JSON'}})
  expect(view.status).toBe('blocked')
  expect(view.result!.artifact.originalText).toBe('not JSON')
  expect(calls).toBe(1)
  expect(JSON.parse((await readChatDraftV1(scope)).settingsJson)).toEqual(DEFAULT_CHAT_SETTINGS)
  await cancelChatConsultationV2(scope, view.runId)
})
