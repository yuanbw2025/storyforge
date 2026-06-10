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

async function seedWithCodexEntry(): Promise<number> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'CodexB2', genre: '', description: '', targetWordCount: 0,
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
})
