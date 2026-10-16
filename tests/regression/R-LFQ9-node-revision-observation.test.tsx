import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'

const reads = vi.hoisted(() => ({ scope: null as any, chapter: null as any, view: null as any,
  report: { current: true, report: { artifactHash: 'frozen-report' } }, revision: vi.fn() }))
vi.mock('../../src/lib/node-authoring/quality-execution', () => ({
  resolveQualityAuthoringChapterV1: vi.fn(async () => ({ scope: reads.scope, chapter: reads.chapter })),
  qualityAuthoringModeV1: () => 'quality',
}))
vi.mock('../../src/lib/agent/run/quality-review-durable', () => ({ readLatestWholeChapterQualityReviewV1: async () => reads.report }))
vi.mock('../../src/lib/agent/run/quality-revision-durable', () => ({
  readLatestQualityRevisionV1: (...args: any[]) => reads.revision(...args), abandonQualityRevisionV1: vi.fn(),
}))
vi.mock('../../src/components/editor/QualityReviewViews', () => ({
  WholeQualityReportView: () => null, QualityRevisionScopeControls: () => null,
  QualityRevisionComparisonView: ({ view }: any) => createElement('p', { 'data-testid': 'observed-revision' }, view.state + ':' + Boolean(view.candidate)),
}))
import RevisionNodeSelection from '../../src/components/node-authoring/RevisionNodeSelection'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const view = (state: string) => ({ runId: 1, state, current: true, draft: { outputText: '修订稿' }, candidate: state === 'awaiting_confirmation' ? { id: 'verified-candidate' } : null })
async function event(sequence: number) {
  const before = reads.revision.mock.calls.length
  await act(async () => {
    await db.agentRunEvents.add(stampNewRecord(reads.scope, 'agentRunEvents', { projectId: reads.scope.projectId, runId: 1, sequence, generation: 1, type: 'model.responded', payloadJson: '{}', createdAt: sequence }, { owner: 'work' }) as any)
    await vi.waitFor(() => expect(reads.revision.mock.calls.length).toBeGreaterThan(before))
  })
}
async function mount() {
  await act(async () => root.render(createElement(RevisionNodeSelection, { projectId: reads.scope.projectId, worldGroupId: null,
    node: { config: { chapterTitle: '签字', reportHash: 'frozen-report' } } as any, onConfigChange: vi.fn() })))
  await act(async () => { await vi.waitFor(() => expect(reads.revision.mock.calls.length).toBeGreaterThan(0)) })
  expect(host.querySelector('[data-testid="observed-revision"]')?.textContent).toBe('running:false')
}
beforeEach(async () => {
  await db.delete(); await db.open()
  reads.scope = (await seedCurrentWorkspace('审修可见性隔离测试')).scope
  reads.chapter = { projectId: reads.scope.projectId, content: '<p>原稿。</p>', title: '签字', wordCount: 3, order: 0, status: 'draft', createdAt: 1, updatedAt: 1 }
  reads.chapter.id = await db.chapters.add(stampNewRecord(reads.scope, 'chapters', reads.chapter, { owner: 'work' }) as any)
  reads.view = view('running')
  // Verification is deliberately opaque to Dexie's dependency tracker, as native hashing can be.
  reads.revision.mockReset().mockImplementation(async () => reads.view)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); db.close() })

describe('LFQ9 · 审修运行事件与异步校验的页面更新', () => {
  it('最终事件更新后显示已验证候选，即使校验函数没有提供可追踪的表读取', async () => {
    await mount()
    reads.view = view('awaiting_confirmation')
    await event(1)
    expect(host.querySelector('[data-testid="observed-revision"]')?.textContent).toBe('awaiting_confirmation:true')
    expect(await db.agentRuns.count()).toBe(0)
  })
  it('更早的慢校验晚到不能覆盖更新的已完成复核', async () => {
    await mount()
    let release!: (value: any) => void
    const delayed = new Promise(resolve => { release = resolve })
    reads.revision.mockImplementationOnce(() => delayed)
    await event(1)
    reads.view = view('awaiting_confirmation')
    await event(2)
    expect(host.querySelector('[data-testid="observed-revision"]')?.textContent).toBe('awaiting_confirmation:true')
    await act(async () => { release(view('running')); await delayed })
    expect(host.querySelector('[data-testid="observed-revision"]')?.textContent).toBe('awaiting_confirmation:true')
  })
})
