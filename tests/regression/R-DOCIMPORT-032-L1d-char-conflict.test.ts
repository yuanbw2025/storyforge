import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import ImportReportModal from '../../src/components/system/import/ImportReportModal'
import {
  SAME_NAME_CONFLICT_RULES_V1,
} from '../../src/lib/import/dedup'
import type { ImportSession, WorkspaceScope } from '../../src/lib/types'
import type { UnifiedParseResult } from '../../src/lib/types'

/** 032-L1-d-CHAR：候选审查面（已持有 UnifiedParseResult）上的同名提示接线。
 *  既有侧用 mock 的 readOwnedRows 提供"目标世界真实行"的等价证据；
 *  detectSameNameConflictsV1 保持真实实现，验证检测 + 展示 + 不阻断确认。 */

const rows = vi.hoisted(() => ({
  characters: [] as Array<{ id?: number; name: string }>,
  outlines: [] as Array<{ id?: number; title: string; summary: string }>,
  fail: false,
}))
vi.mock('../../src/lib/workspace/scope', () => ({
  readOwnedRows: vi.fn(async (_scope: unknown, table: string) => {
    if (rows.fail) throw new Error('read failure fixture')
    return table === 'characters' ? rows.characters : rows.outlines
  }),
}))

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
async function mount(element: React.ReactElement) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(element)); return host
}
afterEach(async () => {
  while (mounted.length) { const item = mounted.pop()!; await act(async () => item.root.unmount()); item.host.remove() }
  rows.characters = []; rows.outlines = []; rows.fail = false
  vi.clearAllMocks()
})

const targetScope: WorkspaceScope = { projectId: 1, worldId: 2, workId: 3 }

function candidateWith(result: UnifiedParseResult) {
  return {
    version: 1 as const,
    kind: 'document-import-chunk-candidate' as const,
    portable: false as const,
    sessionId: 11,
    chunkIndex: 0,
    sourceTextHash: 's'.repeat(64),
    runId: 5,
    rawArtifactHash: 'r'.repeat(64),
    result,
    candidateHash: 'c'.repeat(64),
  }
}

const sessionFixture = (targetScope?: WorkspaceScope): ImportSession => ({
  id: 11, projectId: 1, filename: '设定集.txt', fileHash: 'h', totalChars: 10, totalChunks: 1, chunkSize: 50000,
  chunks: [{ index: 0, startChar: 0, endChar: 10, charCount: 10, status: 'done' as const, attempts: 1 }],
  merged: { worldview: {}, characters: [], outline: [] }, rollingContext: '', importTarget: 'project',
  targetWorldGroupId: null, targetScope, status: 'done', createdAt: 1, updatedAt: 1,
})

async function mountReview(result: UnifiedParseResult, onConfirm = vi.fn(async (_result: UnifiedParseResult) => undefined)) {
  return mount(createElement(ImportReportModal, {
    session: sessionFixture(targetScope),
    onRetryFailed: () => undefined,
    onClose: () => undefined,
    onDiscard: () => undefined,
    review: {
      candidate: candidateWith(result),
      raw: null,
      canConfirm: true,
      onConfirm,
    },
  }))
}

describe('032-L1-d-CHAR candidate review same-name hint', () => {
  it('shows the same-name character entry with the existing rules and hides different names', async () => {
    rows.characters = [{ id: 7, name: '林昭' }, { id: 8, name: '苏茴' }]
    const host = await mountReview({ characters: [{ name: '林昭', roleWeight: 'supporting' }, { name: '白岚', roleWeight: 'supporting' }] } as unknown as UnifiedParseResult)
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')).toBeTruthy())
    expect(host.textContent).toContain('检测到 1 处同名条目')
    expect(host.textContent).toContain('候选角色「林昭」')
    expect(host.textContent).toContain('已有同名角色「林昭」')
    expect(SAME_NAME_CONFLICT_RULES_V1.characterAppend.length).toBeGreaterThan(0)
    expect(host.textContent).not.toContain('候选角色「白岚」')
    expect(host.textContent).not.toContain('「苏茴」')
  })

  it('shows a same-name outline title drawn from the parsed candidate result', async () => {
    rows.outlines = [{ id: 3, title: '第一章 盐约', summary: '退潮后的谈判。' }]
    const host = await mountReview({
      outline: [{ title: '第一章 盐约', summary: '退潮后的谈判（新稿）。' }, { title: '第二章 风来', summary: '另一章。' }],
    } as unknown as UnifiedParseResult)
    await vi.waitFor(() => expect(host.textContent).toContain('候选大纲「第一章 盐约」'))
    // 与 ImportConfirmModal 的既有约定一致：完全同名（similarity===1）不显示百分比，只给"已有同名"。
    expect(host.textContent).toContain('已有同名大纲「第一章 盐约」')
    expect(host.textContent).not.toContain('相似度')
    expect(host.textContent).not.toContain('候选大纲「第二章 风来」')
    expect(host.textContent).toContain(SAME_NAME_CONFLICT_RULES_V1.outlineMerge)
  })

  it('does not render the block when nothing overlaps', async () => {
    rows.characters = [{ id: 1, name: '甲' }]
    rows.outlines = [{ id: 2, title: '甲卷', summary: '' }]
    const host = await mountReview({
      characters: [{ name: '乙' }], outline: [{ title: '乙章', summary: '' }],
    } as unknown as UnifiedParseResult)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(host.textContent).not.toContain('同名条目')
    // 原有确认入口仍在
    expect(host.textContent).toContain('确认保存本块')
  })

  it('stays quiet when the session has no frozen target scope (no cross-scope guessing)', async () => {
    const host = await mount(createElement(ImportReportModal, {
      session: sessionFixture(undefined),
      onRetryFailed: () => undefined, onClose: () => undefined, onDiscard: () => undefined,
      review: { candidate: candidateWith({ characters: [{ name: '林昭' }] } as unknown as UnifiedParseResult), raw: null, canConfirm: true, onConfirm: vi.fn(async (_result: UnifiedParseResult) => undefined) },
    }))
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('degrades to an empty hint on read failure instead of blocking confirmation', async () => {
    rows.fail = true
    const onConfirm = vi.fn(async (_result: UnifiedParseResult) => undefined)
    const host = await mountReview({ characters: [{ name: '林昭' }] } as unknown as UnifiedParseResult, onConfirm)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="status"]')).toBeNull()
    const confirmButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('确认保存本块'))!
    await act(async () => { confirmButton.click() })
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('still saves the edited draft unchanged: the hint never rewrites adopt input', async () => {
    rows.characters = [{ id: 7, name: '林昭' }]
    const onConfirm = vi.fn(async (_result: UnifiedParseResult) => undefined)
    const host = await mountReview({ characters: [{ name: '林昭', appearance: '原貌。' }] } as unknown as UnifiedParseResult, onConfirm)
    await vi.waitFor(() => expect(host.textContent).toContain('候选角色「林昭」'))
    const confirmButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('确认保存本块'))!
    await act(async () => { confirmButton.click() })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    const passed = onConfirm.mock.calls[0][0] as UnifiedParseResult
    expect(passed.characters).toEqual([{ name: '林昭', appearance: '原貌。' }])
  })
})
