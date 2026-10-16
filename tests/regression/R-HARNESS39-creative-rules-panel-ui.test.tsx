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
      workId: 12,
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
import { createSystemFictionElementsV1 } from '../../src/lib/prose/system-fiction-contract'

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

async function renderPanel(currentProject = project) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(CreativeRulesPanel, { project: currentProject })))
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
  mocks.rulesStore.creativeRules = { ...mocks.rulesStore.creativeRules, projectId: 1, workId: 12, systemFictionElements: undefined }
  mocks.rulesStore.save.mockResolvedValue(undefined)
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
    expect(aiButtons).toHaveLength(4)

    for (const button of aiButtons) await act(async () => button.click())
    expect(mocks.copilot.submitTargetedRequest).toHaveBeenCalledTimes(4)
    expect(mocks.copilot.submitTargetedRequest.mock.calls.map(([, task]) => task)).toEqual([
      expect.objectContaining({
        id: 'creative-rules-systemFictionElements',
        skillId: 'world-origin.creative-rules',
        instruction: '生成创作规则字段。目标字段=systemFictionElements。',
      }),
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
    }, { projectId: 1, worldId: 11, workId: 12 })
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
    expect(mocks.rulesStore.loadAll).toHaveBeenCalledWith({ projectId: 1, worldId: 11, workId: 12 })
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

  it('五项元素人工编辑明确保存；保存失败保留输入，不改变旧文风', async () => {
    const host = await renderPanel()
    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="系统文元素 · 系统机制"]')!
    await act(async () => setValue(input, '免费签到，不增加惩罚'))
    const checkbox = host.querySelector<HTMLInputElement>('fieldset[aria-label="系统文元素"] input[type="checkbox"]')!
    await act(async () => checkbox.click())
    expect(mocks.rulesStore.save).not.toHaveBeenCalled()
    mocks.rulesStore.save.mockRejectedValueOnce(new Error('模拟保存失败'))
    const save = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '保存元素')!
    await act(async () => save.click())
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('模拟保存失败')
    expect(input.value).toBe('免费签到，不增加惩罚')
    await act(async () => save.click())
    expect(mocks.rulesStore.save).toHaveBeenLastCalledWith({ projectId: 1, systemFictionElements: { ...createSystemFictionElementsV1(), enabled: true, systemMechanism: '免费签到，不增加惩罚' } }, { projectId: 1, worldId: 11, workId: 12 })
    expect(host.querySelector<HTMLTextAreaElement>('textarea[placeholder^="描述期望的写作风格"]')?.value).toBe('旧写作风格')
  })

  it('作品切换不沿用旧元素草稿；每次保存携带固定 Work 作用域', async () => {
    const host = await renderPanel()
    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="系统文元素 · 系统机制"]')!
    await act(async () => setValue(input, '作品A未保存草稿'))
    mocks.rulesStore.creativeRules = { ...mocks.rulesStore.creativeRules, workId: 22, writingStyle: '作品B文风' }
    await act(async () => mounted.at(-1)!.root.render(createElement(CreativeRulesPanel, { project: { ...project, activeWorkId: 22 } })))
    const nextInput = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="系统文元素 · 系统机制"]')!
    expect(nextInput.value).toBe('')
    await act(async () => setValue(nextInput, '作品B作者要求'))
    const save = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '保存元素')!
    await act(async () => save.click())
    expect(mocks.rulesStore.save).toHaveBeenLastCalledWith(expect.objectContaining({ systemFictionElements: expect.objectContaining({ systemMechanism: '作品B作者要求' }) }), { projectId: 1, worldId: 11, workId: 22 })
  })

  it('恢复的原生元素候选使用同一五项编辑器，编辑不绕过确认采纳', async () => {
    const candidate = pendingCandidate()
    candidate.payload.creativeRulesField = 'systemFictionElements' as never
    candidate.payload.label = '系统文元素'
    candidate.event.content = JSON.stringify({ field: 'systemFictionElements', value: { ...createSystemFictionElementsV1(), systemMechanism: '原候选' } })
    mocks.copilot.pendingCandidates = [candidate]
    const host = await renderPanel()
    const input = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="系统文元素候选 · 系统机制"]')!
    expect(input.value).toBe('原候选')
    await act(async () => setValue(input, '作者编辑候选'))
    expect(mocks.copilot.updateCandidate).toHaveBeenCalledWith(71, expect.stringContaining('作者编辑候选'))
    expect(mocks.rulesStore.save).not.toHaveBeenCalled()
    const adopt = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('确认写入'))!
    await act(async () => adopt.click())
    expect(mocks.copilot.adoptCandidate).toHaveBeenCalledWith(candidate)
  })
})
