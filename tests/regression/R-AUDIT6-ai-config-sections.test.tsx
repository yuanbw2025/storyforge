import { act, createElement, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AIConfigPresetSection from '../../src/components/settings/AIConfigPresetSection'
import AITaskRoutingSection from '../../src/components/settings/AITaskRoutingSection'
import AIConnectionLogPanel from '../../src/components/settings/AIConnectionLogPanel'
import AIConnectionTestSection from '../../src/components/settings/AIConnectionTestSection'
import ThemeSelector from '../../src/components/settings/ThemeSelector'
import type { AIConfig, AIConfigPreset } from '../../src/lib/types'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const config: AIConfig = {
  provider: 'deepseek',
  apiKey: 'test-key',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1',
  temperature: 0.7,
  maxTokens: 0,
}
const preset: AIConfigPreset = { id: 'writer', name: '写作模型', config }
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []

async function mount(Component: ComponentType<never>, props: Record<string, unknown>) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(createElement(Component, props as never)))
  return host
}

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
})

describe('AUDIT-6 / HEALTH-4 · AI 设置分区', () => {
  it('预设区转发应用、更新、重命名和删除命令', async () => {
    const props = {
      presets: [preset],
      activePresetId: 'writer',
      editingPreset: preset,
      savingPreset: false,
      presetName: '',
      onPresetNameChange: vi.fn(),
      onStartSaving: vi.fn(),
      onCancelSaving: vi.fn(),
      onSavePreset: vi.fn(),
      onApplyPreset: vi.fn(),
      onUpdatePreset: vi.fn(),
      onRenamePreset: vi.fn(),
      onDeletePreset: vi.fn(),
    }
    const host = await mount(AIConfigPresetSection as ComponentType<never>, props)
    const buttons = Array.from(host.querySelectorAll('button'))
    await act(async () => buttons.find(button => button.textContent === '写作模型')!.click())
    await act(async () => buttons.find(button => button.textContent === '保存')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="重命名预设 写作模型"]')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="删除预设 写作模型"]')!.click())
    expect(props.onApplyPreset).toHaveBeenCalledWith('writer')
    expect(props.onUpdatePreset).toHaveBeenCalledWith('writer')
    expect(props.onRenamePreset).toHaveBeenCalledWith('writer', '写作模型')
    expect(props.onDeletePreset).toHaveBeenCalledWith('writer', '写作模型')
  })

  it('任务路由展示四类边界并转发专用预设', async () => {
    const onSetRoute = vi.fn()
    const host = await mount(AITaskRoutingSection as ComponentType<never>, {
      presets: [preset], routes: { creation: 'writer' }, onSetRoute,
    })
    expect(host.querySelectorAll('select')).toHaveLength(4)
    expect(host.textContent).toContain('结构提取')
    const review = host.querySelector<HTMLSelectElement>('select[aria-label="审查校验模型预设"]')!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(review, 'writer')
      review.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(onSetRoute).toHaveBeenCalledWith('review', 'writer')
  })

  it('连接日志保留可读格式并转发清空命令', async () => {
    const onClear = vi.fn()
    const host = await mount(AIConnectionLogPanel as ComponentType<never>, {
      logs: [{ id: '1', timestamp: 1, type: 'test', provider: 'deepseek', url: '/v1', model: 'deepseek-chat', status: 'success', duration: 42 }],
      onClear,
    })
    expect(host.textContent).toContain('deepseek')
    expect(host.textContent).toContain('42ms')
    await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('清空'))!.click())
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('主题区只标记当前主题并转发切换', async () => {
    const onChange = vi.fn()
    const host = await mount(ThemeSelector as ComponentType<never>, { value: 'warm', onChange })
    expect(host.querySelectorAll('button[aria-pressed="true"]')).toHaveLength(1)
    const paper = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('纸与墨'))!
    await act(async () => paper.click())
    expect(onChange).toHaveBeenCalledWith('paper')
  })

  it('连接测试区准确展示忙碌、结果、日志计数和代理提示', async () => {
    const onTest = vi.fn()
    const onToggleLogs = vi.fn()
    const host = await mount(AIConnectionTestSection as ComponentType<never>, {
      testing: false,
      result: { ok: false, message: 'CORS 网络错误', duration: 88 },
      configReady: true,
      provider: 'deepseek',
      logCount: 3,
      showLogs: false,
      isDevelopment: true,
      onTest,
      onToggleLogs,
    })
    expect(host.textContent).toContain('CORS 网络错误')
    expect(host.textContent).toContain('耗时 88ms')
    expect(host.textContent).toContain('日志 (3)')
    expect(host.textContent).toContain('切换到本地代理')
    const buttons = host.querySelectorAll('button')
    await act(async () => buttons[0].click())
    await act(async () => buttons[1].click())
    expect(onTest).toHaveBeenCalledOnce()
    expect(onToggleLogs).toHaveBeenCalledOnce()
  })
})
