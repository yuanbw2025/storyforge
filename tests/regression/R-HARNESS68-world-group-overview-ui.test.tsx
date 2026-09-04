import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project, WorldGroup } from '../../src/lib/types'

const groups: WorldGroup[] = [{
  id: 7, projectId: 1, worldId: 11, name: '归潮港', description: '所有潮汐门的起点。',
  type: 'primary', icon: '⚓', order: 0, createdAt: 1, updatedAt: 1,
} as WorldGroup, {
  id: 8, projectId: 1, worldId: 11, name: '盐镜界', description: '倒悬镜海。',
  type: 'parallel', icon: '🪞', order: 1, createdAt: 1, updatedAt: 1,
} as WorldGroup]

const links = [{
  id: 9, projectId: 1, worldId: 11, fromGroupId: 7, toGroupId: 8,
  linkType: 'portal', name: '盐镜门', description: '退潮时开启', bidirectional: false,
  createdAt: 1, updatedAt: 1,
}]

const mocks = vi.hoisted(() => ({
  loadAll: vi.fn(async () => undefined),
  ensurePrimaryGroup: vi.fn(async () => 7),
  createGroup: vi.fn(async () => 8),
  deleteGroup: vi.fn(async () => undefined),
  createLink: vi.fn(async () => 1),
  updateLink: vi.fn(async () => undefined),
  deleteLink: vi.fn(async () => undefined),
  resolveScopeLike: vi.fn(async () => ({ projectId: 1, worldId: 11, workId: 12 })),
  generate: vi.fn(),
  readPending: vi.fn(),
  readRecoverable: vi.fn(),
  adopt: vi.fn(async () => undefined),
  reject: vi.fn(async () => undefined),
  abandon: vi.fn(async () => undefined),
}))

vi.mock('../../src/stores/world-group', () => ({
  useWorldGroupStore: () => ({
    groups,
    links,
    loading: false,
    loadAll: mocks.loadAll,
    ensurePrimaryGroup: mocks.ensurePrimaryGroup,
    createGroup: mocks.createGroup,
    deleteGroup: mocks.deleteGroup,
    createLink: mocks.createLink,
    updateLink: mocks.updateLink,
    deleteLink: mocks.deleteLink,
  }),
}))

vi.mock('../../src/stores/ai-config', () => ({
  useAIConfigStore: (selector: (state: { config: Record<string, unknown> }) => unknown) => selector({
    config: { provider: 'ollama', baseUrl: 'http://localhost:1234/v1', model: 'harness68-ui' },
  }),
}))

vi.mock('../../src/lib/workspace/scope', () => ({ resolveScopeLike: mocks.resolveScopeLike }))

vi.mock('../../src/lib/agent/run/world-suggest-durable', () => ({
  generateWorldSuggestCandidateV1: mocks.generate,
  readPendingWorldSuggestCandidateV1: mocks.readPending,
  readRecoverableWorldSuggestRunV1: mocks.readRecoverable,
  adoptWorldSuggestCandidateV1: mocks.adopt,
  rejectWorldSuggestCandidateV1: mocks.reject,
  abandonWorldSuggestRunV1: mocks.abandon,
}))

vi.mock('../../src/components/world-group/WorldRelationGraph', () => ({ default: () => null }))

import WorldGroupOverview from '../../src/components/world-group/WorldGroupOverview'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project = {
  id: 1,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000000001',
  workspacePurpose: 'world-engine',
  name: '诸界航路',
  enableMultiWorld: true,
  activeWorldId: 11,
  activeWorkId: 12,
  createdAt: 1,
  updatedAt: 1,
} as Project

const candidate = {
  authorConcept: '挑战主角对记忆和身份的选择',
  worlds: [{
    name: '灰烬钟庭', type: 'traversal', description: '燃尽未来换取当下力量。',
    entryCondition: '敲响无主铜钟', powerRestriction: '高阶能力会遗忘未来计划', plannedChapterCount: 18,
  }, {
    name: '星梯上界', type: 'ascension', description: '漂浮阶梯连接不同重力层级。',
    entryCondition: '集齐三枚坐标', powerRestriction: '只携带一个核心能力', plannedChapterCount: 24,
  }],
} as any

const scope = { projectId: 1, worldId: 11, workId: 12 }
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function renderOverview() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(WorldGroupOverview, { project })))
  await vi.waitFor(() => expect(mocks.readPending).toHaveBeenCalledWith({ scope }))
  await act(async () => undefined)
  if (!host.querySelector('textarea')) {
    await act(async () => button(host, 'AI 建议世界').click())
  }
  return host
}

function button(host: HTMLElement, label: string) {
  return Array.from(host.querySelectorAll('button'))
    .find(item => item.textContent?.includes(label)) as HTMLButtonElement
}

function setTextareaValue(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

beforeEach(() => {
  mocks.readPending.mockResolvedValue(null)
  mocks.readRecoverable.mockResolvedValue(null)
  mocks.generate.mockResolvedValue({ candidate, snapshot: { run: { id: 68 } } })
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS68 · 世界建议 UI', () => {
  it('一次生成只展示 durable 候选，选择后才统一确认写入', async () => {
    const host = await renderOverview()
    const textarea = host.querySelector('textarea')!
    await act(async () => setTextareaValue(textarea, '挑战主角身份'))
    await act(async () => button(host, '生成建议').click())

    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
      scope,
      authorConcept: '挑战主角身份',
    }))
    expect(host.textContent).toContain('世界建议候选尚未写入')
    expect(host.textContent).toContain('灰烬钟庭')
    expect(mocks.adopt).not.toHaveBeenCalled()

    const choices = Array.from(host.querySelectorAll('button')).filter(item => item.textContent?.includes('选择'))
    await act(async () => (choices[0] as HTMLButtonElement).click())
    await act(async () => button(host, '确认写入所选 1 项').click())
    expect(mocks.adopt).toHaveBeenCalledWith({ scope, runId: 68, selectedIndexes: [0] })
    expect(mocks.createGroup).not.toHaveBeenCalled()
  })

  it('刷新恢复整批候选，不重复生成，并允许作者放弃', async () => {
    mocks.readPending.mockResolvedValue({ candidate, snapshot: { run: { id: 69 } } })
    const host = await renderOverview()

    await vi.waitFor(() => expect(host.textContent).toContain('世界建议候选尚未写入'))
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(button(host, '生成建议').disabled).toBe(true)
    await act(async () => button(host, '放弃整批候选').click())
    expect(mocks.reject).toHaveBeenCalledWith({ scope, runId: 69 })
  })

  it('未知模型结果只允许放弃，不自动重试', async () => {
    mocks.readRecoverable.mockResolvedValue({ safeToResume: false, snapshot: { run: { id: 70 } } })
    const host = await renderOverview()

    await vi.waitFor(() => expect(host.textContent).toContain('系统不会自动重试'))
    expect(button(host, '生成建议').disabled).toBe(true)
    await act(async () => button(host, '放弃未知运行').click())
    expect(mocks.abandon).toHaveBeenCalledWith({ scope, runId: 70 })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('刷新发现已确认选择时只续跑同一采纳，不开放改选或拒绝', async () => {
    mocks.readRecoverable.mockResolvedValue({
      safeToResume: true,
      adoptionPending: true,
      selectedIndexes: [1],
      candidate,
      snapshot: { run: { id: 71 } },
    })
    const host = await renderOverview()

    await vi.waitFor(() => expect(host.textContent).toContain('世界选择已确认，等待恢复终验'))
    expect(host.textContent).toContain('不会重复调用模型')
    expect(button(host, '放弃整批候选')).toBeUndefined()
    expect(button(host, '已选择').disabled).toBe(true)
    await act(async () => button(host, '继续写入与终验').click())
    expect(mocks.adopt).toHaveBeenCalledWith({ scope, runId: 71 })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('同项目活跃 World/Work 变化时重新解析作用域，不沿用旧候选', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    mounted.push({ host, root })
    await act(async () => root.render(createElement(WorldGroupOverview, {
      project: { ...project, activeWorldId: 11, activeWorkId: 12 },
    })))
    await vi.waitFor(() => expect(mocks.readPending).toHaveBeenCalledWith({ scope }))

    const nextScope = { projectId: 1, worldId: 21, workId: 22 }
    mocks.resolveScopeLike.mockResolvedValueOnce(nextScope)
    await act(async () => root.render(createElement(WorldGroupOverview, {
      project: { ...project, activeWorldId: 21, activeWorkId: 22 },
    })))
    await vi.waitFor(() => expect(mocks.readPending).toHaveBeenCalledWith({ scope: nextScope }))
    expect(mocks.loadAll).toHaveBeenLastCalledWith(nextScope)
    expect(mocks.ensurePrimaryGroup).toHaveBeenLastCalledWith(nextScope)
  })

  it('作者可以编辑通道方向、双向性和描述，而不是只能删除重建', async () => {
    const host = await renderOverview()
    const edit = host.querySelector('button[title="编辑关系"]') as HTMLButtonElement
    expect(edit).toBeTruthy()
    await act(async () => edit.click())
    expect(host.textContent).toContain('编辑世界通道')
    expect((host.querySelector('textarea[placeholder*="通道触发方式"]') as HTMLTextAreaElement).value)
      .toBe('退潮时开启')
    const checkbox = host.querySelector('input[type="checkbox"]') as HTMLInputElement
    await act(async () => checkbox.click())
    await act(async () => button(host, '保存关系').click())
    expect(mocks.updateLink).toHaveBeenCalledWith(9, expect.objectContaining({
      fromGroupId: 7, toGroupId: 8, name: '盐镜门', description: '退潮时开启', bidirectional: true,
    }))
  })
})
