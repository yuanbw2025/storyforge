import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoricalTimelineEvent, WorkspaceScope } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  adopt: vi.fn(),
  reject: vi.fn(),
  abandon: vi.fn(),
  pending: vi.fn(),
  recoverable: vi.fn(),
  resolveScope: vi.fn(),
}))

vi.mock('../../src/lib/agent/run/history-agent-durable', () => ({
  generateHistoryAgentCandidateV1: mocks.generate,
  adoptHistoryAgentCandidateV1: mocks.adopt,
  rejectHistoryAgentCandidateV1: mocks.reject,
  abandonHistoryAgentRunV1: mocks.abandon,
  readPendingHistoryAgentCandidateV1: mocks.pending,
  readRecoverableHistoryAgentRunV1: mocks.recoverable,
}))
vi.mock('../../src/lib/world-engine/scope', () => ({ resolveScopeLike: mocks.resolveScope }))

import { useHistoryAI } from '../../src/components/history/useHistoryAI'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const scope: WorkspaceScope = { projectId: 1, worldId: 2, workId: 3 }
const event: HistoricalTimelineEvent = {
  id: 7, projectId: 1, era: 'custom', year: 1, date: '元年', title: '建城',
  description: '建城定稿', isHistorical: false, createdAt: 1, updatedAt: 1,
}

function candidate(mode: 'consult' | 'storm' = 'consult', targetId = 7) {
  return {
    request: { mode, targetKind: 'event', targetId, worldGroupId: 9 },
    result: mode === 'consult' ? '持久考据候选' : '持久风暴候选',
  } as any
}

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
let controller: ReturnType<typeof useHistoryAI>

async function mount(patch: Partial<Parameters<typeof useHistoryAI>[0]> = {}) {
  const options: Parameters<typeof useHistoryAI>[0] = {
    projectId: 1,
    worldGroupId: 9,
    aiConfig: { provider: 'deepseek', model: 'deepseek-chat' } as any,
    reloadEvents: vi.fn(async () => undefined),
    reloadKeywords: vi.fn(async () => undefined),
    onError: vi.fn(),
    ...patch,
  }
  function Harness() {
    controller = useHistoryAI(options)
    return createElement('div', null, controller.consult.busy ? 'busy' : 'idle')
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => {
    root.render(createElement(Harness))
    await Promise.resolve()
    await Promise.resolve()
  })
  return options
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveScope.mockResolvedValue(scope)
  mocks.pending.mockResolvedValue(null)
  mocks.recoverable.mockResolvedValue(null)
  mocks.generate.mockResolvedValue({ snapshot: { run: { id: 41 } }, candidate: candidate() })
  mocks.adopt.mockResolvedValue({ snapshot: { projection: { state: 'completed' } } })
  mocks.reject.mockResolvedValue({ projection: { state: 'cancelled' } })
  mocks.abandon.mockResolvedValue({ projection: { state: 'cancelled' } })
})

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 历史双 Agent durable controller', () => {
  it('按当前 World/Work/世界组和目标启动持久生成，不再装配组件内 manualText', async () => {
    await mount()
    await act(async () => { await controller.run('consult', { kind: 'event', item: event }) })
    expect(mocks.generate).toHaveBeenCalledWith({
      scope,
      worldGroupId: 9,
      mode: 'consult',
      targetKind: 'event',
      targetId: 7,
      aiConfig: expect.objectContaining({ provider: 'deepseek', model: 'deepseek-chat' }),
    })
    expect(controller.consult.candidate?.result).toBe('持久考据候选')
    expect(controller.consultEventId).toBe(7)
  })

  it('刷新时恢复 checkpoint 候选且不调用模型', async () => {
    mocks.pending.mockImplementation(async (input: { mode?: string }) => input.mode === 'consult'
      ? { snapshot: { run: { id: 51 } }, candidate: candidate('consult', 8) }
      : null)
    await mount()
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(controller.consult.runId).toBe(51)
    expect(controller.consultEventId).toBe(8)
    expect(controller.consult.message).toContain('没有重复调用模型')
  })

  it('生成失败会暴露不可自动重试运行并保留显式放弃入口', async () => {
    mocks.generate.mockRejectedValue(new Error('网络结果未知'))
    const options = await mount()
    mocks.recoverable.mockImplementation(async (input: { mode?: string }) => input.mode === 'consult'
      ? { snapshot: { run: { id: 61 } }, safeToResume: false }
      : null)
    await act(async () => { await controller.run('consult', { kind: 'event', item: event }) })
    expect(controller.consult.unsafeRunId).toBe(61)
    expect(options.onError).toHaveBeenCalledWith('历史 Agent 生成失败：网络结果未知。')
    await act(async () => { await controller.abandonUnsafe('consult') })
    expect(mocks.abandon).toHaveBeenCalledWith({ scope, runId: 61 })
  })

  it('确认只调用 durable 采纳并刷新对应目标列表', async () => {
    const reloadEvents = vi.fn(async () => undefined)
    await mount({ reloadEvents })
    await act(async () => { await controller.run('consult', { kind: 'event', item: event }) })
    await act(async () => { await controller.accept('consult') })
    expect(mocks.adopt).toHaveBeenCalledWith({ scope, runId: 41 })
    expect(reloadEvents).toHaveBeenCalledOnce()
    expect(controller.consult.candidate).toBeNull()
  })
})
