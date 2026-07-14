import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorldRuleEntryEditor from '../../src/components/worldview/WorldRuleEntryEditor'
import WorldRulesNavigation from '../../src/components/worldview/WorldRulesNavigation'
import type { WorldRuleNavigationNode } from '../../src/components/worldview/WorldRulesNavigation'
import { createEmptyEntry } from '../../src/lib/types/world-rules'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

async function mount(component: ReturnType<typeof createElement>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(component))
  return host
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const l1Nodes: WorldRuleNavigationNode[] = [
  { id: 'era', label: '时代背景', icon: '时', isCustom: false },
  { id: 'custom_l1', label: '自定大类', icon: '签', isCustom: true },
]
const l2Nodes: WorldRuleNavigationNode[] = [
  { id: 'era.period', label: '历史时期', icon: '史', isCustom: false },
  { id: 'custom_l2', label: '自定子类', icon: '签', isCustom: true },
]

describe('AUDIT-6 / HEALTH-4 · 真实与幻想受控视图', () => {
  it('导航转发大类/子类/删除命令，并在新增完成后关闭输入态', async () => {
    const onSelectL1 = vi.fn()
    const onSelectNode = vi.fn()
    const onAddL1 = vi.fn().mockResolvedValue(undefined)
    const onDeleteCustomNode = vi.fn()
    const host = await mount(createElement(WorldRulesNavigation, {
      l1Nodes,
      l2Nodes,
      entries: {
        'era.period': { historicalAnchors: '唐代官制', fictionalAdaptations: '', priority: 'historical' },
      },
      selectedL1: 'era',
      selectedNode: 'era.period',
      countL1Filled: id => id === 'era' ? 1 : 0,
      onSelectL1,
      onSelectNode,
      onAddL1,
      onAddL2: vi.fn().mockResolvedValue(undefined),
      onDeleteCustomNode,
    }))

    expect(host.textContent).toContain('时代背景')
    expect(host.textContent).toContain('历史时期')
    const customL1 = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('自定大类'))!
    await act(async () => customL1.click())
    expect(onSelectL1).toHaveBeenCalledWith('custom_l1')

    const period = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('历史时期'))!
    await act(async () => period.click())
    expect(onSelectNode).toHaveBeenCalledWith('era.period')

    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="删除子类自定子类"]')!.click())
    expect(onDeleteCustomNode).toHaveBeenCalledWith('custom_l2', '自定子类')

    const addL1 = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('添加大类'))!
    await act(async () => addL1.click())
    const input = host.querySelector<HTMLInputElement>('input[placeholder="新大类名称"]')!
    await act(async () => setInputValue(input, '礼仪制度'))
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="确认添加大类"]')!.click())
    expect(onAddL1).toHaveBeenCalledWith('礼仪制度')
    expect(host.querySelector('input[placeholder="新大类名称"]')).toBeNull()
  })

  it('编辑区转发双文本、优先级、清空与删除，不自行持久化', async () => {
    const onFieldChange = vi.fn()
    const onDeleteNode = vi.fn()
    const onClearEntry = vi.fn()
    const host = await mount(createElement(WorldRuleEntryEditor, {
      selectedNode: 'era.period',
      currentLabel: '历史时期',
      currentHints: ['朝代', '纪年'],
      currentEntry: {
        historicalAnchors: '沿用唐代官制',
        fictionalAdaptations: '增设灵修院',
        priority: 'balanced',
      },
      isCustomNode: true,
      onFieldChange,
      onDeleteNode,
      onClearEntry,
    }))

    expect(host.textContent).toContain('历史时期')
    expect(host.textContent).toContain('朝代')
    const historical = host.querySelector<HTMLTextAreaElement>('textarea')!
    await act(async () => setInputValue(historical, '采用宋代市舶司'))
    expect(onFieldChange).toHaveBeenCalledWith('historicalAnchors', '采用宋代市舶司')

    const fictional = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('架空优先'))!
    await act(async () => fictional.click())
    expect(onFieldChange).toHaveBeenCalledWith('priority', 'fictional')

    const clear = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('清空'))!
    const remove = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('删除节点'))!
    await act(async () => { clear.click(); remove.click() })
    expect(onClearEntry).toHaveBeenCalledOnce()
    expect(onDeleteNode).toHaveBeenCalledOnce()
  })

  it('未选节点时只显示引导，不误渲染空 entry 的写入控件', async () => {
    const host = await mount(createElement(WorldRuleEntryEditor, {
      selectedNode: null,
      currentLabel: '',
      currentHints: [],
      currentEntry: createEmptyEntry(),
      isCustomNode: false,
      onFieldChange: vi.fn(),
      onDeleteNode: vi.fn(),
      onClearEntry: vi.fn(),
    }))
    expect(host.textContent).toContain('选择左侧的子类开始设定')
    expect(host.querySelector('textarea')).toBeNull()
  })
})
