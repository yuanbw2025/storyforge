import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import AdventureGamePlayer from '../../src/components/text-game/AdventureGamePlayer'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState } from '../../src/lib/adventure/runtime-api'
import { availableAdventureActions } from '../../src/lib/adventure/runtime'
import { adoptAdventureRuntimeCandidateV1, cancelAdventureRuntimeRunV1 } from '../../src/lib/adventure/harness'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import * as instances from '../../src/lib/product/runtime-instances'
import { useAdventureGamePlayerStore } from '../../src/stores/adventure-game-player'
import type { AIConfig } from '../../src/lib/types'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import { loadCurrentProductWorldSourceCatalogV1, seedCurrentProductWorld } from '../helpers/current-product-world'
import { createCurrentRuntimePackageFixture } from '../helpers/current-runtime-package'

const config: AIConfig = { provider: 'custom', apiKey: 'synthetic-no-network', model: 'synthetic-116',
  baseUrl: 'http://127.0.0.1:9/v1', temperature: 0, maxTokens: 1024, contextWindow: 128_000 }
const store = useAdventureGamePlayerStore

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

async function fixture(title: string) {
  const world = await seedCurrentProductWorld(title)
  if (world.release.id == null) throw new Error('Fixture must publish a real frozen world')
  const release = { ...world.release, id: world.release.id }
  const catalog = await loadCurrentProductWorldSourceCatalogV1({ scope: world.scope, worldReleaseId: release.id, productType: 'text-adventure' })
  const runtimePackage = createCurrentRuntimePackageFixture({ productType: 'text-adventure', worldRelease: release, sourceCatalog: catalog })
  const build = await seedCurrentProductBuild({ scope: world.scope, worldRelease: release, runtimePackage, title })
  const sessionId = build.session.id!
  const state = await readProductRuntimeState(sessionId)
  const action = availableAdventureActions(runtimePackage.adventure!, state.adventure!).find(item => item.available)?.action
  if (!action) throw new Error('Fixture requires an available frozen action')
  return { project: world.project, scope: world.scope, release, runtimePackage, sessionId, action,
    raw: JSON.stringify({ kind: 'adventure-intent', actionKey: action.key, rationale: `${title} 原始候选 e\u0301`, requiresConfirmation: true }) }
}

function delayedResponse(raw: string) {
  const reached = deferred<void>(), response = deferred<Response>()
  const fetcher = vi.fn<typeof fetch>(async () => { reached.resolve(); return response.promise })
  vi.stubGlobal('fetch', fetcher)
  return { reached: reached.promise, fetcher, finish: () => response.resolve(new Response(JSON.stringify({
    choices: [{ message: { content: raw }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 },
  }), { status: 200, headers: { 'content-type': 'application/json' } })) }
}

function modelResponse(raw: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }),
  { status: 200, headers: { 'content-type': 'application/json' } })
}

beforeEach(async () => {
  store.getState().cancelPendingLoad()
  store.setState(store.getInitialState(), true)
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => { throw new Error('Unexpected network request') }))
})
afterEach(async () => {
  store.getState().cancelPendingLoad()
  store.getState().selectedMediaResolver?.dispose()
  vi.restoreAllMocks(); vi.unstubAllGlobals()
  await db.delete()
})

describe('SFQA-116 durable intent remains bound to its original player session', () => {
  for (const destination of ['same-work-session', 'other-work', 'unmount'] as const) {
    it(`${destination}: late A output stays recoverable without appearing in the current player`, async () => {
      const a = await fixture('A')
      const b = destination === 'same-work-session'
        ? { scope: a.scope, sessionId: (await seedCurrentProductBuild({ scope: a.scope, worldRelease: a.release,
          runtimePackage: a.runtimePackage, title: 'B' })).session.id! }
        : destination === 'other-work' ? await fixture('B') : null
      await store.getState().load(a.scope, null)
      await store.getState().select(a.sessionId)
      const originalEvents = await db.productRuntimeEvents.toArray()
      const transport = delayedResponse(a.raw)
      const generating = store.getState().generateIntent('执行 A 行动', config)
      await transport.reached
      if (destination === 'other-work' && b) await store.getState().load(b.scope, null)
      if (b) await store.getState().select(b.sessionId)
      else store.getState().cancelPendingLoad()
      transport.finish()
      await generating
      const runs = await db.agentRuns.where('productRuntimeSessionId').equals(a.sessionId).toArray()
      expect(runs).toHaveLength(1)
      const checkpoints = await db.agentRunCheckpoints.where('runId').equals(runs[0].id!).toArray()
      expect(checkpoints.some(row => row.resumePayloadJson?.includes('adventure-intent-candidate'))).toBe(true)
      const run = await readInstanceAgentRunV1(a.scope, runs[0].id!)
      const raw: string[] = []
      for (const event of run.events) if (event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response') {
        const saved = await readAgentRunArtifactExactV1({ projectId: a.scope.projectId, artifactKind: 'raw-response', contentHash: event.payload.contentHash })
        raw.push((JSON.parse(saved) as { raw: string }).raw)
      }
      expect(raw).toEqual([a.raw])
      expect(await db.productRuntimeEvents.toArray()).toEqual(originalEvents)
      expect(store.getState().pendingIntent).toBeNull()
      expect(store.getState().generatingRunId).toBeNull()
      if (b) expect(store.getState().selectedSessionId).toBe(b.sessionId)
      await store.getState().load(a.scope, null)
      await store.getState().select(a.sessionId)
      expect(store.getState().recoverableRunIds).toContain(runs[0].id)
      await store.getState().resumeRun(runs[0].id!)
      expect((await readProductRuntimeState(a.sessionId)).adventure?.actionHistory.some(row => row.actionKey === a.action.key)).toBe(true)
      if (b) expect(await db.productRuntimeEvents.where('sessionId').equals(b.sessionId).toArray())
        .toEqual(originalEvents.filter(row => row.sessionId === b.sessionId))
      expect(transport.fetcher).toHaveBeenCalledTimes(1)
    })
  }

  for (const sameSession of [false, true]) for (const failOld of [false, true]) {
    it(`older ${failOld ? 'failure' : 'success'} cannot clear a newer request (${sameSession ? 'same' : 'different'} session)`, async () => {
      const a = await fixture('旧请求')
      const bId = sameSession ? a.sessionId : (await seedCurrentProductBuild({ scope: a.scope, worldRelease: a.release,
        runtimePackage: a.runtimePackage, title: '新存档' })).session.id!
      await store.getState().load(a.scope, null)
      await store.getState().select(a.sessionId)
      const responses = [deferred<Response>(), deferred<Response>()]
      const reached = [deferred<void>(), deferred<void>()]
      let sends = 0
      const fetcher = vi.fn<typeof fetch>(async () => {
        const index = sends++
        if (index > 1) throw new Error('Hidden model retry')
        reached[index].resolve()
        return responses[index].promise
      })
      vi.stubGlobal('fetch', fetcher)
      const old = store.getState().generateIntent('旧请求', config).then(() => null, (error: unknown) => error)
      await reached[0].promise
      if (!sameSession) await store.getState().select(bId)
      const newer = store.getState().generateIntent('新请求', config)
      await reached[1].promise
      const newerRunId = store.getState().generatingRunId
      expect(newerRunId).toBeGreaterThan(0)
      if (failOld) responses[0].reject(new TypeError('旧请求结果未知'))
      else responses[0].resolve(modelResponse(a.raw))
      const oldResult = await old
      if (failOld) expect(oldResult).toBeInstanceOf(Error)
      else expect(oldResult).toBeNull()
      expect(store.getState()).toMatchObject({ selectedSessionId: bId, busy: true, error: '',
        generatingRunId: newerRunId, pendingIntent: null })
      responses[1].resolve(modelResponse(a.raw.replace('旧请求 原始候选', '新请求 原始候选')))
      await newer
      expect(store.getState()).toMatchObject({ busy: false, error: '', generatingRunId: null,
        pendingIntent: { runId: newerRunId, productRuntimeSessionId: bId, rationale: '新请求 原始候选 e\u0301' } })
      expect(fetcher).toHaveBeenCalledTimes(2)
    })
  }

  it('a stale card, wrong-session resume and public adoption cannot write A while B is selected', async () => {
    const a = await fixture('拒绝错误存档')
    const b = await seedCurrentProductBuild({ scope: a.scope, worldRelease: a.release, runtimePackage: a.runtimePackage, title: 'B' })
    await store.getState().load(a.scope, null)
    await store.getState().select(a.sessionId)
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => modelResponse(a.raw)))
    await store.getState().generateIntent('原候选', config)
    const candidate = store.getState().pendingIntent!
    expect(candidate.productRuntimeSessionId).toBe(a.sessionId)
    await store.getState().select(b.session.id!)
    const eventsBefore = await db.productRuntimeEvents.toArray()
    const runEventsBefore = await db.agentRunEvents.toArray()
    store.setState({ pendingIntent: candidate })
    await expect(store.getState().adoptPendingIntent()).rejects.toThrow('此存档')
    await expect(store.getState().resumeRun(candidate.runId)).rejects.toThrow('当前存档')
    await expect(adoptAdventureRuntimeCandidateV1({ scope: a.scope, runId: candidate.runId,
      expectedProductRuntimeSessionId: b.session.id! })).rejects.toThrow('当前存档')
    await expect(cancelAdventureRuntimeRunV1({ scope: a.scope, runId: candidate.runId,
      expectedProductRuntimeSessionId: b.session.id! })).rejects.toThrow('当前存档')
    await store.getState().rejectPendingIntent()
    expect(await db.productRuntimeEvents.toArray()).toEqual(eventsBefore)
    expect(await db.agentRunEvents.toArray()).toEqual(runEventsBefore)
    await store.getState().select(a.sessionId)
    await store.getState().resumeRun(candidate.runId)
    expect((await readProductRuntimeState(a.sessionId)).adventure?.actionHistory).toHaveLength(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('late narration stays on the original durable Run and resumes without a second model request', async () => {
    const a = await fixture('原存档叙述')
    const b = await seedCurrentProductBuild({ scope: a.scope, worldRelease: a.release, runtimePackage: a.runtimePackage, title: 'B' })
    await store.getState().load(a.scope, null)
    await store.getState().select(a.sessionId)
    const fetcher = vi.fn<typeof fetch>(async () => modelResponse(a.raw))
    vi.stubGlobal('fetch', fetcher)
    await store.getState().generateIntent('先结算行动', config)
    await store.getState().adoptPendingIntent()
    const settled = store.getState().runtimeState
    const last = settled.adventure!.actionHistory.slice(-1)[0]
    const raw = JSON.stringify({ kind: 'adventure-result', narrative: '只描述原存档已经结算的动作。', evidenceEventSequences: [last.eventSequence] })
    const transport = delayedResponse(raw)
    const narrating = store.getState().narrateLastResult(config)
    await transport.reached
    const runId = store.getState().generatingRunId!
    await store.getState().select(b.session.id!)
    transport.finish()
    await narrating
    expect(store.getState().generatedNarrative).toBeNull()
    expect(await readProductRuntimeState(a.sessionId)).toEqual(settled)
    await store.getState().select(a.sessionId)
    expect(store.getState().recoverableRunIds).toContain(runId)
    await store.getState().resumeRun(runId)
    expect(store.getState().generatedNarrative).toMatchObject({ productRuntimeSessionId: a.sessionId, narrative: '只描述原存档已经结算的动作。' })
    expect(await readProductRuntimeState(a.sessionId)).toEqual(settled)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(transport.fetcher).toHaveBeenCalledTimes(1)
  })

  it('late A output cannot publish during B loading while the old selected id is still A', async () => {
    const a = await fixture('加载竞态')
    const b = await seedCurrentProductBuild({ scope: a.scope, worldRelease: a.release, runtimePackage: a.runtimePackage, title: 'B' })
    await store.getState().load(a.scope, null)
    await store.getState().select(a.sessionId)
    const transport = delayedResponse(a.raw)
    const generating = store.getState().generateIntent('A', config)
    await transport.reached
    const binding = instances.assertInstanceBinding
    const entered = deferred<void>(), release = deferred<void>()
    vi.spyOn(instances, 'assertInstanceBinding').mockImplementation(async (...args) => {
      const actual = await binding(...args)
      if (args[0] === b.session.id) { entered.resolve(); await release.promise }
      return actual
    })
    const selecting = store.getState().select(b.session.id!)
    await entered.promise
    transport.finish()
    await generating
    const during = store.getState()
    const refusal = await store.getState().generateIntent('不能在加载期间发送', config).then(() => null, (error: unknown) => error)
    release.resolve()
    await selecting
    expect(during).toMatchObject({ loading: true, selectedSessionId: a.sessionId, pendingIntent: null, generatingRunId: null })
    expect(refusal).toBeInstanceOf(Error)
    expect(store.getState().selectedSessionId).toBe(b.session.id)
    expect(transport.fetcher).toHaveBeenCalledTimes(1)
  })

  it('returning from B to A does not revive a request from A previous visit', async () => {
    const a = await fixture('返回原存档')
    const b = await seedCurrentProductBuild({ scope: a.scope, worldRelease: a.release, runtimePackage: a.runtimePackage, title: 'B' })
    await store.getState().load(a.scope, null)
    await store.getState().select(a.sessionId)
    const transport = delayedResponse(a.raw)
    const generating = store.getState().generateIntent('A旧页面请求', config)
    await transport.reached
    await store.getState().select(b.session.id!)
    await store.getState().select(a.sessionId)
    transport.finish()
    await generating
    expect(store.getState()).toMatchObject({ selectedSessionId: a.sessionId, pendingIntent: null, busy: false, error: '' })
    await store.getState().select(a.sessionId)
    expect(store.getState().recoverableRunIds).toHaveLength(1)
    expect(transport.fetcher).toHaveBeenCalledTimes(1)
  })

  it('a failed navigation cannot let the old UI request replace the current navigation error', async () => {
    const a = await fixture('失败导航')
    useAIConfigStore.getState().setConfig(config)
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const reached = deferred<void>(), response = deferred<Response>()
    const fetcher = vi.fn<typeof fetch>(async () => { reached.resolve(); return response.promise })
    vi.stubGlobal('fetch', fetcher)
    try {
      await act(async () => {
        root.render(createElement(DialogProvider, null, createElement(AdventureGamePlayer, {
          project: a.project, scope: a.scope, worldGroupId: null, initialSessionId: a.sessionId,
        })))
      })
      await act(async () => {
        await vi.waitFor(() => expect(store.getState()).toMatchObject({ loading: false, selectedSessionId: a.sessionId }))
      })
      const input = host.querySelector<HTMLInputElement>('input[aria-label="输入冒险指令"]')!
      expect(input).not.toBeNull()
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '请主 Agent 理解我此刻的探索想法')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => {
        input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        await reached.promise
      })
      // The target was removed elsewhere. Both loading states may be batched
      // into one React render, so selectedSessionId still equals A afterward.
      await act(async () => { await store.getState().select(a.sessionId + 10_000) })
      const navigationError = store.getState().error
      expect(navigationError).not.toBe('')
      await act(async () => {
        response.reject(new TypeError('116旧模型请求失败'))
        await vi.waitFor(async () => expect((await db.agentRuns.toArray())[0]?.status).toBe('failed'))
      })
      expect(store.getState().error).toBe(navigationError)
      expect(host.textContent).toContain(navigationError)
      expect(host.textContent).not.toContain('116旧模型请求失败')
      expect(fetcher).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
