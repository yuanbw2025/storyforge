import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import type { OutlineNode } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  runBatch: vi.fn(),
  adoptItems: vi.fn(),
  restoreBatch: vi.fn(),
  beginAdoption: vi.fn(),
  commitAdoption: vi.fn(),
  rejectCandidate: vi.fn(),
}))

vi.mock('../../src/lib/ai/batch-outline-runner', () => ({
  runBatchOutlineGeneration: mocks.runBatch,
}))

vi.mock('../../src/lib/outline/adopt-generation', () => ({
  adoptGeneratedOutlineItems: mocks.adoptItems,
}))

vi.mock('../../src/lib/outline/harness', () => ({
  restoreLatestOutlineGenerationBatchV1: mocks.restoreBatch,
  beginOutlineGenerationAdoptionV1: mocks.beginAdoption,
  commitOutlineGenerationAdoptionV1: mocks.commitAdoption,
  rejectOutlineGenerationCandidateV1: mocks.rejectCandidate,
}))

import { useOutlineBatchGeneration } from '../../src/components/outline/useOutlineBatchGeneration'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function outlineNode(id: number, type: OutlineNode['type'], parentId: number | null, title: string, order = 0): OutlineNode {
  return {
    id,
    projectId: 1,
    type,
    parentId,
    title,
    summary: '',
    order,
    createdAt: 1,
    updatedAt: 1,
  }
}

function assembled(text: string, characters = '', worldRules = ''): AssembleContextResult {
  const entries = [
    characters ? ['characters', '角色档案', characters] : null,
    worldRules ? ['worldRules', '世界规则', worldRules] : null,
  ].filter(Boolean) as string[][]
  return {
    text,
    included: entries.map(entry => entry[0]),
    segments: entries.map(entry => ({ label: entry[1], layer: 'L1', content: entry[2], tokens: 1, trimmable: true })),
    omitted: [],
    trimmed: [],
    totalInputTokens: entries.length,
    inputBudget: 48_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

function candidate(volumeId: number, batchIndex = 0): any {
  return {
    version: 1,
    type: 'outline-generation-candidate',
    projectId: 1,
    worldGroupId: null,
    runId: 100 + volumeId,
    stepId: `outline.chapter:batch:${volumeId}`,
    operation: `outline.chapter:batch:${volumeId}`,
    candidateHash: String(volumeId).padStart(64, 'a'),
    conversationId: 10,
    candidateEventId: 20 + volumeId,
    output: '[{"title":"第一章","summary":"开端"}]',
    batch: { batchGroupId: 'outline-batch-test', batchIndex, batchTotal: 2 },
  }
}

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
let controller: ReturnType<typeof useOutlineBatchGeneration>

async function mount(options: Parameters<typeof useOutlineBatchGeneration>[0]) {
  function Harness() {
    controller = useOutlineBatchGeneration(options)
    return createElement('div', null, controller.running ? 'running' : 'idle')
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(Harness)))
  return host
}

function options(patch: Partial<Parameters<typeof useOutlineBatchGeneration>[0]> = {}) {
  const volumes = [
    { ...outlineNode(1, 'volume', null, '第一卷'), worldGroupId: 11 },
    { ...outlineNode(2, 'volume', null, '第二卷', 1), worldGroupId: 22 },
  ]
  return {
    project: { id: 1, name: '测试项目', genre: '幻想', createdAt: 1, updatedAt: 1 } as any,
    multiWorldEnabled: false,
    volumes,
    nodes: volumes,
    hint: '保持连贯',
    runOptions: {},
    assembleContext: vi.fn(async () => assembled('GLOBAL', 'CHARACTERS', 'RULES')),
    reloadOutline: vi.fn(async () => undefined),
    onInfo: vi.fn(),
    onError: vi.fn(),
    ...patch,
  }
}

beforeEach(() => {
  mocks.runBatch.mockReset()
  mocks.adoptItems.mockReset()
  mocks.restoreBatch.mockReset()
  mocks.beginAdoption.mockReset()
  mocks.commitAdoption.mockReset()
  mocks.rejectCandidate.mockReset()
  mocks.restoreBatch.mockResolvedValue(null)
  mocks.beginAdoption.mockResolvedValue(undefined)
  mocks.commitAdoption.mockResolvedValue(undefined)
  mocks.rejectCandidate.mockResolvedValue(undefined)
  mocks.adoptItems.mockResolvedValue({ writtenCount: 1, firstId: 10, skippedReasons: [] })
})

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 · 批量章纲 controller', () => {
  it('基础上下文装配失败后退出运行态并反馈错误', async () => {
    const onError = vi.fn()
    const assembleContext = vi.fn(async () => { throw new Error('装配失败') })
    mocks.runBatch.mockImplementation(async (input: any) => {
      await input.assembleContext({ volume: input.volumes[0] })
      throw new Error('不应到达')
    })
    await mount(options({ assembleContext, onError }))

    await act(async () => { await controller.generate() })

    expect(controller.running).toBe(false)
    expect(controller.result).toBeNull()
    expect(onError).toHaveBeenCalledWith('批量生成章节失败：装配失败。')
    expect(mocks.runBatch).toHaveBeenCalledOnce()
  })

  it('多世界模式按卷解析世界上下文和世界规则', async () => {
    const assembleContext = vi.fn(async (worldGroupId: number | null, volumeId?: number | null) => (
      volumeId == null
        ? assembled('GLOBAL', 'CHARACTERS', 'GLOBAL_RULES')
        : assembled(`WORLD_${worldGroupId}`, '', `RULES_${volumeId}`)
    ))
    mocks.runBatch.mockImplementation(async (input: any) => {
      expect((await input.assembleContext({ volume: input.volumes[0] })).text).toBe('WORLD_11')
      expect((await input.assembleContext({
        volume: input.volumes[1],
        priorOutlineCandidateText: 'PRIOR',
      })).text).toBe('WORLD_22')
      const firstCandidate = candidate(1)
      return {
        batchGroupId: 'outline-batch-test',
        cancelled: false,
        chaptersByVolume: new Map([[1, [{ title: '第一章', summary: '开端' }]]]),
        candidatesByVolume: new Map([[1, firstCandidate]]),
        failures: [],
        elapsed: 1,
      }
    })
    await mount(options({ multiWorldEnabled: true, assembleContext }))

    await act(async () => { await controller.generate() })

    expect(controller.running).toBe(false)
    expect(controller.result?.get(1)?.[0].title).toBe('第一章')
    expect(assembleContext).toHaveBeenCalledWith(11, 1, undefined)
    expect(assembleContext).toHaveBeenCalledWith(22, 2, 'PRIOR')
  })

  it('用户取消会中止请求且不保留部分结果', async () => {
    const partialCandidate = candidate(1)
    mocks.runBatch.mockImplementation((input: any) => new Promise(resolve => {
      input.signal.addEventListener('abort', () => resolve({
        batchGroupId: 'outline-batch-test',
        cancelled: true,
        chaptersByVolume: new Map([[1, [{ title: '部分结果', summary: '' }]]]),
        candidatesByVolume: new Map([[1, partialCandidate]]),
        failures: [],
        elapsed: 1,
      }))
    }))
    await mount(options())

    let pending!: Promise<void>
    await act(async () => {
      pending = controller.generate()
      await Promise.resolve()
    })
    expect(controller.running).toBe(true)
    await act(async () => {
      controller.cancel()
      await pending
    })

    expect(controller.running).toBe(false)
    expect(controller.result).toBeNull()
    expect(mocks.rejectCandidate).toHaveBeenCalledWith(
      partialCandidate,
      '作者取消了批量章纲生成，已生成候选不进入正式数据。',
    )
  })

  it('刷新后恢复同一批次的全部待确认候选，关闭时逐卷留下拒绝证据', async () => {
    const first = candidate(1, 0)
    const second = {
      ...candidate(2, 1),
      output: '[{"title":"第二卷第一章","summary":"续程"}]',
    }
    mocks.restoreBatch.mockResolvedValue({
      batchGroupId: 'outline-batch-test',
      batchTotal: 2,
      candidates: [first, second],
    })
    await mount(options())
    await act(async () => { await Promise.resolve(); await Promise.resolve() })

    expect(controller.result?.get(1)?.[0].title).toBe('第一章')
    expect(controller.result?.get(2)?.[0].title).toBe('第二卷第一章')

    await act(async () => { await controller.dismiss() })
    expect(mocks.rejectCandidate).toHaveBeenCalledTimes(2)
    expect(controller.result).toBeNull()
  })

  it('确认结果按卷追加到现有章节末尾，刷新后清空预览', async () => {
    const volumes = [outlineNode(1, 'volume', null, '第一卷')]
    const nodes = [volumes[0], outlineNode(10, 'chapter', 1, '已有章', 0)]
    const reloadOutline = vi.fn(async () => undefined)
    mocks.runBatch.mockResolvedValue({
      batchGroupId: 'outline-batch-test',
      cancelled: false,
      chaptersByVolume: new Map([[1, [{ title: '第二章', summary: '继续' }]]]),
      candidatesByVolume: new Map([[1, candidate(1)]]),
      failures: [],
      elapsed: 1,
    })
    await mount(options({ volumes, nodes, reloadOutline }))
    await act(async () => { await controller.generate() })
    expect(controller.result).not.toBeNull()

    await act(async () => { await controller.confirm() })

    expect(mocks.adoptItems).toHaveBeenCalledWith({
      projectId: 1,
      worldGroupId: null,
      parentId: 1,
      type: 'chapter',
      items: [{ title: '第二章', summary: '继续' }],
      startingOrder: 1,
    })
    expect(mocks.beginAdoption).toHaveBeenCalledOnce()
    expect(mocks.commitAdoption).toHaveBeenCalledOnce()
    expect(reloadOutline).toHaveBeenCalledOnce()
    expect(controller.result).toBeNull()
    expect(controller.progress).toBeNull()
  })
})
