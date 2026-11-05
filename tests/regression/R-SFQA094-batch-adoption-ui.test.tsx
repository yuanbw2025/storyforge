import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { adoptOutlineGenerationCandidateV1 } from '../../src/lib/outline/candidate-lifecycle'

const mocks = vi.hoisted(() => ({ adopt: vi.fn<typeof adoptOutlineGenerationCandidateV1>() }))
vi.mock('../../src/lib/outline/harness', async original => ({
  ...await original<typeof import('../../src/lib/outline/harness')>(),
  adoptOutlineGenerationCandidateV1: mocks.adopt,
}))

import { useOutlineBatchGeneration } from '../../src/components/outline/useOutlineBatchGeneration'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run'
import { createSfqa094BatchV1 } from '../helpers/sfqa094-batch'
import { OUTLINE_BATCH_APPEND_PAYLOAD_TYPE_V1 } from '../../src/lib/authoring/content-revision'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let fixture: Awaited<ReturnType<typeof createSfqa094BatchV1>>
let root: Root | undefined
let host: HTMLDivElement
let controller: ReturnType<typeof useOutlineBatchGeneration>
let actual: typeof import('../../src/lib/outline/candidate-lifecycle')

async function mount() {
  function Harness() {
    const [error, setError] = useState('')
    controller = useOutlineBatchGeneration({
      project: fixture.project, work: fixture.work, volumes: fixture.volumes, nodes: fixture.volumes,
      hint: '', runOptions: {}, multiWorldEnabled: false,
      assembleContext: async () => { throw new Error('confirmation must not regenerate') },
      reloadOutline: async () => {}, onInfo: () => {}, onError: setError,
    })
    return createElement('section', null,
      createElement('p', { role: 'alert' }, error),
      ...[...(controller.result ?? [])].map(([id, items]) => createElement('p', { key: id }, items.map(item => item.summary).join('\n'))),
    )
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(createElement(Harness)))
  for (let index = 0; index < 100 && !controller.result; index++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
  }
  expect(controller.result).not.toBeNull()
}
async function unmount() {
  if (root) { await act(async () => root!.unmount()); root = undefined; host.remove() }
}

beforeEach(async () => {
  await db.delete(); await db.open()
  fixture = await createSfqa094BatchV1()
  actual = await vi.importActual<typeof import('../../src/lib/outline/candidate-lifecycle')>('../../src/lib/outline/candidate-lifecycle')
  mocks.adopt.mockReset(); mocks.adopt.mockImplementation(actual.adoptOutlineGenerationCandidateV1)
})
afterEach(async () => { await unmount(); db.close(); vi.restoreAllMocks() })

describe('SFQA094 · 批量确认逐卷结果与持久恢复', () => {
  it('receipt失败只保留未完成卷与作者编辑，冷恢复后仅补回执且不重发模型', async () => {
    const second = [...fixture.result.candidatesByVolume.values()][1]
    let fail = true
    const hook = (_key: unknown, row: { runId?: number; type?: string }) => {
      if (fail && row.runId === second.runId && row.type === 'verification.accepted') {
        fail = false; throw new Error('receipt-storage-failure')
      }
    }
    db.agentRunEvents.hook('creating', hook)
    try {
      await mount()
      const edited = controller.result!.get(fixture.volumes[1].id!)![0]
      edited.summary = '作者已编辑的第二卷候选'
      await act(async () => { await controller.confirm() })
      expect([...controller.result!.keys()]).toEqual([fixture.volumes[1].id])
      expect(controller.result!.get(fixture.volumes[1].id!)![0]).toBe(edited)
      expect(host.textContent).toContain('receipt-storage-failure')
      expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(4)
      expect((await readAgentRunV1(fixture.scope, second.runId)).projection.state).toBe('verifying')
      const committedRows = await db.outlineNodes.toArray()
      await unmount(); db.close(); await db.open()
      await mount()
      expect([...controller.result!.keys()]).toEqual([fixture.volumes[1].id])
      expect(controller.result!.get(fixture.volumes[1].id!)![0].summary).toBe(edited.summary)
      await act(async () => { await controller.confirm() })
      expect(controller.result).toBeNull()
      expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(4)
      expect(await db.outlineNodes.toArray()).toEqual(committedRows)
      const completed = await readAgentRunV1(fixture.scope, second.runId)
      expect(completed.projection.state).toBe('completed')
      expect(completed.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
      expect(completed.events.filter(event => event.type === 'verification.rejected')).toHaveLength(0)
      expect(fixture.modelCalls()).toBe(2)
      expect(mocks.adopt.mock.calls.map(([input]) => input.candidate.runId)).toEqual([
        [...fixture.result.candidatesByVolume.values()][0].runId, second.runId, second.runId,
      ])
    } finally { db.agentRunEvents.hook('creating').unsubscribe(hook) }
  })

  it('实际追加证明存储失败回滚整卷，已完成卷和待处理编辑都保留', async () => {
    const second = [...fixture.result.candidatesByVolume.values()][1]
    let fail = true
    const hook = (_key: unknown, row: { durableRunId?: number | null; payload?: string }) => {
      if (fail && row.durableRunId === second.runId && JSON.parse(row.payload ?? '{}').type === OUTLINE_BATCH_APPEND_PAYLOAD_TYPE_V1) {
        fail = false; throw new Error('append-proof-storage-failure')
      }
    }
    db.agentEvents.hook('creating', hook)
    try {
      await mount()
      controller.result!.get(fixture.volumes[1].id!)![0].summary = '原子写入失败后仍保留的作者编辑'
      await act(async () => { await controller.confirm() })
      expect([...controller.result!.keys()]).toEqual([fixture.volumes[1].id])
      expect(host.textContent).toContain('append-proof-storage-failure')
      expect(await db.outlineNodes.where('parentId').equals(fixture.volumes[0].id!).count()).toBe(2)
      expect(await db.outlineNodes.where('parentId').equals(fixture.volumes[1].id!).count()).toBe(0)
      await unmount(); db.close(); await db.open(); await mount()
      expect(controller.result!.get(fixture.volumes[1].id!)![0].summary).toBe('原子写入失败后仍保留的作者编辑')
      await act(async () => { await controller.confirm() })
      expect(controller.result).toBeNull()
      expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(4)
      expect(fixture.modelCalls()).toBe(2)
    } finally { db.agentEvents.hook('creating').unsubscribe(hook) }
  })

  it('前卷缺少终态回执时暂停后续卷，冻结编辑可在冷恢复后按序继续', async () => {
    const [first, second] = fixture.result.candidatesByVolume.values()
    let fail = true
    mocks.adopt.mockImplementation(input => actual.adoptOutlineGenerationCandidateV1({ ...input,
      faultInjector: boundary => {
        if (fail && input.candidate.runId === first.runId && boundary === 'verification-in-progress') {
          fail = false; throw new Error('first-receipt-failed')
        }
      },
    }))
    await mount()
    controller.result!.get(fixture.volumes[1].id!)![0].summary = '尚未执行卷的作者编辑'
    await act(async () => { await controller.confirm() })
    expect(controller.result?.size).toBe(2)
    expect(mocks.adopt).toHaveBeenCalledTimes(1)
    expect((await readAgentRunV1(fixture.scope, second.runId)).projection.steps[second.stepId].status).toBe('running')
    await unmount(); db.close(); await db.open(); await mount()
    expect(controller.result?.size).toBe(2)
    expect(controller.result!.get(fixture.volumes[1].id!)![0].summary).toBe('尚未执行卷的作者编辑')
    await act(async () => { await controller.confirm() })
    expect(controller.result).toBeNull()
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(4)
    expect(fixture.modelCalls()).toBe(2)
  })

  it('同一确认期间重复确认、关闭或重新生成不会交错执行', async () => {
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const blocked = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    let first = true
    mocks.adopt.mockImplementation(async input => {
      if (first) { first = false; entered!(); await blocked }
      return actual.adoptOutlineGenerationCandidateV1(input)
    })
    await mount()
    await act(async () => {
      const pending = controller.confirm()
      await started
      await controller.confirm(); await controller.dismiss(); await controller.generate()
      expect(mocks.adopt).toHaveBeenCalledTimes(1)
      release!(); await pending
    })
    expect(controller.result).toBeNull()
    expect(mocks.adopt).toHaveBeenCalledTimes(2)
    expect(await db.outlineNodes.where('type').equals('chapter').count()).toBe(4)
    expect(fixture.modelCalls()).toBe(2)
  })
})
