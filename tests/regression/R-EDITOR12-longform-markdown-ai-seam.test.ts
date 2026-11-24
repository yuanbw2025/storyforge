import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { db } from '../../src/lib/db/schema'
import { EditorView } from '@codemirror/view'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { buildLongformMarkdownIdentityV1, LongformMarkdownSessionV1 } from '../../src/lib/editor/longform-markdown-session'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import { useChapterStore } from '../../src/stores/chapter'
import { useOutlineStore } from '../../src/stores/outline'
import ChapterEditor from '../../src/components/editor/ChapterEditor'

const toolbarProbe = vi.hoisted(() => ({ active: false, props: null as Record<string, unknown> | null }))
vi.mock('../../src/components/editor/FloatingToolbar', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/components/editor/FloatingToolbar')>()
  return {
    default: (props: Record<string, unknown>) => {
      if (!toolbarProbe.active) return createElement(actual.default, props as never)
      toolbarProbe.props = props
      return null
    },
  }
})
import type { Chapter } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

async function fixture(kind: 'long' | 'short' = 'long', content = '<p>第一章正文足够长可以选区预演</p>') {
  const made = kind === 'short'
    ? await seedCurrentWorkspace('AI接缝短篇验证', { novelProfile: 'short', targetWordCount: 10_000 })
    : await seedCurrentWorkspace('AI接缝长篇验证')
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(made.scope, 'outlineNodes', {
    projectId: made.scope.projectId, parentId: null, type: 'chapter', title: '第一章', summary: '', order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const now = Date.now()
  const chapterId = await db.chapters.add(stampNewRecord(made.scope, 'chapters', {
    projectId: made.scope.projectId, outlineNodeId, title: '第一章', content, wordCount: 14, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const chapter = (await db.chapters.get(chapterId)) as Chapter
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

/** 打开已有正文章后显式切到实时预览（默认非空章保持富文本）。 */
async function openCmEditor(f: Awaited<ReturnType<typeof fixture>>) {
  const mounted = await mountEditor(f)
  expect(await waitFor(() => mounted.host.querySelector('[aria-label="编辑模式"]'))).not.toBeNull()
  await clickButton(mounted.host, '实时预览')
  expect(await waitFor(() => mounted.host.querySelector('.cm-editor'))).not.toBeNull()
  return mounted
}

describe('EDITOR12 · CM 活动时 FloatingToolbar 的选区/预演/采纳接缝', () => {
  beforeEach(async () => { resetPendingEditCoordinatorForTestsV1(); await db.delete(); await db.open() })
  afterEach(() => { resetPendingEditCoordinatorForTestsV1(); db.close() })

  it('① CM 快照映射：getToolbarSelectionV1 投影 PM 坐标并登记内部快照，不冒充 CM 源 pos', async () => {
    const f = await fixture()
    const html = f.chapter.content
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html, parent: host,
      onHtmlChange: () => {}, onError: () => {}, onRichText: () => {},
    })
    try {
      const view = session.view.view
      // 选中可见正文的一段（CM 源坐标），mapSelection 会把它投影成 PM 位置
      const source = session.getHtml()
      const text = '第一章正文足够长可以选区预演'
      const cmFrom = session.view.view.state.doc.toString().indexOf(text)
      expect(cmFrom).toBeGreaterThanOrEqual(0)
      await act(async () => {
        view.dispatch({ selection: { anchor: cmFrom, head: cmFrom + text.length } })
      })
      const empty = session.getToolbarSelectionV1()
      expect(empty.snapshot).not.toBeNull()
      const snapshot = empty.snapshot!
      // PM 坐标：from 通常为 1（doc→paragraph→text），与 CM 源坐标不同
      expect(snapshot.from).toBeGreaterThanOrEqual(0)
      expect(snapshot.to).toBeGreaterThan(snapshot.from)
      expect(snapshot.text).toBe(text)
      expect(snapshot.sourceHtml).toBe(source)
      expect(empty.reason).toBeUndefined()
      expect(snapshot.from).not.toBe(cmFrom) // 禁止把 CM 源 pos 塞给 durable
      // 空选区返回 null+reason
      await act(async () => { view.dispatch({ selection: { anchor: 0 } }) })
      expect(session.getToolbarSelectionV1().snapshot).toBeNull()
      expect(session.getToolbarSelectionV1().reason).toBeTruthy()
    } finally {
      session.destroy(); host.remove()
    }
  })

  it('② 精确预演：用登记过的内部快照调 adapter.previewReplacement，返回完整 HTML 且 0 写库/0 改 CM', async () => {
    const f = await fixture()
    const html = f.chapter.content
    const host = document.createElement('div')
    document.body.append(host)
    const changes: string[] = []
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html, parent: host,
      onHtmlChange: (value) => changes.push(value), onError: () => {}, onRichText: () => {},
    })
    try {
      const view = session.view.view
      const text = '第一章正文足够长可以选区预演'
      const cmFrom = session.view.view.state.doc.toString().indexOf(text)
      await act(async () => { view.dispatch({ selection: { anchor: cmFrom, head: cmFrom + text.length } }) })
      const target = session.getToolbarSelectionV1().snapshot!
      const before = session.getHtml()
      const sourceRevision = session.getSourceRevision()
      const preview = session.previewToolbarReplacementV1({ ...target }, '替换后的正文')
      expect(preview).not.toBeNull()
      expect(preview).toContain('替换后的正文')
      expect(preview).toContain('<p>')
      // 只是预演：CM 正文/版本/草稿/DB 全部不变
      expect(session.getHtml()).toBe(before)
      expect(session.getSourceRevision()).toBe(sourceRevision)
      expect(changes).toEqual([])
      expect((await db.chapters.get(f.chapterId))!.content).toBe(html)
    } finally {
      session.destroy(); host.remove()
    }
  })

  it('③ 过期/保护块/跨区/语法边界预演返回 null，不写入', async () => {
    const f = await fixture()
    const html = f.chapter.content
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html, parent: host,
      onHtmlChange: () => {}, onError: () => {}, onRichText: () => {},
    })
    try {
      const view = session.view.view
      const text = '第一章正文足够长可以选区预演'
      const cmFrom = session.view.view.state.doc.toString().indexOf(text)
      await act(async () => { view.dispatch({ selection: { anchor: cmFrom, head: cmFrom + text.length } }) })
      const target = session.getToolbarSelectionV1().snapshot!
      // 未登记的伪造 target → null
      expect(session.previewToolbarReplacementV1({ ...target, text: '别的文字' }, 'x')).toBeNull()
      // 作者随后编辑：旧 target 的 sourceRevision/基线过期 → adapter 返回 null
      await act(async () => { view.dispatch({ changes: { from: 0, to: 0, insert: '作者新输入\n\n' } }) })
      expect(session.previewToolbarReplacementV1({ ...target }, 'x')).toBeNull()
      expect((await db.chapters.get(f.chapterId))!.content).toBe(html)
    } finally {
      session.destroy(); host.remove()
    }
  })

  it('④ 采纳闭环：真实 ChapterEditor 中已提交 html 经 commitExternalHtml 刷新同一 CM 节点，0 额外写库', async () => {
    const f = await fixture()
    const mounted = await openCmEditor(f)
    try {
      const cmNode = mounted.host.querySelector('.cm-editor')
      expect(cmNode).not.toBeNull()
      // 外部 durable adopt() 已完成写库；这里只模拟同一已提交回执进入 CM 刷新接缝：
      // 通过 store 写入与当前会话不同的已提交内容，触发 EXT-SYNC 既有同步（同一 adapter）。
      const adopted = '<p>已采纳的局部改写正文</p>'
      await act(async () => {
        await useChapterStore.getState().updateChapter(f.chapterId, { content: adopted, wordCount: 10 })
        await new Promise(resolve => setTimeout(resolve, 80))
      })
      expect(await waitFor(() => (mounted.host.querySelector('.cm-content')?.textContent ?? '').includes('已采纳的局部改写正文')
        ? mounted.host.querySelector('.cm-content') : null)).not.toBeNull()
      // 同一 CM 会话/节点未被重建
      expect(mounted.host.querySelector('.cm-editor')).toBe(cmNode)
      const committed = (await db.chapters.get(f.chapterId))!
      expect(committed.content).toBe(adopted)
      // 同步本身不产生第二次写库
      const updatedAt = committed.updatedAt
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })
      expect((await db.chapters.get(f.chapterId))!.updatedAt).toBe(updatedAt)
    } finally {
      await mounted.unmount()
    }
  })

  it('⑤ 非 CM 路径逐字不变：短篇不开放，仍挂 RichEditor 且不出现 CM/模式组', async () => {
    const f = await fixture('short')
    const mounted = await mountEditor(f)
    try {
      expect(await waitFor(() => mounted.host.querySelector('.ProseMirror'))).not.toBeNull()
      expect(mounted.host.querySelector('.cm-editor')).toBeNull()
      expect(mounted.host.querySelector('[aria-label="编辑模式"]')).toBeNull()
      // 非 CM 的 getCurrentHtml/preview 仍由原 editorRef 链服务，不进入 session
      expect(mounted.host.querySelector('.tiptap-editor')).not.toBeNull()
    } finally {
      await mounted.unmount()
    }
  })

  it('④b 直接接线：CM 激活时 onContentAdopted 经同一 adapter 刷新会话，非 CM 仍走 editorRef 链', async () => {
    toolbarProbe.active = true
    const f = await fixture()
    const mounted = await openCmEditor(f)
    try {
      // 捕获真实 ChapterEditor 传给 FloatingToolbar 的回调（props 签名未改）
      expect(toolbarProbe.props).not.toBeNull()
      const props = toolbarProbe.props as {
        getCurrentHtml: () => string
        getSelectionSnapshot: () => unknown
        previewRangeReplacement: (from: number, to: number, text: string) => string | null
        onContentAdopted: (html: string, demotedFacts: number) => void
      }
      // CM 当前 HTML 取自 session，而不是旧 React content 回退
      expect(props.getCurrentHtml()).toContain('第一章正文足够长可以选区预演')
      // 先把真实已提交章行改成采纳结果（模拟 durable adopt() 完成 CAS 写库）
      const adopted = '<p>AI局部改写已写入</p>'
      await act(async () => {
        await useChapterStore.getState().updateChapter(f.chapterId, { content: adopted, wordCount: 9 })
        await new Promise(resolve => setTimeout(resolve, 80))
      })
      const cmNode = mounted.host.querySelector('.cm-editor')
      const updatedAt = (await db.chapters.get(f.chapterId))!.updatedAt
      // 直接调用采纳回调：应刷新同一 CM 会话、不第二次写库、不重建节点
      await act(async () => {
        props.onContentAdopted(adopted, 0)
        await new Promise(resolve => setTimeout(resolve, 80))
      })
      expect(mounted.host.querySelector('.cm-editor')).toBe(cmNode)
      expect((mounted.host.querySelector('.cm-content')?.textContent ?? '')).toContain('AI局部改写已写入')
      const after = (await db.chapters.get(f.chapterId))!
      expect(after.content).toBe(adopted)
      expect(after.updatedAt).toBe(updatedAt)
      // 旧候选/不符回执不能覆盖：传入与已提交行不同的 html 时显式提示且不写库
      await act(async () => {
        props.onContentAdopted('<p>与回执不符的旧候选</p>', 0)
        await new Promise(resolve => setTimeout(resolve, 50))
      })
      expect((await db.chapters.get(f.chapterId))!.content).toBe(adopted)
      expect((await db.chapters.get(f.chapterId))!.updatedAt).toBe(updatedAt)
      expect(mounted.host.querySelector('[role="alert"]')).not.toBeNull()
    } finally {
      await mounted.unmount()
      toolbarProbe.active = false
    }
  })

  it('①b 真实 FloatingToolbar 出现：CM 活动且 CM 选区 >5 字时能渲染局部编辑工具栏', async () => {
    const f = await fixture()
    const mounted = await openCmEditor(f)
    try {
      const view = mounted.host.querySelector('.cm-editor') as HTMLElement
      expect(view).not.toBeNull()
      // 用真实 CM 事务选中可见正文；CM 会同步 DOM selection，触发既有 selectionchange 轮询。
      const text = '第一章正文足够长可以选区预演'
      const cm = await waitFor(() => mounted.host.querySelector('.cm-content'))
      expect(cm).not.toBeNull()
      const walker = document.createTreeWalker(cm!, NodeFilter.SHOW_TEXT)
      let node: Node | null = null
      while ((node = walker.nextNode())) {
        if ((node.textContent ?? '').includes(text)) break
      }
      expect(node).not.toBeNull()
      const offset = (node!.textContent ?? '').indexOf(text)
      const domStart = offset
      await act(async () => {
        const selection = window.getSelection()!
        const range = document.createRange()
        range.setStart(node!, domStart)
        range.setEnd(node!, domStart + text.length)
        selection.removeAllRanges()
        selection.addRange(range)
        // CM 自己的 state 也要有对应选区，getSelectionSnapshot 才返回投影
        const cmDom = mounted.host.querySelector('.cm-editor') as HTMLElement
        const editorView = EditorView.findFromDOM(cmDom)
        expect(editorView).not.toBeNull()
        const from = editorView!.state.doc.toString().indexOf(text)
        expect(from).toBeGreaterThanOrEqual(0)
        editorView!.dispatch({ selection: { anchor: from, head: from + text.length } })
        document.dispatchEvent(new Event('selectionchange'))
        await new Promise(resolve => setTimeout(resolve, 100))
      })
      expect(await waitFor(() => mounted.host.querySelector('[data-project-id]'))).not.toBeNull()
    } finally {
      await mounted.unmount()
    }
  })
})
