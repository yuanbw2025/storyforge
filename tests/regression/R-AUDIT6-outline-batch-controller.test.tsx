import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import type { OutlineNode } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  runBatch: vi.fn(),
  adoptItems: vi.fn(),
}))

vi.mock('../../src/lib/ai/batch-outline-runner', () => ({
  runBatchOutlineGeneration: mocks.runBatch,
}))

vi.mock('../../src/lib/outline/adopt-generation', () => ({
  adoptGeneratedOutlineItems: mocks.adoptItems,
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
    projectId: 1,
    multiWorldEnabled: false,
    volumes,
    nodes: volumes,
    hint: '保持连贯',
    assembleContext: vi.fn(async () => assembled('GLOBAL', 'CHARACTERS', 'RULES')),
    reloadOutline: vi.fn(async () => undefined),
    onError: vi.fn(),
    ...patch,
  }
}

beforeEach(() => {
  mocks.runBatch.mockReset()
  mocks.adoptItems.mockReset()
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
    await mount(options({ assembleContext, onError }))

    await act(async () => { await controller.generate() })

    expect(controller.running).toBe(false)
    expect(controller.result).toBeNull()
    expect(onError).toHaveBeenCalledWith('批量生成章节失败：装配失败。')
    expect(mocks.runBatch).not.toHaveBeenCalled()
  })

  it('多世界模式按卷解析世界上下文和世界规则', async () => {
    const assembleContext = vi.fn(async (worldGroupId: number | null, volumeId?: number | null) => (
      volumeId == null
        ? assembled('GLOBAL', 'CHARACTERS', 'GLOBAL_RULES')
        : assembled(`WORLD_${worldGroupId}`, '', `RULES_${volumeId}`)
    ))
    mocks.runBatch.mockImplementation(async (input: any) => {
      expect(input.worldContext).toBe('GLOBAL')
      expect(input.characterContext).toBe('CHARACTERS')
      expect(input.worldRulesContext).toBe('GLOBAL_RULES')
      expect(await input.worldContextResolver(1)).toBe('WORLD_11')
      expect(await input.worldContextResolver(2)).toBe('WORLD_22')
      expect(await input.worldRulesContextResolver(1)).toBe('RULES_1')
      expect(await input.worldRulesContextResolver(2)).toBe('RULES_2')
      return { cancelled: false, chaptersByVolume: new Map([[1, [{ title: '第一章', summary: '开端' }]]]), elapsed: 1 }
    })
    await mount(options({ multiWorldEnabled: true, assembleContext }))

    await act(async () => { await controller.generate() })

    expect(controller.running).toBe(false)
    expect(controller.result?.get(1)?.[0].title).toBe('第一章')
    expect(assembleContext).toHaveBeenCalledWith(11, 1)
    expect(assembleContext).toHaveBeenCalledWith(22, 2)
  })

  it('用户取消会中止请求且不保留部分结果', async () => {
    mocks.runBatch.mockImplementation((input: any) => new Promise(resolve => {
      input.signal.addEventListener('abort', () => resolve({
        cancelled: true,
        chaptersByVolume: new Map([[1, [{ title: '部分结果', summary: '' }]]]),
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
  })

  it('确认结果按卷追加到现有章节末尾，刷新后清空预览', async () => {
    const volumes = [outlineNode(1, 'volume', null, '第一卷')]
    const nodes = [volumes[0], outlineNode(10, 'chapter', 1, '已有章', 0)]
    const reloadOutline = vi.fn(async () => undefined)
    mocks.runBatch.mockResolvedValue({
      cancelled: false,
      chaptersByVolume: new Map([[1, [{ title: '第二章', summary: '继续' }]]]),
      elapsed: 1,
    })
    await mount(options({ volumes, nodes, reloadOutline }))
    await act(async () => { await controller.generate() })
    expect(controller.result).not.toBeNull()

    await act(async () => { await controller.confirm() })

    expect(mocks.adoptItems).toHaveBeenCalledWith({
      projectId: 1,
      parentId: 1,
      type: 'chapter',
      items: [{ title: '第二章', summary: '继续' }],
      startingOrder: 1,
    })
    expect(reloadOutline).toHaveBeenCalledOnce()
    expect(controller.result).toBeNull()
    expect(controller.progress).toBeNull()
  })
})
