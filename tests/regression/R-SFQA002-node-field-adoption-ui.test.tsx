import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NodeRunRecord } from '../../src/lib/types'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { runAuthoringGraph } from '../../src/lib/node-authoring/executor'
import { prepareNodeFieldAdoptionCompletionV1 } from '../../src/lib/node-authoring/field-adoption'
import { readAgentRunV1, verifyRecordedMemorySettlementV1 } from '../../src/lib/agent/run/event-store'
import * as usageLog from '../../src/lib/ai/usage-log'
import NodeAuthoringWorkspace from '../../src/components/node-authoring/NodeAuthoringWorkspace'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { createQualityNodeFieldFlow, qualityNodeFieldRaw } from '../helpers/quality002-node-field'

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
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
  if (!found) throw new Error(`Missing actual author button: ${text}`)
  return found
}
function change(element: HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLTextAreaElement ? 'input' : 'change', { bubbles: true }))
}

describe.sequential('002 actual React author choice, adoption and refresh', () => {
  let host: HTMLDivElement, root: Root | null, restoreLocks: () => void, usage: Promise<unknown>[]
  beforeEach(async () => {
    await db.delete(); await db.open(); localStorage.clear(); usage = []
    host = document.createElement('div'); document.body.append(host); root = createRoot(host)
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
    useAIConfigStore.getState().setConfig({ provider: 'custom', apiKey: 'synthetic-node-adoption-ui', model: 'isolated-node-model',
      baseUrl: 'http://127.0.0.1:9/v1', temperature: .5, maxTokens: 8_000, contextWindow: 128_000 })
  })
  afterEach(async () => {
    await act(async () => { root?.unmount(); root = null }); host.remove(); restoreLocks()
    await Promise.allSettled(usage); vi.restoreAllMocks(); vi.unstubAllGlobals(); await db.delete(); localStorage.clear()
  })

  it.each(['world', 'story'] as const)('%s preserves the selected edited draft across real confirmation and a cold UI mount', async family => {
    const f = await createQualityNodeFieldFlow(family), sends: string[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, request) => {
      if (String(url) !== 'http://127.0.0.1:9/v1/chat/completions' || request?.method !== 'POST') throw new Error('Unexpected network request')
      const index = sends.length; sends.push(String(request.body))
      if (index >= 2) throw new Error('Unexpected model resend')
      return new Response(JSON.stringify({ choices: [{ message: { content: qualityNodeFieldRaw(f.field, index) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 17 + index, completion_tokens: 9 + index, total_tokens: 26 + 2 * index } }), { status: 200 })
    }))
    const generated = await runAuthoringGraph({ flow: f.flow }); await Promise.allSettled(usage)
    const rawBefore = await db.agentRunArtifacts.toArray(), usageBefore = await db.aiUsageLog.toArray()
    const authorDraft = '\r\n ' + JSON.stringify({ field: f.field, value: '作者选择第二版本并改写：e\u0301🌙，必须履行旧约。' }, null, 4) + '\n\t '
    const mount = async () => {
      await act(async () => {
        root!.render(createElement(MemoryRouter, null, createElement(DialogProvider, null,
          createElement(ToastProvider, null, createElement(NodeAuthoringWorkspace, { project: f.project, worldGroupId: null })))))
      })
      await waitFor(() => expect(host.querySelector('[data-authoring-node-template]')).not.toBeNull())
      await act(async () => { (host.querySelector('[data-authoring-node-template]') as HTMLElement).click() })
      await waitFor(() => expect(host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')).not.toBeNull())
      await waitFor(async () => {
        const flow = await db.nodeFlows.get(f.flow.id!)
        expect(JSON.parse(flow!.graphJson).nodes[0].lastOpenedAt).toBeTypeOf('number')
        expect(host.querySelector('.node-workspace-header > span')?.textContent).toBe('已保存')
      })
    }
    const remount = async () => {
      await act(async () => { root!.unmount(); root = null }); db.close(); await db.open()
      root = createRoot(host); await mount()
    }
    await mount()
    await waitFor(() => expect(host.querySelector<HTMLSelectElement>('[aria-label="选择候选版本"]')?.disabled).toBe(false))
    await act(async () => { change(host.querySelector<HTMLSelectElement>('[aria-label="选择候选版本"]')!, '1') })
    await act(async () => { change(host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')!, authorDraft) })
    const failProjection = (mods: Partial<NodeRunRecord>) => {
      if (typeof mods.nodeResultsJson === 'string' && JSON.parse(mods.nodeResultsJson).field.status === 'adopted') throw new Error('UI_PROJECTION_INTERRUPTED')
    }
    if (family === 'world') db.nodeRuns.hook('updating', failProjection)
    try {
      // Click before the 350 ms debounce: the actual author boundary must flush the latest draft.
      await act(async () => { button(host, '本地校验并采纳').click() })
      if (family === 'world') await waitFor(() => expect(document.body.textContent).toContain('UI_PROJECTION_INTERRUPTED'))
      else await waitFor(() => expect(button(host, '已采纳').disabled).toBe(true))
    } finally { db.nodeRuns.hook('updating').unsubscribe(failProjection) }
    if (family === 'world') {
      await waitFor(() => expect(button(host, '继续完成采纳').disabled).toBe(false))
      expect(host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')?.readOnly).toBe(true)
      expect(host.querySelector<HTMLSelectElement>('[aria-label="选择候选版本"]')?.disabled).toBe(true)
      expect(button(host, '拒绝候选').disabled).toBe(true)
      await remount()
      await waitFor(() => expect(button(host, '继续完成采纳').disabled).toBe(false))
      expect(host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')?.value).toBe(authorDraft)
      expect(host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')?.readOnly).toBe(true)
      expect(host.querySelector<HTMLSelectElement>('[aria-label="选择候选版本"]')?.value).toBe('1')
      expect(host.querySelector<HTMLSelectElement>('[aria-label="选择候选版本"]')?.disabled).toBe(true)
      expect(button(host, '拒绝候选').disabled).toBe(true)
      await act(async () => { button(host, '继续完成采纳').click() })
      await waitFor(() => expect(button(host, '已采纳').disabled).toBe(true))
    }
    const saved = await db.nodeRuns.get(generated.run.id!), candidate = JSON.parse(saved!.nodeResultsJson).field
    expect(candidate).toMatchObject({ status: 'adopted', selectedVariantIndex: 1, output: authorDraft })
    const terminal = await prepareNodeFieldAdoptionCompletionV1({ scope: f.scope, flow: f.flow,
      runId: generated.run.id!, nodeId: 'field', selectedVariantIndex: 1, draft: authorDraft })
    const completed = await readAgentRunV1(f.scope, terminal.runId)
    expect(completed.projection.state).toBe('completed')
    expect(completed.projection.terminalReceiptHash).toBe(terminal.receipt.receiptHash)
    expect((await verifyRecordedMemorySettlementV1({ scope: f.scope, snapshot: completed })).receipt.state).toBe('settled')
    for (const original of rawBefore) expect(await db.agentRunArtifacts.get(original.id!)).toEqual(original)
    expect(await db.aiUsageLog.toArray()).toEqual(usageBefore)
    await remount()
    await waitFor(() => expect(button(host, '已采纳').disabled).toBe(true))
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')?.value).toBe(authorDraft)
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="候选输出"]')?.readOnly).toBe(true)
    expect(host.querySelector<HTMLSelectElement>('[aria-label="选择候选版本"]')?.value).toBe('1')
    expect(host.textContent).toContain('已写入作品；再次修改请生成新候选。')
    expect(sends).toHaveLength(2)
  })
})
