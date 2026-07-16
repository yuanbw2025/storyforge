import { describe, expect, it, vi } from 'vitest'
import type { Chapter, OutlineNode, Project, WorldGroup } from '../../src/lib/types'
import type { AdoptInput, AdoptResult } from '../../src/lib/registry/types'
import { NOVEL_PROMPT_LIBRARY_SEEDS } from '../../src/lib/ai/prompt-library-seeds'
import { resolvePromptLibraryScope } from '../../src/lib/ai/prompt-library-scope'
import {
  adoptPromptLibraryChapterOutput,
  canAdoptPromptLibraryRun,
  containsConflictReport,
  type PromptLibraryChapterAdoptionDeps,
  type PromptLibraryCompletedRun,
} from '../../src/lib/editor/prompt-library-chapter-adoption'

const now = 1
const project = (overrides: Partial<Project> = {}): Project => ({
  id: 1,
  name: '安全采纳测试',
  genre: 'xuanhuan',
  genres: ['xuanhuan'],
  status: 'drafting',
  description: '',
  targetWordCount: 100_000,
  createdAt: now,
  updatedAt: now,
  ...overrides,
})

const nodes: OutlineNode[] = [
  { id: 10, projectId: 1, parentId: null, type: 'volume', title: '第一卷', summary: '', order: 0, worldGroupId: 101, createdAt: now, updatedAt: now },
  { id: 11, projectId: 1, parentId: 10, type: 'chapter', title: '第一章', summary: '', order: 0, createdAt: now, updatedAt: now },
  { id: 12, projectId: 1, parentId: 10, type: 'chapter', title: '第二章', summary: '', order: 1, createdAt: now, updatedAt: now },
]

const chapters: Chapter[] = [
  { id: 21, projectId: 1, outlineNodeId: 11, title: '第一章', content: '<p>旧正文</p>', wordCount: 3, status: 'draft', order: 0, notes: '', createdAt: now, updatedAt: now },
  { id: 22, projectId: 1, outlineNodeId: 12, title: '第二章', content: '<p>第二章正文</p>', wordCount: 5, status: 'draft', order: 1, notes: '', createdAt: now, updatedAt: now },
]

const groups: WorldGroup[] = [
  { id: 101, projectId: 1, name: '主世界', description: '', type: 'primary', order: 0, createdAt: now, updatedAt: now },
  { id: 102, projectId: 1, name: '异世界', description: '', type: 'parallel', order: 1, createdAt: now, updatedAt: now },
]

function template(assetId: 'P11-A' | 'P11-B' | 'P11-C') {
  const seed = NOVEL_PROMPT_LIBRARY_SEEDS.find(item => item.library?.assetId === assetId)
  if (!seed) throw new Error(`missing ${assetId}`)
  return { ...seed, createdAt: now, updatedAt: now }
}

function run(overrides: Partial<PromptLibraryCompletedRun> = {}): PromptLibraryCompletedRun {
  return {
    assetId: 'P11-B',
    projectId: 1,
    chapterId: 21,
    outlineNodeId: 11,
    worldGroupId: null,
    output: '林舟推门而入。\n她看见桌上的信。',
    completedAt: 10,
    ...overrides,
  }
}

function writtenResult(input: AdoptInput): AdoptResult {
  return {
    written: [{ id: input.recordId!, fields: Object.keys(input.data) }],
    aliasMapped: [], unknown: [], typeErrors: [], fkErrors: [], skipped: [],
  }
}

function deps(overrides: Partial<PromptLibraryChapterAdoptionDeps> = {}) {
  const write = vi.fn(async (input: AdoptInput) => writtenResult(input))
  const base: PromptLibraryChapterAdoptionDeps = {
    loadScopeData: async () => ({ chapters, nodes, groups }),
    createSnapshot: vi.fn(async () => 77),
    write,
    postProcess: vi.fn(async () => ({ demotedFacts: 2, warnings: [] })),
    ...overrides,
  }
  return { base, write }
}

describe('Prompt 资产库运行范围', () => {
  it('章节是权威范围，自动推导章纲和祖先世界，并拒绝显式错配', () => {
    const valid = resolvePromptLibraryScope({
      template: template('P11-B'), project: project({ enableMultiWorld: true }), chapters, nodes, groups,
      selection: { chapterId: 21, worldGroupId: 101, outlineNodeId: 11 },
    })
    expect(valid).toMatchObject({ chapterId: 21, outlineNodeId: 11, worldGroupId: 101, errors: [] })

    const mismatch = resolvePromptLibraryScope({
      template: template('P11-B'), project: project({ enableMultiWorld: true }), chapters, nodes, groups,
      selection: { chapterId: 21, worldGroupId: 102 },
    })
    expect(mismatch.errors.join('')).toContain('不一致')

    const outlineMismatch = resolvePromptLibraryScope({
      template: template('P11-B'), project: project({ enableMultiWorld: true }), chapters, nodes, groups,
      selection: { chapterId: 21, worldGroupId: 101, outlineNodeId: 12 },
    })
    expect(outlineMismatch.errors.join('')).toContain('大纲节点不一致')
  })

  it('P11-A 只允许规范章序中的第一章', () => {
    const scope = resolvePromptLibraryScope({
      template: template('P11-A'), project: project(), chapters, nodes, groups: [],
      selection: { chapterId: 22 },
    })
    expect(scope.errors.join('')).toContain('第一章')
  })
})

describe('Prompt 资产库章节采纳', () => {
  it('流式中、没有完成态或已采纳的结果都不能再次写入', () => {
    expect(canAdoptPromptLibraryRun({ run: run(), assetId: 'P11-B', isStreaming: true, adopted: false })).toBe(false)
    expect(canAdoptPromptLibraryRun({ run: null, assetId: 'P11-B', isStreaming: false, adopted: false })).toBe(false)
    expect(canAdoptPromptLibraryRun({ run: run(), assetId: 'P11-B', isStreaming: false, adopted: true })).toBe(false)
    expect(canAdoptPromptLibraryRun({ run: run(), assetId: 'P11-B', isStreaming: false, adopted: false })).toBe(true)
  })

  it('A 章生成后即使界面切到 B，写回仍只使用完成态快照中的 A', async () => {
    const { base, write } = deps()
    await adoptPromptLibraryChapterOutput({ project: project(), template: template('P11-B'), run: run() }, base)
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0][0]).toMatchObject({ recordId: 21, mode: 'replace' })
  })

  it('替换和追加都先创建快照，并写入规范 HTML 与完整字数', async () => {
    const replace = deps()
    const replaced = await adoptPromptLibraryChapterOutput(
      { project: project(), template: template('P11-B'), run: run() },
      replace.base,
    )
    expect(vi.mocked(replace.base.createSnapshot).mock.invocationCallOrder[0])
      .toBeLessThan(replace.write.mock.invocationCallOrder[0])
    expect(replaced).toMatchObject({ snapshotId: 77, wordCount: 15, demotedFacts: 2 })
    expect(replace.write.mock.calls[0][0].data).toEqual({
      content: '<p>林舟推门而入。</p><p>她看见桌上的信。</p>',
      wordCount: 15,
    })

    const append = deps()
    await adoptPromptLibraryChapterOutput(
      { project: project(), template: template('P11-C'), run: run({ assetId: 'P11-C' }) },
      append.base,
    )
    expect(String(append.write.mock.calls[0][0].data.content)).toBe(
      '<p>旧正文</p><p>林舟推门而入。</p><p>她看见桌上的信。</p>',
    )
  })

  it('快照失败时不写正文，冲突报告也不能进入正文', async () => {
    const snapshotFailure = deps({ createSnapshot: vi.fn(async () => { throw new Error('snapshot failed') }) })
    await expect(adoptPromptLibraryChapterOutput(
      { project: project(), template: template('P11-B'), run: run() },
      snapshotFailure.base,
    )).rejects.toThrow('snapshot failed')
    expect(snapshotFailure.write).not.toHaveBeenCalled()

    expect(containsConflictReport('<ConflictReport>设定冲突</ConflictReport>')).toBe(true)
    const conflict = deps()
    await expect(adoptPromptLibraryChapterOutput(
      { project: project(), template: template('P11-B'), run: run({ output: '<ConflictReport>设定冲突</ConflictReport>' }) },
      conflict.base,
    )).rejects.toThrow('冲突报告')
    expect(conflict.base.createSnapshot).not.toHaveBeenCalled()
    expect(conflict.write).not.toHaveBeenCalled()
  })

  it('采纳前重新校验世界归属，写入后执行派生事实与检索刷新边界', async () => {
    const invalid = deps()
    await expect(adoptPromptLibraryChapterOutput(
      { project: project({ enableMultiWorld: true }), template: template('P11-B'), run: run({ worldGroupId: 102 }) },
      invalid.base,
    )).rejects.toThrow('不一致')
    expect(invalid.write).not.toHaveBeenCalled()

    const valid = deps()
    await adoptPromptLibraryChapterOutput(
      { project: project({ enableMultiWorld: true }), template: template('P11-B'), run: run({ worldGroupId: 101 }) },
      valid.base,
    )
    expect(valid.base.postProcess).toHaveBeenCalledOnce()
  })
})
