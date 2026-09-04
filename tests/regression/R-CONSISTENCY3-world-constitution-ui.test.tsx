import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'

const scope = { projectId: 1, worldId: 11, workId: 12 }
const candidate = {
  sources: [{ sourceKey: 'worldviews:7:worldOrigin' }],
  assertions: [{
    subjectType: 'worldGroup', subjectId: 5, predicate: 'magicSource', value: '月亮潮汐',
    sourceKey: 'worldviews:7:worldOrigin', quote: '魔法源于月亮潮汐',
  }],
} as any

const mocks = vi.hoisted(() => ({
  load: vi.fn(async () => undefined),
  confirmFact: vi.fn(),
  replaceConstitutionFact: vi.fn(),
  rejectFact: vi.fn(),
  resolveScopeLike: vi.fn(async () => ({ projectId: 1, worldId: 11, workId: 12 })),
  generate: vi.fn(),
  readPending: vi.fn(),
  readRecoverable: vi.fn(),
  adopt: vi.fn(async () => ({ written: 1 })),
  reject: vi.fn(async () => undefined),
  abandon: vi.fn(async () => undefined),
}))

vi.mock('../../src/stores/ai-config', () => ({
  useAIConfigStore: (selector: (state: { config: Record<string, unknown> }) => unknown) => selector({
    config: { provider: 'ollama', baseUrl: 'http://localhost:1234/v1', model: 'harness69-ui' },
  }),
}))

vi.mock('../../src/stores/fact-ledger', () => ({
  useFactLedgerStore: () => ({
    facts: [{
      id: 3, projectId: 1, workId: 12, worldGroupId: 5, subjectWorldGroupId: 5,
      subjectName: '曜月界', predicate: 'magicSource', factKind: 'state', value: '月亮潮汐',
      sourceType: 'setting', sourceRecordTable: 'worldviews', sourceField: 'worldOrigin',
      sourceQuote: '魔法源于月亮潮汐', status: 'candidate', locked: false,
      createdAt: 1, updatedAt: 1,
    }],
    loading: false,
    load: mocks.load,
    confirmFact: mocks.confirmFact,
    replaceConstitutionFact: mocks.replaceConstitutionFact,
    rejectFact: mocks.rejectFact,
  }),
}))

vi.mock('../../src/lib/workspace/scope', () => ({ resolveScopeLike: mocks.resolveScopeLike }))

vi.mock('../../src/lib/agent/run/constitution-extraction-durable', () => ({
  generateConstitutionExtractionCandidateV1: mocks.generate,
  readPendingConstitutionExtractionCandidateV1: mocks.readPending,
  readRecoverableConstitutionExtractionRunV1: mocks.readRecoverable,
  adoptConstitutionExtractionCandidateV1: mocks.adopt,
  rejectConstitutionExtractionCandidateV1: mocks.reject,
  abandonConstitutionExtractionRunV1: mocks.abandon,
}))

import WorldConstitutionPanel from '../../src/components/facts/WorldConstitutionPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const project = {
  id: 1,
  workspaceUid: 'WS-00000000-0000-4000-8000-000000000001',
  workspacePurpose: 'independent-work',
  name: 'UI', activeWorldId: 11, activeWorkId: 12,
  createdAt: 1, updatedAt: 1,
} as Project
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

function button(host: HTMLElement, label: string) {
  return Array.from(host.querySelectorAll('button'))
    .find(item => item.textContent?.includes(label)) as HTMLButtonElement
}

async function renderPanel(projectOverride: Project = project) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(WorldConstitutionPanel, {
    project: projectOverride,
    onShowFacts: () => undefined,
  })))
  await vi.waitFor(() => expect(mocks.readPending).toHaveBeenCalledWith({ scope }))
  return { host, root }
}

beforeEach(() => {
  mocks.readPending.mockResolvedValue(null)
  mocks.readRecoverable.mockResolvedValue(null)
  mocks.generate.mockResolvedValue({ candidate, snapshot: { run: { id: 69 } } })
})

afterEach(async () => {
  vi.clearAllMocks()
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('R-HARNESS69 · 世界宪法 durable 扫描 UI', () => {
  it('展示既有事实证据；一次扫描只展示 durable 批次，确认后才写事实候选', async () => {
    const { host } = await renderPanel()
    expect(host.textContent).toContain('月亮潮汐')
    expect(host.textContent).toContain('worldviews.worldOrigin')
    expect(host.querySelector('button[title="确认世界宪法"]')).not.toBeNull()

    await act(async () => button(host, '扫描已登记设定').click())
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ scope }))
    expect(host.textContent).toContain('扫描批次待确认（1 条）')
    expect(host.textContent).toContain('尚未写入事实库')
    expect(host.textContent).toContain('不会直接成为 Canon')
    expect(mocks.adopt).not.toHaveBeenCalled()

    await act(async () => button(host, '确认写入事实候选').click())
    expect(mocks.adopt).toHaveBeenCalledWith({ scope, runId: 69 })
    expect(mocks.load).toHaveBeenLastCalledWith(1)
  })

  it('刷新恢复待确认批次，不重复调用模型，并允许作者否决', async () => {
    mocks.readPending.mockResolvedValue({ candidate, snapshot: { run: { id: 70 } } })
    const { host } = await renderPanel()
    await vi.waitFor(() => expect(host.textContent).toContain('已恢复待确认扫描批次'))
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(button(host, '扫描已登记设定').disabled).toBe(true)
    await act(async () => button(host, '否决本批扫描').click())
    expect(mocks.reject).toHaveBeenCalledWith({ scope, runId: 70 })
  })

  it('未知模型结果只允许放弃，不自动重试', async () => {
    mocks.readRecoverable.mockResolvedValue({ safeToResume: false, snapshot: { run: { id: 71 } } })
    const { host } = await renderPanel()
    await vi.waitFor(() => expect(host.textContent).toContain('系统不会自动重试'))
    expect(button(host, '扫描已登记设定').disabled).toBe(true)
    await act(async () => button(host, '放弃不可判定运行').click())
    expect(mocks.abandon).toHaveBeenCalledWith({ scope, runId: 71 })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('刷新发现已确认批次时只续跑同一采纳，不开放否决', async () => {
    mocks.readRecoverable.mockResolvedValue({
      safeToResume: true,
      adoptionPending: true,
      candidate,
      snapshot: { run: { id: 72 } },
    })
    const { host } = await renderPanel()
    await vi.waitFor(() => expect(host.textContent).toContain('不会重复调用模型'))
    expect(button(host, '否决本批扫描')).toBeUndefined()
    await act(async () => button(host, '继续已确认写入').click())
    expect(mocks.adopt).toHaveBeenCalledWith({ scope, runId: 72 })
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('活跃 World/Work 变化时重新解析作用域，不沿用旧候选', async () => {
    const { root } = await renderPanel({ ...project, activeWorldId: 11, activeWorkId: 12 })
    const nextScope = { projectId: 1, worldId: 21, workId: 22 }
    mocks.resolveScopeLike.mockResolvedValueOnce(nextScope)
    await act(async () => root.render(createElement(WorldConstitutionPanel, {
      project: { ...project, activeWorldId: 21, activeWorkId: 22 },
      onShowFacts: () => undefined,
    })))
    await vi.waitFor(() => expect(mocks.readPending).toHaveBeenCalledWith({ scope: nextScope }))
  })
})
