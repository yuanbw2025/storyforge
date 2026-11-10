import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import PromptManagerPanel from '../../src/components/settings/prompt/PromptManagerPanel'
import PromptTemplateEditor from '../../src/components/settings/prompt/PromptTemplateEditor'
import WorkflowRunner from '../../src/components/settings/prompt/WorkflowRunner'
import PromptRunPanel from '../../src/components/shared/PromptRunPanel'
import AIStreamOutput from '../../src/components/shared/AIStreamOutput'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { db } from '../../src/lib/db/schema'
import { renderPrompt } from '../../src/lib/ai/prompt-engine'
import { assembleBoundPrompt, promptTemplateMatchesWork } from '../../src/lib/ai/prompt-variable-bindings'
import { buildChapterContentRequestV1 } from '../../src/lib/ai/adapters/chapter-adapter'
import {
  decodePromptTemplateExchange, encodePromptTemplateExchange,
} from '../../src/lib/ai/prompt-template-exchange'
import { PROMPT_MODULE_KEYS, type PromptModuleKey, type PromptTemplate } from '../../src/lib/types/prompt'
import type { ChatMessage, PromptWorkflow, PromptWorkflowStep } from '../../src/lib/types'
import { createLinearWorkflowGraph } from '../../src/lib/workflow/graph'
import { usePromptStore } from '../../src/stores/prompt'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

// Only the final transport capability is synthetic. The actual Runner, input
// binding, renderer and GenerationNode still execute their production code.
const transport = vi.hoisted(() => ({ start: vi.fn(async (_messages: ChatMessage[]) => 'SYNTHETIC_WORKFLOW_DRAFT') }))
vi.mock('../../src/hooks/useAIStream', () => ({
  useAIStream: () => ({ start: transport.start, output: '', isStreaming: false, error: null, tokenUsage: null }),
}))

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

function template(patch: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    scope: 'user', moduleKey: 'chapter.content', promptType: 'custom-author-task',
    name: '作者模板', description: '', systemPrompt: '  原始系统\n{{tone}}  ',
    userPromptTemplate: 'subject {{subject}} / {{count}} / {{enabled}}',
    variables: ['subject', 'tone', 'count', 'enabled'],
    modelOverride: { temperature: 0, maxTokens: 128 }, isDefault: false,
    parameters: [
      { key: 'tone', label: 'Tone', type: 'select', default: 'exact', options: ['exact', 'warm'], optional: false, description: '' },
      { key: 'count', label: 'Count', type: 'number', default: 0, min: 0, max: 10, step: 1 },
      { key: 'enabled', label: 'Enabled', type: 'boolean', default: false, optional: true },
      { key: 'length', label: 'Length', type: 'slider', default: 2, min: 0, max: 10, maxFromModelOutput: false },
      { key: 'extra', label: 'Extra', type: 'text', default: '' },
    ],
    examples: {
      good: [{ id: 'g1', text: '  GOOD\nORIGINAL  ', source: 'user-marked', rating: 5, note: '', createdAt: 0 }],
      bad: [{ id: 'b1', text: 'BAD_ORIGINAL', source: 'ai-generated', rating: 1, note: 'avoid', createdAt: 1 }],
    },
    lengthMode: 'long', continuityMode: 'off', genres: ['general'], assetId: 'AUDIT-TEMPLATE',
    variableBindings: [{ variable: 'subject', label: '材料', required: true, manual: true, description: '', placeholder: '完整材料' }],
    applicability: { lengthModes: ['long'], serializationModes: ['standalone'], genres: ['general'] },
    isActive: false, createdAt: 1, updatedAt: 1, ...patch,
  }
}

// The comparison oracle strips only the six explicitly local metadata fields.
// It does not invoke the codec under test or enumerate its functional whitelist.
function content({ id: _id, scope: _scope, isActive: _active, parentId: _parent,
  createdAt: _created, updatedAt: _updated, ...value }: PromptTemplate) {
  return value
}

async function mount(element: ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(DialogProvider, null, createElement(ToastProvider, null, element))))
  return host
}

function button(host: HTMLElement, label: string) {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === label)
  expect(found, label).toBeTruthy()
  return found!
}

async function click(host: HTMLElement, label: string) {
  await act(async () => { button(host, label).click() })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

async function editSystem(host: HTMLElement, value: string) {
  const field = host.querySelector<HTMLTextAreaElement>('textarea')!
  expect(field).toBeTruthy()
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(field.value).toBe(value)
}

async function selectModule(host: HTMLElement, moduleKey: PromptModuleKey) {
  const field = host.querySelector<HTMLSelectElement>('select')!
  await act(async () => { field.value = moduleKey; field.dispatchEvent(new Event('change', { bubbles: true })) })
  expect(field.value).toBe(moduleKey)
}

function ConnectedEditor({ id }: { id: number }) {
  const row = usePromptStore(state => state.templates.find(item => item.id === id))
  return createElement(PromptTemplateEditor, { template: row ?? null, onChanged: () => {}, onDeleted: () => {} })
}

async function snapshot() {
  const result: Record<string, unknown[]> = {}
  for (const table of db.tables) result[table.name] = await table.toArray()
  return result
}

async function importFile(host: HTMLElement, json: string) {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!
  const file = new File([json], 'templates.json', { type: 'application/json' })
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network allowed') }))
  localStorage.clear()
  sessionStorage.clear()
  await db.delete()
  await db.open()
  usePromptStore.setState({ templates: [], loaded: true })
  transport.start.mockClear()
})

afterEach(async () => {
  for (const { host, root } of mounted.splice(0)) {
    await act(async () => root.unmount())
    host.remove()
  }
  expect(fetch).not.toHaveBeenCalled()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await db.delete()
})

describe('SFQA-106 global template exchange', () => {
  it('both real generator readers follow the exact type/const binding and reject false facts', () => {
    const parse = (source: string) => ts.createSourceFile('prompt.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    for (const script of ['scripts/generate-ai-manual.mjs', 'scripts/generate-project-metrics.mjs']) {
      const source = ts.createSourceFile(script, readFileSync(script, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
      const reader = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readPromptModuleKeys')
      expect(reader, script).toBeTruthy()
      const read: (sourceFile: ts.SourceFile) => string[] = runInNewContext(`(${reader!.getText(source)})`, { ts })
      expect(Array.from(read(parse("export type PromptModuleKey = 'a' | 'b'")))).toEqual(['a', 'b'])
      expect(Array.from(read(parse("export const KEYS = ['a', 'b'] as const; export type PromptModuleKey = typeof KEYS[number]")))).toEqual(['a', 'b'])
      const bad = [
        "export type PromptModuleKey = typeof MISSING[number]",
        "const KEYS = ['a'] as const; export type PromptModuleKey = typeof KEYS[number]",
        "export const OTHER = ['a']; export type PromptModuleKey = typeof KEYS[number]",
        "export const KEYS = ['a', ...OTHER] as const; export type PromptModuleKey = typeof KEYS[number]",
        "export const KEYS = ['a', getValue()] as const; export type PromptModuleKey = typeof KEYS[number]",
        "export const KEYS = ['a', 'a'] as const; export type PromptModuleKey = typeof KEYS[number]",
        "export const KEYS = [] as const; export type PromptModuleKey = typeof KEYS[number]",
        "// export const KEYS = ['a'];\nexport type PromptModuleKey = typeof KEYS[number]",
        "export const KEYS = ['a'] as const; export type PromptModuleKey = typeof KEYS[string]",
      ]
      for (const input of bad) expect(() => read(parse(input)), `${script}: ${input}`).toThrow()
      expect(Array.from(read(parse(readFileSync('src/lib/types/prompt.ts', 'utf8'))))).toEqual([...PROMPT_MODULE_KEYS])
    }
  })

  it('the actual Manager exports and imports all functional fields as a new inactive user copy', async () => {
    const id = await usePromptStore.getState().saveTemplate(template({ scope: 'system', isActive: true }))
    const before = await db.promptTemplates.get(id)
    let downloaded: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { downloaded = value as Blob; return 'blob:export' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const host = await mount(createElement(PromptManagerPanel))
    await click(host, '导出全部')
    const json = await downloaded!.text()
    await importFile(host, json)
    await vi.waitFor(async () => expect(await db.promptTemplates.count()).toBe(2))
    const imported = (await db.promptTemplates.toArray()).find(item => item.id !== id)!
    expect(content(imported)).toEqual(content(before!))
    expect(imported).toMatchObject({ scope: 'user', isActive: false })
    expect(imported.parentId).toBeUndefined()
    expect(imported.createdAt).toBeGreaterThan(1)
    expect(await db.promptTemplates.get(id)).toEqual(before)
  })

  it('single export uses the same codec and includes unsaved author text without saving or activating', async () => {
    const id = await usePromptStore.getState().saveTemplate(template())
    const before = await snapshot()
    let downloaded: Blob | undefined
    vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { downloaded = value as Blob; return 'blob:export' })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const host = await mount(createElement(ConnectedEditor, { id }))
    await editSystem(host, '  UNSAVED\nAUTHOR  ')
    await click(host, '导出')
    expect(decodePromptTemplateExchange(await downloaded!.text())).toEqual([
      content(template({ systemPrompt: '  UNSAVED\nAUTHOR  ' })),
    ])
    expect(await snapshot()).toEqual(before)
    expect(button(host, '保存 *').disabled).toBe(false)
  })

  it('legacy single/array files retain nested fields but never adopt local ids, parents, scope or activation', async () => {
    const id = await usePromptStore.getState().saveTemplate(template({ scope: 'system', isActive: true }))
    const original = (await db.promptTemplates.get(id))!
    const source = { ...original, parentId: id }
    expect(await usePromptStore.getState().importTemplates(JSON.stringify(source))).toBe(1)
    expect(await usePromptStore.getState().importTemplates(JSON.stringify([source]))).toBe(1)
    const rows = await db.promptTemplates.toArray()
    for (const copy of rows.filter(item => item.id !== id)) {
      expect(content(copy)).toEqual(content(source))
      expect(copy.scope).toBe('user')
      expect(copy.isActive).toBe(false)
      expect(copy.parentId).toBeUndefined()
    }
    expect(rows.find(item => item.id === id)).toEqual(original)
  })

  it('all current module keys, saved blank drafts and custom promptType survive exchange', () => {
    for (const moduleKey of PROMPT_MODULE_KEYS) {
      const source = template({ moduleKey, systemPrompt: '', userPromptTemplate: '', variables: [], examples: {}, parameters: [], genres: [] })
      expect(decodePromptTemplateExchange(encodePromptTemplateExchange([source]))).toEqual([content(source)])
    }
  })

  it('source/work bindings and every nested optional flag survive without changing their authority', () => {
    const source = template({
      isDefault: true,
      variableBindings: [
        { variable: 'canon', label: 'Canon', sourceKeys: ['characters'], workField: 'title',
          required: false, manual: false, placeholder: '', description: 'Registered source only' },
      ],
      continuityMode: 'required',
    })
    const [copy] = decodePromptTemplateExchange(encodePromptTemplateExchange([source]))
    expect(copy).toEqual(content(source))
    expect(copy.variableBindings?.[0]).toEqual(source.variableBindings?.[0])
    expect(copy.parameters).toEqual(source.parameters)
    expect(copy.examples).toEqual(source.examples)
  })

  it('the actual complete system seed library is exchangeable without losing optional fields', async () => {
    usePromptStore.setState({ loaded: false })
    await usePromptStore.getState().init()
    const seeds = await db.promptTemplates.toArray()
    expect(seeds.length).toBeGreaterThan(200)
    expect(decodePromptTemplateExchange(encodePromptTemplateExchange(seeds))).toEqual(seeds.map(content))
  })

  const invalid: Array<[string, (row: Record<string, unknown>) => void]> = [
    ['unknown field', row => { row.hiddenPermission = true }],
    ['unknown module', row => { row.moduleKey = 'unregistered.module' }],
    ['null core field', row => { row.systemPrompt = null }],
    ['null legacy default', row => { row.name = null }],
    ['bad variables', row => { row.variables = ['valid', 9] }],
    ['bad model override', row => { row.modelOverride = { apiKey: 'NOT_A_CREDENTIAL_FIELD' } }],
    ['bad temperature', row => { row.modelOverride = { temperature: 3 } }],
    ['bad maxTokens', row => { row.modelOverride = { maxTokens: -1 } }],
    ['bad parameter', row => { row.parameters = [{ key: 'x', label: 'X', type: 'unknown', default: '' }] }],
    ['bad parameter range', row => { row.parameters = [{ key: 'x', label: 'X', type: 'number', default: 0, min: 2, max: 1 }] }],
    ['bad example', row => { row.examples = { good: [{ id: 'e', text: 'x', source: 'unknown', createdAt: 1 }] } }],
    ['bad binding', row => { row.variableBindings = [{ variable: 'x', label: 'X', workField: 'apiKey' }] }],
    ['bad binding flags', row => { row.variableBindings = [{ variable: 'x', label: 'X', required: 'yes' }] }],
    ['bad applicability', row => { row.applicability = { serializationModes: ['unknown'] } }],
    ['bad continuity', row => { row.continuityMode = 'unknown' }],
    ['bad length', row => { row.lengthMode = 'chapter' }],
  ]
  for (const [label, corrupt] of invalid) it(`rejects ${label} visibly before any batch write`, async () => {
    await usePromptStore.getState().saveTemplate(template())
    const before = await snapshot()
    const bad: Record<string, unknown> = { ...template() }
    corrupt(bad)
    const host = await mount(createElement(PromptManagerPanel))
    await importFile(host, JSON.stringify([template(), bad]))
    await vi.waitFor(() => expect(host.textContent).toContain('导入失败'))
    expect(host.textContent).toContain('templates[1]')
    expect(await snapshot()).toEqual(before)
  })

  it('unsupported versions are rejected instead of reinterpreted as legacy templates', async () => {
    const future = { format: 'storyforge.prompt-templates', version: 2, templates: [] }
    await expect(usePromptStore.getState().importTemplates(JSON.stringify(future))).rejects.toThrow('version')
    expect(await db.promptTemplates.count()).toBe(0)
  })

  it('model output limit zero survives exchange and the actual prose consumer without admitting invalid numbers', async () => {
    const source = template({ modelOverride: { temperature: 0, maxTokens: 0 } })
    const id = await usePromptStore.getState().saveTemplate(source)
    await usePromptStore.getState().setActive(id)
    const originalRequest = buildChapterContentRequestV1('Title', 'Task', 'World', 'Cast', 'Ending')
    expect(originalRequest.modelOverride?.maxTokens).toBe(0)
    const json = encodePromptTemplateExchange([source])
    expect(decodePromptTemplateExchange(json)[0].modelOverride).toEqual(source.modelOverride)
    await usePromptStore.getState().importTemplates(json)
    const imported = (await db.promptTemplates.toArray()).find(item => item.id !== id)!
    expect(imported.modelOverride).toEqual(source.modelOverride)
    expect(renderPrompt(imported, { subject: 'AUTHOR_INPUT' }).modelOverride?.maxTokens).toBe(0)
    await usePromptStore.getState().setActive(imported.id!)
    expect(buildChapterContentRequestV1('Title', 'Task', 'World', 'Cast', 'Ending')).toEqual(originalRequest)
    for (const maxTokens of [-1, 0.5, Infinity, NaN]) {
      expect(() => encodePromptTemplateExchange([template({ modelOverride: { maxTokens } })])).toThrow('maxTokens')
    }
  })

  it('real native insertion failure rolls back the entire validated import batch', async () => {
    await usePromptStore.getState().saveTemplate(template({ isActive: true }))
    const before = await snapshot()
    let calls = 0
    const failSecond = () => { if (++calls === 2) throw new Error('NATIVE_IMPORT_FAILURE') }
    db.promptTemplates.hook('creating', failSecond)
    try {
      const host = await mount(createElement(PromptManagerPanel))
      await importFile(host, encodePromptTemplateExchange([template(), template({ name: 'second' })]))
      await vi.waitFor(() => expect(host.textContent).toContain('NATIVE_IMPORT_FAILURE'))
      expect(calls).toBe(2)
      expect(await snapshot()).toEqual(before)
    } finally { db.promptTemplates.hook('creating').unsubscribe(failSecond) }
  })

  it('real renderer, Work applicability and required bindings keep their original meaning', async () => {
    const source = template({ variableBindings: [
      { variable: 'subject', label: '材料', required: true, manual: true, placeholder: '完整材料' },
      { variable: 'title', label: '标题', workField: 'title', required: false },
    ] })
    await usePromptStore.getState().importTemplates(encodePromptTemplateExchange([source]))
    const imported = (await db.promptTemplates.toArray())[0]
    expect(renderPrompt(imported, { subject: 'TEST' }, { parameterValues: { tone: 'warm', count: 4, enabled: true } }))
      .toEqual(renderPrompt(source, { subject: 'TEST' }, { parameterValues: { tone: 'warm', count: 4, enabled: true } }))
    const created = await seedCurrentWorkspace('Prompt bindings', { genres: ['general'] })
    expect(promptTemplateMatchesWork(imported, created.work)).toBe(true)
    expect(promptTemplateMatchesWork(imported, { ...created.work, novelProfile: 'short' })).toBe(false)
    const missing = await assembleBoundPrompt({ template: imported, project: created.project, work: created.work })
    expect(missing.missingVariables).toEqual(['材料'])
    const supplied = await assembleBoundPrompt({ template: imported, project: created.project, work: created.work, manualValues: { subject: 'AUTHOR_INPUT' } })
    expect(supplied.missingVariables).toEqual([])
    expect(supplied.messages.map(item => item.content).join('\n')).toContain('AUTHOR_INPUT')
  })

  for (const supplied of [false, true]) it(`actual WorkflowRunner preserves its required-input gate and message fields: ${supplied}`, async () => {
    await usePromptStore.getState().importTemplates(encodePromptTemplateExchange([template()]))
    const imported = (await db.promptTemplates.toArray())[0]
    const steps: PromptWorkflowStep[] = [{ stepId: 'step', label: 'Exchange check', promptModuleKey: imported.moduleKey, templateId: imported.id,
      inputValues: supplied ? { subject: 'AUTHOR_INPUT' } : {}, parameterValues: { tone: 'warm', count: 4, enabled: true } }]
    const workflow: PromptWorkflow = { scope: 'user', name: 'Exchange check', description: '', steps, graph: createLinearWorkflowGraph(steps), createdAt: 1, updatedAt: 1 }
    const host = await mount(createElement(WorkflowRunner, { workflow, onClose: () => {} }))
    await click(host, '开始')
    if (!supplied) {
      await vi.waitFor(() => expect(host.textContent).toContain('请填写必填字段：材料'))
      expect(transport.start).not.toHaveBeenCalled()
    } else {
      await vi.waitFor(() => expect(transport.start).toHaveBeenCalledOnce())
      const sent = transport.start.mock.calls[0][0].map(item => item.content).join('\n')
      expect(sent).toContain('AUTHOR_INPUT')
      expect(sent).toContain('warm')
      expect(sent).toContain('GOOD\nORIGINAL')
      expect(sent).toContain('BAD_ORIGINAL')
    }
  })

  it('an imported chapter template retains the actual prose adapter output and continuity choice', async () => {
    const originalId = await usePromptStore.getState().saveTemplate(template())
    await usePromptStore.getState().setActive(originalId)
    const before = buildChapterContentRequestV1('Title', 'Task', 'World', 'Cast', 'Ending')
    await usePromptStore.getState().importTemplates(encodePromptTemplateExchange([template()]))
    const imported = (await db.promptTemplates.toArray()).find(item => item.id !== originalId)!
    await usePromptStore.getState().setActive(imported.id!)
    expect(buildChapterContentRequestV1('Title', 'Task', 'World', 'Cast', 'Ending')).toEqual(before)
  })
})

describe('SFQA-108 content and current activation', () => {
  for (const mode of ['inactive', 'already-active', 'activate-in-editor'] as const) it(`actual editor save ${mode}`, async () => {
    const system = await usePromptStore.getState().saveTemplate(template({ scope: 'system', isActive: true }))
    const id = await usePromptStore.getState().saveTemplate(template())
    if (mode === 'already-active') await usePromptStore.getState().setActive(id)
    const host = await mount(createElement(ConnectedEditor, { id }))
    if (mode === 'activate-in-editor') await click(host, '设为激活')
    await editSystem(host, 'EDITED_AFTER_ACTIVATION')
    await click(host, '保存 *')
    await vi.waitFor(async () => expect((await db.promptTemplates.get(id))?.systemPrompt).toBe('EDITED_AFTER_ACTIVATION'))
    expect((await db.promptTemplates.get(id))?.isActive).toBe(mode !== 'inactive')
    const active = usePromptStore.getState().getActive('chapter.content')
    expect(active.id).toBe(mode === 'inactive' ? system : id)
    expect(renderPrompt(active, { subject: 'subject' }).messages[0].content).toContain(mode === 'inactive' ? '原始系统' : 'EDITED_AFTER_ACTIVATION')
  })

  it('same-id external activation/reload preserves dirty text and cannot be undone by the old editor', async () => {
    const a = await usePromptStore.getState().saveTemplate(template({ name: 'A', isActive: true }))
    const b = await usePromptStore.getState().saveTemplate(template({ name: 'B' }))
    const host = await mount(createElement(ConnectedEditor, { id: a }))
    await editSystem(host, 'UNSAVED_AUTHOR_TEXT')
    await act(async () => { await usePromptStore.getState().setActive(b); await usePromptStore.getState().reload() })
    expect(host.querySelector('textarea')?.value).toBe('UNSAVED_AUTHOR_TEXT')
    expect(button(host, '保存 *').disabled).toBe(false)
    expect(button(host, '设为激活')).toBeTruthy()
    await click(host, '保存 *')
    expect((await db.promptTemplates.get(a))?.systemPrompt).toBe('UNSAVED_AUTHOR_TEXT')
    expect((await db.promptTemplates.get(a))?.isActive).toBe(false)
    expect((await db.promptTemplates.get(b))?.isActive).toBe(true)
    expect(usePromptStore.getState().getActive('chapter.content').id).toBe(b)
  })

  for (const active of [false, true]) it(`explicit module migration is inactive without changing other current choices: ${active}`, async () => {
    const a = await usePromptStore.getState().saveTemplate(template({ name: 'Moving', isActive: active }))
    const b = await usePromptStore.getState().saveTemplate(template({ name: 'Destination', moduleKey: 'chapter.continue', isActive: true }))
    const host = await mount(createElement(ConnectedEditor, { id: a }))
    await selectModule(host, 'chapter.continue')
    await click(host, '保存 *')
    await vi.waitFor(() => expect(host.textContent).toContain('已移到新模块，尚未激活'))
    expect(await db.promptTemplates.get(a)).toMatchObject({ moduleKey: 'chapter.continue', isActive: false })
    expect((await db.promptTemplates.get(b))?.isActive).toBe(true)
    expect(usePromptStore.getState().getActive('chapter.continue').id).toBe(b)
    await click(host, '设为激活')
    await vi.waitFor(() => expect(usePromptStore.getState().getActive('chapter.continue').id).toBe(a))
    expect((await db.promptTemplates.get(a))?.isActive).toBe(true)
    expect((await db.promptTemplates.get(b))?.isActive).toBe(false)
  })

  it('a stale active draft moving modules cannot revoke either external current choice', async () => {
    const a = await usePromptStore.getState().saveTemplate(template({ name: 'Moving', isActive: true }))
    const a2 = await usePromptStore.getState().saveTemplate(template({ name: 'Old-module choice' }))
    const b = await usePromptStore.getState().saveTemplate(template({ name: 'Destination', moduleKey: 'chapter.continue', isActive: true }))
    const host = await mount(createElement(ConnectedEditor, { id: a }))
    await act(async () => usePromptStore.getState().setActive(a2))
    await selectModule(host, 'chapter.continue')
    await click(host, '保存 *')
    expect(await db.promptTemplates.get(a)).toMatchObject({ moduleKey: 'chapter.continue', isActive: false })
    expect(usePromptStore.getState().getActive('chapter.content').id).toBe(a2)
    expect(usePromptStore.getState().getActive('chapter.continue').id).toBe(b)
  })

  it('an external same-id route change is a visible conflict and preserves the old editor draft', async () => {
    const id = await usePromptStore.getState().saveTemplate(template())
    const host = await mount(createElement(ConnectedEditor, { id }))
    await editSystem(host, 'AUTHOR_UNSAVED_OLD_ROUTE')
    await act(async () => {
      const current = (await db.promptTemplates.get(id))!
      await usePromptStore.getState().saveTemplate({ ...current, moduleKey: 'chapter.continue' }, { expectedModuleKey: 'chapter.content' })
    })
    const before = await snapshot()
    await click(host, '保存 *')
    await vi.waitFor(() => expect(host.textContent).toContain('所属模块已在其他位置改变'))
    expect(host.querySelector('textarea')?.value).toBe('AUTHOR_UNSAVED_OLD_ROUTE')
    expect(button(host, '保存 *').disabled).toBe(false)
    expect(await snapshot()).toEqual(before)
  })

  // Preserve the two independent actual Editor controls (probe 1a747f91),
  // reusing this file's public fixture/providers rather than a second harness.
  it('a stale editor cannot activate an externally moved route or revoke either current choice', async () => {
    const id = await usePromptStore.getState().saveTemplate(template({ name: 'Moving' }))
    const a = await usePromptStore.getState().saveTemplate(template({ name: 'Current A', isActive: true }))
    const b = await usePromptStore.getState().saveTemplate(template({ name: 'Current B', moduleKey: 'chapter.continue', isActive: true }))
    const host = await mount(createElement(ConnectedEditor, { id }))
    await editSystem(host, 'AUTHOR_UNSAVED_A')
    await act(async () => {
      const current = (await db.promptTemplates.get(id))!
      await usePromptStore.getState().saveTemplate({ ...current, moduleKey: 'chapter.continue' }, { expectedModuleKey: 'chapter.content' })
    })
    expect(host.querySelector('select')?.value).toBe('chapter.content')
    expect(await db.promptTemplates.get(id)).toMatchObject({ moduleKey: 'chapter.continue', isActive: false })
    const before = await snapshot()
    await click(host, '设为激活')
    await vi.waitFor(() => expect(host.textContent).toContain('所属模块已在其他位置改变'))
    expect(await snapshot()).toEqual(before)
    expect(host.querySelector('select')?.value).toBe('chapter.content')
    expect(host.querySelector('textarea')?.value).toBe('AUTHOR_UNSAVED_A')
    expect(button(host, '保存 *').disabled).toBe(false)
    expect(usePromptStore.getState().getActive('chapter.content').id).toBe(a)
    expect(usePromptStore.getState().getActive('chapter.continue').id).toBe(b)
  })

  it('an editor that saved its own move can activate the new route while preserving later dirty text', async () => {
    const id = await usePromptStore.getState().saveTemplate(template({ name: 'Moving' }))
    const a = await usePromptStore.getState().saveTemplate(template({ name: 'Current A', isActive: true }))
    const b = await usePromptStore.getState().saveTemplate(template({ name: 'Current B', moduleKey: 'chapter.continue', isActive: true }))
    const aBefore = await db.promptTemplates.get(a)
    const host = await mount(createElement(ConnectedEditor, { id }))
    await selectModule(host, 'chapter.continue')
    await click(host, '保存 *')
    await vi.waitFor(() => expect(host.textContent).toContain('已移到新模块，尚未激活'))
    await editSystem(host, 'AUTHOR_UNSAVED_OWN_B')
    await click(host, '设为激活')
    await vi.waitFor(async () => expect((await db.promptTemplates.get(id))?.isActive).toBe(true))
    expect(await db.promptTemplates.get(id)).toMatchObject({ moduleKey: 'chapter.continue', systemPrompt: template().systemPrompt })
    expect((await db.promptTemplates.get(b))?.isActive).toBe(false)
    expect(await db.promptTemplates.get(a)).toEqual(aBefore)
    expect(host.querySelector('select')?.value).toBe('chapter.continue')
    expect(host.querySelector('textarea')?.value).toBe('AUTHOR_UNSAVED_OWN_B')
    expect(button(host, '保存 *').disabled).toBe(false)
    expect(host.textContent).not.toContain('激活未执行')
    expect(usePromptStore.getState().getActive('chapter.continue').id).toBe(id)
  })

  it('unsaved module changes must be saved before activation and cannot affect the old route', async () => {
    const id = await usePromptStore.getState().saveTemplate(template({ name: 'Moving' }))
    await usePromptStore.getState().saveTemplate(template({ name: 'Current A', isActive: true }))
    await usePromptStore.getState().saveTemplate(template({ name: 'Current B', moduleKey: 'chapter.continue', isActive: true }))
    const host = await mount(createElement(ConnectedEditor, { id }))
    await editSystem(host, 'AUTHOR_UNSAVED_ROUTE_AND_TEXT')
    await selectModule(host, 'chapter.continue')
    const before = await snapshot()
    await click(host, '设为激活')
    await vi.waitFor(() => expect(host.textContent).toContain('请先保存模块变更'))
    expect(await snapshot()).toEqual(before)
    expect(host.querySelector('select')?.value).toBe('chapter.continue')
    expect(host.querySelector('textarea')?.value).toBe('AUTHOR_UNSAVED_ROUTE_AND_TEXT')
    expect(button(host, '保存 *').disabled).toBe(false)
  })

  it('explicit reactivation after a same-module external choice remains legal with dirty text', async () => {
    const a = await usePromptStore.getState().saveTemplate(template({ name: 'A', isActive: true }))
    const b = await usePromptStore.getState().saveTemplate(template({ name: 'B' }))
    const host = await mount(createElement(ConnectedEditor, { id: a }))
    await editSystem(host, 'AUTHOR_DIRTY_SAME_MODULE')
    await act(async () => usePromptStore.getState().setActive(b))
    await click(host, '设为激活')
    await vi.waitFor(() => expect(usePromptStore.getState().getActive('chapter.content').id).toBe(a))
    expect((await db.promptTemplates.get(b))?.isActive).toBe(false)
    expect(host.querySelector('textarea')?.value).toBe('AUTHOR_DIRTY_SAME_MODULE')
    expect(button(host, '保存 *').disabled).toBe(false)
    await click(host, '保存 *')
    await vi.waitFor(async () => expect((await db.promptTemplates.get(a))?.systemPrompt).toBe('AUTHOR_DIRTY_SAME_MODULE'))
    expect((await db.promptTemplates.get(a))?.isActive).toBe(true)
  })

  it('concurrent native activation choices cannot retain two active siblings', async () => {
    const a = await usePromptStore.getState().saveTemplate(template({ name: 'A' }))
    const b = await usePromptStore.getState().saveTemplate(template({ name: 'B' }))
    await Promise.all([usePromptStore.getState().setActive(a), usePromptStore.getState().setActive(b)])
    const selected = (await db.promptTemplates.toArray()).filter(item => item.isActive)
    expect(selected).toHaveLength(1)
    expect(selected[0].id).toBe(b)
  })

  it('content writes preserve current local identity and do not resurrect deleted templates', async () => {
    const parent = await usePromptStore.getState().saveTemplate(template({ scope: 'system', isActive: true }))
    const id = await usePromptStore.getState().cloneTemplate(parent)
    const current = (await db.promptTemplates.get(id))!
    await usePromptStore.getState().saveTemplate({ ...current, scope: 'system', parentId: undefined, createdAt: 999, isActive: true, systemPrompt: 'changed' })
    expect(await db.promptTemplates.get(id)).toMatchObject({ scope: 'user', parentId: parent, createdAt: current.createdAt, isActive: false, systemPrompt: 'changed' })
    await usePromptStore.getState().deleteTemplate(id)
    const before = await snapshot()
    await expect(usePromptStore.getState().saveTemplate(current)).rejects.toThrow('模板已删除')
    expect(await snapshot()).toEqual(before)
  })

  it('native save failure is visible and keeps the full dirty editor plus original DB rows', async () => {
    const id = await usePromptStore.getState().saveTemplate(template({ isActive: true }))
    const host = await mount(createElement(ConnectedEditor, { id }))
    await editSystem(host, 'UNSAVED_FAILURE_TEXT')
    const before = await snapshot()
    const rejectWrite = () => { throw new Error('NATIVE_CONTENT_FAILURE') }
    db.promptTemplates.hook('updating', rejectWrite)
    try {
      await click(host, '保存 *')
      await vi.waitFor(() => expect(host.textContent).toContain('NATIVE_CONTENT_FAILURE'))
      expect(host.querySelector('textarea')?.value).toBe('UNSAVED_FAILURE_TEXT')
      expect(button(host, '保存 *').disabled).toBe(false)
      expect(await snapshot()).toEqual(before)
    } finally { db.promptTemplates.hook('updating').unsubscribe(rejectWrite) }
  })

  it('native activation failure rolls back the old choice and reports the real error', async () => {
    await usePromptStore.getState().saveTemplate(template({ name: 'A', isActive: true }))
    const b = await usePromptStore.getState().saveTemplate(template({ name: 'B' }))
    const host = await mount(createElement(ConnectedEditor, { id: b }))
    const before = await snapshot()
    let calls = 0
    const rejectSecond = () => { if (++calls === 2) throw new Error('NATIVE_ACTIVATION_FAILURE') }
    db.promptTemplates.hook('updating', rejectSecond)
    try {
      await click(host, '设为激活')
      await vi.waitFor(() => expect(host.textContent).toContain('NATIVE_ACTIVATION_FAILURE'))
      expect(calls).toBe(2)
      expect(await snapshot()).toEqual(before)
    } finally { db.promptTemplates.hook('updating').unsubscribe(rejectSecond) }
  })

  it('the actual creation panel save-as remains a new inactive user template', async () => {
    const original = await usePromptStore.getState().saveTemplate(template({ scope: 'system', isActive: true }))
    const host = await mount(createElement(PromptRunPanel, {
      moduleKey: 'chapter.content', parameterValues: { tone: 'warm' }, onParamChange: () => {},
      systemOverride: 'OVERRIDE', onSystemOverrideChange: () => {}, userOverride: null, onUserOverrideChange: () => {}, defaultOpen: true,
    }))
    const saveAs = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.includes('另存'))!
    await act(async () => saveAs.click())
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog).toBeTruthy()
    const confirm = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(item => item.textContent?.trim() === '确认')!
    await act(async () => confirm.click())
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    await vi.waitFor(async () => expect(await db.promptTemplates.count()).toBe(2))
    const copy = (await db.promptTemplates.toArray()).find(item => item.id !== original)!
    expect(copy).toMatchObject({ scope: 'user', isActive: false, parentId: original, systemPrompt: 'OVERRIDE' })
    expect(copy.parameters?.find(item => item.key === 'tone')?.default).toBe('warm')
    expect(usePromptStore.getState().getActive('chapter.content').id).toBe(original)
  })

  it('the actual example marker preserves current activation and system identity', async () => {
    const id = await usePromptStore.getState().saveTemplate(template({ scope: 'system', isActive: true }))
    const host = await mount(createElement(AIStreamOutput, { output: 'AUTHOR_MARKED_OUTPUT', isStreaming: false, error: null, onStop: () => {}, onRetry: () => {}, moduleKey: 'chapter.content' }))
    await click(host, '好示例')
    await vi.waitFor(async () => expect((await db.promptTemplates.get(id))?.examples?.good).toHaveLength(2))
    expect(await db.promptTemplates.get(id)).toMatchObject({ scope: 'system', isActive: true })
    expect(renderPrompt((await db.promptTemplates.get(id))!, { subject: 'x' }).messages.map(item => item.content).join('\n')).toContain('AUTHOR_MARKED_OUTPUT')
  })
})
