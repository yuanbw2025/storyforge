import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceScope } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  generate: vi.fn(),
  adopt: vi.fn(),
  reject: vi.fn(),
  abandon: vi.fn(),
  pending: vi.fn(),
  recoverable: vi.fn(),
  resolveScope: vi.fn(),
}))

vi.mock('../../src/lib/agent/run/reference-derived-durable', () => ({
  generateReferenceDerivedCandidateV1: mocks.generate,
  adoptReferenceDerivedCandidateV1: mocks.adopt,
  rejectReferenceDerivedCandidateV1: mocks.reject,
  abandonReferenceDerivedRunV1: mocks.abandon,
  readPendingReferenceDerivedCandidateV1: mocks.pending,
  readRecoverableReferenceDerivedRunV1: mocks.recoverable,
}))
vi.mock('../../src/lib/workspace/scope', () => ({ resolveScopeLike: mocks.resolveScope }))

import { useReferenceDerivedAI } from '../../src/components/project/useReferenceDerivedAI'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const scope: WorkspaceScope = { projectId: 1, worldId: 2, workId: 3 }

function candidate(mode: 'summary' | 'characters' = 'summary', resultJson = '{"narrativeStyle":"总结"}') {
  return {
    request: { mode, runId: 9 },
    resultJson,
  } as any
}

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
let controller: ReturnType<typeof useReferenceDerivedAI>

async function mount(patch: Partial<Parameters<typeof useReferenceDerivedAI>[0]> = {}) {
  const options: Parameters<typeof useReferenceDerivedAI>[0] = {
    projectId: 1,
    analysisRunId: 9,
    aiConfig: { provider: 'deepseek', model: 'deepseek-chat' } as any,
    onCommitted: vi.fn(),
    onError: vi.fn(),
    ...patch,
  }
  function Harness() {
    controller = useReferenceDerivedAI(options)
    return createElement('div', null, controller.summary.busy ? 'busy' : 'idle')
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

describe('R-HARNESS74 · 参考分析派生 durable controller', () => {
  it('挂载恢复完成前保持 busy，阻止快速点击制造重复模型运行', async () => {
    let release!: (value: null) => void
    mocks.pending.mockReturnValue(new Promise(resolve => { release = resolve }))
    await mount()

    expect(controller.summary.busy).toBe(true)
    await act(async () => { await controller.run('summary') })
    expect(mocks.generate).not.toHaveBeenCalled()

    await act(async () => {
      release(null)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(controller.summary.busy).toBe(false)
  })

  it('重试先拒绝旧候选，再绕过旧 React 快照启动一个新 durable Run', async () => {
    mocks.generate
      .mockResolvedValueOnce({ snapshot: { run: { id: 41 } }, candidate: candidate() })
      .mockResolvedValueOnce({ snapshot: { run: { id: 42 } }, candidate: candidate('summary', '{"narrativeStyle":"新总结"}') })
    await mount()

    await act(async () => { await controller.run('summary') })
    expect(controller.summary.runId).toBe(41)
    await act(async () => { await controller.retry('summary') })

    expect(mocks.reject).toHaveBeenCalledWith({ scope, runId: 41 })
    expect(mocks.generate).toHaveBeenCalledTimes(2)
    expect(controller.summary.runId).toBe(42)
    expect(controller.summary.candidate?.resultJson).toContain('新总结')
  })

  it('确认只调用 durable 采纳，并把原候选结果交给版本视图刷新', async () => {
    const onCommitted = vi.fn()
    await mount({ onCommitted })
    await act(async () => { await controller.run('summary') })
    await act(async () => { await controller.accept('summary') })

    expect(mocks.adopt).toHaveBeenCalledWith({ scope, runId: 41 })
    expect(onCommitted).toHaveBeenCalledWith('summary', '{"narrativeStyle":"总结"}')
    expect(controller.summary.candidate).toBeNull()
  })
})
