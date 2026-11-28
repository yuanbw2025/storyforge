import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type { Project, WorkspaceScope } from '../../src/lib/types'
import ShortNovelStudio, { type Stage } from '../../src/components/short-novel/ShortNovelStudio'
import * as drafts from '../../src/lib/short-novel/author-drafts'
import { flushPendingEditsV1 } from '../../src/lib/authoring/pending-edit-coordinator'

vi.mock('../../src/components/short-novel/ShortNovelShowcase', () => ({ default: () => null }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let host: HTMLDivElement, root: Root
beforeEach(async () => { await db.delete(); await db.open(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => { await flushPendingEditsV1(); root.unmount() }); host.remove(); db.close(); vi.restoreAllMocks() })
async function waitFor(check: () => void) {
  const deadline = Date.now() + 3000
  do { try { check(); return } catch (cause) { if (Date.now() > deadline) throw cause }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
  } while (Date.now() <= deadline)
  check()
}
const draw = (project: Project, scope: WorkspaceScope, stage: Stage = 'plan') => <MemoryRouter><ShortNovelStudio project={project} scope={scope} activeStage={stage} structured /></MemoryRouter>
const field = (label: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!
async function input(label: string, value: string) {
 const target = field(label)
 const set = Object.getOwnPropertyDescriptor(target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!
 await act(async () => { set.call(target, value); target.dispatchEvent(new Event('input', { bubbles: true })) })
}
it('same owner and production revision reread cannot replace unsaved chapter title or instruction', async () => {
  const created = await seedCurrentWorkspace('短篇同版本读取隔离反例', { novelProfile: 'short', targetWordCount: 5000 })
  const scope = created.scope, project = (await db.projects.get(scope.projectId))!
  await act(async () => root.render(draw(project, scope)))
  await waitFor(() => expect(field('第1章 章节标题')?.value).toBe('第1章'))
  await input('第1章 章节标题', '作者刚输入的封站')
  const instruction = host.querySelector<HTMLTextAreaElement>('textarea[placeholder="可选：语气、人物、禁区或本次修订要求"]')!
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(instruction, '保留这次作者要求'); instruction.dispatchEvent(new Event('input', { bubbles: true })) })
  expect(field('第1章 章节标题').value).toBe('作者刚输入的封站')
  // The owner and durable revision are identical; only read snapshot identity changes.
  await act(async () => root.render(draw(project, { ...scope })))
  await waitFor(() => expect(host.querySelector('[data-testid="short-novel-studio"]')).not.toBeNull())
  expect(field('第1章 章节标题').value).toBe('作者刚输入的封站')
  expect(instruction.value).toBe('保留这次作者要求')
  expect((await db.outlineNodes.where('projectId').equals(scope.projectId).and(row => row.workId === scope.workId).toArray()).find(row => row.type === 'chapter')?.title).toBe('第1章')
})

async function fixture() {
 const { scope } = await seedCurrentWorkspace('短篇草稿生命周期隔离', { novelProfile: 'short', targetWordCount: 5000 })
 return { scope, project: (await db.projects.get(scope.projectId))! }
}
function deferredRead() {
 let resolve!: (value: string | null) => void
 vi.spyOn(drafts, 'readShortAuthorDraft').mockImplementationOnce(() => new Promise(done => { resolve = done }))
 return (value: string | null) => resolve(value)
}
const stored = (title: string, instruction = '持久化附加要求') => JSON.stringify({text: JSON.stringify([{stableKey:'chapter-1',title}]),instruction})

it('an unchanged-owner reread does not cancel its original pending draft restore', async () => {
 const f = await fixture(), resolve = deferredRead()
 await act(async () => root.render(draw(f.project, f.scope)))
 await waitFor(() => expect(field('第1章 章节标题')?.value).toBe('第1章'))
 await act(async () => root.render(draw(f.project, { ...f.scope })))
 await act(async () => resolve(stored('先前持久化的作者标题')))
 await waitFor(() => expect(field('第1章 章节标题').value).toBe('先前持久化的作者标题'))
 expect(host.querySelector<HTMLTextAreaElement>('textarea[placeholder]')?.value).toBe('持久化附加要求')
})

it('a late initial draft cannot replace newer input from its own author', async () => {
 const f = await fixture(), resolve = deferredRead()
 await act(async () => root.render(draw(f.project, f.scope)))
 await waitFor(() => expect(field('第1章 章节标题')?.value).toBe('第1章'))
 await input('第1章 章节标题', '作者本次新输入')
 await act(async () => resolve(stored('迟到的旧标题')))
 expect(field('第1章 章节标题').value).toBe('作者本次新输入')
})

it('owner changes cannot borrow a prior Work draft or retain its initialization', async () => {
 const a = await fixture(), b = await fixture(), resolve = deferredRead()
 await db.chapters.where('projectId').equals(b.scope.projectId).and(row => Reflect.get(row,'workId') === b.scope.workId).modify({title:'作品B的正式章节'})
 await db.outlineNodes.where('projectId').equals(b.scope.projectId).and(row => row.workId === b.scope.workId).and(row => row.type === 'chapter').modify({title:'作品B的正式章节'})
 await act(async () => root.render(draw(a.project, a.scope)))
 await waitFor(() => expect(field('第1章 章节标题')?.value).toBe('第1章'))
 await act(async () => root.render(draw(b.project, b.scope)))
 await waitFor(() => expect(field('第1章 章节标题')?.value).toBe('作品B的正式章节'))
 await act(async () => resolve(stored('作品A的迟到草稿')))
 expect(field('第1章 章节标题').value).toBe('作品B的正式章节')
 expect(await drafts.readShortAuthorDraft(b.scope, 'plan:r1')).toBeNull()
})

it('a genuine production revision starts its own editor instead of inheriting an older unconfirmed title', async () => {
 const f = await fixture()
 await act(async () => root.render(draw(f.project, f.scope)))
 await waitFor(() => expect(field('第1章 章节标题')?.value).toBe('第1章'))
 await input('第1章 章节标题', '旧版本未确认的标题')
 await act(async () => { await flushPendingEditsV1() })
 const production = (await db.shortNovelProductions.where('workId').equals(f.scope.workId).first())!
 await db.shortNovelProductions.update(production.id!, {revision:production.revision+1})
 await db.chapters.where('projectId').equals(f.scope.projectId).and(row => Reflect.get(row,'workId') === f.scope.workId).modify({title:'新版本正式标题'})
 await db.outlineNodes.where('projectId').equals(f.scope.projectId).and(row => row.workId === f.scope.workId).and(row => row.type === 'chapter').modify({title:'新版本正式标题'})
 await act(async () => root.render(draw(f.project, { ...f.scope })))
 await waitFor(() => expect(field('第1章 章节标题')?.value).toBe('新版本正式标题'))
 expect(await drafts.readShortAuthorDraft(f.scope, 'plan:r1')).toContain('旧版本未确认的标题')
 expect(await drafts.readShortAuthorDraft(f.scope, `plan:r${production.revision+1}`)).toBeNull()
})

it('stage changes and a full unmount restore the exact persisted draft without confirming chapters', async () => {
 const f = await fixture()
 await act(async () => root.render(draw(f.project, f.scope)))
 await waitFor(() => expect(field('第1章 章节标题')?.value).toBe('第1章'))
 await input('第1章 章节标题', '保留阶段草稿标题')
 await act(async () => { await flushPendingEditsV1() })
 await act(async () => root.render(draw(f.project, f.scope, 'design')))
 await waitFor(() => expect(host.querySelector('[data-short-field="protagonist"]')).not.toBeNull())
 await act(async () => root.render(draw(f.project, f.scope)))
 await waitFor(() => expect(field('第1章 章节标题')?.value).toBe('保留阶段草稿标题'))
 await act(async () => { root.unmount(); root = createRoot(host); root.render(draw(f.project, f.scope)) })
 await waitFor(() => expect(field('第1章 章节标题')?.value).toBe('保留阶段草稿标题'))
 expect((await db.chapters.where('projectId').equals(f.scope.projectId).and(row => Reflect.get(row,'workId') === f.scope.workId).first())?.title).toBe('第1章')
 expect(await db.agentRuns.count()).toBe(0)
})
