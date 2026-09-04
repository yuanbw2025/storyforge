import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  fusion: {} as any,
  generate: vi.fn(async () => undefined),
  confirmFusion: vi.fn(async () => undefined),
  discardFusion: vi.fn(async () => undefined),
  updateCandidate: vi.fn(async () => undefined),
}))

vi.mock('../../src/hooks/useIncrementalInspiration', () => ({
  useIncrementalInspiration: () => mocks.fusion,
}))

vi.mock('../../src/stores/world-group', () => ({
  useWorldGroupStore: Object.assign(
    () => ({ enableMultiWorld: vi.fn(), loadAll: vi.fn() }),
    { getState: () => ({ groups: [] }) },
  ),
}))

vi.mock('../../src/components/shared/AIStreamOutput', () => ({
  default: () => createElement('div', { 'data-testid': 'ai-stream-output' }),
}))

vi.mock('../../src/components/shared/AutoResizeTextarea', () => ({
  default: ({ minRows: _minRows, ...props }: Record<string, unknown>) => (
    createElement('textarea', props)
  ),
}))

vi.mock('../../src/components/project/InspirationSingleResult', () => ({
  default: () => createElement('div', { 'data-testid': 'single-result' }),
}))

vi.mock('../../src/components/project/InspirationMultiWorldResult', () => ({
  default: () => createElement('div', { 'data-testid': 'multiworld-result' }),
}))

import InspirationPanel from '../../src/components/project/InspirationPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

const fragment = {
  id: 'idea-1',
  text: '旧城每次下雨都会忘记一个人',
  label: '城市规则',
  sourceKind: 'author',
  createdAt: 1,
}

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(InspirationPanel, { project })))
  return host
}

function createFusionState() {
  return {
    ai: {
      isStreaming: false,
      output: '',
      error: null,
      tokenUsage: undefined,
      stop: vi.fn(),
    },
    copilot: {
      pendingCandidates: [],
      loading: false,
      busy: false,
      recoveryAvailable: false,
      resume: vi.fn(async () => undefined),
      updateCandidate: mocks.updateCandidate,
    },
    isMultiWorld: false,
    mode: 'single',
    workspace: { fragments: [fragment], versions: [] },
    inspiration: '',
    setInspiration: vi.fn(),
    userHint: '',
    setUserHint: vi.fn(),
    result: null,
    mwResult: null,
    mwAdopted: false,
    setMwAdopted: vi.fn(),
    selectedChars: new Set<number>(),
    setSelectedChars: vi.fn(),
    fragmentLabel: '',
    setFragmentLabel: vi.fn(),
    sourceKind: 'author',
    setSourceKind: vi.fn(),
    selectedFragmentIds: new Set([fragment.id]),
    setSelectedFragmentIds: vi.fn(),
    pendingDiff: null,
    confirmingFusion: false,
    fusionError: '',
    addCurrentFragment: vi.fn(async () => fragment),
    generate: mocks.generate,
    confirmFusion: mocks.confirmFusion,
    discardFusion: mocks.discardFusion,
    removeFragment: vi.fn(async () => undefined),
    pendingCandidate: null,
  }
}

beforeEach(() => {
  mocks.fusion = createFusionState()
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS34 · 分步骤灵感面板接入 inspiration.reverse Skill', () => {
  it('反推按钮只调用受治理生成控制器', async () => {
    const host = await renderPanel()
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(item => item.textContent?.includes('开始反推'))!
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(mocks.generate).toHaveBeenCalledOnce()
  })

  it('刷新恢复的候选可编辑、拒绝和确认', async () => {
    const candidate = {
      event: {
        id: 77,
        content: JSON.stringify({
          worldview: { worldOrigin: '由遗忘诞生的旧城' },
          storyCore: { logline: '守塔人追查失踪者' },
          characters: [],
        }),
      },
      payload: {
        agentId: 'inspiration',
        skillId: 'inspiration.reverse',
        mode: 'single',
        contextEvidence: {
          included: ['inspirationWorkspace'],
          estimatedInputTokens: 320,
        },
      },
    }
    mocks.fusion.pendingCandidate = candidate
    mocks.fusion.copilot.pendingCandidates = [candidate]
    mocks.fusion.pendingDiff = []
    const host = await renderPanel()

    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="灵感反推候选内容"]')!
    expect(editor).not.toBeNull()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        editor,
        editor.value.replace('旧城', '镜城'),
      )
      editor.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(mocks.updateCandidate).toHaveBeenCalledWith(77, expect.stringContaining('镜城'))

    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    await act(async () => buttons.find(item => item.textContent?.includes('放弃本次结果'))!.click())
    expect(mocks.discardFusion).toHaveBeenCalledOnce()
    await act(async () => buttons.find(item => item.textContent?.includes('确认融合版本'))!.click())
    expect(mocks.confirmFusion).toHaveBeenCalledOnce()
  })
})
