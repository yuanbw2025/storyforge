import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useForeshadowStore } from '../../src/stores/foreshadow'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const runnerMocks = vi.hoisted(() => ({
  generate: vi.fn(),
  readPending: vi.fn(async () => null),
  readRecoverable: vi.fn(async () => null),
  adopt: vi.fn(),
  reject: vi.fn(async () => undefined),
  abandon: vi.fn(async () => undefined),
}))

vi.mock('../../src/lib/ai/client', () => ({
  resolveRequestConfig: (config: unknown) => ({ config }),
}))

vi.mock('../../src/lib/agent/run/foreshadow-suggestions-durable', () => ({
  generateForeshadowSuggestionCandidateV1: runnerMocks.generate,
  readPendingForeshadowSuggestionCandidateV1: runnerMocks.readPending,
  readRecoverableForeshadowSuggestionRunV1: runnerMocks.readRecoverable,
  adoptForeshadowSuggestionCandidateV1: runnerMocks.adopt,
  rejectForeshadowSuggestionCandidateV1: runnerMocks.reject,
  abandonForeshadowSuggestionRunV1: runnerMocks.abandon,
}))

vi.mock('../../src/lib/ai/config-readiness', () => ({
  isAIConfigReady: () => true,
}))

import ForeshadowPanel from '../../src/components/foreshadow/ForeshadowPanel'

describe('R-HARNESS72 · 伏笔建议作者确认 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(async () => {
    await db.delete()
    await db.open()
    useForeshadowStore.setState({ foreshadows: [], loading: false })
    runnerMocks.generate.mockReset()
    runnerMocks.adopt.mockReset()
    runnerMocks.reject.mockReset()
    runnerMocks.readPending.mockResolvedValue(null)
    runnerMocks.readRecoverable.mockResolvedValue(null)
    useAIConfigStore.setState({
      config: {
        provider: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'harness72-ui',
        apiKey: '', temperature: 0.2, maxTokens: 4_000,
      },
    })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    db.close()
  })

  it('候选先可见且正式表零写入，作者选取后才调用 durable 采纳并刷新正式伏笔', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '伏笔 UI', genre: 'suspense', genres: ['suspense'], status: 'drafting',
      description: '', targetWordCount: 0, enableMultiWorld: false,
      createdAt: now, updatedAt: now,
    } as any) as number
    const project = (await db.projects.get(projectId))!
    const candidate = {
      version: 1, kind: 'foreshadow-suggestions-candidate', portable: false,
      projectId, worldId: -1, workId: -1,
      suggestions: [
        { name: '反照的空椅', type: 'symbol', description: '空椅反复出现，结尾揭示被抹去的见证人。' },
        { name: '逆流的钟声', type: 'timeline', description: '钟声与时间方向相反，最终标记真相发生时刻。' },
      ],
    }
    runnerMocks.generate.mockResolvedValue({ snapshot: { run: { id: 72 } }, candidate })
    runnerMocks.adopt.mockImplementation(async () => {
      await db.foreshadows.add({
        projectId, name: '逆流的钟声', type: 'timeline', status: 'planned',
        description: '钟声与时间方向相反，最终标记真相发生时刻。',
        plantChapterId: null, echoChapterIds: '[]', resolveChapterId: null, notes: '',
        createdAt: now, updatedAt: now,
      } as any)
      await useForeshadowStore.getState().loadAll(projectId)
      return { written: 1 }
    })

    await act(async () => {
      root.render(createElement(ToastProvider, null,
        createElement(DialogProvider, null, createElement(ForeshadowPanel, { project }))))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    const suggest = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('AI 建议')) as HTMLButtonElement
    await act(async () => {
      suggest.click()
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await vi.waitFor(() => expect(host.textContent).toContain('反照的空椅'))
    expect(await db.foreshadows.count()).toBe(0)

    const first = host.querySelector<HTMLInputElement>('input[aria-label="选择伏笔候选 1"]')!
    await act(async () => first.click())
    const accept = host.querySelector<HTMLButtonElement>('button[aria-label="确认所选伏笔候选"]')!
    await act(async () => {
      accept.click()
      await vi.waitFor(() => expect(runnerMocks.adopt).toHaveBeenCalled())
      await new Promise(resolve => setTimeout(resolve, 10))
    })
    expect(runnerMocks.adopt).toHaveBeenCalledWith(expect.objectContaining({ runId: 72, selectedIndexes: [1] }))
    expect(await db.foreshadows.toArray()).toEqual([
      expect.objectContaining({ name: '逆流的钟声', status: 'planned' }),
    ])
    expect(host.textContent).toContain('已原子写入 1 条伏笔并完成终验')
  })

  it('挂载时恢复待确认候选且拒绝整批不写正式伏笔', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '伏笔恢复 UI', genre: 'fantasy', genres: ['fantasy'], status: 'drafting',
      description: '', targetWordCount: 0, enableMultiWorld: false,
      createdAt: now, updatedAt: now,
    } as any) as number
    const project = (await db.projects.get(projectId))!
    runnerMocks.readPending.mockResolvedValue({
      snapshot: { run: { id: 73 } },
      candidate: {
        version: 1, kind: 'foreshadow-suggestions-candidate', portable: false,
        projectId, worldId: -1, workId: -1,
        suggestions: [{ name: '镜中缺口', type: 'symbol', description: '镜面缺口最终映出凶手站位。' }],
      },
    })
    await act(async () => {
      root.render(createElement(ToastProvider, null,
        createElement(DialogProvider, null, createElement(ForeshadowPanel, { project }))))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    await act(async () => {
      await vi.waitFor(() => expect(runnerMocks.readPending).toHaveBeenCalled())
      await vi.waitFor(() => expect(host.textContent).toContain('已恢复 1 条待确认伏笔候选'))
    })
    const reject = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('拒绝整批')) as HTMLButtonElement
    await act(async () => {
      reject.click()
      await vi.waitFor(() => expect(runnerMocks.reject).toHaveBeenCalled())
    })
    expect(await db.foreshadows.count()).toBe(0)
    expect(host.textContent).toContain('正式伏笔没有写入')
  })
})
