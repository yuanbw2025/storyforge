import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import TextOpenWorldEndingPanel from '../../src/components/text-game/TextOpenWorldEndingPanel'
import type { TextOpenWorldPlayerEndingProjectionV1 } from '../../src/lib/open-world/player-ending'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const STATISTICS = {
  level: 5,
  completedQuestCount: 17,
  earnedAchievementCount: 4,
  worldDay: 12,
  timePeriodLabel: '夜晚',
  worldTimeLabel: '第 12 天 · 夜晚',
} as const

function completedProjection(
  phase: 'settling' | 'completed' = 'completed',
): TextOpenWorldPlayerEndingProjectionV1 {
  return {
    version: 1,
    phase,
    ending: { title: '共管盐渠', summary: '两地最终决定共同维护盐渠。' },
    timelineSaved: true,
    statistics: STATISTICS,
  }
}

describe('TextOpenWorldEndingPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(projection: TextOpenWorldPlayerEndingProjectionV1): HTMLElement {
    act(() => root.render(<TextOpenWorldEndingPanel projection={projection} />))
    return container.querySelector<HTMLElement>('[data-testid="text-open-world-ending-panel"]')!
  }

  it('in-progress使用独立、非结局语义且不虚称时间线已完成保存', () => {
    const panel = render({
      version: 1,
      phase: 'in-progress',
      ending: null,
      timelineSaved: false,
      statistics: STATISTICS,
    })

    expect(panel.dataset.endingPhase).toBe('in-progress')
    expect(panel.textContent).toContain('旅程仍在继续')
    expect(panel.textContent).toContain('尚未抵达结局')
    expect(panel.textContent).not.toContain('时间线已保存')
    const heading = panel.querySelector('h2')!
    expect(panel.getAttribute('aria-labelledby')).toBe(heading.id)
  })

  it('settling展示冻结结局、已保存状态和礼貌播报', () => {
    const panel = render(completedProjection('settling'))

    expect(panel.dataset.endingPhase).toBe('settling')
    expect(panel.textContent).toContain('结局正在收束')
    expect(panel.textContent).toContain('共管盐渠')
    expect(panel.textContent).toContain('两地最终决定共同维护盐渠。')
    const status = panel.querySelector<HTMLElement>('[role="status"]')!
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.textContent).toContain('结局已写入时间线并保存')
  })

  it('completed展示完成统计、可读记录和其它结局存档路径，不泄露内部标识', () => {
    const panel = render(completedProjection())
    const text = panel.textContent ?? ''

    expect(panel.dataset.endingPhase).toBe('completed')
    expect(text).toContain('旅程完成')
    expect(text).toContain('时间线已保存')
    expect(text).toContain('完成统计')
    expect(text).toContain('等级5')
    expect(text).toContain('完成任务17')
    expect(text).toContain('已获成就4')
    expect(text).toContain('第 12 天 · 夜晚')
    expect(text).toContain('任务日志、角色、世界记录和存档仍可阅读')
    expect(text).toContain('终局前的存档')
    expect(text).toContain('其他结局')
    expect(text).not.toContain('ending.cooperate')
    expect(text).not.toMatch(/[a-f0-9]{64}/)

    const heading = panel.querySelector('h2')!
    const summary = panel.querySelector<HTMLElement>('header p[id]')!
    expect(panel.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(panel.getAttribute('aria-describedby')).toBe(summary.id)
    expect(panel.querySelector('aside')?.getAttribute('aria-label')).toBe('结局后的可用内容')
  })
})
