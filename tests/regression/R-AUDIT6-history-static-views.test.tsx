import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KeywordHistoryHelp, TimelineHistoryHelp } from '../../src/components/history/HistoryHelpPanels'
import HistoryOverviewTab from '../../src/components/history/HistoryOverviewTab'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function render(element: ReturnType<typeof createElement>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(element))
  return host
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 历史静态视图', () => {
  it('总述与纪年输入继续转发草稿和失焦保存', async () => {
    const onOverviewChange = vi.fn()
    const onEraSystemChange = vi.fn()
    const onSaveOverview = vi.fn()
    const onSaveEraSystem = vi.fn()
    const host = await render(createElement(HistoryOverviewTab, {
      overview: '旧总述',
      eraSystem: '旧纪年',
      onOverviewChange,
      onEraSystemChange,
      onSaveOverview,
      onSaveEraSystem,
    }))
    const textareas = Array.from(host.querySelectorAll('textarea'))
    expect(textareas).toHaveLength(2)
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setValue.call(textareas[0], '新总述')
      textareas[0].dispatchEvent(new Event('input', { bubbles: true }))
      textareas[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      setValue.call(textareas[1], '新纪年')
      textareas[1].dispatchEvent(new Event('input', { bubbles: true }))
      textareas[1].dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onOverviewChange).toHaveBeenCalledWith('新总述')
    expect(onEraSystemChange).toHaveBeenCalledWith('新纪年')
    expect(onSaveOverview).toHaveBeenCalledOnce()
    expect(onSaveEraSystem).toHaveBeenCalledOnce()
  })

  it('时间线与关键词说明保留各自边界文案', async () => {
    const timeline = await render(createElement(TimelineHistoryHelp))
    const keyword = await render(createElement(KeywordHistoryHelp))
    expect(timeline.textContent).toContain('史实考证模式')
    expect(timeline.textContent).toContain('数字化年份支持负数')
    expect(keyword.textContent).toContain('细节风暴助手')
    expect(keyword.textContent).toContain('器物与科技')
  })
})
