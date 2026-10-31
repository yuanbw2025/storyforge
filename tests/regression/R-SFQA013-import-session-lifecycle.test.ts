/** Public import-session lifecycle, native source bytes and deletion serialization.
 * No model/author data. Optional external snapshots are audit evidence, not fixtures.
 */
import { Blob as NativeBlob } from 'node:buffer'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { useImportSessionStore } from '../../src/stores/import-session'
import type { ImportSession } from '../../src/lib/types/import-session'

const originalText = '\uFEFF第一章\r\n雨落在海港。\u0000原样保留🌙\n尾声。'
const bytes = Buffer.from(originalText, 'utf8')
const fileHash = createHash('sha256').update(bytes).digest('hex')
const sourceBlob = () => new NativeBlob([bytes], { type: 'text/plain;charset=utf-8' }) as unknown as Blob
const store = () => useImportSessionStore.getState()
const rowData = (projectId: number, status: ImportSession['status'] = 'pending') => ({
  projectId, filename: 'synthetic-original.txt', fileHash, totalChars: originalText.length,
  totalChunks: 1, chunkSize: 1000,
  chunks: [{ index: 0, startChar: 0, endChar: originalText.length, charCount: originalText.length,
    status: 'pending' as const, attempts: 0 }],
  merged: { worldview: { summary: '合成设定，可复用的完成结果。' } }, rollingContext: '',
  importTarget: 'project' as const, status,
})
async function workspace(label: string) {
  return (await createWorkspace({ name: label, description: '', genres: [], status: 'drafting', targetWordCount: 1000 })).scope.projectId
}
async function session(projectId: number, status: ImportSession['status'] = 'pending') {
  const id = await store().create(rowData(projectId, status))
  await store().saveBlob(id, 'synthetic-original.txt', sourceBlob(), fileHash)
  await store().log(id, -1, 'info', `原文 ${originalText}`)
  return id
}
async function valueSnapshot(value: unknown): Promise<unknown> {
  if (value instanceof NativeBlob) return { nativeBlob: true, type: value.type, size: value.size,
    bytesHex: Buffer.from(await value.arrayBuffer()).toString('hex') }
  if (Array.isArray(value)) return Promise.all(value.map(valueSnapshot))
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(
    Object.entries(value).map(async ([key, child]) => [key, await valueSnapshot(child)]),
  ))
  return value
}
async function databaseSnapshot() {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await valueSnapshot(await table.toArray())])))
}
async function checkpoint(label: string) {
  const snapshot = await databaseSnapshot()
  if (process.env.SFQA013_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.SFQA013_EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(path.join(process.env.SFQA013_EVIDENCE_DIR, `${label}.json`), JSON.stringify(snapshot, null, 2) + '\n')
  }
  return snapshot
}
async function familySnapshot(id: number) {
  return valueSnapshot({ session: await db.importSessions.get(id), logs: await db.importLogs.where('sessionId').equals(id).toArray(), file: await db.importFiles.get(id) })
}
async function assertNoChildren(id: number) {
  expect(await db.importSessions.get(id)).toBeUndefined()
  expect(await db.importLogs.where('sessionId').equals(id).count()).toBe(0)
  expect(await db.importFiles.get(id)).toBeUndefined()
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

beforeEach(async () => { await db.delete(); await db.open(); store().clear() })
afterEach(async () => { vi.restoreAllMocks(); store().clear(); await db.delete() })

describe('SFQA013 native original and valid session contracts', () => {
  it.each(['pending', 'running', 'paused', 'failed', 'done'] as const)('retains exact native Blob/log bytes for valid %s sessions and allows normal updates', async status => {
    const projectId = await workspace(`正常 ${status}`), id = await session(projectId, status)
    await store().patchChunk(id, 0, { attempts: 1, status: 'done' })
    await store().patch(id, { rollingContext: '正常追加上下文', status })
    await store().log(id, 0, 'success', '保留正常日志')
    const restored = await store().loadBlob(id)
    expect(restored!.blob).toBeInstanceOf(NativeBlob)
    expect(Buffer.from(await restored!.blob.arrayBuffer())).toEqual(bytes)
    expect(await store().load(id)).toMatchObject({ projectId, status, rollingContext: '正常追加上下文', chunks: [{ attempts: 1, status: 'done' }] })
    expect(await store().listLogs(id)).toHaveLength(2)
    if (status === 'done') expect((await store().findReusableCompleted(projectId))?.id).toBe(id)
    else expect((await store().findUnfinished(projectId))?.id).toBe(id)
  })

  it('deletes a project family while preserving all foreign original/log bytes and its Project', async () => {
    const target = await workspace('删除目标'), foreign = await workspace('外域保留')
    const ownId = await session(target), foreignId = await session(foreign, 'paused')
    const preserved = await familySnapshot(foreignId)
    await checkpoint('normal-project-delete-before')
    await cascadeDeleteProject(target)
    await checkpoint('normal-project-delete-after')
    await assertNoChildren(ownId)
    expect(await db.projects.get(target)).toBeUndefined()
    expect(await db.projects.get(foreign)).toBeDefined()
    expect(await familySnapshot(foreignId)).toEqual(preserved)
  })

  it('atomically abandons one session including its source, preserving its Project and other sessions', async () => {
    const projectId = await workspace('只放弃会话'), abandoned = await session(projectId), kept = await session(projectId, 'failed')
    const preserved = await familySnapshot(kept)
    await checkpoint('normal-session-abandon-before')
    await store().deleteSession(abandoned)
    await checkpoint('normal-session-abandon-after')
    await assertNoChildren(abandoned)
    expect(await db.projects.get(projectId)).toBeDefined()
    expect(await familySnapshot(kept)).toEqual(preserved)
    await store().deleteSession(abandoned)
    await assertNoChildren(abandoned)
  })
})

describe('SFQA013 delete snapshot and late public writes', () => {
  it('includes a public import committed after old precollection but before the actual delete write lock', async () => {
    const target = await workspace('预收集窗口'), foreign = await workspace('预收集外域')
    const foreignId = await session(foreign), preserved = await familySnapshot(foreignId)
    const original = db.transaction.bind(db)
    let inserted = false, insertedId = 0
    vi.spyOn(db, 'transaction').mockImplementation((async (...args: unknown[]) => {
      if (!inserted && Array.isArray(args[1]) && args[1].some(table => table.name === 'importLogs')) {
        inserted = true
        insertedId = await session(target)
        await checkpoint('precollection-race-before-delete-lock')
      }
      return Reflect.apply(original, db, args)
    }) as typeof db.transaction)
    await cascadeDeleteProject(target)
    await checkpoint('precollection-race-after-delete')
    expect(inserted).toBe(true)
    expect(await db.projects.get(target)).toBeUndefined()
    await assertNoChildren(insertedId)
    expect(await familySnapshot(foreignId)).toEqual(preserved)
  })

  const lateOperations = {
    log: (id: number) => store().log(id, 0, 'success', '不应复活的晚到日志'),
    saveBlob: (id: number) => store().saveBlob(id, 'late.txt', sourceBlob(), 'synthetic-late'),
    patch: (id: number) => store().patch(id, { fatalError: '不应成功的晚到更新' }),
    patchChunk: (id: number) => store().patchChunk(id, 0, { status: 'done', attempts: 9 }),
  }
  for (const deletion of ['project', 'session'] as const) {
    it.each(Object.keys(lateOperations) as (keyof typeof lateOperations)[])('rejects late %s after complete ' + deletion + ' deletion without source/log recreation or phantom memory', async operation => {
      const projectId = await workspace(`晚到 ${deletion} ${operation}`), id = await session(projectId)
      if (deletion === 'project') await cascadeDeleteProject(projectId)
      else await store().deleteSession(id)
      await checkpoint(`late-${deletion}-${operation}-before`)
      const outcome = await lateOperations[operation](id).then(() => null, error => error)
      await checkpoint(`late-${deletion}-${operation}-after`)
      expect(outcome).toBeInstanceOf(Error)
      expect(String(outcome)).toMatch(/会话|项目|已删除|不存在/)
      await assertNoChildren(id)
      expect(store().current?.fatalError).not.toBe('不应成功的晚到更新')
      expect(store().current?.chunks[0]?.attempts).not.toBe(9)
      expect(Boolean(await db.projects.get(projectId))).toBe(deletion === 'session')
    })
  }

  it.each(Object.keys(lateOperations) as (keyof typeof lateOperations)[])('rejects %s when a historical Session still exists but its physical Project root is missing, without purging old evidence', async operation => {
    const projectId = await workspace(`缺失项目根 ${operation}`), id = await session(projectId)
    // Deliberate synthetic preexisting corruption: deletion guard must check both
    // physical ancestors, but this repair does not sweep historical orphan data.
    await db.projects.delete(projectId)
    const before = await checkpoint(`historical-orphan-${operation}-before`)
    const outcome = await lateOperations[operation](id).then(() => null, error => error)
    const after = await checkpoint(`historical-orphan-${operation}-after`)
    expect(outcome).toBeInstanceOf(Error)
    expect(String(outcome)).toMatch(/会话|项目|已删除|不存在/)
    expect(after).toEqual(before)
  })

  it.each(['id', 'projectId'] as const)('does not reparent an existing Session through a public patch to its %s', async field => {
    const projectId = await workspace('稳定会话身份'), otherProject = await workspace('身份外域'), id = await session(projectId)
    const before = await checkpoint(`patch-identity-${field}-before`)
    const outcome = await store().patch(id, field === 'projectId' ? { projectId: otherProject } : { id: id + 1000 }).then(() => null, error => error)
    const after = await checkpoint(`patch-identity-${field}-after`)
    expect(outcome).toBeInstanceOf(Error)
    expect(after).toEqual(before)
  })

  it.each(['foreign', 'original'] as const)('validates the captured %s Project identity even if the caller changes its original input while awaiting', async captured => {
    const projectId = await workspace('捕获输入归属'), foreignProjectId = await workspace('捕获输入外域')
    const id = await session(projectId), foreignId = await session(foreignProjectId)
    const foreignBefore = await familySnapshot(foreignId)
    const before = await checkpoint(`mutable-patch-${captured}-before`)
    const partial = { projectId: captured === 'foreign' ? foreignProjectId : projectId, filename: 'captured-input.txt' }
    const pending = store().patch(id, partial).then(() => null, error => error)
    partial.projectId = captured === 'foreign' ? projectId : foreignProjectId
    const outcome = await pending
    const after = await checkpoint(`mutable-patch-${captured}-after`)
    if (captured === 'foreign') {
      expect(outcome).toBeInstanceOf(Error)
      expect(after).toEqual(before)
    } else {
      expect(outcome).toBeNull()
      expect(await db.importSessions.get(id)).toMatchObject({ projectId, filename: 'captured-input.txt' })
      expect(Buffer.from(await (await store().loadBlob(id))!.blob.arrayBuffer())).toEqual(bytes)
    }
    expect(await familySnapshot(foreignId)).toEqual(foreignBefore)
    expect(store().current?.id).toBe(foreignId)
  })

  it('allows a normal patch that explicitly retains the same Session and Project identity', async () => {
    const projectId = await workspace('显式不变身份'), id = await session(projectId)
    await store().patch(id, { id, projectId, filename: 'same-owner-renamed.txt' })
    expect(await store().load(id)).toMatchObject({ id, projectId, filename: 'same-owner-renamed.txt' })
    expect(Buffer.from(await (await store().loadBlob(id))!.blob.arrayBuffer())).toEqual(bytes)
  })

  it('rejects creating a session for an already deleted Project, with zero database writes', async () => {
    const projectId = await workspace('创建父根已删')
    await cascadeDeleteProject(projectId)
    const before = await checkpoint('create-after-project-delete-before')
    const outcome = await store().create(rowData(projectId)).then(() => null, error => error)
    const after = await checkpoint('create-after-project-delete-after')
    expect(outcome).toBeInstanceOf(Error)
    expect(String(outcome)).toMatch(/项目|不存在|已删除/)
    expect(after).toEqual(before)
    expect(store().current).toBeNull()
  })

  it.each(['project', 'session'] as const)('serializes public Blob/log writes queued while %s deletion already holds the native write transaction', async deletion => {
    const projectId = await workspace(`已持锁 ${deletion}`), id = await session(projectId)
    const reached = deferred(), release = deferred()
    const table = deletion === 'project' ? db.projects : db.importSessions
    const remove = table.delete.bind(table)
    vi.spyOn(table, 'delete').mockImplementationOnce(key => remove(key).then(() => {
      reached.resolve()
      return Dexie.waitFor(release.promise)
    }))
    const deleting = deletion === 'project' ? cascadeDeleteProject(projectId) : store().deleteSession(id)
    const deletionResult = deleting.then(() => null, error => error)
    let pending: Promise<{ ok: boolean; error?: unknown }>[] = []
    try {
      await reached.promise
      // A different page/event must not inherit the paused deleter's PSD.
      pending = Dexie.ignoreTransaction(() => {
        expect(Dexie.currentTransaction).toBeFalsy()
        return [lateOperations.saveBlob(id), lateOperations.log(id)].map(write => write.then(() => ({ ok: true }), error => ({ ok: false, error })))
      })
    } finally { release.resolve() }
    const deletionOutcome = await deletionResult
    const results = await Promise.all(pending)
    expect(deletionOutcome).toBeNull()
    expect(results).toHaveLength(2)
    await checkpoint(`native-serialized-${deletion}-after`)
    expect(results.every(result => !result.ok)).toBe(true)
    for (const result of results) expect(String(result.error)).toMatch(/会话|项目|已删除|不存在/)
    await assertNoChildren(id)
  })
})

describe('SFQA013 failures are atomic and observable', () => {
  it('rolls back Project/root/log/source deletion on a final root failure', async () => {
    const projectId = await workspace('项目回滚'), id = await session(projectId)
    const before = await checkpoint('project-rollback-before')
    vi.spyOn(db.projects, 'delete').mockRejectedValueOnce(new Error('synthetic final Project delete failure'))
    await expect(cascadeDeleteProject(projectId)).rejects.toThrow('synthetic final Project delete failure')
    expect(await checkpoint('project-rollback-after')).toEqual(before)
    expect((await store().loadBlob(id))?.fileHash).toBe(fileHash)
  })

  it('rolls back Session/log/source abandonment when physical source deletion fails and exposes that failure', async () => {
    const projectId = await workspace('会话回滚'), id = await session(projectId)
    const before = await checkpoint('session-rollback-before')
    vi.spyOn(db.importFiles, 'delete').mockRejectedValueOnce(new Error('synthetic source delete failure'))
    const outcome = await store().deleteSession(id).then(() => null, error => error)
    const after = await checkpoint('session-rollback-after')
    expect(String(outcome)).toContain('synthetic source delete failure')
    expect(after).toEqual(before)
    expect(store().current?.id).toBe(id)
  })

  it('does not hide explicit source cleanup failures or falsely report deletion', async () => {
    const projectId = await workspace('原文清理错误'), id = await session(projectId)
    const before = await familySnapshot(id)
    vi.spyOn(db.importFiles, 'delete').mockRejectedValueOnce(new Error('synthetic deleteBlob failure'))
    await expect(store().deleteBlob(id)).rejects.toThrow('synthetic deleteBlob failure')
    expect(await familySnapshot(id)).toEqual(before)
  })

  it('keeps the previous raw bytes and Session on a rejected source replacement', async () => {
    const projectId = await workspace('存盘失败保留原文'), id = await session(projectId, 'paused')
    const before = await familySnapshot(id)
    vi.spyOn(db.importFiles, 'put').mockRejectedValueOnce(new Error('synthetic source put failure'))
    await expect(store().saveBlob(id, 'replacement.txt', sourceBlob(), 'replacement')).rejects.toThrow('synthetic source put failure')
    expect(await familySnapshot(id)).toEqual(before)
  })
})
