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
  it('总述与纪年阅读原文，进入源码后将最终文本交原保存回调', async () => {
    const onSaveOverview = vi.fn(async () => undefined)
    const onSaveEraSystem = vi.fn(async () => undefined)
    const host = await render(createElement(HistoryOverviewTab, {
      overview: '旧总述', eraSystem: '旧纪年', onSaveOverview, onSaveEraSystem,
    }))
    expect(host.querySelectorAll('[data-markdown-read-view]')).toHaveLength(2)
    const values = ['新总述', '新纪年']
    for (let i = 0; i < values.length; i++) {
      const view = host.querySelectorAll('[data-markdown-read-view]')[i]
      await act(async () => [...view.querySelectorAll('button')].find(button => button.textContent === '编辑源码')!.click())
      const area = host.querySelector('textarea')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, values[i])
        area.dispatchEvent(new Event('input', { bubbles: true }))
        area.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
      })
    }
    expect(onSaveOverview).toHaveBeenCalledWith('新总述')
    expect(onSaveEraSystem).toHaveBeenCalledWith('新纪年')
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
