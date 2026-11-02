import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { useWorldviewStore } from '../../src/stores/worldview'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { runAuthoringGraph, reviseAuthoringCandidate } from '../../src/lib/node-authoring/executor'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readLatestVerifiedAgentRunCheckpointV1 } from '../../src/lib/agent/run/checkpoint'
import * as usageLog from '../../src/lib/ai/usage-log'
import NodeAuthoringWorkspace from '../../src/components/node-authoring/NodeAuthoringWorkspace'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
type Tables = Record<string, unknown[]>
async function snapshot(): Promise<Tables> {
  const rows: Tables = {}
  for (const table of db.tables) rows[table.name] = await table.toArray()
  return rows
}
async function waitFor(check: () => void | Promise<void>) {
  const until = Date.now() + 4_000
  let failure: unknown
  do {
    try { await act(async () => check()); return } catch (error) { failure = error }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  } while (Date.now() < until)
  throw failure
}
function button(host: ParentNode, text: string) {
  const found = Array.from(host.querySelectorAll('button')).find(row => row.textContent?.trim() === text)
  if (!found) throw new Error(`Missing real button: ${text}`)
  return found
}
function localState() { return Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])) }

// Happy DOM has no cross-tab LockManager. This cooperative capability fixture
// exercises the original public owner guard, rather than replacing the runner.
// Actual Chromium Web Locks are separately required by the E2E controls.
function installCooperativeLocks() {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks')
  const held = new Set<string>()
  Object.defineProperty(navigator, 'locks', { configurable: true, value: {
    request: async (name: string, _options: LockOptions, callback: (lock: Lock | null) => unknown) => {
      if (held.has(name)) return callback(null)
      held.add(name)
      try { return await callback({ name, mode: 'exclusive' } as Lock) }
      finally { held.delete(name) }
    },
  } })
  return () => { if (previous) Object.defineProperty(navigator, 'locks', previous); else Reflect.deleteProperty(navigator, 'locks') }
}

describe.sequential('SFQA002 saved field prefixes in the actual React workspace', () => {
  let host: HTMLDivElement, root: Root | null, restoreLocks: () => void
  let usagePromises: Promise<unknown>[]
  beforeEach(async () => {
    await db.delete(); await db.open(); localStorage.clear()
    restoreLocks = installCooperativeLocks()
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    usagePromises = []
    const original = usageLog.recordUsage
    vi.spyOn(usageLog, 'recordUsage').mockImplementation(function (this: unknown, input) {
      const pending = original.call(this, input); usagePromises.push(pending); return pending
    })
    useAIConfigStore.getState().setConfig({ provider: 'custom', apiKey: 'synthetic-node-prefix-ui', model: 'isolated-node-model',
      baseUrl: 'http://127.0.0.1:9/v1', temperature: .5, maxTokens: 8_000, contextWindow: 128_000 })
  })
  afterEach(async () => {
    await act(async () => { root?.unmount(); root = null })
    host.remove(); restoreLocks(); vi.unstubAllGlobals(); vi.restoreAllMocks()
    await db.delete(); localStorage.clear()
  })

  it.each([{ templateId: 'world.origin', outcome: 'failed' }, { templateId: 'story.theme', outcome: 'paused' }] as const)(
    '$outcome restores two readable sealed versions without replacing the author draft or writing on view', async sample => {
      const workspace = await seedCurrentWorkspace(`prefix UI ${sample.outcome}`)
      await useWorldviewStore.getState().loadAll(workspace.scope, null)
      await useWorldviewStore.getState().saveWorldview({ projectId: workspace.scope.projectId, worldGroupId: null,
        worldOrigin: '原来确认的世界；恢复只读版本不能续写或替换它。' }, workspace.scope)
      await useWorldviewStore.getState().saveStoryCore({ projectId: workspace.scope.projectId, theme: '原主题',
        centralConflict: '原冲突', plotPattern: '线性' }, workspace.scope)
      const template = AUTHORING_NODE_BY_ID.get(sample.templateId)
      if (!template) throw new Error('FIXTURE_READINESS: original field template missing')
      const node: AuthoringNodeInstance = { id: 'field', templateId: template.id, templateVersion: 1,
        title: template.label, x: 30, y: 30, config: { ...defaultConfigForTemplate(template), candidateCount: 3 },
        inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
      const flowId = await useNodeFlowStore.getState().createFlow(workspace.scope.projectId, null,
        { name: '双版本只读恢复', graph: { ...emptyAuthoringGraph(), nodes: [node] } })
      const flow = await db.nodeFlows.get(flowId)
      if (!flow) throw new Error('FIXTURE_READINESS: original public Flow missing')
      const raw = [1, 2].map(index => '\r\n  ' + JSON.stringify({ field: sample.templateId === 'world.origin' ? 'worldOrigin' : 'theme',
        value: `封存第${index}版本：测潮人必须为打开古城的决定承担代价 e\u0301🌙。` }, null, 3) + '\n\t ')
      const calls: string[] = [], commits: number[] = [], controller = new AbortController()
      let candidateCount = 0
      const committed = (_key: unknown, event: { type: string; runId: number }) => {
        if (event.type !== 'candidate.persisted') return
        candidateCount++
        const tx = Dexie.currentTransaction
        if (!tx?.idbtrans || tx.idbtrans.mode !== 'readwrite') throw new Error('FIXTURE_READINESS: real commit missing')
        tx.on('complete', () => {
          commits.push(event.runId)
          if (sample.outcome === 'paused' && commits.length === 2) controller.abort('paused')
        })
      }
      db.agentRunEvents.hook('creating', committed)
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, request) => {
        if (String(url) !== 'http://127.0.0.1:9/v1/chat/completions' || request?.method !== 'POST') throw new Error('Unexpected real network prohibited')
        const index = calls.length; calls.push(String(request.body))
        if (index >= 3) throw new Error('Unexpected extra model call')
        return new Response(JSON.stringify({ choices: [{ message: { content: raw[index] ?? 'BROKEN_COMPLETE_THIRD_SLOT_e\u0301🌙' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 17 + index, completion_tokens: 9 + index, total_tokens: 26 + 2 * index } }), { status: 200 })
      }))
      const canonBefore = await snapshot()
      let generated: Awaited<ReturnType<typeof runAuthoringGraph>>
      try { generated = await runAuthoringGraph({ flow, signal: controller.signal }) }
      finally { db.agentRunEvents.hook('creating').unsubscribe(committed) }
      await Promise.allSettled(usagePromises)
      expect(generated.run.status).toBe(sample.outcome)
      expect(candidateCount).toBe(2); expect(commits).toHaveLength(2)
      expect(calls).toHaveLength(sample.outcome === 'failed' ? 3 : 2)
      const producers = await db.agentRuns.filter(row => row.nodeRunId === generated.run.id).sortBy('nodeProducerVariantIndex')
      for (const producer of producers.slice(0, 2)) {
        const view = await readAgentRunV1(workspace.scope, producer.id!)
        expect(view.projection.state).toBe('awaiting_confirmation')
        expect(await readLatestVerifiedAgentRunCheckpointV1(workspace.scope, producer.id!)).not.toBeNull()
      }
      const afterGenerate = await snapshot()
      const operational = new Set(['nodeRuns', 'agentRuns', 'agentRunEvents', 'agentRunArtifacts', 'agentRunCheckpoints', 'aiUsageLog'])
      for (const name of Object.keys(canonBefore)) if (!operational.has(name)) expect(afterGenerate[name], name).toEqual(canonBefore[name])
      // Existing public Node draft revision represents a previously saved author
      // choice. It is not formal confirmation/adoption and creates no Run event.
      const authorDraft = '作者原来保存的主稿；只读查看第二版本不能覆盖这段文字。'
      await reviseAuthoringCandidate({ flow, runId: generated.run.id!, nodeId: node.id,
        selectedVariantIndex: 1, output: authorDraft })
      const project = await db.projects.get(workspace.scope.projectId)
      if (!project) throw new Error('FIXTURE_READINESS: original Project missing')
      await act(async () => { root!.render(createElement(MemoryRouter, null,
        createElement(DialogProvider, null, createElement(ToastProvider, null,
          createElement(NodeAuthoringWorkspace, { project, worldGroupId: null }))))) })
      await waitFor(() => expect(host.querySelector('[data-authoring-node-template]')).not.toBeNull())
      await act(async () => { (host.querySelector('[data-authoring-node-template]') as HTMLElement).click() })
      await waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')?.value).toBe(authorDraft))
      // Selecting a node intentionally records its recent-open timestamp.
      // Await that existing autosave before measuring a readonly view window.
      await waitFor(async () => {
        const stored = await db.nodeFlows.get(flowId)
        const graph = JSON.parse(stored?.graphJson ?? '{}') as { nodes?: { id: string; lastOpenedAt?: number }[] }
        expect(graph.nodes?.find(value => value.id === node.id)?.lastOpenedAt).toBeTypeOf('number')
        expect(host.querySelector('.node-workspace-header > span')?.textContent).toBe('已保存')
      })
      const beforeRecovery = await snapshot(), countBeforeRecovery = calls.length
      await act(async () => { button(host, '恢复已保存结果').click() })
      await waitFor(() => expect(document.body.textContent).toContain('已恢复保存的结果；没有重新调用模型。'))
      const afterRecovery = await snapshot()
      for (const name of Object.keys(beforeRecovery)) if (name !== 'nodeRuns') expect(afterRecovery[name], name).toEqual(beforeRecovery[name])
      const saved = await db.nodeRuns.get(generated.run.id!)
      const candidate = JSON.parse(saved!.nodeResultsJson).field
      expect(candidate.output).toBe(authorDraft); expect(candidate.selectedVariantIndex).toBe(1)
      expect(candidate.variants).toEqual(raw.map(value => JSON.stringify(JSON.parse(value), null, 2)))
      expect(candidate.creativeArtifacts.map((value: { originalText: string }) => value.originalText)).toEqual(raw)
      expect(candidate.creativeArtifacts.map((value: { callEvidence: { totalTokens: number | null }[] }) => value.callEvidence[0]?.totalTokens)).toEqual([26, 28])
      expect(candidate.status).toBe('blocked'); expect(candidate.signature).toBeUndefined()
      const textarea = host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')!
      const select = host.querySelector<HTMLSelectElement>('[aria-label="选择候选版本"]')!
      expect(textarea.value).toBe(authorDraft); expect(textarea.readOnly).toBe(true)
      expect(select.value).toBe('1'); expect(select.disabled).toBe(true)
      expect(button(host, '只读核对').disabled).toBe(true); expect(button(host, '拒绝候选').disabled).toBe(true)
      expect(host.textContent).toContain('已保存候选只读核对；来源是否仍有效尚未核验，未写入作品。')
      expect(host.textContent).not.toContain('点击“本地校验并采纳”')
      const beforeView = await snapshot(), storageBeforeView = localState()
      const details = Array.from(host.querySelectorAll('details')).find(value => value.querySelector('summary')?.textContent === '展开原始候选对照（2 个版本）')
      expect(details).toBeDefined()
      await act(async () => { details!.querySelector('summary')!.click() })
      expect(details!.open).toBe(true)
      for (let index = 0; index < 2; index++) {
        const article = host.querySelector(`[aria-label="封存候选版本 ${index + 1}，只读"]`)!
        expect(article.querySelector('pre')?.textContent).toBe(candidate.variants[index])
        expect(article.querySelector('[aria-label="创作产物状态"]')?.textContent).toContain(`1 次模型调用 · ${26 + 2 * index} tokens`)
        expect(article.textContent).toContain('该版本的原封存产物证据')
      }
      const summaries = host.querySelectorAll('[aria-label="创作产物状态"]')
      expect(summaries).toHaveLength(3)
      for (const summary of summaries) {
        expect(summary.querySelector('strong')?.textContent).toBe('已保存，仅供核对')
        expect(summary.textContent).not.toContain('可直接采纳')
      }
      expect(await snapshot()).toEqual(beforeView); expect(localState()).toEqual(storageBeforeView)
      expect(textarea.value).toBe(authorDraft); expect(select.value).toBe('1')
      expect(calls).toHaveLength(countBeforeRecovery)
    })
})
