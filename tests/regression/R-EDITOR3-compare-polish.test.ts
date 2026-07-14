import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  evaluateCompareDraftConsistency,
  saveComparePolishDraft,
} from '../../src/lib/editor/compare-polish-operation'
import type { HeldItemProjection } from '../../src/lib/consistency/held-items'

describe('R-EDITOR3 · compare polish workflow', () => {
  it('creates a snapshot before overwriting the chapter and computes word count', async () => {
    const order: string[] = []
    const createSnapshot = vi.fn(async () => {
      order.push('snapshot')
      return 42
    })
    const updateChapter = vi.fn(async () => {
      order.push('update')
    })

    const result = await saveComparePolishDraft({
      projectId: 1,
      chapterId: 9,
      chapterTitle: '雨夜',
      draftHtml: '<p>林舟走进雨里。</p>',
      createSnapshot,
      updateChapter,
    })

    expect(order).toEqual(['snapshot', 'update'])
    expect(createSnapshot).toHaveBeenCalledWith(1, '对照润色前 · 雨夜', 'manual')
    expect(updateChapter).toHaveBeenCalledWith(9, {
      content: '<p>林舟走进雨里。</p>',
      wordCount: 7,
    })
    expect(result).toMatchObject({ snapshotId: 42, plainText: '林舟走进雨里。', wordCount: 7 })
  })

  it('does not overwrite the chapter when snapshot creation fails', async () => {
    const updateChapter = vi.fn(async () => {})
    await expect(saveComparePolishDraft({
      projectId: 1,
      chapterId: 9,
      chapterTitle: '雨夜',
      draftHtml: '<p>改写稿</p>',
      createSnapshot: async () => { throw new Error('snapshot failed') },
      updateChapter,
    })).rejects.toThrow('snapshot failed')
    expect(updateChapter).not.toHaveBeenCalled()
  })

  it('surfaces deterministic held-item continuity risks before save', () => {
    const heldItems: HeldItemProjection[] = [{
      itemName: '青铜钥匙',
      quantity: 1,
      evidence: [{ id: 3, itemName: '青铜钥匙' } as HeldItemProjection['evidence'][number]],
    }]
    const findings = evaluateCompareDraftConsistency(
      '<p>林舟再次获得青铜钥匙，推开了门。</p>',
      heldItems,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].reason).toContain('已处于持有状态')
  })

  it('renders a fixed read-only source beside an independent editable draft', () => {
    const panel = readFileSync(resolve(process.cwd(), 'src/components/editor/ComparePolishPanel.tsx'), 'utf8')
    const chapterEditor = readFileSync(resolve(process.cwd(), 'src/components/editor/ChapterEditor.tsx'), 'utf8')
    const editorHeader = readFileSync(resolve(process.cwd(), 'src/components/editor/ChapterEditorHeader.tsx'), 'utf8')
    expect(panel).toContain('value={sourceHtml}')
    expect(panel).toContain('disabled')
    expect(panel).toContain('showToolbar={false}')
    expect(panel).toContain('value={draftHtml}')
    expect(panel).toContain('createSnapshot')
    expect(panel).toContain('updateChapter')
    expect(chapterEditor).toContain('saveDisabled={compareSourceHtml != null}')
    expect(chapterEditor).toContain('saving={manualSaving}')
    expect(editorHeader).toContain('disabled={saveDisabled || saving}')
    expect(chapterEditor).toContain('compareSourceHtml == null && (')
    expect(chapterEditor).toContain('<ChapterEditorToolbar')
    expect(chapterEditor).toContain('setCompareSourceHtml(null)')
  })
})
