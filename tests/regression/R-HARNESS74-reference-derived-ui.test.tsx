import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalysisReportViewer from '../../src/components/project/AnalysisReportViewer'
import { ToastProvider } from '../../src/components/shared/Toast'
import type {
  Reference,
  ReferenceAnalysisRun,
  ReferenceChunkAnalysis,
} from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const controller = vi.hoisted(() => ({
  useReferenceDerivedAI: vi.fn(),
  run: vi.fn(),
  accept: vi.fn(),
  reject: vi.fn(),
  retry: vi.fn(),
  abandonUnsafe: vi.fn(),
}))

vi.mock('../../src/components/project/useReferenceDerivedAI', () => ({
  useReferenceDerivedAI: controller.useReferenceDerivedAI,
}))

const emptyLane = () => ({
  candidate: null,
  runId: null,
  busy: false,
  message: null,
  unsafeRunId: null,
  adoptionPending: false,
})

function reference(): Reference {
  return {
    id: 8,
    projectId: 1,
    workId: 2,
    title: '镜城纪事',
    author: '测试作者',
    type: 'story',
    note: '',
    url: '',
    createdAt: 1,
    updatedAt: 1,
  }
}

function run(): ReferenceAnalysisRun {
  return {
    id: 9,
    projectId: 1,
    workId: 2,
    referenceId: 8,
    version: 1,
    status: 'active',
    depth: 'deep',
    sourceFilename: 'mirror.md',
    fileHash: 'hash',
    totalChars: 300,
    sourceKind: 'own-work',
    usageScope: 'creative-reference',
    rightsNote: '',
    rightsConfirmed: true,
    rightsDeclaredAt: 1,
    expectedChunks: 1,
    completedChunks: 1,
    progress: 100,
    createdAt: 1,
    updatedAt: 1,
  }
}

function chunks(): ReferenceChunkAnalysis[] {
  return [{
    id: 10,
    projectId: 1,
    workId: 2,
    referenceId: 8,
    analysisRunId: 9,
    chunkIndex: 0,
    label: '第一章',
    narrativeStyle: '有限视角在关键证词处切换。',
    characterCraft: '林照雪以克制行动推动角色弧。',
    createdAt: 1,
  }]
}

function setController(summary = emptyLane(), characters = emptyLane()) {
  controller.useReferenceDerivedAI.mockReturnValue({
    summary,
    characters,
    run: controller.run,
    accept: controller.accept,
    reject: controller.reject,
    retry: controller.retry,
    abandonUnsafe: controller.abandonUnsafe,
  })
}

describe('R-HARNESS74 · 参考分析派生 Agent 作者确认 UI', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    controller.useReferenceDerivedAI.mockReset()
    controller.run.mockReset()
    controller.accept.mockReset()
    controller.reject.mockReset()
    controller.retry.mockReset()
    controller.abandonUnsafe.mockReset()
    setController()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
  })

  async function mount() {
    await act(async () => root.render(createElement(ToastProvider, null,
      createElement(AnalysisReportViewer, {
        reference: reference(), run: run(), chunks: chunks(), isHistorical: false,
      }))))
  }

  it('总结和角色入口只启动各自 durable lane', async () => {
    await mount()
    const summary = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('AI 全书总结'))!
    const characters = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('AI 整理角色卡'))!

    await act(async () => summary.click())
    await act(async () => characters.click())

    expect(controller.run.mock.calls).toEqual([['summary'], ['characters']])
  })

  it('持久候选可预览，并把确认、拒绝和重试路由到原运行', async () => {
    setController({
      ...emptyLane(),
      runId: 74,
      message: '候选已持久化；确认前不会写入分析版本或参考投影。',
      candidate: {
        resultJson: JSON.stringify({ narrativeStyle: '全书以受限视角维持证词悬念。' }),
      },
    }, {
      ...emptyLane(),
      runId: 75,
      candidate: {
        resultJson: JSON.stringify([{
          name: '林照雪', role: '主角', summary: '冷静的查证者', analysis: '用行动而非自述呈现变化。',
        }]),
      },
    })
    await mount()

    expect(host.textContent).toContain('全书总结持久候选')
    expect(host.textContent).toContain('全书以受限视角维持证词悬念。')
    expect(host.textContent).toContain('角色卡聚合持久候选')
    expect(host.textContent).toContain('林照雪')

    const summaryPanel = host.querySelector<HTMLElement>('[data-testid="reference-derived-summary-candidate"]')!
    const buttons = Array.from(summaryPanel.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent?.includes('确认写入'))!.click())
    await act(async () => buttons.find(button => button.textContent?.includes('拒绝'))!.click())
    await act(async () => buttons.find(button => button.textContent?.includes('重试'))!.click())

    expect(controller.accept).toHaveBeenCalledWith('summary')
    expect(controller.reject).toHaveBeenCalledWith('summary')
    expect(controller.retry).toHaveBeenCalledWith('summary')
  })

  it('结果不可判定窗口只允许显式放弃，不自动暴露重试按钮', async () => {
    setController({
      ...emptyLane(),
      unsafeRunId: 76,
      message: '上次运行停在模型结果不可判定窗口，系统不会自动重试。请先放弃旧运行。',
    })
    await mount()

    const panel = host.querySelector<HTMLElement>('[data-testid="reference-derived-summary-candidate"]')!
    expect(panel.textContent).toContain('系统不会自动重试')
    expect(Array.from(panel.querySelectorAll('button')).some(button => button.textContent?.includes('重试'))).toBe(false)
    await act(async () => Array.from(panel.querySelectorAll('button'))
      .find(button => button.textContent?.includes('放弃不可判定运行'))!.click())
    expect(controller.abandonUnsafe).toHaveBeenCalledWith('summary')
  })
})
