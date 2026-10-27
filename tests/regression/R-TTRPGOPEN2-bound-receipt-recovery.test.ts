import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createSavedOpenDesignFixtureV1, openDesignResponseFixtureV1 } from '../helpers/ttrpg-open-design'
import { generateTtrpgOpenAuthoringDesignCandidateV1, recoverTtrpgOpenDesignOriginalReceiptV1,
  recoverTtrpgOpenAuthoringDesignCandidateV1, readTtrpgOpenAuthoringDesignReviewV1 } from '../../src/lib/ttrpg/open-authoring-design-harness'
import { dismissTtrpgOpenAuthoringDesignRequestV1 } from '../../src/lib/ttrpg/open-authoring-design-adoption'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { beginAgentRunRecoveryV1, completeAgentRunRecoveryV1 } from '../../src/lib/agent/run/checkpoint'
import * as artifacts from '../../src/lib/memory/artifact-store'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import type { CodexReceipt } from '../../src/lib/ai/codex-transport'

const config = { provider: 'codex' as const, model: 'fixture-codex', apiKey: '', baseUrl: '/storyforge/local-codex/v1',
  temperature: 0, maxTokens: 16_000, contextWindow: 131_072 }
const bindingSchema = 'storyforge.ttrpg-open-design-local-request'
async function protectedRows() {
  return JSON.stringify(await Promise.all([db.works.toArray(), db.ttrpgAuthoringDrafts.toArray(), db.ttrpgRulePacks.toArray(), db.worldReleases.toArray()]))
}
async function evidence(runId: number, schema: string) {
  const run = await db.agentRuns.get(runId)
  if (!run) throw new Error('missing fixture run')
  const work = await db.works.get(run.workId!)
  const rows = (await readAgentRunV1({ projectId: run.projectId, worldId: work!.worldId!, workId: run.workId! }, runId)).events
  for (const e of rows) {
    if (e.type !== 'evidence.artifact.recorded' || e.payload.artifactKind !== 'source-snapshot') continue
    let body
    try { body = JSON.parse(await artifacts.readAgentRunArtifactExactV1({ projectId: e.projectId, artifactKind: 'source-snapshot', contentHash: e.payload.contentHash })) }
    catch (error) { if (error instanceof SyntaxError) continue; throw error }
    if (body.schema === schema) return body
  }
  return null
}
async function bridge() {
  const f = await createSavedOpenDesignFixtureV1(), before = await protectedRows()
  let receipt!: CodexReceipt, infer = 0, gets = 0, ack = 0, cancels = 0, lose = true
  let runId = 0
  const failures: unknown[] = []
  const handler = async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input), body = init?.body ? JSON.parse(String(init.body)) : null
    if (path.endsWith('/status')) return Response.json({ state: 'ready' })
    if (path.endsWith('/requests') && init?.method === 'POST') {
      infer++
      const saved = await evidence(runId, bindingSchema)
      expect(saved.request.requestId).toBe(body.id)
      expect(saved.request.requestHash).toBe(await sha256Text(JSON.stringify(body)))
      expect(body.receiptRetention).toBe('until-owner-ack-v1')
      receipt = { id: body.id, model: body.model, createdAt: Date.now(), status: 'completed', dispatched: true,
        text: openDesignResponseFixtureV1(body.messages), requestHash: saved.request.requestHash,
        requestHashAlgorithm: saved.request.requestHashAlgorithm, receiptRetention: 'until-owner-ack-v1',
        usage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 } }
      return Response.json({ id: body.id }, { status: 202 })
    }
    if (path.endsWith('/acknowledge')) {
      ack++
      const snapshot = await readAgentRunV1(f.scope, runId)
      const raw = snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'raw-response')
      expect(raw).toHaveLength(1)
      expect(raw[0].type === 'evidence.artifact.recorded' && raw[0].payload.contentHash).toBe(body.rawResponseHash)
      expect(await evidence(runId, 'storyforge.ttrpg-open-design-response-metadata')).toMatchObject({ rawResponseHash: body.rawResponseHash })
      expect(body.rawResponseHash).toBe(await sha256Text(receipt.text))
      return Response.json({ id: receipt.id, acknowledged: true, acknowledgedAt: Date.now(), status: receipt.status })
    }
    if (path.endsWith('/cancel')) { cancels++; return Response.json({ id: receipt.id }) }
    gets++
    if (lose) { lose = false; throw new TypeError('simulated lost original observation') }
    return Response.json(receipt)
  }
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    try { return await handler(input, init) }
    catch (error) { if (!(error instanceof TypeError && error.message === 'simulated lost original observation')) failures.push(error); throw error }
  })
  vi.stubGlobal('fetch', fetcher)
  const generate = async () => {
    try { return await generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, aiConfig: config, onPrepared: id => { runId = id } }) }
    catch (error) { throw failures[0] ?? error }
  }
  return { f, before, generate, fetcher, state: () => ({ infer, gets, ack, cancels, runId }),
    receipt: () => receipt, change: (patch: Partial<CodexReceipt>) => Object.assign(receipt, patch), normal: () => { lose = false } }
}

describe('R-TTRPGOPEN2 original local request recovery into its owned candidate', () => {
  beforeEach(async () => {
    await db.delete(); await db.open()
    const held = new Set<string>()
    vi.stubGlobal('navigator', { locks: { request: async (key: string, _: unknown, operation: (lock: unknown) => Promise<unknown>) => {
      if (held.has(key)) return operation(null)
      held.add(key)
      try { return await operation({ name: key }) } finally { held.delete(key) }
    } } })
  })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

  it('saves the exact reference before one normal POST and raw plus usage before owner handoff; adoption is still separate', async () => {
    const b = await bridge(); b.normal()
    const c = await b.generate()
    expect(c.artifact.status).toBe('ready'); expect(c.artifact.callEvidence[0]).toMatchObject({ usageSource: 'provider', inputTokens: 100, outputTokens: 200, totalTokens: 300 })
    expect(b.state()).toMatchObject({ infer: 1, ack: 1, cancels: 0 })
    expect((await readAgentRunV1(b.f.scope, c.runId)).run.status).toBe('awaiting_confirmation')
    expect((await readTtrpgOpenAuthoringDesignReviewV1({ scope: b.f.scope, runId: c.runId })).handoffPending).toBe(false)
    expect(await protectedRows()).toBe(b.before)
    expect(await db.productProductions.count()).toBe(0); expect(await db.productBuilds.count()).toBe(0)
  })
  it('recovers completed original bytes/usage after lost observation, with no second inference or cancellation and idempotent candidate events', async () => {
    const b = await bridge()
    await expect(b.generate()).rejects.toThrow('不会自动重发')
    const { runId, cancels } = b.state()
    expect((await readAgentRunV1(b.f.scope, runId)).run.status).toBe('paused')
    const recovered = await recoverTtrpgOpenDesignOriginalReceiptV1({ scope: b.f.scope, runId })
    expect(recovered.candidate?.artifact.status).toBe('ready'); expect(recovered.handoffPending).toBe(false)
    expect(recovered.candidate?.artifact.originalText).toBe(b.receipt().text)
    expect(recovered.candidate?.artifact.callEvidence[0].latencyMs).toBeNull()
    const count = await db.agentRunEvents.count(), reads = b.state().gets
    expect((await recoverTtrpgOpenDesignOriginalReceiptV1({ scope: b.f.scope, runId })).candidate).toEqual(recovered.candidate)
    expect(await db.agentRunEvents.count()).toBe(count); expect(b.state()).toMatchObject({ infer: 1, ack: 1, cancels, gets: reads })
    expect(await protectedRows()).toBe(b.before)
  })
  it('a failed pre-POST owner save creates no inference and ends as a known unsent failure', async () => {
    const b = await bridge(), real = artifacts.recordAgentRunArtifactV1
    vi.spyOn(artifacts, 'recordAgentRunArtifactV1').mockImplementation(input => {
      if (input.content.includes(bindingSchema)) throw new Error('binding storage unavailable')
      return real(input)
    })
    await expect(b.generate()).rejects.toThrow('binding storage unavailable')
    expect(b.state()).toMatchObject({ infer: 0, ack: 0, gets: 0, cancels: 0 })
    expect((await readAgentRunV1(b.f.scope, b.state().runId)).run.status).toBe('failed')
  })
  it.each(['accepted', 'running'] as const)('reads %s without storing raw, acknowledging it or producing a candidate', async status => {
    const b = await bridge(); await expect(b.generate()).rejects.toThrow()
    b.change({ status }); const { runId } = b.state()
    expect(await recoverTtrpgOpenDesignOriginalReceiptV1({ scope: b.f.scope, runId })).toMatchObject({ status, candidate: null })
    expect(b.state()).toMatchObject({ infer: 1, ack: 0 })
    expect((await readAgentRunV1(b.f.scope, runId)).events.some(e => e.type === 'candidate.persisted' || e.type === 'model.responded')).toBe(false)
    expect(await db.agentRunArtifacts.toCollection().filter(row => row.artifactKind === 'raw-response').count()).toBe(0)
  })
  it.each((['unknown', 'failed', 'cancelled'] as const).flatMap(status => [{ status, empty: false }, { status, empty: true }]))('retains $status raw (empty=$empty) and metadata without promoting partial bytes to success', async ({ status, empty }) => {
    const b = await bridge(); await expect(b.generate()).rejects.toThrow()
    b.change({ status, error: 'original terminal reason', ...(empty ? { text: '' } : {}) }); const { runId } = b.state()
    const result = await recoverTtrpgOpenDesignOriginalReceiptV1({ scope: b.f.scope, runId })
    expect(result).toMatchObject({ status, candidate: null, handoffPending: false })
    expect(b.state()).toMatchObject({ infer: 1, ack: 1 })
    expect((await evidence(runId, 'storyforge.ttrpg-open-design-response-metadata')).receiptMetadata.error).toBe('original terminal reason')
    await expect(recoverTtrpgOpenAuthoringDesignCandidateV1({ scope: b.f.scope, runId })).rejects.toThrow('部分回答不能成为候选')
    expect((await readAgentRunV1(b.f.scope, runId)).events.some(e => e.type === 'candidate.persisted')).toBe(false)
    expect(await protectedRows()).toBe(b.before)
  })
  it('a retention handoff failure leaves the saved candidate usable and visible as pending; explicit handoff later reads no new inference or receipt', async () => {
    const b = await bridge(); b.normal()
    const handler = b.fetcher.getMockImplementation()!
    b.fetcher.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/acknowledge')) throw new TypeError('handoff temporarily unavailable')
      return handler(input, init)
    })
    const c = await b.generate()
    expect(c.artifact.status).toBe('ready')
    expect((await readTtrpgOpenAuthoringDesignReviewV1({ scope: b.f.scope, runId: c.runId })).handoffPending).toBe(true)
    const before = b.state()
    b.fetcher.mockImplementation(handler)
    expect(await recoverTtrpgOpenDesignOriginalReceiptV1({ scope: b.f.scope, runId: c.runId })).toMatchObject({ candidate: c, handoffPending: false })
    expect(b.state()).toMatchObject({ infer: 1, gets: before.gets, cancels: before.cancels, ack: 1 })
    expect(await protectedRows()).toBe(b.before)
  })
  it('rejects wrong receipt identity/hash before raw storage, then permits the exact original receipt only', async () => {
    const b = await bridge(); await expect(b.generate()).rejects.toThrow()
    const hash = b.receipt().requestHash, { runId } = b.state()
    b.change({ requestHash: 'f'.repeat(64) })
    await expect(recoverTtrpgOpenDesignOriginalReceiptV1({ scope: b.f.scope, runId })).rejects.toThrow('原冻结')
    expect(await db.agentRunArtifacts.toCollection().filter(row => row.artifactKind === 'raw-response').count()).toBe(0); expect(b.state().ack).toBe(0)
    b.change({ requestHash: hash })
    expect((await recoverTtrpgOpenDesignOriginalReceiptV1({ scope: b.f.scope, runId })).candidate?.artifact.status).toBe('ready')
  })
  it('keeps real over-budget usage blocked after exact raw handoff without changing the original frozen budget', async () => {
    const b = await bridge(); await expect(b.generate()).rejects.toThrow()
    b.change({ usage: { inputTokens: 100, outputTokens: 16_001, totalTokens: 16_101 } })
    const c = (await recoverTtrpgOpenDesignOriginalReceiptV1({ scope: b.f.scope, runId: b.state().runId })).candidate!
    expect(c.artifact.status).toBe('blocked'); expect(c.artifact.issues[0].code).toBe('ttrpg-design-budget')
    expect(b.state()).toMatchObject({ infer: 1, ack: 1 }); expect(await protectedRows()).toBe(b.before)
  })
  it('does not read a local receipt for a foreign or imported Work', async () => {
    const b = await bridge(); await expect(b.generate()).rejects.toThrow()
    const imported = await importProjectJSON(await exportProjectJSON(b.f.scope.projectId))
    const run = (await db.agentRuns.where('projectId').equals(imported).toArray())[0], before = b.fetcher.mock.calls.length
    const work = await db.works.get(run.workId!)
    await expect(recoverTtrpgOpenDesignOriginalReceiptV1({ scope: { projectId: imported, worldId: work!.worldId!, workId: run.workId! }, runId: run.id! })).rejects.toThrow()
    const other = await createSavedOpenDesignFixtureV1()
    await expect(recoverTtrpgOpenDesignOriginalReceiptV1({ scope: other.scope, runId: b.state().runId })).rejects.toThrow()
    expect(b.fetcher).toHaveBeenCalledTimes(before)
  })
  it('an import into an empty database with the same local IDs stays cancelled and cannot claim the original native request', async () => {
    const b = await bridge(); await expect(b.generate()).rejects.toThrow()
    const { runId } = b.state(), original = await evidence(runId, bindingSchema)
    const backup = await exportProjectJSON(b.f.scope.projectId)
    await db.delete(); await db.open()
    const imported = await importProjectJSON(backup), run = (await db.agentRuns.where('projectId').equals(imported).toArray())[0]
    const work = await db.works.get(run.workId!), scope = { projectId: imported, worldId: work!.worldId!, workId: run.workId! }
    expect(scope).toEqual(b.f.scope); expect(run.id).toBe(runId)
    expect(await evidence(run.id!, bindingSchema)).toEqual(original)
    expect(run.status).toBe('cancelled')
    const calls = b.fetcher.mock.calls.length
    await expect(recoverTtrpgOpenDesignOriginalReceiptV1({ scope, runId: run.id! })).rejects.toThrow()
    expect(b.fetcher).toHaveBeenCalledTimes(calls)
  })
  it('a legacy orphan running request has no invented native reference and needs explicit idle-owner dismissal', async () => {
    const f = await createSavedOpenDesignFixtureV1(); let runId = 0
    await expect(generateTtrpgOpenAuthoringDesignCandidateV1({ ...f, runAI: async () => { throw new Error('legacy observation lost') }, onPrepared: id => { runId = id } })).rejects.toThrow()
    const recovery = await beginAgentRunRecoveryV1({ scope: f.scope, runId })
    await completeAgentRunRecoveryV1({ scope: f.scope, runId, checkpointHash: recovery.checkpointHash })
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(recoverTtrpgOpenDesignOriginalReceiptV1({ scope: f.scope, runId })).rejects.toThrow('不会发起模型请求')
    await expect(dismissTtrpgOpenAuthoringDesignRequestV1({ scope: f.scope, runId, confirmation: 'discard-design-request-v1' })).rejects.toThrow('未知的等待')
    expect(await dismissTtrpgOpenAuthoringDesignRequestV1({ scope: f.scope, runId, confirmation: 'discard-design-request-v1', acknowledgeUnknown: true })).toBe('cancelled')
    expect(fetcher).not.toHaveBeenCalled(); expect(await evidence(runId, bindingSchema)).toBeNull()
  })
})
