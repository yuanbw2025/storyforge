import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readOwnedRows, stampNewRecord } from '../../src/lib/workspace/scope'
import { getOrCreateAgentConversation } from '../../src/lib/agent/conversations'
import { restoreMasterAgentCandidatesV1, runDurableMasterAgentPlanV1 } from '../../src/lib/agent/run/master-durable'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { verifyContextGatewayCandidateEvidenceV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { commitMasterAgentCandidateAdoptionV1 } from '../../src/lib/agent/run/master-adoption'
import { verifyMasterAgentRunV1 } from '../../src/lib/agent/run/master-verification'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import type { AgentSkillId } from '../../src/lib/agent/skill-registry'
import type { AIConfig, WorkspaceScope } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const original = {
  config: structuredClone(useAIConfigStore.getState().config),
  presets: structuredClone(useAIConfigStore.getState().presets),
  taskRoutes: structuredClone(useAIConfigStore.getState().taskRoutes),
  creativeQualityMode: useAIConfigStore.getState().creativeQualityMode,
}
const config: AIConfig = { provider: 'custom', apiKey: '', model: 'master-raw-isolated', baseUrl: 'http://127.0.0.1:9/v1', temperature: 0, maxTokens: 12_000, contextWindow: 128_000 }
const detailRaw = `\r\n  ${JSON.stringify({ openingHook: '潮声从门缝涌来。 e\u0301_RAW002_DETAIL', endingCliffhanger: '灯芯映出第二道影子。', sceneLocation: '潮门内港', emotionArc: 'rising', appearingCharacterIds: [], foreshadowIds: [], prohibitions: [], scenes: [{ title: '潮门回响', summary: '守灯人发现刻痕移动，决定拦住最后一班船。', location: '潮门内港', conflict: '时间紧迫与未知警告。', pace: 'fast', characterIds: [], estimatedWords: 1200 }] })}\n\t`
const arcRaw = `  ${JSON.stringify({ storyArcs: [{ name: '守城调查', type: 'main', description: '守灯人保护潮门并查清旧案。 e\u0301_RAW002_ARC', stages: [{ title: '接到警告', description: '守灯人得知大潮迫近。', keyEvents: ['发现异常潮声。'] }, { title: '追查旧案', description: '守灯人寻找刻痕来源。', keyEvents: ['找到旧日志。'] }, { title: '守住潮门', description: '守灯人与盟友堵住暗河。', keyEvents: ['完成守门任务。'] }] }] }, null, 2)}\r\n\t`
const outlineRaw = `\r\n ${JSON.stringify([{ title: '第一卷·回响', summary: '守灯人调查潮门刻痕，决定拦下最后一班船。 e\u0301_RAW002_OUTLINE' }])} \t`
const proseRaw = '\r\n 守灯人推开潮门，鞋底陷进冰冷的细沙。他先拽住准备离港的船夫，指向门柱上刚刚移动的刻痕。船夫拒绝停船，潮声却突然从城内响起。守灯人决定割断缆绳，将船横在门前，逼所有人先核实水位。灯塔在这时熄灭，黑暗里传来第二个人的呼吸。 e\u0301_RAW002_PROSE\n\t'
type Kind = 'detail' | 'arc' | 'outline' | 'prose'
const skills: Record<Kind, AgentSkillId> = { detail: 'outline.details', arc: 'outline.story-arcs', outline: 'outline.volumes', prose: 'prose.write' }
const instructions: Record<Kind, string> = { detail: '完善《潮门》的场景细纲', arc: '生成守城主线故事线', outline: '生成全书卷纲', prose: '生成《潮门》正文' }
const normal: Record<Kind, string> = { detail: detailRaw, arc: arcRaw, outline: outlineRaw, prose: proseRaw }
interface Observation {
  outcome: 'returned' | 'unavailable'
  usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null
  finishReason: string | null
  requestLifecycle: { phase: string; responseStatus: number | null } | null
}
interface RawBody { version: string; raw: string; requestArtifactHash: string; contextManifestHash: string; observation: Observation }
interface CallBody { version: string; taskId: string; callIndex: number; purpose: string; outcome: string; requestArtifactHash: string; rawResponseArtifactHash: string | null; outputHash?: string }
async function fixture(kind: Kind) {
  const f = await seedCurrentWorkspace(`002 Master ${kind}`)
  const now = Date.now()
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
    projectId: f.scope.projectId, worldGroupId: null, parentId: null, type: 'chapter', title: '潮门', summary: '守灯人抵达潮门，必须在涨潮前找出灯塔失火的真相。', order: 0, createdAt: now, updatedAt: now,
  }, { owner: 'work' })) as number
  const conversation = await getOrCreateAgentConversation({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, purpose: 'master-authoring' })
  return { ...f, outlineNodeId, generate: (disableAutomaticReplanForTest = false) => runDurableMasterAgentPlanV1({
    scope: f.scope, worldGroupId: null, conversationId: conversation.id!,
    plan: { summary: instructions[kind], tasks: [{ id: 'raw-task', agentId: kind === 'prose' ? 'prose' : 'outline', skillId: skills[kind], instruction: instructions[kind], dependsOn: [] }], workflow: { version: 1, workflowId: 'single-domain-direct', reasonCodes: ['single-explicit-domain'] } },
  }, { disableAutomaticReplanForTest }) }
}
function transport(replies: Array<string | Error>, afterResponse?: (index: number) => Promise<void>) {
  const requests: unknown[] = []
  const syntheticFetch = vi.fn<typeof fetch>(async (_url, init) => {
    const index = requests.length
    requests.push(JSON.parse(String(init?.body)))
    if (index >= replies.length) throw new Error('Unexpected model resend')
    const reply = replies[index]!
    if (reply instanceof Error) throw reply
    await afterResponse?.(index)
    return new Response(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: 'stop' }], usage: { prompt_tokens: 17 + index, completion_tokens: 9 + index, total_tokens: 26 + 2 * index } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', syntheticFetch)
  return { syntheticFetch, requests }
}
async function snapshot(scope: WorkspaceScope): Promise<AgentRunSnapshotV1> {
  const rows = await db.agentRuns.where('projectId').equals(scope.projectId).toArray()
  expect(rows).toHaveLength(1)
  return readAgentRunV1(scope, rows[0]!.id!)
}
async function evidence(scope: WorkspaceScope) {
  const current = await snapshot(scope)
  const raws: Array<{ contentHash: string; body: RawBody }> = []
  const calls: CallBody[] = []
  for (const event of current.events) {
    if (event.type !== 'evidence.artifact.recorded') continue
    if (event.payload.artifactKind !== 'raw-response' && event.payload.artifactKind !== 'tool-result') continue
    const content = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash })
    const body = JSON.parse(content) as RawBody | CallBody
    if (body.version === 'creation-model-response-v1') raws.push({ contentHash: event.payload.contentHash, body: body as RawBody })
    if (body.version === 'master-model-call-v1') calls.push(body as CallBody)
  }
  return { current, raws, calls }
}
async function assertEvidence(scope: WorkspaceScope, outputs: string[]) {
  const saved = await evidence(scope)
  expect(saved.raws.map(row => row.body.raw)).toEqual(outputs)
  expect(saved.calls.filter(call => call.outcome === 'returned').map(call => call.callIndex)).toEqual(outputs.map((_, index) => index + 1))
  for (const [index, row] of saved.raws.entries()) {
    const call = saved.calls[index]!
    expect(call).toMatchObject({ taskId: 'raw-task', purpose: index === 0 ? 'generate' : 'repair', requestArtifactHash: row.body.requestArtifactHash, rawResponseArtifactHash: row.contentHash, outputHash: await hashCanonicalValue(outputs[index]) })
    expect(row.body.observation).toEqual({ outcome: 'returned', usage: { inputTokens: 17 + index, outputTokens: 9 + index, totalTokens: 26 + 2 * index }, finishReason: 'stop', requestLifecycle: { phase: 'response-observed', responseStatus: 200 } })
    const requestEvent = saved.current.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'rendered-request' && event.payload.contentHash === call.requestArtifactHash)
    const responseEvent = saved.current.events.find(event => event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response' && event.payload.contentHash === row.contentHash)
    expect(requestEvent?.sequence).toBeLessThan(responseEvent!.sequence)
    expect(responseEvent?.type === 'evidence.artifact.recorded' && responseEvent.payload).toMatchObject({ stepId: 'master:raw-task', attempt: 1 })
    const request = JSON.parse(await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'rendered-request', contentHash: call.requestArtifactHash })) as { contextManifestHash: string; messages: unknown[] }
    expect(request.contextManifestHash).toBe(row.body.contextManifestHash)
    expect(request.messages.length).toBeGreaterThan(0)
  }
  return saved
}
function hasCause(value: unknown, primary: unknown, seen = new Set<unknown>()): boolean {
  if (value === primary) return true
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const error = value as { cause?: unknown; persistenceFailures?: unknown[] }
  return hasCause(error.cause, primary, seen) || !!error.persistenceFailures?.some(cause => hasCause(cause, primary, seen))
}
async function canon(scope: WorkspaceScope) {
  return { outlines: await readOwnedRows(scope, 'outlineNodes', { owner: 'work' }), details: await readOwnedRows(scope, 'detailedOutlines', { owner: 'work' }), arcs: await readOwnedRows(scope, 'storyArcs', { owner: 'work' }), chapters: await readOwnedRows(scope, 'chapters', { owner: 'work' }) }
}

describe.sequential('SFQA-002 Master raw response boundaries', () => {
  beforeEach(async () => {
    await db.delete(); await db.open()
    useAIConfigStore.setState({ config, presets: [], taskRoutes: {}, creativeQualityMode: 'balanced' })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('No external network or real model is authorized') }))
  })
  afterEach(async () => {
    vi.restoreAllMocks(); vi.unstubAllGlobals(); useAIConfigStore.setState(original); await db.delete()
  })
  for (const kind of ['detail', 'arc', 'outline', 'prose'] as const) it(`${kind}: stores actual-client Unicode/whitespace raw before the candidate and restores without a send`, async () => {
    const f = await fixture(kind)
    const before = await canon(f.scope)
    const { syntheticFetch } = transport([normal[kind]])
    const result = await f.generate()
    expect(result.projection.state).toBe('awaiting_confirmation')
    const saved = await assertEvidence(f.scope, [normal[kind]])
    expect(saved.current.events.filter(event => event.type === 'model.responded')).toHaveLength(1)
    expect(saved.current.events.find(event => event.type === 'model.responded')?.payload).toMatchObject({ outputHash: await hashCanonicalValue(result.candidates[0]!.runtime!.runtimeOutput) })
    await verifyContextGatewayCandidateEvidenceV1({ scope: f.scope, runId: result.runId, stepId: 'master:raw-task', attempt: 1, candidateHash: result.candidates[0]!.payload.candidateHash! })
    expect(result.candidates[0]!.payload.creativeArtifact?.originalText).toBe(normal[kind])
    expect(await canon(f.scope)).toEqual(before)
    db.close(); await db.open()
    await assertEvidence(f.scope, [normal[kind]])
    expect((await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: result.runId })).candidates[0]!.draft).toBe(result.candidates[0]!.draft)
    if (kind === 'arc') {
      await commitMasterAgentCandidateAdoptionV1({ scope: f.scope, runId: result.runId, candidateEventId: result.candidates[0]!.event.id! })
      expect((await verifyMasterAgentRunV1({ scope: f.scope, runId: result.runId })).accepted).toBe(true)
      expect(await db.storyArcs.count()).toBe(1)
    }
    expect(syntheticFetch).toHaveBeenCalledTimes(1)
  })
  it('original detail source-stale window retains the returned response before rejecting the candidate', async () => {
    const f = await fixture('detail')
    const { syntheticFetch } = transport([detailRaw], async () => {
      await db.outlineNodes.update(f.outlineNodeId, { summary: '作者新摘要：潮门已开放，改走山路。', updatedAt: Date.now() + 1 })
    })
    await expect(f.generate(true)).rejects.toThrow(/过期|变化|stale/i)
    const saved = await assertEvidence(f.scope, [detailRaw])
    expect(saved.current.events.some(event => event.type === 'model.responded')).toBe(true)
    expect(saved.current.events.some(event => event.type === 'candidate.persisted')).toBe(false)
    expect(await db.detailedOutlines.count()).toBe(0)
    expect((await db.outlineNodes.get(f.outlineNodeId))?.summary).toContain('作者新摘要')
    db.close(); await db.open(); await assertEvidence(f.scope, [detailRaw])
    expect(syntheticFetch).toHaveBeenCalledTimes(1)
  })
  it('story-arc repair success keeps both exact envelopes, actual usage and distinct request/call bindings', async () => {
    const f = await fixture('arc')
    const first = 'RAW002_FIRST e\u0301\r\nnot_json'
    const { syntheticFetch, requests } = transport([first, arcRaw])
    const result = await f.generate()
    const saved = await assertEvidence(f.scope, [first, arcRaw])
    expect(saved.calls[0]!.requestArtifactHash).not.toBe(saved.calls[1]!.requestArtifactHash)
    expect(requests[0]).not.toEqual(requests[1])
    expect(result.candidates[0]!.payload.creativeArtifact).toMatchObject({ originalText: first, status: 'ready', repair: { result: 'repaired' }, callEvidence: [{ outputHash: await hashCanonicalValue(first) }, { outputHash: await hashCanonicalValue(arcRaw) }] })
    expect(result.candidates[0]!.draft).not.toBe(arcRaw)
    expect(result.candidates[0]!.draft).toContain('RAW002_ARC')
    expect(saved.current.events.find(event => event.type === 'model.responded')?.payload).toMatchObject({ outputHash: await hashCanonicalValue(result.candidates[0]!.runtime!.runtimeOutput) })
    await verifyContextGatewayCandidateEvidenceV1({ scope: f.scope, runId: result.runId, stepId: 'master:raw-task', attempt: 1, candidateHash: result.candidates[0]!.payload.candidateHash! })
    expect(await db.storyArcs.count()).toBe(0)
    db.close(); await db.open(); await assertEvidence(f.scope, [first, arcRaw])
    expect((await restoreMasterAgentCandidatesV1({ scope: f.scope, runId: result.runId })).candidates).toHaveLength(1)
    await commitMasterAgentCandidateAdoptionV1({ scope: f.scope, runId: result.runId, candidateEventId: result.candidates[0]!.event.id! })
    expect((await verifyMasterAgentRunV1({ scope: f.scope, runId: result.runId })).accepted).toBe(true)
    expect(await db.storyArcs.count()).toBe(1)
    await assertEvidence(f.scope, [first, arcRaw])
    expect(syntheticFetch).toHaveBeenCalledTimes(2)
  })
  it('two malformed story-arc responses stay exact while the existing manual-repair candidate cannot be adopted', async () => {
    const f = await fixture('arc')
    const outputs = ['FIRST e\u0301\r\nnot_json', 'SECOND e\u0301\nnot_json']
    const { syntheticFetch } = transport(outputs)
    const result = await f.generate()
    await assertEvidence(f.scope, outputs)
    expect(result.candidates[0]!.payload.creativeArtifact).toMatchObject({ status: 'manual-repair', originalText: outputs[0], editableText: outputs[1], repair: { result: 'failed' } })
    await expect(commitMasterAgentCandidateAdoptionV1({ scope: f.scope, runId: result.runId, candidateEventId: result.candidates[0]!.event.id! })).rejects.toThrow(/手动修复|不能采纳/)
    expect(await db.storyArcs.count()).toBe(0)
    expect(syntheticFetch).toHaveBeenCalledTimes(2)
  })
  it('unknown first response stores actual transport observation without a fabricated body or resend', async () => {
    const f = await fixture('arc')
    const { syntheticFetch } = transport([new TypeError('RAW002 unknown transport')])
    await expect(f.generate()).rejects.toThrow('RAW002 unknown transport')
    const saved = await evidence(f.scope)
    expect(saved.raws).toHaveLength(0)
    expect(saved.calls).toMatchObject([{ callIndex: 1, outcome: 'unavailable', rawResponseArtifactHash: null }])
    const bodies = await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()
    const observed = bodies.filter(row => row.artifactKind === 'tool-result').map(row => JSON.parse(row.content!)).find(row => row.version === 'creation-model-observation-v1') as { observation: Observation }
    expect(observed.observation).toEqual({ outcome: 'unavailable', usage: null, finishReason: null, requestLifecycle: { phase: 'request-dispatched', responseStatus: null } })
    expect(saved.current.events.some(event => event.type === 'candidate.persisted')).toBe(false)
    expect(syntheticFetch).toHaveBeenCalledTimes(1)
  })
  it('an unknown repair retains the paid first response and never invents a second raw or third call', async () => {
    const f = await fixture('arc')
    const first = 'RAW002_FIRST e\u0301\r\nnot_json'
    const { syntheticFetch } = transport([first, new TypeError('RAW002 repair transport unknown')])
    const result = await f.generate()
    const saved = await evidence(f.scope)
    expect(saved.raws.map(row => row.body.raw)).toEqual([first])
    expect(saved.calls).toMatchObject([{ callIndex: 1, outcome: 'returned' }, { callIndex: 2, outcome: 'unavailable', rawResponseArtifactHash: null }])
    expect(result.candidates[0]!.payload.creativeArtifact).toMatchObject({ status: 'manual-repair', originalText: first, repair: { result: 'failed' } })
    await expect(commitMasterAgentCandidateAdoptionV1({ scope: f.scope, runId: result.runId, candidateEventId: result.candidates[0]!.event.id! })).rejects.toThrow(/手动修复|不能采纳/)
    expect(await db.storyArcs.count()).toBe(0)
    db.close(); await db.open()
    expect((await evidence(f.scope)).raws[0]!.body.raw).toBe(first)
    expect(syntheticFetch).toHaveBeenCalledTimes(2)
  })
  it('a failed request-evidence transaction stops before the first actual POST', async () => {
    const f = await fixture('arc')
    const { syntheticFetch } = transport([arcRaw])
    const primary = new Error('RAW002 request evidence transaction failed')
    const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
    vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeAdd(record).then(id => {
      if (record.artifactKind === 'rendered-request' && record.content?.includes('creation-model-request-v1')) throw primary
      return id
    }))
    await expect(f.generate()).rejects.toBe(primary)
    const saved = await evidence(f.scope)
    expect(saved.raws).toHaveLength(0)
    expect(saved.calls).toHaveLength(0)
    expect(saved.current.events.some(event => event.type === 'candidate.persisted')).toBe(false)
    expect(syntheticFetch).not.toHaveBeenCalled()
  })
  it('an observation write failure still preserves the exact returned raw and usage, then blocks repair', async () => {
    const f = await fixture('arc')
    const first = 'RAW002_OBSERVATION_FAIL e\u0301\r\nnot_json'
    const { syntheticFetch } = transport([first, arcRaw])
    const primary = new Error('RAW002 observation transaction failed')
    const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
    vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeAdd(record).then(id => {
      if (record.artifactKind === 'tool-result' && record.content?.includes('creation-model-observation-v1')) throw primary
      return id
    }))
    let error: unknown
    try { await f.generate() } catch (cause) { error = cause }
    expect(hasCause(error, primary)).toBe(true)
    const saved = await evidence(f.scope)
    expect(saved.raws.map(row => row.body.raw)).toEqual([first])
    expect(saved.raws[0]!.body.observation.usage).toEqual({ inputTokens: 17, outputTokens: 9, totalTokens: 26 })
    expect(saved.current.events.some(event => event.type === 'candidate.persisted')).toBe(false)
    expect(await db.storyArcs.count()).toBe(0)
    expect(syntheticFetch).toHaveBeenCalledTimes(1)
  })
  for (const failedCall of [1, 2]) it(`raw persistence failure at call ${failedCall} preserves its cause/actual usage and prevents candidate or further model calls`, async () => {
    const f = await fixture('arc')
    const first = 'FIRST e\u0301\r\nnot_json'
    const { syntheticFetch } = transport([first, arcRaw])
    const primary = new Error(`RAW002 native raw transaction failure ${failedCall}`)
    const nativeAdd = db.agentRunArtifacts.add.bind(db.agentRunArtifacts)
    let writes = 0
    vi.spyOn(db.agentRunArtifacts, 'add').mockImplementation(record => nativeAdd(record).then(id => {
      if (record.artifactKind === 'raw-response' && ++writes === failedCall) throw primary
      return id
    }))
    let error: unknown
    try { await f.generate() } catch (cause) { error = cause }
    expect(hasCause(error, primary)).toBe(true)
    const saved = await evidence(f.scope)
    expect(saved.raws.map(row => row.body.raw)).toEqual(failedCall === 1 ? [] : [first])
    expect(saved.current.events.some(event => event.type === 'candidate.persisted')).toBe(false)
    expect(saved.current.events.filter(event => event.type === 'step.failed')).toMatchObject([{ payload: { code: 'model_evidence_persistence_failed', retryable: false, action: 'pause-for-author' } }])
    const observations = (await db.agentRunArtifacts.where('projectId').equals(f.scope.projectId).toArray()).filter(row => row.artifactKind === 'tool-result').map(row => JSON.parse(row.content!)).filter(row => row.version === 'creation-model-observation-v1') as Array<{ observation: Observation }>
    expect(observations).toHaveLength(failedCall)
    expect(observations[failedCall - 1]!.observation.usage).toEqual({ inputTokens: 16 + failedCall, outputTokens: 8 + failedCall, totalTokens: 24 + 2 * failedCall })
    expect(await db.storyArcs.count()).toBe(0)
    expect(syntheticFetch).toHaveBeenCalledTimes(failedCall)
  })
})
