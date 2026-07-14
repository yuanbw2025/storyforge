import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UseAIStreamReturn } from '../../src/hooks/useAIStream'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import type { OutlineNode, Project } from '../../src/lib/types'
import { useOutlineGenerationController } from '../../src/components/outline/useOutlineGenerationController'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function node(id: number, type: OutlineNode['type'], parentId: number | null, title: string): OutlineNode {
  return {
    id,
    projectId: 1,
    type,
    parentId,
    title,
    summary: `${title}摘要`,
    order: id,
    createdAt: 1,
    updatedAt: 1,
  }
}

function assembled(text: string): AssembleContextResult {
  return {
    text,
    included: ['storyCore'],
    segments: [{ label: '故事核心', layer: 'L1', content: '守住主线', tokens: 1, trimmable: true }],
    omitted: [],
    trimmed: [],
    totalInputTokens: 1,
    inputBudget: 48_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

const project: Project = {
  id: 1,
  name: '控制器测试',
  genre: '玄幻',
  description: '',
  targetWordCount: 500_000,
  enableMultiWorld: true,
  createdAt: 1,
  updatedAt: 1,
}

const volumes = [
  { ...node(1, 'volume', null, '第一卷'), worldGroupId: 11 },
  { ...node(2, 'volume', null, '第二卷'), worldGroupId: 22 },
]

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
let controller: ReturnType<typeof useOutlineGenerationController>

function createAI(operation: string | null = null) {
  return {
    operation,
    reset: vi.fn(),
    setOperation: vi.fn(),
    start: vi.fn(async () => ''),
  } satisfies Pick<UseAIStreamReturn, 'operation' | 'reset' | 'setOperation' | 'start'>
}

async function mount(patch: Partial<Parameters<typeof useOutlineGenerationController>[0]> = {}) {
  const ai = createAI()
  const options: Parameters<typeof useOutlineGenerationController>[0] = {
    project,
    nodes: volumes,
    volumes,
    hint: '',
    runOptions: {},
    ai,
    assembleContext: vi.fn(async () => assembled('GLOBAL')),
    openPromptPanel: vi.fn(),
    clearPreview: vi.fn(),
    onInfo: vi.fn(),
    onError: vi.fn(),
    ...patch,
  }
  function Harness() {
    controller = useOutlineGenerationController(options)
    return createElement('div', null, controller.contextLoading ? 'loading' : 'idle')
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(Harness)))
  return { options, ai }
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 大纲生成 controller', () => {
  it('快速切换请求时，旧上下文晚到也不能覆盖新请求', async () => {
    const first = deferred<AssembleContextResult>()
    const second = deferred<AssembleContextResult>()
    const assembleContext = vi.fn((_worldGroupId: number | null, volumeId?: number | null) => (
      volumeId === 1 ? first.promise : second.promise
    ))
    await mount({ assembleContext })

    let firstPending!: Promise<void>
    let secondPending!: Promise<void>
    await act(async () => {
      firstPending = controller.prepare({ kind: 'chapters', volumeId: 1 })
      await Promise.resolve()
      secondPending = controller.prepare({ kind: 'chapters', volumeId: 2 })
      await Promise.resolve()
    })
    await act(async () => {
      second.resolve(assembled('SECOND'))
      await secondPending
    })
    expect(controller.pendingRequest).toEqual({ kind: 'chapters', volumeId: 2 })
    expect(controller.preparedContext?.operation).toBe('outline.chapter:batch:2')
    expect(controller.preparedContext?.assembled.text).toBe('SECOND')

    await act(async () => {
      first.resolve(assembled('FIRST'))
      await firstPending
    })
    expect(controller.pendingRequest).toEqual({ kind: 'chapters', volumeId: 2 })
    expect(controller.preparedContext?.assembled.text).toBe('SECOND')
  })

  it('确认使用预检快照执行，不重复装配上下文', async () => {
    const assembleContext = vi.fn(async () => assembled('SNAPSHOT'))
    const ai = createAI()
    await mount({ ai, assembleContext })

    await act(async () => { await controller.prepare({ kind: 'chapters', volumeId: 1 }) })
    await act(async () => { await controller.confirm() })

    expect(assembleContext).toHaveBeenCalledOnce()
    expect(ai.setOperation).toHaveBeenCalledWith('outline.chapter:batch:1')
    expect(ai.start).toHaveBeenCalledOnce()
    expect(ai.start.mock.calls[0][2]).toEqual({ category: 'outline.chapter', projectId: 1 })
    expect(controller.pendingRequest).toBeNull()
  })

  it('重试时上下文装配失败会重置会话并反馈，不产生悬空异常', async () => {
    const ai = createAI('outline.volume:batch')
    const onError = vi.fn()
    const assembleContext = vi.fn(async () => { throw new Error('上下文损坏') })
    await mount({ ai, onError, assembleContext })

    await act(async () => { await controller.retry() })

    expect(ai.start).not.toHaveBeenCalled()
    expect(ai.reset).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('准备大纲生成时出错：上下文损坏。')
  })

  it('取消预检会使在途结果失效并清空请求状态', async () => {
    const pending = deferred<AssembleContextResult>()
    await mount({ assembleContext: vi.fn(() => pending.promise) })

    let preparation!: Promise<void>
    await act(async () => {
      preparation = controller.prepare({ kind: 'single-volume', volumeId: 1 })
      await Promise.resolve()
    })
    await act(async () => controller.cancel())
    expect(controller.pendingRequest).toBeNull()
    expect(controller.contextLoading).toBe(false)

    await act(async () => {
      pending.resolve(assembled('LATE'))
      await preparation
    })
    expect(controller.preparedContext).toBeNull()
  })
})
