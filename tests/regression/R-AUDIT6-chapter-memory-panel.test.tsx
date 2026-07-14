import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChapterMemoryPanel from '../../src/components/editor/ChapterMemoryPanel'
import type { ChapterPlanReconciliation } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

const reconciliation: ChapterPlanReconciliation = {
  chapterId: 1,
  sourceTextHash: 'text-hash',
  planSourceHash: 'plan-hash',
  schemaVersion: 1,
  extractorVersion: 'test',
  textNormalizationVersion: 'v1',
  completedGoals: [{
    text: '主角抵达城门',
    evidenceQuotes: [{ quote: '城门就在眼前', startOffset: 0, endOffset: 7 }],
  }],
  unfinishedGoals: [{ text: '尚未入城', evidenceQuotes: [] }],
  deviations: [],
  newConstraints: [],
  nextChapterImpacts: [],
  proposedOutlineSummary: '主角抵达城门但尚未入城。',
  reviewStatus: 'pending',
  generatedAt: 1,
}

async function mount(patch: Record<string, unknown> = {}) {
  const props = {
    summary: undefined,
    hasText: true,
    memoryBusy: false,
    reconciliation: undefined,
    reconciliationCurrent: false,
    onGenerateMemory: vi.fn(),
    onConfirmActualProgress: vi.fn(),
    onApplyOutlineCandidate: vi.fn(),
    ...patch,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(ChapterMemoryPanel, props)))
  return { host, props }
}

function button(host: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(host.querySelectorAll('button')).find(item => item.textContent?.trim() === label)
  if (!match) throw new Error(`missing button: ${label}`)
  return match
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 章节记忆与计划对账视图', () => {
  it('无摘要时展示生成入口，并准确转发生成命令与忙碌态', async () => {
    const ready = await mount()
    expect(ready.host.textContent).toContain('改完正文后生成章节记忆')
    await act(async () => button(ready.host, '生成章节记忆').click())
    expect(ready.props.onGenerateMemory).toHaveBeenCalledOnce()

    const busy = await mount({ memoryBusy: true })
    expect(button(busy.host, '生成中...').disabled).toBe(true)
  })

  it('摘要可刷新，失效对账只显示刷新提示', async () => {
    const stale = await mount({
      summary: '旧章节摘要',
      reconciliation: { ...reconciliation, reviewStatus: 'confirmed-constraint' },
      reconciliationCurrent: false,
    })
    expect(stale.host.textContent).toContain('旧章节摘要')
    expect(stale.host.textContent).toContain('刷新章节记忆')
    expect(stale.host.textContent).toContain('计划对账已因正文或章纲变化而失效')
    expect(stale.host.textContent).not.toContain('计划—正文对账')
  })

  it('当前待确认对账展示分类、证据并转发两种处理命令', async () => {
    const current = await mount({ reconciliation, reconciliationCurrent: true })
    expect(current.host.textContent).toContain('计划—正文对账')
    expect(current.host.textContent).toContain('已完成：主角抵达城门')
    expect(current.host.textContent).toContain('证据：“城门就在眼前”')
    expect(current.host.textContent).toContain('未完成：尚未入城')
    await act(async () => button(current.host, '确认并附加实际进展约束').click())
    await act(async () => button(current.host, '用候选更新本章章纲').click())
    expect(current.props.onConfirmActualProgress).toHaveBeenCalledOnce()
    expect(current.props.onApplyOutlineCandidate).toHaveBeenCalledOnce()
  })
})
