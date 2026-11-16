import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ReviewPanel from '../../src/components/editor/ReviewPanel'
import { useReviewResultStore } from '../../src/stores/review-result'
import type { QualityRevisionViewV1 } from '../../src/lib/agent/run/quality-revision-durable'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const service = vi.hoisted(() => ({ view: vi.fn(), unfinished: vi.fn(), adopt: vi.fn(), end: vi.fn(), review: vi.fn() }))
vi.mock('../../src/lib/workspace/scope', async original => ({
  ...await original<typeof import('../../src/lib/workspace/scope')>(),
  resolveScopeLike: vi.fn(async (projectId: number) => ({ projectId, workId: projectId, worldId: projectId })),
}))
vi.mock('../../src/lib/authoring/content-revision', async original => ({
  ...await original<typeof import('../../src/lib/authoring/content-revision')>(),
  captureWorkspaceContentRevisionV1: vi.fn(async () => ({ vectorHash: 'synthetic-revision' })),
}))
vi.mock('../../src/lib/agent/run/quality-review-durable', async original => ({
  ...await original<typeof import('../../src/lib/agent/run/quality-review-durable')>(),
  readLatestWholeChapterQualityReviewV1: vi.fn(async () => null),
  runWholeChapterQualityReviewV1: service.review,
}))
vi.mock('../../src/lib/agent/run/quality-revision-durable', async original => ({
  ...await original<typeof import('../../src/lib/agent/run/quality-revision-durable')>(),
  readLatestQualityRevisionV1: service.view,
  readLatestUnfinishedQualityRevisionV1: service.unfinished,
  adoptQualityRevisionV1: service.adopt,
  abandonQualityRevisionV1: service.end,
}))

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function preview(): QualityRevisionViewV1 {
  return { runId: 10, state: 'awaiting_confirmation', current: true,
    draft: { version: 'quality-revision-draft-v1', plan: { authorRequest: '' }, sourceHtml: '<p>第一章原稿</p>', outputText: '第一章候选', contentHtml: '<p>第一章候选</p>', rawPatches: '' },
    candidate: { chapterId: 1 },
  } as QualityRevisionViewV1
}
const props = { projectId: 1, chapterId: 1, outlineNodeId: 1, worldGroupId: null, chapterContent: '合成原稿', chapterTitle: '合成章', worldContext: '', characterContext: '', prevChapterSummary: '', nextChapterSummary: '', foreshadowContext: '', stateContext: '', onClose: () => undefined }
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
async function render(overrides: Partial<Parameters<typeof ReviewPanel>[0]> = {}) { await act(async () => { root.render(createElement(ReviewPanel, { ...props, ...overrides })) }) }
function button(text: string) { return [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text) }
beforeEach(() => { vi.clearAllMocks(); service.view.mockResolvedValue(null); service.unfinished.mockResolvedValue(null); useReviewResultStore.setState({ byChapter: {} }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('review preparation and recovered candidate owner', () => {
  it('missing outline is visible and never invokes a model; the author can click again', async () => {
    await render({ outlineNodeId: null })
    await act(async () => button('开始检测')!.click())
    expect(host.textContent).toContain('全文评审缺少目标章纲')
    expect(button('开始检测')?.disabled).toBe(false)
    expect(service.review).not.toHaveBeenCalled()
  })
  it('failed author save is visible, retains the chapter and never invokes a model', async () => {
    await render({ onBeforeConsistencyRun: async () => { throw new Error('合成保存失败') } })
    await act(async () => button('开始检测')!.click())
    expect(host.textContent).toContain('合成保存失败')
    expect(button('开始检测')?.disabled).toBe(false)
    expect(service.review).not.toHaveBeenCalled()
  })
  it.each([['same Work next chapter', 1, 2], ['another workspace', 2, 2]])('%s hides the previous candidate while the new read is pending', async (_name, projectId, chapterId) => {
    const next = deferred<QualityRevisionViewV1 | null>()
    service.view.mockImplementation(({ chapterId: id }) => id === 1 ? Promise.resolve(preview()) : next.promise)
    await render(); await vi.waitFor(() => expect(host.textContent).toContain('第一章候选'))
    expect(button('确认采纳修订')).toBeTruthy()
    await render({ projectId: Number(projectId), chapterId: Number(chapterId) })
    expect(host.textContent).not.toContain('第一章候选')
    expect(button('确认采纳修订')).toBeUndefined()
    expect(service.adopt).not.toHaveBeenCalled()
    await act(async () => next.resolve(null))
  })
  it('a previous unfinished run cannot be offered as the new chapter recovery action', async () => {
    const next = deferred<null>()
    service.unfinished.mockImplementation(({ chapterId }) => chapterId === 1 ? Promise.resolve({ runId: 20, state: 'running' }) : next.promise)
    await render(); await vi.waitFor(() => expect(button('结束未完成运行')).toBeTruthy())
    await render({ chapterId: 2 })
    expect(button('结束未完成运行')).toBeUndefined()
    expect(service.end).not.toHaveBeenCalled()
    await act(async () => next.resolve(null))
  })
  it('a late previous read cannot overwrite the new chapter', async () => {
    const old = deferred<QualityRevisionViewV1 | null>()
    service.view.mockImplementation(({ chapterId }) => chapterId === 1 ? old.promise : Promise.resolve(null))
    await render(); await render({ chapterId: 2 })
    await act(async () => old.resolve(preview()))
    expect(host.textContent).not.toContain('第一章候选')
  })
  it('the same target still permits explicit adoption after its save completes', async () => {
    service.view.mockResolvedValue(preview())
    const save = vi.fn(async () => undefined)
    await render({ onBeforeConsistencyRun: save })
    await vi.waitFor(() => expect(button('确认采纳修订')).toBeTruthy())
    await act(async () => button('确认采纳修订')!.click())
    expect(save).toHaveBeenCalledOnce()
    expect(service.adopt).toHaveBeenCalledOnce()
    expect(service.adopt.mock.calls[0][0].candidate.chapterId).toBe(1)
  })
  it('an adoption waiting for author save stops if the author changes chapter', async () => {
    const saved = deferred<void>()
    service.view.mockImplementation(({ chapterId }) => Promise.resolve(chapterId === 1 ? preview() : null))
    await render({ onBeforeConsistencyRun: () => saved.promise })
    await vi.waitFor(() => expect(button('确认采纳修订')).toBeTruthy())
    await act(async () => button('确认采纳修订')!.click())
    await render({ chapterId: 2 })
    await act(async () => saved.resolve())
    expect(service.adopt).not.toHaveBeenCalled()
    expect(host.textContent).not.toContain('第一章候选')
  })
  it('returning to a chapter retains its typed review request', async () => {
    await render()
    const field = host.querySelector<HTMLTextAreaElement>('[aria-label="本轮评审补充要求"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, '第一章的作者草稿')
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(field.value).toBe('第一章的作者草稿')
    await render({ chapterId: 2 })
    await render()
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="本轮评审补充要求"]')!.value).toBe('第一章的作者草稿')
  })

})
