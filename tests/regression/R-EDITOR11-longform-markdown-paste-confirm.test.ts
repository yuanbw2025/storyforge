import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
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
import type { AuthoringPasteDraftV1 } from '../../src/lib/editor/authoring-document-adapter'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const LARGE = '大段粘贴内容'.repeat(4000) // 24000 字符，超过 10000 阈值

/** 在真实 CM contentDOM 上派发粘贴事件（happy-dom 无 clipboardData，用属性注入）。 */
function dispatchPaste(text: string, target: HTMLElement) {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } })
  target.dispatchEvent(event)
}

async function fixture() {
  const made = await seedCurrentWorkspace('大段粘贴确认验证')
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(made.scope, 'outlineNodes', {
    projectId: made.scope.projectId, parentId: null, type: 'chapter', title: '第一章', summary: '', order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  const now = Date.now()
  const chapterId = await db.chapters.add(stampNewRecord(made.scope, 'chapters', {
    projectId: made.scope.projectId, outlineNodeId, title: '第一章', content: '<p>甲</p>', wordCount: 1, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now,
  }, { owner: 'work' }) as never) as number
  const chapter = (await db.chapters.get(chapterId))!
  return { ...made, outlineNodeId, chapterId, chapter }
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

describe('EDITOR11 · 大段粘贴预览确认、取消与生命周期 abort', () => {
  beforeEach(async () => { resetPendingEditCoordinatorForTestsV1(); await db.delete(); await db.open() })
  afterEach(() => { resetPendingEditCoordinatorForTestsV1(); db.close() })

  it('onLargePaste 透传：超阈值粘贴被拦截并回传草稿与取消句柄', async () => {
    const f = await fixture()
    const calls: { text: string; cancel: () => void; draft: Promise<AuthoringPasteDraftV1> }[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html: '<p>甲</p>', parent: host,
      onHtmlChange: () => {}, onError: () => {}, onRichText: () => {},
      onLargePaste: pending => { void pending.draft.catch(() => undefined); calls.push(pending) },
    })
    try {
      dispatchPaste(LARGE, session.view.view.contentDOM)
      expect(calls).toHaveLength(1)
      expect(calls[0].text).toBe(LARGE)
      expect(typeof calls[0].cancel).toBe('function')
      expect(calls[0].draft).toBeInstanceOf(Promise)
      // 未确认前原稿与版本都不变
      expect(session.getHtml()).toBe('<p>甲</p>')
      expect(session.getSourceRevision()).toBe(0)
    } finally {
      session.destroy(); host.remove()
    }
  })

  it('确认后单事务写入：HTML 变化、草稿已 stage、版本只前进一次', async () => {
    const f = await fixture()
    const changes: string[] = []
    let pending: { text: string; cancel: () => void; draft: Promise<AuthoringPasteDraftV1> } | null = null
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html: '<p>甲</p>', parent: host,
      onHtmlChange: (html) => changes.push(html), onError: () => {}, onRichText: () => {},
      onLargePaste: value => { void value.draft.catch(() => undefined); pending = value },
    })
    try {
      dispatchPaste(LARGE, session.view.view.contentDOM)
      expect(pending).not.toBeNull()
      const draft = await pending!.draft
      session.commitPaste(draft)
      expect(session.getHtml()).toContain('大段粘贴内容')
      expect(session.getSourceRevision()).toBe(1) // 一次确认 = 一个事务
      expect(changes).toHaveLength(1)             // 草稿缓冲只被喂一次
      expect(changes[0]).toBe(session.getHtml())
      // 0 次 DB 写：草稿仍在内存缓冲，等既有 autosave/manual save
      expect((await db.chapters.get(f.chapterId))!.content).toBe('<p>甲</p>')
    } finally {
      session.destroy(); host.remove()
    }
  })

  it('取消后零副作用：HTML 与 sourceRevision 不变，草稿被取消不可再提交', async () => {
    const f = await fixture()
    const changes: string[] = []
    let pending: { text: string; cancel: () => void; draft: Promise<AuthoringPasteDraftV1> } | null = null
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html: '<p>甲</p>', parent: host,
      onHtmlChange: (html) => changes.push(html), onError: () => {}, onRichText: () => {},
      onLargePaste: value => { void value.draft.catch(() => undefined); pending = value },
    })
    try {
      dispatchPaste(LARGE, session.view.view.contentDOM)
      const snapshot = pending!
      snapshot.cancel()
      await expect(snapshot.draft).rejects.toBeTruthy()
      expect(session.getHtml()).toBe('<p>甲</p>')
      expect(session.getSourceRevision()).toBe(0)
      expect(changes).toHaveLength(0)
      expect((await db.chapters.get(f.chapterId))!.content).toBe('<p>甲</p>')
    } finally {
      session.destroy(); host.remove()
    }
  })

  it('卸载/销毁中止未决粘贴：不残留半截草稿', async () => {
    const f = await fixture()
    let pending: { text: string; cancel: () => void; draft: Promise<AuthoringPasteDraftV1> } | null = null
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html: '<p>甲</p>', parent: host,
      onHtmlChange: () => {}, onError: () => {}, onRichText: () => {},
      onLargePaste: value => { void value.draft.catch(() => undefined); pending = value },
    })
    dispatchPaste(LARGE, session.view.view.contentDOM)
    const snapshot = pending!
    session.destroy()
    await expect(snapshot.draft).rejects.toBeTruthy()
    expect(host.querySelector('.cm-editor')).toBeNull()
    host.remove()
  })

  it('普通小段粘贴不被拦截：不触发 onLargePaste', async () => {
    const f = await fixture()
    const calls: unknown[] = []
    const errors: unknown[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html: '<p>甲</p>', parent: host,
      onHtmlChange: () => {}, onError: error => errors.push(error), onRichText: () => {},
      onLargePaste: pending => { void pending.draft.catch(() => undefined); calls.push(pending) },
    })
    try {
      dispatchPaste('小段', session.view.view.contentDOM)
      // 小段粘贴不进入确认通道，也不报“需要预览确认”的错误
      expect(calls).toHaveLength(0)
      expect(errors).toHaveLength(0)
    } finally {
      session.destroy(); host.remove()
    }
  })

  it('真实 ChapterEditor：确认条显示字符数，取消不改正文，确认后写入并进入草稿', async () => {
    const f = await fixture()
    await useOutlineStore.getState().loadAll(f.scope)
    await useChapterStore.getState().loadAll(f.scope)
    useChapterStore.getState().selectChapter(f.chapterId)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => {
        root.render(createElement(MemoryRouter, null, createElement(DialogProvider, null, createElement(ToastProvider, null,
          createElement(ChapterEditor, { project: f.project, outlineNodeId: f.outlineNodeId })))))
      })
      // 非空章默认富文本：切到实时预览才有 CM
      expect(await waitFor(() => host.querySelector('[aria-label="编辑模式"]'))).not.toBeNull()
      await clickButton(host, '实时预览')
      const cm = await waitFor(() => host.querySelector('.cm-content'))
      expect(cm).not.toBeNull()
      // 取消路径：正文不变、DB 不变
      dispatchPaste(LARGE, cm as HTMLElement)
      expect(await waitFor(() => host.querySelector('[aria-label="大段粘贴确认"]'))).not.toBeNull()
      expect(host.textContent).toContain('24,000')
      await clickButton(host, '取消粘贴')
      expect(host.querySelector('[aria-label="大段粘贴确认"]')).toBeNull()
      expect((host.querySelector('.cm-content')?.textContent ?? '')).toContain('甲')
      expect((await db.chapters.get(f.chapterId))!.content).toBe('<p>甲</p>')
      // 确认路径：写入 CM 并进入草稿缓冲，DB 仍未写
      dispatchPaste(LARGE, host.querySelector('.cm-content') as HTMLElement)
      expect(await waitFor(() => host.querySelector('[aria-label="大段粘贴确认"]'))).not.toBeNull()
      await clickButton(host, '确认粘贴')
      expect(host.querySelector('[aria-label="大段粘贴确认"]')).toBeNull()
      expect(host.querySelector('.cm-content')?.textContent ?? '').toContain('大段粘贴内容')
      expect((await db.chapters.get(f.chapterId))!.content).toBe('<p>甲</p>')
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
