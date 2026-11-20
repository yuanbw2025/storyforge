import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Project } from '../../src/lib/types'
const mocks = vi.hoisted(() => ({ assemble: vi.fn(), start: vi.fn() }))
vi.mock('../../src/lib/registry/assemble-context', () => ({ assembleContext: mocks.assemble }))
vi.mock('../../src/hooks/useAIStream', () => ({ useAIStream: () => ({ start: mocks.start, stop: vi.fn(), output: '', isStreaming: false, error: null }) }))
vi.mock('../../src/stores/world-group', () => ({ useWorldGroupStore: (selector: (state: { activeGroupId: null }) => unknown) => selector({ activeGroupId: null }) }))
vi.mock('../../src/components/shared/AutoResizeTextarea', () => ({ default: ({ minRows: _minRows, ...props }: Record<string, unknown>) => createElement('textarea', props) }))
import SceneVerifyPanel from '../../src/components/scene/SceneVerifyPanel'
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
const project = { id: 1, activeWorldId: 11, activeWorkId: 12, enableMultiWorld: false } as Project
const assembled = { text: '【作者本轮提供资料，未核验】兰桥木船摘录', included: ['manualText'], segments: [{ label: '本次作者资料', content: '兰桥木船摘录' }], sourceEvidence: [{ key: 'manualText', delivery: 'full' }] }
function change(element: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
}
async function mount(value = project) { await act(async () => root.render(createElement(SceneVerifyPanel, { project: value }))) }
beforeEach(() => { localStorage.clear(); mocks.start.mockReset(); mocks.assemble.mockReset(); mocks.assemble.mockResolvedValue(assembled); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
describe('研究入口的实际资料状态与作用域', () => {
  it('作者资料经登记manualText读取，固定标注未联网，不提供无操作的采纳', async () => {
    await mount()
    await act(async () => {
      change(host.querySelector('textarea')!, '作者提供的摘录，不知真伪')
      change(host.querySelectorAll('textarea')[1], '船主购买桐油，研究哪些细节待核实')
      const select = host.querySelector('select')!; select.value = 'sources'; select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const button = [...host.querySelectorAll('button')].find(button => button.textContent === '生成研究建议')!
    await act(async () => { button.click(); await Promise.resolve() })
    expect(mocks.assemble).toHaveBeenCalledWith(expect.objectContaining({ scope: { projectId: 1, worldId: 11, workId: 12 }, manualSourceText: expect.stringContaining('作者提供的摘录'), sourceKeys: expect.arrayContaining(['references', 'manualText']) }))
    const messages = mocks.start.mock.calls[0][0] as Array<{ content: string }>
    expect(messages.map(m => m.content).join('\n')).toContain('未执行联网检索')
    expect(messages.map(m => m.content).join('\n')).toContain('审读作者提供资料')
    expect(host.textContent).toContain('本次实际读取：本次作者资料；未联网核验')
    expect(host.querySelectorAll('button').length).toBe(1)
  })
  it('没有新贴原文但实际读到登记参考时，不误报没有资料', async () => {
    mocks.assemble.mockResolvedValue({ ...assembled, included: ['references'], segments: [{ label: '当前作品参考摘要', content: '作者已有参考的摘要，未经核验' }], sourceEvidence: [{ key: 'references', delivery: 'full' }] })
    await mount()
    await act(async () => { change(host.querySelectorAll('textarea')[1], '核对当前作品已有参考的支持范围') })
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '生成研究建议')!.click(); await Promise.resolve() })
    const messages = mocks.start.mock.calls[0][0] as Array<{ content: string }>
    expect(messages.map(m => m.content).join('\n')).toContain('读取了登记参考或作者提供资料')
    expect(messages.map(m => m.content).join('\n')).not.toContain('未读取到可用外部资料')
  })
  it('切换作品后迟到读取不调用模型、不把旧草稿带给新作品', async () => {
    let release!: (value: typeof assembled) => void
    mocks.assemble.mockReturnValue(new Promise(resolve => { release = resolve }))
    await mount()
    await act(async () => { change(host.querySelectorAll('textarea')[1], '旧作品的场景') })
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '生成研究建议')!.click() })
    await mount({ ...project, activeWorkId: 13 })
    await act(async () => { release(assembled); await Promise.resolve() })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(host.querySelectorAll<HTMLTextAreaElement>('textarea')[1].value).toBe('')
  })
  it('资料段被截断时拒绝模型调用并保留输入', async () => {
    mocks.assemble.mockResolvedValue({ ...assembled, sourceEvidence: [{ key: 'manualText', delivery: 'truncated' }] })
    await mount()
    await act(async () => { change(host.querySelector('textarea')!, '作者需要完整审读的资料'); change(host.querySelectorAll('textarea')[1], '研究这个场景') })
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '生成研究建议')!.click(); await Promise.resolve() })
    expect(mocks.start).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('本次资料未完整进入上下文预算')
    expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('作者需要完整审读的资料')
  })
  it('旧项目级草稿保留供作者显式查看，不自动归到当前作品或发送', async () => {
    localStorage.setItem('sf-scene-verify-1', JSON.stringify({ scene: '旧格式未标作品的文字' }))
    await mount()
    expect(host.querySelectorAll<HTMLTextAreaElement>('textarea')[1].value).toBe('')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === '查看旧草稿')!.click() })
    expect(host.querySelector('pre')?.textContent).toContain('旧格式未标作品的文字')
    expect(localStorage.getItem('sf-scene-verify-1')).toContain('旧格式未标作品的文字')
    expect(mocks.start).not.toHaveBeenCalled()
  })

})
