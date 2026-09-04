/**
 * 词条化重构 Stage B2 · 词条进 AI 生成上下文
 *
 * 锁定:词条(codex)内容能经 assembleContext 进入 AI 生成上下文 →
 * AI 生成剧情/正文时可调用用户造的素材(矿物/异兽/势力/器物…),剧情走向更多样。
 * (各生成流程——正文/大纲/细纲/场景/角色驱动剧情——均已 need codex;本测试锁住源本身。)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

async function seedWithCodexEntry(): Promise<number> {
  const now = Date.now()
  const projectId = await seedCurrentProject({
    name: 'CodexB2', genres: [], description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  const catId = await db.codexCategories.add({
    projectId, domain: 'natural', parentId: null, name: '矿物灵材', icon: '⛏️',
    builtInKey: 'mineral', fieldSchema: '[]', hidden: false, order: 0, worldGroupId: null,
    createdAt: now, updatedAt: now,
  } as any) as number
  await db.codexEntries.add({
    projectId, categoryId: catId, name: '玄铁精', summary: '极寒之地的玄铁结晶',
    description: '炼制重兵器的上佳材料,触手生寒。', fields: '{}', order: 0, worldGroupId: null,
    createdAt: now, updatedAt: now,
  } as any)
  await finalizeCurrentFixtureV1(projectId)
  return projectId
}

describe('Codex B2 · 词条进生成上下文', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('assembleContext need codex 时,词条内容进入上下文文本', async () => {
    const projectId = await seedWithCodexEntry()
    const r = await assembleContext({ projectId, worldGroupId: null, sourceKeys: ['codex'] })
    expect(r.included).toContain('codex')
    expect(r.text).toContain('玄铁精')        // 词条名进上下文 → AI 可调用
    expect(r.text).toContain('玄铁结晶')
  })

  it('多世界只读取目标世界词条，不把 null 误当成跨世界全局词条', async () => {
    const projectId = await seedWithCodexEntry()
    const category = await db.codexCategories.where('projectId').equals(projectId).first()
    const now = Date.now()
    await db.codexEntries.bulkAdd([
      {
        projectId, categoryId: category!.id!, name: '镜界玄铁', summary: '镜界专属',
        description: '', fields: '{}', order: 1, worldGroupId: 7,
        createdAt: now, updatedAt: now,
      } as any,
      {
        projectId, categoryId: category!.id!, name: '雾界玄铁', summary: '雾界专属',
        description: '', fields: '{}', order: 2, worldGroupId: 8,
        createdAt: now, updatedAt: now,
      } as any,
    ])
    await finalizeCurrentFixtureV1(projectId)

    const mirror = await assembleContext({ projectId, worldGroupId: 7, sourceKeys: ['codex'] })
    expect(mirror.text).toContain('镜界玄铁')
    expect(mirror.text).not.toContain('雾界玄铁')
    expect(mirror.text).not.toContain('玄铁精')

    const singleWorld = await assembleContext({ projectId, worldGroupId: null, sourceKeys: ['codex'] })
    expect(singleWorld.text).toContain('玄铁精')
    expect(singleWorld.text).not.toContain('镜界玄铁')
  })
})
