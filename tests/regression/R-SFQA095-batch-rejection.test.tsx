import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutlineGenerationCandidateV1 } from '../../src/lib/outline/harness'
import type { BatchOutlineResult } from '../../src/lib/ai/batch-outline-runner'
import type { ChatMessage, OutlineNode } from '../../src/lib/types'

const mocks = vi.hoisted(() => ({ run: vi.fn(), reject: vi.fn(), restore: vi.fn() }))
vi.mock('../../src/lib/ai/batch-outline-runner', async original => ({ ...await original<typeof import('../../src/lib/ai/batch-outline-runner')>(), runBatchOutlineGeneration: mocks.run }))
vi.mock('../../src/lib/outline/harness', async original => ({ ...await original<typeof import('../../src/lib/outline/harness')>(), rejectOutlineGenerationCandidateV1: mocks.reject, restoreLatestOutlineGenerationBatchV1: mocks.restore }))

import { useOutlineBatchGeneration } from '../../src/components/outline/useOutlineBatchGeneration'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { prepareOutlineGatewayAssemblyV1 } from '../../src/lib/outline/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let fixture: Awaited<ReturnType<typeof seedCurrentWorkspace>>
let volumes: OutlineNode[]
let candidates: OutlineGenerationCandidateV1[]
let host: HTMLDivElement
let root: Root | undefined
let controller: ReturnType<typeof useOutlineBatchGeneration>

async function mount() {
  function Harness() {
    const [error, setError] = useState('')
    controller = useOutlineBatchGeneration({
      project: fixture.project, work: fixture.work, multiWorldEnabled: false, volumes, nodes: volumes, hint: '', runOptions: {},
      assembleContext: () => { throw new Error('Replacement generation was not authorized through the rejection barrier') },
      reloadOutline: async () => {}, onInfo: () => {}, onError: setError,
    })
    return createElement('section', null,
      createElement('p', { role: 'alert' }, error),
      ...[...(controller.result ?? [])].map(([id, chapters]) => createElement('p', { key: id, 'data-volume': id }, chapters.map(chapter => chapter.summary).join('\n'))),
    )
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(createElement(Harness)))
  await until(() => candidates.length ? controller.result?.size === candidates.length : controller.result === null)
}
async function until(test: () => boolean) {
  for (let i = 0; i < 100 && !test(); i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  expect(test()).toBe(true)
}

beforeEach(async () => {
  mocks.run.mockReset(); mocks.reject.mockReset(); mocks.restore.mockReset()
  await db.delete(); await db.open()
  fixture = await seedCurrentWorkspace('SFQA095隔离批次')
  const ids = await db.outlineNodes.bulkAdd([0, 1].map(index => stampNewRecord(fixture.scope, 'outlineNodes', { parentId: null, type: 'volume', title: `卷${index}`, summary: `卷${index}主线`, order: index, createdAt: 1, updatedAt: 1 }, { owner: 'work' }) as OutlineNode), { allKeys: true })
  volumes = await db.outlineNodes.bulkGet(ids) as OutlineNode[]
  candidates = volumes.map((volume, index) => ({ version: 1, type: 'outline-generation-candidate', projectId: fixture.scope.projectId, worldGroupId: null, runId: index + 100, stepId: `outline.chapter:batch:${volume.id}`, operation: `outline.chapter:batch:${volume.id}`, candidateHash: `${index}`.repeat(64), conversationId: 10, candidateEventId: index + 20, output: JSON.stringify([{ title: `卷${index}第一章`, summary: `候选${index}` }]), batch: { batchGroupId: 'outline-batch-sfqa095', batchIndex: index, batchTotal: 2 } }))
  mocks.restore.mockImplementation(async () => ({ batchGroupId: 'outline-batch-sfqa095', batchTotal: 2, candidates }))
  mocks.reject.mockResolvedValue(undefined)
})
afterEach(async () => { if (root) { await act(async () => root!.unmount()); root = undefined; host.remove() } vi.restoreAllMocks(); db.close() })

describe('SFQA-095 · only durable rejection success clears visible candidates', () => {
  it('keeps precisely the failed volume and its author edits, then retries only that volume', async () => {
    mocks.reject.mockRejectedValueOnce(new Error('receipt-write-failure')).mockResolvedValue(undefined)
    await mount()
    const edited = controller.result!.get(volumes[0].id!)![0]
    edited.summary = '作者修改必须保留'
    await act(async () => { await controller.dismiss() })
    expect([...controller.result!.keys()]).toEqual([volumes[0].id])
    expect(controller.result!.get(volumes[0].id!)![0]).toBe(edited)
    expect(host.querySelector('[role=alert]')?.textContent).toContain('receipt-write-failure')
    await act(async () => { await controller.dismiss() })
    expect(controller.result).toBeNull()
    expect(mocks.reject.mock.calls.map(call => call[0].runId)).toEqual([100, 101, 100])
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('blocks replacement generation at the same failure barrier instead of losing old drafts', async () => {
    mocks.reject.mockRejectedValueOnce(new Error('old-rejection-failed')).mockResolvedValue(undefined)
    await mount()
    controller.result!.get(volumes[0].id!)![0].summary = '替换前的作者修改'
    await act(async () => { await controller.generate() })
    expect(mocks.run).not.toHaveBeenCalled()
    expect(controller.result!.get(volumes[0].id!)![0].summary).toBe('替换前的作者修改')
    expect(host.textContent).toContain('old-rejection-failed')
  })

  it('clears normal rejections once and makes a repeated close idempotent', async () => {
    await mount()
    await act(async () => { await controller.dismiss() })
    await act(async () => { await controller.dismiss() })
    expect(controller.result).toBeNull()
    expect(mocks.reject).toHaveBeenCalledTimes(2)
    expect(mocks.run).not.toHaveBeenCalled()
    expect((await db.outlineNodes.toArray()).map(row => row.type)).toEqual(['volume', 'volume'])
  })

  it('keeps a cancelled partial candidate if its rejection receipt cannot be saved', async () => {
    mocks.restore.mockResolvedValue(null)
    mocks.reject.mockRejectedValueOnce(new Error('cancel-rejection-failed'))
    const partial: BatchOutlineResult = { batchGroupId: 'outline-batch-sfqa095', chaptersByVolume: new Map([[volumes[0].id!, [{ title: '部分章节', summary: '取消时待保存的候选' }]]]), candidatesByVolume: new Map([[volumes[0].id!, candidates[0]]]), failures: [], cancelled: true, elapsed: 1 }
    mocks.run.mockResolvedValue(partial)
    candidates = []
    await mount()
    await act(async () => { await controller.generate() })
    expect(controller.result!.get(volumes[0].id!)![0].summary).toBe('取消时待保存的候选')
    expect(host.textContent).toContain('cancel-rejection-failed')
    expect(controller.running).toBe(false)
  })

  it('matches real durable rollback and cold restoration with no extra model request', async () => {
    const actualRunner = await vi.importActual<typeof import('../../src/lib/ai/batch-outline-runner')>('../../src/lib/ai/batch-outline-runner')
    const actualHarness = await vi.importActual<typeof import('../../src/lib/outline/harness')>('../../src/lib/outline/harness')
    const model = vi.fn(async (_messages: ChatMessage[], volume: OutlineNode) => JSON.stringify([{ title: `${volume.title}第一章`, summary: `${volume.title}候选` }]))
    const result = await actualRunner.runBatchOutlineGeneration({ project: fixture.project, work: fixture.work, nodes: volumes, volumes, batchGroupId: 'outline-batch-sfqa095-real', runModel: model, assembleContext: ({ volume, priorOutlineCandidateText }) => prepareOutlineGatewayAssemblyV1({ projectId: fixture.scope.projectId, scope: fixture.scope, worldGroupId: null, request: { kind: 'chapters', volumeId: volume.id! }, authorRequest: '生成本卷章纲', config: useAIConfigStore.getState().config, priorOutlineCandidateText }) })
    candidates = [...result.candidatesByVolume.values()]
    expect(candidates).toHaveLength(2)
    mocks.restore.mockImplementation(actualHarness.restoreLatestOutlineGenerationBatchV1)
    mocks.reject.mockImplementation(actualHarness.rejectOutlineGenerationCandidateV1)
    let fail = true
    const hook = (_key: unknown, row: { type?: string; runId?: number }) => { if (fail && row.type === 'run.failed' && row.runId === candidates[0].runId) { fail = false; throw new Error('durable-rejection-failed') } }
    db.agentRunEvents.hook('creating', hook)
    try {
      await mount()
      await act(async () => { await controller.dismiss() })
      expect(host.textContent).toContain('durable-rejection-failed')
      expect([...controller.result!.keys()]).toEqual([volumes[0].id])
      const restored = await actualHarness.restoreLatestOutlineGenerationBatchV1(fixture.scope)
      expect(restored?.candidates.map(candidate => candidate.runId)).toEqual([candidates[0].runId])
      await act(async () => { await controller.dismiss() })
      expect(await actualHarness.restoreLatestOutlineGenerationBatchV1(fixture.scope)).toBeNull()
      expect(await db.outlineNodes.count()).toBe(2)
      expect(model).toHaveBeenCalledTimes(2)
      expect(mocks.run).not.toHaveBeenCalled()
    } finally { db.agentRunEvents.hook('creating').unsubscribe(hook) }
  })
})
