import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NodeAuthoringWorkspace from '../../src/components/node-authoring/NodeAuthoringWorkspace'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import * as usageLog from '../../src/lib/ai/usage-log'
import { db } from '../../src/lib/db/schema'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { adoptAuthoringCandidate, runAuthoringGraph } from '../../src/lib/node-authoring/executor'
import { buildAuthoringOverviewGraph } from '../../src/lib/node-authoring/overview'
import type { TemporalFact } from '../../src/lib/types'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useCharacterStore } from '../../src/stores/character'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

const body = '<p>林风的手部受伤。</p>'
const nodeId = 'target'
const endpoint = 'http://127.0.0.1:9/v1'
const families = ['continuity.fact', 'chapter.organize', 'world.origin'] as const
type Family = typeof families[number] | 'chapter.quality-review' | 'continuity.item' | 'live'
const oldAI = useAIConfigStore.getState()

async function fixture(family: Family) {
  const workspace = await seedCurrentWorkspace('057 真实领域采纳')
  const { scope } = workspace
  const common = { projectId: scope.projectId, createdAt: 1, updatedAt: 1 }
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
    ...common, type: 'chapter' as const, parentId: null, worldGroupId: null, title: '受伤', summary: '林风受伤', order: 0,
  }, { owner: 'work' }))
  const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
    ...common, outlineNodeId, title: '受伤', content: body, wordCount: 8, status: 'draft' as const, order: 0, notes: '',
  }, { owner: 'work' }))
  await useCharacterStore.getState().addCharacter({
    projectId: scope.projectId, name: '林风', shortDescription: '隔离角色', homeWorldGroupId: null,
    roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', appearance: '', personality: '', background: '',
    motivation: '', abilities: '', relationships: '[]', arc: '',
  })
  const overview = await buildAuthoringOverviewGraph({ projectId: scope.projectId, worldGroupId: null })
  const source = overview.graph.nodes.find(node => node.binding?.ref?.target === 'chapters' && node.binding.ref.fieldKey === 'content')
  if (!source) throw new Error('Missing actual chapter Canon binding')
  const template = AUTHORING_NODE_BY_ID.get(family === 'live' ? source.templateId : family)!
  const target: AuthoringNodeInstance = family === 'live' ? { ...source, id: nodeId } : {
    id: nodeId, templateId: template.id, templateVersion: template.version, title: template.label, x: 350, y: 0,
    inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs),
    config: { ...defaultConfigForTemplate(template), chapterTitle: '受伤', candidateCount: 1 },
  }
  const connectChapter = family === 'chapter.organize' || family === 'chapter.quality-review'
  const flowId = await useNodeFlowStore.getState().createFlow(scope.projectId, null, {
    graph: { ...emptyAuthoringGraph(), nodes: connectChapter ? [source, target] : [target], edges: connectChapter ? [
      { id: 'chapter-source', sourceNodeId: source.id, sourcePortId: source.outputs[0].id, targetNodeId: target.id, targetPortId: 'chapter' },
    ] : [] },
  })
  const flow = (await db.nodeFlows.get(flowId))!
  return { ...workspace, chapterId, flow, target }
}

function modelResult(family: Family) {
  if (family === 'world.origin') return { field: 'worldOrigin', value: '正式起源合成候选' }
  if (family === 'chapter.quality-review') return { summary: '伤势描写待作者核对', strengths: [], issues: [] }
  if (family === 'continuity.item') return { inventoryEvents: [] }
  const facts = [{ subject: '林风', predicate: 'healthStatus', value: '受伤', quote: '手部受伤' }]
  return family === 'chapter.organize' ? {
    facts, stateDiffs: [], inventoryEvents: [], storyEvents: [], relations: [], foreshadowUpdates: [],
  } : { facts }
}

function stubModel(family: Family) {
  const send = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url) !== endpoint + '/chat/completions' || init?.method !== 'POST') throw new Error('Unexpected network route')
    if (send.mock.calls.length !== 1) throw new Error('Unexpected second model request')
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelResult(family)) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 } }), { status: 200 })
  })
  vi.stubGlobal('fetch', send)
  return send
}

describe.sequential('057 · actual node workspace uses the domain adoption boundary', () => {
  let host: HTMLDivElement, root: Root | null, usage: Promise<unknown>[], restoreLocks: () => void
  beforeEach(async () => {
    await db.delete(); await db.open(); localStorage.clear()
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    host = document.createElement('div'); document.body.append(host); root = createRoot(host); usage = []
    useNodeFlowStore.setState({ projectId: null, workId: null, flows: [], runs: [], loading: false })
    useAIConfigStore.setState({ config: { provider: 'custom', apiKey: 'synthetic-node-ui', model: 'isolated-node',
      baseUrl: endpoint, temperature: 0.5, maxTokens: 8_000, contextWindow: 128_000 }, taskRoutes: {} })
    const previous = Object.getOwnPropertyDescriptor(navigator, 'locks'), held = new Set<string>()
    Object.defineProperty(navigator, 'locks', { configurable: true, value: {
      request: async (name: string, _options: LockOptions, callback: (lock: Lock | null) => unknown) => {
        if (held.has(name)) return callback(null)
        held.add(name)
        try { return await callback({ name, mode: 'exclusive' } as Lock) } finally { held.delete(name) }
      },
    } })
    restoreLocks = () => { if (previous) Object.defineProperty(navigator, 'locks', previous); else Reflect.deleteProperty(navigator, 'locks') }
    const original = usageLog.recordUsage
    vi.spyOn(usageLog, 'recordUsage').mockImplementation(function (this: unknown, input) {
      const pending = original.call(this, input); usage.push(pending); return pending
    })
  })
  afterEach(async () => {
    await act(async () => { root?.unmount(); root = null })
    host.remove(); restoreLocks(); await Promise.allSettled(usage)
    vi.restoreAllMocks(); vi.unstubAllGlobals(); useAIConfigStore.setState(oldAI, true)
    await db.delete(); localStorage.clear()
  })

  const button = (text: string) => Array.from(host.querySelectorAll('button')).find(row => row.textContent?.trim() === text)
  const waitFor = async (check: () => void) => {
    const deadline = Date.now() + 3_000
    let lastError: unknown
    do {
      try { check(); return } catch (error) { lastError = error }
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)) })
    } while (Date.now() < deadline)
    throw lastError
  }
  const mount = async (f: Awaited<ReturnType<typeof fixture>>) => {
    await act(async () => {
      root!.render(createElement(MemoryRouter, null, createElement(DialogProvider, null,
        createElement(ToastProvider, null, createElement(NodeAuthoringWorkspace, { project: f.project, worldGroupId: null })))))
    })
    const target = () => host.querySelector<HTMLElement>(`[data-authoring-node-template="${f.target.templateId}"]`)
    await waitFor(() => expect(target()).not.toBeNull())
    await act(async () => { target()!.click() })
    await waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')).not.toBeNull())
    await waitFor(() => expect(host.querySelector('.node-workspace-header > span')?.textContent).toBe('已保存'))
  }
  const refresh = async (f: Awaited<ReturnType<typeof fixture>>) => {
    await act(async () => { root!.unmount(); root = null })
    db.close(); await db.open(); root = createRoot(host); await mount(f)
  }

  it.each(families)('%s waits for a real author click and restores exactly one accepted write', async family => {
    const f = await fixture(family), send = stubModel(family)
    const run = await runAuthoringGraph({ flow: f.flow })
    await Promise.allSettled(usage)
    expect(run.run.status).toBe('completed')
    expect(run.candidates[nodeId].domain?.kind).toBe(family === 'world.origin' ? 'worldview-field' :
      family === 'chapter.organize' ? 'chapter-organization' : 'facts')
    await mount(f)
    await act(async () => {
      expect(await db.temporalFacts.count()).toBe(0)
      expect((await db.worldviews.toArray()).some(row => row.worldOrigin === '正式起源合成候选')).toBe(false)
    })
    expect(button('确认采纳')?.disabled).toBe(false)
    await act(async () => { button('确认采纳')!.click() })
    await waitFor(() => expect(button('已采纳')?.disabled).toBe(true))
    let facts: TemporalFact[] = []
    await act(async () => { facts = await db.temporalFacts.toArray() })
    if (family !== 'world.origin') {
      expect(facts).toHaveLength(1)
      expect(facts[0]).toMatchObject({ projectId: f.scope.projectId, sourceChapterId: f.chapterId, predicate: 'healthStatus', value: '受伤' })
    } else await act(async () => {
      expect((await db.worldviews.toArray()).filter(row => row.worldOrigin === '正式起源合成候选')).toHaveLength(1)
    })
    await refresh(f)
    expect(button('已采纳')?.disabled).toBe(true)
    await act(async () => { button('已采纳')!.click() })
    await act(async () => {
      expect(await db.temporalFacts.toArray()).toEqual(facts)
      expect((await db.chapters.get(f.chapterId))?.content).toBe(body)
      expect(send).toHaveBeenCalledTimes(1)
      const persisted = (await db.nodeRuns.get(run.run.id!))!
      expect(JSON.parse(persisted.nodeResultsJson)[nodeId].status).toBe('adopted')
    })
  })


  it.each(['chapter.quality-review', 'continuity.item', 'live'] as const)('%s keeps its actual output without a confirmation affordance', async family => {
    const f = await fixture(family), send = stubModel(family)
    const run = await runAuthoringGraph({ flow: f.flow })
    await Promise.allSettled(usage)
    expect(run.run.status).toBe('completed')
    const candidate = run.candidates[nodeId]
    expect(candidate.output.length).toBeGreaterThan(0)
    if (family === 'chapter.quality-review') expect(candidate.domain?.kind).toBe('quality-review')
    else expect(candidate.domain).toBeUndefined()
    await mount(f)
    expect(button('确认采纳')).toBeUndefined()
    const output = host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')!
    expect(output.value).toBe(candidate.output)
    expect(output.readOnly).toBe(family !== 'continuity.item')
    expect(send).toHaveBeenCalledTimes(family === 'live' ? 0 : 1)
    await act(async () => {
      expect(await db.temporalFacts.count()).toBe(0)
      expect(await db.itemLedger.count()).toBe(0)
      expect((await db.chapters.get(f.chapterId))?.content).toBe(body)
    })
  })

  it('keeps foreign Work and stale chapter protections at the original writer and can reject without saving', async () => {
    const f = await fixture('continuity.fact'), send = stubModel('continuity.fact')
    const run = await runAuthoringGraph({ flow: f.flow })
    const foreign = await seedCurrentWorkspace('057 外部作品')
    const candidate = run.candidates[nodeId]
    await expect(adoptAuthoringCandidate({ flow: f.flow, scope: foreign.scope, runId: run.run.id!, nodeId,
      output: candidate.output })).rejects.toThrow(/作用域|不属于|projectId|Project/)
    const editedBody = '<p>林风的手部受伤。作者补写了结局。</p>'
    await db.chapters.update(f.chapterId, { content: editedBody, updatedAt: 2 })
    await mount(f)
    await act(async () => { button('确认采纳')!.click() })
    await waitFor(() => expect(host.textContent).toContain('这批事实候选已过期'))
    expect(send).toHaveBeenCalledTimes(1)
    await act(async () => { button('拒绝候选')!.click() })
    await waitFor(() => expect(button('已拒绝')?.disabled).toBe(true))
    await refresh(f)
    expect(button('已拒绝')?.disabled).toBe(true)
    await act(async () => {
      expect(await db.temporalFacts.count()).toBe(0)
      expect((await db.chapters.get(f.chapterId))?.content).toBe(editedBody)
      expect(JSON.parse((await db.nodeRuns.get(run.run.id!))!.nodeResultsJson)[nodeId].status).toBe('rejected')
    })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
