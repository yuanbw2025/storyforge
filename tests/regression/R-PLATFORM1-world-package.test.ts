import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { db } from '../../src/lib/db/schema'
import {
  createWorldPackage,
  importWorldPackage,
  inspectWorldPackage,
  WORLD_PACKAGE_V1_REQUIRED_TABLES,
} from '../../src/lib/product/world-package'

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort()
    .map(key => [key, canonicalize((value as Record<string, unknown>)[key])]))
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

describe('PLATFORM-1 · 本地世界发布包', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  async function seedProject() {
    const now = Date.now()
    const projectId = await db.projects.add({
      name: '潮汐之后', genre: 'kehuan', genres: ['kehuan'], description: '海平面吞没大陆后的漂浮聚落。',
      status: 'ongoing', targetWordCount: 500000, currentWordCount: 1200, enableMultiWorld: true,
      worldCode: 'W-TIDE-0001', worldVersion: 3, createdAt: now, updatedAt: now,
    } as any) as number
    const groupId = await db.worldGroups.add({ projectId, name: '主世界', slug: 'main', order: 0, createdAt: now, updatedAt: now } as any) as number
    await db.worldviews.add({ projectId, worldGroupId: groupId, worldOrigin: '退潮后海床城市升起。', createdAt: now, updatedAt: now } as any)
    await db.characters.add({ projectId, homeWorldGroupId: groupId, name: '守灯人', role: 'protagonist', description: '看守潮汐灯塔。', createdAt: now, updatedAt: now } as any)
    const volumeId = await db.outlineNodes.add({ projectId, parentId: null, type: 'volume', title: '不应被分享的正文结构', summary: '', order: 0, createdAt: now, updatedAt: now } as any) as number
    await db.chapters.add({ projectId, outlineNodeId: volumeId, title: '不应导出的章节', content: '<p>作者私稿</p>', wordCount: 5, status: 'draft', order: 0, createdAt: now, updatedAt: now } as any)
    return projectId
  }

  it('只发布注册表明确允许的世界表，并保留用途、许可与完整性', async () => {
    const projectId = await seedProject()
    const pkg = await createWorldPackage(projectId, {
      authorName: '林岚', license: 'CC-BY-4.0',
      allowedUses: { writing: true, ttrpg: true, characterChat: false, textGame: false },
      contentWarnings: ['灾难'],
    })
    const report = await inspectWorldPackage(pkg)

    expect(report.valid).toBe(true)
    expect(pkg.manifest.packageId).toBe('W-TIDE-0001@v3')
    expect(pkg.manifest.allowedUses.characterChat).toBe(false)
    expect((pkg.portableProject as any).characters).toHaveLength(1)
    expect((pkg.portableProject as any).chapters).toBeUndefined()
    expect((pkg.portableProject as any).nodeFlows).toBeUndefined()
  })

  it('篡改发布信息或混入私有正文时拒绝导入', async () => {
    const projectId = await seedProject()
    const pkg = await createWorldPackage(projectId, {
      authorName: '匿名', license: 'ALL-RIGHTS-RESERVED',
      allowedUses: { writing: true, ttrpg: false, characterChat: false, textGame: false },
    })
    const tampered = JSON.parse(JSON.stringify(pkg))
    tampered.manifest.description = '被替换的描述'
    const tamperedReport = await inspectWorldPackage(tampered)
    expect(tamperedReport.valid).toBe(false)
    expect(tamperedReport.errors.join('；')).toContain('完整性校验失败')

    const leaked = JSON.parse(JSON.stringify(pkg))
    leaked.portableProject.chapters = [{ title: '私稿' }]
    const leakedReport = await inspectWorldPackage(leaked)
    expect(leakedReport.valid).toBe(false)
    expect(leakedReport.errors.join('；')).toContain('私有表「chapters」')
    await expect(importWorldPackage(leaked)).rejects.toThrow('世界分享包预检失败')
    expect(await db.projects.count()).toBe(1)
  })

  it('导入为新本地编号并保存来源，不覆盖原项目或私有正文', async () => {
    const projectId = await seedProject()
    const pkg = await createWorldPackage(projectId, {
      authorName: '林岚', license: 'CC-BY-SA-4.0',
      allowedUses: { writing: true, ttrpg: true, characterChat: true, textGame: true },
    })
    const importedId = await importWorldPackage(pkg)
    const imported = await db.projects.get(importedId)

    expect(importedId).not.toBe(projectId)
    expect(imported?.worldCode).toMatch(/^W-[A-Z0-9]{5}-[A-Z0-9]{4}$/)
    expect(imported?.worldCode).not.toBe('W-TIDE-0001')
    expect(imported?.communityOrigin?.sourceWorldCode).toBe('W-TIDE-0001')
    expect(imported?.communityOrigin?.license).toBe('CC-BY-SA-4.0')
    expect(await db.worldviews.where('projectId').equals(importedId).count()).toBe(1)
    expect(await db.characters.where('projectId').equals(importedId).count()).toBe(1)
    expect(await db.chapters.where('projectId').equals(importedId).count()).toBe(0)
    expect((await db.projects.get(projectId))?.worldCode).toBe('W-TIDE-0001')
  })

  it('WORLD-2 后仍可预检并导入不含新根表和新发布表的历史 v1 包', async () => {
    const legacyBackup = JSON.parse(readFileSync(
      path.resolve(__dirname, '../fixtures/legacy-export-v3.json'),
      'utf8',
    )) as Record<string, unknown>
    const portableProject = Object.fromEntries([
      ['version', legacyBackup.version],
      ['exportedAt', legacyBackup.exportedAt],
      ['project', legacyBackup.project],
      ...WORLD_PACKAGE_V1_REQUIRED_TABLES.map(table => [table, legacyBackup[table] ?? []]),
    ])
    const manifest = {
      packageId: 'W-LEGACY-0001@v1',
      sourceWorldCode: 'W-LEGACY-0001',
      sourceWorldVersion: 1,
      name: '历史 v1 世界',
      description: 'WORLD-2 之前导出的世界包',
      authorName: '历史作者',
      attribution: '历史作者 · 历史 v1 世界',
      license: 'CC-BY-4.0',
      allowedUses: { writing: true, ttrpg: true, characterChat: false, textGame: false },
      contentWarnings: [],
      publishedAt: 1,
    }
    const payload = {
      format: 'storyforge.world-package',
      packageVersion: 1,
      manifest,
      portableProject,
    }
    const pkg = {
      ...payload,
      integrity: { algorithm: 'SHA-256', digest: await digest(payload) },
    }

    const report = await inspectWorldPackage(pkg)
    expect(report.valid, report.errors.join('；')).toBe(true)
    const importedId = await importWorldPackage(pkg)
    expect(await db.projects.get(importedId)).toMatchObject({
      name: '全量作品（导入）',
      worldVersion: 1,
      communityOrigin: { sourceWorldCode: 'W-LEGACY-0001' },
    })
    expect(await db.worldviews.where('projectId').equals(importedId).count()).toBe(2)
  })
})
