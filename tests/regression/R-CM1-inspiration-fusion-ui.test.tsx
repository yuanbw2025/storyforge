import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InspirationFusionReview from '../../src/components/project/InspirationFusionReview'
import InspirationSingleResult from '../../src/components/project/InspirationSingleResult'
import type { InspirationFragment, InspirationVersion } from '../../src/lib/types/inspiration-workspace'
import type { ReverseResult } from '../../src/lib/ai/inspiration-reverse'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

async function mount(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(element))
  return host
}

const fragment: InspirationFragment = {
  id: 'idea-1',
  text: '旧城每次下雨都会忘记一个人',
  label: '城市规则',
  sourceKind: 'author',
  createdAt: 1,
}
const version: InspirationVersion = {
  id: 'version-1',
  parentVersionId: null,
  mode: 'single',
  fragmentIds: [fragment.id],
  resultJson: '{}',
  createdAt: 2,
}
const result: ReverseResult = {
  worldview: {
    worldOrigin: '旧城诞生于一场遗忘',
    powerHierarchy: '',
    continentLayout: '',
    climateByRegion: '',
    races: '',
    factionLayout: '',
  },
  history: { overview: '' },
  storyCore: {
    logline: '守城人追查被雨抹去的名字',
    theme: '记忆',
    centralConflict: '保存与遗忘',
    plotPattern: '探索型',
    mainPlot: '寻找城市失忆的根源',
  },
  characters: [],
}

describe('R-CM1 · 增量灵感融合 UI', () => {
  it('公开来源、版本和逐字段差异，确认前提供确认/放弃动作', async () => {
    const onConfirm = vi.fn()
    const host = await mount(createElement(InspirationFusionReview, {
      fragments: [fragment],
      versions: [version],
      selectedIds: new Set([fragment.id]),
      mode: 'single',
      pendingDiff: [{
        path: 'storyCore.theme',
        before: '复仇',
        after: '记忆',
      }],
      confirming: false,
      onToggle: vi.fn(),
      onRemove: vi.fn(),
      onConfirm,
      onDiscard: vi.fn(),
    }))

    expect(host.textContent).toContain('本人灵感')
    expect(host.textContent).toContain('1 个已确认版本')
    expect(host.textContent).toContain('storyCore.theme')
    expect(host.textContent).toContain('复仇')
    expect(host.textContent).toContain('记忆')
    const remove = host.querySelector<HTMLButtonElement>('button[aria-label="移除灵感碎片"]')!
    expect(remove.disabled).toBe(true)

    const confirm = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('确认融合版本'))!
    await act(async () => confirm.click())
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('待确认结果锁住全部采纳和分区采纳', async () => {
    const onAdoptAll = vi.fn()
    const onAdoptStoryCore = vi.fn()
    const host = await mount(createElement(InspirationSingleResult, {
      result,
      expandedSections: new Set(['storyCore']),
      adoptedSections: new Set<string>(),
      selectedChars: new Set<number>(),
      adopting: false,
      adoptionLocked: true,
      onToggleSection: vi.fn(),
      onToggleCharacter: vi.fn(),
      onAdoptWorldview: vi.fn(),
      onAdoptStoryCore,
      onAdoptCharacters: vi.fn(),
      onAdoptAll,
    }))

    const locked = Array.from(host.querySelectorAll<HTMLButtonElement>('button'))
      .filter(button => button.textContent?.includes('先确认融合版本'))
    expect(locked.length).toBeGreaterThanOrEqual(2)
    expect(locked.every(button => button.disabled)).toBe(true)
    await act(async () => locked[0].click())
    expect(onAdoptAll).not.toHaveBeenCalled()
    expect(onAdoptStoryCore).not.toHaveBeenCalled()
  })

  it('结构化候选可在确认前编辑，编辑内容由事件草稿回调承接', async () => {
    const onCandidateChange = vi.fn()
    const draft = JSON.stringify({ storyCore: { theme: '记忆' } })
    const host = await mount(createElement(InspirationFusionReview, {
      fragments: [fragment],
      versions: [version],
      selectedIds: new Set([fragment.id]),
      mode: 'single',
      pendingDiff: [],
      candidateDraft: draft,
      confirming: false,
      onCandidateChange,
      onToggle: vi.fn(),
      onRemove: vi.fn(),
      onConfirm: vi.fn(),
      onDiscard: vi.fn(),
    }))

    const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="灵感反推候选内容"]')!
    expect(editor.value).toBe(draft)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        editor,
        JSON.stringify({ storyCore: { theme: '身份与记忆' } }),
      )
      editor.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onCandidateChange).toHaveBeenCalledOnce()
    expect(onCandidateChange.mock.calls[0][0]).toContain('身份与记忆')
  })
})
