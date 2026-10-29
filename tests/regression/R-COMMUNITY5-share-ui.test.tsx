import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import NovelSharePanel from '../../src/components/community-works/NovelSharePanel'
import AnalysisSharePanel from '../../src/components/community-works/AnalysisSharePanel'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, OutlineNode } from '../../src/lib/types/outline'
import type { Reference, ReferenceAnalysisRun, ReferenceChunkAnalysis } from '../../src/lib/types/reference'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(async () => {
  await db.delete(); await db.open()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); db.close()
})

describe('community share selection in the local work', () => {
  it('defaults to no chapter and previews only the explicitly selected body', async () => {
    const { scope } = await createWorkspace({ name: '公开边界', description: '未选择的内部简介', genres: ['悬疑'], status: 'drafting', targetWordCount: 10000 })
    await db.works.update(scope.workId, { description: '未选择的内部简介', genres: ['悬疑'] })
    const add = async (title: string, body: string, order: number) => {
      const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
        type: 'chapter', parentId: null, title, summary: '', order, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }) as OutlineNode) as number
      await db.chapters.add(stampNewRecord(scope, 'chapters', {
        outlineNodeId, title, content: body, notes: '保密笔记', wordCount: body.length,
        status: 'final', order, createdAt: 1, updatedAt: 1,
      }, { owner: 'work' }) as Chapter)
    }
    await add('第一章', '作者选中的正文', 0)
    await add('第二章', '未选正文绝不公开', 1)
    await act(async () => root.render(createElement(NovelSharePanel, { scope, onClose: () => {} })))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const checkboxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(4)
    expect([...checkboxes].every(input => !input.checked)).toBe(true)
    await act(async () => checkboxes[2].click())
    const rights = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[4]
    await act(async () => rights.click())
    const previewButton = [...host.querySelectorAll('button')].find(button => button.textContent === '生成公开预览')!
    await act(async () => previewButton.click())
    for (let attempt = 0; attempt < 30 && !host.querySelector('[aria-label="投稿公开预览"]'); attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
    const preview = host.querySelector('[aria-label="投稿公开预览"]')!
    expect(preview.textContent).toContain('作者选中的正文')
    expect(preview.textContent).not.toContain('未选正文绝不公开')
    expect(preview.textContent).not.toContain('保密笔记')
    expect(preview.textContent).not.toContain('未选择的内部简介')
    expect(preview.textContent).not.toContain('悬疑')
    await act(async () => checkboxes[0].click())
    await act(async () => checkboxes[1].click())
    expect(checkboxes[0].checked).toBe(true)
    expect(checkboxes[1].checked).toBe(true)
    await act(async () => previewButton.click())
    for (let attempt = 0; attempt < 30 && !host.querySelector('[aria-label="投稿公开预览"]')?.textContent?.includes('公开流派：'); attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
    const expandedPreview = host.querySelector('[aria-label="投稿公开预览"]')!
    expect(expandedPreview.textContent).toContain('未选择的内部简介')
    expect(expandedPreview.textContent).toContain('公开流派：悬疑')
  })

  it('shares only selected book-analysis dimensions after a separate rights confirmation', async () => {
    const { scope } = await createWorkspace({ name: '拆书隔离', description: '', genres: [],
      status: 'drafting', targetWordCount: 10000 })
    const referenceId = await db.references.add(stampNewRecord(scope, 'references', {
      title: '参考书', author: '原作者', type: 'story', note: '私有参考备注', url: '',
      genre: '悬疑', fileHash: 'private-source-hash', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }) as Reference) as number
    const runId = await db.referenceAnalysisRuns.add(stampNewRecord(scope, 'referenceAnalysisRuns', {
      referenceId, version: 1, status: 'active', depth: 'deep', sourceFilename: 'private.txt',
      fileHash: 'private-source-hash', totalChars: 100, sourceKind: 'research',
      usageScope: 'analysis-only', rightsNote: '', rightsConfirmed: true, rightsDeclaredAt: 1,
      expectedChunks: 2, completedChunks: 2, progress: 100, analysisSummary: '私有总评',
      createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }) as ReferenceAnalysisRun) as number
    for (const [chunkIndex, label, openingTechnique, rawExcerpt] of [
      [0, '开篇', '所选开篇技法', '原书片段不可公开'],
      [1, '结尾', '未选择的结尾技法', '第二段原书片段'],
    ] as const) {
      await db.referenceChunkAnalysis.add(stampNewRecord(scope, 'referenceChunkAnalysis', {
        referenceId, analysisRunId: runId, chunkIndex, label, openingTechnique, rawExcerpt,
        createdAt: 1,
      }, { owner: 'work' }) as ReferenceChunkAnalysis)
    }
    const reference = (await db.references.get(referenceId))!
    const run = (await db.referenceAnalysisRuns.get(runId))!
    const chunks = await db.referenceChunkAnalysis.where('analysisRunId').equals(runId).toArray()
    await act(async () => root.render(createElement(AnalysisSharePanel,
      { reference, run, chunks, onClose: () => {} })))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    const checkboxes = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(15)
    expect([...checkboxes].every(input => !input.checked)).toBe(true)
    await act(async () => checkboxes[0].click())
    await act(async () => checkboxes[3].click()) // openingTechnique follows narrativeStyle
    const rights = host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[15]
    expect(rights.checked).toBe(false)
    const previewButton = [...host.querySelectorAll('button')].find(button => button.textContent === '生成公开预览')!
    expect(previewButton.disabled).toBe(true)
    await act(async () => rights.click())
    await act(async () => previewButton.click())
    for (let attempt = 0; attempt < 30 && !host.querySelector('[aria-label="投稿公开预览"]'); attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    }
    const preview = host.querySelector('[aria-label="投稿公开预览"]')!
    expect(preview.textContent).toContain('所选开篇技法')
    for (const secret of ['未选择的结尾技法', '原书片段不可公开', '第二段原书片段',
      'private.txt', 'private-source-hash', '私有总评', '私有参考备注']) {
      expect(preview.textContent).not.toContain(secret)
    }
  })
})
