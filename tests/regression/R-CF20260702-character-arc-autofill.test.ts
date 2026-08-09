import { describe, expect, it } from 'vitest'
import { applyCharacterArcAutoFill } from '../../src/components/outline/CharacterDrivenPlotPanel'
import type { CharacterDrivenPlanArc as CharacterArcInput } from '../../src/lib/types'

function arc(overrides: Partial<CharacterArcInput> = {}): CharacterArcInput {
  return {
    characterId: 1,
    name: '测试角色',
    role: '主角',
    initialState: '',
    targetState: '',
    ...overrides,
  }
}

describe('CF-20260702-1 · 角色弧光自动填充不截断', () => {
  it('完整填入角色背景和弧光，不再截断到 200 字', () => {
    const background = `起点:${'身世与处境。'.repeat(80)}末尾关键句`
    const characterArc = `终点:${'成长目标。'.repeat(80)}结局关键句`

    const filled = applyCharacterArcAutoFill(arc(), {
      background,
      arc: characterArc,
    })

    expect(filled.initialState).toBe(background)
    expect(filled.targetState).toBe(characterArc)
    expect(filled.initialState).toContain('末尾关键句')
    expect(filled.targetState).toContain('结局关键句')
  })

  it('已有手写内容时不静默覆盖', () => {
    const filled = applyCharacterArcAutoFill(
      arc({ initialState: '用户手写起点', targetState: '用户手写终点' }),
      { background: '角色卡背景', arc: '角色卡弧光' },
    )

    expect(filled.initialState).toBe('用户手写起点')
    expect(filled.targetState).toBe('用户手写终点')
  })
})
