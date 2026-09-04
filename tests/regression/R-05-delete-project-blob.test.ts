/**
 * R-05: deleteProject 间接归属表 + blob 生命周期
 *
 * R-05：删除项目与 blob 回收反例。
 *
 * 当前契约:删项目后,以下表中无任何残留:
 *   ① importSessions ② importLogs ③ importFiles ④ importJobs
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useProjectStore } from '../../src/stores/project'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

describe('R-05: deleteProject 间接归属表 + blob 生命周期', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('删项目后,所有间接归属表 + blob 无残留', async () => {
    const now = Date.now()

    const projectId = (await seedCurrentWorkspace('R-05 测试项目', { targetWordCount: 0 })).scope.projectId

    // ─── 准备:导入流水线产生的 4 类记录 ─────────────────────
    // (a) importSessions(直接 projectId)
    const sessionId = await db.importSessions.add({
      projectId, type: 'character', status: 'done',
      filename: 'test.txt', fileSize: 100, fileHash: 'h1',
      totalChunks: 1, completedChunks: 1, parsedSummary: {} as any,
      createdAt: now, updatedAt: now,
    } as any) as number

    // (b) importLogs(通过 sessionId 间接挂)
    await db.importLogs.add({
      sessionId, level: 'info', message: '导入开始',
      timestamp: now,
    } as any)
    await db.importLogs.add({
      sessionId, level: 'info', message: '导入完成',
      timestamp: now,
    } as any)

    // (c) importFiles(主键=sessionId,通过 sessionId 间接挂)
    await db.importFiles.put({
      sessionId, filename: 'test.txt',
      blob: new Blob(['hello']), fileHash: 'h1',
      createdAt: now,
    } as any)

    // (d) importJobs(直接 projectId)
    await db.importJobs.add({
      projectId, type: 'character', status: 'completed',
      sessionId, createdAt: now,
    } as any)

    // ─── 验证:删项目前,数据齐全 ────────────────────────
    expect(await db.importSessions.where('projectId').equals(projectId).count()).toBe(1)
    expect(await db.importLogs.where('sessionId').equals(sessionId).count()).toBe(2)
    expect(await db.importFiles.count()).toBe(1)
    expect(await db.importJobs.where('projectId').equals(projectId).count()).toBe(1)

    // ─── 执行:删项目 ───────────────────────────────────
    await useProjectStore.getState().deleteProject(projectId)

    // ─── 断言:所有间接归属表 + blob 无残留 ────────
    expect(
      await db.importSessions.where('projectId').equals(projectId).count(),
      'importSessions 应被清空',
    ).toBe(0)

    expect(
      await db.importLogs.where('sessionId').equals(sessionId).count(),
      'importLogs 应被清空(通过 sessionId 间接归属)',
    ).toBe(0)

    expect(
      await db.importFiles.count(),
      'importFiles 应被清空(通过 sessionId 间接归属)',
    ).toBe(0)

    expect(
      await db.importJobs.where('projectId').equals(projectId).count(),
      'importJobs 应被清空(直接 projectId)',
    ).toBe(0)
  })

  it('删项目后,其它项目的 importFiles blob 不受影响', async () => {
    const now = Date.now()

    const projectA = (await seedCurrentWorkspace('A', { genres: [], targetWordCount: 0 })).scope.projectId
    const projectB = (await seedCurrentWorkspace('B', { genres: [], targetWordCount: 0 })).scope.projectId

    // 各自有一个 importSession + importFile
    const sessionA = await db.importSessions.add({
      projectId: projectA, type: 'character', status: 'done',
      filename: 'a.txt', fileSize: 1, fileHash: 'a', totalChunks: 1,
      completedChunks: 1, parsedSummary: {} as any,
      createdAt: now, updatedAt: now,
    } as any) as number

    const sessionB = await db.importSessions.add({
      projectId: projectB, type: 'character', status: 'done',
      filename: 'b.txt', fileSize: 1, fileHash: 'b', totalChunks: 1,
      completedChunks: 1, parsedSummary: {} as any,
      createdAt: now, updatedAt: now,
    } as any) as number

    await db.importFiles.put({
      sessionId: sessionA, filename: 'a.txt', blob: new Blob(['a']),
      fileHash: 'a', createdAt: now,
    } as any)
    await db.importFiles.put({
      sessionId: sessionB, filename: 'b.txt', blob: new Blob(['b']),
      fileHash: 'b', createdAt: now,
    } as any)

    // 删项目 A
    await useProjectStore.getState().deleteProject(projectA)

    // 断言:A 的 blob 没了,B 的 blob 还在
    expect(await db.importFiles.get(sessionA), 'A 的 blob 应被删').toBeUndefined()
    expect(await db.importFiles.get(sessionB), 'B 的 blob 应保留').toBeDefined()
    expect(await db.projects.get(projectB), 'B 项目本身应保留').toBeDefined()
  })
})
