import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { useOutlineStore } from '../../src/stores/outline'
import { useChapterStore } from '../../src/stores/chapter'
import { useWorldGroupStore } from '../../src/stores/world-group'
import { groupOutlineChaptersByTopLevelVolume, walkOutlineChaptersInCanonicalOrder } from '../../src/lib/outline/canonical-outline-walk'
import type { OutlineNode, Project } from '../../src/lib/types'
import { ToastProvider } from '../../src/components/shared/Toast'
import ChaptersListPanel from '../../src/components/editor/ChaptersListPanel'

vi.mock('../../src/components/shared/PanelLayout', () => ({ default: ({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) => <div><aside>{sidebar}</aside><main>{children}</main></div> }))
vi.mock('../../src/components/editor/ChapterEditor', () => ({ default: ({ outlineNodeId }: { outlineNodeId: number }) => <div data-editor-id={outlineNodeId}>真实选择目标 {outlineNodeId}</div> }))
vi.mock('../../src/components/outline/ScenePanel', () => ({ default: ({ outlineNodeId }: { outlineNodeId: number }) => <div data-scene-id={outlineNodeId} /> }))
vi.mock('../../src/components/editor/FindReplacePanel', () => ({ default: () => <div>查找替换</div> }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

function node(id: number, parentId: number | null, type: OutlineNode['type'], order: number): OutlineNode {
  return { id, projectId: 1, workId: 1, parentId, type, order, title: `${type}:${id}`, summary: '', createdAt: 1, updatedAt: 1 }
}

async function workspace(profile: 'long' | 'short' = 'long') {
  return createWorkspace({ name: '027章列表', description: '', genres: [], status: 'drafting', targetWordCount: profile === 'long' ? 100_000 : 8_000 }, {
    kind: 'novel', novelProfile: profile,
    ...(profile === 'long' ? { importedNovelText: 'ROOT/作者完整原文。' } : { initialChapterContent: 'SHORT/作者原文。' }),
  })
}

async function mount(project: Project, initialNodeId?: number) {
  // Real public loads; only heavy child views/layout are stubbed, not grouping,
  // stores, DB or the selected-node control flow under review.
  await useOutlineStore.getState().loadAll(project.id!)
  await useChapterStore.getState().loadAll(project.id!)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(createElement(ToastProvider, null, createElement(ChaptersListPanel, { project, initialNodeId }))))
  return host
}

beforeEach(async () => {
  await db.delete(); await db.open()
  useOutlineStore.setState({ nodes: [], loadedScope: null, loading: false, loadError: null })
  useChapterStore.setState({ chapters: [], currentChapter: null, loading: false })
  useWorldGroupStore.setState({ groups: [], loadedScope: null, activeGroupId: null, loading: false })
})
afterEach(async () => {
  for (const item of mounted.splice(0)) { await act(async () => item.root.unmount()); item.host.remove() }
  vi.restoreAllMocks(); db.close()
})

const SHAPES = [
  { name: 'root chapter only', nodes: [node(1, null, 'chapter', 0)], ids: [1] },
  { name: 'ordinary real volumes and empty volume', nodes: [node(1, null, 'volume', 0), node(2, 1, 'chapter', 0), node(3, null, 'volume', 1)], ids: [2] },
  { name: 'root→volume→empty→root→root-arc', nodes: [node(1, null, 'chapter', 0), node(2, null, 'volume', 1), node(3, 2, 'chapter', 0), node(4, null, 'volume', 2), node(5, null, 'chapter', 3), node(6, null, 'arc', 4), node(7, 6, 'chapter', 0)], ids: [1, 3, 5, 7] },
  { name: 'deep story-block/arc/chapter nesting', nodes: [node(1, null, 'volume', 0), node(2, 1, 'storyBlock', 0), node(3, 2, 'arc', 0), node(4, 3, 'storyBlock', 0), node(5, 4, 'chapter', 0)], ids: [5] },
  { name: 'real orphan volume and empty first volume', nodes: [node(1, null, 'volume', 0), node(2, 999, 'volume', 1), node(3, 2, 'storyBlock', 0), node(4, 3, 'chapter', 0)], ids: [4] },
  { name: 'missing parent and cycle fallback', nodes: [node(1, 999, 'chapter', 0), node(2, 3, 'chapter', 1), node(3, 2, 'chapter', 2)], ids: [1, 2, 3] },
] as const

describe('SFQA-027 · every canonical chapter remains reachable in the existing list', () => {
  it.each(SHAPES)('partitions $name exactly once without changing canonical order or the input', ({ nodes, ids }) => {
    const input = structuredClone([...nodes])
    const before = JSON.stringify(input)
    const canonical = walkOutlineChaptersInCanonicalOrder(input)
    expect(canonical.chapters.map(entry => entry.outlineNode.id)).toEqual(ids)
    const groups = groupOutlineChaptersByTopLevelVolume(input)
    const actual = groups.flatMap(group => group.chapters).map(chapter => chapter.id)
    expect(actual).toEqual(ids)
    expect(new Set(actual).size).toBe(actual.length)
    for (const group of groups) {
      const volume = group.volume
      if (volume) expect(input.some(row => row.id === volume.id && row.type === 'volume')).toBe(true)
    }
    expect(JSON.stringify(input)).toBe(before)
    expect(walkOutlineChaptersInCanonicalOrder(input)).toEqual(canonical)
  })

  it('public original long import lists its root chapter and selects its real existing node by default', async () => {
    const created = await workspace()
    const id = (await db.outlineNodes.where('projectId').equals(created.scope.projectId).first())!.id!
    const before = JSON.stringify(await db.outlineNodes.toArray())
    const host = await mount(created.project)
    expect(host.textContent).toContain('共 1 章')
    expect(Array.from(host.querySelectorAll('aside button')).some(button => button.textContent?.includes('全文'))).toBe(true)
    expect(host.querySelector('[data-editor-id]')?.getAttribute('data-editor-id')).toBe(String(id))
    expect(JSON.stringify(await db.outlineNodes.toArray())).toBe(before)
  })

  it('keeps an explicit initial root chapter selected rather than auto-selecting another group', async () => {
    const created = await workspace()
    const id = (await db.outlineNodes.where('projectId').equals(created.scope.projectId).first())!.id!
    const volume = await useOutlineStore.getState().addNode({ projectId: created.scope.projectId, parentId: null, type: 'volume', title: '真实卷', summary: '', order: 1 }, created.scope)
    await useOutlineStore.getState().addNode({ projectId: created.scope.projectId, parentId: volume, type: 'chapter', title: '另一章', summary: '', order: 0 }, created.scope)
    const host = await mount(created.project, id)
    expect(host.querySelector('[data-editor-id]')?.getAttribute('data-editor-id')).toBe(String(id))
    expect(host.querySelector(`[data-impact-target-id="${id}"]`)?.textContent).toContain('全文')
  })

  it('a click in a later unvolumed segment opens that real chapter and preserves mixed visible order', async () => {
    const created = await workspace()
    const first = (await db.outlineNodes.where('projectId').equals(created.scope.projectId).first())!.id!
    const volume = await useOutlineStore.getState().addNode({ projectId: created.scope.projectId, parentId: null, type: 'volume', title: '真实中间卷', summary: '', order: 1 }, created.scope)
    const middle = await useOutlineStore.getState().addNode({ projectId: created.scope.projectId, parentId: volume, type: 'chapter', title: '卷内中间章', summary: '', order: 0 }, created.scope)
    const last = await useOutlineStore.getState().addNode({ projectId: created.scope.projectId, parentId: null, type: 'chapter', title: '后段根章', summary: '', order: 2 }, created.scope)
    const host = await mount(created.project)
    expect(host.textContent).toContain('共 3 章')
    const unvolumedSections = Array.from(host.querySelectorAll<HTMLButtonElement>('aside button')).filter(button => button.textContent?.includes('未分卷章节'))
    expect(unvolumedSections).toHaveLength(2)
    const volumeButton = Array.from(host.querySelectorAll<HTMLButtonElement>('aside button')).find(button => button.textContent?.includes('真实中间卷'))!
    await act(async () => { volumeButton.click(); unvolumedSections[1].click() })
    expect(Array.from(host.querySelectorAll('aside button p')).map(label => label.textContent)).toEqual(['全文', '卷内中间章', '后段根章'])
    const lastButton = Array.from(host.querySelectorAll<HTMLButtonElement>('aside button')).find(button => button.textContent?.includes('后段根章'))
    expect(lastButton).toBeDefined()
    await act(async () => lastButton!.click())
    expect(host.querySelector('[data-editor-id]')?.getAttribute('data-editor-id')).toBe(String(last))
    expect(host.querySelector('[data-scene-id]')?.getAttribute('data-scene-id')).toBe(String(last))
    const nodes = useOutlineStore.getState().nodes
    expect(groupOutlineChaptersByTopLevelVolume(nodes).flatMap(group => group.chapters).map(row => row.id)).toEqual([first, middle, last])
  })

  it('a freshly mounted same-Project Work B list contains only its real root chapter', async () => {
    const created = await workspace()
    const firstA = (await db.outlineNodes.where('projectId').equals(created.scope.projectId).first())!.id!
    const workB = await createWorldWork(created.scope.projectId, { title: '作品B', kind: 'novel', novelProfile: 'long' })
    const scopeB = await switchActiveWork(created.scope.projectId, workB.id!)
    const chapterB = await useOutlineStore.getState().addNode({ projectId: scopeB.projectId, parentId: null, type: 'chapter', title: 'B私域章', summary: '', order: 0 }, scopeB)
    const projectB = (await db.projects.get(scopeB.projectId))!
    const host = await mount(projectB)
    expect(host.textContent).toContain('共 1 章')
    expect(host.querySelector('[data-editor-id]')?.getAttribute('data-editor-id')).toBe(String(chapterB))
    expect(host.querySelector('[data-editor-id]')?.getAttribute('data-editor-id')).not.toBe(String(firstA))
    expect(Array.from(host.querySelectorAll('aside button p')).map(label => label.textContent)).toEqual(['B私域章'])
  })

  it('ordinary short-novel real volume title and first chapter selection remain unchanged', async () => {
    const created = await workspace('short')
    const nodes = await db.outlineNodes.where('projectId').equals(created.scope.projectId).toArray()
    const volume = nodes.find(row => row.type === 'volume')!
    const first = walkOutlineChaptersInCanonicalOrder(nodes).chapters[0].outlineNode.id!
    const host = await mount(created.project)
    expect(host.textContent).toContain(volume.title)
    expect(host.querySelector('[data-editor-id]')?.getAttribute('data-editor-id')).toBe(String(first))
    expect(groupOutlineChaptersByTopLevelVolume(nodes).flatMap(group => group.chapters).map(row => row.id))
      .toEqual(walkOutlineChaptersInCanonicalOrder(nodes).chapters.map(row => row.outlineNode.id))
  })
})
