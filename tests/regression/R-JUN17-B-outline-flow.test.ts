import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  buildChapterOutlinePrompt,
  buildSingleChapterOutlinePrompt,
  buildVolumeOutlinePrompt,
} from '../../src/lib/ai/adapters/outline-adapter'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { adopt } from '../../src/lib/registry/adopt'

describe('R-JUN17-B · 大纲生成流程', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('B-1/B-2: 建议总卷数强约束生效，且已有卷只续接不重复', () => {
    const messages = buildVolumeOutlinePrompt(
      '长篇测试',
      '玄幻',
      '【世界观】九州',
      '【故事核心】主角统一九州',
      2_000_000,
      '',
      { parameterValues: { volumeCount: 20 } },
      '',
      '',
      {
        existingVolumeCount: 2,
        existingVolumesContext: '【已有卷大纲】\n1. 第一卷：入世\n2. 第二卷：风起',
      },
    )
    const full = messages.map(message => message.content).join('\n')
    expect(full).toContain('最终总卷数：严格为 20 卷')
    expect(full).toContain('当前已有 2 卷')
    expect(full).toContain('只生成后续缺少的 18 卷')
    expect(full).toContain('禁止改写、复述或重新生成已有卷')
  })

  it('B-1: 未启用建议卷数时由故事设定合理规划，不回退固定 2 卷', () => {
    const messages = buildVolumeOutlinePrompt(
      '自由规划',
      '悬疑',
      '【世界观】封闭海岛',
      '【故事核心】连环谜案',
      500_000,
      '',
      { parameterValues: {} },
    )
    const full = messages.map(message => message.content).join('\n')
    expect(full).toContain('不预设固定卷数')
    expect(full).toContain('不得套用固定 2 卷或其他固定值')
    expect(full).not.toContain('建议卷数：约 2 卷')
  })

  it('B-4: 单章补全只输出目标章节，不重建整卷', () => {
    const messages = buildSingleChapterOutlinePrompt(
      '第一卷',
      '主角加入宗门',
      '第3章：夜探藏经阁',
      '同级已有章节：第1章、第2章',
      '【世界观】修真宗门',
      '',
    )
    const full = messages.map(message => message.content).join('\n')
    expect(full).toContain('只补全现有空章节《第3章：夜探藏经阁》')
    expect(full).toContain('只输出 1 个 JSON 元素')
    expect(full).toContain('不得生成其他章节')
  })

  it('B-2: existingVolumeOutlines 经 CONTEXT_SOURCES/assembleContext 读取', async () => {
    expect(CONTEXT_SOURCE_BY_KEY.has('existingVolumeOutlines')).toBe(true)
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '上下文测试', genre: '', description: '', targetWordCount: 500_000,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    await db.outlineNodes.bulkAdd([
      { projectId, parentId: null, type: 'volume', title: '第一卷', summary: '主角出山', order: 0, createdAt: now, updatedAt: now },
      { projectId, parentId: null, type: 'volume', title: '第二卷', summary: '宗门大战', order: 1, createdAt: now, updatedAt: now },
    ] as any)
    const result = await assembleContext({ projectId, sourceKeys: ['existingVolumeOutlines'] })
    expect(result.included).toContain('existingVolumeOutlines')
    expect(result.text).toContain('第一卷')
    expect(result.text).toContain('宗门大战')
    expect(result.text).toContain('禁止重复')
  })

  it('QUICKWIN-4: 章纲/卷纲上下文经 CONTEXT_SOURCES 读取目标卷已写正文进度', async () => {
    expect(CONTEXT_SOURCE_BY_KEY.has('writtenChapterProgress')).toBe(true)
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '已写进度测试', genre: '', description: '', targetWordCount: 500_000,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const firstVolumeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume', title: '第一卷', summary: '入城风波', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const secondVolumeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume', title: '第二卷', summary: '远行', order: 1,
      createdAt: now, updatedAt: now,
    } as any) as number
    const storyBlockId = await db.outlineNodes.add({
      projectId, parentId: firstVolumeId, type: 'storyBlock', title: '起', summary: '', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const firstChapterId = await db.outlineNodes.add({
      projectId, parentId: storyBlockId, type: 'chapter', title: '第一章 雨夜入城', summary: '主角进城', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    const secondVolumeChapterId = await db.outlineNodes.add({
      projectId, parentId: secondVolumeId, type: 'chapter', title: '第二卷第一章', summary: '不应进入第一卷进度', order: 0,
      createdAt: now, updatedAt: now,
    } as any) as number
    await db.chapters.bulkAdd([
      {
        projectId, outlineNodeId: firstChapterId, title: '空重复章', content: '', wordCount: 0,
        status: 'draft', order: 99, notes: '', createdAt: now, updatedAt: now,
      },
      {
        projectId, outlineNodeId: firstChapterId, title: '第一章 雨夜入城',
        content: '<p>主角已经在雨夜进入青石城，并从守门人那里得知内城戒严。</p>',
        wordCount: 28, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now + 1,
      },
      {
        projectId, outlineNodeId: secondVolumeChapterId, title: '第二卷第一章',
        content: '<p>这段属于第二卷，不应该出现在第一卷已写正文进度里。</p>',
        wordCount: 24, status: 'draft', order: 1, notes: '', createdAt: now, updatedAt: now,
      },
    ] as any)

    const result = await assembleContext({
      projectId,
      outlineNodeId: firstVolumeId,
      worldGroupId: null,
      sourceKeys: ['writtenChapterProgress'],
    })

    expect(result.included).toContain('writtenChapterProgress')
    expect(result.text).toContain('【本卷已写正文进度 · 第一卷】')
    expect(result.text).toContain('雨夜进入青石城')
    expect(result.text).toContain('已保存章节正文/章节记忆')
    expect(result.text).toContain('事实边界')
    expect(result.text).not.toContain('这段属于第二卷')
    expect(result.text).not.toContain('空重复章（已写正文')
  })

  it('QUICKWIN-4: 章纲 prompt 遇到已写正文进度时必须声明已写正文优先', () => {
    const messages = buildChapterOutlinePrompt(
      '第一卷',
      '主角进入青石城',
      '【世界观】青石城\n\n【本卷已写正文进度 · 第一卷】\n- 第 1 章 雨夜入城（已写正文，约 28 字）\n  正文短摘:主角已经在雨夜进入青石城。',
      '',
    )
    const full = messages.map(message => message.content).join('\n')
    expect(full).toContain('已写正文优先')
    expect(full).toContain('已写章节不得被重写、否认或重排')
    expect(full).toContain('只为未写/目标章节补后续章纲')
  })

  it('B-3/B-4: adopt(recordId) 只更新当前项目中的目标大纲节点', async () => {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '定点采纳', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number
    const nodeId = await db.outlineNodes.add({
      projectId, parentId: null, type: 'volume', title: '第三卷', summary: '', order: 2,
      createdAt: now, updatedAt: now,
    } as any) as number
    const result = await adopt({
      projectId,
      target: 'outlineNodes',
      recordId: nodeId,
      mode: 'replace',
      data: { summary: 'AI 补全后的卷纲' },
    })
    expect(result.written).toHaveLength(1)
    expect((await db.outlineNodes.get(nodeId))?.summary).toBe('AI 补全后的卷纲')

    const rejected = await adopt({
      projectId: projectId + 999,
      target: 'outlineNodes',
      recordId: nodeId,
      mode: 'replace',
      data: { summary: '不应写入' },
    })
    expect(rejected.written).toHaveLength(0)
    expect((await db.outlineNodes.get(nodeId))?.summary).toBe('AI 补全后的卷纲')
  })
})
