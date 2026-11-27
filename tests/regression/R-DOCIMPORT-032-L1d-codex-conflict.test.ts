import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import CodexImportReviewModal from '../../src/components/system/import/CodexImportReviewModal'
import {
  CODEX_SAME_NAME_RULE_V1,
  detectCodexSameNameConflictsV1,
} from '../../src/lib/import/dedup'

/** 032-L1-d-CODEX：词条候选审查面的同分类同名只读提示。
 *  - 纯检测覆盖 builtin/custom 解析与无法解析跳过；
 *  - modal 接线用 mock 的当前项目/scope/既有词条，验证真实读取路径 + 不阻断确认。 */

const seams = vi.hoisted(() => ({
  currentProjectId: 1 as number | null,
  multiWorld: false,
  entries: [] as Array<{ id?: number; categoryId: number; name: string; worldGroupId?: number | null }>,
}))
vi.mock('../../src/stores/project', () => ({
  useProjectStore: { getState: () => ({ currentProjectId: seams.currentProjectId }) },
}))
vi.mock('../../src/lib/db/schema', () => ({
  db: { projects: { get: vi.fn(async () => ({ id: 1, enableMultiWorld: seams.multiWorld })) } },
}))
vi.mock('../../src/lib/workspace/scope', () => ({
  resolveScope: vi.fn(async () => ({ projectId: 1, worldId: 2, workId: 3 })),
  readOwnedRows: vi.fn(async (_scope: unknown, table: string) =>
    table === 'codexEntries' ? seams.entries : []),
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
  seams.currentProjectId = 1; seams.multiWorld = false; seams.entries = []
  vi.clearAllMocks()
})

const categories = [
  { ref: 'builtin:location', categoryId: 21, domain: 'natural' as const, label: '地点', fields: [] },
  { ref: 'custom:humanity:lin-family', categoryId: 32, domain: 'humanity' as const, label: '林氏宗族', fields: [] },
]
const candidate = (overrides: Record<string, unknown> = {}) => ({
  categoryRef: 'builtin:location',
  name: '盐约港',
  summary: '',
  description: '',
  fields: {},
  tags: [],
  confidence: 0.8,
  evidence: [{ chunkIndex: 0, quote: '盐约港' }],
  ...overrides,
})

describe('032-L1-d-CODEX detectCodexSameNameConflictsV1 pure helper', () => {
  it('reports a same-name entry only inside the same category and world group', () => {
    const conflicts = detectCodexSameNameConflictsV1({
      existingEntries: [
        { id: 9, categoryId: 21, name: '盐约港', worldGroupId: null },
        { id: 10, categoryId: 21, name: '盐约港', worldGroupId: 5 },
        { id: 11, categoryId: 32, name: '盐约港', worldGroupId: null },
      ],
      incomingCandidates: [
        { categoryRef: 'builtin:location', categoryId: 21, name: '盐约港' },
        { categoryRef: 'builtin:location', categoryId: 21, name: '潮声湾' },
      ],
      worldGroupId: null,
    })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ kind: 'codex', categoryRef: 'builtin:location', categoryId: 21, incomingName: '盐约港', existingId: 9, existingName: '盐约港' })
    expect(conflicts[0].hint).toBe(CODEX_SAME_NAME_RULE_V1)
  })

  it('resolves custom:<domain>:<token> references through the real categoryId mapping', () => {
    const conflicts = detectCodexSameNameConflictsV1({
      existingEntries: [{ id: 7, categoryId: 32, name: '林昭', worldGroupId: null }],
      incomingCandidates: [{ categoryRef: 'custom:humanity:lin-family', categoryId: 32, name: '林昭' }],
      worldGroupId: null,
    })
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].categoryRef).toBe('custom:humanity:lin-family')
  })

  it('skips unresolved references instead of guessing builtin/custom structure', () => {
    expect(detectCodexSameNameConflictsV1({
      existingEntries: [{ id: 1, categoryId: 21, name: '盐约港', worldGroupId: null }],
      incomingCandidates: [
        { categoryRef: 'builtin:not-a-real-key', categoryId: null, name: '盐约港' },
        { categoryRef: 'custom:natural:missing', categoryId: null, name: '盐约港' },
      ],
      worldGroupId: null,
    })).toEqual([])
  })

  it('normalizes names the same way as the write path (NFKC / spaces / case)', () => {
    const conflicts = detectCodexSameNameConflictsV1({
      existingEntries: [{ id: 3, categoryId: 21, name: '盐约 港', worldGroupId: null }],
      incomingCandidates: [{ categoryRef: 'builtin:location', categoryId: 21, name: '盐约港' }],
      worldGroupId: null,
    })
    expect(conflicts).toHaveLength(1)
  })

  it('returns empty when nothing overlaps or no candidates exist', () => {
    expect(detectCodexSameNameConflictsV1({
      existingEntries: [{ id: 1, categoryId: 21, name: '甲', worldGroupId: null }],
      incomingCandidates: [{ categoryRef: 'builtin:location', categoryId: 21, name: '乙' }],
      worldGroupId: null,
    })).toEqual([])
    expect(detectCodexSameNameConflictsV1({ existingEntries: [], incomingCandidates: [], worldGroupId: null })).toEqual([])
  })
})

describe('032-L1-d-CODEX CodexImportReviewModal wiring', () => {
  async function mountReview(candidates: ReturnType<typeof candidate>[], onConfirm = vi.fn(async (_entries: React.ComponentProps<typeof CodexImportReviewModal>['candidates']) => undefined)) {
    return mount(createElement(CodexImportReviewModal, {
      filename: '设定集.txt',
      candidates,
      categories,
      onConfirm,
      onCancel: () => undefined,
    }))
  }

  it('shows the conflict block with the rules wording for a same-name parsed candidate', async () => {
    seams.entries = [{ id: 9, categoryId: 21, name: '盐约港', worldGroupId: null }]
    const host = await mountReview([candidate()])
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')).toBeTruthy())
    expect(host.textContent).toContain('检测到 1 处同名词条')
    expect(host.textContent).toContain('候选词条「盐约港」')
    expect(host.textContent).toContain('已有同名词条「盐约港」')
    expect(host.textContent).toContain(CODEX_SAME_NAME_RULE_V1)
  })

  it('does not render the block when names differ, and keeps both actions usable', async () => {
    seams.entries = [{ id: 9, categoryId: 21, name: '潮声湾', worldGroupId: null }]
    const host = await mountReview([candidate({ name: '盐约港' })])
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(host.textContent).not.toContain('同名词条')
    expect(host.textContent).toContain('确认导入 1 条')
    expect(host.textContent).toContain('暂不导入')
  })

  it('skips unresolvable categoryRefs without inventing matches', async () => {
    seams.entries = [{ id: 9, categoryId: 21, name: '盐约港', worldGroupId: null }]
    const host = await mountReview([candidate({ categoryRef: 'builtin:gone', name: '盐约港' })])
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('stays quiet for multi-world projects where the target world group is not fixed', async () => {
    seams.multiWorld = true
    seams.entries = [{ id: 9, categoryId: 21, name: '盐约港', worldGroupId: null }]
    const host = await mountReview([candidate()])
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('never blocks confirmation: the edited draft still reaches onConfirm unchanged', async () => {
    seams.entries = [{ id: 9, categoryId: 21, name: '盐约港', worldGroupId: null }]
    const onConfirm = vi.fn(async (_entries: React.ComponentProps<typeof CodexImportReviewModal>['candidates']) => undefined)
    const host = await mountReview([candidate()], onConfirm)
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')).toBeTruthy())
    const confirmButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('确认导入'))!
    expect(confirmButton.disabled).toBe(false)
    await act(async () => { confirmButton.click() })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm.mock.calls[0][0]).toHaveLength(1)
    expect(onConfirm.mock.calls[0][0][0].name).toBe('盐约港')
  })

  it('degrades to an empty hint when the store/scope read fails', async () => {
    seams.currentProjectId = null
    const host = await mountReview([candidate()])
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(host.textContent).toContain('审查 Codex 词条候选')
  })
})
