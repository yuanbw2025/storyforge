import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import CodexImportReviewModal from '../../src/components/system/import/CodexImportReviewModal'

/** 032-L1-d-CODEX-MULTIWORLD：多世界项目按"已选目标世界组"口径显示同分类同名提示。
 *  既有 helper 逐字复用；本测试用 mock 提供目标 scope / 既有词条，验证：
 *  已选组命中、跨组隔离、未选保守跳过、authority 校验被调用、读取失败不阻断确认。 */

const seams = vi.hoisted(() => ({
  currentProjectId: 1 as number | null,
  multiWorld: true,
  entries: [] as Array<{ id?: number; categoryId: number; name: string; worldGroupId?: number | null }>,
  verified: [] as Array<{ scope: unknown; worldGroupId: number | null }>,
  readFail: false,
}))
vi.mock('../../src/stores/project', () => ({
  useProjectStore: { getState: () => ({ currentProjectId: seams.currentProjectId }) },
}))
vi.mock('../../src/lib/db/schema', () => ({
  db: { projects: { get: vi.fn(async () => ({ id: 1, enableMultiWorld: seams.multiWorld })) } },
}))
vi.mock('../../src/lib/workspace/scope', () => ({
  resolveScope: vi.fn(async () => ({ projectId: 1, worldId: 2, workId: 3 })),
  readOwnedRows: vi.fn(async (_scope: unknown, table: string) => {
    if (seams.readFail) throw new Error('read failure fixture')
    return table === 'codexEntries' ? seams.entries : []
  }),
}))
vi.mock('../../src/stores/import-session', () => ({
  verifyImportProjectTargetGroupV1: vi.fn(async (scope: unknown, worldGroupId: number | null) => {
    seams.verified.push({ scope, worldGroupId })
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
  seams.currentProjectId = 1; seams.multiWorld = true; seams.entries = []; seams.verified = []; seams.readFail = false
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
const targetScope = { projectId: 1, worldId: 2, workId: 3 }

async function mountReview(overrides: Record<string, unknown> = {}, onConfirm = vi.fn(async () => undefined)) {
  return mount(createElement(CodexImportReviewModal, {
    filename: '设定集.txt',
    candidates: [candidate()],
    categories,
    onConfirm,
    onCancel: () => undefined,
    targetScope,
    targetWorldGroupId: 5,
    ...overrides,
  }))
}

describe('032-L1-d-CODEX-MULTIWORLD modal world-group wiring', () => {
  it('shows same-category conflicts for the selected world group only', async () => {
    seams.entries = [
      { id: 9, categoryId: 21, name: '盐约港', worldGroupId: 5 },
      { id: 10, categoryId: 21, name: '盐约港', worldGroupId: 7 },   // 其他世界组：不得出现
      { id: 11, categoryId: 21, name: '潮声湾', worldGroupId: 5 },   // 异名：不得出现
    ]
    const host = await mountReview()
    await vi.waitFor(() => expect(host.querySelector('[role="status"]')).toBeTruthy())
    expect(host.textContent).toContain('候选词条「盐约港」')
    expect(host.textContent).toContain('已有同名词条「盐约港」')
    expect(host.textContent).not.toContain('潮声湾')
    // 只有所选组的那一条被报告
    expect(host.querySelectorAll('[role="status"] li')).toHaveLength(1)
  })

  it('still resolves custom:<domain>:<token> references when the group is selected', async () => {
    seams.entries = [{ id: 7, categoryId: 32, name: '林昭', worldGroupId: 5 }]
    const host = await mountReview({ candidates: [candidate({ categoryRef: 'custom:humanity:lin-family', name: '林昭' })] })
    await vi.waitFor(() => expect(host.textContent).toContain('候选词条「林昭」'))
    expect(host.textContent).toContain('同一分类')
  })

  it('runs the existing authority check with the frozen target scope and selected group', async () => {
    seams.entries = []
    await mountReview()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(seams.verified).toEqual([{ scope: targetScope, worldGroupId: 5 }])
  })

  it('stays empty when multi-world but no group is selected (conservative skip)', async () => {
    seams.entries = [{ id: 9, categoryId: 21, name: '盐约港', worldGroupId: 5 }]
    const host = await mountReview({ targetWorldGroupId: null })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="status"]')).toBeNull()
    expect(seams.verified).toHaveLength(0)
  })

  it('stays empty when the frozen target scope is missing', async () => {
    seams.entries = [{ id: 9, categoryId: 21, name: '盐约港', worldGroupId: 5 }]
    const host = await mountReview({ targetScope: undefined })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="status"]')).toBeNull()
  })

  it('keeps single-world behavior identical to PR644 (no authority re-check needed)', async () => {
    seams.multiWorld = false
    seams.entries = [{ id: 9, categoryId: 21, name: '盐约港', worldGroupId: null }]
    const host = await mountReview({ targetWorldGroupId: null })
    await vi.waitFor(() => expect(host.textContent).toContain('候选词条「盐约港」'))
    expect(seams.verified).toHaveLength(0)
  })

  it('degrades to an empty hint on read failure and never blocks confirmation', async () => {
    seams.readFail = true
    const onConfirm = vi.fn(async () => undefined)
    const host = await mountReview({}, onConfirm)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(host.querySelector('[role="status"]')).toBeNull()
    const confirmButton = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('确认导入'))!
    expect(confirmButton.disabled).toBe(false)
    await act(async () => { confirmButton.click() })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
