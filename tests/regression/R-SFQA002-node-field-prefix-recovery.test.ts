// Public Graph/Recovery controls, without replacing a model runner or creating
// fake AgentRun events. Native Node fallback ownership is exercised explicitly;
// real browser LockManager/UI acceptance remains a separate required gate.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import type { Worldview } from '../../src/lib/types'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { useWorldviewStore } from '../../src/stores/worldview'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { runAuthoringGraph, recoverInterruptedAuthoringRun } from '../../src/lib/node-authoring/executor'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import * as usageLog from '../../src/lib/ai/usage-log'

type Family = 'world' | 'story'
type Mode = 'protocol' | 'unknown' | 'gap' | 'abort'
async function snapshot() {
  const value: Record<string, unknown[]> = {}
  for (const table of db.tables) value[table.name] = await table.toArray()
  return value
}
function errorValue(value: unknown) {
  return value instanceof Error ? { name: value.name, message: value.message, stack: value.stack,
    causeMessage: Object.getOwnPropertyDescriptor(value, 'cause')?.value instanceof Error
      ? (Object.getOwnPropertyDescriptor(value, 'cause')!.value as Error).message : null } : { value: String(value) }
}
async function fixture(family: Family, count: number, label: string) {
  const { scope } = await seedCurrentWorkspace(`C2b ${label}`)
  await useWorldviewStore.getState().loadAll(scope, null)
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldGroupId: null,
    worldOrigin: '作者原来确认的世界起源；只读恢复不能刷新这份旧依据。' }, scope)
  await useWorldviewStore.getState().saveStoryCore({ projectId: scope.projectId,
    theme: '作者原主题', centralConflict: '作者原冲突', plotPattern: '线性' }, scope)
  const template = AUTHORING_NODE_BY_ID.get(family === 'world' ? 'world.origin' : 'story.theme')
  if (!template) throw new Error('FIXTURE_READINESS: registered field template missing')
  const node: AuthoringNodeInstance = { id: 'field', templateId: template.id, templateVersion: 1,
    title: template.label, x: 0, y: 0, config: { ...defaultConfigForTemplate(template), candidateCount: count },
    inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
  const flowId = await useNodeFlowStore.getState().createFlow(scope.projectId, null,
    { graph: { ...emptyAuthoringGraph(), nodes: [node] } })
  const flow = await db.nodeFlows.get(flowId)
  if (!flow) throw new Error('FIXTURE_READINESS: public Flow missing')
  const field = family === 'world' ? 'worldOrigin' : 'theme'
  const returns = Array.from({ length: count }, (_, index) => '\r\n  ' + JSON.stringify({ field,
    value: `${label}：第 ${index + 1} 个完整候选 e\u0301🌙；人物必须为自己的选择承担具体代价。` }, null, 3) + '\n\t ')
  return { family, count, scope, node, flow, returns }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function inspect(f: Fixture) {
  const runs = await db.nodeRuns.where('flowId').equals(f.flow.id!).toArray()
  const row = runs.length === 1 ? runs[0] : null
  const producers = row ? await db.agentRuns.where('workId').equals(f.scope.workId)
    .filter(value => value.nodeRunId === row.id).sortBy('nodeProducerVariantIndex') : []
  const readers = []
  for (const producer of producers) {
    try {
      const view = await readAgentRunV1(f.scope, producer.id!)
      let checkpoint = null, checkpointError: unknown = null
      try { checkpoint = await readLatestVerifiedAgentRunCheckpointV1(f.scope, producer.id!) }
      catch (error) { checkpointError = errorValue(error) }
      const exact = []
      for (const event of view.events) {
        if (event.type !== 'evidence.artifact.recorded') continue
        try {
          exact.push({ ref: event.payload, content: await readAgentRunArtifactExactV1({ projectId: f.scope.projectId,
            artifactKind: event.payload.artifactKind, contentHash: event.payload.contentHash }) })
        } catch (error) { exact.push({ ref: event.payload, error: errorValue(error) }) }
      }
      readers.push({ producer, view, checkpoint, checkpointError, exact })
    } catch (error) { readers.push({ producer, error: errorValue(error) }) }
  }
  return { row, producers, readers }
}
function transactionTrace(kind: string) {
  const tx = Dexie.currentTransaction
  if (!tx?.idbtrans || tx.idbtrans.mode !== 'readwrite') throw new Error('FIXTURE_READINESS: actual native RW transaction missing')
  return { kind, at: performance.now(), declaredStores: [...tx.storeNames], nativeStores: [...tx.idbtrans.objectStoreNames], mode: tx.idbtrans.mode }
}

describe.sequential('C2b original paid prefixes and no-resend recovery', () => {
  let usagePromises: Promise<unknown>[]
  beforeEach(async () => {
    await db.delete(); await db.open(); usagePromises = []
    useAIConfigStore.getState().setConfig({ provider: 'custom', apiKey: '', model: 'isolated-node-model',
      baseUrl: 'http://127.0.0.1:9/v1', temperature: .5, maxTokens: 8_000, contextWindow: 128_000 })
    // Keep the actual process-local owner guard. The browser fallback correctly
    // refuses recovery without Web Locks; this native-only control is explicit.
    vi.stubGlobal('window', undefined)
    const originalUsage = usageLog.recordUsage
    vi.spyOn(usageLog, 'recordUsage').mockImplementation(function (this: unknown, input) {
      const pending = originalUsage.call(this, input); usagePromises.push(pending); return pending
    })
  })
  afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await db.delete() })

  async function paid(f: Fixture, mode: Mode, id: string) {
    const before = await snapshot();
    const requests: unknown[] = [], trace: unknown[] = []
    const controller = new AbortController()
    let faultArmed = false, abortArmed = false, abortCommitted = false
    const fault = (mods: object) => {
      const value = (mods as { nodeResultsJson?: string }).nodeResultsJson
      if (typeof value === 'string' && value.includes('"variants"')) faultArmed = true
      if (mode === 'gap' && faultArmed) {
        trace.push(transactionTrace('actual-node-projection-write-rejected'))
        throw new Error('PROJECTION_WRITE_FAILED_NATIVE_C2B')
      }
    }
    const abort = (_key: unknown, row: { type: string; runId: number }) => {
      if (mode !== 'abort' || abortArmed || row.type !== 'candidate.persisted') return
      abortArmed = true
      const tx = Dexie.currentTransaction!
      trace.push({ ...transactionTrace('first-candidate-native-creating'), runId: row.runId })
      tx.on('complete', () => {
        abortCommitted = true; controller.abort('paused')
        trace.push({ kind: 'first-candidate-native-committed-then-real-abort', at: performance.now(), aborted: controller.signal.aborted })
      })
    }
    db.nodeRuns.hook('updating', fault)
    db.agentRunEvents.hook('creating', abort)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, request) => {
      const index = requests.length
      const raw = mode === 'protocol' && index === 1 ? ' \r\n BROKEN_COMPLETE_C2B_e\u0301🌙\n\t ' : f.returns[index]
      requests.push({ index, url: String(url), method: request?.method, body: JSON.parse(String(request?.body)), raw,
        signalAborted: request?.signal?.aborted, at: performance.now() })
      if (String(url) !== 'http://127.0.0.1:9/v1/chat/completions' || request?.method !== 'POST') throw new Error('Unexpected real network target prohibited')
      if (index >= f.count) throw new Error('Unexpected extra model send')
      if (mode === 'unknown' && index === 1) throw new Error('ACTUAL_TRANSPORT_OUTCOME_UNAVAILABLE_NATIVE_C2B')
      return new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 } }), { status: 200 })
    }))
    let result: Awaited<ReturnType<typeof runAuthoringGraph>> | null = null, error: unknown = null
    try { result = await runAuthoringGraph({ flow: f.flow, ...(mode === 'abort' ? { signal: controller.signal } : {}) }) }
    catch (cause) { error = cause;  }
    finally {
      db.nodeRuns.hook('updating').unsubscribe(fault)
      db.agentRunEvents.hook('creating').unsubscribe(abort)
    }
    await Promise.allSettled(usagePromises)
    const original = await inspect(f), afterGraph = await snapshot()

    const ready = original.row != null && (mode !== 'gap' || (faultArmed && error != null
      && original.row.status === 'running' && original.producers.length === f.count
      && original.readers.every(value => 'view' in value && value.view!.projection.state === 'awaiting_confirmation')))
      && (mode !== 'abort' || (abortCommitted && controller.signal.aborted))

    if (!ready || !original.row) throw new Error(`FIXTURE_READINESS ${id}: native paid/fault boundary not reached`)
    return { f, mode, before, result, original, afterGraph, requests, trace }
  }
  type Paid = Awaited<ReturnType<typeof paid>>
  async function action(p: Paid, invoke: () => Promise<unknown>) {
    const before = await snapshot();
    let result: unknown = null, error: unknown = null
    try { result = await invoke() } catch (cause) { error = cause;  }
    await Promise.allSettled(usagePromises)
    const after = await snapshot(), current = await inspect(p.f)

    return { before, after, current, result, error }
  }
  function prefix(p: Paid, row: NonNullable<Paid['original']['row']>, count: number) {
    const candidate = JSON.parse(row.nodeResultsJson).field
    expect(candidate.variants).toEqual(p.f.returns.slice(0, count).map(raw => JSON.stringify(JSON.parse(raw), null, 2)))
    expect(candidate.creativeArtifacts.map((value: { originalText: string }) => value.originalText)).toEqual(p.f.returns.slice(0, count))
    expect(candidate.status).toBe('blocked'); expect(candidate.signature).toBeUndefined()
    return candidate
  }
  function canonEqual(before: Record<string, unknown[]>, after: Record<string, unknown[]>) {
    const operational = new Set(['nodeRuns', 'agentRuns', 'agentRunEvents', 'agentRunArtifacts', 'agentRunCheckpoints', 'aiUsageLog'])
    for (const table of Object.keys(before)) if (!operational.has(table)) expect(after[table], table).toEqual(before[table])
  }
  function onlyProjection(before: Record<string, unknown[]>, after: Record<string, unknown[]>) {
    for (const table of Object.keys(before)) if (table !== 'nodeRuns') expect(after[table], table).toEqual(before[table])
  }

  it.each([{ family: 'world', mode: 'protocol' }, { family: 'story', mode: 'protocol' },
    { family: 'world', mode: 'unknown' }, { family: 'story', mode: 'unknown' }] as const)(
    '$family-later-$mode keeps the true prefix and original later outcome', async sample => {
      const p = await paid(await fixture(sample.family, 3, `${sample.family}-later-${sample.mode}`), sample.mode, `${sample.family}-later-${sample.mode}`)
      const recovered = await action(p, () => recoverInterruptedAuthoringRun({ flow: p.f.flow, runId: p.original.row!.id! }))
      expect(p.requests).toHaveLength(2)
      expect(recovered.error).toBeNull(); prefix(p, p.original.row!, 1); prefix(p, recovered.current.row!, 1)
      expect(p.original.producers).toHaveLength(2)
      expect(recovered.current.producers).toEqual(p.original.producers)
      const first = p.original.readers[0]
      expect('view' in first && first.view!.projection.state).toBe('awaiting_confirmation')
      expect(p.original.readers[1]).toEqual(recovered.current.readers[1])
      // No expected paused/failed/usage is invented for the unknown outcome.
      canonEqual(p.before, p.afterGraph); onlyProjection(recovered.before, recovered.after)
    })

  it.each([{ family: 'world', count: 1 }, { family: 'story', count: 2 }] as const)(
    '$family-projection-gap-$count restores actual saved slots after DB reopen without sending', async sample => {
      const p = await paid(await fixture(sample.family, sample.count, `${sample.family}-gap-${sample.count}`), 'gap', `${sample.family}-projection-gap-${sample.count}`)
      db.close(); await db.open()
      const recovered = await action(p, () => recoverInterruptedAuthoringRun({ flow: p.f.flow, runId: p.original.row!.id! }))
      expect(recovered.error).toBeNull(); expect(p.requests).toHaveLength(sample.count)
      prefix(p, recovered.current.row!, sample.count)
      expect(recovered.current.producers).toEqual(p.original.producers)
      expect(recovered.current.readers).toEqual(p.original.readers)
      expect(recovered.current.row?.status).toBe('paused')
      canonEqual(p.before, p.afterGraph); onlyProjection(recovered.before, recovered.after)
    })

  it('existing-tuple-resume refuses before deleting paid data or changing the original rows', async () => {
    const p = await paid(await fixture('world', 3, 'existing-tuple-resume'), 'unknown', 'existing-tuple-resume')
    const resumed = await action(p, () => runAuthoringGraph({ flow: p.f.flow, resumeRunId: p.original.row!.id! }))
    expect(resumed.error).toBeInstanceOf(Error); expect(p.requests).toHaveLength(2)
    expect(resumed.after).toEqual(resumed.before)
  })

  it('foreign-scope cannot recover or publish another real Work and Flow', async () => {
    const p = await paid(await fixture('world', 1, 'foreign-scope'), 'gap', 'foreign-scope')
    const foreign = await fixture('story', 1, 'foreign-real-work')
    const recovered = await action(p, () => recoverInterruptedAuthoringRun({ flow: foreign.flow, runId: p.original.row!.id! }))
    expect(recovered.error).toBeInstanceOf(Error); expect(recovered.after).toEqual(recovered.before)
    expect(p.requests).toHaveLength(1)
  })

  it('tuple-corruption cannot transplant another native slot or change the projection', async () => {
    const p = await paid(await fixture('world', 1, 'tuple-corruption'), 'gap', 'tuple-corruption')
    const row = p.original.producers[0]
    await db.transaction('rw', db.agentRuns, async () => {
      p.trace.push(transactionTrace('isolated-native-tuple-corruption'))
      await db.agentRuns.update(row.id!, { nodeProducerNodeId: 'not-in-original-signed-graph' })
    })

    const recovered = await action(p, () => recoverInterruptedAuthoringRun({ flow: p.f.flow, runId: p.original.row!.id! }))
    expect(recovered.error).toBeInstanceOf(Error); expect(recovered.after).toEqual(recovered.before)
    expect(p.requests).toHaveLength(1)
  })

  it('checkpoint-corruption fails original verification without repairing or sending', async () => {
    const p = await paid(await fixture('story', 1, 'checkpoint-corruption'), 'gap', 'checkpoint-corruption')
    const checkpoints = await db.agentRunCheckpoints.where('runId').equals(p.original.producers[0].id!).toArray()
    if (checkpoints.length !== 1) throw new Error('FIXTURE_READINESS: original candidate checkpoint missing')
    const checkpoint = checkpoints[0]
    await db.transaction('rw', db.agentRunCheckpoints, async () => {
      p.trace.push(transactionTrace('isolated-native-checkpoint-corruption'))
      await db.agentRunCheckpoints.update(checkpoint.id!, { resumePayloadHash: '0'.repeat(64) })
    })

    const recovered = await action(p, () => recoverInterruptedAuthoringRun({ flow: p.f.flow, runId: p.original.row!.id! }))
    expect(recovered.error).toBeInstanceOf(Error); expect(recovered.after).toEqual(recovered.before)
    expect(p.requests).toHaveLength(1)
  })

  it('semantic-source-drift retains the original sealed basis and the new Canon unchanged', async () => {
    const p = await paid(await fixture('world', 1, 'semantic-source-drift'), 'gap', 'semantic-source-drift')
    const rows = await readOwnedRows<Worldview>(p.f.scope, 'worldviews', { owner: 'world' })
    if (rows.length !== 1) throw new Error('FIXTURE_READINESS: original worldview missing')
    const old = rows[0], nextText = '真实修改后的世界起源；恢复旧候选不得把它当作旧的生成依据。'
    await db.transaction('rw', db.worldviews, async () => {
      p.trace.push(transactionTrace('isolated-native-semantic-author-edit'))
      await db.worldviews.update(old.id!, { worldOrigin: nextText, updatedAt: old.updatedAt + 1 })
    })

    const recovered = await action(p, () => recoverInterruptedAuthoringRun({ flow: p.f.flow, runId: p.original.row!.id! }))
    expect(recovered.error).toBeNull(); const candidate = prefix(p, recovered.current.row!, 1)
    expect(candidate.domain.snapshot.serialized).toContain(old.worldOrigin)
    expect(candidate.domain.snapshot.serialized).not.toContain(nextText)
    expect((await db.worldviews.get(old.id!))?.worldOrigin).toBe(nextText)
    onlyProjection(recovered.before, recovered.after); expect(p.requests).toHaveLength(1)
  })

  it('real-abort-after-prefix preserves the committed first slot and prevents later sends', async () => {
    const p = await paid(await fixture('world', 3, 'real-abort-after-prefix'), 'abort', 'real-abort-after-prefix')
    const recovered = await action(p, () => recoverInterruptedAuthoringRun({ flow: p.f.flow, runId: p.original.row!.id! }))
    expect(p.requests).toHaveLength(1); expect(recovered.error).toBeNull()
    prefix(p, p.original.row!, 1); prefix(p, recovered.current.row!, 1)
    expect(p.original.row?.status).toBe('paused')
    expect(recovered.current.producers).toEqual(p.original.producers)
    onlyProjection(recovered.before, recovered.after); canonEqual(p.before, p.afterGraph)
  })
})
