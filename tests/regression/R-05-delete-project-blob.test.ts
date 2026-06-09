/**
 * R-05: deleteProject 漏间接归属表 + master blob 残留
 *
 * 对应 MASTER-BLUEPRINT §4.0.6 / GPT-5.5 + Gemini-3.1 双重审查发现的 P0-6
 *
 * 反例:
 *   旧 deleteProject 只删带 projectId 字段的表;
 *   importLogs/importFiles 通过 sessionId 间接挂项目 → 删项目后 blob 永久残留;
 *   master 作品原文 blob 复用 importFiles 表(虚拟 sessionId = 100000+workId)
 *     直接 delete masterWorks 绕过 deleteWork → master blob 也残留;
 *   importJobs 虽有 projectId 但旧代码也漏删。
 *
 * 灾难:用户导入 10MB 小说 blob 后删项目 → blob 永久残留 → IndexedDB 配额爆
 *      → 应用无法保存新数据 → 写到一半的章节存不进去 → 白屏。
 *
 * 期望:删项目后,以下表中无任何残留:
 *   ① importSessions ② importLogs ③ importFiles(含 master blob) ④ importJobs
 *   ⑤ masterWorks ⑥ masterChunkAnalysis ⑦ masterChapterBeats ⑧ masterStyleMetrics
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useProjectStore } from '../../src/stores/project'

// 与 src/lib/master-study/pipeline.ts 中的 BLOB_ID_OFFSET 保持一致
const MASTER_BLOB_OFFSET = 100000

describe('R-05: deleteProject 漏间接归属表 + master blob 残留', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(async () => {
    db.close()
  })

  it('删项目后,所有间接归属表 + master blob 无残留', async () => {
    const now = Date.now()

    // 建项目
    const projectId = await db.projects.add({
      name: 'R-05 测试项目',
      genre: 'fantasy',
      description: '',
      targetWordCount: 0,
      enableMultiWorld: false,
      createdAt: now,
      updatedAt: now,
    } as any) as number

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

    // ─── 准备:master 作品 + blob(复用 importFiles 表) ────
    const workId = await db.masterWorks.add({
      projectId, name: '名著样本', author: '某大师', genre: 'fantasy',
      filename: 'masterpiece.txt', fileSize: 5000, fileHash: 'm1',
      analysisDepth: 'standard', analysisStatus: 'done',
      analysisProgress: 100, totalChunks: 1,
      createdAt: now, updatedAt: now,
    } as any) as number

    // master blob:虚拟 sessionId = 100000 + workId
    await db.importFiles.put({
      sessionId: MASTER_BLOB_OFFSET + workId,
      filename: 'masterpiece.txt',
      blob: new Blob(['1000000 字小说原文(模拟)']),
      fileHash: 'm1',
      createdAt: now,
    } as any)

    // master 作品的分析数据(应被现有逻辑级联删除,这里加进来一并验证)
    await db.masterChunkAnalysis.add({
      workId, chunkIndex: 0, status: 'done',
      narrative: '', character: '', world: '', theme: '', language: '',
      createdAt: now,
    } as any)
    await db.masterChapterBeats.add({
      workId, chapterIndex: 0, beats: [] as any,
      createdAt: now,
    } as any)

    // ─── 验证:删项目前,数据齐全 ────────────────────────
    expect(await db.importSessions.where('projectId').equals(projectId).count()).toBe(1)
    expect(await db.importLogs.where('sessionId').equals(sessionId).count()).toBe(2)
    expect(await db.importFiles.count()).toBe(2)  // 普通 + master blob
    expect(await db.importJobs.where('projectId').equals(projectId).count()).toBe(1)
    expect(await db.masterWorks.where('projectId').equals(projectId).count()).toBe(1)
    expect(await db.masterChunkAnalysis.where('workId').equals(workId).count()).toBe(1)

    // ─── 执行:删项目 ───────────────────────────────────
    await useProjectStore.getState().deleteProject(projectId)

    // ─── 断言:所有间接归属表 + master blob 无残留 ────────
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
      'importFiles 应被清空(含普通 sessionId 与 master blob 虚拟 sessionId)',
    ).toBe(0)

    expect(
      await db.importJobs.where('projectId').equals(projectId).count(),
      'importJobs 应被清空(直接 projectId)',
    ).toBe(0)

    expect(
      await db.masterWorks.where('projectId').equals(projectId).count(),
      'masterWorks 应被清空',
    ).toBe(0)

    expect(
      await db.masterChunkAnalysis.where('workId').equals(workId).count(),
      'masterChunkAnalysis 应被清空(workId 间接归属)',
    ).toBe(0)

    expect(
      await db.masterChapterBeats.where('workId').equals(workId).count(),
      'masterChapterBeats 应被清空',
    ).toBe(0)
  })

  it('删项目后,其它项目的 importFiles blob 不受影响', async () => {
    const now = Date.now()

    // 建两个项目
    const projectA = await db.projects.add({
      name: 'A', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number

    const projectB = await db.projects.add({
      name: 'B', genre: '', description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: now, updatedAt: now,
    } as any) as number

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
