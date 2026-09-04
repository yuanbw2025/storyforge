import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssembleContextResult } from '../../src/lib/registry/types'

const mocks = vi.hoisted(() => {
  const outputs: Record<string, string> = {
    'outline.workshop.scan': '扫描结果：边界清楚',
    'outline.workshop.motivation': '动机结果：林舟要查明真相',
    'outline.workshop.collision': '碰撞结果：林舟试探，守卫误判，双方升级',
    'review.outline-workshop': JSON.stringify({
      advisories: [],
      cognitionReferences: [],
      canonClaims: [],
    }),
    'outline.workshop.scenes': JSON.stringify({
      openingHook: '承接夜色',
      endingCliffhanger: '门后传来脚步',
      sceneLocation: '密室',
      emotionArc: 'rising',
      appearingCharacterIds: [],
      foreshadowIds: [],
      prohibitions: ['不能提前知情'],
      scenes: [{
        title: '潜入',
        summary: '林舟潜入密室',
        location: '密室',
        conflict: '躲避守卫',
        pace: 'fast',
        characterIds: [],
        estimatedWords: 1200,
      }],
      cognitionReferences: [],
      canonClaims: [],
    }),
  }
  return {
    start: vi.fn(async (_messages: unknown, _config: unknown, meta?: { category?: string }) => (
      outputs[meta?.category ?? ''] ?? ''
    )),
  }
})

vi.mock('../../src/hooks/useAIStream', () => ({
  useAIStream: () => ({
    output: '',
    isStreaming: false,
    error: null,
    tokenUsage: null,
    operation: null,
    start: mocks.start,
    stop: vi.fn(),
    reset: vi.fn(),
    setOperation: vi.fn(),
  }),
}))

vi.mock('../../src/lib/registry/assemble-context', () => ({
  assembleContext: vi.fn(async (): Promise<AssembleContextResult> => ({
    text: '登记上下文',
    included: ['chapterOutline'],
    segments: [{
      label: '章纲',
      layer: 'L1',
      content: '【本章大纲】夜探密室',
      tokens: 5,
      trimmable: false,
    }],
    omitted: [],
    trimmed: [],
    totalInputTokens: 5,
    inputBudget: 48_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  })),
}))

vi.mock('../../src/lib/consistency/held-items', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/lib/consistency/held-items')>()
  return { ...original, readProjectHeldItems: vi.fn(async () => []) }
})

vi.mock('../../src/lib/knowledge-ledger/knowledge-ledger', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/lib/knowledge-ledger/knowledge-ledger')>()
  return {
    ...original,
    readCognitionAuditSnapshot: vi.fn(async () => ({ catalog: [], projected: [] })),
  }
})

vi.mock('../../src/lib/fact-ledger/setting-assertions', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/lib/fact-ledger/setting-assertions')>()
  return { ...original, readCanonAssertions: vi.fn(async () => []) }
})

import ChapterOutlineWorkshop from '../../src/components/outline/ChapterOutlineWorkshop'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

afterEach(async () => {
  mocks.start.mockClear()
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

async function mount() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  const onAdopt = vi.fn(async () => true)
  const onClose = vi.fn()
  await act(async () => {
    root.render(createElement(ChapterOutlineWorkshop, {
      project: {
        id: 1,
        name: '工坊测试',
        genres: [],
        description: '',
        targetWordCount: 0,
        enableMultiWorld: false,
        createdAt: 1,
        updatedAt: 1,
      },
      chapter: {
        id: 2,
        projectId: 1,
        parentId: null,
        type: 'chapter',
        title: '第三章 夜探',
        summary: '林舟潜入密室',
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      nodes: [{
        id: 2,
        projectId: 1,
        parentId: null,
        type: 'chapter',
        title: '第三章 夜探',
        summary: '林舟潜入密室',
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      }],
      characters: [],
      onAdopt,
      onClose,
    }))
    await Promise.resolve()
    await Promise.resolve()
  })
  return { host, onAdopt, onClose }
}

function button(host: HTMLElement, text: string): HTMLButtonElement {
  return Array.from(host.querySelectorAll('button'))
    .find(item => item.textContent?.includes(text)) as HTMLButtonElement
}

describe('PIPELINE-2 · 章纲工坊 UI 状态机', () => {
  it('严格按五步确认并在最终作者确认后才请求采纳', async () => {
    const { host, onAdopt, onClose } = await mount()
    expect(host.textContent).toContain('预计调用 5 次模型')
    expect(button(host, '2. 动机推演').disabled).toBe(true)

    const expectedStages = [
      ['现状扫描', '扫描结果'],
      ['动机推演', '动机结果'],
      ['碰撞预演', '碰撞结果'],
      ['质量闸门', '"advisories":[]'],
    ]
    for (const [stage, output] of expectedStages) {
      expect(host.textContent).toContain(`当前：${stage}`)
      await act(async () => {
        button(host, '生成本步').click()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toContain(output)
      await act(async () => {
        button(host, '确认本步并进入下一步').click()
        await Promise.resolve()
      })
    }

    expect(host.textContent).toContain('当前：场景卡')
    await act(async () => {
      button(host, '生成本步').click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(onAdopt).not.toHaveBeenCalled()
    await act(async () => {
      button(host, '确认采纳场景卡').click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.start.mock.calls.map(call => call[2]?.category)).toEqual([
      'outline.workshop.scan',
      'outline.workshop.motivation',
      'outline.workshop.collision',
      'review.outline-workshop',
      'outline.workshop.scenes',
    ])
    expect(onAdopt).toHaveBeenCalledOnce()
    expect(onAdopt.mock.calls[0][0]).toContain('"prohibitions"')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
