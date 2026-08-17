import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CreativeReliabilityCommunityPanel from '../../src/components/settings/CreativeReliabilityCommunityPanel'
import SettingsPage from '../../src/components/settings/SettingsPage'
import { loadCreativeReliabilityFeedbackV1 } from '../../src/lib/feedback/creative-reliability'

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

describe('R-CREL14 · 正式设置页社区反馈入口', () => {
  it('设置页直接挂载入口，并诚实展示实验边界、费用、回滚和隐私说明', async () => {
    const host = await mount(createElement(SettingsPage))
    expect(host.querySelector('[data-testid="creative-reliability-community"]')).not.toBeNull()
    expect(host.textContent).toContain('实验性社区观察期')
    expect(host.textContent).toContain('不代表已经证明“替作者完成 80%”')
    expect(host.textContent).toContain('不再作为本轮开发阻塞项')
    expect(host.textContent).toContain('历史结果没有因此变成通过')
    expect(host.textContent).toContain('1 次生成 + 1 次定向修复')
    expect(host.textContent).toContain('费用由你的服务商和模型决定')
    expect(host.textContent).toContain('启用创作可靠性工程')
    expect(host.textContent).toContain('不会自动上传')
    expect(host.querySelector<HTMLAnchorElement>('a[href="https://github.com/yuanbw2025/storyforge/issues/new"]')?.rel)
      .toContain('noreferrer')
  })

  it('保存、导出和清空都只操作本机结构化反馈，不触发 AI', async () => {
    let downloadedBlob: Blob | null = null
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn((blob: Blob) => {
        downloadedBlob = blob
        return 'blob:creative-feedback'
      }),
      revokeObjectURL: vi.fn(),
    })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const host = await mount(createElement(CreativeReliabilityCommunityPanel))
    const stalled = host.querySelector<HTMLInputElement>('input[aria-label="创作反馈问题 剧情不推进"]')!
    await act(async () => stalled.click())
    const save = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('记下这次体验'))!
    await act(async () => save.click())

    expect(loadCreativeReliabilityFeedbackV1()).toHaveLength(1)
    expect(loadCreativeReliabilityFeedbackV1()[0]).toMatchObject({
      stage: 'story-arc',
      outcome: 'edited',
      rating: 3,
      editMinutes: 15,
      tags: ['stalled'],
    })
    expect(host.textContent).toContain('没有调用 AI，也没有上传')

    const exportButton = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('导出反馈 JSON'))!
    await act(async () => exportButton.click())
    expect(downloadedBlob).not.toBeNull()
    expect(downloadedBlob!.type).toBe('application/json;charset=utf-8')
    const exported = await downloadedBlob!.text()
    expect(exported).toContain('"includesManuscript": false')
    expect(exported).toContain('"automaticallyUploaded": false')

    const clear = Array.from(host.querySelectorAll('button'))
      .find(button => button.textContent?.includes('清空本机记录'))!
    await act(async () => clear.click())
    expect(dialogMocks.confirm).toHaveBeenCalledOnce()
    expect(loadCreativeReliabilityFeedbackV1()).toEqual([])
    expect(host.textContent).toContain('本机反馈记录已清空')
  })
})
