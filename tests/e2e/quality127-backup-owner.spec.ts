import { expect, test } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'

test('同名工作区经真实备份按钮在共享原生目录独立保存，故障和异主文件不覆盖', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  let modelRequests = 0
  await page.route('**/chat/completions', async route => { modelRequests += 1; await route.abort() })
  await page.goto('./')
  await expect(page.getByRole('heading', { name: /天地为炉，\s*万象成故事。/ })).toBeVisible({ timeout: 15_000 })
  const fixture = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { createWorkspace } = await load('/storyforge/src/lib/workspace/create-workspace.ts') as typeof import('../../src/lib/workspace/create-workspace')
    const { bindProjectStorageWorkspace } = await load('/storyforge/src/lib/storage/project-storage-workspace.ts') as typeof import('../../src/lib/storage/project-storage-workspace')
    const directoryName = `sfqa127-${crypto.randomUUID()}`
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(directoryName, { create: true })
    const projects = []
    for (const body of ['甲的独立正文 😀', '乙的独立正文 e\u0301']) {
      const created = await createWorkspace({ name: '相同快照名称', genres: ['fantasy'], description: '', targetWordCount: 100_000, status: 'drafting' }, { kind: 'novel', novelProfile: 'long', importedNovelText: body })
      await bindProjectStorageWorkspace(created.project, directory)
      projects.push({ id: created.scope.projectId, workId: created.scope.workId, uid: created.project.workspaceUid, body })
    }
    return { directoryName, projects }
  })
  try {
    for (const project of fixture.projects) {
      await page.goto(`./workspace/${project.id}?module=export`)
      await openLongformLeaf(page, '数据管理')
      await page.getByRole('button', { name: '保存完整 JSON 快照', exact: true }).click()
      await expect(page.getByText('完整 JSON 快照已保存到本地文件夹', { exact: true })).toBeVisible()
    }
    const restored = await page.evaluate(async directoryName => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { readStoryforgeBackups } = await load('/storyforge/src/lib/storage/folder-backup.ts') as typeof import('../../src/lib/storage/folder-backup')
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(directoryName)
      return (await readStoryforgeBackups(directory)).map(file => ({ name: file.name, uid: file.data.project.workspaceUid, body: file.data.chapters.map(chapter => chapter.content).join('\n') }))
    }, fixture.directoryName)
    expect(restored).toHaveLength(2)
    for (const project of fixture.projects) expect(restored.find(file => file.uid === project.uid)?.body).toContain(project.body)

    const aborted = await page.evaluate(async input => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { backupFilename, writeProjectSnapshotToFolder } = await load('/storyforge/src/lib/storage/folder-backup.ts') as typeof import('../../src/lib/storage/folder-backup')
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(input.directoryName)
      const file = await directory.getFileHandle(backupFilename(input.project.uid))
      const before = await (await file.getFile()).text()
      let aborts = 0
      const failingDirectory = {
        getFileHandle: async (name: string, options?: FileSystemGetFileOptions) => {
          const target = await directory.getFileHandle(name, options)
          return {
            getFile: () => target.getFile(),
            createWritable: async () => {
              const stream = await target.createWritable()
              return {
                write: async (payload: string) => { await stream.write(payload.slice(0, 13)); throw new Error('controlled native write failure') },
                close: () => stream.close(),
                abort: async () => { aborts += 1; await stream.abort() },
              }
            },
          }
        },
      } as unknown as FileSystemDirectoryHandle
      let error = ''
      try { await writeProjectSnapshotToFolder(failingDirectory, input.project.id) }
      catch (cause) { error = cause instanceof Error ? cause.message : String(cause) }
      return { error, aborts, unchanged: before === await (await file.getFile()).text() }
    }, { directoryName: fixture.directoryName, project: fixture.projects[1] })
    expect(aborted).toEqual({ error: 'controlled native write failure', aborts: 1, unchanged: true })

    const foreign = await page.evaluate(async input => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { backupFilename } = await load('/storyforge/src/lib/storage/folder-backup.ts') as typeof import('../../src/lib/storage/folder-backup')
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(input.directoryName)
      const text = await (await (await directory.getFileHandle(backupFilename(input.b.uid))).getFile()).text()
      const writer = await (await directory.getFileHandle(backupFilename(input.a.uid))).createWritable()
      await writer.write(text); await writer.close()
      return text
    }, { directoryName: fixture.directoryName, a: fixture.projects[0], b: fixture.projects[1] })
    const a = fixture.projects[0]
    await page.goto(`./workspace/${a.id}?module=export`)
    await openLongformLeaf(page, '数据管理')
    await page.getByRole('button', { name: '保存完整 JSON 快照', exact: true }).click()
    await expect(page.getByText('写入失败：现有快照属于其他工作区，已阻止覆盖。', { exact: true })).toBeVisible()
    const after = await page.evaluate(async input => {
      const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
      const { backupFilename } = await load('/storyforge/src/lib/storage/folder-backup.ts') as typeof import('../../src/lib/storage/folder-backup')
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(input.directoryName)
      return await (await (await directory.getFileHandle(backupFilename(input.uid))).getFile()).text()
    }, { directoryName: fixture.directoryName, uid: a.uid })
    expect(after).toBe(foreign)
    expect(modelRequests).toBe(0)
  } finally {
    await page.evaluate(async directoryName => {
      await (await navigator.storage.getDirectory()).removeEntry(directoryName, { recursive: true })
    }, fixture.directoryName)
  }
})
