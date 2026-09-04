import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  planStore: {} as any,
  copilot: {} as any,
  saveInputs: vi.fn(async () => undefined),
  loadPlans: vi.fn(async () => undefined),
  submitTargetedRequest: vi.fn(async () => undefined),
  updateCandidate: vi.fn(async () => undefined),
  adoptCandidate: vi.fn(async () => undefined),
  rejectCandidate: vi.fn(async () => undefined),
}))

vi.mock('../../src/stores/character', () => ({
  useCharacterStore: () => ({
    characters: [{
      id: 7,
      name: '林舟',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
      background: '逃避故乡',
      arc: '承担责任',
    }],
    loadAll: vi.fn(async () => undefined),
  }),
}))

vi.mock('../../src/stores/outline', () => ({
  useOutlineStore: () => ({ loadAll: vi.fn(async () => undefined) }),
}))

vi.mock('../../src/stores/character-driven-plan', () => ({
  useCharacterDrivenPlanStore: () => mocks.planStore,
}))

vi.mock('../../src/components/agent/useMasterCopilot', () => ({
  useMasterCopilot: () => mocks.copilot,
}))

vi.mock('../../src/components/shared/Dialog', () => ({
  useDialog: () => ({
    prompt: vi.fn(async () => null),
    confirm: vi.fn(async () => false),
  }),
}))

import CharacterDrivenPlotPanel from '../../src/components/outline/CharacterDrivenPlotPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project = {
  id: 1,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000000001',
  workspacePurpose: 'independent-work',
  name: '归途项目',
  activeWorldId: 11,
  activeWorkId: 12,
  enableMultiWorld: false,
  createdAt: 1,
  updatedAt: 1,
} as Project

const plan = {
  id: 42,
  projectId: 1,
  name: '归乡弧光',
  arcs: JSON.stringify([{
    characterId: 7,
    name: '林舟',
    role: '主角',
    initialState: '逃避故乡与旧案',
    targetState: '主动承担守护故乡的责任',
  }]),
  userHint: '必须服务既有主线',
  generatedVolumes: '[]',
  status: 'draft',
  version: 1,
  parentPlanId: null,
  createdAt: 1,
  updatedAt: 1,
}

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(CharacterDrivenPlotPanel, {
    project,
    worldGroupId: null,
  })))
  return { host, root }
}

function resetState() {
  mocks.planStore = {
    plans: [plan],
    currentPlanId: plan.id,
    activePlanId: null,
    loading: false,
    loadAll: mocks.loadPlans,
    selectPlan: vi.fn(),
    createPlan: vi.fn(async () => undefined),
    copyAsNewVersion: vi.fn(async () => undefined),
    renamePlan: vi.fn(async () => undefined),
    saveInputs: mocks.saveInputs,
    markAdopted: vi.fn(async () => undefined),
    setActivePlan: vi.fn(async () => undefined),
    deletePlan: vi.fn(async () => undefined),
  }
  mocks.copilot = {
    pendingCandidates: [],
    loading: false,
    busy: false,
    recoveryAvailable: false,
    error: null,
    submitTargetedRequest: mocks.submitTargetedRequest,
    updateCandidate: mocks.updateCandidate,
    adoptCandidate: mocks.adoptCandidate,
    rejectCandidate: mocks.rejectCandidate,
    resume: vi.fn(async () => undefined),
    stop: vi.fn(),
  }
}

beforeEach(() => resetState())

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS35 · 角色驱动面板接入 outline.character-driven Skill', () => {
  it('生成按钮保存作者输入后只提交固定方案的受治理任务', async () => {
    const { host } = await renderPanel()
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(item => item.textContent?.includes('生成剧情大纲'))!
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(mocks.saveInputs).toHaveBeenCalledWith(42, {
      arcs: [expect.objectContaining({
        characterId: 7,
        initialState: '逃避故乡与旧案',
        targetState: '主动承担守护故乡的责任',
      })],
      userHint: '必须服务既有主线',
    })
    expect(mocks.submitTargetedRequest).toHaveBeenCalledWith(
      expect.stringContaining('编排与既有主线一致的卷章方案'),
      expect.objectContaining({
        agentId: 'outline',
        skillId: 'outline.character-driven',
        characterDrivenPlanId: 42,
      }),
    )
  })

  it('刷新恢复的同方案候选可编辑、拒绝和保存，异方案候选不混入', async () => {
    const candidate = {
      event: {
        id: 77,
        content: JSON.stringify([{
          volumeTitle: '第一卷 归途',
          volumeSummary: '林舟回乡追查旧案。',
          characterArcs: '林舟从逃避转向承担。',
          chapters: [{
            title: '第一章 城门',
            summary: '林舟得知新证据。',
            keyCharacters: ['林舟'],
            arcProgress: '林舟决定调查。',
          }],
        }]),
      },
      payload: {
        skillId: 'outline.character-driven',
        characterDrivenPlanId: 42,
        label: '角色驱动卷章方案',
        contextSources: ['characterDrivenPlan', 'storyCore'],
        contextEvidence: {
          included: ['characterDrivenPlan', 'storyCore'],
          trimmed: [],
          estimatedInputTokens: 420,
        },
      },
    }
    mocks.copilot.pendingCandidates = [candidate, {
      ...candidate,
      event: { ...candidate.event, id: 78 },
      payload: { ...candidate.payload, characterDrivenPlanId: 99 },
    }]
    const { host } = await renderPanel()

    const editor = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="角色驱动卷章候选内容"]',
    )!
    expect(editor).not.toBeNull()
    expect(host.querySelectorAll('textarea[aria-label="角色驱动卷章候选内容"]')).toHaveLength(1)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        editor,
        editor.value.replace('归途', '返乡'),
      )
      editor.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(mocks.updateCandidate).toHaveBeenCalledWith(77, expect.stringContaining('返乡'))

    const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
    await act(async () => buttons.find(item => item.textContent?.includes('拒绝'))!.click())
    expect(mocks.rejectCandidate).toHaveBeenCalledWith(candidate)
    await act(async () => buttons.find(item => item.textContent?.includes('保存到当前方案'))!.click())
    expect(mocks.adoptCandidate).toHaveBeenCalledWith(candidate)
    expect(mocks.loadPlans).toHaveBeenCalled()
    expect(host.textContent).toContain('其它待确认候选')
  })
})
