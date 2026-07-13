import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import OutlineGenerationBasis from '../../src/components/outline/OutlineGenerationBasis'
import type { AssembleContextResult } from '../../src/lib/registry/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderBasis(
  context: AssembleContextResult | null,
  { loading = false, error = '' }: { loading?: boolean; error?: string } = {},
) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => {
    root.render(createElement(OutlineGenerationBasis, { context, loading, error }))
  })
  return host
}

function makeContext(overrides: Partial<AssembleContextResult> = {}): AssembleContextResult {
  return {
    text: '',
    segments: [],
    included: [],
    omitted: [],
    trimmed: [],
    totalInputTokens: 0,
    inputBudget: 48_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
    ...overrides,
  }
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('CF-20260702-3 · 大纲生成依据面板', () => {
  it('读取中、失败和未准备三种状态不会误显示旧依据', async () => {
    const loading = await renderBasis(null, { loading: true })
    expect(loading.textContent).toContain('正在读取本次生成依据')
    expect(loading.querySelector('[data-testid="outline-generation-basis"]')).toBeNull()

    const failed = await renderBasis(null, { error: '上下文装配失败' })
    expect(failed.getAttribute('role')).toBeNull()
    expect(failed.querySelector('[role="alert"]')?.textContent).toContain('生成依据读取失败：上下文装配失败')

    const idle = await renderBasis(null)
    expect(idle.textContent).toBe('')
  })

  it('按注册表名称显示已读取来源与故事核心摘要', async () => {
    const host = await renderBasis(makeContext({
      included: ['storyCore', 'worldview'],
      segments: [
        { label: '故事核心', layer: 'L1', content: '【故事核心】\n主线：守住最后的星门', tokens: 12, trimmable: true },
        { label: '世界观', layer: 'L2', content: '【世界观】\n星门文明', tokens: 8, trimmable: true },
      ],
      totalInputTokens: 20,
    }))

    expect(host.textContent).toContain('故事核心')
    expect(host.textContent).toContain('世界观')
    expect(host.textContent).toContain('守住最后的星门')
    expect(host.textContent).not.toContain('未填写故事主线')
  })

  it('没有故事核心时说明主线缺失且未采纳灵感不会进入上下文', async () => {
    const host = await renderBasis(makeContext({
      included: ['worldview'],
      segments: [
        { label: '世界观', layer: 'L2', content: '【世界观】\n星门文明', tokens: 8, trimmable: true },
      ],
      omitted: ['storyCore', 'characters'],
      trimmed: ['historical'],
      totalInputTokens: 8,
    }))

    expect(host.textContent).toContain('未填写故事主线')
    expect(host.textContent).toContain('未采纳的灵感草稿不会进入生成上下文')
    expect(host.textContent).toContain('无可用内容：故事核心、角色档案')
    expect(host.textContent).toContain('因模型上下文预算未发送：历史时间线')
  })
})
