import { describe, it, expect } from 'vitest'
import { buildCharacterContext } from '../../src/lib/ai/context-builder'
import { CHARACTER_DIMENSIONS } from '../../src/lib/character/character-dimensions'
import type { Character } from '../../src/lib/types'

function core(over: Partial<Character>): Character {
  const now = Date.now()
  return {
    projectId: 1, name: '林默', roleWeight: 'main',
    moralAxis: 'neutral', orderAxis: 'lawful',
    shortDescription: '', appearance: '', personality: '', background: '',
    motivation: '', abilities: '', relationships: '', arc: '',
    createdAt: now, updatedAt: now, ...over,
  }
}

/** C4 守卫：核心角色的新维度必须进入生成上下文（否则 AI 写正文看不到设计的维度）。 */
describe('R-C4-context-injection', () => {
  it('核心角色的 A 扩充维度(价值观/恐惧/目标…)注入生成上下文', () => {
    const ctx = buildCharacterContext([core({
      values: '万物有痕', fears: '怕遗忘', goals: '重开分号', identity: '档案修复师',
    })])
    expect(ctx).toContain('万物有痕')
    expect(ctx).toContain('怕遗忘')
    expect(ctx).toContain('重开分号')
    expect(ctx).toContain('档案修复师')
  })

  it('核心角色区块从 CHARACTER_DIMENSIONS 派生——每个已填维度都带标签注入', () => {
    // 给每个维度填一个唯一值，断言全部出现在上下文（不再有硬编码漏字段）
    const filled: Partial<Character> = {}
    for (const d of CHARACTER_DIMENSIONS) (filled as Record<string, string>)[d.key] = `__${d.key}__`
    const ctx = buildCharacterContext([core(filled)])
    for (const d of CHARACTER_DIMENSIONS) expect(ctx).toContain(`__${d.key}__`)
  })

  it('relationships(非维度)仍注入，不被遗漏', () => {
    const ctx = buildCharacterContext([core({ relationships: '与主角是师徒' })])
    expect(ctx).toContain('与主角是师徒')
  })
})
