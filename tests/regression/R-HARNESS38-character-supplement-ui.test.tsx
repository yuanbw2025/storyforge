import { act, createElement } from 'react'
import { readFileSync } from 'node:fs'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHARACTER_DIMENSIONS } from '../../src/lib/character/character-dimensions'
import type { Character, Project } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  copilot: {
    pendingCandidates: [] as any[],
    loading: false,
    busy: false,
    recoveryAvailable: false,
    error: null as string | null,
    submitTargetedRequest: vi.fn(async () => undefined),
    updateCandidate: vi.fn(async () => undefined),
    rejectCandidate: vi.fn(async () => true),
    adoptCandidate: vi.fn(async () => true),
    resume: vi.fn(async () => undefined),
  },
}))

vi.mock('../../src/components/agent/useMasterCopilot', () => ({
  useMasterCopilot: () => mocks.copilot,
}))

vi.mock('../../src/components/character/CharacterDimensionPicker', () => ({
  default: () => createElement('div', { 'data-testid': 'dimension-picker' }),
}))

import CharacterSupplementAction from '../../src/components/character/CharacterSupplementAction'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project = {
  id: 1,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000000001',
  workspacePurpose: 'independent-work',
  name: '潮门纪事',
  enableMultiWorld: false,
  activeWorldId: 11,
  activeWorkId: 12,
  createdAt: 1,
  updatedAt: 1,
} as Project

const character = {
  id: 7,
  projectId: 1,
  name: '青禾',
  roleWeight: 'npc',
  moralAxis: 'good',
  orderAxis: 'lawful',
  relationships: '同守门人互相照应',
  ...Object.fromEntries(CHARACTER_DIMENSIONS.map(dimension => [dimension.key, '已有设定'])),
  personality: '',
  goals: '',
  createdAt: 1,
  updatedAt: 1,
} as Character

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderAction(onDone = vi.fn()) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(CharacterSupplementAction, {
    character,
    project,
    worldGroupId: null,
    onDone,
  })))
  return { host, onDone }
}

async function openDialog(host: HTMLDivElement) {
  const trigger = Array.from(host.querySelectorAll('button'))
    .find(button => button.textContent?.includes('AI 补全设定'))!
  await act(async () => trigger.click())
}

function pendingCandidate() {
  const request = {
    characterId: character.id!,
    dimensions: ['personality', 'goals'],
    useEvidence: false,
  }
  return {
    event: {
      id: 88,
      projectId: project.id,
      kind: 'candidate',
      content: JSON.stringify({
        version: 1,
        patch: {
          personality: '谨慎寡言，但极重承诺。',
          goals: '守住潮门并查清旧港真相。',
        },
      }),
      payload: '{}',
    },
    payload: {
      version: 1,
      taskId: 'character-supplement-7',
      agentId: 'character',
      skillId: 'character.supplement',
      label: '补全角色“青禾”的 2 个字段',
      contextSources: ['targetCharacter', 'worldview'],
      contextEvidence: {
        profile: 'balanced',
        included: ['targetCharacter', 'worldview'],
        omitted: [],
        trimmed: [],
        estimatedInputTokens: 420,
        inputBudgetTokens: 20_000,
      },
      baseSnapshot: {},
      characterSupplementRequest: request,
    },
  }
}

beforeEach(() => {
  mocks.copilot.pendingCandidates = []
  mocks.copilot.loading = false
  mocks.copilot.busy = false
  mocks.copilot.recoveryAvailable = false
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

describe('R-HARNESS38 · 角色补全入口接入主 Agent Harness', () => {
  it('只提交固定角色、字段闭集和证据开关，不在按钮阶段写业务数据', async () => {
    const { host } = await renderAction()
    await openDialog(host)
    const evidence = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    await act(async () => evidence.click())
    const generate = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('生成 2 个字段候选'))!
    await act(async () => generate.click())

    expect(mocks.copilot.submitTargetedRequest).toHaveBeenCalledTimes(1)
    const [, pinned] = mocks.copilot.submitTargetedRequest.mock.calls[0]
    expect(pinned).toMatchObject({
      id: 'character-supplement-7',
      agentId: 'character',
      skillId: 'character.supplement',
      characterSupplementRequest: {
        characterId: 7,
        dimensions: ['personality', 'goals'],
        useEvidence: true,
      },
    })
  })

  it('加载恢复期间生成入口即时禁用，避免重复模型调用', async () => {
    mocks.copilot.loading = true
    const { host } = await renderAction()
    await openDialog(host)
    const generate = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('生成 2 个字段候选')) as HTMLButtonElement
    expect(generate.disabled).toBe(true)
    await act(async () => generate.click())
    expect(mocks.copilot.submitTargetedRequest).not.toHaveBeenCalled()
  })

  it('恢复候选按选中字段编辑，并由统一控制器拒绝或确认', async () => {
    const candidate = pendingCandidate()
    mocks.copilot.pendingCandidates = [candidate]
    const { host, onDone } = await renderAction()
    await openDialog(host)
    const personality = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="补全候选-性格"]')!
    expect(personality.value).toContain('谨慎寡言')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        personality,
        '作者改为：沉静克制，但绝不违背承诺。',
      )
      personality.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(mocks.copilot.updateCandidate).toHaveBeenCalledWith(
      88,
      expect.stringContaining('作者改为：沉静克制'),
    )

    const reject = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('拒绝'))!
    await act(async () => reject.click())
    expect(mocks.copilot.rejectCandidate).toHaveBeenCalledWith(candidate)

    const adopt = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('确认写入'))!
    await act(async () => adopt.click())
    expect(mocks.copilot.adoptCandidate).toHaveBeenCalledWith(candidate)
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('旧组件不再直调模型、手工装配上下文或直接采纳，四个调用方仍保留入口', () => {
    const actionSource = readFileSync('src/components/character/CharacterSupplementAction.tsx', 'utf8')
    expect(actionSource).not.toContain('useAIStream')
    expect(actionSource).not.toContain('assembleContext')
    expect(actionSource).not.toMatch(/\badopt\s*\(/)
    expect(actionSource).not.toContain('character-supplement-adapter')
    for (const file of [
      'CharacterDetailCard.tsx',
      'CharacterNPCPanel.tsx',
      'CharacterMinorPanel.tsx',
      'CharacterExtraPanel.tsx',
    ]) {
      const source = readFileSync(`src/components/character/${file}`, 'utf8')
      expect(source).toContain('<CharacterSupplementAction')
      expect(source).toContain('project={project}')
    }
  })
})
