import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'
import { CHARACTER_DIMENSIONS } from '../../src/lib/character/character-dimensions'

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
  characterStore: {
    characters: [] as any[],
    loadAll: vi.fn(async () => undefined),
    addCharacter: vi.fn(async () => 1),
    updateCharacter: vi.fn(async () => undefined),
    deleteCharacter: vi.fn(async () => undefined),
  },
}))

vi.mock('../../src/components/agent/useMasterCopilot', () => ({
  useMasterCopilot: () => mocks.copilot,
}))

vi.mock('../../src/stores/character', () => ({
  useCharacterStore: Object.assign(() => mocks.characterStore, {
    getState: () => mocks.characterStore,
  }),
}))

vi.mock('../../src/stores/world-group', () => ({
  useWorldGroupStore: () => ({ groups: [], activeGroupId: null }),
}))

vi.mock('../../src/components/shared/PromptRunPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'prompt-run-panel' }),
}))

vi.mock('../../src/components/character/CharacterDimensionPicker', () => ({
  default: () => createElement('div', { 'data-testid': 'dimension-picker' }),
}))

vi.mock('../../src/components/character/CharacterAxesPicker', () => ({
  default: () => createElement('div', { 'data-testid': 'axes-picker' }),
}))

vi.mock('../../src/components/character/CharacterDetailCard', () => ({
  default: () => createElement('div', { 'data-testid': 'character-detail-card' }),
}))

import CharacterPanel from '../../src/components/character/CharacterPanel'

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

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderPanel() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(CharacterPanel, { project })))
  return host
}

function validCandidate() {
  return {
    name: '潮汐钟匠',
    roleWeight: 'secondary',
    moralAxis: 'good',
    orderAxis: 'lawful',
    relationships: '',
    ...Object.fromEntries(CHARACTER_DIMENSIONS.map(dimension => [dimension.key, ''])),
    shortDescription: '守护旧港灯塔的钟匠。',
  }
}

beforeEach(() => {
  mocks.copilot.pendingCandidates = []
  mocks.copilot.loading = false
  mocks.copilot.busy = false
  mocks.copilot.error = null
  mocks.characterStore.characters = []
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS33 · 分步骤角色面板接入 character.create Skill', () => {
  it('AI 设计角色按钮只提交受限角色任务，不在组件内装配上下文或写库', async () => {
    const host = await renderPanel()
    const hint = host.querySelector<HTMLInputElement>('input[placeholder="角色要求（可选）"]')!
    hint.value = '一名不相信神谕的守灯钟匠'
    hint.dispatchEvent(new Event('input', { bubbles: true }))
    const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.includes('AI 设计角色'))!
    await act(async () => button.click())

    const [request, task] = mocks.copilot.submitTargetedRequest.mock.calls.at(-1)!
    expect(request).toContain('只创建角色候选')
    expect(request).toContain('作者要求与本轮维度')
    expect(request).toContain('已有角色：无')
    expect(task).toMatchObject({
      agentId: 'character',
      skillId: 'character.create',
      promptExecution: { version: 1, moduleKey: 'character.generate' },
    })
    expect(mocks.characterStore.addCharacter).not.toHaveBeenCalled()
  })

  it('刷新恢复候选仍由主 Agent 卡片编辑、拒绝和采纳', async () => {
    const candidate = {
      event: {
        id: 77,
        projectId: project.id,
        kind: 'candidate',
        content: JSON.stringify(validCandidate()),
        payload: '{}',
      },
      payload: {
        version: 1,
        taskId: 'character-create-1',
        agentId: 'character',
        skillId: 'character.create',
        label: '角色创建',
        contextSources: ['worldview', 'characters'],
        contextEvidence: {
          profile: 'balanced',
          inputBudgetTokens: 14_000,
          estimatedInputTokens: 512,
          included: ['worldview', 'characters'],
          omitted: [],
          trimmed: [],
        },
        baseSnapshot: {},
      },
    }
    mocks.copilot.pendingCandidates = [candidate]
    const host = await renderPanel()
    expect(host.querySelector('textarea[aria-label="角色候选内容"]')).not.toBeNull()

    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="角色候选内容"]')!
    const revised = JSON.stringify({ ...validCandidate(), name: '作者确认角色' })
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor, revised)
      editor.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(mocks.copilot.updateCandidate).toHaveBeenCalledWith(77, editor.value)

    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(item => item.textContent?.includes('拒绝'))!.click())
    expect(mocks.copilot.rejectCandidate).toHaveBeenCalledWith(candidate)
    await act(async () => buttons.find(item => item.textContent?.includes('采纳'))!.click())
    expect(mocks.copilot.adoptCandidate).toHaveBeenCalledWith(candidate)
  })
})
