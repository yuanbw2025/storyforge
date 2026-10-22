/** Normal Plan, configured executor, fake native transport and real Run APIs.
 * No actual model, subscription request or independent author acceptance. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { openProductionFixtureV1 } from '../helpers/open-ttrpg-production'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { resolveConfiguredTextCapabilityV1 } from '../../src/lib/product-production/capabilities'
import { createConfiguredProductProductionExecutorV1 } from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1, runProductProductionSchedulerCycleV1 } from '../../src/lib/product-production/scheduler'
import { readAgentRunV1, appendAgentRunEventV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { readProductProductionOriginalLocalReceiptV1, prepareProductProductionLocalRequestV1 } from '../../src/lib/product-production/local-request'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { CODEX_DURABLE_RECEIPT_RETENTION_V1 } from '../../src/lib/ai/codex-transport'

beforeEach(async () => {
  await db.delete(); await db.open()
  window.location.href = 'http://localhost:4178/storyforge/'
  useAIConfigStore.getState().setConfig({ provider: 'codex', model: 'fixture-native-only', apiKey: '', contextWindow: 131072, maxTokens: 16000 })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

async function authorized() {
  const { scope, productionId, brief } = await openProductionFixtureV1()
  const previous = (await db.productProductions.get(productionId))!
  expect((await executeProductProductionCommand({ scope, productionId, command: { type: 'save-brief-revision',
    commandId: 'native-binding.save', expectedStateRevision: previous.stateRevision,
    parentRevision: previous.currentBriefRevision, brief } })).ok).toBe(true)
  const current = (await db.productProductions.get(productionId))!
  const row = (await db.productProductionBriefs.where('[productionId+revision]').equals([productionId, current.currentBriefRevision!]).first())!
  expect((await executeProductProductionCommand({ scope, productionId, command: { type: 'authorize-start',
    commandId: 'native-binding.start', expectedStateRevision: current.stateRevision,
    briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'explicit.fixture.author' } })).ok).toBe(true)
  const requirementKey = brief.capabilityRequirements.find(r => r.mediaClass === 'text')!.requirementKey
  const resolved = await resolveConfiguredTextCapabilityV1({ projectId: scope.projectId, category: 'product-production', requirementKey })
  const capabilityBindings = [{ requirementKey, adapterId: 'configured-text.v1', bindingHash: resolved.receipt.capabilityHash,
    provider: resolved.receipt.provider, model: resolved.receipt.model }]
  const executor = createConfiguredProductProductionExecutorV1({ production: (await db.productProductions.get(productionId))!, brief })
  return { scope, productionId, brief, capabilityBindings, executor }
}
async function requestEvidence(scope: { projectId: number }, runId: number, attempt = 1) {
  const snapshot = await readAgentRunV1(scope, runId)
  const found = []
  for (const event of snapshot.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot' || event.payload.attempt !== attempt) continue
    const value = JSON.parse(await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'source-snapshot', contentHash: event.payload.contentHash }))
    if (value?.schema === 'storyforge.product-production-local-request') found.push(value)
  }
  expect(found).toHaveLength(1)
  return found[0]
}

function transport(mode: 'completed' | 'lost-poll', scope: { projectId: number }, options: { ackFails?: boolean } = {}) {
  const requests: Array<{ url: string; method: string }> = []
  let wire: { id: string; model: string; messages: unknown[]; receiptRetention: string; responseFormat: string } | undefined
  let ownerRunId = 0
  const output = '{"fixture":"complete raw deliberately fails the closed candidate parser"}'
  const usage = { inputTokens: 101, outputTokens: 11 }
  const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url), method = init?.method ?? 'GET'; requests.push({ url: path, method })
    if (path.endsWith('/status')) return response({ state: 'ready' })
    if (path.endsWith('/requests') && method === 'POST') {
      wire = JSON.parse(String(init?.body))
      expect(wire!.receiptRetention).toBe(CODEX_DURABLE_RECEIPT_RETENTION_V1)
      const run = (await db.agentRuns.orderBy('id').last())!; ownerRunId = run.id!
      const snapshot = await readAgentRunV1(scope, ownerRunId)
      const taskKey = snapshot.contract.scope.productProduction!.taskKey
      const evidence = await requestEvidence(scope, ownerRunId, snapshot.projection.steps[taskKey].attempt)
      expect(evidence.request.requestId).toBe(wire!.id)
      expect(evidence.request.requestHash).toBe(await sha256Text(String(init?.body)))
      expect(evidence.messages).toEqual(wire!.messages)
      return response({ id: wire!.id, status: 'accepted' })
    }
    if (wire && path.endsWith(`/requests/${wire.id}/acknowledge`)) {
      const run = await readAgentRunV1(scope, ownerRunId), expectedHash = await sha256Text(output)
      const raw = run.events.find(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response' && e.payload.contentHash === expectedHash)
      expect(raw).toBeTruthy()
      const bodies = await db.agentRunArtifacts.where('projectId').equals(scope.projectId).toArray()
      expect(bodies.some(b => b.content?.includes('storyforge.product-production-local-response') && b.content.includes(expectedHash))).toBe(true)
      if (options.ackFails) return response({ error: 'simulated unavailable handoff' }, 503)
      return response({ id: wire.id, acknowledged: true, acknowledgedAt: Date.now(), status: 'completed' })
    }
    if (wire && path.endsWith(`/requests/${wire.id}`)) {
      if (mode === 'lost-poll') throw new TypeError('simulated local observation lost')
      return response({ id: wire.id, model: wire.model, createdAt: Date.now(), status: 'completed', text: output,
        usage, dispatched: true, requestHash: await sha256Text(JSON.stringify(wire)), requestHashAlgorithm: 'sha256-json-request-v1',
        receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1 })
    }
    throw Error('Unexpected fixture transport route: ' + path)
  })
  vi.stubGlobal('fetch', fetch)
  return { requests, fetch, get runId() { return ownerRunId }, get wire() { return wire }, output, usage }
}

it.each([false, true])('one authorized attempt saves exact owner before POST and raw/metadata before ACK (handoff unavailable=%s)', async ackFails => {
  const data = await authorized(), fake = transport('completed', data.scope, { ackFails })
  // This unit checks one actual attempt. Known invalid complete output may
  // legitimately enter the Plan's existing bounded repair on a later cycle.
  const result = await runProductProductionSchedulerCycleV1(data)
  expect(fake.requests.filter(r => r.url.endsWith('/requests') && r.method === 'POST')).toHaveLength(1)
  expect(fake.requests.filter(r => r.url.endsWith('/acknowledge'))).toHaveLength(1)
  const original = await requestEvidence(data.scope, fake.runId)
  const before = JSON.stringify(await db.agentRunEvents.toArray()), builds = JSON.stringify(await db.productBuilds.toArray())
  fake.fetch.mockImplementation(async () => { throw Error('service now offline') })
  const saved = await readProductProductionOriginalLocalReceiptV1({ ...data, buildId: result.buildId, runId: fake.runId,
    taskKey: original.owner.taskKey, attempt: original.owner.attempt })
  expect(saved).toMatchObject({ status: 'completed', source: 'owner', text: fake.output, usage: fake.usage, candidateReady: false })
  expect(JSON.stringify(await db.agentRunEvents.toArray())).toBe(before)
  expect(JSON.stringify(await db.productBuilds.toArray())).toBe(builds)
  expect(fake.fetch).toHaveBeenCalledTimes(fake.requests.length)
}, 30000)

it('known-output bounded repair retains independently readable original IDs for every attempt', async () => {
  const data = await authorized(), fake = transport('completed', data.scope)
  const result = await runProductProductionUntilBlockedV1(data)
  expect(result.buildStatus).toBe('recovery-required')
  expect(fake.requests.filter(r => r.url.endsWith('/requests') && r.method === 'POST')).toHaveLength(2)
  const first = await requestEvidence(data.scope, fake.runId, 1), second = await requestEvidence(data.scope, fake.runId, 2)
  expect(first.request.requestId).not.toBe(second.request.requestId)
  const count = fake.fetch.mock.calls.length
  for (const attempt of [1, 2]) expect(await readProductProductionOriginalLocalReceiptV1({ ...data,
    buildId: result.buildId, runId: fake.runId, taskKey: first.owner.taskKey, attempt })).toMatchObject({ source: 'owner', status: 'completed', candidateReady: false })
  expect(fake.fetch.mock.calls.length).toBe(count)
}, 30000)

it('lost native polling pauses once; explicit original-ID queries preserve unknown usage and never generate or ACK', async () => {
  const data = await authorized(), fake = transport('lost-poll', data.scope)
  const result = await runProductProductionUntilBlockedV1(data)
  const build = (await db.productBuilds.get(result.buildId))!, original = await requestEvidence(data.scope, fake.runId)
  expect(build.failureJson).toContain('task-result-unknown')
  expect(JSON.parse(build.budgetLedgerJson).attempts.filter((a: { usageKnown: boolean }) => !a.usageKnown)).toHaveLength(1)
  expect(fake.requests.filter(r => r.method === 'POST' && r.url.endsWith('/requests'))).toHaveLength(1)
  const before = JSON.stringify(await db.agentRunEvents.toArray())
  fake.fetch.mockImplementation(async (url, init) => {
    expect(init?.method).toBe('GET'); expect(String(url)).toBe(`/storyforge/local-codex/v1/requests/${fake.wire!.id}`)
    return new Response(JSON.stringify({ id: fake.wire!.id, model: fake.wire!.model, createdAt: Date.now(), status: 'cancelled',
      text: 'partial answer cannot become a candidate', dispatched: true, requestHash: original.request.requestHash,
      requestHashAlgorithm: original.request.requestHashAlgorithm, receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1 }),
    { headers: { 'content-type': 'application/json' } })
  })
  for (let i = 0; i < 2; i++) expect(await readProductProductionOriginalLocalReceiptV1({ ...data, buildId: result.buildId,
    runId: fake.runId, taskKey: original.owner.taskKey, attempt: original.owner.attempt })).toMatchObject({ status: 'cancelled', source: 'native', candidateReady: false })
  expect(JSON.stringify(await db.agentRunEvents.toArray())).toBe(before)
  expect((await db.productBuilds.get(result.buildId))!.budgetLedgerJson).toBe(build.budgetLedgerJson)
  expect(fake.requests.filter(r => r.method === 'POST' && r.url.endsWith('/requests'))).toHaveLength(1)
  expect(fake.requests.filter(r => r.url.endsWith('/acknowledge'))).toHaveLength(0)
}, 30000)

it('failed owner persistence prevents inference POST and does not invent free recovery or retry', async () => {
  const data = await authorized(), fake = transport('completed', data.scope)
  const add = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
  vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(async (...args) => {
    if (args[0].content?.includes('storyforge.product-production-local-request')) throw Error('simulated owner storage failure')
    return add(...args)
  })
  const result = await runProductProductionUntilBlockedV1(data)
  expect(result.buildStatus).toBe('recovery-required')
  expect(fake.requests.filter(r => r.method === 'POST')).toHaveLength(0)
  expect(fake.requests.filter(r => r.url.endsWith('/status'))).toHaveLength(1)
}, 30000)

it('stale/foreign binding cannot claim a new original request', async () => {
  const data = await authorized(), fake = transport('lost-poll', data.scope)
  const result = await runProductProductionUntilBlockedV1(data), original = await requestEvidence(data.scope, fake.runId)
  const query = { ...data, buildId: result.buildId, runId: fake.runId, taskKey: original.owner.taskKey, attempt: original.owner.attempt }
  const count = fake.fetch.mock.calls.length
  await expect(readProductProductionOriginalLocalReceiptV1({ ...query, productionId: query.productionId + 1 })).rejects.toThrow(/查询参数/)
  await expect(prepareProductProductionLocalRequestV1({ owner: original.owner, request: original.request, messages: original.messages })).rejects.toThrow(/已经失效/)
  const row = await readAgentRunV1(data.scope, fake.runId)
  expect(row.run.status).toBe('failed')
  await expect(readProductProductionOriginalLocalReceiptV1({ ...query, scope: { ...data.scope, workId: data.scope.workId! + 1 } })).rejects.toThrow()
  expect(fake.fetch.mock.calls.length).toBe(count)
}, 30000)

it('a prepared attempt rejects a second native ID, exact-wire changes and the real import cancellation marker', async () => {
  const data = await authorized()
  let runId = 0
  await expect(runProductProductionSchedulerCycleV1({ ...data, onDurableBoundary: (boundary, snapshot) => {
    if (boundary === 'provider.requested') { runId = snapshot.run.id; throw Error('simulated process boundary') }
  } })).rejects.toThrow('simulated process boundary')
  const build = (await db.productBuilds.where('productionId').equals(data.productionId).first())!
  const row = await readAgentRunV1(data.scope, runId), taskKey = row.contract.scope.productProduction!.taskKey
  const entry = JSON.parse(build.budgetLedgerJson).tasks[taskKey]
  const owner = { scope: data.scope, productionId: data.productionId, buildId: build.id!, runId, taskKey,
    attempt: entry.attempt, controlEpoch: build.controlEpoch, planHash: build.planHash,
    idempotencyKey: entry.idempotencyKey, expectedCapabilityHash: data.capabilityBindings[0].bindingHash }
  const messages = [{ role: 'system' as const, content: 'fixture exact request' }]
  const requestId = crypto.randomUUID(), model = 'fixture-native-only'
  const request = { version: 1 as const, provider: 'codex' as const, requestId, model,
    requestHashAlgorithm: 'sha256-json-request-v1' as const,
    requestHash: await sha256Text(JSON.stringify({ id: requestId, model, messages,
      receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1, responseFormat: 'json_object' })) }
  await expect(prepareProductProductionLocalRequestV1({ owner, request, messages: [{ ...messages[0], content: 'changed wire' }] })).rejects.toThrow(/准确正文/)
  await prepareProductProductionLocalRequestV1({ owner, request, messages })
  await expect(prepareProductProductionLocalRequestV1({ owner, request: { ...request, requestId: crypto.randomUUID() }, messages })).rejects.toThrow(/已保存原本机请求/)
  const prepared = await readAgentRunV1(data.scope, runId)
  await appendAgentRunEventV1({ scope: data.scope, runId, type: 'run.cancelled',
    payload: { reason: 'project-import-nonportable-checkpoint' }, expectedLastSequence: prepared.projection.lastSequence })
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  await expect(readProductProductionOriginalLocalReceiptV1({ ...data, buildId: build.id!, runId, taskKey, attempt: entry.attempt })).rejects.toThrow(/原作品/)
  expect(fetch).not.toHaveBeenCalled()
}, 30000)

it('legacy unbound failed Run is read locally and cannot be associated by matching output or hash', async () => {
  const data = await authorized()
  let taskRunId = 0
  const result = await runProductProductionUntilBlockedV1({ ...data, executor: async input => {
    taskRunId = input.taskRunId!
    throw Error('legacy executor without native binding')
  } })
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const row = await readAgentRunV1(data.scope, taskRunId)
  const taskKey = row.contract.scope.productProduction!.taskKey, attempt = row.projection.steps[taskKey].attempt
  expect(await readProductProductionOriginalLocalReceiptV1({ ...data, buildId: result.buildId, runId: taskRunId, taskKey, attempt })).toEqual({ status: 'unbound' })
  expect(fetch).not.toHaveBeenCalled()
}, 30000)
