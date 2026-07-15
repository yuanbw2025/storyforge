import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import InspirationMultiWorldResult from '../../src/components/project/InspirationMultiWorldResult'
import InspirationSingleResult from '../../src/components/project/InspirationSingleResult'
import type { ReverseMultiWorldResult, ReverseResult } from '../../src/lib/ai/inspiration-reverse'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

function character(name: string) {
  return {
    name,
    roleWeight: 'main' as const,
    moralAxis: 'good' as const,
    orderAxis: 'neutral' as const,
    shortDescription: '寻找失落的城门',
    personality: '冷静',
    background: '来自镜海城',
    motivation: '保护同伴',
    arc: '学会信任',
  }
}

const singleResult: ReverseResult = {
  worldview: {
    worldOrigin: '镜海退潮后形成七座城邦',
    powerHierarchy: '潮汐术分为三阶',
    continentLayout: '',
    climateByRegion: '',
    historyLine: '',
    races: '',
    factionLayout: '',
  },
  storyCore: {
    logline: '守门人穿越镜海寻找失踪者',
    theme: '信任',
    centralConflict: '守城与远行',
    plotPattern: '',
    mainPlot: '',
  },
  characters: [character('林照雪'), character('顾临川')],
}

const multiWorldResult: ReverseMultiWorldResult = {
  storyCore: singleResult.storyCore,
  worlds: [{
    name: '镜海城',
    type: 'primary',
    worldOrigin: '镜海退潮后形成的主世界',
    powerHierarchy: '潮汐术',
    continentLayout: '',
    climateByRegion: '',
    historyLine: '',
    races: '',
    factionLayout: '七城议会',
    entryCondition: '',
    powerRestriction: '',
  }],
  characters: [{ ...character('林照雪'), homeWorld: '镜海城', isCrossWorld: false }],
}

async function mount(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(element))
  return host
}

describe('AUDIT-6 · 灵感反推结果视图', () => {
  it('单世界结果将折叠和采纳操作转交给父级控制器', async () => {
    const onToggleSection = vi.fn()
    const onAdoptWorldview = vi.fn()
    const host = await mount(createElement(InspirationSingleResult, {
      result: singleResult,
      expandedSections: new Set(['storyCore', 'characters']),
      adoptedSections: new Set<string>(),
      selectedChars: new Set([0]),
      adopting: false,
      onToggleSection,
      onToggleCharacter: vi.fn(),
      onAdoptWorldview,
      onAdoptStoryCore: vi.fn(),
      onAdoptCharacters: vi.fn(),
      onAdoptAll: vi.fn(),
    }))

    expect(host.textContent).not.toContain('镜海退潮后形成七座城邦')
    const worldviewTitle = Array.from(host.querySelectorAll('span')).find(node => node.textContent === '世界观草稿')!
    const worldviewHeader = worldviewTitle.parentElement!.parentElement!
    await act(async () => worldviewHeader.click())
    expect(onToggleSection).toHaveBeenCalledWith('worldview')

    const adoptButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('写入世界观'))!
    await act(async () => adoptButton.click())
    expect(onAdoptWorldview).toHaveBeenCalledOnce()
    expect(onToggleSection).toHaveBeenCalledOnce()
  })

  it('角色选择只向父级回传角色索引', async () => {
    const onToggleCharacter = vi.fn()
    const host = await mount(createElement(InspirationSingleResult, {
      result: singleResult,
      expandedSections: new Set(['characters']),
      adoptedSections: new Set<string>(),
      selectedChars: new Set([0]),
      adopting: false,
      onToggleSection: vi.fn(),
      onToggleCharacter,
      onAdoptWorldview: vi.fn(),
      onAdoptStoryCore: vi.fn(),
      onAdoptCharacters: vi.fn(),
      onAdoptAll: vi.fn(),
    }))

    const checkboxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0].checked).toBe(true)
    await act(async () => checkboxes[1].click())
    expect(onToggleCharacter).toHaveBeenCalledWith(1)
  })

  it('多世界结果保留世界、归属信息和一键创建回调', async () => {
    const onAdopt = vi.fn()
    const host = await mount(createElement(InspirationMultiWorldResult, {
      result: multiWorldResult,
      adopted: false,
      adopting: false,
      onAdopt,
    }))

    expect(host.textContent).toContain('镜海城')
    expect(host.textContent).toContain('七城议会')
    expect(host.textContent).toContain('@镜海城')
    const adoptButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('一键创建多世界'))!
    await act(async () => adoptButton.click())
    expect(onAdopt).toHaveBeenCalledOnce()
  })
})
