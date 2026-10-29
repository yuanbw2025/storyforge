import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import NovelSharePanel from '../../src/components/community-works/NovelSharePanel'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import type { Chapter, OutlineNode } from '../../src/lib/types/outline'

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
})
