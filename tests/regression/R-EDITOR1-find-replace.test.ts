import { describe, expect, it } from 'vitest'
import {
  buildChapterSearchTargets,
  findChapterMatches,
  replaceChapterContent,
  type ChapterSearchTarget,
} from '../../src/lib/editor/find-replace'
import {
  countPlannedReplacements,
  executeFindReplace,
  undoFindReplace,
} from '../../src/lib/editor/find-replace-operation'
import type { Chapter, OutlineNode } from '../../src/lib/types'

const target: ChapterSearchTarget = {
  id: 1,
  outlineNodeId: 10,
  title: '第一章',
  content: '<p>李明举起剑。</p><p><strong>李明</strong>没有看李明轩。</p>',
}

describe('EDITOR-1 · 全书查找替换底层能力', () => {
  it('查找命中按章节汇总并提供上下文片段', () => {
    const preview = findChapterMatches(target, { query: '李明' })
    expect(preview?.count).toBe(3)
    expect(preview?.occurrences[0]?.snippet).toContain('李明举起剑')
  })

  it('全字匹配不会误伤更长实体名', () => {
    const preview = findChapterMatches(target, { query: '李明', wholeWord: true, protectedTerms: ['李明', '李明轩'] })
    expect(preview?.count).toBe(2)

    const replaced = replaceChapterContent(target.content, {
      query: '李明',
      replacement: '林照',
      wholeWord: true,
      protectedTerms: ['李明', '李明轩'],
    })
    expect(replaced.count).toBe(2)
    expect(replaced.html).toContain('林照举起剑')
    expect(replaced.html).toContain('<strong>林照</strong>')
    expect(replaced.html).toContain('李明轩')
  })

  it('大小写敏感选项生效', () => {
    const content = '<p>Alpha alpha ALPHA</p>'
    expect(findChapterMatches({ ...target, content }, { query: 'alpha' })?.count).toBe(3)
    expect(findChapterMatches({ ...target, content }, { query: 'alpha', caseSensitive: true })?.count).toBe(1)
  })

  it('正则替换支持捕获组，不破坏段落标签', () => {
    const replaced = replaceChapterContent('<p>第12章 第34章</p>', {
      query: '第(\\d+)章',
      replacement: 'Chapter $1',
      useRegex: true,
    })
    expect(replaced.count).toBe(2)
    expect(replaced.html).toBe('<p>Chapter 12 Chapter 34</p>')
  })

  it('可只替换单处命中', () => {
    const replaced = replaceChapterContent(target.content, {
      query: '李明',
      replacement: '林照',
    }, { onlyOccurrenceIndex: 1 })
    expect(replaced.count).toBe(1)
    expect(replaced.html).toContain('李明举起剑')
    expect(replaced.html).toContain('<strong>林照</strong>')
    expect(replaced.html).toContain('李明轩')
  })

  it('全书替换预览只统计实际命中的章', () => {
    const plan = countPlannedReplacements([
      target,
      { id: 2, outlineNodeId: 11, title: '第二章', content: '<p>无人提及。</p>' },
    ], { query: '李明' }, 'book')

    expect(plan).toEqual({ count: 3, affectedChapters: 1 })
  })

  it('查找目标复用 canonical 章节选择，忽略同一大纲节点下的重复空章节', () => {
    const outlineNodes: OutlineNode[] = [{
      id: 10,
      projectId: 100,
      parentId: null,
      type: 'chapter',
      title: '大纲标题',
      summary: '',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }]
    const chapters: Chapter[] = [
      {
        id: 1,
        projectId: 100,
        outlineNodeId: 10,
        title: '空重复章',
        content: '',
        wordCount: 0,
        status: 'draft',
        order: 0,
        notes: '',
        createdAt: 1,
        updatedAt: 10,
      },
      {
        id: 2,
        projectId: 100,
        outlineNodeId: 10,
        title: '有正文章',
        content: '<p>李明写下正文。</p>',
        wordCount: 7,
        status: 'draft',
        order: 0,
        notes: '',
        createdAt: 1,
        updatedAt: 2,
      },
    ]

    expect(buildChapterSearchTargets(chapters, outlineNodes)).toEqual([{
      id: 2,
      outlineNodeId: 10,
      title: '大纲标题',
      content: '<p>李明写下正文。</p>',
    }])
  })

  it('全书查找目标按大纲 canonical 顺序跨卷排列', () => {
    const now = 1
    const outlineNodes: OutlineNode[] = [
      { id: 1, projectId: 100, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, createdAt: now, updatedAt: now },
      { id: 2, projectId: 100, parentId: null, type: 'volume', title: '第二卷', summary: '', order: 1, createdAt: now, updatedAt: now },
      { id: 21, projectId: 100, parentId: 2, type: 'chapter', title: '第二卷第一章', summary: '', order: 0, createdAt: now, updatedAt: now },
      { id: 11, projectId: 100, parentId: 1, type: 'chapter', title: '第一卷第一章', summary: '', order: 0, createdAt: now, updatedAt: now },
      { id: 12, projectId: 100, parentId: 1, type: 'chapter', title: '第一卷第二章', summary: '', order: 1, createdAt: now, updatedAt: now },
    ]
    const chapters: Chapter[] = [21, 11, 12].map((outlineNodeId, index) => ({
      id: index + 1,
      projectId: 100,
      outlineNodeId,
      title: `C${outlineNodeId}`,
      content: `<p>${outlineNodeId}</p>`,
      wordCount: 1,
      status: 'draft',
      order: index,
      notes: '',
      createdAt: now,
      updatedAt: now,
    }))

    expect(buildChapterSearchTargets(chapters, outlineNodes).map(item => item.outlineNodeId))
      .toEqual([11, 12, 21])
  })

  it('批量替换先创建快照，并可用内存补丁撤销', async () => {
    const chapters: Chapter[] = [
      {
        id: 1,
        projectId: 100,
        outlineNodeId: 10,
        title: '第一章',
        content: '<p>李明遇见李明。</p>',
        wordCount: 6,
        status: 'draft',
        order: 1,
        notes: '',
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 2,
        projectId: 100,
        outlineNodeId: 11,
        title: '第二章',
        content: '<p>李明离开。</p>',
        wordCount: 4,
        status: 'draft',
        order: 2,
        notes: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    const targets = chapters.map(chapter => ({
      id: chapter.id!,
      outlineNodeId: chapter.outlineNodeId,
      title: chapter.title,
      content: chapter.content,
    }))
    const calls: string[] = []
    const contents = new Map(chapters.map(chapter => [chapter.id!, chapter.content]))
    const wordCounts = new Map(chapters.map(chapter => [chapter.id!, chapter.wordCount]))

    const result = await executeFindReplace({
      mode: 'book',
      targets,
      chapters,
      options: { query: '李明', replacement: '林照' },
      projectId: 100,
      createSnapshot: async () => {
        calls.push('snapshot')
        return 77
      },
      updateChapter: async (id, patch) => {
        calls.push(`update:${id}`)
        if (typeof patch.content === 'string') contents.set(id, patch.content)
        if (typeof patch.wordCount === 'number') wordCounts.set(id, patch.wordCount)
      },
      label: '测试快照',
    })

    expect(calls).toEqual(['snapshot', 'update:1', 'update:2'])
    expect(result.snapshotId).toBe(77)
    expect(result.replaced).toBe(3)
    expect(result.affectedChapters).toBe(2)
    expect(result.undoPatch.chapters.map(chapter => chapter.content)).toEqual([
      '<p>李明遇见李明。</p>',
      '<p>李明离开。</p>',
    ])
    expect(contents.get(1)).toContain('林照遇见林照')
    expect(contents.get(2)).toContain('林照离开')

    calls.length = 0
    const restored = await undoFindReplace(result.undoPatch, async (id, patch) => {
      calls.push(`undo:${id}`)
      if (typeof patch.content === 'string') contents.set(id, patch.content)
      if (typeof patch.wordCount === 'number') wordCounts.set(id, patch.wordCount)
    })

    expect(restored).toBe(2)
    expect(calls).toEqual(['undo:1', 'undo:2'])
    expect(contents.get(1)).toBe('<p>李明遇见李明。</p>')
    expect(contents.get(2)).toBe('<p>李明离开。</p>')
    expect(wordCounts.get(1)).toBe(6)
    expect(wordCounts.get(2)).toBe(4)
  })
})
