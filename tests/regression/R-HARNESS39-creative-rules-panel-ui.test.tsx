import { readFileSync } from 'node:fs'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  copilot: {
    pendingCandidates: [] as any[],
    loading: false,
    busy: false,
    recoveryAvailable: false,
    error: null as string | null,
    submitTargetedRequest: vi.fn(async () => undefined),
    updateCandidate: vi.fn(async () => undefined),
    rejectCandidate: vi.fn(async () => undefined),
    adoptCandidate: vi.fn(async () => true),
    resume: vi.fn(async () => undefined),
  },
  rulesStore: {
    creativeRules: {
      id: 5,
      projectId: 1,
      writingStyle: '旧写作风格',
      narrativePOV: 'third-limited',
      atmosphere: '规范字段基调',
      prohibitions: '[]',
      consistencyRules: '[]',
      specialRequirements: '旧特殊要求',
        citedReferenceIds: '[]',
      createdAt: 1,
      updatedAt: 1,
    } as any,
    loadAll: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  },
  referenceStore: {
    references: [] as any[],
    loadAll: vi.fn(async () => undefined),
  },
}))

vi.mock('../../src/components/agent/useMasterCopilot', () => ({
  useMasterCopilot: () => mocks.copilot,
}))

vi.mock('../../src/stores/project-singletons', () => ({
  useCreativeRulesStore: () => mocks.rulesStore,
}))

vi.mock('../../src/stores/reference', () => ({
  useReferenceStore: () => mocks.referenceStore,
}))

vi.mock('../../src/stores/world-group', () => ({
  useWorldGroupStore: (selector: (state: { activeGroupId: number | null }) => unknown) => selector({ activeGroupId: null }),
}))

import CreativeRulesPanel from '../../src/components/rules/CreativeRulesPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project = {
  id: 1,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000000001',
  workspacePurpose: 'independent-work',
  name: '潮钟纪事',
  enableMultiWorld: false,
  activeWorldId: 11,
  activeWorkId: 12,
  createdAt: 1,
  updatedAt: 1,
} as Project

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(CreativeRulesPanel, { project })))
  return host
}

function setValue(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function pendingCandidate(field: 'writingStyle' | 'atmosphere' | 'specialRequirements' = 'writingStyle') {
  const labels = {
    writingStyle: '写作风格',
    atmosphere: '基调和氛围',
    specialRequirements: '特殊创作要求',
  }
  return {
    event: {
      id: 71,
      projectId: project.id,
      kind: 'candidate',
      content: JSON.stringify({
        field,
        value: `模型建议的${labels[field]}`,
      }),
      payload: '{}',
    },
    payload: {
      version: 1,
      taskId: `creative-rules-${field}`,
      agentId: 'world-origin',
      skillId: 'world-origin.creative-rules',
      creativeRulesField: field,
      label: labels[field],
      contextSources: ['workStatus', 'worldview', 'storyCore', 'creativeRules'],
      contextEvidence: {
        profile: 'balanced',
        included: ['workStatus', 'worldview', 'storyCore', 'creativeRules'],
        omitted: [],
        trimmed: ['worldview'],
        estimatedInputTokens: 510,
        inputBudgetTokens: 20_000,
      },
      baseSnapshot: {},
    },
  }
}

beforeEach(() => {
  mocks.copilot.pendingCandidates = []
  mocks.copilot.loading = false
  mocks.copilot.busy = false
  mocks.copilot.recoveryAvailable = false
  mocks.copilot.error = null
  mocks.copilot.adoptCandidate.mockResolvedValue(true)
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS39 · 创作规则面板统一进入主 Agent Harness', () => {
  it('三个 AI 按钮只提交固定 Skill 和规范字段，人工基调保存也使用 atmosphere', async () => {
    const host = await renderPanel()
    const aiButtons = Array.from(host.querySelectorAll('button'))
      .filter(button => button.textContent?.includes('AI 建议'))
    expect(aiButtons).toHaveLength(3)

    for (const button of aiButtons) await act(async () => button.click())
    expect(mocks.copilot.submitTargetedRequest).toHaveBeenCalledTimes(3)
    expect(mocks.copilot.submitTargetedRequest.mock.calls.map(([, task]) => task)).toEqual([
      expect.objectContaining({
        id: 'creative-rules-writingStyle',
        agentId: 'world-origin',
        skillId: 'world-origin.creative-rules',
        instruction: '生成创作规则字段。目标字段=writingStyle。',
      }),
      expect.objectContaining({
        id: 'creative-rules-atmosphere',
        skillId: 'world-origin.creative-rules',
        instruction: '生成创作规则字段。目标字段=atmosphere。',
      }),
      expect.objectContaining({
        id: 'creative-rules-specialRequirements',
        skillId: 'world-origin.creative-rules',
        instruction: '生成创作规则字段。目标字段=specialRequirements。',
      }),
    ])

    const atmosphere = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder^="描述作品的整体基调"]',
    )!
    expect(atmosphere.value).toBe('规范字段基调')
    await act(async () => setValue(atmosphere, '作者改写后的规范基调'))
    await act(async () => atmosphere.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(mocks.rulesStore.save).toHaveBeenCalledWith({
      projectId: project.id,
      atmosphere: '作者改写后的规范基调',
    })
  })

  it('刷新恢复的候选展示输入证据，可编辑、拒绝并确认后回读正式规则', async () => {
    const candidate = pendingCandidate('writingStyle')
    mocks.copilot.pendingCandidates = [candidate]
    const host = await renderPanel()

    expect(host.textContent).toContain('待确认 · 写作风格')
    expect(host.textContent).toContain('约 510 tokens')
    expect(host.textContent).toContain('本次实际输入证据')
    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="写作风格候选内容"]')!
    expect(editor.value).toBe('模型建议的写作风格')
    await act(async () => setValue(editor, '作者修订后的写作风格'))
    expect(mocks.copilot.updateCandidate).toHaveBeenCalledWith(
      71,
      expect.stringContaining('作者修订后的写作风格'),
    )

    const reject = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('拒绝'))!
    await act(async () => reject.click())
    expect(mocks.copilot.rejectCandidate).toHaveBeenCalledWith(candidate)

    mocks.rulesStore.loadAll.mockClear()
    const adopt = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('确认写入'))!
    await act(async () => adopt.click())
    expect(mocks.copilot.adoptCandidate).toHaveBeenCalledWith(candidate)
    expect(mocks.rulesStore.loadAll).toHaveBeenCalledWith(project.id)
  })

  it('加载期间阻止重复生成，并提供 durable 恢复入口', async () => {
    mocks.copilot.loading = true
    mocks.copilot.recoveryAvailable = true
    const host = await renderPanel()
    const aiButtons = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .filter(button => button.textContent?.includes('AI 建议'))
    expect(aiButtons.every(button => button.disabled)).toBe(true)
    const resume = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('恢复未完成生成')) as HTMLButtonElement
    expect(resume.disabled).toBe(true)
  })

  it('旧面板不再直调模型、手拼世界/故事上下文或直接采纳', () => {
    const source = readFileSync('src/components/rules/CreativeRulesPanel.tsx', 'utf8')
    expect(source).not.toContain('useAIStream')
    expect(source).not.toContain('createAISessionKey')
    expect(source).not.toContain('buildRulesGeneratePrompt')
    expect(source).not.toContain('assembleContext')
    expect(source).not.toMatch(/\badopt\s*\(/)
    expect(() => readFileSync('src/lib/ai/adapters/rules-adapter.ts', 'utf8')).toThrow()
  })
})
