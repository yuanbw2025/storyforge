import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  copilot: {
    pendingCandidates: [] as any[],
    loading: false,
    busy: false,
    error: null as string | null,
    submitRequest: vi.fn(async () => undefined),
    submitTargetedRequest: vi.fn(async () => undefined),
    updateCandidate: vi.fn(async () => undefined),
    rejectCandidate: vi.fn(async () => undefined),
    adoptCandidate: vi.fn(async () => undefined),
  },
  worldviewStore: {
    storyCore: {
      id: 7,
      projectId: 1,
      logline: '旧的一句话故事',
      concept: '',
      theme: '',
      centralConflict: '',
      plotPattern: '',
      mainPlot: '',
      subPlots: '',
      createdAt: 1,
      updatedAt: 1,
    } as any,
    saveStoryCore: vi.fn(async () => undefined),
    loadAll: vi.fn(async () => undefined),
  },
}))

vi.mock('../../src/components/agent/useMasterCopilot', () => ({
  useMasterCopilot: () => mocks.copilot,
}))

vi.mock('../../src/stores/worldview', () => ({
  useWorldviewStore: () => mocks.worldviewStore,
}))

vi.mock('../../src/stores/world-group', () => ({
  useWorldGroupStore: (selector: (state: { activeGroupId: number | null }) => unknown) => selector({ activeGroupId: null }),
}))

vi.mock('../../src/components/shared/PromptRunPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'prompt-run-panel' }),
}))

import StoryCorePanel from '../../src/components/worldview/StoryCorePanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

const project = {
  id: 1,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000000001',
  workspacePurpose: 'independent-work',
  name: '镜城纪事',
  enableMultiWorld: false,
  activeWorldId: 11,
  activeWorkId: 12,
  createdAt: 1,
  updatedAt: 1,
} as Project

function candidate(input: { field?: 'logline' | 'theme'; label?: string } = {}) {
  const field = input.field ?? 'logline'
  const label = input.label ?? '一句话故事'
  return {
    event: {
      id: 41,
      projectId: project.id!,
      kind: 'candidate',
      content: JSON.stringify({ field, value: `候选的${label}` }),
      payload: '{}',
    },
    payload: {
      version: 1,
      taskId: 'story-core-1',
      agentId: 'world-origin',
      skillId: 'world-origin.story-core',
      storyCoreField: field,
      label,
      contextSources: ['worldview', 'storyCore'],
      contextEvidence: {
        profile: 'balanced',
        inputBudgetTokens: 14_000,
        estimatedInputTokens: 628,
        included: ['worldview', 'storyCore'],
        omitted: [],
        trimmed: ['existingVolumeOutlines'],
      },
      baseSnapshot: {},
    },
  }
}

async function renderPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(StoryCorePanel, { project })))
  return host
}

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  mocks.copilot.pendingCandidates = []
  mocks.copilot.loading = false
  mocks.copilot.busy = false
  mocks.copilot.error = null
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS31 · 故事核心面板统一进入主 Agent Harness', () => {
  it('AI 生成提交 story-core 单字段请求，人工编辑仍经原 store 保存', async () => {
    const host = await renderPanel()
    const hint = host.querySelector<HTMLInputElement>('input[placeholder="补充提示（可选）"]')!
    await act(async () => setInputValue(hint, '强调父亲主动遗忘主角'))

    const generate = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('AI 生成'))!
    await act(async () => generate.click())
    expect(mocks.copilot.submitTargetedRequest).toHaveBeenCalledOnce()
    const [request, task] = mocks.copilot.submitTargetedRequest.mock.calls[0]
    expect(request).toContain('目标字段=logline')
    expect(request).toContain('生成模式=expand')
    expect(request).toContain('父亲主动遗忘主角')
    expect(task).toMatchObject({
      agentId: 'world-origin',
      skillId: 'world-origin.story-core',
      promptExecution: { version: 1, moduleKey: 'story.generate' },
    })

    const manualDisplay = Array.from(host.querySelectorAll('div.cursor-text'))
      .find(element => element.textContent === '旧的一句话故事')!
    await act(async () => manualDisplay.click())
    const manual = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="点击填写一句话故事…"]')!
    await act(async () => setInputValue(manual, '作者手写的一句话故事'))
    await act(async () => manual.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(mocks.worldviewStore.saveStoryCore).toHaveBeenCalledWith({
      projectId: project.id,
      logline: '作者手写的一句话故事',
    })
  })

  it('durable 候选可编辑、拒绝和采纳，采纳后回读正式故事核心', async () => {
    mocks.copilot.pendingCandidates = [candidate()]
    const host = await renderPanel()

    expect(host.textContent).toContain('待确认 · 一句话故事')
    expect(host.textContent).toContain('约 628 tokens')
    expect(host.textContent).toContain('本次实际输入证据')
    expect(host.textContent).toContain('因预算移除：existingVolumeOutlines')

    const editor = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="一句话故事候选内容"]',
    )!
    await act(async () => setInputValue(editor, '{"field":"logline","value":"作者修订候选"}'))
    expect(mocks.copilot.updateCandidate).toHaveBeenCalledWith(
      41,
      '{"field":"logline","value":"作者修订候选"}',
    )

    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent?.includes('拒绝'))!.click())
    expect(mocks.copilot.rejectCandidate).toHaveBeenCalledWith(mocks.copilot.pendingCandidates[0])
    await act(async () => buttons.find(button => button.textContent?.includes('采纳'))!.click())
    expect(mocks.copilot.adoptCandidate).toHaveBeenCalledWith(mocks.copilot.pendingCandidates[0])
    expect(mocks.worldviewStore.loadAll).toHaveBeenCalledWith(project.id, null)
    expect(mocks.worldviewStore.saveStoryCore).not.toHaveBeenCalledWith(expect.objectContaining({
      logline: '候选的一句话故事',
    }))
  })

  it('刷新恢复非首字段候选时自动定位并在导航中标记待确认状态', async () => {
    mocks.copilot.pendingCandidates = [candidate({ field: 'theme', label: '故事主题' })]
    const host = await renderPanel()

    await vi.waitFor(() => {
      expect(host.querySelector('textarea[aria-label="故事主题候选内容"]')).not.toBeNull()
    })
    expect(host.querySelector('[aria-label="故事主题有待确认候选"]')).not.toBeNull()
    expect(host.textContent).toContain('待确认 · 故事主题')
    expect(host.textContent).not.toContain('点击填写一句话故事')
  })
})
