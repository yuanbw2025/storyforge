/**
 * R-export-derive-equivalence · 派生导出格式 ≡ 真实旧格式(防漂移)
 *
 * AUDIT-1 切换后,旧手写导出已删,改用一份**真实旧手写版生成的 fixture**
 * (tests/fixtures/legacy-export-v3.json)作对照基准:派生导出当前 seed 项目,逐字段必须
 * 与该旧格式一致(抹平 exportedAt + 旧版冗余的树 parentId 死字段后)。绿 = 导出格式未漂移,
 * 已下载的旧备份 / Gist 云存档继续兼容。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '../../src/lib/db/schema'
import { deriveExportProjectJSON } from '../../src/lib/export/registry-export'
import { seedFullProject } from '../helpers/seed-full-project'

const legacyFixturePath = path.resolve(__dirname, '../fixtures/legacy-export-v3.json')

/**
 * 对齐两处无害的有意差异后比较:
 * 1. exportedAt(Date.now)抹平。
 * 2. 旧手写版 outlineNodes/worldNodes 冗余保留了原始 parentId(db id 死字段,导入侧解构即丢);
 *    派生版干净去除。两者导入结果一致,删掉对齐。
 */
function normalize(data: any) {
  data.exportedAt = 0
  for (const t of ['outlineNodes', 'worldNodes']) {
    for (const row of (data as any)[t] ?? []) delete row.parentId
  }
  for (const row of data.detailedOutlines ?? []) {
    delete row._appearingCharacterIndexes
    delete row._foreshadowIndexes
    delete row._sceneCharacterIndexes
  }
  for (const row of data.creativeRules ?? []) delete row._citedReferenceIndexes
  return data
}

describe('R-export-derive-equivalence · 派生导出 ≡ 真实旧格式 fixture', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('派生导出当前 seed 与旧手写版 fixture 逐字段相等', async () => {
    const legacy = JSON.parse(fs.readFileSync(legacyFixturePath, 'utf8'))
    const { projectId } = await seedFullProject()
    const derived = await deriveExportProjectJSON(projectId)
    expect(normalize(derived)).toEqual(normalize(legacy))
  })
})
