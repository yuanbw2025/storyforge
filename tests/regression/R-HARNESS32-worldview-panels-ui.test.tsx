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
    worldview: {
      id: 7,
      projectId: 1,
      worldOrigin: '旧的世界来源',
      powerHierarchy: '',
      divineDesign: {
        hasDivinity: false,
        divineRank: '',
        divineNames: '',
        divineRules: '',
      },
      worldStructure: '旧的世界结构',
      worldDimensions: '',
      continentLayout: '',
      mountainsRivers: '',
      climateByRegion: '',
      naturalResourceOverview: '',
      naturalResources: { rareCreatures: '', herbs: '', minerals: '', others: '' },
      races: '',
      factionLayout: '',
      regionDimensions: '',
      politicsOverview: '旧的政治制度',
      economyOverview: '',
      cultureOverview: '',
      internalConflicts: '',
      itemDesign: '',
      createdAt: 1,
      updatedAt: 1,
    } as any,
    saveWorldview: vi.fn(async () => undefined),
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

vi.mock('../../src/components/codex/CodexPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'codex-panel' }),
}))

vi.mock('../../src/components/codex/CodexSearchBar', () => ({
  default: () => createElement('div', { 'data-testid': 'codex-search' }),
}))

vi.mock('../../src/components/worldview/CultivationSystemsPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'cultivation-panel' }),
}))

import WorldviewHumanityPanel from '../../src/components/worldview/WorldviewHumanityPanel'
import WorldviewNaturalPanel from '../../src/components/worldview/WorldviewNaturalPanel'
import WorldviewOriginPanel from '../../src/components/worldview/WorldviewOriginPanel'

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

function candidate(field: string, label: string, value: unknown = `候选的${label}`) {
  return {
    event: {
      id: 51,
      projectId: project.id!,
      kind: 'candidate',
      content: JSON.stringify({ field, value }),
      payload: '{}',
    },
    payload: {
      version: 1,
      taskId: 'worldview-field-1',
      agentId: 'world-origin',
      skillId: 'world-origin.worldview-field',
      worldviewField: field,
      label,
      contextSources: ['worldview', 'storyCore'],
      contextEvidence: {
        profile: 'balanced',
        inputBudgetTokens: 14_000,
        estimatedInputTokens: 712,
        included: ['worldview', 'storyCore'],
        omitted: [],
        trimmed: ['references'],
      },
      baseSnapshot: {},
    },
  }
}

async function renderPanel(component: Parameters<typeof createElement>[0], props: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(component, { project, ...props })))
  return host
}

function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function generateButton(host: HTMLElement) {
  return Array.from(host.querySelectorAll('button'))
    .find(button => button.textContent?.includes('AI 生成'))!
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

describe('R-HARNESS32 · 三个世界基座面板统一进入主 Agent Harness', () => {
  it('世界起源、自然环境和人文环境都提交固定单字段 Skill 请求', async () => {
    const origin = await renderPanel(WorldviewOriginPanel)
    await act(async () => generateButton(origin).click())
    expect(mocks.copilot.submitTargetedRequest.mock.calls.at(-1)?.[0]).toContain('目标字段=worldOrigin')

    const natural = await renderPanel(WorldviewNaturalPanel)
    await act(async () => generateButton(natural).click())
    expect(mocks.copilot.submitTargetedRequest.mock.calls.at(-1)?.[0]).toContain('目标字段=worldStructure')

    const humanity = await renderPanel(WorldviewHumanityPanel, { onOpenHistory: vi.fn() })
    const politics = Array.from(humanity.querySelectorAll('button'))
      .find(button => button.textContent?.includes('政治制度'))!
    await act(async () => politics.click())
    const politicsHeading = Array.from(humanity.querySelectorAll('h3'))
      .find(heading => heading.textContent?.includes('政治制度'))!
    const politicsSection = politicsHeading.closest<HTMLDivElement>('div.max-w-3xl')!
    const hint = politicsSection.querySelector<HTMLInputElement>('input[placeholder="给 AI 的补充说明（可选）"]')!
    await act(async () => setInputValue(hint, '权力必须受到潮汐历法约束'))
    await act(async () => generateButton(politicsSection).click())
    const request = mocks.copilot.submitTargetedRequest.mock.calls.at(-1)?.[0]
    expect(request).toContain('目标字段=politicsOverview')
    expect(request).toContain('生成模式=expand')
    expect(request).toContain('潮汐历法约束')
  })

  it('神明候选刷新后直接恢复结构化对象，不再出现二次拆分步骤', async () => {
    const divineValue = {
      hasDivinity: true,
      divineRank: '潮母之下设三位守潮神。',
      divineNames: '潮母掌记忆，盐灯神掌见证。',
      divineRules: '神明不得取走未被自愿典当的记忆。',
    }
    mocks.copilot.pendingCandidates = [candidate('divineDesign', '神明与信仰', divineValue)]
    const host = await renderPanel(WorldviewOriginPanel)

    await vi.waitFor(() => {
      expect(host.querySelector('textarea[aria-label="神明与信仰候选内容"]')).not.toBeNull()
    })
    expect(host.querySelector('[aria-label="神明与信仰有待确认候选"]')).not.toBeNull()
    expect(host.textContent).toContain('待确认 · 神明与信仰')
    expect(host.textContent).not.toContain('正在将信仰体系拆分')

    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="神明与信仰候选内容"]')!
    const revisedValue = { ...divineValue, divineRules: '神谕必须由两名无血缘见证者共同记录。' }
    const revised = JSON.stringify(revisedValue, null, 2)
    await act(async () => setInputValue(editor, revised))
    expect(mocks.copilot.updateCandidate).toHaveBeenCalledWith(51, JSON.stringify({
      field: 'divineDesign',
      value: revisedValue,
    }, null, 2))

    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent?.includes('拒绝'))!.click())
    expect(mocks.copilot.rejectCandidate).toHaveBeenCalledWith(mocks.copilot.pendingCandidates[0])
    await act(async () => buttons.find(button => button.textContent?.includes('采纳'))!.click())
    expect(mocks.copilot.adoptCandidate).toHaveBeenCalledWith(mocks.copilot.pendingCandidates[0])
    expect(mocks.worldviewStore.loadAll).toHaveBeenCalledWith(project.id, null)
  })

  it('刷新恢复非首自然字段候选时自动定位并标记待确认，人工编辑仍走原 store', async () => {
    mocks.copilot.pendingCandidates = [candidate('climateByRegion', '气候环境')]
    const host = await renderPanel(WorldviewNaturalPanel)

    await vi.waitFor(() => {
      expect(host.querySelector('textarea[aria-label="气候环境候选内容"]')).not.toBeNull()
    })
    expect(host.querySelector('[aria-label="气候环境有待确认候选"]')).not.toBeNull()
    expect(host.textContent).toContain('待确认 · 气候环境')

    const climateHeading = Array.from(host.querySelectorAll('h3'))
      .find(heading => heading.textContent?.includes('气候环境'))!
    const climateSection = climateHeading.closest<HTMLDivElement>('div.max-w-3xl')!
    const manualDisplay = Array.from(climateSection.querySelectorAll('div.cursor-text'))
      .find(element => element.textContent?.includes('不同区域的气候类型'))!
    await act(async () => manualDisplay.click())
    const manual = climateSection.querySelector<HTMLTextAreaElement>('textarea[placeholder*="不同区域的气候类型"]')!
    await act(async () => setInputValue(manual, '盐雾季会让北岸连续失温七日。'))
    await act(async () => manual.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))
    expect(mocks.worldviewStore.saveWorldview).toHaveBeenCalledWith({
      projectId: project.id,
      climateByRegion: '盐雾季会让北岸连续失温七日。',
    })
  })

  it('自然资源原生对象候选刷新后可审查和修改，不退化为旁路文本', async () => {
    const naturalResources = {
      rareCreatures: '雾鹿会沿盐雾迁徙。',
      herbs: '潮眠草只在退潮后的三小时内开花。',
      minerals: '北岸出产可记录声音的回声盐晶。',
      others: '贝壳纸是城邦间的主要契约载体。',
    }
    mocks.copilot.pendingCandidates = [candidate('naturalResources', '自然资源明细', naturalResources)]
    const host = await renderPanel(WorldviewNaturalPanel)

    await vi.waitFor(() => {
      expect(host.querySelector('textarea[aria-label="自然资源明细候选内容"]')).not.toBeNull()
    })
    expect(host.querySelector('[aria-label="自然资源有待确认候选"]')).not.toBeNull()
    expect(host.textContent).toContain('自然资源分类明细（原生结构）')

    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="自然资源明细候选内容"]')!
    const revisedValue = {
      ...naturalResources,
      others: '贝壳纸是城邦间的契约载体，烧毁后会留下不可伪造的潮纹。',
    }
    await act(async () => setInputValue(editor, JSON.stringify(revisedValue, null, 2)))

    expect(mocks.copilot.updateCandidate).toHaveBeenCalledWith(51, JSON.stringify({
      field: 'naturalResources',
      value: revisedValue,
    }, null, 2))
  })
})
