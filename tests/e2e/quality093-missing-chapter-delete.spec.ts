import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

const boundaries = new WeakMap<BrowserContext, string[]>()
const pageErrors = new WeakMap<Page, string[]>()
declare global {
  interface Window {
    quality093LateSave?: {
      calls: number
      archived: string
      afterSave: Record<string, unknown[]>
    }
  }
}

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ context, page }, info) => {
  const baseURL = info.project.use.baseURL
  if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('isolated loopback app required')
  const origin = new URL(baseURL).origin, blocked: string[] = [], errors: string[] = []
  boundaries.set(context, blocked); pageErrors.set(page, errors)
  page.on('pageerror', error => errors.push(error.message))
  await context.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'quality093-isolated')
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true, value: () => navigator.storage.getDirectory(),
    })
  })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
})
test.afterEach(async ({ context, page }, info) => {
  const blocked = boundaries.get(context) ?? [], errors = pageErrors.get(page) ?? []
  await info.attach('chapter-delete-boundaries', {
    contentType: 'application/json', body: JSON.stringify({ blocked, pageErrors: errors }),
  })
  expect(blocked).toEqual([]); expect(errors).toEqual([])
})

async function read(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return {
      chapters: await db.chapters.toArray(), notes: await db.notes.toArray(),
      works: await db.works.toArray(), worlds: await db.worlds.toArray(),
      outlines: await db.outlineNodes.toArray(), releases: await db.worldReleases.toArray(),
      revisions: await db.worldRevisions.toArray(), bindings: await db.workspaceDocuments.toArray(),
      all: Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()]))),
    }
  })
}

async function readFile(page: Page, relativePath: string) {
  return page.evaluate(async path => {
    const parts = path.split('/'), name = parts.pop()!
    let dir = await navigator.storage.getDirectory()
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    return (await (await dir.getFileHandle(name)).getFile()).text()
  }, relativePath)
}

async function prepare(page: Page) {
  await page.goto('./long?module=outline')
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByLabel('新长篇名称').fill('章节回收删除隔离验收')
  await page.getByRole('button', { name: '选择项目文件夹', exact: true }).click()
  await expect(page.getByText(/已选择：/)).toBeVisible()
  await page.getByRole('button', { name: '创建并进入工作台', exact: true }).click()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  const seed = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { useProjectStore } = await load('/storyforge/src/stores/project.ts') as typeof import('../../src/stores/project')
    const { resolveScopeLike, stampNewRecord } = await load('/storyforge/src/lib/workspace/scope.ts') as typeof import('../../src/lib/workspace/scope')
    const { useOutlineStore } = await load('/storyforge/src/stores/outline.ts') as typeof import('../../src/stores/outline')
    const { useChapterStore } = await load('/storyforge/src/stores/chapter.ts') as typeof import('../../src/stores/chapter')
    const { createWorkspace } = await load('/storyforge/src/lib/workspace/create-workspace.ts') as typeof import('../../src/lib/workspace/create-workspace')
    const { seedCurrentProductWorld } = await load('/storyforge/tests/helpers/current-product-world.ts') as typeof import('../helpers/current-product-world')
    const projectId = useProjectStore.getState().currentProjectId
    if (projectId == null) throw new Error('UI must create its actual project')
    const scope = await resolveScopeLike(projectId)
    const nodeId = await useOutlineStore.getState().addNode({
      projectId, parentId: null, type: 'chapter', title: '保留船票的章节', summary: '', order: 0,
    }, scope)
    const chapter = await useChapterStore.getState().getOrCreateByOutlineNode(projectId, nodeId, {
      title: '保留船票的章节', content: '<p>旧稿：船票e\u0301🌙。完整正文仍在。</p>',
      wordCount: 20, status: 'draft', order: 0, notes: '完整作者章内笔记',
    })
    const noteId = await db.notes.add(stampNewRecord(scope, 'notes', {
      projectId, chapterId: chapter.id!, content: '完整关联便签', color: 'yellow' as const,
      pinned: false, createdAt: 1, updatedAt: 1,
    })) as number
    const other = await createWorkspace({
      name: '另一个作者作品', genres: ['fantasy'], status: 'drafting', description: '', targetWordCount: 1000,
    }, { kind: 'novel', novelProfile: 'long', importedNovelText: '另一作品的完整正文，e\u0301🌙。' })
    await seedCurrentProductWorld('独立且冻结的历史世界')
    return { projectId, chapterId: chapter.id!, nodeId, noteId, otherProjectId: other.scope.projectId }
  })
  await openLongformLeaf(page, '数据管理')
  await expect(page.getByRole('heading', { name: '数据管理', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '检查记忆与本地文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认写入项目改动', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '确认写入项目改动', exact: true }).click()
  await expect(page.getByText('项目改动已写入本地文件，并完成回读核对', { exact: true })).toBeVisible({ timeout: 15_000 })
  const binding = (await read(page)).bindings.find(row => row.projectId === seed.projectId && row.tableName === 'chapters' && row.recordId === seed.chapterId)
  if (!binding) throw new Error('real manual sync must create chapter binding')
  const markdown = await readFile(page, binding.relativePath)
  expect(markdown).toContain('旧稿：船票')
  await page.evaluate(async path => {
    const parts = path.split('/'), name = parts.pop()!
    let dir = await navigator.storage.getDirectory()
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    await dir.removeEntry(name)
  }, binding.relativePath)
  await page.getByRole('button', { name: '检查记忆与本地文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '确认删除缺失章节', exact: true })).toBeEnabled()
  return { ...seed, binding, markdown }
}

async function trashCopies(page: Page) {
  return page.evaluate(async () => {
    const found: Record<string, string> = {}
    async function visit(dir: FileSystemDirectoryHandle, path: string): Promise<void> {
      for await (const [name, handle] of dir.entries()) {
        const childPath = path ? `${path}/${name}` : name
        if (handle instanceof FileSystemDirectoryHandle) await visit(handle, childPath)
        else if (handle instanceof FileSystemFileHandle) {
          if (childPath.startsWith('.storyforge/trash/')) found[childPath] = await (await handle.getFile()).text()
        } else throw new Error('expected a real native OPFS handle')
      }
    }
    await visit(await navigator.storage.getDirectory(), '')
    return found
  })
}

test('actual missing-file delete keeps exact OPFS trash and other authored scopes', async ({ page }, info) => {
  const f = await prepare(page), before = await read(page)
  expect(before.releases.length).toBeGreaterThan(0)
  await page.getByRole('button', { name: '确认删除缺失章节', exact: true }).click()
  await expect(page.getByText('缺失章节已移入工作区回收历史，并完成引用核对', { exact: true })).toBeVisible({ timeout: 15_000 })
  const after = await read(page)
  expect(after.chapters).toEqual(before.chapters.filter(row => row.id !== f.chapterId))
  expect(after.bindings.some(row => row.id === f.binding.id)).toBe(false)
  expect(after.notes).toEqual(before.notes)
  expect(after.works).toEqual(before.works); expect(after.worlds).toEqual(before.worlds)
  expect(after.outlines).toEqual(before.outlines)
  expect(after.releases).toEqual(before.releases); expect(after.revisions).toEqual(before.revisions)
  const copies = await trashCopies(page)
  expect(Object.keys(copies)).toHaveLength(1)
  expect(Object.values(copies)).toEqual([f.markdown])
  const recovery = JSON.parse(await readFile(page, '.storyforge/recovery/project.json'))
  expect(recovery.backup.chapters).toEqual([])
  await page.getByRole('button', { name: '检查记忆与本地文件', exact: true }).click()
  await expect(page.getByText('项目与本地文件已经一致', { exact: true })).toBeVisible()
  expect(await trashCopies(page)).toEqual(copies)
  await info.attach('real-opfs-confirmed-delete', { contentType: 'application/json', body: JSON.stringify({ before, after, copies }) })
})

test('real OPFS close followed by actual author save makes the UI stop deletion', async ({ page }, info) => {
  const f = await prepare(page), before = await read(page)
  await page.evaluate(async ({ chapterId, basename }) => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { useChapterStore } = await load('/storyforge/src/stores/chapter.ts') as typeof import('../../src/stores/chapter')
    const nativeCreate = FileSystemFileHandle.prototype.createWritable
    // Keep the native file/stream and close it for real; only schedule the
    // actual author service between completed disk IO and the final DB CAS.
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const stream = await nativeCreate.call(this, ...args)
      if (this.name === basename) {
        const nativeGetFile = this.getFile.bind(this), nativeClose = stream.close.bind(stream)
        stream.close = async () => {
          await nativeClose()
          if (window.quality093LateSave) throw new Error('late-save seam must run once')
          const archived = await (await nativeGetFile()).text()
          await useChapterStore.getState().updateChapter(chapterId, { content: '<p>新稿：作者在回收副本写完后保存，e\u0301🌙。</p>' })
          const afterSave = Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])))
          window.quality093LateSave = { calls: 1, archived, afterSave }
        }
      }
      return stream
    }
  }, { chapterId: f.chapterId, basename: f.binding.relativePath.split('/').pop()! })
  await page.getByRole('button', { name: '确认删除缺失章节', exact: true }).click()
  await expect(page.getByText(/^删除停止：/)).toBeVisible()
  await expect(page.getByText(/^删除停止：/)).toContainText('重新检查')
  const observation = await page.evaluate(() => window.quality093LateSave)
  expect(observation?.calls).toBe(1)
  expect(observation?.archived).toBe(f.markdown)
  const after = await read(page)
  expect(after.all).toEqual(observation?.afterSave)
  expect(after.chapters.find(row => row.id === f.chapterId)?.content).toBe('<p>新稿：作者在回收副本写完后保存，e\u0301🌙。</p>')
  expect(after.bindings).toEqual(before.bindings)
  expect(after.notes).toEqual(before.notes)
  expect(after.releases).toEqual(before.releases); expect(after.revisions).toEqual(before.revisions)
  expect(Object.values(await trashCopies(page))).toEqual([f.markdown])
  await info.attach('real-opfs-late-author-save', { contentType: 'application/json', body: JSON.stringify({ before, after, observation }) })
})

test('actual native delete failure preserves complete data and verified OPFS trash', async ({ page }, info) => {
  const f = await prepare(page)
  await page.evaluate(async chapterId => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    db.chapters.hook('deleting', key => {
      if (key === chapterId) throw new Error('隔离原生事务故障：原章未删')
    })
  }, f.chapterId)
  const before = await read(page)
  await page.getByRole('button', { name: '确认删除缺失章节', exact: true }).click()
  await expect(page.getByText(/^删除停止：/)).toContainText('删除停止：隔离原生事务故障：原章未删')
  expect(await read(page)).toEqual(before)
  expect(Object.values(await trashCopies(page))).toEqual([f.markdown])
  await info.attach('real-opfs-native-delete-rollback', { contentType: 'application/json', body: JSON.stringify({ before, after: await read(page), copies: await trashCopies(page) }) })
})
