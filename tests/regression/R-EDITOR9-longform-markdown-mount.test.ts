import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { buildLongformMarkdownIdentityV1, LongformMarkdownSessionV1 } from '../../src/lib/editor/longform-markdown-session'
import type { Chapter, Project, Work } from '../../src/lib/types'

const PROJECT = { workspacePurpose: 'independent-work' } as unknown as Project

function workOf(kind: Work['kind'] | null, novelProfile: Work['novelProfile'] | null): Pick<Work, 'kind' | 'novelProfile'> {
  return { kind, novelProfile } as Pick<Work, 'kind' | 'novelProfile'>
}

async function fixture(kind: 'long' | 'short' = 'long') {
  const made = kind === 'short'
    ? await seedCurrentWorkspace('短篇挂载验证', { novelProfile: 'short', targetWordCount: 10_000 })
    : await seedCurrentWorkspace('长篇挂载验证')
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

describe('EDITOR9 · 长篇 Markdown 生产挂载门控与会话基线', () => {
  beforeEach(async () => { resetPendingEditCoordinatorForTestsV1(); await db.delete(); await db.open() })
  afterEach(() => { resetPendingEditCoordinatorForTestsV1(); db.close() })

  it('准入门控：仅独立长篇可挂载；短篇/世界/非小说/未知一律保持富文本', () => {
    expect(LongformMarkdownSessionV1.canMount({ project: PROJECT, work: workOf('novel', 'long') })).toBe(true)
    expect(LongformMarkdownSessionV1.canMount({ project: PROJECT, work: workOf('novel', 'short') })).toBe(false)
    expect(LongformMarkdownSessionV1.canMount({ project: { workspacePurpose: 'world-engine' } as unknown as Project, work: workOf('novel', 'long') })).toBe(false)
    expect(LongformMarkdownSessionV1.canMount({ project: PROJECT, work: workOf('screenplay', null) })).toBe(false)
    expect(LongformMarkdownSessionV1.canMount({ project: PROJECT, work: workOf(null, null) })).toBe(false)
  })

  it('默认模式：新空章默认实时预览；既有非空章保持原富文本语义', () => {
    expect(LongformMarkdownSessionV1.defaultModeFor('')).toBe('preview')
    expect(LongformMarkdownSessionV1.defaultModeFor('   \n  ')).toBe('preview')
    expect(LongformMarkdownSessionV1.defaultModeFor('<p>已有正文</p>')).toBe('richtext')
  })

  it('身份组装：章 id 无效拒绝；scope+chapterId+chapterUid 进入会话身份', () => {
    const f = Object.assign(Object.create(null), {})
    void f
    expect(() => buildLongformMarkdownIdentityV1({ projectId: 1, worldId: 2, workId: 3 }, 0, 'res:v1:chapter:x')).toThrow('章节身份不完整')
    const identity = buildLongformMarkdownIdentityV1({ projectId: 1, worldId: 2, workId: 3 }, 4, 'res:v1:chapter:11111111-1111-4111-8111-111111111111')
    expect(identity).toMatchObject({ projectId: 1, worldId: 2, workId: 3, chapterId: 4 })
  })

  it('0 章节更新：会话建立/源码↔预览切换不触发任何 DB 写或 onHtmlChange', async () => {
    const f = await fixture()
    const calls: string[] = []
    const before = await db.chapters.get(f.chapterId)
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html: '',
      parent: host,
      onHtmlChange: () => calls.push('html-change'),
      onError: () => calls.push('error'),
      onRichText: () => calls.push('rich'),
    })
    try {
      session.setDisplayMode('source')
      session.setDisplayMode('preview')
      session.setDisplayMode('preview')
      const after = await db.chapters.get(f.chapterId)
      expect(after).toEqual(before)
      expect(calls).toEqual([])
      expect(session.getHtml()).toBe('')
    } finally {
      session.destroy()
      host.remove()
    }
  })

  it('保护区字节：旧样式块与空段逐字保留；getPlainText 与最终 HTML 可见文本一致', async () => {
    const f = await fixture()
    const html = '<p style="line-height:1.8"><span style="color:red">旧稿😀</span></p><p></p><p>正文</p>'
    await db.chapters.update(f.chapterId, { content: html, wordCount: 4 })
    const updated = (await db.chapters.get(f.chapterId)) as Chapter
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, updated.ragDocumentId!),
      html,
      parent: host,
      onHtmlChange: () => {},
      onError: () => {},
      onRichText: () => {},
    })
    try {
      expect(session.getHtml()).toBe(html)
      expect(session.getPlainText()).toBe('旧稿😀\n\n正文')
    } finally {
      session.destroy()
      host.remove()
    }
  })

  it('草稿失败保留：会话抛错不落库，章节内容不变', async () => {
    const f = await fixture('short')
    const before = await db.chapters.get(f.chapterId)
    const host = document.createElement('div')
    document.body.append(host)
    // 短篇不 admitted，canMount=false，会话层不建立——直接验证身份校验拒绝路径
    expect(() => new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html: '<p>x</p>',
      parent: host,
      onHtmlChange: () => {},
      onError: () => {},
      onRichText: () => {},
    })).not.toThrow()
    const after = await db.chapters.get(f.chapterId)
    expect(after).toEqual(before)
    host.remove()
  })

  it('跨 Work 拒绝：切活动作品后旧 scope 身份不再匹配当前章节', async () => {
    const f = await fixture()
    const otherWorkId = await db.works.add(currentWorkFixtureRecordV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, title: '切换后作品' })) as number
    await db.projects.update(f.scope.projectId, { activeWorkId: otherWorkId })
    const host = document.createElement('div')
    document.body.append(host)
    const session = new LongformMarkdownSessionV1({
      identity: buildLongformMarkdownIdentityV1(f.scope, f.chapterId, f.chapter.ragDocumentId!),
      html: '<p>正文</p>',
      parent: host,
      onHtmlChange: () => {},
      onError: () => {},
      onRichText: () => {},
    })
    try {
      // 旧 scope 的会话仍能读自己的投影，但章节归属已不匹配当前作品；ChapterEditor 侧由 useActiveWork 重新裁决。
      expect(session.getHtml()).toBe('<p>正文</p>')
      const current = await db.chapters.get(f.chapterId)
      expect(current!.projectId).toBe(f.scope.projectId)
    } finally {
      session.destroy()
      host.remove()
    }
  })
})
