/**
 * R-downstream-reverse · 下游内容反向喂给上游生成
 *
 * 需求:用户先填了下游内容(角色/故事/故事线),再生成世界观等上游内容时,
 * AI 应读到这些下游内容并据此"反推"出一致的世界设定。
 *
 * 修复前:世界观生成只 need 了 storyCore,漏了 characters(虽然 characters 早是
 * 已登记的 CONTEXT_SOURCE)。本测试锁定:用下游反推的 sourceKeys 能召回角色,
 * 且因 characters 是世界级源,必须传 worldGroupId 才会被纳入。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'

const REVERSE_KEYS = ['storyCore', 'characters', 'storyArcs'] as const

async function seedProjectWithCharacter(): Promise<number> {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: 'Reverse', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  await db.storyCores.add({
    projectId, logline: '一个少年逆袭', theme: '成长', centralConflict: '宿命对抗',
    createdAt: now, updatedAt: now,
  } as any)
  await db.characters.add({
    projectId, name: '林惊羽', role: 'protagonist', shortDescription: '天才剑修',
    personality: '坚毅', background: '灭门遗孤', motivation: '复仇', createdAt: now, updatedAt: now,
  } as any)
  return projectId
}

describe('R-downstream-reverse · 下游反推上游', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('传 worldGroupId 时:下游反推上下文能召回角色 + 故事核心', async () => {
    const projectId = await seedProjectWithCharacter()
    const r = await assembleContext({ projectId, worldGroupId: null, sourceKeys: REVERSE_KEYS as unknown as string[] })
    expect(r.included).toContain('characters')
    expect(r.text).toContain('林惊羽')     // 角色被反推时可见
    expect(r.text).toContain('逆袭')        // 故事核心也在
  })

  it('不传 worldGroupId 时:角色源因世界级要求被省略(说明必须传)', async () => {
    const projectId = await seedProjectWithCharacter()
    const r = await assembleContext({ projectId, sourceKeys: REVERSE_KEYS as unknown as string[] })
    expect(r.omitted).toContain('characters')
    expect(r.included).not.toContain('characters')
  })
})
