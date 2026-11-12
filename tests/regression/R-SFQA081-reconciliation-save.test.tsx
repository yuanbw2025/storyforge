import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ChapterEditor from '../../src/components/editor/ChapterEditor'
import type { ReconciliationActionMap } from '../../src/components/editor/ReconciliationTable'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { loadChapterPlanSnapshot, saveChapterPlanReconciliationReview } from '../../src/lib/ai/chapter-memory/plan-reconciliation'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { db } from '../../src/lib/db/schema'
import type { ChapterPlanReconciliation } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveScopeLike, stampNewRecord } from '../../src/lib/workspace/scope'
import { useChapterStore } from '../../src/stores/chapter'
import { useOutlineStore } from '../../src/stores/outline'
import { addCurrentWorkFixtureV1, seedCurrentWorkspace } from '../helpers/current-workspace'

const capture = vi.hoisted(() => ({
  onSave: null as null | undefined | ((actions: ReconciliationActionMap) => Promise<void>),
}))
vi.mock('../../src/components/editor/ChapterMemoryPanel', async importOriginal => {
  const { default: Actual } = await importOriginal<typeof import('../../src/components/editor/ChapterMemoryPanel')>()
  return { default: (props: Parameters<typeof Actual>[0]) => {
    capture.onSave = props.onSaveReconciliation
    return createElement(Actual, props)
  } }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounts: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
const sourceText = '<p>作者保留的章节正文。</p>'
const baseSummary = '  作者原有章纲。e\u0301  \n'
const synced = '主角仍需要核对守卫的证词。'
const firstActions: ReconciliationActionMap = { 'unfinishedGoals:apply': { action: 'apply', indices: [0] } }
const reviewedActions: ReconciliationActionMap = {
  ...firstActions, 'deviations:dismiss': { action: 'dismiss', indices: [0] },
}
const appendOnce = `${baseSummary}\n\n[基于对账更新]\n[待完成] ${synced}`

beforeEach(async () => {
  await db.delete(); await db.open()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('081 must not dispatch a model') }))
})
afterEach(async () => {
  for (const { host, root } of mounts.splice(0)) { await act(async () => root.unmount()); host.remove() }
  capture.onSave = null
  vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close()
})

async function mountEditor() {
  const f = await seedCurrentWorkspace('081章节对账')
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', {
    projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '第一章', summary: baseSummary,
    order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', {
    projectId: f.scope.projectId, outlineNodeId, title: '第一章', content: sourceText,
    wordCount: 12, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const reconciliation: ChapterPlanReconciliation = {
    chapterId, sourceTextHash: await hashChapterText(sourceText),
    planSourceHash: (await loadChapterPlanSnapshot(f.scope.projectId, chapterId, f.scope)).planSourceHash,
    schemaVersion: 1, extractorVersion: '081-test', textNormalizationVersion: 'v1',
    completedGoals: [], unfinishedGoals: [{ text: synced, evidenceQuotes: [] }],
    deviations: [{ text: '作者不采纳的偏差。', evidenceQuotes: [] }], newConstraints: [], nextChapterImpacts: [],
    reviewStatus: 'pending', generatedAt: 1,
  }
  await db.chapters.update(chapterId, { planReconciliation: reconciliation })
  await act(async () => {
    await useOutlineStore.getState().loadAll(f.scope.projectId)
    await useChapterStore.getState().loadAll(f.scope.projectId)
    useChapterStore.getState().selectChapter(chapterId)
  })
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounts.push({ host, root })
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(ToastProvider, null,
    createElement(DialogProvider, null, createElement(ChapterEditor, { project: f.project, outlineNodeId }))))))
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    expect(host.textContent).toContain('计划—正文对账')
  })
  expect(capture.onSave).toBeTypeOf('function')
  return { ...f, outlineNodeId, chapterId, host }
}

async function save(actions: ReconciliationActionMap) {
  const onSave = capture.onSave!
  await act(async () => onSave(actions))
}

it('adds an applied item once when the actual ChapterEditor save callback next reviews another item', async () => {
  const f = await mountEditor()
  await save(firstActions)
  expect((await db.outlineNodes.get(f.outlineNodeId))?.summary).toBe(appendOnce)
  await save(reviewedActions)
  expect((await db.outlineNodes.get(f.outlineNodeId))?.summary).toBe(appendOnce)
  const chapter = await db.chapters.get(f.chapterId)
  expect(chapter?.planReconciliation?.actions).toEqual(reviewedActions)
  expect(chapter?.content).toBe(sourceText)
  expect(fetch).not.toHaveBeenCalled()
})


it('commits a double save once and carries the synchronized item through a real backup roundtrip', async () => {
  const f = await mountEditor()
  const onSave = capture.onSave!
  await act(async () => { await Promise.all([onSave(firstActions), onSave(firstActions)]) })
  const chapter = (await db.chapters.get(f.chapterId))!
  expect(chapter.planReconciliation?.outlineSync?.appliedItemKeys).toEqual(['unfinishedGoals:0'])
  expect((await db.outlineNodes.get(f.outlineNodeId))?.summary).toBe(appendOnce)
  expect(f.host.textContent).toContain('计划—正文对账')

  let importedProject!: number
  await act(async () => { importedProject = await importProjectJSON(await exportProjectJSON(f.scope.projectId)) })
  const restoredScope = await resolveScopeLike(importedProject)
  const restoredChapter = (await db.chapters.where('projectId').equals(importedProject).first())!
  const restoredOutline = (await db.outlineNodes.get(restoredChapter.outlineNodeId))!
  expect(restoredChapter.id).not.toBe(f.chapterId)
  expect(restoredChapter.planReconciliation?.chapterId).toBe(restoredChapter.id)
  expect(restoredChapter.planReconciliation?.outlineSync).toEqual(chapter.planReconciliation?.outlineSync)
  await saveChapterPlanReconciliationReview({
    scope: restoredScope, expected: restoredChapter.planReconciliation!, outline: restoredOutline, actions: reviewedActions,
  })
  expect((await db.outlineNodes.get(restoredOutline.id!))?.summary).toBe(appendOnce)
  expect((await db.chapters.get(restoredChapter.id!))?.planReconciliation?.actions).toEqual(reviewedActions)
})

it('refuses a same-world sibling Work and a legacy applied review without its item receipt', async () => {
  const f = await mountEditor()
  const chapter = (await db.chapters.get(f.chapterId))!
  const outline = (await db.outlineNodes.get(f.outlineNodeId))!
  const sibling = await addCurrentWorkFixtureV1({ projectId: f.scope.projectId, worldId: f.scope.worldId,
    create: { kind: 'novel', novelProfile: 'long', title: '同世界另一部作品' } })
  await expect(saveChapterPlanReconciliationReview({ scope: { ...f.scope, workId: sibling.id! },
    expected: chapter.planReconciliation!, outline, actions: firstActions })).rejects.toThrow(/归属|作用域/)
  expect(await db.chapters.get(f.chapterId)).toEqual(chapter)
  const legacy: ChapterPlanReconciliation = { ...chapter.planReconciliation!, actions: firstActions, reviewStatus: 'applied-outline' }
  await db.chapters.update(f.chapterId, { planReconciliation: legacy })
  await expect(saveChapterPlanReconciliationReview({ scope: f.scope, expected: legacy, outline,
    actions: reviewedActions })).rejects.toThrow('旧对账缺少同步凭证')
  expect((await db.chapters.get(f.chapterId))?.planReconciliation).toEqual(legacy)
  expect(await db.outlineNodes.get(f.outlineNodeId)).toEqual(outline)
})

it('rolls back a real outline write when the chapter review write fails, then retries only once', async () => {
  const f = await mountEditor()
  const before = await db.chapters.get(f.chapterId)
  const update = db.chapters.update.bind(db.chapters)
  const writes = vi.spyOn(db.chapters, 'update').mockImplementationOnce((...args) => {
    expect(args[1]).toHaveProperty('planReconciliation.outlineSync')
    throw new Error('isolated chapter write failure')
  }).mockImplementation(update)
  const item = [...f.host.querySelectorAll('p')].find(text => text.textContent === synced)
  const apply = item?.parentElement?.parentElement?.querySelector<HTMLButtonElement>('button[title^="同步到章纲"]')
  const saveButton = () => [...f.host.querySelectorAll('button')].find(button => button.textContent?.trim().startsWith('保存更改'))
  expect(apply).toBeDefined()
  await act(async () => { apply!.click() })
  await act(async () => { saveButton()!.click() })
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    expect(f.host.querySelector('[role="alert"]')?.textContent).toBe('isolated chapter write failure')
  })
  expect(writes).toHaveBeenCalledOnce()
  expect(await db.chapters.get(f.chapterId)).toEqual(before)
  expect((await db.outlineNodes.get(f.outlineNodeId))?.summary).toBe(baseSummary)
  expect(f.host.textContent).toContain('有未保存更改')
  await act(async () => { saveButton()!.click() })
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)) })
    expect((await db.outlineNodes.get(f.outlineNodeId))?.summary).toBe(appendOnce)
  })
})

it.each(['outline', 'body'] as const)('preserves an author’s newer %s and does not mark old review saved', async target => {
  const f = await mountEditor()
  const original = (await db.chapters.get(f.chapterId))!.planReconciliation
  if (target === 'outline') await db.outlineNodes.update(f.outlineNodeId, { summary: '另一处保存的新章纲。', updatedAt: 2 })
  else await db.chapters.update(f.chapterId, { content: '<p>另一处保存的新正文。</p>', updatedAt: 2 })
  const onSave = capture.onSave!
  await act(async () => { await expect(onSave(firstActions)).rejects.toThrow('正文或章纲已变化') })
  expect((await db.outlineNodes.get(f.outlineNodeId))?.summary).toBe(target === 'outline' ? '另一处保存的新章纲。' : baseSummary)
  const chapter = await db.chapters.get(f.chapterId)
  expect(chapter?.content).toBe(target === 'body' ? '<p>另一处保存的新正文。</p>' : sourceText)
  expect(chapter?.planReconciliation).toEqual(original)
})
