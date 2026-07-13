import { afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  buildLocalDiagnosticReport,
  recordRuntimeDiagnosticError,
  resetRuntimeDiagnostics,
} from '../../src/lib/diagnostics/local-diagnostic-report'

afterEach(async () => {
  resetRuntimeDiagnostics()
  await db.delete()
})

describe('AUDIT-7 · 本地隐私诊断包', () => {
  it('只导出表数量，不导出项目正文、名称或 API Key', async () => {
    await db.open()
    await db.projects.add({
      name: '绝密书名-SENTINEL',
      apiKey: 'sk-SENTINEL-SECRET',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never)
    await db.chapters.add({
      projectId: 1,
      outlineNodeId: 1,
      content: '绝密正文-SENTINEL',
      order: 0,
      status: 'draft',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never)

    const report = await buildLocalDiagnosticReport()
    const serialized = JSON.stringify(report)

    expect(report.database.tableCounts.projects).toBe(1)
    expect(report.database.tableCounts.chapters).toBe(1)
    expect(serialized).not.toContain('绝密书名-SENTINEL')
    expect(serialized).not.toContain('绝密正文-SENTINEL')
    expect(serialized).not.toContain('sk-SENTINEL-SECRET')
    expect(report.privacy).toEqual({
      includesRecordContents: false,
      includesApiKeys: false,
      includesLocalStorage: false,
      automaticallyUploaded: false,
    })
  })

  it('错误记录排除可能含用户内容的 message，仅保留错误类型与位置', async () => {
    const error = new TypeError('用户正文-SENTINEL')
    error.stack = 'TypeError: 用户正文-SENTINEL\n    at render (app.js:12:3)'
    recordRuntimeDiagnosticError(error, 'react')

    const report = await buildLocalDiagnosticReport()
    const serialized = JSON.stringify(report.recentErrors)

    expect(report.recentErrors[0]).toMatchObject({ source: 'react', name: 'TypeError' })
    expect(report.recentErrors[0].frames).toEqual(['at render (app.js:12:3)'])
    expect(serialized).not.toContain('用户正文-SENTINEL')
  })
})
