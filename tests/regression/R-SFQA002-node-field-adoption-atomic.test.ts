import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AsyncLocalStorage } from 'node:async_hooks'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope, Worldview, StoryCore, WorldGroup, PromptTemplate } from '../../src/lib/types'
import { seedCurrentWorkspace, addCurrentWorldFixtureV1, addCurrentWorkFixtureV1 } from '../helpers/current-workspace'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { useWorldviewStore } from '../../src/stores/worldview'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { runAuthoringGraph, reviseAuthoringCandidate } from '../../src/lib/node-authoring/executor'
import {
  confirmNodeFieldAdoptionIntentV1, commitNodeFieldBusinessV1, readNodeFieldAdoptionProofV1,
} from '../../src/lib/node-authoring/field-adoption'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import * as runStore from '../../src/lib/agent/run/event-store'
import { readNodeFieldProducerPrefixV1 } from '../../src/lib/node-authoring/field-producer'
import { parseAuthoringGraph } from '../../src/lib/node-authoring/graph-codec'
import { inspectAuthoringGraphFreshness } from '../../src/lib/node-authoring/freshness'
import { readAuthoringCanonBinding } from '../../src/lib/node-authoring/bindings'
import { renderAuthoringPromptControl } from '../../src/lib/node-authoring/prompt-control'
import * as promptBindings from '../../src/lib/ai/prompt-variable-bindings'
import * as scopeStore from '../../src/lib/workspace/scope'
import { switchActiveWork } from '../../src/lib/workspace/works'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { verifyContextGatewayCandidateEvidenceV1 } from '../../src/lib/context-gateway/attempt-evidence'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { adopt } from '../../src/lib/registry/adopt'
import { listSettingAssertionSources, adoptSettingAssertionCandidatesAtomicV1 } from '../../src/lib/fact-ledger/setting-assertions'
import * as usageLog from '../../src/lib/ai/usage-log'

type Family = 'world' | 'story'
const STEP = 'node-field:generate'
async function allTables() {
  const result: Record<string, unknown[]> = {}
  for (const table of db.tables) result[table.name] = await table.toArray()
  return result
}
async function operationalArtifacts() {
  return (await db.agentRunArtifacts.toArray()).filter(row => row.artifactKind === 'raw-response' || row.artifactKind === 'context-manifest')
}
async function selectedRun(scope: WorkspaceScope, nodeRunId: number, index: number) {
  const rows = await db.agentRuns.where('workId').equals(scope.workId)
    .filter(row => row.nodeRunId === nodeRunId && row.nodeProducerNodeId === 'field' && row.nodeProducerVariantIndex === index).toArray()
  if (rows.length !== 1 || rows[0].id == null) throw new Error('FIXTURE_READINESS: one actual producer tuple required')
  return readAgentRunV1(scope, rows[0].id)
}

describe.sequential('D4a native first intent and attributable field write', () => {
  let usage: Promise<unknown>[]
  beforeEach(async () => {
    await db.delete(); await db.open(); usage = []
    vi.stubGlobal('window', undefined)
    useAIConfigStore.getState().setConfig({ provider: 'custom', apiKey: '', model: 'isolated-node-model',
      baseUrl: 'http://127.0.0.1:9/v1', temperature: .5, maxTokens: 8_000, contextWindow: 128_000 })
    const original = usageLog.recordUsage
    vi.spyOn(usageLog, 'recordUsage').mockImplementation(function (this: unknown, input) {
      const pending = original.call(this, input); usage.push(pending); return pending
    })
  })
  afterEach(async () => { await Promise.allSettled(usage); vi.unstubAllGlobals(); vi.restoreAllMocks(); await db.delete() })

  async function fixture(family: Family, count = 2, withFact = false, options: { missingTarget?: boolean; groups?: 'null-target' | 'group-target' } = {}) {
    const { scope } = await seedCurrentWorkspace(`D4a ${family}`, { enableMultiWorld: options.groups === 'group-target' })
    await useWorldviewStore.getState().loadAll(scope, null)
    if (!(options.missingTarget && family === 'world')) await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: null,
      worldOrigin: '原世界起源于潮汐；这一旧依据不能被重新签名。' }, scope)
    if (!(options.missingTarget && family === 'story')) await useWorldviewStore.getState().saveStoryCore({ projectId: scope.projectId,
      theme: '原主题', logline: '林舟的真实身份是守潮人；他必须为旧承诺付出代价。',
      centralConflict: '原冲突', plotPattern: '线性' }, scope)
    const groups: number[] = []
    if (options.groups) {
      if (family !== 'world') throw new Error('FIXTURE_READINESS: worldview group control only')
      for (const [index, name] of ['合法世界组A', '合法世界组B'].entries()) {
        const result = await adopt({ projectId: scope.projectId, scope, target: 'worldGroups', mode: 'add',
          data: { name, type: 'parallel', description: `${name}完整作者资料`, icon: '🌐', order: index + 1,
            entryCondition: '作者明确选择', powerRestriction: '原设定约束', plannedChapterCount: 1 } })
        if (result.written.length !== 1) throw Object.assign(new Error('FIXTURE_READINESS: registered WorldGroup DTO failed'), { actualAdoptResult: result })
        groups.push(result.written[0].id)
        await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: result.written[0].id,
          worldOrigin: `${name}的原世界来源；必须保留另一组。` }, scope)
      }
    }
    const targetGroupId = options.groups === 'group-target' ? groups[0] : null
    const field = family === 'world' ? 'worldOrigin' : withFact ? 'logline' : 'theme'
    const table = family === 'world' ? 'worldviews' : 'storyCores'
    if (options.missingTarget && (await readOwnedRows(scope, table, { owner: family === 'world' ? 'world' : 'work' })).length) throw new Error('FIXTURE_READINESS: target must be truly absent before generation')
    let factId: number | undefined
    if (withFact) {
      const character = family === 'story' ? await adopt({ projectId: scope.projectId, scope, worldGroupId: null,
        target: 'characters', mode: 'add', data: { name: '林舟', roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral' } }) : null
      if (character && character.written.length !== 1) throw new Error('FIXTURE_READINESS: real character adoption failed')
      const sources = await listSettingAssertionSources(scope.projectId, targetGroupId, scope)
      const targetRows = await readOwnedRows<Record<string, unknown>>(scope, table, { owner: family === 'world' ? 'world' : 'work' })
      const factTarget = family === 'world' ? targetRows.find(row => (row.worldGroupId ?? null) === targetGroupId) : targetRows[0]
      if (!factTarget || typeof factTarget.id !== 'number') throw new Error('FIXTURE_READINESS: exact setting source target missing')
      const source = sources.find(value => value.table === table && value.field === field && value.recordId === factTarget.id)
      if (!source) throw new Error('FIXTURE_READINESS: registered setting source missing')
      const storedGroup = targetGroupId == null ? null
        : (await readOwnedRows<WorldGroup>(scope, 'worldGroups', { owner: 'world' })).find(row => row.id === targetGroupId)
      if (targetGroupId != null && storedGroup?.id == null) throw new Error('FIXTURE_READINESS: actual subject group missing')
      const subjectGroup = storedGroup?.id != null ? { id: storedGroup.id, name: storedGroup.name } : { id: null, name: '默认世界' }
      const subjects = { worldGroups: [subjectGroup],
        characters: character ? [{ id: character.written[0].id, name: '林舟', worldGroupId: null }] : [] }
      await adoptSettingAssertionCandidatesAtomicV1({ scope, worldGroupId: targetGroupId, sources: [source], subjects,
        candidates: [{ subjectType: family === 'world' ? 'worldGroup' : 'character',
          subjectId: character?.written[0].id ?? targetGroupId, predicate: family === 'world' ? 'creationOrigin' : 'trueIdentity',
          value: '旧来源断言', sourceKey: source.sourceKey, quote: source.text }] })
      const facts = await readOwnedRows<import('../../src/lib/types').TemporalFact>(scope, 'temporalFacts', { owner: 'work' })
      if (facts.length !== 1 || facts[0].status !== 'candidate') throw new Error('FIXTURE_READINESS: real setting candidate missing')
      factId = facts[0].id
    }
    const template = AUTHORING_NODE_BY_ID.get(family === 'world' ? 'world.origin' : withFact ? 'story.logline' : 'story.theme')
    if (!template) throw new Error('FIXTURE_READINESS: registered field template missing')
    const node: AuthoringNodeInstance = { id: 'field', templateId: template.id, templateVersion: 1,
      title: template.label, x: 0, y: 0, config: { ...defaultConfigForTemplate(template), candidateCount: count },
      inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
    const flowId = await useNodeFlowStore.getState().createFlow(scope.projectId, targetGroupId,
      { graph: { ...emptyAuthoringGraph(), nodes: [node] } })
    const flow = await db.nodeFlows.get(flowId)
    if (!flow) throw new Error('FIXTURE_READINESS: public Flow missing')
    const raw = Array.from({ length: count }, (_, index) => '\r\n  ' + JSON.stringify({ field,
      value: `${family} ${index + 1}：e\u0301🌙，作者确认的版本必须逐字保留。` }, null, 3) + '\n\t ')
    const sends: unknown[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, request) => {
      const index = sends.length; sends.push({ url: String(url), method: request?.method, body: String(request?.body) })
      if (String(url) !== 'http://127.0.0.1:9/v1/chat/completions' || request?.method !== 'POST' || index >= count) throw new Error('Unexpected network/send')
      return new Response(JSON.stringify({ choices: [{ message: { content: raw[index] }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 17 + index, completion_tokens: 9 + index, total_tokens: 26 + 2 * index } }), { status: 200 })
    }))
    const generated = await runAuthoringGraph({ flow }); await Promise.allSettled(usage)
    if (!generated.run.id || !generated.candidates.field.signature || generated.run.status !== 'completed') throw new Error('FIXTURE_READINESS: public complete signed field candidate missing')
    const nodeRunId = generated.run.id
    let input = { scope, flow, runId: nodeRunId, nodeId: 'field', selectedVariantIndex: 0, draft: generated.candidates.field.output }
    const choose = async (index: number, edited?: string) => {
      const row = await reviseAuthoringCandidate({ flow, runId: nodeRunId, nodeId: 'field', selectedVariantIndex: index,
        ...(edited == null ? {} : { output: edited }) })
      input = { ...input, selectedVariantIndex: index, draft: JSON.parse(row.nodeResultsJson).field.output }
      return input
    }
    return { family, scope, flow, table, field, factId, nodeRunId, node, groups, targetGroupId, raw, sends, generated, choose, input: () => input }
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>
  async function activeB(f: Fixture, mirror: boolean) {
    const aWorld = (await readOwnedRows<Worldview>(f.scope, 'worldviews', { owner: 'world' }))[0]
    const aStory = (await readOwnedRows<StoryCore>(f.scope, 'storyCores', { owner: 'work' }))[0]
    const aWork = await db.works.get(f.scope.workId)
    if (!aWorld || !aStory || !aWork) throw new Error('FIXTURE_READINESS: original A sources missing')
    const world = await addCurrentWorldFixtureV1({ projectId: f.scope.projectId, name: '独立 World B' })
    if (!world.id) throw new Error('FIXTURE_READINESS: real World B missing')
    const work = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: world.id,
      create: { title: mirror ? aWork.title : '独立 Work B', kind: 'novel', novelProfile: 'long' } })
    if (!work.id) throw new Error('FIXTURE_READINESS: real Work B missing')
    const scope = { projectId: f.scope.projectId, worldId: world.id, workId: work.id }
    await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: null,
      worldOrigin: mirror ? aWorld.worldOrigin : 'B_ONLY_WORLD，不能进入A的资料。' }, scope)
    await useWorldviewStore.getState().saveStoryCore({ projectId: scope.projectId,
      theme: mirror ? aStory.theme : 'B_ONLY_THEME', logline: mirror ? aStory.logline : 'B_ONLY_STORY',
      centralConflict: mirror ? aStory.centralConflict : 'B_ONLY_CONFLICT', plotPattern: mirror ? aStory.plotPattern : 'B_ONLY_PATTERN' }, scope)
    await switchActiveWork(scope.projectId, scope.workId)
    return { scope, work, world }
  }
  function sourceTemplate(): PromptTemplate {
    return { name: '真实双 owner 来源', description: '', scope: 'user', moduleKey: 'worldview.dimension', promptType: 'generate',
      systemPrompt: '只参考{{basis}}', userPromptTemplate: '保持作者来源。', variables: ['basis'],
      variableBindings: [{ variable: 'basis', label: '世界及作品依据', sourceKeys: ['worldview', 'storyCore'], required: true }],
      isActive: false, createdAt: 1, updatedAt: 1 }
  }
  async function promptFlow(f: Fixture) {
    const template = AUTHORING_NODE_BY_ID.get('control.prompt')
    if (!template) throw new Error('FIXTURE_READINESS: prompt control missing')
    const node: AuthoringNodeInstance = { id: 'prompt', templateId: template.id, templateVersion: 1,
      title: template.label, x: 0, y: 0, config: { ...defaultConfigForTemplate(template), promptSnapshot: sourceTemplate() },
      inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
    const id = await useNodeFlowStore.getState().createFlow(f.scope.projectId, null,
      { graph: { ...emptyAuthoringGraph(), nodes: [node] } })
    const flow = await db.nodeFlows.get(id)
    if (!flow) throw new Error('FIXTURE_READINESS: prompt flow missing')
    return { node, flow }
  }
  async function preLockBarrier<T>(f: Fixture, mutationOrdinal: number, invoke: () => Promise<T>) {
    const owner = new AsyncLocalStorage<'first' | 'second'>(), counts = new Map<string, number>()
    const reached: Array<{ actor: string; state: string; sequence: number; nativeTransactionActive: boolean }> = []
    let release!: () => void, bothReady!: () => void, readinessFailed!: (error: unknown) => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const ready = new Promise<void>((resolve, reject) => { bothReady = resolve; readinessFailed = reject })
    const original = runStore.withAgentRunMutationLockV1
    const producer = await selectedRun(f.scope, f.nodeRunId, f.input().selectedVariantIndex)
    const controlled: typeof original = (runId, mutation) => {
      const actor = owner.getStore()
      if (!actor || runId !== producer.run.id) return original(runId, mutation)
      const count = (counts.get(actor) ?? 0) + 1; counts.set(actor, count)
      if (count !== mutationOrdinal) return original(runId, mutation)
      // Gate before calling the real lock. Both source frames and all artifact
      // preparation are already complete here; no holder waits for a loser.
      return (async () => {
        if (Dexie.currentTransaction) throw new Error('FIXTURE_READINESS: pre-lock barrier entered a native transaction')
        const snapshot = await readAgentRunV1(f.scope, runId)
        reached.push({ actor, state: snapshot.projection.state, sequence: snapshot.projection.lastSequence,
          nativeTransactionActive: Boolean(Dexie.currentTransaction) })
        if (reached.length === 2) bothReady()
        await gate
        return original(runId, mutation)
      })()
    }
    const spy = vi.spyOn(runStore, 'withAgentRunMutationLockV1').mockImplementation(controlled)
    const pending = (['first', 'second'] as const).map(actor => owner.run(actor, invoke))
    pending.forEach((call, index) => { void call.then(() => {
      const actor = index === 0 ? 'first' : 'second'
      if (!reached.some(value => value.actor === actor)) readinessFailed(new Error('FIXTURE_READINESS: actor exited before the pre-CAS barrier'))
    }, readinessFailed) })
    try {
      await ready
      expect(reached.map(value => value.actor).sort()).toEqual(['first', 'second'])
      expect(reached.every(value => !value.nativeTransactionActive)).toBe(true)
      expect(reached[0].sequence).toBe(reached[1].sequence)
      release()
      return { results: await Promise.all(pending), reached }
    } finally {
      release(); await Promise.allSettled(pending); spy.mockRestore(); owner.disable()
    }
  }
  async function events(f: Fixture) { return (await selectedRun(f.scope, f.nodeRunId, f.input().selectedVariantIndex)).events }
  function noFalseTerminal(snapshot: Awaited<ReturnType<typeof readAgentRunV1>>) {
    expect(snapshot.projection.state).toBe('running'); expect(snapshot.projection.terminalReceiptHash ?? null).toBeNull()
    expect(snapshot.events.some(event => event.type === 'verification.accepted' || event.type === 'memory.settlement.recorded')).toBe(false)
  }
  function nativeTrace(kind: string) {
    const tx = Dexie.currentTransaction, native = tx?.idbtrans
    if (!native || native.mode !== 'readwrite') throw new Error('FIXTURE_READINESS: actual native RW required')
    return { kind, native, nativeStores: [...native.objectStoreNames].sort(), declaredStores: [...tx.storeNames].sort() }
  }

  it.each([{ family: 'world', count: 1 }, { family: 'world', count: 2 },
    { family: 'story', count: 1 }, { family: 'story', count: 2 }] as const)(
    '$family normal $count preserves real variants and records one attributable write', async sample => {
      const f = await fixture(sample.family, sample.count)
      await f.choose(sample.count - 1)
      const original = await operationalArtifacts(), beforeNode = await db.nodeRuns.get(f.nodeRunId)
      const producerBefore = await selectedRun(f.scope, f.nodeRunId, sample.count - 1)
      const cpBefore = await readLatestVerifiedAgentRunCheckpointV1(f.scope, producerBefore.run.id)
      if (!cpBefore) throw new Error('FIXTURE_READINESS: original generated checkpoint missing')
      const confirmation = await confirmNodeFieldAdoptionIntentV1(f.input())
      expect(confirmation.created).toBe(true)
      const selected = await selectedRun(f.scope, f.nodeRunId, sample.count - 1)
      const cp = await readLatestVerifiedAgentRunCheckpointV1(f.scope, selected.run.id)
      expect(cp?.resumePayload).toEqual(cpBefore.resumePayload)
      expect(cp?.checkpoint.throughSequence).toBeGreaterThan(cpBefore.checkpoint.throughSequence)
      const result = await commitNodeFieldBusinessV1(f.input())
      expect(result.writtenNow).toBe(true); expect(result.result?.written).toHaveLength(1)
      const row = await db.table(f.table).get(result.result!.written[0].id)
      expect(row[f.field]).toBe(JSON.parse(f.input().draft).value)
      noFalseTerminal(result.snapshot)
      expect(await operationalArtifacts()).toEqual(original); expect(await db.nodeRuns.get(f.nodeRunId)).toEqual(beforeNode)
      expect((await events(f)).filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
      expect((await events(f)).filter(event => event.type === 'adoption.committed')).toHaveLength(1)
      expect(f.sends).toHaveLength(sample.count)
    })

  it.each(['world', 'story'] as const)('%s author revision binds the exact final draft without replacing raw/V3', async family => {
    const f = await fixture(family), draft = ' \n' + JSON.stringify({ field: f.field, value: '作者逐字编辑后的 e\u0301🌙 结局，仍有代价。' }, null, 4) + '\n\t'
    await f.choose(1, draft)
    const original = await operationalArtifacts(), producer = await selectedRun(f.scope, f.nodeRunId, 1)
    const cpBefore = await readLatestVerifiedAgentRunCheckpointV1(f.scope, producer.run.id)
    await confirmNodeFieldAdoptionIntentV1(f.input()); const result = await commitNodeFieldBusinessV1(f.input())
    const revised = result.snapshot.events.filter(event => event.type === 'candidate.revised')
    expect(revised).toHaveLength(1); expect(result.writtenNow).toBe(true)
    const effective = result.snapshot.projection.steps[STEP].candidateHash!
    const verified = await verifyContextGatewayCandidateEvidenceV1({ scope: f.scope, runId: producer.run.id,
      stepId: STEP, attempt: 1, candidateHash: effective })
    expect(verified.manifest.candidate.candidateHash).not.toBe(effective)
    expect((await readLatestVerifiedAgentRunCheckpointV1(f.scope, producer.run.id))?.resumePayload).toEqual(cpBefore?.resumePayload)
    expect(await operationalArtifacts()).toEqual(original)
    expect(JSON.parse((await db.nodeRuns.get(f.nodeRunId))!.nodeResultsJson).field.output).toBe(draft)
    noFalseTerminal(result.snapshot); expect(f.sends).toHaveLength(2)
  })

  it.each(['world', 'story'] as const)('%s target, Facts and committed proof share actual11 native stores and rollback', async family => {
    const f = await fixture(family, 1, true)
    await confirmNodeFieldAdoptionIntentV1(f.input())
    const before = await allTables(), trace: ReturnType<typeof nativeTrace>[] = []
    const targetHook = () => { trace.push(nativeTrace('actual-target-update')) }
    const factHook = () => { trace.push(nativeTrace('actual-fact-update')) }
    const fault = (_key: unknown, row: { type: string }) => {
      if (row.type !== 'adoption.committed') return
      trace.push(nativeTrace('actual-parent-proof-create')); throw new Error('D4A_AFTER_BUSINESS_BEFORE_PROOF')
    }
    db.table(f.table).hook('updating', targetHook); db.temporalFacts.hook('updating', factHook); db.agentRunEvents.hook('creating', fault)
    try { await expect(commitNodeFieldBusinessV1(f.input())).rejects.toThrow('D4A_AFTER_BUSINESS_BEFORE_PROOF') }
    finally { db.table(f.table).hook('updating').unsubscribe(targetHook); db.temporalFacts.hook('updating').unsubscribe(factHook); db.agentRunEvents.hook('creating').unsubscribe(fault) }
    expect(trace.map(value => value.kind)).toEqual(['actual-target-update', 'actual-fact-update', 'actual-parent-proof-create'])
    const expected = ['projects', 'worlds', 'works', 'nodeFlows', 'nodeRuns', 'agentRuns', 'agentRunEvents',
      'agentRunArtifacts', 'agentRunCheckpoints', 'temporalFacts', f.table].sort()
    for (const item of trace) { expect(item.native).toBe(trace[0].native); expect(item.nativeStores).toEqual(expected) }
    expect(await allTables()).toEqual(before); expect((await db.temporalFacts.get(f.factId!))?.status).toBe('candidate')
    expect((await readNodeFieldAdoptionProofV1(f.input())).state).toBe('intent-only')
    const success: ReturnType<typeof nativeTrace>[] = []
    let nativeCommitted = false
    const write = () => { success.push(nativeTrace('actual-target-update')) }
    const fact = () => { success.push(nativeTrace('actual-fact-update')) }
    const event = (_key: unknown, row: { type: string }) => {
      if (row.type !== 'adoption.committed') return
      success.push(nativeTrace('actual-parent-proof-create'))
      Dexie.currentTransaction!.on('complete', () => { nativeCommitted = true })
    }
    db.table(f.table).hook('updating', write); db.temporalFacts.hook('updating', fact); db.agentRunEvents.hook('creating', event)
    let result: Awaited<ReturnType<typeof commitNodeFieldBusinessV1>>
    try { result = await commitNodeFieldBusinessV1(f.input()) }
    finally { db.table(f.table).hook('updating').unsubscribe(write); db.temporalFacts.hook('updating').unsubscribe(fact); db.agentRunEvents.hook('creating').unsubscribe(event) }
    expect(result.writtenNow).toBe(true); expect(nativeCommitted).toBe(true)
    expect(success.map(value => value.kind)).toEqual(['actual-target-update', 'actual-fact-update', 'actual-parent-proof-create'])
    for (const item of success) { expect(item.native).toBe(success[0].native); expect(item.nativeStores).toEqual(expected) }
    expect((await db.temporalFacts.get(f.factId!))?.status).toBe('stale')
    noFalseTerminal(result.snapshot)
    expect(f.sends).toHaveLength(1)
  })

  it('checkpoint failure rolls back the whole first decision while retaining preparatory exact artifacts', async () => {
    const f = await fixture('world', 1), before = await allTables()
    const fault = () => { throw new Error('D4A_FIRST_INTENT_CHECKPOINT_FAILED') }
    db.agentRunCheckpoints.hook('creating', fault)
    try { await expect(confirmNodeFieldAdoptionIntentV1(f.input())).rejects.toThrow('D4A_FIRST_INTENT_CHECKPOINT_FAILED') }
    finally { db.agentRunCheckpoints.hook('creating').unsubscribe(fault) }
    const current = await selectedRun(f.scope, f.nodeRunId, 0), after = await allTables()
    expect(current.projection.state).toBe('awaiting_confirmation')
    expect(current.events.some(event => event.type === 'candidate.revised' || event.type === 'confirmation.recorded' || event.type === 'adoption.started')).toBe(false)
    expect(await db.agentRunCheckpoints.where('runId').equals(current.run.id).count()).toBe(1)
    expect(after.agentRunArtifacts.length).toBeGreaterThan(before.agentRunArtifacts.length)
    expect((await readNodeFieldAdoptionProofV1(f.input())).state).toBe('unconfirmed')
    for (const table of Object.keys(before)) if (!['agentRuns', 'agentRunEvents', 'agentRunArtifacts'].includes(table)) expect(after[table], table).toEqual(before[table])
    expect(f.sends).toHaveLength(1)
  })

  it('same intent contenders create one actual decision; a later identical repeat is all-store readonly', async () => {
    const f = await fixture('world', 1)
    const results = await Promise.allSettled([confirmNodeFieldAdoptionIntentV1(f.input()), confirmNodeFieldAdoptionIntentV1(f.input())])
    expect(results.some(value => value.status === 'fulfilled')).toBe(true)
    const ledger = await events(f)
    expect(ledger.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
    expect(ledger.filter(event => event.type === 'adoption.started')).toHaveLength(1)
    const before = await allTables(), repeated = await confirmNodeFieldAdoptionIntentV1(f.input())
    expect(repeated.created).toBe(false); expect(await allTables()).toEqual(before)
    expect((await readNodeFieldAdoptionProofV1(f.input())).state).toBe('intent-only')
  })

  it('forced pre-CAS same-intent confirmation returns two acknowledgements and one actual first decision', async () => {
    const f = await fixture('world', 1)
    // One exact intent artifact writer, then the real first-intent CAS lock.
    const controlled = await preLockBarrier(f, 2, () => confirmNodeFieldAdoptionIntentV1(f.input()))
    expect(controlled.reached.every(value => value.state === 'awaiting_confirmation')).toBe(true)
    expect(controlled.results).toHaveLength(2)
    expect(controlled.results.map(value => value.created).sort()).toEqual([false, true])
    expect(new Set(controlled.results.map(value => value.intentHash)).size).toBe(1)
    const ledger = await events(f)
    expect(ledger.filter(event => event.type === 'confirmation.recorded')).toHaveLength(1)
    expect(ledger.filter(event => event.type === 'adoption.started')).toHaveLength(1)
    expect(ledger.some(event => event.type === 'adoption.committed')).toBe(false)
    expect(f.sends).toHaveLength(1)
  })

  it('forced pre-CAS same-intent business race returns two acknowledgements and one attributable write', async () => {
    const f = await fixture('story', 1)
    await confirmNodeFieldAdoptionIntentV1(f.input())
    const before = await allTables()
    // Business has no preparation writer; its first lock is the native CAS.
    const controlled = await preLockBarrier(f, 1, () => commitNodeFieldBusinessV1(f.input()))
    expect(controlled.reached.every(value => value.state === 'running')).toBe(true)
    expect(controlled.results).toHaveLength(2)
    expect(controlled.results.map(value => value.writtenNow).sort()).toEqual([false, true])
    expect(new Set(controlled.results.map(value => value.adoptionHash)).size).toBe(1)
    expect(controlled.results.find(value => !value.writtenNow)?.result).toBeNull()
    expect(controlled.results.find(value => value.writtenNow)?.result?.written).toHaveLength(1)
    expect((await events(f)).filter(event => event.type === 'adoption.committed')).toHaveLength(1)
    const after = await allTables()
    for (const table of Object.keys(before)) if (!['agentRuns', 'agentRunEvents', 'storyCores'].includes(table)) expect(after[table], table).toEqual(before[table])
    expect(f.sends).toHaveLength(1)
  })

  it('exact body closure accepts only the requested real tuple ledger link, even when another slot body is loaded', async () => {
    const f = await fixture('world', 2), nodeRun = await db.nodeRuns.get(f.nodeRunId)
    if (!nodeRun) throw new Error('FIXTURE_READINESS: original NodeRun missing')
    const node = parseAuthoringGraph(nodeRun.graphSnapshotJson).nodes.find(value => value.id === 'field')
    if (!node) throw new Error('FIXTURE_READINESS: original field node missing')
    const read = await readNodeFieldProducerPrefixV1({ scope: f.scope, nodeRun, node, requestedCount: 2 }, { includeDecided: true })
    const [first, second] = read.sealedSlots
    const ref = { artifactKind: 'tool-result' as const, contentHash: second.checkpoint.candidateHash, stepId: STEP, attempt: 1 }
    expect(JSON.parse(read.readExactBodyForRun(second.snapshot.run.id, ref)).kind).toBe('node-field-candidate')
    expect(() => read.readExactBodyForRun(first.snapshot.run.id, ref)).toThrow()
    expect(() => read.readExactBodyForRun(second.snapshot.run.id, { ...ref, attempt: 2 })).toThrow()
    expect(() => read.readExactBodyForRun(second.snapshot.run.id + 10_000, ref)).toThrow()
    expect(f.sends).toHaveLength(2)
  })

  it('entry under an existing transaction refuses before artifact preparation or first confirmation', async () => {
    const f = await fixture('world', 1), before = await allTables()
    await expect(db.transaction('rw', db.nodeRuns, () => confirmNodeFieldAdoptionIntentV1(f.input())))
      .rejects.toThrow('正式入口不能包在另一个数据库事务中')
    expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(1)
  })

  it('cold after intent and after atomic proof never resends or fabricates the original AdoptResult', async () => {
    const f = await fixture('story', 2); await f.choose(1)
    await confirmNodeFieldAdoptionIntentV1(f.input()); db.close(); await db.open()
    expect((await readNodeFieldAdoptionProofV1(f.input())).state).toBe('intent-only')
    const result = await commitNodeFieldBusinessV1(f.input()); expect(result.writtenNow).toBe(true)
    db.close(); await db.open(); const before = await allTables()
    const recovered = await readNodeFieldAdoptionProofV1(f.input()); expect(recovered.state).toBe('committed')
    const repeated = await commitNodeFieldBusinessV1(f.input())
    expect(repeated.writtenNow).toBe(false); expect(repeated.result).toBeNull()
    expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(2)
    noFalseTerminal(repeated.snapshot)
  })

  it('first intent freezes the selected slot and exact draft; another choice remains unconfirmed', async () => {
    const f = await fixture('world', 2)
    const saved = await confirmNodeFieldAdoptionIntentV1(f.input())
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([f.scope.projectId, 'tool-result', saved.intentHash]).first()
    if (!row?.content) throw new Error('FIXTURE_READINESS: exact intent body missing')
    const frozen = JSON.parse(row.content)
    expect(frozen.selectedVariantIndex).toBe(0); expect(frozen.draft).toBe(f.input().draft)
    expect(frozen.excludedSealedCandidates).toHaveLength(1)
    expect(frozen.excludedSealedCandidates[0].variantIndex).toBe(1)
    const secondBefore = await selectedRun(f.scope, f.nodeRunId, 1)
    expect(frozen.excludedSealedCandidates[0].generatedCoreHash).toBe(secondBefore.projection.steps[STEP].candidateHash)
    expect(frozen.excludedSealedCandidates[0].effectiveCandidateHash).toBe(secondBefore.projection.steps[STEP].candidateHash)
    expect(frozen.excludedSetHash).toBe(await hashCanonicalValue(frozen.excludedSealedCandidates))
    expect(saved.intentHash).toBe(await hashCanonicalValue(frozen))
    expect(secondBefore.projection.state).toBe('awaiting_confirmation')
    const before = await allTables()
    await expect(f.choose(1)).rejects.toThrow('首次确认')
    const competing = { ...f.input(), selectedVariantIndex: 1, draft: f.generated.candidates.field.variants![1] }
    await expect(confirmNodeFieldAdoptionIntentV1(competing)).rejects.toBeInstanceOf(Error)
    await expect(commitNodeFieldBusinessV1(competing)).rejects.toBeInstanceOf(Error)
    expect(await allTables()).toEqual(before)
    expect(await selectedRun(f.scope, f.nodeRunId, 1)).toEqual(secondBefore)
    expect(f.sends).toHaveLength(2)
  })

  it('equal current text without this Run proof remains intent-only and cannot be claimed as success', async () => {
    const f = await fixture('world', 1)
    await confirmNodeFieldAdoptionIntentV1(f.input())
    const rows = await readOwnedRows<Record<string, unknown>>(f.scope, 'worldviews', { owner: 'world' })
    const row = rows[0], parsed = JSON.parse(f.input().draft)
    await db.transaction('rw', db.worldviews, async () => { await db.worldviews.update(row.id as number,
      { worldOrigin: parsed.value, updatedAt: Number(row.updatedAt) + 1 }) })
    const before = await allTables()
    expect((await readNodeFieldAdoptionProofV1(f.input())).state).toBe('intent-only')
    await expect(commitNodeFieldBusinessV1(f.input())).rejects.toBeInstanceOf(Error)
    expect(await allTables()).toEqual(before)
    expect((await events(f)).some(event => event.type === 'adoption.committed')).toBe(false)
    expect(f.sends).toHaveLength(1)
  })

  it.each(['intent', 'revision'] as const)('corrupt %s body blocks without repairing or sending', async kind => {
    const f = await fixture('world', 1)
    if (kind === 'revision') await f.choose(0, JSON.stringify({ field: f.field, value: '作者已经明确编辑的全新终稿。' }))
    const selected = await confirmNodeFieldAdoptionIntentV1(f.input())
    const hash = kind === 'intent' ? selected.intentHash : selected.snapshot.projection.steps[STEP].candidateHash!
    const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]')
      .equals([f.scope.projectId, 'tool-result', hash]).first()
    if (!row?.id) throw new Error('FIXTURE_READINESS: original exact artifact missing')
    // Deliberate isolated native corruption retains the old immutable hash.
    await db.agentRunArtifacts.update(row.id, { content: '{"damaged":"do not repair or replace original basis"}' })
    const before = await allTables()
    await expect(commitNodeFieldBusinessV1(f.input())).rejects.toBeInstanceOf(Error)
    expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(1)
  })

  it.each(['missing-signature', 'broken-checkpoint', 'wrong-tuple', 'null-group-target'] as const)(
    '%s cannot obtain an intent or overwrite the original evidence', async mode => {
      const f = await fixture('world', 1), run = await db.nodeRuns.get(f.nodeRunId)
      if (!run) throw new Error('FIXTURE_READINESS: NodeRun missing')
      if (mode === 'missing-signature') {
        const values = JSON.parse(run.nodeResultsJson); delete values.field.signature
        await db.nodeRuns.update(f.nodeRunId, { nodeResultsJson: JSON.stringify(values) })
      } else if (mode === 'broken-checkpoint') {
        const producer = await selectedRun(f.scope, f.nodeRunId, 0), cp = await readLatestVerifiedAgentRunCheckpointV1(f.scope, producer.run.id)
        if (!cp) throw new Error('FIXTURE_READINESS: checkpoint missing')
        await db.agentRunCheckpoints.update(cp.checkpoint.id, { resumePayloadHash: '0'.repeat(64) })
      } else if (mode === 'wrong-tuple') {
        const producer = await selectedRun(f.scope, f.nodeRunId, 0)
        await db.agentRuns.update(producer.run.id, { nodeProducerNodeId: 'not-in-original-graph' })
      } else {
        // Isolated native negative fixture: make the old target no longer the
        // registered null-group singleton. It is not a real UI mutation path.
        const rows = await readOwnedRows<Record<string, unknown>>(f.scope, 'worldviews', { owner: 'world' })
        await db.worldviews.update(rows[0].id as number, { worldGroupId: 91_001 })
      }
      const before = await allTables()
      await expect(confirmNodeFieldAdoptionIntentV1(f.input())).rejects.toBeInstanceOf(Error)
      expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(1)
    })

  it('foreign Work and Flow cannot confirm another actual tuple', async () => {
    const f = await fixture('world', 1), foreign = await seedCurrentWorkspace('D4a foreign')
    const before = await allTables()
    await expect(confirmNodeFieldAdoptionIntentV1({ ...f.input(), scope: foreign.scope })).rejects.toBeInstanceOf(Error)
    expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(1)
  })

  it.each(['world', 'story'] as const)('%s explicit A scope remains usable while another World/Work B is active', async family => {
    const f = await fixture(family, 1), b = await activeB(f, false)
    const bBefore = await readOwnedRows(b.scope, f.table, { owner: family === 'world' ? 'world' : 'work' })
    const originalNode = await db.nodeRuns.get(f.nodeRunId)
    await confirmNodeFieldAdoptionIntentV1(f.input())
    const result = await commitNodeFieldBusinessV1(f.input())
    expect(result.writtenNow).toBe(true)
    expect(await readOwnedRows(b.scope, f.table, { owner: family === 'world' ? 'world' : 'work' })).toEqual(bBefore)
    expect(await db.nodeRuns.get(f.nodeRunId)).toEqual(originalNode)
    expect((await db.projects.get(f.scope.projectId))?.activeWorkId).toBe(b.scope.workId)
    expect(f.sends).toHaveLength(1)
  })

  it.each(['world', 'story'] as const)('%s changed A source cannot be masked by active B retaining A original text', async family => {
    const f = await fixture(family, 1), b = await activeB(f, true)
    const originalNode = await db.nodeRuns.get(f.nodeRunId)
    const savedHash = f.generated.snapshots.field.sourceHash
    const mirrored = await readAuthoringCanonBinding({ node: f.node, projectId: f.scope.projectId, scope: b.scope, worldGroupId: null })
    expect(mirrored.sourceHash).toBe(savedHash)
    const changed = await adopt({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null,
      target: f.table, mode: 'replace', data: family === 'world' ? { worldStructure: 'A_CHANGED_NON_TARGET_WORLD' } : { centralConflict: 'A_CHANGED_NON_TARGET_STORY' } })
    expect(changed.written).toHaveLength(1)
    const before = await allTables()
    await expect(confirmNodeFieldAdoptionIntentV1(f.input())).rejects.toBeInstanceOf(Error)
    expect(await allTables()).toEqual(before); expect(await db.nodeRuns.get(f.nodeRunId)).toEqual(originalNode)
    expect((await events(f)).some(event => event.type === 'confirmation.recorded')).toBe(false)
    expect(f.sends).toHaveLength(1)
  })

  it('actual prompt generation keeps captured A sourceKeys after B becomes active before bound assembly', async () => {
    const f = await fixture('world', 1), p = await promptFlow(f), b = await activeB(f, false)
    await switchActiveWork(f.scope.projectId, f.scope.workId)
    const original = promptBindings.assembleBoundPrompt, captured: Array<WorkspaceScope | undefined> = []
    const spy = vi.spyOn(promptBindings, 'assembleBoundPrompt').mockImplementation(async input => {
      captured.push(input.scope); await switchActiveWork(f.scope.projectId, b.scope.workId)
      return original(input)
    })
    let result: Awaited<ReturnType<typeof runAuthoringGraph>>
    try { result = await runAuthoringGraph({ flow: p.flow }) } finally { spy.mockRestore() }
    expect(result.run.status).toBe('completed'); expect(captured).toEqual([f.scope])
    expect(result.candidates.prompt.output).toContain('原世界起源于潮汐')
    expect(result.candidates.prompt.output).toContain('原主题')
    expect(result.candidates.prompt.output).not.toContain('B_ONLY_')
    expect(result.snapshots.prompt.sourceEvidence?.included).toEqual(expect.arrayContaining(['worldview', 'storyCore']))
    const freshness = await inspectAuthoringGraphFreshness({ flow: p.flow, scope: f.scope,
      snapshots: result.snapshots, candidates: result.candidates })
    expect(freshness.prompt.status).toBe('fresh')
    const project = await db.projects.get(f.scope.projectId), work = await db.works.get(f.scope.workId)
    const bound = await original({ template: sourceTemplate(), project, work, scope: f.scope, worldGroupId: null })
    expect(bound.messages.map(value => value.content).join('\n')).not.toContain('B_ONLY_')
    expect(bound.contextEvidence?.included).toEqual(expect.arrayContaining(['worldview', 'storyCore']))
    expect(f.sends).toHaveLength(1)
  })

  it.each(['worldviews', 'storyCores'] as const)('prompt freshness reads changed A %s instead of matching active B old source text', async table => {
    const f = await fixture('world', 1), p = await promptFlow(f)
    const result = await runAuthoringGraph({ flow: p.flow }), b = await activeB(f, true)
    const mirrored = await renderAuthoringPromptControl({ node: p.node, projectId: f.scope.projectId, scope: b.scope, worldGroupId: null })
    expect(mirrored.sourceHash).toBe(result.snapshots.prompt.sourceHash)
    const savedRun = await db.nodeRuns.get(result.run.id!)
    await adopt({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, target: table, mode: 'replace',
      data: table === 'worldviews' ? { worldOrigin: 'A_WORLD_CHANGED_AFTER_GENERATION' } : { centralConflict: 'A_STORY_CHANGED_AFTER_GENERATION' } })
    const before = await allTables()
    const freshness = await inspectAuthoringGraphFreshness({ flow: p.flow, scope: f.scope,
      snapshots: result.snapshots, candidates: result.candidates })
    expect(freshness.prompt.status).toBe('stale'); expect(freshness.prompt.reasons).toContain('source-updated')
    expect(await allTables()).toEqual(before); expect(await db.nodeRuns.get(result.run.id!)).toEqual(savedRun)
    expect(f.sends).toHaveLength(1)
  })

  it.each(['project-mismatch', 'work-mismatch', 'malformed-tuple'] as const)('%s rejects explicit scope even with empty sourceKeys', async kind => {
    const f = await fixture('world', 1), b = await activeB(f, false), p = await promptFlow(f)
    const project = await db.projects.get(f.scope.projectId), aWork = await db.works.get(f.scope.workId)
    if (!project || !aWork) throw new Error('FIXTURE_READINESS: real A roots missing')
    const foreign = kind === 'project-mismatch' ? await seedCurrentWorkspace('scope foreign project') : null
    const inputScope = kind === 'project-mismatch' ? foreign!.scope : kind === 'malformed-tuple' ? { ...f.scope, worldId: 900_001 } : f.scope
    const renderScope = kind === 'work-mismatch' ? { ...f.scope, workId: b.scope.workId } : inputScope
    const template = { ...sourceTemplate(), variableBindings: [{ variable: 'basis', label: '作者标题', workField: 'title' as const, required: true }] }
    const before = await allTables()
    await expect(promptBindings.assembleBoundPrompt({ template, project, scope: inputScope,
      work: kind === 'work-mismatch' ? b.work : aWork, worldGroupId: null })).rejects.toBeInstanceOf(Error)
    await expect(renderAuthoringPromptControl({ node: p.node, projectId: f.scope.projectId, scope: renderScope, worldGroupId: null })).rejects.toBeInstanceOf(Error)
    await expect(inspectAuthoringGraphFreshness({ flow: f.flow, scope: renderScope, snapshots: {}, candidates: {} })).rejects.toBeInstanceOf(Error)
    expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(1)
  })

  it('explicit valid Work preview text and legacy unscoped manual-only callers retain their semantics', async () => {
    const f = await fixture('world', 1); await activeB(f, false)
    const project = await db.projects.get(f.scope.projectId), work = await db.works.get(f.scope.workId)
    if (!work) throw new Error('FIXTURE_READINESS: actual A Work missing')
    const template = { ...sourceTemplate(), variableBindings: [{ variable: 'basis', label: '作者标题', workField: 'title' as const, required: true }] }
    const before = await allTables()
    const preview = await promptBindings.assembleBoundPrompt({ template, project, scope: f.scope,
      work: { ...work, title: '作者尚未保存的预览标题' } })
    expect(preview.variables.basis).toBe('作者尚未保存的预览标题')
    const legacy = await promptBindings.assembleBoundPrompt({ template: { ...template,
      variableBindings: [{ variable: 'basis', label: '原手动输入', manual: true, required: true }] }, manualValues: { basis: '原来的纯手动调用' } })
    expect(legacy.variables.basis).toContain('原来的纯手动调用'); expect(legacy.missingScopes).toEqual([])
    expect(await allTables()).toEqual(before); expect(f.sends).toHaveLength(1)
  })

  it.each(['world', 'story'] as const)('%s first target creation retains actual hot AdoptResult and a readonly identical repeat', async family => {
    const f = await fixture(family, 1, false, { missingTarget: true })
    expect(await readOwnedRows(f.scope, f.table, { owner: family === 'world' ? 'world' : 'work' })).toEqual([])
    await confirmNodeFieldAdoptionIntentV1(f.input())
    const first = await commitNodeFieldBusinessV1(f.input())
    expect(first.writtenNow).toBe(true); expect(first.result?.written).toHaveLength(1)
    const row = await db.table(f.table).get(first.result!.written[0].id)
    expect(row[f.field]).toBe(JSON.parse(f.input().draft).value); expect(typeof row.ragDocumentId).toBe('string')
    expect(row[family === 'world' ? 'worldId' : 'workId']).toBe(family === 'world' ? f.scope.worldId : f.scope.workId)
    const before = await allTables(), repeated = await commitNodeFieldBusinessV1(f.input())
    expect(repeated.writtenNow).toBe(false); expect(repeated.result).toBeNull()
    expect(repeated.adoptionHash).toBe(first.adoptionHash); expect(await allTables()).toEqual(before)
    expect(f.sends).toHaveLength(1)
  })

  it.each(['null-target', 'group-target'] as const)('%s uses actual complete receipt beforeIds and preserves other legal groups', async mode => {
    const f = await fixture('world', 1, true, { groups: mode })
    const domain = f.generated.candidates.field.domain
    if (domain?.kind !== 'worldview-field' || domain.snapshot.id == null) throw new Error('FIXTURE_READINESS: target worldview snapshot missing')
    const all = await readOwnedRows<Worldview>(f.scope, 'worldviews', { owner: 'world' })
    const others = all.filter(row => row.id !== domain.snapshot.id)
    expect(f.groups).toHaveLength(2); expect(others.length).toBeGreaterThanOrEqual(2)
    await confirmNodeFieldAdoptionIntentV1(f.input())
    const before = await allTables(), traces: ReturnType<typeof nativeTrace>[] = []
    const write = () => { traces.push(nativeTrace('actual-group-target-update')) }
    const fact = () => { traces.push(nativeTrace('actual-group-fact-update')) }
    const fault = (_key: unknown, row: { type: string }) => {
      if (row.type === 'adoption.committed') { traces.push(nativeTrace('actual-group-proof-create')); throw new Error('GROUP_PROOF_EXPECTED_ROLLBACK') }
    }
    db.worldviews.hook('updating', write); db.temporalFacts.hook('updating', fact); db.agentRunEvents.hook('creating', fault)
    try { await expect(commitNodeFieldBusinessV1(f.input())).rejects.toThrow('GROUP_PROOF_EXPECTED_ROLLBACK') }
    finally { db.worldviews.hook('updating').unsubscribe(write); db.temporalFacts.hook('updating').unsubscribe(fact); db.agentRunEvents.hook('creating').unsubscribe(fault) }
    expect(await allTables()).toEqual(before)
    expect(traces.map(value => value.kind)).toEqual(['actual-group-target-update', 'actual-group-fact-update', 'actual-group-proof-create'])
    // Assert real shared native identity, not a numeric target of 11 stores.
    // Non-null formal Run creation retains its own registered group checks.
    for (const observed of traces) {
      expect(observed.native).toBe(traces[0].native)
      expect(observed.nativeStores).toEqual(traces[0].nativeStores)
      expect(observed.nativeStores).toEqual(expect.arrayContaining(['projects', 'worlds', 'works', 'worldviews', 'temporalFacts', 'agentRunEvents']))
    }
    const actual = await commitNodeFieldBusinessV1(f.input())
    expect(actual.writtenNow).toBe(true); expect(actual.result?.written).toHaveLength(1)
    expect(actual.canonReceipt.records).toHaveLength(1)
    expect(actual.canonReceipt.records[0].documentId).toBe((await db.worldviews.get(domain.snapshot.id))?.ragDocumentId)
    expect((await readOwnedRows<Worldview>(f.scope, 'worldviews', { owner: 'world' })).filter(row => row.id !== domain.snapshot.id)).toEqual(others)
    expect((await db.worldviews.get(domain.snapshot.id))?.worldGroupId ?? null).toBe(f.targetGroupId)
    expect(f.sends).toHaveLength(1)
  })

  it.each(['world', 'story'] as const)('%s real empty-patch noop and unchanged author draft cannot become a fake field write', async family => {
    const f = await fixture(family, 1), before = await allTables()
    const actualNoop = await adopt({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null,
      target: f.table, mode: 'replace', data: {} })
    expect(actualNoop).toEqual({ written: [], unknown: [], typeErrors: [], fkErrors: [], skipped: [] })
    expect(await allTables()).toEqual(before); expect((await readNodeFieldAdoptionProofV1(f.input())).state).toBe('unconfirmed')
    const row = (await readOwnedRows<Record<string, unknown>>(f.scope, f.table, { owner: family === 'world' ? 'world' : 'work' }))[0]
    await f.choose(0, JSON.stringify({ field: f.field, value: row[f.field] }))
    const unchanged = await allTables()
    await expect(confirmNodeFieldAdoptionIntentV1(f.input())).rejects.toBeInstanceOf(Error)
    expect(await allTables()).toEqual(unchanged); expect((await events(f)).some(event => event.type === 'adoption.committed')).toBe(false)
    expect(f.sends).toHaveLength(1)
  })

  it('readonly proof never combines an old committed ledger with a postimage restored only after that proof was removed', async () => {
    const f = await fixture('world', 1)
    await confirmNodeFieldAdoptionIntentV1(f.input()); const committed = await commitNodeFieldBusinessV1(f.input())
    const producerId = committed.snapshot.run.id, postimage = await db.worldviews.get(committed.result!.written[0].id)
    if (!postimage) throw new Error('FIXTURE_READINESS: actual native postimage missing')
    await adopt({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null, target: 'worldviews',
      recordId: postimage.id, mode: 'replace', data: { worldOrigin: 'Q_DIVERGED_DURING_READ_INTERVAL' } })
    const before = await allTables(), artifactsBefore = await db.agentRunArtifacts.toArray()
    const context = new AsyncLocalStorage<boolean>(), original = scopeStore.readOwnedRows
    let actor: Promise<void> | null = null, targetReadReached = false, actorCommitted = false
    let readonlyStores: string[] | null = null
    const controlled: typeof original = async <T>(scope: WorkspaceScope, table: string, options: scopeStore.ScopeReadOptions = {}) => {
      if (!context.getStore() || table !== 'worldviews' || targetReadReached) return original<T>(scope, table, options)
      targetReadReached = true
      const tx = Dexie.currentTransaction
      const readonlyFence = Boolean(tx?.active && tx.idbtrans?.mode === 'readonly')
      readonlyStores = readonlyFence ? [...tx!.idbtrans.objectStoreNames].sort() : null
      actor = Dexie.ignoreTransaction(() => db.transaction('rw', scopeStore.scopeTransactionTables(
        db.agentRuns, db.agentRunEvents, db.agentRunCheckpoints, db.worldviews), async () => {
        // Explicit isolated native negative actor, not a product/UI delete path:
        // remove the real Run proof and restore the exact observed P atomically.
        await db.agentRunEvents.where('runId').equals(producerId).delete()
        await db.agentRunCheckpoints.where('runId').equals(producerId).delete()
        await db.agentRuns.delete(producerId); await db.worldviews.put(postimage)
      })).then(() => { actorCommitted = true })
      // With no common native fence the actor can commit before the target
      // read. Under a real readonly fence it must queue; never await that
      // conflicting writer inside the read transaction.
      if (!readonlyFence) await actor
      return original<T>(scope, table, options)
    }
    const spy = vi.spyOn(scopeStore, 'readOwnedRows').mockImplementation(controlled)
    let result: Awaited<ReturnType<typeof readNodeFieldAdoptionProofV1>> | null = null, error: unknown = null
    try { result = await context.run(true, () => readNodeFieldAdoptionProofV1(f.input())) } catch (cause) { error = cause }
    finally { spy.mockRestore(); if (actor) await actor; context.disable() }
    expect(targetReadReached).toBe(true); expect(actorCommitted).toBe(true)
    expect(before.agentRunEvents.some(row => (row as { type: string }).type === 'adoption.committed')).toBe(true)
    expect((before.worldviews[0] as Worldview).worldOrigin).toBe('Q_DIVERGED_DURING_READ_INTERVAL')
    expect(await db.agentRuns.get(producerId)).toBeUndefined(); expect(await db.worldviews.get(postimage.id!)).toEqual(postimage)
    expect(await db.agentRunArtifacts.toArray()).toEqual(artifactsBefore)
    expect(result?.state).not.toBe('committed'); expect(error).toBeInstanceOf(Error)
    expect(readonlyStores).toEqual(['projects', 'worlds', 'works', 'nodeFlows', 'nodeRuns', 'agentRuns', 'agentRunEvents',
      'agentRunArtifacts', 'agentRunCheckpoints', 'temporalFacts', 'worldviews'].sort())
    expect(f.sends).toHaveLength(1)
  })
})
