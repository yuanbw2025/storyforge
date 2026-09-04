import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorldGroup } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({
  updateGroup: vi.fn(async () => undefined),
  resolveScopeLike: vi.fn(async () => ({
    projectId: 1,
    worldId: 11,
    workId: 12,
  })),
  generate: vi.fn(),
  readPending: vi.fn(),
  readRecoverable: vi.fn(),
  adopt: vi.fn(async () => undefined),
  reject: vi.fn(async () => undefined),
  abandon: vi.fn(async () => undefined),
}))

vi.mock('../../src/stores/world-group', () => ({
  useWorldGroupStore: () => ({ updateGroup: mocks.updateGroup }),
}))

vi.mock('../../src/stores/ai-config', () => ({
  useAIConfigStore: (selector: (state: { config: Record<string, unknown> }) => unknown) => selector({
    config: {
      provider: 'ollama',
      baseUrl: 'http://localhost:1234/v1',
      model: 'harness67-ui',
    },
  }),
}))

vi.mock('../../src/lib/workspace/scope', () => ({
  resolveScopeLike: mocks.resolveScopeLike,
}))

vi.mock('../../src/lib/agent/run/worldview-expand-durable', () => ({
  WORLDVIEW_EXPAND_STEP_ID_V1: 'world-origin:worldview-expand',
  generateWorldviewExpandCandidateV1: mocks.generate,
  readPendingWorldviewExpandCandidateV1: mocks.readPending,
  readRecoverableWorldviewExpandRunV1: mocks.readRecoverable,
  adoptWorldviewExpandCandidateV1: mocks.adopt,
  rejectWorldviewExpandCandidateV1: mocks.reject,
  abandonWorldviewExpandRunV1: mocks.abandon,
}))

import WorldGroupDetail from '../../src/components/world-group/WorldGroupDetail'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const group = {
  id: 7,
  projectId: 1,
  worldId: 11,
  name: '潮汐主世界',
  description: '每逢黑潮，港城会遗忘一段共同历史。',
  type: 'primary',
  icon: '🌊',
  order: 0,
  createdAt: 1,
  updatedAt: 1,
} as WorldGroup

const candidate = {
  version: 1,
  skillId: 'world-origin.worldview-expand',
  executionMode: 'worldview-expand',
  values: {
    worldOrigin: '黑潮来自被封存的旧纪元。',
    powerHierarchy: '守灯人通过记忆契约维持力量。',
    continentLayout: '群岛围绕沉没的钟塔分布。',
    climateByRegion: '外海终年暴雨，内港受潮汐钟庇护。',
    races: '人类、潮裔与失忆者共同生活。',
    factionLayout: '灯塔议会与拾忆者长期对峙。',
  },
} as any

const scope = { projectId: 1, worldId: 11, workId: 12 }
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderDetail() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(WorldGroupDetail, {
    group,
    onBack: vi.fn(),
  })))
  await vi.waitFor(() => expect(mocks.readPending).toHaveBeenCalledWith({
    scope,
    worldGroupId: 7,
  }))
  return host
}

function setTextareaValue(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

function button(host: HTMLElement, label: string) {
  return Array.from(host.querySelectorAll('button'))
    .find(item => item.textContent?.includes(label)) as HTMLButtonElement
}

beforeEach(() => {
  mocks.readPending.mockResolvedValue(null)
  mocks.readRecoverable.mockResolvedValue(null)
  mocks.generate.mockResolvedValue({
    candidate,
    snapshot: { run: { id: 67 } },
  })
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS67 · 世界组六字段扩写 UI', () => {
  it('未保存的名称、类型或描述禁止进入模型调用', async () => {
    const host = await renderDetail()
    const description = host.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="这个世界的核心特征、氛围、独特之处..."]',
    )!
    await act(async () => setTextareaValue(description, '这是尚未保存的新描述。'))
    await act(async () => button(host, 'AI 扩写世界观').click())

    expect(mocks.generate).not.toHaveBeenCalled()
    expect(host.textContent).toContain('请先保存草稿')
  })

  it('一次生成只展示 durable 候选，作者确认后才调用正式采纳', async () => {
    const host = await renderDetail()
    await act(async () => button(host, 'AI 扩写世界观').click())

    expect(mocks.generate).toHaveBeenCalledTimes(1)
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      scope,
      worldGroupId: 7,
    }))
    expect(host.textContent).toContain('六字段世界观候选尚未写入')
    expect(host.textContent).toContain(candidate.values.worldOrigin)
    expect(mocks.adopt).not.toHaveBeenCalled()

    await act(async () => button(host, '确认写入六字段').click())
    expect(mocks.adopt).toHaveBeenCalledWith({ scope, worldGroupId: 7, runId: 67 })
    expect(host.textContent).toContain('已写入世界观')
  })

  it('刷新恢复候选时不重复生成，并允许作者明确放弃', async () => {
    mocks.readPending.mockResolvedValue({
      candidate,
      snapshot: { run: { id: 68 } },
    })
    const host = await renderDetail()

    await vi.waitFor(() => expect(host.textContent).toContain('六字段世界观候选尚未写入'))
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(button(host, 'AI 扩写世界观').disabled).toBe(true)

    await act(async () => button(host, '放弃候选').click())
    expect(mocks.reject).toHaveBeenCalledWith({ scope, worldGroupId: 7, runId: 68 })
    expect(host.textContent).not.toContain('六字段世界观候选尚未写入')
  })

  it('未知模型结果窗口只允许放弃，不自动重试', async () => {
    mocks.readRecoverable.mockResolvedValue({
      safeToResume: false,
      snapshot: { run: { id: 69 } },
    })
    const host = await renderDetail()

    await vi.waitFor(() => expect(host.textContent).toContain('系统不会自动重试'))
    expect(button(host, 'AI 扩写世界观').disabled).toBe(true)
    expect(mocks.generate).not.toHaveBeenCalled()

    await act(async () => button(host, '放弃未知运行').click())
    expect(mocks.abandon).toHaveBeenCalledWith({ scope, runId: 69 })
    expect(host.textContent).not.toContain('系统不会自动重试')
  })

  it('刷新发现已确认但未终验的运行时只续跑同一采纳，不开放拒绝或重复生成', async () => {
    mocks.readRecoverable.mockResolvedValue({
      safeToResume: true,
      adoptionPending: true,
      candidate,
      snapshot: {
        run: { id: 70 },
        projection: { steps: {} },
      },
    })
    const host = await renderDetail()

    await vi.waitFor(() => expect(host.textContent).toContain('六字段采纳等待恢复终验'))
    expect(host.textContent).toContain('不会重复调用模型')
    expect(button(host, 'AI 扩写世界观').disabled).toBe(true)
    expect(button(host, '放弃候选')).toBeUndefined()

    await act(async () => button(host, '继续写入与终验').click())
    expect(mocks.adopt).toHaveBeenCalledWith({ scope, worldGroupId: 7, runId: 70 })
    expect(mocks.generate).not.toHaveBeenCalled()
  })
})
