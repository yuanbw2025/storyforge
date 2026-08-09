import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CharacterDrivenPlan, Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  submitTargetedRequest: vi.fn(async () => undefined),
  updateCandidate: vi.fn(async () => undefined),
  adoptCandidate: vi.fn(async () => true),
  rejectCandidate: vi.fn(async () => true),
  loadOutline: vi.fn(async () => undefined),
  confirm: vi.fn(async () => true),
  snapshot: null as any,
}))

vi.mock('../../src/stores/character', () => ({
  useCharacterStore: (selector: (state: any) => unknown) => selector({
    characters: [{
      id: 7,
      name: '林舟',
      roleWeight: 'main',
      moralAxis: 'good',
      orderAxis: 'neutral',
    }],
  }),
}))

vi.mock('../../src/stores/outline', () => ({
  useOutlineStore: (selector: (state: any) => unknown) => selector({ loadAll: mocks.loadOutline }),
}))

vi.mock('../../src/components/shared/Dialog', () => ({
  useDialog: () => ({ confirm: mocks.confirm }),
}))

vi.mock('../../src/lib/story-planning/character-revision', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/story-planning/character-revision')>()
  return {
    ...actual,
    buildCharacterRevisionSnapshot: vi.fn(async () => mocks.snapshot),
  }
})

import CharacterRevisionPanel from '../../src/components/outline/CharacterRevisionPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project = {
  id: 1,
  name: '旧城作品',
  genre: 'fantasy',
  genres: ['fantasy'],
  activeWorldId: 11,
  activeWorkId: 12,
  enableMultiWorld: false,
} as Project

const plan = {
  id: 42,
  projectId: 1,
  workId: 12,
  name: '林舟调查线',
  arcs: JSON.stringify([{
    characterId: 7,
    name: '林舟',
    role: '主角',
    initialState: '逃避旧案',
    targetState: '主动调查',
  }]),
  userHint: '服务守城主线',
  generatedVolumes: '[]',
  status: 'draft',
  version: 1,
  parentPlanId: null,
  createdAt: 1,
  updatedAt: 1,
} as CharacterDrivenPlan

function revisionSnapshot() {
  return {
    projectId: 1,
    workspaceScope: { projectId: 1, worldId: 11, workId: 12 },
    chapters: [
      {
        outlineNodeId: 101,
        chapterId: 201,
        ordinal: 1,
        title: '旧城门',
        summary: '林舟立下承诺。',
        volumeTitle: '第一卷',
        worldGroupId: null,
        written: true,
        wordCount: 100,
        outlineUpdatedAt: 1,
      },
      {
        outlineNodeId: 102,
        chapterId: 202,
        ordinal: 2,
        title: '旧案浮现',
        summary: '林舟发现线索。',
        volumeTitle: '第一卷',
        worldGroupId: null,
        written: false,
        wordCount: 0,
        outlineUpdatedAt: 1,
      },
    ],
    lastWrittenOrdinal: 1,
    lastWrittenChapterId: 201,
    writtenChapterCount: 1,
    plannedChapterCount: 2,
    hasChapterMemory: true,
    anomalies: [],
  }
}

function taskRequest() {
  return {
    planId: 42,
    changeType: 'revise-arc' as const,
    characterId: 7,
    characterName: '林舟',
    changeDescription: '让林舟主动调查旧案。',
    protectedThroughOrdinal: 1,
    transitionChapterCount: 1,
    strategy: 'balanced' as const,
    anchorNodeIds: [],
    extraRequirements: '',
  }
}

function candidatePlan() {
  const option = (id: 'light' | 'balanced' | 'deep') => ({
    id,
    intensity: id,
    label: { light: '轻量融入', balanced: '中度改线', deep: '深度重构' }[id],
    summary: `${id} 方案`,
    risks: [],
    patches: id === 'balanced' ? [{
      outlineNodeId: 102,
      proposedTitle: '旧案回声',
      proposedSummary: '故人带来新证据，林舟决定主动追查。',
      reason: '在已写区之后自然推进。',
    }] : [],
  })
  return {
    changeSummary: '角色弧光从逃避改为主动调查。',
    scopeSummary: '第一章保护，第二章可调整。',
    affectedWrittenChapters: [],
    immutableFacts: [],
    conflicts: [],
    foreshadowSuggestions: [],
    mainPlotSuggestion: '主线不变。',
    options: [option('light'), option('balanced'), option('deep')],
    warnings: [],
  }
}

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderPanel(copilot: any) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(CharacterRevisionPanel, {
    project,
    plan,
    copilot,
    onSwitchToPlanning: vi.fn(),
  })))
  await act(async () => undefined)
  return host
}

function baseCopilot(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  }
}

function changeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
}

beforeEach(() => {
  mocks.snapshot = revisionSnapshot()
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS36 · 中途重规划面板接入 outline.character-revision Skill', () => {
  it('生成按钮只提交冻结保护边界与方案的定向 durable 任务', async () => {
    const host = await renderPanel(baseCopilot())
    const description = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder^="写清新旧弧光差异"]',
    )!
    await act(async () => changeValue(description, '让林舟主动调查旧案，但保留第一章承诺。'))
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(item => item.textContent?.includes('分析影响并生成三档方案'))!
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(mocks.submitTargetedRequest).toHaveBeenCalledWith(
      expect.stringContaining('生成三档可审查方案'),
      expect.objectContaining({
        agentId: 'outline',
        skillId: 'outline.character-revision',
        characterRevisionRequest: expect.objectContaining({
          planId: 42,
          characterId: 7,
          protectedThroughOrdinal: 1,
          strategy: 'balanced',
        }),
      }),
    )
  })

  it('刷新候选恢复为结构化方案，应用时先固化作者选择再采纳，拒绝不写正式数据', async () => {
    const baseSnapshot = {
      serialized: 'snapshot-v1',
      revision: revisionSnapshot(),
      request: taskRequest(),
      planId: 42,
    }
    const candidate = {
      event: {
        id: 77,
        content: JSON.stringify({ version: 1, plan: candidatePlan(), decision: null }),
      },
      payload: {
        skillId: 'outline.character-revision',
        characterRevisionRequest: taskRequest(),
        baseSnapshot,
        label: '角色变更影响与未来大纲修订',
        contextSources: ['manualText', 'storyCore'],
      },
    }
    const host = await renderPanel(baseCopilot({ pendingCandidates: [candidate] }))
    expect(host.textContent).toContain('影响分析结果')
    expect(host.textContent).toContain('旧案回声')
    const apply = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(item => item.textContent?.includes('应用选中 patch 到未写大纲'))!
    await act(async () => apply.click())
    expect(mocks.updateCandidate).toHaveBeenCalledWith(77, expect.stringContaining('"optionId": "balanced"'))
    expect(mocks.updateCandidate).toHaveBeenCalledWith(77, expect.stringContaining('102'))
    expect(mocks.adoptCandidate).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({ content: expect.stringContaining('"optionId": "balanced"') }),
    }))
    expect(mocks.loadOutline).toHaveBeenCalled()
    expect(host.textContent).toContain('已应用 1 项')

    const reject = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .find(item => item.textContent?.includes('拒绝本次方案'))!
    mocks.rejectCandidate.mockResolvedValueOnce(false)
    await act(async () => reject.click())
    expect(mocks.rejectCandidate).toHaveBeenCalledWith(candidate)
    expect(host.textContent).not.toContain('本次角色重规划候选已拒绝')

    await act(async () => reject.click())
    expect(host.textContent).toContain('本次角色重规划候选已拒绝')
  })
})
