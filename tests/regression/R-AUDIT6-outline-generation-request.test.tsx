import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OutlineGenerationRequestPanel from '../../src/components/outline/OutlineGenerationRequestPanel'
import {
  decodeGenerationOperation,
  encodeGenerationOperation,
  outlineGenerationModuleKey,
  type OutlineGenerationRequest,
  type PreparedGenerationContext,
} from '../../src/components/outline/outline-generation'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(request: OutlineGenerationRequest, patch: Record<string, unknown> = {}) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(OutlineGenerationRequestPanel, {
    request,
    preparedContext: null,
    loading: false,
    error: '',
    onRetry: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
    ...patch,
  })))
  return host
}

function preparedContext(operation: string): PreparedGenerationContext {
  return {
    operation,
    assembled: {
      text: '作品上下文',
      segments: [],
      included: [],
      omitted: [],
      trimmed: [],
      totalInputTokens: 12,
      inputBudget: 48_000,
      overBudgetBeforeTrim: false,
      overBudgetAfterTrim: false,
    },
  }
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 大纲生成请求边界', () => {
  it('四种请求的 session operation 可逆且保持模块归属', () => {
    const requests: OutlineGenerationRequest[] = [
      { kind: 'volumes' },
      { kind: 'chapters', volumeId: 7 },
      { kind: 'single-volume', volumeId: 8 },
      { kind: 'single-chapter', chapterId: 9 },
    ]

    for (const request of requests) {
      expect(decodeGenerationOperation(encodeGenerationOperation(request))).toEqual(request)
    }
    expect(outlineGenerationModuleKey(requests[0])).toBe('outline.volume')
    expect(outlineGenerationModuleKey(requests[1])).toBe('outline.chapter')
    expect(decodeGenerationOperation('outline.volume')).toEqual({ kind: 'volumes' })
    expect(decodeGenerationOperation('outline.chapter:single:not-a-number')).toBeNull()
  })

  it('四种请求显示原有动作名称，单章说明不受本卷章节数影响', async () => {
    const cases: Array<[OutlineGenerationRequest, string]> = [
      [{ kind: 'volumes' }, '批量生成卷级大纲'],
      [{ kind: 'chapters', volumeId: 7 }, '生成本卷所有章节'],
      [{ kind: 'single-volume', volumeId: 8 }, 'AI 生成本卷卷纲'],
      [{ kind: 'single-chapter', chapterId: 9 }, 'AI 生成本章章纲'],
    ]

    for (const [request, label] of cases) {
      const host = await mount(request)
      expect(host.textContent).toContain(label)
      if (request.kind === 'single-chapter') {
        expect(host.textContent).toContain('本卷章节数”不参与本次调用')
      }
    }
  })

  it('读取中和失败时禁止确认，并保留取消与重新读取命令', async () => {
    const onRetry = vi.fn()
    const onCancel = vi.fn()
    const loadingHost = await mount({ kind: 'volumes' }, { loading: true, onCancel })
    const loadingConfirm = Array.from(loadingHost.querySelectorAll('button')).find(button => button.textContent?.includes('确认生成'))!
    expect(loadingConfirm.disabled).toBe(true)
    expect(loadingHost.textContent).toContain('正在读取本次生成依据')
    await act(async () => Array.from(loadingHost.querySelectorAll('button')).find(button => button.textContent?.includes('取消'))!.click())
    expect(onCancel).toHaveBeenCalledOnce()

    const errorHost = await mount({ kind: 'chapters', volumeId: 7 }, { error: '装配失败', onRetry })
    const errorConfirm = Array.from(errorHost.querySelectorAll('button')).find(button => button.textContent?.includes('确认生成'))!
    expect(errorConfirm.disabled).toBe(true)
    expect(errorHost.textContent).toContain('生成依据读取失败：装配失败')
    await act(async () => Array.from(errorHost.querySelectorAll('button')).find(button => button.textContent?.includes('重新读取'))!.click())
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('上下文准备完成后才允许确认生成', async () => {
    const request: OutlineGenerationRequest = { kind: 'single-volume', volumeId: 8 }
    const onConfirm = vi.fn()
    const host = await mount(request, {
      preparedContext: preparedContext(encodeGenerationOperation(request)),
      onConfirm,
    })
    const confirm = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('确认生成'))!
    expect(confirm.disabled).toBe(false)
    expect(host.textContent).toContain('本次生成依据')
    await act(async () => confirm.click())
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
