import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TextOpenWorldWorldRecordPanel from '../../src/components/text-game/TextOpenWorldWorldRecordPanel'
import type { TextOpenWorldPlayerWorldRecordProjectionV1 } from '../../src/lib/open-world/player-world-record'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function recordProjection(): TextOpenWorldPlayerWorldRecordProjectionV1 {
  return {
    relationships: {
      morality: { value: 12, minimum: -100, maximum: 100 },
      factions: [{ uiId: 'relationship-faction-1', title: '守渠会', affinity: 8 }],
      actors: [{
        uiId: 'relationship-actor-1', name: '岑阿婆', factionTitle: '守渠会',
        attitude: 'neutral', attitudeLabel: '一般', greetingTone: '礼貌而保留',
        contextLabels: ['当前位置人物'], knownReasonLabels: ['当前道德评价'],
        optionalInteractionSummary: '可以尝试互动', tradeSummary: '当前位置可提供交易服务',
      }],
      recentChanges: [{
        uiId: 'relationship-change-1', title: '行动后果已经结算',
        detail: '附近人物可能改变对你的态度', timeLabel: '第 1 天 · 白天',
      }],
    },
    encyclopedia: {
      categories: [
        { kind: 'places', label: '地点', count: 1 },
        { kind: 'items', label: '物品', count: 1 },
      ],
      entries: [{
        uiId: 'encyclopedia-location-1', category: 'places', categoryLabel: '地点',
        title: '盐港广场', summary: '盐商和守渠人汇集之处。',
        certainty: 'visited', certaintyLabel: '到访', details: ['可见功能：旅行'],
        mapFocus: { kind: 'map-location', locationKey: 'location.visible-secret' },
      }, {
        uiId: 'encyclopedia-item-2', category: 'items', categoryLabel: '物品',
        title: '旧盐刀', summary: '守渠人常用的短刀。', certainty: 'owned', certaintyLabel: '当前持有',
        details: ['装备 · 数量 1'], mapFocus: null,
      }],
    },
    rumors: {
      entries: [{
        uiId: 'rumor-1', text: '有人看见渠口附近有野兽。', reliability: 'likely', reliabilityLabel: '较为可信',
        relatedFactKnown: false, relatedFactStatusLabel: '关联事实尚待核实',
        heardAtLabel: '第 1 天 · 白天', regionTitle: '盐港',
      }],
    },
    history: {
      status: 'awaiting-events',
      eventEntries: [],
      knowledgeEntries: [{
        uiId: 'knowledge-history-1', kindLabel: '传闻', headline: '听闻一则传闻',
        details: ['有人看见渠口附近有野兽。'], timeLabel: '第 1 天 · 白天', regionTitle: '盐港',
      }],
    },
    achievements: {
      earnedCount: 1, totalCount: 3, lockedCount: 2,
      earned: [{
        uiId: 'achievement-1', title: '第一道水痕', description: '完成第一次渠线调查。',
        earnedAtLabel: '第 1 天 · 白天', regionTitle: '盐港',
      }],
    },
  }
}

function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function setSelect(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function tab(host: ParentNode, label: string): HTMLButtonElement {
  const result = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    .find(candidate => candidate.textContent === label)
  if (!result) throw new Error(`找不到标签页：${label}`)
  return result
}

describe('Text Open World G4-11 · 世界记录 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  it('提供五个可访问标签页，并支持方向键、Home与End导航', async () => {
    await act(async () => root.render(createElement(TextOpenWorldWorldRecordPanel, {
      sessionKey: 1,
      projection: recordProjection(),
      onFocusLocation: () => undefined,
    })))
    const tabs = host.querySelectorAll('[role="tab"]')
    expect(Array.from(tabs).map(item => item.textContent)).toEqual(['关系', '百科', '传闻', '历程', '成就'])
    expect(tab(host, '关系').getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('岑阿婆')

    await act(async () => tab(host, '关系').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(tab(host, '百科').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tab(host, '百科'))

    await act(async () => tab(host, '百科').dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })))
    expect(tab(host, '成就').getAttribute('aria-selected')).toBe('true')
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('另有 2 项尚未解锁')

    await act(async () => tab(host, '成就').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })))
    expect(tab(host, '关系').getAttribute('aria-selected')).toBe('true')
  })

  it('百科支持搜索、分类和地图聚焦，且不把提交目标键写入DOM', async () => {
    const onFocusLocation = vi.fn()
    await act(async () => root.render(createElement(TextOpenWorldWorldRecordPanel, {
      sessionKey: 'session-a', projection: recordProjection(), onFocusLocation,
    })))
    await act(async () => tab(host, '百科').click())
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('盐港广场')
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('旧盐刀')

    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => setInput(search, '盐刀'))
    expect(host.querySelector('[role="tabpanel"]')?.textContent).not.toContain('盐港广场')
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('旧盐刀')

    await act(async () => setInput(search, ''))
    const category = host.querySelector<HTMLSelectElement>('select')!
    await act(async () => setSelect(category, 'places'))
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('盐港广场')
    expect(host.querySelector('[role="tabpanel"]')?.textContent).not.toContain('旧盐刀')
    const mapButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent === '在地图中查看')!
    await act(async () => mapButton.click())
    expect(onFocusLocation).toHaveBeenCalledWith('location.visible-secret')
    expect(host.innerHTML).not.toContain('location.visible-secret')
  })

  it('显示传闻可信文字、历程同步状态和匿名成就数，并在切换Session时重置筛选', async () => {
    const projection = recordProjection()
    await act(async () => root.render(createElement(TextOpenWorldWorldRecordPanel, {
      sessionKey: 'session-a', projection, onFocusLocation: () => undefined,
    })))
    await act(async () => tab(host, '传闻').click())
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('可信程度：较为可信')
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('关联事实尚待核实')
    await act(async () => tab(host, '历程').click())
    expect(host.querySelector('[role="status"]')?.textContent).toContain('事件记录正在与当前存档同步')
    await act(async () => tab(host, '百科').click())
    await act(async () => setInput(host.querySelector<HTMLInputElement>('input[type="search"]')!, '盐刀'))

    await act(async () => root.render(createElement(TextOpenWorldWorldRecordPanel, {
      sessionKey: 'session-b', projection, onFocusLocation: () => undefined,
    })))
    expect(tab(host, '关系').getAttribute('aria-selected')).toBe('true')
    await act(async () => tab(host, '百科').click())
    expect(host.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('')
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain('盐港广场')
  })

  it('每个分类都有明确空态', async () => {
    const projection = recordProjection()
    projection.relationships.factions = []
    projection.relationships.actors = []
    projection.relationships.recentChanges = []
    projection.rumors.entries = []
    projection.history.status = 'ready'
    projection.history.knowledgeEntries = []
    projection.achievements = { earnedCount: 0, totalCount: 2, lockedCount: 2, earned: [] }
    await act(async () => root.render(createElement(TextOpenWorldWorldRecordPanel, {
      sessionKey: 1, projection, onFocusLocation: () => undefined,
    })))
    expect(host.textContent).toContain('还没有可记录的人物关系')
    expect(host.textContent).toContain('还没有可回顾的关系变化')
    await act(async () => tab(host, '传闻').click())
    expect(host.textContent).toContain('还没有亲自听闻并记录的传闻')
    await act(async () => tab(host, '历程').click())
    expect(host.textContent).toContain('还没有可回顾的行动或世界变化')
    expect(host.textContent).toContain('还没有可回顾的见闻与发现')
    await act(async () => tab(host, '成就').click())
    expect(host.textContent).toContain('还没有获得成就')
  })
})
