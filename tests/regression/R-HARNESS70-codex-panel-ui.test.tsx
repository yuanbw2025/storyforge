import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  loadAll: vi.fn(async () => undefined),
  addCategory: vi.fn(), deleteCategory: vi.fn(), setCategoryHidden: vi.fn(), updateCategory: vi.fn(),
  addEntry: vi.fn(), updateEntry: vi.fn(), deleteEntry: vi.fn(),
  resolveScopeLike: vi.fn(async () => ({ projectId: 1, worldId: 11, workId: 12 })),
  generate: vi.fn(), readPending: vi.fn(), readRecoverable: vi.fn(), resume: vi.fn(),
  adopt: vi.fn(async () => ({ written: 1 })), abandon: vi.fn(async () => undefined),
  toastSuccess: vi.fn(), toastInfo: vi.fn(), toastError: vi.fn(),
}))

const category = {
  id: 21, projectId: 1, worldId: 11, domain: 'natural', parentId: null,
  name: '灵植草药', icon: '🌿', builtInKey: 'herb',
  fieldSchema: JSON.stringify([{ key: 'habitat', label: '生境', type: 'text' }]),
  hidden: false, order: 0, worldGroupId: null, createdAt: 1, updatedAt: 1,
}
const existingEntry = {
  id: 31, projectId: 1, worldId: 11, worldGroupId: 7, categoryId: 21,
  name: '旧潮草', icon: '🌿', summary: '', description: '', fields: '{}', refs: '{}', tags: '[]',
  importance: 1, order: 0, createdAt: 1, updatedAt: 1,
}

vi.mock('../../src/stores/codex', () => ({
  useCodexStore: () => ({
    categories: [category], entries: [existingEntry], loadAll: mocks.loadAll,
    addCategory: mocks.addCategory, deleteCategory: mocks.deleteCategory,
    setCategoryHidden: mocks.setCategoryHidden, updateCategory: mocks.updateCategory,
    addEntry: mocks.addEntry, updateEntry: mocks.updateEntry, deleteEntry: mocks.deleteEntry,
  }),
}))

vi.mock('../../src/stores/world-group', () => ({
  useWorldGroupStore: (selector: (state: unknown) => unknown) => selector({
    activeGroupId: 7,
    groups: [{ id: 7, projectId: 1, worldId: 11, name: '曜月界' }],
  }),
}))

vi.mock('../../src/stores/ai-config', () => ({
  useAIConfigStore: (selector: (state: unknown) => unknown) => selector({
    config: { provider: 'ollama', baseUrl: 'http://localhost:1234/v1', model: 'harness70-ui' },
  }),
}))

vi.mock('../../src/lib/ai/client', () => ({
  resolveRequestConfig: (config: Record<string, unknown>) => ({ config }),
}))

vi.mock('../../src/lib/world-engine/scope', () => ({ resolveScopeLike: mocks.resolveScopeLike }))
vi.mock('../../src/lib/agent/run/codex-extraction-durable', () => ({
  generateCodexExtractionCandidateV1: mocks.generate,
  readPendingCodexExtractionCandidateV1: mocks.readPending,
  readRecoverableCodexExtractionV1: mocks.readRecoverable,
  resumeCodexExtractionCandidateV1: mocks.resume,
  adoptCodexExtractionCandidateV1: mocks.adopt,
  abandonCodexExtractionV1: mocks.abandon,
}))
vi.mock('../../src/components/shared/Toast', () => ({
  useToast: () => ({ success: mocks.toastSuccess, info: mocks.toastInfo, error: mocks.toastError }),
}))
vi.mock('../../src/components/shared/Dialog', () => ({
  useDialog: () => ({ prompt: vi.fn(), confirm: vi.fn() }),
}))
vi.mock('../../src/components/codex/CodexCategoryFieldsEditor', () => ({ default: () => null }))
vi.mock('../../src/components/codex/CodexEntryDetail', () => ({ default: () => null }))

import CodexPanel from '../../src/components/codex/CodexPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project = {
  id: 1, activeWorldId: 11, activeWorkId: 12, enableMultiWorld: true,
  name: '潮汐纪', description: '', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
  targetWordCount: 80_000, createdAt: 1, updatedAt: 1,
} as Project
const scope = { projectId: 1, worldId: 11, workId: 12 }
const extracted = {
  name: '月栖花', icon: '🌱', summary: '随月潮发光', description: '退潮后成熟',
  fields: { habitat: '月潮湿地' }, tags: ['月潮'], importance: 3,
}
const request = { categoryId: 21, worldGroupId: 7, sourceText: '月栖花生于月潮湿地。', supplementTags: true }
const candidate = { entries: [extracted], plan: { request } }
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

function button(host: HTMLElement, label: string) {
  return Array.from(host.querySelectorAll('button'))
    .find(item => item.textContent?.includes(label)) as HTMLButtonElement
}

function setTextarea(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

async function renderPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(CodexPanel, {
    project, fixedDomain: 'natural', fixedCategoryKeys: ['herb'], embedded: true,
    extractionSourceText: request.sourceText,
  })))
  await vi.waitFor(() => expect(button(host, 'AI 从内容拆分词条')).toBeTruthy())
  await act(async () => button(host, 'AI 从内容拆分词条').click())
  await vi.waitFor(() => expect(mocks.readPending).toHaveBeenCalledWith({
    scope, categoryId: 21, worldGroupId: 7,
  }))
  return host
}

beforeEach(() => {
  mocks.readPending.mockResolvedValue(null)
  mocks.readRecoverable.mockResolvedValue(null)
  mocks.generate.mockResolvedValue({ snapshot: { run: { id: 70 } }, candidate })
  mocks.resume.mockResolvedValue({ snapshot: { run: { id: 70 } }, candidate })
  mocks.adopt.mockResolvedValue({ written: 1 })
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS70 · Codex durable 提取 UI', () => {
  it('一次生成只展示 durable 候选，作者确认子集后才统一采纳', async () => {
    const host = await renderPanel()
    expect(mocks.generate).not.toHaveBeenCalled()
    await act(async () => setTextarea(host.querySelector('textarea')!, request.sourceText))
    await act(async () => button(host, '开始拆分').click())

    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      scope,
      request,
    }))
    expect(host.textContent).toContain('月栖花')
    expect(mocks.adopt).not.toHaveBeenCalled()
    await act(async () => button(host, '写入所选 1 项').click())
    expect(mocks.adopt).toHaveBeenCalledWith({ scope, runId: 70, selectedIndexes: [0] })
    expect(mocks.addEntry).not.toHaveBeenCalled()
  })

  it('刷新恢复已确认选择时只沿同一意图续跑，不开放改选或否决', async () => {
    mocks.readPending.mockResolvedValue({
      snapshot: { run: { id: 71 } }, candidate, selectedIndexes: [0],
    })
    const host = await renderPanel()
    await vi.waitFor(() => expect(host.textContent).toContain('月栖花'))
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(host.querySelector('textarea')?.getAttribute('disabled')).not.toBeNull()
    expect(host.textContent).toContain('作者选择已冻结')
    expect(button(host, '否决并关闭')).toBeUndefined()
    expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true)
    await act(async () => button(host, '继续写入与终验').click())
    expect(mocks.adopt).toHaveBeenCalledWith({ scope, runId: 71, selectedIndexes: [0] })
    expect(mocks.abandon).not.toHaveBeenCalled()
  })

  it('安全分块可从下一块续跑而不重新生成', async () => {
    mocks.readRecoverable.mockResolvedValue({
      snapshot: { run: { id: 72 } }, nextCallIndex: 1, totalCalls: 3, safeToResume: true, request,
    })
    const host = await renderPanel()
    await vi.waitFor(() => expect(host.textContent).toContain('已恢复分块进度 1/3'))
    await act(async () => button(host, '继续提取').click())
    expect(mocks.resume).toHaveBeenCalledWith(expect.objectContaining({ scope, runId: 72 }))

    await act(async () => button(host, '否决并关闭').click())
    expect(mocks.abandon).toHaveBeenCalledWith({ scope, runId: 70 })
  })

  it('未知模型窗口不提供续跑，只允许作者显式放弃', async () => {
    mocks.readRecoverable.mockResolvedValue({
      snapshot: { run: { id: 74 } }, nextCallIndex: 1, totalCalls: 3, safeToResume: false, request,
    })
    const host = await renderPanel()
    await vi.waitFor(() => expect(host.textContent).toContain('系统不会自动重试'))
    expect(button(host, '继续提取')).toBeUndefined()
    expect(mocks.generate).not.toHaveBeenCalled()
    await act(async () => button(host, '放弃旧运行').click())
    expect(mocks.abandon).toHaveBeenCalledWith({ scope, runId: 74 })
  })

  it('零候选有可见确认入口，不会把运行锁死在弹窗中', async () => {
    mocks.generate.mockResolvedValue({ snapshot: { run: { id: 73 } }, candidate: { ...candidate, entries: [] } })
    const host = await renderPanel()
    await act(async () => button(host, '开始拆分').click())
    await vi.waitFor(() => expect(host.textContent).toContain('未识别出新增词条'))
    await act(async () => button(host, '确认无新增词条').click())
    expect(mocks.adopt).toHaveBeenCalledWith({ scope, runId: 73, selectedIndexes: [] })
  })
})
