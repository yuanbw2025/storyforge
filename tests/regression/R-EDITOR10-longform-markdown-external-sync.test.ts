import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { EditorView } from '@codemirror/view'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { buildLongformMarkdownIdentityV1, LongformMarkdownSessionV1 } from '../../src/lib/editor/longform-markdown-session'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { useChapterStore } from '../../src/stores/chapter'
import { useOutlineStore } from '../../src/stores/outline'
import ChapterEditor from '../../src/components/editor/ChapterEditor'
import type { Chapter } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/** 已提交章行 → 外部同步用的真实回执归属（与 ChapterEditor 内同一构造方式）。 */
function receiptOf(chapter: Pick<Chapter, 'id' | 'updatedAt'>): string {
  return `chapter-commit:${chapter.id}:${chapter.updatedAt}`
}

async function fixture(kind: 'long' | 'short' = 'long') {
  const made = kind === 'short'
    ? await seedCurrentWorkspace('外部同步短篇验证', { novelProfile: 'short', targetWordCount: 10_000 })
    : await seedCurrentWorkspace('外部同步长篇验证')
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(made.scope, 'outlineNodes', {
    projectId: made.scope.projectId, parentId: null, type: 'chapter', title: '第一章', summary: '', order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const now = Date.now()
  const chapterId = await db.chapters.add(stampNewRecord(made.scope, 'chapters', {
    projectId: made.scope.projectId, outlineNodeId, title: '第一章', content: '', wordCount: 0, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const chapter = (await db.chapters.get(chapterId))!
  return { ...made, outlineNodeId, chapterId, chapter }
}

async function mountEditor(f: Awaited<ReturnType<typeof fixture>>) {
  await useOutlineStore.getState().loadAll(f.scope)
  await useChapterStore.getState().loadAll(f.scope)
  useChapterStore.getState().selectChapter(f.chapterId)
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(DialogProvider, null, createElement(ToastProvider, null,
      createElement(ChapterEditor, { project: f.project, outlineNodeId: f.outlineNodeId })))))
  })
  return { host, root, unmount: async () => { await act(async () => root.unmount()); host.remove() } }
}

async function waitFor(probe: () => Element | null | false | undefined, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = probe()
    if (found) return found
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)) })
  }
  return null
}

async function clickButton(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find(item => (item.textContent ?? '').trim().includes(label))
  if (!button) throw new Error(`找不到按钮：${label}`)
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise(resolve => setTimeout(resolve, 30))
  })
}

function cmView(host: HTMLElement): EditorView | null {
  const dom = host.querySelector('.cm-editor')
  return dom ? EditorView.findFromDOM(dom as HTMLElement) : null
}

describe('EDITOR10 · 外部已提交内容进入 CM 会话与真实内容保存', () => {
  beforeEach(async () => { resetPendingEditCoordinatorForTestsV1(); await db.delete(); await db.open() })
  afterEach(() => { resetPendingEditCoordinatorForTestsV1(); db.close() })

  it('外部同步成功：会话左右两侧一致，且同步本身不写库', async () => {
    const f = await fixture()
    await db.chapters.update(f.chapterId, { content: '<p>甲</p>', wordCount: 1 })
    const row = (await db.chapters.get(f.chapterId)) as Chapter
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, row.ragDocumentId!),
      html: row.content,
      parent: host,
      onHtmlChange: () => {},
      onError: () => {},
      onRichText: () => {},
    })
    try {
      const external = '<p>乙</p><p>丙😀</p>'
      session.commitExternalHtml({
        identity: session.adapter.identity,
        sourceRevision: session.getSourceRevision(),
        baselineEpoch: session.adapter.baselineEpoch,
        sourceHtml: session.getHtml(),
        html: external,
        receiptId: receiptOf(row),
        origin: 'external-adopt',
      })
      // 左边：会话 HTML；右边：外部已提交 HTML —— 逐字一致
      expect(session.getHtml()).toBe(external)
      expect(session.getPlainText()).toBe('乙\n丙😀')
      expect(session.getWordCount()).toBe(session.getPlainText().replace(/\s/g, '').length)
      // 同步不写库：章行保持外部写入的版本
      expect(await db.chapters.get(f.chapterId)).toEqual(row)
    } finally {
      session.destroy(); host.remove()
    }
  })

  it('回执/版本不符被拒：作者草稿与原文都保留，不覆盖', async () => {
    const f = await fixture()
    const base = '<p>甲</p>'
    await db.chapters.update(f.chapterId, { content: base, wordCount: 1 })
    const row = (await db.chapters.get(f.chapterId)) as Chapter
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, row.ragDocumentId!),
      html: base, parent: host, onHtmlChange: () => {}, onError: () => {}, onRichText: () => {},
    })
    try {
      // 作者在 CM 里有未保存输入
      const view = session.view.view
      view.dispatch({ changes: { from: 0, to: 0, insert: '作者草稿\n\n' } })
      const draftHtml = session.getHtml()
      expect(draftHtml).toContain('作者草稿')
      const external = '<p>外部结果</p>'
      // ① sourceHtml 与当前草稿不符
      expect(() => session.commitExternalHtml({
        identity: session.adapter.identity, sourceRevision: session.getSourceRevision(), baselineEpoch: session.adapter.baselineEpoch,
        sourceHtml: base, html: external, receiptId: receiptOf(row), origin: 'external-adopt',
      })).toThrow()
      // ② 版本/基线不符
      expect(() => session.commitExternalHtml({
        identity: session.adapter.identity, sourceRevision: session.getSourceRevision() + 5, baselineEpoch: session.adapter.baselineEpoch,
        sourceHtml: session.getHtml(), html: external, receiptId: receiptOf(row), origin: 'external-adopt',
      })).toThrow()
      // ③ 缺回执归属
      expect(() => session.commitExternalHtml({
        identity: session.adapter.identity, sourceRevision: session.getSourceRevision(), baselineEpoch: session.adapter.baselineEpoch,
        sourceHtml: session.getHtml(), html: external, receiptId: '   ', origin: 'external-adopt',
      })).toThrow()
      // 草稿与 DB 原文都未被覆盖
      expect(session.getHtml()).toBe(draftHtml)
      expect((await db.chapters.get(f.chapterId))!.content).toBe(base)
    } finally {
      session.destroy(); host.remove()
    }
  })

  it('组合输入进行中拒绝外部同步，草稿保留', async () => {
    const f = await fixture()
    const base = '<p>甲</p>'
    await db.chapters.update(f.chapterId, { content: base, wordCount: 1 })
    const row = (await db.chapters.get(f.chapterId)) as Chapter
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, row.ragDocumentId!),
      html: base, parent: host, onHtmlChange: () => {}, onError: () => {}, onRichText: () => {},
    })
    try {
      const beforeHtml = session.getHtml()
      session.adapter.setCompositionState({ compositionStarted: true, composing: false })
      expect(() => session.commitExternalHtml({
        identity: session.adapter.identity, sourceRevision: session.getSourceRevision(), baselineEpoch: session.adapter.baselineEpoch,
        sourceHtml: beforeHtml, html: '<p>外部结果</p>', receiptId: receiptOf(row), origin: 'external-adopt',
      })).toThrow('请先结束输入法组合')
      // 组合中连读取都被拒绝：源草稿原样保留，不会静默改写
      expect(() => session.getHtml()).toThrow('请先结束输入法组合')
      session.adapter.setCompositionState({ compositionStarted: false, composing: false })
      // 组合结束后可正常同步
      session.commitExternalHtml({
        identity: session.adapter.identity, sourceRevision: session.getSourceRevision(), baselineEpoch: session.adapter.baselineEpoch,
        sourceHtml: session.getHtml(), html: '<p>外部结果</p>', receiptId: receiptOf(row), origin: 'external-adopt',
      })
      expect(session.getHtml()).toBe('<p>外部结果</p>')
    } finally {
      session.destroy(); host.remove()
    }
  })

  it('真实 ChapterEditor：外部已提交内容同步进已挂载 CM，且同步不额外写库', async () => {
    const f = await fixture()
    const mounted = await mountEditor(f)
    try {
      expect(await waitFor(() => mounted.host.querySelector('.cm-editor'))).not.toBeNull()
      const before = (await db.chapters.get(f.chapterId))!
      // 外部入口（AI 采纳/导入）经 store.updateChapter 写入已提交内容
      const external = '<p>外部采纳的正文</p>'
      await act(async () => {
        await useChapterStore.getState().updateChapter(f.chapterId, { content: external, wordCount: 8 })
        await new Promise(resolve => setTimeout(resolve, 60))
      })
      expect(await waitFor(() => (mounted.host.querySelector('.cm-content')?.textContent ?? '').includes('外部采纳的正文')
        ? mounted.host.querySelector('.cm-content') : null)).not.toBeNull()
      const afterSync = (await db.chapters.get(f.chapterId))!
      expect(afterSync.content).toBe(external)
      expect(afterSync.updatedAt).not.toBe(before.updatedAt) // 外部那次写入确实生效过
      // 同步本身 0 次写库：再等一个自动保存窗口后行版本与内容都不变
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
      const afterIdle = (await db.chapters.get(f.chapterId))!
      expect(afterIdle.updatedAt).toBe(afterSync.updatedAt)
      expect(afterIdle.content).toBe(afterSync.content)
    } finally {
      await mounted.unmount()
    }
  })

  it('真实 ChapterEditor：外部同步后立即手动保存，不会把旧正文写回', async () => {
    const f = await fixture()
    const mounted = await mountEditor(f)
    try {
      expect(await waitFor(() => mounted.host.querySelector('.cm-editor'))).not.toBeNull()
      const external = '<p>外部采纳的正文</p>'
      await act(async () => {
        await useChapterStore.getState().updateChapter(f.chapterId, { content: external, wordCount: 8 })
        await new Promise(resolve => setTimeout(resolve, 60))
      })
      // 会话先真正收到外部内容（作者看到的正文已是外部结果）
      expect(await waitFor(() => (mounted.host.querySelector('.cm-content')?.textContent ?? '').includes('外部采纳的正文')
        ? mounted.host.querySelector('.cm-content') : null)).not.toBeNull()
      // 作者立即手动保存：必须写回 CM 真实内容，而不是旧的 React 回退值
      await clickButton(mounted.host, '保存')
      const saved = (await db.chapters.get(f.chapterId))!
      expect(saved.content).toContain('外部采纳的正文')
      expect(saved.wordCount).toBeGreaterThan(0)
      // 作者随后在 CM 补写并保存，同样以会话内容为准
      const view = cmView(mounted.host)!
      await act(async () => {
        view.dispatch({ changes: { from: 0, to: 0, insert: '作者补写\n\n' } })
        await new Promise(resolve => setTimeout(resolve, 30))
      })
      await clickButton(mounted.host, '保存')
      const finalRow = (await db.chapters.get(f.chapterId))!
      expect(finalRow.content).toContain('作者补写')
      expect(finalRow.content).toContain('外部采纳的正文')
    } finally {
      await mounted.unmount()
    }
  })

  it('非 CM（短篇不开放）路径不变：仍走富文本，外部写入不经 CM 会话', async () => {
    const f = await fixture('short')
    const mounted = await mountEditor(f)
    try {
      expect(await waitFor(() => mounted.host.querySelector('.ProseMirror'))).not.toBeNull()
      expect(mounted.host.querySelector('.cm-editor')).toBeNull()
      expect(mounted.host.querySelector('[aria-label="编辑模式"]')).toBeNull()
      const external = '<p>短篇外部写入</p>'
      await act(async () => {
        await useChapterStore.getState().updateChapter(f.chapterId, { content: external, wordCount: 6 })
        await new Promise(resolve => setTimeout(resolve, 60))
      })
      expect(mounted.host.querySelector('.cm-editor')).toBeNull()
      expect((await db.chapters.get(f.chapterId))!.content).toBe(external)
    } finally {
      await mounted.unmount()
    }
  })
})
