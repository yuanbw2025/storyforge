import { act, createElement, StrictMode, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PromptTemplateEditor from '../../src/components/settings/prompt/PromptTemplateEditor'
import PromptManagerPanel from '../../src/components/settings/prompt/PromptManagerPanel'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { db } from '../../src/lib/db/schema'
import type { PromptTemplate } from '../../src/lib/types/prompt'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
let releaseResponse: ((response: Response) => void) | undefined
let requestSignal: AbortSignal | null | undefined
const requests: string[] = []

function template(patch: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    scope: 'user', moduleKey: 'chapter.content', promptType: 'generate',
    name: '107 作者模板', description: '合成示例交错',
    systemPrompt: 'ORIGINAL_SYSTEM', userPromptTemplate: 'subject {{subject}}',
    variables: ['subject'],
    parameters: [{ key: 'tone', label: 'Tone', type: 'text', default: 'exact' }],
    examples: { good: [{ id: 'g1', text: 'GOOD_ORIGINAL', source: 'user-marked', rating: 5, createdAt: 1 }] },
    isActive: false, createdAt: 1, updatedAt: 1, ...patch,
  }
}

function ConnectedEditor({ id }: { id: number }) {
  const row = usePromptStore(state => state.templates.find(item => item.id === id))
  return createElement(PromptTemplateEditor, { template: row ?? null, onChanged: () => {}, onDeleted: () => {} })
}

async function mountElement(element: ReactElement, strict = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  const providers = createElement(DialogProvider, null, createElement(ToastProvider, null, element))
  await act(async () => root.render(strict ? createElement(StrictMode, null, providers) : providers))
  return host
}

async function mount(id: number, strict = false) {
  return mountElement(createElement(ConnectedEditor, { id }), strict)
}

function button(host: HTMLElement, label: string) {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find(item => item.textContent?.trim() === label)
  expect(result, label).toBeTruthy()
  return result!
}

async function editSystem(host: HTMLElement, value: string) {
  const field = host.querySelector<HTMLTextAreaElement>('textarea')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(field.value).toBe(value)
  expect(button(host, '保存 *').disabled).toBe(false)
}

async function completeExample() {
  expect(releaseResponse).toBeTypeOf('function')
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: 'AI_SYNTHETIC_EXAMPLE' }, finish_reason: null }] })}\n\n`
    + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`
  await act(async () => releaseResponse!(new Response(body, { headers: { 'content-type': 'text/event-stream' } })))
}

function successfulResponse(text: string) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`
    + `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
  { headers: { 'content-type': 'text/event-stream' } })
}

async function releaseAndFlush(release: (response: Response) => void, response: Response) {
  await act(async () => {
    release(response)
    await new Promise(resolve => setTimeout(resolve, 0))
  })
}

async function begin(host: HTMLElement) {
  await act(async () => button(host, 'AI 生成').click())
  await vi.waitFor(() => expect(releaseResponse).toBeTypeOf('function'))
  return { release: releaseResponse!, signal: requestSignal }
}

async function fill(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(field.value).toBe(value)
}

async function selectModule(host: HTMLElement, moduleKey: 'chapter.content' | 'chapter.continue') {
  const field = host.querySelector<HTMLSelectElement>('select')!
  await act(async () => {
    field.value = moduleKey
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(field.value).toBe(moduleKey)
}

async function selectTemplate(host: HTMLElement, name: string) {
  const row = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    .find(item => item.textContent?.includes(name))!
  expect(row).toBeTruthy()
  await act(async () => row.click())
  await vi.waitFor(() => expect(Array.from(host.querySelectorAll<HTMLInputElement>('input'))
    .some(input => input.value === name)).toBe(true))
}

async function openManual(host: HTMLElement, kind: 'good' | 'bad', text: string) {
  const add = host.querySelectorAll<HTMLButtonElement>('button[title="手动添加一条"]')[kind === 'good' ? 0 : 1]
  await act(async () => add.click())
  const field = host.querySelector<HTMLInputElement>('[role=dialog] input')!
  expect(field).toBeTruthy()
  await fill(field, text)
}

async function save(host: HTMLElement, id: number) {
  await act(async () => button(host, '保存 *').click())
  await vi.waitFor(() => expect(button(host, '保存').disabled).toBe(true))
  return (await db.promptTemplates.get(id))!
}

async function snapshot() {
  const result: Record<string, unknown[]> = {}
  for (const table of db.tables) result[table.name] = await table.toArray()
  return result
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  sessionStorage.clear()
  await db.delete()
  await db.open()
  usePromptStore.setState({ templates: [], loaded: true })
  useAIConfigStore.setState({ presets: [], taskRoutes: {} })
  useAIConfigStore.getState().setConfig({
    provider: 'custom', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'SYNTHETIC_NOT_A_REAL_KEY',
    model: 'sfqa107-synthetic', temperature: 0.7, maxTokens: 1024, contextWindow: 128000,
  })
  releaseResponse = undefined
  requestSignal = undefined
  requests.length = 0
  // Only fetch is controlled. The real Hook, registered auxiliary entry,
  // request builder, SSE parser, React draft and native store all execute.
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(String(input))
    requestSignal = init?.signal
    expect(String(input)).toBe('http://127.0.0.1:9/v1/chat/completions')
    return new Promise<Response>(resolve => { releaseResponse = resolve })
  }))
})

afterEach(async () => {
  for (const { host, root } of mounted.splice(0)) {
    await act(async () => root.unmount())
    host.remove()
  }
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await db.delete()
})

describe.sequential('SFQA-107 · delayed actual prompt-example stream retains the current author draft', () => {
  for (const authorChanges of [false, true]) {
    it(`original delayed SSE: author edits = ${authorChanges}`, async () => {
      const id = await usePromptStore.getState().saveTemplate(template())
      const host = await mount(id)
      const before = await db.promptTemplates.get(id)
      await act(async () => button(host, 'AI 生成').click())
      await vi.waitFor(() => expect(releaseResponse).toBeTypeOf('function'))
      expect(requests).toHaveLength(1)
      if (authorChanges) await editSystem(host, 'NEW_AUTHOR_SYSTEM_DURING_AI')

      await completeExample()
      await vi.waitFor(() => expect(host.textContent).toContain('AI_SYNTHETIC_EXAMPLE'))
      const expectedSystem = authorChanges ? 'NEW_AUTHOR_SYSTEM_DURING_AI' : 'ORIGINAL_SYSTEM'
      expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(expectedSystem)
      expect(await db.promptTemplates.get(id)).toEqual(before)
      expect(await db.agentRuns.count()).toBe(0)

      await act(async () => button(host, '保存 *').click())
      await vi.waitFor(async () => expect((await db.promptTemplates.get(id))?.examples?.good).toHaveLength(2))
      const saved = await db.promptTemplates.get(id)
      expect(saved?.systemPrompt).toBe(expectedSystem)
      expect(saved?.examples?.good?.map(example => example.text)).toEqual(['GOOD_ORIGINAL', 'AI_SYNTHETIC_EXAMPLE'])
      expect(saved?.scope).toBe('user')
      expect(requests).toHaveLength(1)
    })
  }

  it('late success preserves the current User Prompt and parameter edits as well as System Prompt', async () => {
    const id = await usePromptStore.getState().saveTemplate(template())
    const host = await mount(id)
    await begin(host)
    await editSystem(host, 'AUTHOR_SYSTEM_CURRENT')
    await fill(host.querySelectorAll<HTMLTextAreaElement>('textarea')[1], 'AUTHOR_USER_CURRENT {{subject}}')
    const label = Array.from(host.querySelectorAll<HTMLInputElement>('input')).find(item => item.value === 'Tone')!
    expect(label).toBeTruthy()
    await fill(label, 'AUTHOR_PARAMETER_CURRENT')
    await completeExample()
    await vi.waitFor(() => expect(host.textContent).toContain('AI_SYNTHETIC_EXAMPLE'))
    const saved = await save(host, id)
    expect(saved.systemPrompt).toBe('AUTHOR_SYSTEM_CURRENT')
    expect(saved.userPromptTemplate).toBe('AUTHOR_USER_CURRENT {{subject}}')
    expect(saved.parameters?.[0].label).toBe('AUTHOR_PARAMETER_CURRENT')
    expect(saved.examples?.good?.map(example => example.text)).toEqual(['GOOD_ORIGINAL', 'AI_SYNTHETIC_EXAMPLE'])
    expect(requests).toHaveLength(1)
  })

  it('manual additions and deletion stay current on both sides of the late AI continuation', async () => {
    const id = await usePromptStore.getState().saveTemplate(template())
    const host = await mount(id)
    await begin(host)
    const original = host.querySelector<HTMLPreElement>('pre[title="GOOD_ORIGINAL"]')!
    await act(async () => original.parentElement!.querySelector<HTMLButtonElement>('button')!.click())
    expect(host.querySelector('pre[title="GOOD_ORIGINAL"]')).toBeNull()
    await openManual(host, 'good', 'MANUAL_BEFORE')
    await act(async () => button(host, '确认').click())
    await openManual(host, 'bad', 'BAD_BEFORE')
    await act(async () => button(host, '确认').click())
    await openManual(host, 'good', 'MANUAL_AFTER')
    await completeExample()
    await vi.waitFor(() => expect(host.textContent).toContain('AI_SYNTHETIC_EXAMPLE'))
    await act(async () => button(host, '确认').click())
    const saved = await save(host, id)
    expect(saved.examples?.good?.map(example => example.text)).toEqual(['MANUAL_BEFORE', 'AI_SYNTHETIC_EXAMPLE', 'MANUAL_AFTER'])
    expect(saved.examples?.bad?.map(example => example.text)).toEqual(['BAD_BEFORE'])
    expect(requests).toHaveLength(1)
  })

  for (const backToA of [false, true]) {
    it(`actual Manager selection cancels old A without granting a later view: return to A = ${backToA}`, async () => {
      const a = await usePromptStore.getState().saveTemplate(template({ name: '107_TEMPLATE_A' }))
      const b = await usePromptStore.getState().saveTemplate(template({ name: '107_TEMPLATE_B', systemPrompt: 'B_SYSTEM' }))
      const host = await mountElement(createElement(PromptManagerPanel))
      await selectTemplate(host, '107_TEMPLATE_A')
      const old = await begin(host)
      await selectTemplate(host, '107_TEMPLATE_B')
      await editSystem(host, 'B_AUTHOR_CURRENT')
      if (backToA) {
        await selectTemplate(host, '107_TEMPLATE_A')
        await editSystem(host, 'A_AUTHOR_AFTER_RETURN')
      }
      expect(old.signal?.aborted).toBe(true)
      const before = await snapshot()
      await releaseAndFlush(old.release, successfulResponse('OLD_A_RESULT'))
      expect(host.textContent).not.toContain('OLD_A_RESULT')
      expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value)
        .toBe(backToA ? 'A_AUTHOR_AFTER_RETURN' : 'B_AUTHOR_CURRENT')
      expect(await snapshot()).toEqual(before)
      const saved = await save(host, backToA ? a : b)
      expect(saved.systemPrompt).toBe(backToA ? 'A_AUTHOR_AFTER_RETURN' : 'B_AUTHOR_CURRENT')
      expect(saved.examples?.good?.map(example => example.text)).toEqual(['GOOD_ORIGINAL'])
      expect(requests).toHaveLength(1)
    })
  }

  it('a late failure from A cannot show an old error or end B’s current generation', async () => {
    const a = await usePromptStore.getState().saveTemplate(template({ name: '107_FAILURE_A' }))
    const b = await usePromptStore.getState().saveTemplate(template({ name: '107_CURRENT_B', systemPrompt: 'B_ORIGINAL' }))
    const originalA = await db.promptTemplates.get(a)
    const host = await mountElement(createElement(PromptManagerPanel))
    await selectTemplate(host, '107_FAILURE_A')
    const old = await begin(host)
    await selectTemplate(host, '107_CURRENT_B')
    releaseResponse = undefined
    const current = await begin(host)
    await editSystem(host, 'B_PENDING_AUTHOR_TEXT')
    const before = await snapshot()
    await releaseAndFlush(old.release, new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.error(new Error('OLD_OWNER_FAILURE')) },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    expect(old.signal?.aborted).toBe(true)
    expect(current.signal?.aborted).toBe(false)
    expect(button(host, '停止生成')).toBeTruthy()
    expect(host.textContent).not.toContain('OLD_OWNER_FAILURE')
    expect(host.textContent).not.toContain('未将部分输出加入草稿')
    expect(await snapshot()).toEqual(before)
    await releaseAndFlush(current.release, successfulResponse('B_CURRENT_RESULT'))
    await vi.waitFor(() => expect(host.textContent).toContain('B_CURRENT_RESULT'))
    const saved = await save(host, b)
    expect(saved.systemPrompt).toBe('B_PENDING_AUTHOR_TEXT')
    expect(saved.examples?.good?.map(example => example.text)).toEqual(['GOOD_ORIGINAL', 'B_CURRENT_RESULT'])
    expect(await db.promptTemplates.get(a)).toEqual(originalA)
    expect(requests).toHaveLength(2)
  })

  for (const route of ['draft', 'saved'] as const) {
    it(`${route} module changes invalidate the old request and keep current dirty input`, async () => {
      const id = await usePromptStore.getState().saveTemplate(template())
      const host = await mount(id)
      const old = await begin(host)
      await editSystem(host, 'CURRENT_MODULE_AUTHOR_TEXT')
      if (route === 'draft') await selectModule(host, 'chapter.continue')
      else await act(async () => {
        const current = (await db.promptTemplates.get(id))!
        await usePromptStore.getState().saveTemplate({ ...current, moduleKey: 'chapter.continue' }, { expectedModuleKey: current.moduleKey })
      })
      expect(old.signal?.aborted).toBe(true)
      const before = await snapshot()
      await releaseAndFlush(old.release, successfulResponse('OLD_MODULE_RESULT'))
      expect(host.textContent).not.toContain('OLD_MODULE_RESULT')
      expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('CURRENT_MODULE_AUTHOR_TEXT')
      expect(await snapshot()).toEqual(before)
      if (route === 'draft') {
        const saved = await save(host, id)
        expect(saved.moduleKey).toBe('chapter.continue')
        expect(saved.systemPrompt).toBe('CURRENT_MODULE_AUTHOR_TEXT')
        expect(saved.isActive).toBe(false)
      } else {
        await act(async () => button(host, '保存 *').click())
        await vi.waitFor(() => expect(host.textContent).toContain('模板所属模块已在其他位置改变'))
        expect(await snapshot()).toEqual(before)
        expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('CURRENT_MODULE_AUTHOR_TEXT')
      }
    })
  }

  for (const completion of ['failed', 'unknown'] as const) {
    it(`an actual ${completion} partial stream never becomes examples or replaces author input`, async () => {
      const id = await usePromptStore.getState().saveTemplate(template())
      const host = await mount(id)
      const request = await begin(host)
      await editSystem(host, 'AUTHOR_TEXT_DURING_PARTIAL')
      const chunk = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'PARTIAL_NOT_A_COMPLETE_EXAMPLE' } }] })}\n\n`)
      const response = completion === 'unknown'
        ? new Response(chunk, { headers: { 'content-type': 'text/event-stream' } })
        : new Response(new ReadableStream<Uint8Array>({
          start(controller) { controller.enqueue(chunk) },
          pull(controller) { controller.error(new Error('SYNTHETIC_STREAM_READ_FAILURE')) },
        }), { headers: { 'content-type': 'text/event-stream' } })
      const before = await snapshot()
      await releaseAndFlush(request.release, response)
      await vi.waitFor(() => expect(host.textContent).toContain('未将部分输出加入草稿'))
      expect(host.textContent).not.toContain('PARTIAL_NOT_A_COMPLETE_EXAMPLE')
      expect(await snapshot()).toEqual(before)
      const saved = await save(host, id)
      expect(saved.systemPrompt).toBe('AUTHOR_TEXT_DURING_PARTIAL')
      expect(saved.examples?.good?.map(example => example.text)).toEqual(['GOOD_ORIGINAL'])
      expect(requests).toHaveLength(1)
    })
  }

  it('explicit stop keeps all edits and ignores even a successful late response', async () => {
    const id = await usePromptStore.getState().saveTemplate(template())
    const host = await mount(id)
    const old = await begin(host)
    await editSystem(host, 'AUTHOR_STOPPED_TEXT')
    await act(async () => button(host, '停止生成').click())
    expect(old.signal?.aborted).toBe(true)
    await releaseAndFlush(old.release, successfulResponse('STOPPED_LATE_RESULT'))
    expect(host.textContent).not.toContain('STOPPED_LATE_RESULT')
    const saved = await save(host, id)
    expect(saved.systemPrompt).toBe('AUTHOR_STOPPED_TEXT')
    expect(saved.examples?.good?.map(example => example.text)).toEqual(['GOOD_ORIGINAL'])
    expect(requests).toHaveLength(1)
  })

  it('late completion of stopped N cannot stop or reset the current N+1 request', async () => {
    const id = await usePromptStore.getState().saveTemplate(template())
    const host = await mount(id)
    const old = await begin(host)
    await act(async () => button(host, '停止生成').click())
    releaseResponse = undefined
    const current = await begin(host)
    await editSystem(host, 'AUTHOR_WITH_CURRENT_REQUEST')
    await releaseAndFlush(old.release, successfulResponse('OLD_STOPPED_OUTPUT'))
    expect(current.signal?.aborted).toBe(false)
    expect(button(host, '停止生成')).toBeTruthy()
    expect(button(host, 'AI 生成').disabled).toBe(true)
    expect(host.textContent).not.toContain('OLD_STOPPED_OUTPUT')
    await releaseAndFlush(current.release, successfulResponse('CURRENT_REQUEST_OUTPUT'))
    await vi.waitFor(() => expect(host.textContent).toContain('CURRENT_REQUEST_OUTPUT'))
    const saved = await save(host, id)
    expect(saved.systemPrompt).toBe('AUTHOR_WITH_CURRENT_REQUEST')
    expect(saved.examples?.good?.map(example => example.text)).toEqual(['GOOD_ORIGINAL', 'CURRENT_REQUEST_OUTPUT'])
    expect(requests).toHaveLength(2)
  })

  it('unmount aborts local example work and late success cannot persist a candidate', async () => {
    const id = await usePromptStore.getState().saveTemplate(template())
    const host = await mount(id)
    const old = await begin(host)
    await editSystem(host, 'UNSAVED_CLOSED_TEXT')
    const before = await snapshot()
    const owner = mounted.pop()!
    await act(async () => owner.root.unmount())
    owner.host.remove()
    expect(old.signal?.aborted).toBe(true)
    await releaseAndFlush(old.release, successfulResponse('CLOSED_VIEW_OUTPUT'))
    expect(await snapshot()).toEqual(before)
    const reopened = await mount(id)
    expect(reopened.textContent).not.toContain('CLOSED_VIEW_OUTPUT')
    expect(reopened.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('ORIGINAL_SYSTEM')
    expect(requests).toHaveLength(1)
  })

  it('StrictMode retains a new current edit and complete example without duplicate requests', async () => {
    const id = await usePromptStore.getState().saveTemplate(template())
    const host = await mount(id, true)
    await begin(host)
    await editSystem(host, 'STRICT_AUTHOR_CURRENT')
    await completeExample()
    await vi.waitFor(() => expect(host.textContent).toContain('AI_SYNTHETIC_EXAMPLE'))
    const saved = await save(host, id)
    expect(saved.systemPrompt).toBe('STRICT_AUTHOR_CURRENT')
    expect(saved.examples?.good).toHaveLength(2)
    expect(requests).toHaveLength(1)
  })
})
