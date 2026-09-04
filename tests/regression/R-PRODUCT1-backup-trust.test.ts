import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { inspectProjectBackup } from '../../src/lib/export/backup-trust'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'

describe('PRODUCT-1 · 备份可信预检', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('当前导出包含注册表登记的完整表集合，并给出可恢复摘要', async () => {
    const created = await createWorkspace({
      name: '可信备份项目', genres: ['fantasy'], status: 'drafting', description: '',
      targetWordCount: 1000,
    }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const backup = await exportProjectJSON(created.scope.projectId)
    const report = inspectProjectBackup(backup)
    const exportable = PROJECT_TABLES
      .filter(spec => spec.exportable && spec.name !== 'projects')
      .map(spec => spec.name)

    expect(report.valid).toBe(true)
    expect(report.projectName).toBe('可信备份项目')
    expect(report.recordCount).toBe(2)
    expect(report.missingTables).toEqual([])
    expect(exportable.every(name => name in backup)).toBe(true)
  })

  it('错误根结构或错误表类型会在写库前被拒绝', async () => {
    const before = await db.projects.count()
    const malformed = {
      version: 3,
      exportedAt: Date.now(),
      project: { name: '坏备份' },
      chapters: '不是数组',
    }
    const report = inspectProjectBackup(malformed)
    expect(report.valid).toBe(false)
    expect(report.errors.join('；')).toContain('chapters')
    await expect(importProjectJSON(malformed as any)).rejects.toThrow('备份预检失败')
    expect(await db.projects.count()).toBe(before)
  })

  it('非当前版本和缺表备份被明确拒绝', () => {
    const report = inspectProjectBackup({
      version: 2,
      exportedAt: Date.now(),
      project: { name: '非当前备份' },
      worldviews: [],
      storyCores: [],
    })
    expect(report.valid).toBe(false)
    expect(report.missingTables.length).toBeGreaterThan(0)
    expect(report.errors.join('；')).toContain('只接受当前备份版本')
  })

  it('旧 Project 作品镜像字段在写库前被拒绝，不能借导入复活', async () => {
    const created = await createWorkspace({
      name: '当前字段项目', genres: ['fantasy'], status: 'drafting', description: '作品简介',
      targetWordCount: 1000,
    }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const backup = structuredClone(await exportProjectJSON(created.scope.projectId))
    ;(backup.project as Record<string, unknown>).description = '旧 Project 镜像'
    ;(backup.project as Record<string, unknown>).currentWordCount = 99

    const before = await db.projects.count()
    const report = inspectProjectBackup(backup)
    expect(report.valid).toBe(false)
    expect(report.errors.join('；')).toContain('工作区根 project 含非当前字段：description、currentWordCount')
    await expect(importProjectJSON(backup)).rejects.toThrow('备份预检失败')
    expect(await db.projects.count()).toBe(before)
  })

  it('Work 缺少当前必需字段时在写库前被拒绝', async () => {
    const created = await createWorkspace({
      name: '完整作品', genres: ['fantasy'], status: 'drafting', description: '',
      targetWordCount: 1000,
    }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const backup = structuredClone(await exportProjectJSON(created.scope.projectId))
    delete (backup.works[0] as Record<string, unknown>).includeCultivationProgressInAI

    const before = await db.projects.count()
    const report = inspectProjectBackup(backup)
    expect(report.valid).toBe(false)
    expect(report.errors.join('；')).toContain('works[0] 缺少当前必需字段：includeCultivationProgressInAI')
    await expect(importProjectJSON(backup)).rejects.toThrow('备份预检失败')
    expect(await db.projects.count()).toBe(before)
  })

  it('World 根只接受当前精确字段和与身份匹配的稳定编号', async () => {
    const created = await createWorkspace({
      name: '当前世界根', genres: ['fantasy'], status: 'drafting', description: '',
      targetWordCount: 1000,
    }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
    const withUnknownField = structuredClone(await exportProjectJSON(created.scope.projectId))
    ;(withUnknownField.worlds[0] as Record<string, unknown>).legacyWorldType = 'single'
    expect(inspectProjectBackup(withUnknownField).errors.join('；'))
      .toContain('worlds[0] 含非当前字段：legacyWorldType')
    await expect(importProjectJSON(withUnknownField)).rejects.toThrow('备份预检失败')

    const withInvalidCode = structuredClone(await exportProjectJSON(created.scope.projectId))
    withInvalidCode.worlds[0].code = 'WORLD-OLD'
    expect(inspectProjectBackup(withInvalidCode).errors.join('；'))
      .toContain('世界身份或稳定编号无效')
    await expect(importProjectJSON(withInvalidCode)).rejects.toThrow('备份预检失败')
  })
})
