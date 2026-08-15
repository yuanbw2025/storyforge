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
    submitRequest: vi.fn(),
    updateCandidate: vi.fn(),
    rejectCandidate: vi.fn(),
    adoptCandidate: vi.fn(),
  },
  storyArcStore: {
    arcs: [] as any[],
    activeArcId: null as number | null,
    loadAll: vi.fn(),
    setActiveArc: vi.fn(),
    addArc: vi.fn(async () => 1),
    updateArc: vi.fn(),
    deleteArc: vi.fn(),
    updateStages: vi.fn(),
  },
}))

vi.mock('../../src/components/agent/useMasterCopilot', () => ({
  useMasterCopilot: () => mocks.copilot,
}))

vi.mock('../../src/stores/story-arc', () => ({
  useStoryArcStore: () => mocks.storyArcStore,
}))

vi.mock('../../src/components/shared/Dialog', () => ({
  useDialog: () => ({
    alert: vi.fn(),
    confirm: vi.fn(async () => true),
    prompt: vi.fn(),
  }),
}))

import StoryArcPanel from '../../src/components/outline/StoryArcPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

const project = {
  id: 1,
  name: '潮汐纪元',
  genre: 'fantasy',
  genres: ['fantasy'],
  enableMultiWorld: false,
} as Project

function creativeArtifact(status: 'ready' | 'manual-repair') {
  return {
    version: 1,
    policyVersion: 'creative-reliability-v1',
    status,
    qualityMode: 'balanced',
    originalText: '{}',
    editableText: '[]',
    validFragments: [],
    rejectedFragments: [],
    issues: status === 'ready' ? [] : [{
      version: 1,
      code: 'story-arc-item-invalid',
      severity: 'error',
      disposition: 'repairable',
      path: '$[0]',
      message: '阶段数量不足，请补充到至少三个阶段。',
      suggestedAction: 'edit',
      evidenceRefs: [],
      deterministic: true,
    }],
    assumptions: [],
    canonEvidenceRefs: [],
    callEvidence: [{
      version: 1,
      callIndex: 1,
      purpose: 'generate',
      status: 'succeeded',
      provider: 'openai',
      model: 'test',
      usageSource: 'provider',
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      latencyMs: 120,
      estimatedCostUsd: null,
      outputHash: 'a'.repeat(64),
    }],
    repair: null,
  } as any
}

function candidate(status: 'ready' | 'manual-repair' = 'ready') {
  return {
    event: {
      id: 31,
      projectId: project.id!,
      kind: 'candidate',
      content: '[{"name":"潮汐钟主线"}]',
      payload: '{}',
    },
    payload: {
      version: 1,
      taskId: 'story-arcs-1',
      agentId: 'outline',
      skillId: 'outline.story-arcs',
      label: '主线故事线',
      contextSources: ['worldview', 'storyCore'],
      contextEvidence: {
        profile: 'balanced',
        inputBudgetTokens: 20_000,
        estimatedInputTokens: 712,
        included: ['worldview', 'storyCore'],
        trimmed: ['historical'],
      },
      baseSnapshot: {},
      creativeArtifact: creativeArtifact(status),
    },
  }
}

async function renderPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(StoryArcPanel, {
    project,
    worldGroupId: null,
  })))
  return host
}

beforeEach(() => {
  mocks.copilot.pendingCandidates = []
  mocks.copilot.loading = false
  mocks.copilot.busy = false
  mocks.copilot.error = null
  mocks.storyArcStore.arcs = []
  mocks.storyArcStore.activeArcId = null
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS30 · 故事线面板统一进入主 Agent Harness', () => {
  it('AI 生成提交 outline.story-arcs 请求，人工新增主线仍保持可用', async () => {
    const host = await renderPanel()
    const buttons = Array.from(host.querySelectorAll('button'))

    await act(async () => buttons.find(button => button.textContent?.includes('AI 生成'))!.click())
    expect(mocks.copilot.submitRequest).toHaveBeenCalledWith(
      '依据当前作品已确认的世界、故事核心、角色和既有规划，生成一条主线故事线。',
    )
    expect(mocks.storyArcStore.addArc).not.toHaveBeenCalled()

    await act(async () => buttons.find(button => button.title === '新增主线')!.click())
    expect(mocks.storyArcStore.addArc).toHaveBeenCalledWith(expect.objectContaining({
      projectId: project.id,
      name: '主线',
      type: 'main',
    }))
  })

  it('候选可编辑、拒绝和采纳，且确认前不会伪装成正式故事线', async () => {
    mocks.copilot.pendingCandidates = [candidate()]
    const host = await renderPanel()

    expect(host.textContent).toContain('待确认 · 主线故事线')
    expect(host.textContent).toContain('约 712 tokens')
    expect(host.textContent).toContain('本次实际输入证据')
    expect(host.textContent).toContain('可直接采纳')
    expect(host.textContent).toContain('1 次模型调用 · 150 tokens')
    expect(host.textContent).toContain('还没有故事线')

    const editor = host.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="主线故事线候选内容"]',
    )!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!
      setter.call(editor, '[{"name":"作者修订主线"}]')
      editor.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(mocks.copilot.updateCandidate).toHaveBeenCalledWith(
      31,
      '[{"name":"作者修订主线"}]',
    )

    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent?.includes('拒绝'))!.click())
    await act(async () => buttons.find(button => button.textContent?.includes('采纳'))!.click())
    expect(mocks.copilot.rejectCandidate).toHaveBeenCalledWith(mocks.copilot.pendingCandidates[0])
    expect(mocks.copilot.adoptCandidate).toHaveBeenCalledWith(mocks.copilot.pendingCandidates[0])
    expect(mocks.storyArcStore.addArc).not.toHaveBeenCalled()
  })

  it('需要手修的候选展示具体问题并禁用采纳，不会把失败伪装成无产出', async () => {
    mocks.copilot.pendingCandidates = [candidate('manual-repair')]
    const host = await renderPanel()

    expect(host.textContent).toContain('需要手动修复')
    expect(host.textContent).toContain('查看 1 个问题')
    const adopt = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('采纳'))!
    expect(adopt.disabled).toBe(true)
    expect(host.querySelector<HTMLTextAreaElement>('textarea[aria-label="主线故事线候选内容"]'))
      .not.toBeNull()
  })
})
