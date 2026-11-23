import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from '../../src/components/settings/SettingsPage'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dialogMocks = vi.hoisted(() => ({
  confirm: vi.fn(async () => true),
}))

vi.mock('../../src/components/shared/Dialog', () => ({
  useDialog: () => dialogMocks,
}))

vi.mock('../../src/components/settings/AIConfigPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'ai-config-placeholder' }),
}))

vi.mock('../../src/components/settings/HarnessEvalPanel', () => ({
  default: () => createElement('div', { 'data-testid': 'harness-eval-placeholder' }),
}))

const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(element: React.ReactNode) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(element))
  return host
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  localStorage.clear()
  dialogMocks.confirm.mockClear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('R-CREL14 · 移除设置页社区体验评分', () => {
  it('普通与开发设置均移除体验评分，保留 Bug 反馈及开发 Harness', async () => {
    const host = await mount(createElement(SettingsPage))
    const internal = await mount(createElement(SettingsPage, { showDeveloperTools: true }))
    expect(host.querySelector('[data-testid="harness-eval-placeholder"]')).toBeNull()
    expect(internal.querySelector('[data-testid="harness-eval-placeholder"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="增强故障诊断"]')).toBeNull()
    expect(host.textContent).not.toContain('附带最近操作轨迹')
    for (const settings of [host, internal]) {
      expect(settings.textContent).toContain('项目存储工作区')
      expect(settings.textContent).toContain('用户协议')
      expect(settings.querySelector('[data-testid="creative-reliability-community"]')).toBeNull()
      expect(settings.textContent).not.toContain('创作可靠性体验反馈')
      expect(settings.textContent).not.toContain('记下这次体验')
      expect(settings.textContent).not.toContain('导出反馈 JSON')
      expect(settings.textContent).toContain('报告 Bug')
      expect(settings.textContent).toContain('功能建议')
      expect(settings.querySelector('[data-testid="ai-config-placeholder"]')).not.toBeNull()
    }
  })

  it('打开设置不读取、改写或清空已留存的反馈与其他本机数据', async () => {
    const legacyKey = 'storyforge:creative-reliability:community-feedback-v1'
    const legacyValue = '{"records":[{"rating":3}]}'
    localStorage.setItem(legacyKey, legacyValue)
    localStorage.setItem('storyforge:unrelated-user-preference', 'preserve')
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem')
    const clear = vi.spyOn(Storage.prototype, 'clear')
    await mount(createElement(SettingsPage))
    expect(getItem.mock.calls.some(([key]) => key === legacyKey)).toBe(false)
    expect(setItem.mock.calls.some(([key]) => key === legacyKey)).toBe(false)
    expect(removeItem).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
    expect(localStorage.getItem(legacyKey)).toBe(legacyValue)
    expect(localStorage.getItem('storyforge:unrelated-user-preference')).toBe('preserve')
    vi.restoreAllMocks()
  })
})
