import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {useAIConfigStore} from '../../src/stores/ai-config'
import type {AIConfig} from '../../src/lib/types'
import {CODEX_BASE_URL} from '../../src/lib/ai/codex-transport'
import {seedChatRoleProfileFixture} from '../helpers/chat-role-profile'
import {seedChatConsultationFixtureV2} from '../helpers/chat-consultation'
import {generateChatConsultationV2, readChatConsultationV2, readLatestChatConsultationV2, recoverChatConsultationV2} from '../../src/lib/character-interaction/consultation-harness'
import {generateChatRoleProfileCandidateV1, readLatestChatRoleProfileRunV1, recoverChatRoleProfileRunV1} from '../../src/lib/character-interaction/role-profile-harness'
import {generateChatSourceReviewSuggestionsV1, readLatestChatSourceReviewRunV1, recoverChatSourceReviewRunV1} from '../../src/lib/character-interaction/source-review-harness'
import {readAgentRunV1} from '../../src/lib/agent/run/event-store'
import {readLatestVerifiedAgentRunCheckpointV1, createAgentRunCheckpointV1} from '../../src/lib/agent/run/checkpoint'
import {createChatDraftV2, readChatDraftV1, saveChatDraftV1} from '../../src/lib/character-interaction/draft-service'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import type {ChatSourceRunBoundaryV1} from '../../src/lib/character-interaction/source-run-harness'

const config: AIConfig = {provider: 'codex', apiKey: '', baseUrl: CODEX_BASE_URL, model: 'test', temperature: .2, maxTokens: 6000}
beforeEach(async () => {
  db.close(); await db.delete(); await db.open()
  vi.stubGlobal('location', {hostname: 'localhost'})
  vi.stubGlobal('navigator', {locks: {request: async (_key: string, _options: unknown, action: (lock: object) => unknown) => action({})}})
  useAIConfigStore.setState({config, presets: [], taskRoutes: {}})
})
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()})
function bridge(status = 'failed', patch: Record<string, unknown> = {}) {
  const requests: string[] = []
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const json = (value: unknown) => new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json'}})
    if (url === `${CODEX_BASE_URL}/status`) return json({state: 'ready'})
    if (url === `${CODEX_BASE_URL}/requests` && init?.method === 'POST') {
      const {id} = JSON.parse(init.body as string); requests.push(id); return json({id})
    }
    if (url === `${CODEX_BASE_URL}/requests/${requests[requests.length - 1]}`) return json({
      id: requests[requests.length - 1], model: 'test', status, dispatched: true,
      text: 'unusable partial text', error: 'provider-error-not-for-checkpoint',
      providerTurn: {threadId: 'thread', turnId: 'turn', status: status === 'cancelled' ? 'interrupted' : 'failed'}, ...patch,
    })
    throw new Error('Unexpected bridge call')
  })
  vi.stubGlobal('fetch', fetchMock)
  return {requests, fetchMock}
}
async function fixture(kind: 'consultation' | 'profile' | 'source') {
  if (kind === 'consultation') {
    const f = await seedChatConsultationFixtureV2()
    return {...f, generate: (onBoundary?: (point: ChatSourceRunBoundaryV1) => void) => generateChatConsultationV2({scope: f.scope, request: f.request, config, onBoundary}),
      latest: () => readLatestChatConsultationV2(f.scope), recover: (id: number) => recoverChatConsultationV2(f.scope, id)}
  }
  const f = await seedChatRoleProfileFixture()
  return {...f, generate: (onBoundary?: (point: ChatSourceRunBoundaryV1) => void) => kind === 'profile'
    ? generateChatRoleProfileCandidateV1({scope: f.scope, request: f.request, config, onBoundary})
    : generateChatSourceReviewSuggestionsV1({scope: f.scope, request: f.request, config, onBoundary}),
    latest: () => kind === 'profile' ? readLatestChatRoleProfileRunV1(f.scope) : readLatestChatSourceReviewRunV1(f.scope),
    recover: (id: number) => kind === 'profile' ? recoverChatRoleProfileRunV1(f.scope, id) : recoverChatSourceReviewRunV1(f.scope, id)}
}

it.each(['consultation', 'profile', 'source'] as const)('retains a confirmed failure through the actual %s client and never creates or adopts a candidate', async kind => {
  const f = await fixture(kind), {requests, fetchMock} = bridge()
  const draft = await readChatDraftV1(f.scope), worlds = await db.worldReleases.toArray()
  await expect(f.generate()).rejects.toThrow('provider-error')
  const view = (await f.latest())!
  expect(view).toMatchObject({status: 'blocked', result: null, failure: {requestId: requests[0], provider: 'codex', model: 'test', providerTurn: {status: 'failed'}}})
  const before = fetchMock.mock.calls.length
  expect(await f.recover(view.runId)).toMatchObject(view)
  expect(fetchMock).toHaveBeenCalledTimes(before)
  const run = await readAgentRunV1(f.scope, view.runId)
  expect(run.projection.state).toBe('failed')
  for (const type of ['model.requested', 'step.failed', 'run.failed']) expect(run.events.filter(e => e.type === type)).toHaveLength(1)
  for (const type of ['model.responded', 'candidate.persisted', 'adoption.committed', 'verification.accepted']) expect(run.events.some(e => e.type === type)).toBe(false)
  const saved = await readLatestVerifiedAgentRunCheckpointV1(f.scope, view.runId)
  expect(JSON.stringify(saved?.resumePayload)).not.toContain('provider-error-not-for-checkpoint')
  expect(JSON.stringify(saved?.resumePayload)).not.toContain('unusable partial text')
  expect(await readChatDraftV1(f.scope)).toEqual(draft); expect(await db.worldReleases.toArray()).toEqual(worlds)
  expect(requests).toHaveLength(1)
})

it.each(['failure.saved', 'failure.recorded'] as const)('recovers an interruption after %s without any provider access, including after import', async boundary => {
  const f = await fixture('consultation'), {requests, fetchMock} = bridge('cancelled')
  await expect(f.generate(point => {if (point === boundary) throw new Error('interrupted save')})).rejects.toThrow('interrupted save')
  const view = (await f.latest())!
  expect(view.status).toBe('pending'); expect(view.failure?.providerTurn.status).toBe('interrupted')
  await expect(f.generate()).rejects.toThrow('尚未结束')
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const draft = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!, scope = {projectId, worldId: draft.worldId, workId: draft.workId}
  const imported = (await readLatestChatConsultationV2(scope))!
  expect(imported.failure).toEqual(view.failure)
  const calls = fetchMock.mock.calls.length
  expect((await recoverChatConsultationV2(scope, imported.runId)).status).toBe('blocked')
  expect((await f.recover(view.runId)).status).toBe('blocked')
  expect((await f.recover(view.runId)).status).toBe('blocked')
  expect(fetchMock).toHaveBeenCalledTimes(calls); expect(requests).toHaveLength(1)
  expect(await readChatDraftV1(scope)).toEqual(draft)
  const run = await readAgentRunV1(f.scope, view.runId)
  expect(run.events.filter(e => e.type === 'step.failed')).toHaveLength(1)
  expect(run.events.filter(e => e.type === 'run.failed')).toHaveLength(1)
})

it('retains failure after draft changes and completed-run import, and checks Work ownership', async () => {
  const f = await fixture('consultation'), {requests, fetchMock} = bridge()
  await expect(f.generate()).rejects.toThrow()
  const view = (await f.latest())!, draft = await readChatDraftV1(f.scope)
  await saveChatDraftV1(f.scope, draft.revision, {...JSON.parse(draft.settingsJson), playerRole: '作者新修改'})
  expect((await f.latest())!.status).toBe('blocked')
  const other = await createChatDraftV2('其他作品')
  await expect(readChatConsultationV2(other.scope, view.runId)).rejects.toThrow()
  await expect(recoverChatConsultationV2(other.scope, view.runId)).rejects.toThrow()
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const restored = (await db.chatAuthoringDrafts.where('projectId').equals(projectId).first())!, scope = {projectId, worldId: restored.worldId, workId: restored.workId}
  const imported = (await readLatestChatConsultationV2(scope))!
  expect(imported).toMatchObject({status: 'blocked', failure: view.failure, result: null})
  const calls = fetchMock.mock.calls.length
  expect((await recoverChatConsultationV2(scope, imported.runId)).status).toBe('blocked')
  expect(fetchMock).toHaveBeenCalledTimes(calls); expect(requests).toHaveLength(1)
})

it.each([{status: 'unknown'}, {providerTurn: undefined}, {id: 'other-request'}, {model: 'other-model'}])('keeps insufficient evidence unknown: %j', async patch => {
  const f = await fixture('consultation'), {requests} = bridge('failed', patch)
  await expect(f.generate()).rejects.toThrow()
  const view = (await f.latest())!
  expect(view.status).toBe('unknown'); expect(view.failure).toBeUndefined()
  await expect(f.recover(view.runId)).rejects.toThrow('不能自动重发')
  await expect(f.generate()).rejects.toThrow('尚未结束')
  expect(requests).toHaveLength(1)
})

it.each(['model', 'response', 'status', 'raw-error'])('rejects checkpoint failure evidence inconsistent with the request: %s', async field => {
  const f = await fixture('consultation'); bridge()
  await expect(f.generate(point => {if (point === 'failure.saved') throw new Error('interrupted save')})).rejects.toThrow()
  const view = (await f.latest())!, saved = (await readLatestVerifiedAgentRunCheckpointV1(f.scope, view.runId))!
  const payload = structuredClone(saved.resumePayload) as {failure: Record<string, unknown>; response: unknown}
  if (field === 'model') payload.failure.model = 'other-model'
  if (field === 'response') payload.response = {raw: 'invented', call: {}}
  if (field === 'status') payload.failure.providerTurn = {threadId: 'thread', turnId: 'turn', status: 'completed'}
  if (field === 'raw-error') payload.failure.error = 'should-not-be-kept'
  await createAgentRunCheckpointV1({scope: f.scope, runId: view.runId, resumePayload: payload, expectedLastSequence: saved.snapshot.projection.lastSequence})
  await expect(f.latest()).rejects.toThrow()
  await expect(f.recover(view.runId)).rejects.toThrow()
})
