import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import {
  SAME_NAME_CONFLICT_RULES_V1,
  checkCharacterDuplicate,
  checkOutlineDuplicate,
  detectSameNameConflictsV1,
} from '../../src/lib/import/dedup'
import ImportConfirmModal from '../../src/components/system/import/ImportConfirmModal'

/** 032-L1-d：同名冲突只读提示。
 * 复用既有 dedup 检测，不做任何写入/adopt/DB；modal 只在同名时渲染区块。 */

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
async function mount(element: React.ReactElement) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(element)); return host
}
afterEach(async () => {
  while (mounted.length) { const item = mounted.pop()!; await act(async () => item.root.unmount()); item.host.remove() }
})

const chunksFixture = [{ index: 0, startChar: 0, endChar: 10, charCount: 10, text: 'x'.repeat(10) }]

describe('032-L1-d detectSameNameConflictsV1', () => {
  it('reports a same-name character and its existing entry without flagging different names', () => {
    const conflicts = detectSameNameConflictsV1({
      existingCharacters: [{ id: 7, name: '林昭' }, { id: 8, name: '苏茴' }],
      incomingCharacters: ['林昭', '白岚'],
    })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ kind: 'character', incomingName: '林昭', existingId: 7, existingName: '林昭' })
    expect(conflicts[0].hint).toBe(SAME_NAME_CONFLICT_RULES_V1.characterAppend)
    expect(conflicts.some(item => item.incomingName === '白岚')).toBe(false)
  })

  it('reports a same-name outline and carries the similarity score', () => {
    const conflicts = detectSameNameConflictsV1({
      existingOutlines: [{ id: 3, title: '第一章 盐约', summary: '退潮后的谈判。' }],
      incomingOutlines: [{ title: '第一章 盐约', summary: '退潮后的谈判（新稿）。' }, { title: '第二章 风来', summary: '不同的章节。' }],
    })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].kind).toBe('outline')
    expect(conflicts[0].existingId).toBe(3)
    expect(conflicts[0].similarity).toBe(1)
    expect(conflicts[0].hint).toBe(SAME_NAME_CONFLICT_RULES_V1.outlineMerge)
  })

  it('returns empty array when there is no same-name overlap', () => {
    expect(detectSameNameConflictsV1({
      existingCharacters: [{ id: 1, name: '甲' }],
      existingOutlines: [{ id: 2, title: '甲卷', summary: '' }],
      incomingCharacters: ['乙'],
      incomingOutlines: [{ title: '乙章', summary: '' }],
    })).toEqual([])
  })

  it('reuses the existing normalized-match character check so punctuation/spacing variants still match', () => {
    const byName = new Map([['林 昭', 9]])
    expect(checkCharacterDuplicate('林昭', byName).isDuplicate).toBe(true)
    const conflicts = detectSameNameConflictsV1({
      existingCharacters: [{ id: 9, name: '林 昭' }],
      incomingCharacters: ['林昭'],
    })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].existingName).toBe('林 昭')
  })

  it('does not misreport an outline with the same title but unrelated summary as a duplicate beyond the real check', () => {
    // Title exact match is already a duplicate by the existing rule; verify the wrapper surfaces it.
    expect(checkOutlineDuplicate('卷首', '完全不同的小结。', [{ id: 4, title: '卷首', summary: '原有内容。' }]).isDuplicate).toBe(true)
    expect(detectSameNameConflictsV1({
      existingOutlines: [{ id: 4, title: '卷首', summary: '原有内容。' }],
      incomingOutlines: [{ title: '完全不同的标题', summary: '' }],
    })).toEqual([])
  })

  it('ignores blank incoming names instead of inventing conflicts', () => {
    expect(detectSameNameConflictsV1({
      existingCharacters: [{ id: 1, name: '' }],
      incomingCharacters: ['   ', ''],
      incomingOutlines: [{ title: '  ', summary: '' }],
    })).toEqual([])
  })
})

describe('032-L1-d ImportConfirmModal conflict hint rendering', () => {
  const baseProps = {
    filename: '设定集.csv',
    totalChars: 10,
    chunks: chunksFixture,
    chunkSize: 50000,
    onChunkSizeChange: () => undefined,
    onConfirm: () => undefined,
    onCancel: () => undefined,
  }

  it('renders the conflict list with per-item "incoming -> existing" wording when conflicts exist', async () => {
    const host = await mount(createElement(ImportConfirmModal, {
      ...baseProps,
      sameNameConflicts: [
        { kind: 'character', incomingName: '林昭', existingId: 7, existingName: '林昭', hint: SAME_NAME_CONFLICT_RULES_V1.characterAppend },
        { kind: 'outline', incomingName: '第一章 盐约', existingId: 3, existingName: '第一章 盐约', similarity: 0.86, hint: SAME_NAME_CONFLICT_RULES_V1.outlineMerge },
      ],
    }))
    const status = host.querySelector('[role="status"]')
    expect(status?.textContent).toContain('检测到 2 处同名条目')
    expect(host.textContent).toContain('即将写入角色「林昭」')
    expect(host.textContent).toContain('已有同名角色「林昭」')
    expect(host.textContent).toContain('即将写入大纲「第一章 盐约」')
    expect(host.textContent).toContain('相似度 86%')
  })

  it('keeps the explicit rules and the two-way choice (仍要导入 / 取消) visible', async () => {
    const host = await mount(createElement(ImportConfirmModal, {
      ...baseProps,
      sameNameConflicts: [
        { kind: 'character', incomingName: '林昭', existingId: 7, existingName: '林昭', hint: SAME_NAME_CONFLICT_RULES_V1.characterAppend },
      ],
    }))
    expect(host.textContent).toContain('不会静默覆盖或删除')
    expect(host.textContent).toContain('世界观同名字段去重后追加')
    expect(host.textContent).toContain('异名条目一律保留不动')
    expect(host.textContent).toContain('导入当前项目')
    expect(host.textContent).toContain('取消')
  })

  it('does not render the conflict block at all when there are no conflicts', async () => {
    const host = await mount(createElement(ImportConfirmModal, baseProps))
    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(host.textContent).not.toContain('同名条目')
    // Existing behavior stays intact
    expect(host.textContent).toContain('即将开始大文档分块解析')
  })

  it('treats an empty conflict list exactly like absence', async () => {
    const host = await mount(createElement(ImportConfirmModal, { ...baseProps, sameNameConflicts: [] }))
    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(host.textContent).not.toContain('同名条目')
  })

  it('still offers both confirm targets so nothing blocks the existing adopt chain', async () => {
    const onConfirm = (vi.fn() as unknown) as React.ComponentProps<typeof ImportConfirmModal>['onConfirm']
    const host = await mount(createElement(ImportConfirmModal, {
      ...baseProps,
      onConfirm,
      sameNameConflicts: [
        { kind: 'outline', incomingName: '第一章 盐约', existingId: 3, existingName: '第一章 盐约', similarity: 1, hint: SAME_NAME_CONFLICT_RULES_V1.outlineMerge },
      ],
    }))
    const buttons = Array.from(host.querySelectorAll('button')).map(button => button.textContent ?? '')
    expect(buttons.some(text => text.includes('导入当前项目'))).toBe(true)
    expect(buttons.some(text => text.includes('导入项目参考'))).toBe(true)
    expect(buttons.some(text => text.trim() === '取消')).toBe(true)
  })
})
