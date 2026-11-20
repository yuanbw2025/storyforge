import { INSPIRATION_PREPARATION_MODES, INSPIRATION_PREPARATION_LABELS, INSPIRATION_PREPARATION_MODULES } from '../../src/lib/inspiration/preparation-contract'
import { usePromptStore } from '../../src/stores/prompt'
import { INSPIRATION_PREPARATION_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-preparation'
import { ToastProvider } from '../../src/components/shared/Toast'
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

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  await act(async () => root.render(createElement(ToastProvider, null, createElement(InspirationPanel, { project }))))
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
    action: 'full', setAction: vi.fn(), preparationResult: null,
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
  usePromptStore.setState({ templates: INSPIRATION_PREPARATION_PROMPT_SEEDS.map((seed, i) => ({ ...seed, id: i + 700, createdAt: 1, updatedAt: 1 })) })
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
  it.each(INSPIRATION_PREPARATION_MODES)('%s功能显示同模块激活模板，本次修改传给生成而不改库', async mode => {
    mocks.fusion = { ...createFusionState(), mode, action: mode }
    const active = usePromptStore.getState().getActive(INSPIRATION_PREPARATION_MODULES[mode])
    const before = active.systemPrompt
    const host = await renderPanel()
    expect(host.textContent).toContain(active.name)
    const current = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('当前模板：'))!
    await act(async () => current.click())
    const details = [...host.querySelectorAll('details')].find(item => item.querySelector('summary')?.textContent?.includes('高级：临时修改'))!
    await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle')) })
    const system = details.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(system, '本轮可见System修改')
      system.dispatchEvent(new Event('input', { bubbles: true }))
      const user = details.querySelectorAll('textarea')[1]
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(user, '本轮可见User修改')
      user.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const generate = [...host.querySelectorAll('button')].find(button => button.textContent?.trim() === INSPIRATION_PREPARATION_LABELS[mode])!
    await act(async () => generate.click())
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ moduleKey: INSPIRATION_PREPARATION_MODULES[mode], systemOverride: '本轮可见System修改', userOverride: '本轮可见User修改' }))
    expect(usePromptStore.getState().getActive(INSPIRATION_PREPARATION_MODULES[mode]).systemPrompt).toBe(before)
  })

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
    action: 'full', setAction: vi.fn(), preparationResult: null,
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
  it('展示可读的轻量准备与确认入口，不显示完整反推采纳控件', async () => {
    mocks.fusion.action = 'organize'; mocks.fusion.mode = 'organize'
    mocks.fusion.preparationResult = { summary: '保留南枝的铃壳', authorMaterial: '南枝、铃壳', proposals: [{ title: '邻家生活', content: '只深入门边的声音' }], openQuestions: [] }
    const host = await renderPanel()
    expect(host.querySelector('[aria-label="灵感准备结果"]')?.textContent).toContain('保留南枝的铃壳')
    expect(host.querySelector('[data-testid="single-result"]')).toBeNull()
    const select = host.querySelector<HTMLSelectElement>('[aria-label="灵感任务"]')!
    await act(async () => { select.value = 'deepen'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(mocks.fusion.setAction).toHaveBeenCalledWith('deepen')
    expect(host.textContent).toContain('不自动创建世界、人物或完整大纲')
  })

  it('定位比较可显式选择一项，并保留作者补充要求', async () => {
    mocks.fusion.action = 'position-open'; mocks.fusion.mode = 'position-open'
    mocks.fusion.userHint = '3万字一次成稿，不写大阴谋。'
    mocks.fusion.preparationResult = { summary: '两种定位', authorMaterial: '作者的书店', proposals: [{ title: '手艺与委托', content: '手艺生活' }, { title: '关系与归客', content: '邻里往来' }], openQuestions: [] }
    const host = await renderPanel()
    expect(host.textContent).toContain('创作定位·方向未定')
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')].filter(button => button.textContent?.includes('采用此定位继续深化'))
    await act(async () => buttons[1].click())
    expect(mocks.fusion.setAction).toHaveBeenCalledWith('position-defined')
    expect(mocks.fusion.setUserHint).toHaveBeenCalledWith(expect.stringContaining('灵感方向选择=2'))
    expect(mocks.fusion.setUserHint).toHaveBeenCalledWith(expect.stringContaining('3万字一次成稿，不写大阴谋。'))
  })

})
