import { expect, test, type Page } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'
import type { WorkspaceSelfCheckPlanV1 } from '../../src/lib/types'

declare global {
  interface Window {
    quality092MetadataReads?: { calls: number; size: number; lastModified: number }
  }
}

test.use({ serviceWorkers: 'block' })

async function fileText(page: Page, relativePath: string) {
  return page.evaluate(async path => {
    const parts = path.split('/'), name = parts.pop()!
    let directory = await navigator.storage.getDirectory()
    for (const part of parts) directory = await directory.getDirectoryHandle(part)
    return (await (await directory.getFileHandle(name)).getFile()).text()
  }, relativePath)
}

test('actual OPFS draft survives same-metadata check until the author explicitly chooses project content', async ({ context, page }, info) => {
  const baseURL = info.project.use.baseURL
  if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('isolated loopback app required')
  const origin = new URL(baseURL).origin, blocked: string[] = [], pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      blocked.push(`${request.method()} ${url.origin}${url.pathname}`)
      await route.abort('blockedbyclient')
    } else await route.continue()
  })
  await context.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'quality092-isolated')
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true, value: () => navigator.storage.getDirectory(),
    })
  })

  await page.goto('./long?module=outline')
  await page.getByRole('button', { name: '新建长篇', exact: true }).click()
  await page.getByLabel('新长篇名称').fill('CACHE_BASE')
  await page.getByRole('button', { name: '选择项目文件夹', exact: true }).click()
  await expect(page.getByText(/已选择：/)).toBeVisible()
  await page.getByRole('button', { name: '创建并进入工作台', exact: true }).click()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
  await openLongformLeaf(page, '数据管理')
  await expect(page.getByRole('heading', { name: '数据管理', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '检查记忆与本地文件', exact: true }).click()
  await page.getByRole('button', { name: '确认写入项目改动', exact: true }).click()
  await expect(page.getByText('项目改动已写入本地文件，并完成回读核对', { exact: true })).toBeVisible()

  const before = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { useProjectStore } = await load('/storyforge/src/stores/project.ts') as typeof import('../../src/stores/project')
    const projectId = useProjectStore.getState().currentProjectId
    if (projectId == null) throw new Error('UI must create a real current workspace')
    const binding = await db.workspaceDocuments.where('[projectId+tableName+recordId]')
      .equals([projectId, 'projects', projectId]).first()
    if (!binding || !binding.fileLastModified || !binding.fileByteLength) throw new Error('real initial sync metadata required')
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(binding.relativePath)
    const originalFile = await handle.getFile(), original = await originalFile.text()
    const external = original.replace('CACHE_BASE', 'DISK_DRAFT')
    if (external === original || new TextEncoder().encode(external).byteLength !== originalFile.size) {
      throw new Error('same actual UTF-8 byte length fixture required')
    }
    const writer = await handle.createWritable()
    await writer.write(external); await writer.close()
    const nativeGetFile = FileSystemFileHandle.prototype.getFile
    // OPFS supplies the real bytes and all writes. Only the declared mtime is
    // controlled: browsers do not expose an OS utimes API. This is not a claim
    // that an actual author's disk or OS timestamp was modified by this test.
    FileSystemFileHandle.prototype.getFile = async function () {
      const file = await nativeGetFile.call(this)
      if (this.name !== binding.relativePath) return file
      const observed = new File([await file.arrayBuffer()], file.name, {
        type: file.type, lastModified: binding.fileLastModified!,
      })
      window.quality092MetadataReads = {
        calls: (window.quality092MetadataReads?.calls ?? 0) + 1,
        size: observed.size, lastModified: observed.lastModified,
      }
      return observed
    }
    await useProjectStore.getState().updateWorkspace(projectId, { name: 'DB_CURRENT' })
    return { projectId, binding, original, external, actualExternalFileSize: (await nativeGetFile.call(handle)).size,
      worlds: await db.worlds.toArray(), works: await db.works.toArray() }
  })
  const originalManifest = await fileText(page, '.storyforge/manifest.json')
  await page.getByRole('button', { name: '检查记忆与本地文件', exact: true }).click()
  await expect(page.getByRole('button', { name: '以项目内容解决冲突', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '以本地文件解决并采纳', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '确认写入项目改动', exact: true })).toHaveCount(0)
  expect(await fileText(page, before.binding.relativePath)).toBe(before.external)
  expect(await fileText(page, '.storyforge/manifest.json')).toBe(originalManifest)
  const blockedState = await page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return { binding: await db.workspaceDocuments.get(id), metadata: window.quality092MetadataReads }
  }, before.binding.id!)
  expect(blockedState.binding).toEqual(before.binding)
  expect(blockedState.metadata?.calls).toBeGreaterThan(0)
  expect(blockedState.metadata?.size).toBe(before.binding.fileByteLength)
  expect(blockedState.metadata?.lastModified).toBe(before.binding.fileLastModified)

  await page.getByRole('button', { name: '以项目内容解决冲突', exact: true }).click()
  await expect(page.getByText('已保留冲突文件历史，并以项目内容完成同步', { exact: true })).toBeVisible()
  expect(await fileText(page, before.binding.relativePath)).toContain('DB_CURRENT')
  const journal = JSON.parse(await fileText(page, '.storyforge/transactions/pending.json')) as { plan: WorkspaceSelfCheckPlanV1 }
  expect(journal.plan.projectId).toBe(before.projectId)
  expect(journal.plan.workspaceUid).toBe(before.binding.workspaceUid)
  const historyPath = `.storyforge/history/${journal.plan.planId}/${before.binding.relativePath}`
  const history = await fileText(page, historyPath)
  expect(history).toBe(before.external)
  const after = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    return { worlds: await db.worlds.toArray(), works: await db.works.toArray() }
  })
  expect(after.worlds).toEqual(before.worlds); expect(after.works).toEqual(before.works)
  await page.reload()
  await expect(page.getByRole('heading', { name: '数据管理', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '检查记忆与本地文件', exact: true }).click()
  await expect(page.getByText('项目与本地文件已经一致', { exact: true })).toBeVisible()
  expect(await fileText(page, before.binding.relativePath)).toContain('DB_CURRENT')
  expect(blocked).toEqual([]); expect(pageErrors).toEqual([])
  await info.attach('actual-opfs-content-identity', {
    contentType: 'application/json', body: JSON.stringify({ before, blockedState, after, historyPath, history, blocked, pageErrors }),
  })
})
