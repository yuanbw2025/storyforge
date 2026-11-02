import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { AIConfig, ChatMessage, WorkspaceScope } from '../../src/lib/types'
import { readAgentRunV1, readInstanceAgentRunV1, type AgentRunSnapshotV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import * as responseEvidence from '../../src/lib/agent/run/creation-response-evidence'
import { generateTtrpgGmNarrationCandidateV1 } from '../../src/lib/ttrpg/gm-harness'
import { loadTtrpgGmRuntimeViewV1 } from '../../src/lib/ttrpg/gm-context'
import { createDeterministicGmSynthesisFrameV2 } from '../../src/lib/ttrpg/action-feedback'
import { readyAiKpSession } from '../helpers/ready-ttrpg-session'
import { generateAdventureRuntimeCandidateV1 } from '../../src/lib/adventure/harness'
import { availableAdventureActions } from '../../src/lib/adventure/runtime'
import { generateOpenWorldRuntimeCandidateV1 } from '../../src/lib/open-world/harness'
import { readProductRuntimeState, readProductRuntimeStateVersion, commitOpenWorldCommand } from '../../src/lib/open-world/runtime-api'
import { startTextOpenWorldCreatorBriefSessionV1, generateTextOpenWorldCreatorBriefCandidateV1 } from '../../src/lib/open-world/creator-brief'
import { inspectTextOpenWorldCreatorWorldSourceV1 } from '../../src/lib/open-world/creator-source'
import { seedCurrentProductWorld, loadCurrentProductWorldSourceCatalogV1 } from '../helpers/current-product-world'
import { createCurrentRuntimePackageFixture } from '../helpers/current-runtime-package'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

type Kind = 'gm' | 'adventure' | 'open-world' | 'creator'
type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>
interface Fixture {
  kind: Kind; scope: WorkspaceScope; sessionId?: number; raw: string; invalidRaw: string
  generate: (options: { runAI?: RunAI; aiConfig?: AIConfig; signal?: AbortSignal }) => Promise<unknown>
}
interface SavedRaw {
  version: string; raw: string; requestArtifactHash: string; contextManifestHash: string
  observation: { outcome: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null }
}
const config: AIConfig = { provider: 'custom', apiKey: 'synthetic-no-network', model: 'synthetic-002',
  baseUrl: 'http://127.0.0.1:9/v1', temperature: 0, maxTokens: 1024, contextWindow: 128_000 }

async function fixture(kind: Kind): Promise<Fixture> {
  if (kind === 'gm') {
    const seeded = await readyAiKpSession('002 synthetic GM raw')
    const view = await loadTtrpgGmRuntimeViewV1({ scope: seeded.scope, productRuntimeSessionId: seeded.sessionId })
    const receipt = view.latestAction?.receipt
    if (!receipt) throw Error('Synthetic GM fixture must settle a real rule action first')
    const body = { narration: '原文 e\u0301：仅叙述已结算的现场调查。', synthesisFrame: createDeterministicGmSynthesisFrameV2(receipt),
      offeredClueKeys: [], recommendedNextSceneKeys: [] }
    return { kind, scope: seeded.scope, sessionId: seeded.sessionId, raw: JSON.stringify(body),
      invalidRaw: JSON.stringify({ ...body, synthesisFrame: { ...body.synthesisFrame, actionSequence: -1 } }),
      generate: options => generateTtrpgGmNarrationCandidateV1({ scope: seeded.scope, productRuntimeSessionId: seeded.sessionId,
        objective: '只解释已结算行动，保留每次原文', ...options }) }
  }
  if (kind === 'adventure') {
    const world = await seedCurrentProductWorld('002 synthetic Adventure raw')
    if (world.release.id == null) throw Error('Synthetic Adventure fixture must publish a real WorldRelease')
    const release = { ...world.release, id: world.release.id }
    const catalog = await loadCurrentProductWorldSourceCatalogV1({ scope: world.scope, worldReleaseId: release.id, productType: 'text-adventure' })
    const runtimePackage = createCurrentRuntimePackageFixture({ productType: 'text-adventure', worldRelease: release, sourceCatalog: catalog })
    const created = await seedCurrentProductBuild({ scope: world.scope, worldRelease: release, runtimePackage, title: '002 Adventure' })
    const sessionId = created.session.id!, state = await readProductRuntimeState(sessionId)
    const action = availableAdventureActions(runtimePackage.adventure!, state.adventure!).find(item => item.available)?.action
    if (!action) throw Error('Synthetic Adventure fixture must expose a real allowed action')
    return { kind, scope: world.scope, sessionId,
      raw: JSON.stringify({ kind: 'adventure-intent', actionKey: action.key, rationale: '原文 e\u0301：属于冻结行动闭集。', requiresConfirmation: true }),
      invalidRaw: '002 Adventure malformed e\u0301\r\nnot JSON',
      generate: options => generateAdventureRuntimeCandidateV1({ scope: world.scope, productRuntimeSessionId: sessionId,
        skillId: 'prose.adventure-intent-parser', objective: `执行 ${action.label}`, ...options }) }
  }
  if (kind === 'open-world') {
    const seeded = await createGovernedTextOpenWorldSessionFixtureV1({ name: '002 historical World expression',
      textOpenWorldVNext: createTextOpenWorldVNextFixture(), runtimeShape: 'legacy-only' })
    const sessionId = seeded.session.id!
    let state = await readProductRuntimeState(sessionId)
    let quest = state.openWorld?.questInstances.find(item => item.status === 'revealed')
    for (let index = 0; index < 8 && !quest; index++) {
      const version = await readProductRuntimeStateVersion(sessionId)
      await commitOpenWorldCommand({ sessionId, command: index % 2 === 0 ? { kind: 'draw', trigger: 'observe' } : { kind: 'tick' },
        commandId: `002.fixture.${index}`, baseSequence: version.sequence, baseStateHash: version.stateHash })
      state = await readProductRuntimeState(sessionId)
      quest = state.openWorld?.questInstances.find(item => item.status === 'revealed')
    }
    const events = (await db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray()).filter(item => item.type === 'world.quest.revealed')
    const event = events[events.length - 1]
    if (!quest || !event) throw Error('Historical expression fixture must expose a real World quest event')
    return { kind, scope: seeded.scope, sessionId,
      raw: JSON.stringify({ kind: 'quest-expression', instanceKey: quest.instanceKey, title: quest.title,
        text: '原文 e\u0301：只表现已经公开的任务。', dialogue: '', evidenceEventSequences: [event.sequence], assertedReferences: [] }),
      invalidRaw: '002 historical expression malformed e\u0301\r\nnot JSON',
      generate: options => generateOpenWorldRuntimeCandidateV1({ scope: seeded.scope, productRuntimeSessionId: sessionId,
        skillId: 'prose.open-world-quest-expression', objective: '只解释真实历史世界任务', ...options }) }
  }
  const world = await seedCurrentProductWorld('002 synthetic Creator raw')
  const preview = await inspectTextOpenWorldCreatorWorldSourceV1({ scope: world.scope,
    localReleaseRecordId: world.release.id!, expectedReleaseHash: world.release.contentHash })
  const session = await startTextOpenWorldCreatorBriefSessionV1({ selection: { sourceKind: 'world-release', sourceScope: world.scope,
    localReleaseRecordId: world.release.id!, expectedReleaseHash: world.release.contentHash, preview }, sessionKey: '002-raw' })
  return { kind, scope: world.scope,
    raw: JSON.stringify({ suggestedTitle: '原文 e\u0301：潮汐边界', understandingSummary: '在有边界的世界中调查。', playerFantasy: '成为调查者。',
      experiencePromise: '每次选择有明确结果。', primaryConflict: '失踪与告别。', recommendedOpening: '从已知港区开始调查。', protagonistFit: '具有调查动机。',
      experiencePillars: ['调查', '抉择'], sourceUsePlan: ['只使用已确认世界摘要。'], unresolvedQuestions: [], assumptions: ['采用标准难度。'], risks: ['未提供的事实不能臆造。'] }),
    invalidRaw: '002 Creator malformed e\u0301\r\nnot JSON',
    generate: options => generateTextOpenWorldCreatorBriefCandidateV1({ session, draft: session.draft, ...options }) }
}

async function current(f: Fixture): Promise<AgentRunSnapshotV1> {
  const rows = await db.agentRuns.where('projectId').equals(f.scope.projectId).sortBy('id')
  const run = rows[rows.length - 1]
  if (!run) throw Error('Public generation did not create a native Run')
  return f.sessionId == null ? readAgentRunV1(f.scope, run.id!) : readInstanceAgentRunV1(f.scope, run.id!)
}
async function artifacts(f: Fixture, kind: 'raw-response' | 'tool-result' | 'rendered-request') {
  const snapshot = await current(f), result = []
  for (const event of snapshot.events) if (event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === kind) {
    const content = await readAgentRunArtifactExactV1({ projectId: f.scope.projectId, artifactKind: kind, contentHash: event.payload.contentHash })
    result.push({ event, content, value: JSON.parse(content) as SavedRaw })
  }
  return result
}
async function assertRaw(f: Fixture, outputs: string[]) {
  const snapshot = await current(f), saved = await artifacts(f, 'raw-response')
  expect(saved.map(item => item.value.raw)).toEqual(outputs)
  expect(snapshot.run.productRuntimeSessionId ?? undefined).toBe(f.sessionId)
  for (const [index, item] of saved.entries()) {
    expect(item.value.version).toBe('creation-model-response-v1')
    expect(item.event.payload.attempt).toBe(index + 1)
    const request = snapshot.events.find(event => event.type === 'evidence.artifact.recorded'
      && event.payload.artifactKind === 'rendered-request' && event.payload.contentHash === item.value.requestArtifactHash)
    const requested = snapshot.events.find(event => event.type === 'model.requested' && event.payload.attempt === index + 1)
    const responded = snapshot.events.find(event => event.type === 'model.responded' && event.payload.attempt === index + 1)
    expect(request?.sequence).toBeLessThan(requested!.sequence)
    expect(requested!.sequence).toBeLessThan(item.event.sequence)
    if (responded) expect(item.event.sequence).toBeLessThan(responded.sequence)
  }
  return saved
}
function containsCause(error: unknown, target: unknown): boolean {
  if (error === target) return true
  if (!error || typeof error !== 'object') return false
  const value = error as { cause?: unknown; persistenceFailures?: unknown[] }
  return (value.cause != null && containsCause(value.cause, target)) || !!value.persistenceFailures?.some(item => containsCause(item, target))
}
let expectedPosts = 0
beforeEach(async () => {
  await db.delete(); await db.open(); expectedPosts = 0
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw Error('No real model or network is authorized') }))
})
afterEach(async () => {
  try { expect(fetch).toHaveBeenCalledTimes(expectedPosts) }
  finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete() }
})

describe('SFQA-002 runtime and Creator per-attempt exact response evidence', () => {
  for (const kind of ['gm', 'adventure', 'open-world', 'creator'] as const) {
    it(`${kind}: preserves original Unicode and whitespace before candidate parsing and after reopen`, async () => {
      const f = await fixture(kind), raw = `\r\n  ${f.raw}\r\n\t`
      const beforeEvents = await db.productRuntimeEvents.toArray()
      const runAI = vi.fn(async () => raw)
      await f.generate({ runAI })
      await assertRaw(f, [raw])
      expect((await current(f)).events.some(event => event.type === 'candidate.persisted')).toBe(true)
      const before = (await artifacts(f, 'raw-response')).map(item => item.content)
      db.close(); await db.open()
      expect((await assertRaw(f, [raw])).map(item => item.content)).toEqual(before)
      expect(await db.productRuntimeEvents.toArray()).toEqual(beforeEvents)
      expect(runAI).toHaveBeenCalledTimes(1)
    })

    it(`${kind}: keeps every returned protocol failure with the original bounded call count`, async () => {
      const f = await fixture(kind), outputs = [f.invalidRaw, f.invalidRaw + '\r\n ']
      const runAI = vi.fn(async (): Promise<string> => outputs[runAI.mock.calls.length - 1]!)
      await expect(f.generate({ runAI })).rejects.toThrow()
      const calls = kind === 'gm' || kind === 'creator' ? 2 : 1
      expect(runAI).toHaveBeenCalledTimes(calls)
      await assertRaw(f, outputs.slice(0, calls))
      expect((await current(f)).events.some(event => event.type === 'candidate.persisted')).toBe(false)
    })

    it(`${kind}: retains actual-client usage when native raw storage fails, stops before parse/repair and preserves the cause`, async () => {
      const f = await fixture(kind); expectedPosts = 1
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
        choices: [{ message: { content: f.invalidRaw }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })))
      const failure = Error('002 native response quota failure'), add = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
      let rawWrites = 0
      vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(row => add(row).then(id => {
        if (row.artifactKind === 'raw-response') { rawWrites++; throw failure }
        return id
      }))
      let error: unknown
      try { await f.generate({ aiConfig: config }) } catch (cause) { error = cause }
      expect(rawWrites).toBe(1)
      expect(containsCause(error, failure)).toBe(true)
      const observation = (await artifacts(f, 'tool-result')).find(item => item.value.version === 'creation-model-observation-v1')
      expect(observation?.value.observation).toMatchObject({ outcome: 'returned', usage: { inputTokens: 13, outputTokens: 5, totalTokens: 18 } })
      expect(await artifacts(f, 'raw-response')).toHaveLength(0)
      expect((await current(f)).events.some(event => event.type === 'candidate.persisted')).toBe(false)
    })

    it(`${kind}: keeps unknown transport metadata without inventing returned text or making another request`, async () => {
      const f = await fixture(kind); expectedPosts = 1
      const failure = new TypeError('002 controlled unknown transport outcome')
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw failure }))
      await expect(f.generate({ aiConfig: config })).rejects.toThrow('002 controlled unknown transport outcome')
      expect(await artifacts(f, 'raw-response')).toHaveLength(0)
      const observation = (await artifacts(f, 'tool-result')).find(item => item.value.version === 'creation-model-observation-v1')
      expect(observation?.value.observation).toMatchObject({ outcome: 'unavailable', usage: null })
      expect((await current(f)).events.some(event => event.type === 'candidate.persisted')).toBe(false)
    })
  }

  for (const kind of ['gm', 'creator'] as const) it(`${kind}: successful repair keeps both attempts and their distinct request links`, async () => {
    const f = await fixture(kind), outputs = [f.invalidRaw, `\n ${f.raw}\n`]
    const runAI = vi.fn(async (): Promise<string> => outputs[runAI.mock.calls.length - 1]!)
    await f.generate({ runAI })
    const saved = await assertRaw(f, outputs)
    expect(saved[0]!.value.requestArtifactHash).not.toBe(saved[1]!.value.requestArtifactHash)
    expect((await current(f)).events.some(event => event.type === 'candidate.persisted')).toBe(true)
    expect(runAI).toHaveBeenCalledTimes(2)
  })

  it('freezes only the real native runtime owner and rejects forged snapshot/request owners without writes', async () => {
    const f = await fixture('adventure')
    type Prepared = Awaited<ReturnType<typeof responseEvidence.recordCreationModelRequestV1>>
    const carrier: { prepared?: Prepared; messages?: ChatMessage[] } = {}
    const original = responseEvidence.recordCreationModelRequestV1
    vi.spyOn(responseEvidence, 'recordCreationModelRequestV1').mockImplementation(async input => {
      const prepared = await original(input); carrier.prepared = prepared; return prepared
    })
    await f.generate({ runAI: async messages => { carrier.messages = messages; return f.raw } })
    if (!carrier.prepared || !carrier.messages) throw Error('Actual runtime request was not observed')
    const { request } = carrier.prepared, snapshot = await current(f)
    expect(request.productRuntimeSessionId).toBe(f.sessionId)
    expect(Object.isFrozen(request)).toBe(true); expect(Object.isFrozen(request.scope)).toBe(true)
    const before = await current(f), count = await db.agentRunArtifacts.count()
    const forged = structuredClone(snapshot); forged.run.productRuntimeSessionId = f.sessionId! + 100_000
    await expect(responseEvidence.recordCreationModelResponseV1({ snapshot: forged, request, raw: f.raw })).rejects.toThrow(/原运行/)
    await expect(original({ scope: f.scope, snapshot: forged, stepId: request.stepId, attempt: request.attempt,
      contextManifestHash: request.contextManifestHash, messages: carrier.messages })).rejects.toMatchObject({ code: 'runtime-owner' })
    expect(await current(f)).toEqual(before); expect(await db.agentRunArtifacts.count()).toBe(count)
  })

  it('keeps the original ordinary Work request bytes and hash when no runtime owner exists', async () => {
    const f = await fixture('creator')
    const carrier: { messages?: ChatMessage[] } = {}
    await f.generate({ runAI: async messages => { carrier.messages = structuredClone(messages); return f.raw } })
    const snapshot = await current(f), saved = await artifacts(f, 'rendered-request')
    expect(saved).toHaveLength(1)
    const envelope = JSON.parse(saved[0]!.content) as { generation: number; contractHash: string; stepId: string; attempt: number; contextManifestHash: string }
    const expected = JSON.stringify({ version: 'creation-model-request-v1', generation: snapshot.projection.generation,
      contractHash: snapshot.projection.contractHash, stepId: envelope.stepId, attempt: 1,
      contextManifestHash: envelope.contextManifestHash, messages: carrier.messages })
    expect(saved[0]!.content).toBe(expected)
    expect(Object.prototype.hasOwnProperty.call(envelope, 'productRuntimeSessionId')).toBe(false)
    expect(snapshot.run.productRuntimeSessionId).toBeNull()
  })
})
