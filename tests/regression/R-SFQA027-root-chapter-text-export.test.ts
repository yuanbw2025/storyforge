import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldWork, switchActiveWork } from '../../src/lib/workspace/works'
import { resolveWorkspaceScope } from '../../src/lib/workspace/ownership'
import { exportProjectMarkdown, exportProjectTXT } from '../../src/lib/export/text-export'
import { readOwnedRows, stampNewRecord } from '../../src/lib/workspace/scope'
import { adopt } from '../../src/lib/registry/adopt'
import { walkOutlineChaptersInCanonicalOrder } from '../../src/lib/outline/canonical-outline-walk'
import { htmlToPlainText, plainTextToHtml } from '../../src/lib/utils/html'
import type { Chapter, OutlineNode, WorkspaceScope } from '../../src/lib/types'
import { useOutlineStore } from '../../src/stores/outline'
import { useWorldGroupStore } from '../../src/stores/world-group'
import { addCurrentWorkFixtureV1, addCurrentWorldFixtureV1 } from '../helpers/current-workspace'

const FORMATS = [['TXT', exportProjectTXT], ['Markdown', exportProjectMarkdown]] as const

async function workspace(name = '027 owned novel', importedNovelText?: string) {
  return createWorkspace({ name, description: '', genres: [], status: 'drafting', targetWordCount: 100_000, enableMultiWorld: true }, {
    kind: 'novel', novelProfile: 'long', ...(importedNovelText == null ? {} : { importedNovelText }),
  })
}

async function outline(scope: WorkspaceScope, title: string, type: OutlineNode['type'], parentId: number | null, order: number, worldGroupId: number | null = null) {
  return useOutlineStore.getState().addNode({ projectId: scope.projectId, parentId, title, type, summary: `summary:${title}`, order, worldGroupId }, scope)
}

async function chapter(scope: WorkspaceScope, title: string, body: string, parentId: number | null = null, order = 0, worldGroupId: number | null = null) {
  const outlineId = await outline(scope, title, 'chapter', parentId, order, worldGroupId)
  const result = await adopt({ projectId: scope.projectId, scope, target: 'chapters', mode: 'add', data: {
    outlineNodeId: outlineId, title, content: plainTextToHtml(body), wordCount: body.length,
    status: 'draft', order, notes: '',
  } })
  expect(result.fkErrors).toEqual([])
  expect(result.written).toHaveLength(1)
  return { outlineId, chapterId: result.written[0].id }
}

async function databaseBytes() {
  return JSON.stringify(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
}

function onceInOrder(text: string, bodies: string[]) {
  let offset = -1
  for (const body of bodies) {
    expect(text.split(body).length - 1, `full body count: ${body.slice(0, 35)}`).toBe(1)
    const next = text.indexOf(body)
    expect(next, `body order: ${body.slice(0, 35)}`).toBeGreaterThan(offset)
    offset = next
  }
}

beforeEach(async () => {
  await db.delete(); await db.open()
  useOutlineStore.setState({ nodes: [], loadedScope: null, loading: false, loadError: null })
})
afterEach(() => { vi.restoreAllMocks(); db.close() })

describe('SFQA-027 · canonical complete owned manuscript text export', () => {
  it.each(FORMATS)('%s exports a public original long-novel root chapter in full without changing the DB', async (_, render) => {
    const body = '原作完整句子 & <不是标签> é e\u0301 𐀀，句末也保留。'
    const created = await workspace('真实公开原作导入', body)
    const before = await databaseBytes()
    const rows = await readOwnedRows<Chapter>(created.scope, 'chapters', { owner: 'work' })
    expect(rows).toHaveLength(1)
    expect(htmlToPlainText(rows[0].content)).toBe(body)
    const text = await render(created.scope)
    onceInOrder(text, [body])
    expect(await databaseBytes()).toBe(before)
  })

  it.each(FORMATS)('%s retains the complete public multi-chunk original, preface and last suffix exactly once', async (format, render) => {
    const source = `序言：原作者 & 𐀀。${'前'.repeat(10_500)}\n第1章 进港\n${'甲'.repeat(12_000)}\n第2章 归航\n${'乙'.repeat(12_000)}尾声：原作者最后一个字。`
    const created = await workspace('多块原文', source)
    const rows = (await readOwnedRows<Chapter>(created.scope, 'chapters', { owner: 'work' })).sort((a, b) => a.order - b.order)
    expect(rows.length).toBeGreaterThan(1)
    const before = await databaseBytes()
    const text = await render(created.scope)
    const bodies = rows.map(row => {
      const plain = htmlToPlainText(row.content)
      return format === 'Markdown' ? plain.replace(/\n/g, '\n\n').replace(/\n{3,}/g, '\n\n') : plain
    })
    onceInOrder(text, bodies)
    expect(text).toContain('序言：原作者 & 𐀀。')
    expect(text).toContain('尾声：原作者最后一个字。')
    expect(await databaseBytes()).toBe(before)
  })

  it.each(FORMATS)('%s follows deep canonical volume/arc/story-block nesting and never renders containers as prose', async (_, render) => {
    const { scope } = await workspace()
    const volume = await outline(scope, '真实卷', 'volume', null, 0)
    const direct = await chapter(scope, '直挂章', 'BODY/direct/完整正文。', volume, 0)
    const arc = await outline(scope, '真实篇章', 'arc', volume, 1)
    const block = await outline(scope, '真实故事块', 'storyBlock', arc, 0)
    const innerArc = await outline(scope, '内层篇章', 'arc', block, 0)
    const nested = await chapter(scope, '深层章', 'BODY/deep/一个字也保留。', innerArc, 0)
    const nodes = await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })
    expect(walkOutlineChaptersInCanonicalOrder(nodes).chapters.map(row => row.outlineNode.id)).toEqual([direct.outlineId, nested.outlineId])
    const before = await databaseBytes()
    const text = await render(scope)
    onceInOrder(text, ['BODY/direct/完整正文。', 'BODY/deep/一个字也保留。'])
    expect(text).toContain('真实卷')
    expect(text).toContain('真实篇章')
    expect(text).toContain('真实故事块')
    expect(await databaseBytes()).toBe(before)
  })

  it.each(FORMATS)('%s preserves root→volume→empty-volume→root→root-arc order', async (_, render) => {
    const { scope } = await workspace()
    await chapter(scope, '根章A', 'BODY/A/第一段。', null, 0)
    const volume = await outline(scope, '中间真实卷', 'volume', null, 1)
    await chapter(scope, '卷章B', 'BODY/B/第二段。', volume)
    await outline(scope, '真实空卷', 'volume', null, 2)
    await chapter(scope, '根章C', 'BODY/C/第三段。', null, 3)
    const arc = await outline(scope, '根篇章', 'arc', null, 4)
    await chapter(scope, '篇章D', 'BODY/D/第四段。', arc)
    const text = await render(scope)
    onceInOrder(text, ['BODY/A/第一段。', 'BODY/B/第二段。', 'BODY/C/第三段。', 'BODY/D/第四段。'])
    expect(text).toContain('真实空卷')
  })

  it.each(FORMATS)('%s uses outline order/id ties and ignores stale Chapter.order', async (_, render) => {
    const { scope } = await workspace()
    const a = await chapter(scope, '章A', 'ORDER/A/保留。', null, 0)
    const b = await chapter(scope, '章B', 'ORDER/B/保留。', null, 1)
    // Inject only existing dirty ordering; no production reordering or repair.
    await db.outlineNodes.update(b.outlineId, { order: 0 })
    await db.chapters.update(a.chapterId, { order: 999 })
    await db.chapters.update(b.chapterId, { order: -999 })
    const before = await databaseBytes()
    onceInOrder(await render(scope), ['ORDER/A/保留。', 'ORDER/B/保留。'])
    expect(await databaseBytes()).toBe(before)
  })

  it.each(FORMATS)('%s keeps existing best-row recovery while equal prose in different chapters is emitted twice', async (_, render) => {
    const { scope } = await workspace()
    const volume = await outline(scope, '重复行对照卷', 'volume', null, 0)
    const a = await chapter(scope, '逻辑章A', '相同正文但属于两章。', volume, 0)
    await chapter(scope, '逻辑章B', '相同正文但属于两章。', volume, 1)
    const original = (await db.chapters.get(a.chapterId))!
    await db.chapters.add(stampNewRecord(scope, 'chapters', {
      ...original, id: undefined, ragDocumentId: undefined, content: '', wordCount: 0,
      updatedAt: original.updatedAt + 1_000,
    }, { owner: 'work' }))
    const before = await databaseBytes()
    const text = await render(scope)
    expect(text.split('相同正文但属于两章。').length - 1).toBe(2)
    expect(text.indexOf('逻辑章A')).toBeLessThan(text.indexOf('逻辑章B'))
    expect(await databaseBytes()).toBe(before)
  })

  it.each(FORMATS)('%s retains owned chapters under a missing parent without repairing their links', async (_, render) => {
    const { scope } = await workspace()
    const item = await chapter(scope, '失去父级的章', 'ORPHAN/PARENT/正文仍在。')
    await db.outlineNodes.update(item.outlineId, { parentId: 999_991 })
    const before = await databaseBytes()
    onceInOrder(await render(scope), ['ORPHAN/PARENT/正文仍在。'])
    expect(await databaseBytes()).toBe(before)
  })

  it.each(FORMATS)('%s appends a real orphan Chapter body using the existing canonical recovery sequence', async (_, render) => {
    const { scope } = await workspace()
    await chapter(scope, '正常章', 'NORMAL/正文。')
    await db.chapters.add(stampNewRecord(scope, 'chapters', {
      projectId: scope.projectId, outlineNodeId: 999_992, title: '已有孤立正文',
      content: '<p>ORPHAN/BODY/不能静默遗漏。</p>', wordCount: 20, status: 'draft',
      order: -100, notes: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const before = await databaseBytes()
    onceInOrder(await render(scope), ['NORMAL/正文。', 'ORPHAN/BODY/不能静默遗漏。'])
    expect(await databaseBytes()).toBe(before)
  })

  it.each(FORMATS)('%s preserves empty outline/chapter presentation and real empty volumes', async (format, render) => {
    const { scope } = await workspace()
    const volume = await outline(scope, '空卷仍是卷', 'volume', null, 0)
    await outline(scope, '尚未写正文的章', 'chapter', volume, 0)
    const text = await render(scope)
    expect(text).toContain('空卷仍是卷')
    expect(text).toContain('尚未写正文的章')
    if (format === 'Markdown') expect(text).toContain('summary:尚未写正文的章')
    expect(await db.chapters.count()).toBe(0)
  })

  it.each(FORMATS)('%s exports only the explicit Work/World while retaining all of its worldGroups', async (_, render) => {
    const a = await workspace('作品A')
    const groupOne = await useWorldGroupStore.getState().createGroup({ projectId: a.scope.projectId, name: '组一', description: '', type: 'parallel', order: 0 }, a.scope)
    const groupTwo = await useWorldGroupStore.getState().createGroup({ projectId: a.scope.projectId, name: '组二', description: '', type: 'parallel', order: 1 }, a.scope)
    await chapter(a.scope, 'A章1', 'A/组一/完整正文。', null, 0, groupOne)
    await chapter(a.scope, 'A章2', 'A/组二/完整正文。', null, 1, groupTwo)
    const workB = await createWorldWork(a.scope.projectId, { title: '作品B', kind: 'novel', novelProfile: 'long' })
    const b = await switchActiveWork(a.scope.projectId, workB.id!)
    await chapter(b, 'B章私有标题', 'B/同Project另一Work/秘密正文。')
    const worldC = await addCurrentWorldFixtureV1({ projectId: a.scope.projectId, name: '另一World', now: 10 })
    const workC = await addCurrentWorkFixtureV1({ projectId: a.scope.projectId, worldId: worldC.id!, create: { title: '作品C', kind: 'novel', novelProfile: 'long' }, now: 11 })
    const c = await switchActiveWork(a.scope.projectId, workC.id!)
    await chapter(c, 'C章私有标题', 'C/同Project另一World/秘密正文。')
    useWorldGroupStore.getState().setActiveGroup(groupOne)
    const before = await databaseBytes()
    const text = await render(a.scope)
    onceInOrder(text, ['A/组一/完整正文。', 'A/组二/完整正文。'])
    for (const forbidden of ['B章私有标题', 'B/同Project', 'C章私有标题', 'C/同Project', '作品B', '作品C']) expect(text).not.toContain(forbidden)
    expect(await databaseBytes()).toBe(before)
    const active = await render(a.scope.projectId)
    expect(active).toContain('C/同Project另一World/秘密正文。')
    expect(active).not.toContain('A/组一/完整正文。')
  })

  it.each(FORMATS)('%s rejects mismatched or deleted scope and preserves the source DB', async (_, render) => {
    const a = await workspace()
    await chapter(a.scope, 'A章', 'A/SCOPE/正文。')
    const foreign = await workspace('另一工作区')
    const before = await databaseBytes()
    await expect(render({ ...a.scope, worldId: foreign.scope.worldId })).rejects.toThrow()
    await expect(render({ ...a.scope, workId: 999_993 })).rejects.toThrow()
    expect(await databaseBytes()).toBe(before)
  })

  it.each(FORMATS)('%s waits for a prior numeric scope resolver before opening its read transaction', async (_, render) => {
    const { scope } = await workspace()
    const volume = await outline(scope, '并发解析对照卷', 'volume', null, 0)
    await chapter(scope, '既有卷章', 'INFLIGHT/SCOPE/完整正文。', volume)
    const before = await databaseBytes()
    const originalGet = db.projects.get.bind(db.projects)
    let release!: () => void
    let signalRead!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const readStarted = new Promise<void>(resolve => { signalRead = resolve })
    vi.spyOn(db.projects, 'get').mockImplementationOnce((...args) => originalGet(...args).then(async row => {
      signalRead()
      await gate
      return row
    }))
    const pendingScope = resolveWorkspaceScope(scope.projectId)
    await readStarted
    const pendingExport = render(scope.projectId)
      .then(value => ({ value, error: null }), error => ({ value: null, error }))
    try {
      // Only schedule public calls: do not touch the resolver's private cache.
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      release()
      expect(await pendingScope).toEqual(scope)
      const result = await pendingExport
      expect(await databaseBytes()).toBe(before)
      if (result.error) throw result.error
      onceInOrder(result.value!, ['INFLIGHT/SCOPE/完整正文。'])
    } finally {
      release()
      await pendingScope.catch(() => undefined)
      await pendingExport
    }
  })

  it.each(FORMATS)('%s propagates an owned body-read failure without returning partial success or changing data', async (_, render) => {
    const { scope } = await workspace()
    await chapter(scope, '已有章', 'READ/FAILURE/完整原文保留。')
    const before = await databaseBytes()
    vi.spyOn(db.chapters, 'where').mockImplementationOnce(() => { throw new Error('synthetic body read failure') })
    await expect(render(scope)).rejects.toThrow('synthetic body read failure')
    expect(await databaseBytes()).toBe(before)
  })

  it.each(FORMATS)('%s reports a malformed body→container binding instead of successful text omission', async (_, render) => {
    const { scope } = await workspace()
    const volume = await outline(scope, '真实卷', 'volume', null, 0)
    await db.chapters.add(stampNewRecord(scope, 'chapters', {
      projectId: scope.projectId, outlineNodeId: volume, title: '异常绑定的正文',
      content: '<p>MALFORMED/BODY/原文保留。</p>', wordCount: 20, status: 'draft',
      order: 0, notes: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }))
    const before = await databaseBytes()
    await expect(render(scope)).rejects.toThrow()
    expect(await databaseBytes()).toBe(before)
  })

  it.each(FORMATS)('%s fails clearly on a preexisting outline cycle, without recursion or DB repair', async (_, render) => {
    const { scope } = await workspace()
    const volume = await outline(scope, '循环卷', 'volume', null, 0)
    const a = await chapter(scope, '循环章', 'CYCLE/BODY/原文保留。', volume)
    await db.outlineNodes.update(volume, { parentId: a.outlineId })
    const before = await databaseBytes()
    await expect(render(scope)).rejects.toThrow()
    expect(await databaseBytes()).toBe(before)
  })
})
