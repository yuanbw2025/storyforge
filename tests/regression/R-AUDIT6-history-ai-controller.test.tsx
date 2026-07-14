import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UseAIStreamReturn } from '../../src/hooks/useAIStream'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import type { HistoricalTimelineEvent } from '../../src/lib/types'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'

const mocks = vi.hoisted(() => ({
  assemble: vi.fn(),
  adopt: vi.fn(),
}))

vi.mock('../../src/lib/registry/assemble-context', () => ({ assembleContext: mocks.assemble }))
vi.mock('../../src/lib/registry/adopt', () => ({ adopt: mocks.adopt }))
vi.mock('../../src/stores/prompt', () => ({
  usePromptStore: {
    getState: () => ({
      getActive: (key: string) => {
        const seed = SYSTEM_PROMPT_SEEDS.find(item => item.moduleKey === key)!
        return { ...seed, createdAt: 1, updatedAt: 1 }
      },
    }),
  },
}))

import { useHistoryAI } from '../../src/components/history/useHistoryAI'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function assembled(text: string): AssembleContextResult {
  return {
    text,
    included: ['worldview', 'manualText'],
    segments: [],
    omitted: [],
    trimmed: [],
    totalInputTokens: 2,
    inputBudget: 48_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

function event(id: number, title: string): HistoricalTimelineEvent {
  return {
    id,
    projectId: 1,
    era: 'custom',
    year: id,
    date: `${id}年`,
    title,
    description: `${title}定稿`,
    isHistorical: false,
    createdAt: 1,
    updatedAt: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

function ai(operation: string | null = null) {
  return {
    operation,
    reset: vi.fn(),
    setOperation: vi.fn(),
    start: vi.fn(async () => ''),
  } satisfies Pick<UseAIStreamReturn, 'operation' | 'reset' | 'setOperation' | 'start'>
}

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
let controller: ReturnType<typeof useHistoryAI>

async function mount(patch: Partial<Parameters<typeof useHistoryAI>[0]> = {}) {
  const consultAI = ai()
  const stormAI = ai()
  const options: Parameters<typeof useHistoryAI>[0] = {
    projectId: 1,
    worldGroupId: 9,
    provider: 'deepseek',
    model: 'deepseek-chat',
    overview: '王朝三百年',
    eraSystem: '星历',
    consultAI,
    stormAI,
    reloadEvents: vi.fn(async () => undefined),
    reloadKeywords: vi.fn(async () => undefined),
    onError: vi.fn(),
    ...patch,
  }
  function Harness() {
    controller = useHistoryAI(options)
    return createElement('div', null, controller.consultPreparing ? 'preparing' : 'idle')
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(Harness)))
  return { options, consultAI, stormAI }
}

beforeEach(() => {
  mocks.assemble.mockReset()
  mocks.adopt.mockReset()
  mocks.assemble.mockResolvedValue(assembled('【世界观】默认'))
  mocks.adopt.mockResolvedValue({
    written: [{ id: 1, fields: ['aiConsult'] }],
    aliasMapped: [], unknown: [], typeErrors: [], fkErrors: [], skipped: [],
  })
})

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 历史双 agent controller', () => {
  it('按当前世界组经注册表装配世界观和手动历史摘要后启动考据', async () => {
    const { consultAI } = await mount()
    await act(async () => {
      await controller.run('consult', { kind: 'event', item: event(7, '建城') })
    })

    expect(mocks.assemble).toHaveBeenCalledWith({
      projectId: 1,
      worldGroupId: 9,
      provider: 'deepseek',
      model: 'deepseek-chat',
      sourceKeys: ['worldview', 'manualText'],
      manualSourceText: '【历史总述】王朝三百年\n【纪年体系】星历',
    })
    expect(consultAI.setOperation).toHaveBeenCalledWith('event:7')
    expect(consultAI.start.mock.calls[0][2]).toEqual({ category: 'history.consult', projectId: 1 })
    expect(consultAI.start.mock.calls[0][0].map(message => message.content).join('\n')).toContain('【世界观】默认')
    expect(controller.consultPreparing).toBe(false)
  })

  it('同一 agent 快速切换目标时，晚到的旧上下文不能启动旧请求', async () => {
    const first = deferred<AssembleContextResult>()
    const second = deferred<AssembleContextResult>()
    mocks.assemble
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const { consultAI } = await mount()

    let firstRun!: Promise<void>
    let secondRun!: Promise<void>
    await act(async () => {
      firstRun = controller.run('consult', { kind: 'event', item: event(1, '旧目标') })
      await Promise.resolve()
      secondRun = controller.run('consult', { kind: 'event', item: event(2, '新目标') })
      await Promise.resolve()
    })
    await act(async () => {
      second.resolve(assembled('NEW'))
      await secondRun
    })
    await act(async () => {
      first.resolve(assembled('OLD'))
      await firstRun
    })

    expect(consultAI.start).toHaveBeenCalledOnce()
    expect(consultAI.start.mock.calls[0][0].map(message => message.content).join('\n')).toContain('新目标')
    expect(controller.consultEventId).toBe(2)
    expect(controller.consultPreparing).toBe(false)
  })

  it('上下文装配失败会复位 agent 并显示错误', async () => {
    const onError = vi.fn()
    mocks.assemble.mockRejectedValue(new Error('读取损坏'))
    const { consultAI } = await mount({ onError })

    await act(async () => {
      await controller.run('consult', { kind: 'event', item: event(3, '失败目标') })
    })

    expect(consultAI.start).not.toHaveBeenCalled()
    expect(consultAI.reset).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith('历史 AI 准备失败：读取损坏。')
    expect(controller.consultPreparing).toBe(false)
  })

  it('采纳考据结果只通过 adopt 定点写回并刷新事件列表', async () => {
    const reloadEvents = vi.fn(async () => undefined)
    const { consultAI } = await mount({ reloadEvents })
    await act(async () => {
      await controller.run('consult', { kind: 'event', item: event(7, '建城') })
    })
    await act(async () => { await controller.accept('consult', '可信考据') })

    expect(mocks.adopt).toHaveBeenCalledWith({
      projectId: 1,
      worldGroupId: 9,
      target: 'historicalTimelineEvents',
      recordId: 7,
      mode: 'replace',
      data: { aiConsult: '可信考据' },
    })
    expect(reloadEvents).toHaveBeenCalledOnce()
    expect(consultAI.reset).toHaveBeenCalledOnce()
    expect(controller.consultEventId).toBeNull()
  })
})
