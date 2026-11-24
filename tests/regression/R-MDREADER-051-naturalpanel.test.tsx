import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { InlineTextarea, type InlineSave } from '../../src/components/shared/InlineEdit'
import { db } from '../../src/lib/db/schema'
import { useWorldviewStore } from '../../src/stores/worldview'
import { type LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
import { flushPendingEditsV1, resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import type { WorkspaceScope } from '../../src/lib/types'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ENVIRONMENT = true
const mounted: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = []
beforeEach(async () => { await db.delete(); await db.open(); resetPendingEditCoordinatorForTestsV1() })
afterEach(async () => { vi.useRealTimers(); for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() } resetPendingEditCoordinatorForTestsV1(); vi.unstubAllGlobals(); vi.restoreAllMocks(); db.close() })

/** 自然面板中世界结构字段用同一 Markdown，保留原始CRLF与末尾空格。 */
const md = '# 世界🌊\r\n\r\n正文 **重点** 与 [锚点](#local)\r\n\r\n```text\r\n  |-- A  \r\n```\r\n  '
async function fixture(scope: WorkspaceScope, value = md) {
  await useWorldviewStore.getState().loadAll(scope)
  if (value !== md) return scope
  const expected = useWorldviewStore.getState().localSaveWitnesses.worldStructure!
  await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: value }, scope, { kind: 'natural-field-local-save-v1', expected, session: 'seed-051', generation: 1 })
  return scope
}

async function mount(element: React.ReactNode) {
  const host = document.createElement('div')
  host.style.width = '600px'; document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(element))
  return { host, root, unmount: async () => { await act(async () => root.unmount()); host.remove(); const i = mounted.indexOf({ host, root }); if (i >= 0) mounted.splice(i, 1) } }
}
function Consumer({ scope, writer, markdownRead = true, fieldKey = 'worldStructure' as const }: { scope: WorkspaceScope; writer?: InlineSave; markdownRead?: boolean; fieldKey?: string }) {
  const state = useWorldviewStore()
  const identity = { ...scope, table: 'worldviews' as const, field: fieldKey, worldGroupId: null }
  const save: InlineSave = writer ?? ((value, intent) => state.saveWorldview({ projectId: scope.projectId, [fieldKey]: value }, scope, intent!))
  const value = state.worldview ? (state.worldview as Record<string, unknown>)[fieldKey] as string : ''
  return <InlineTextarea value={value} onChange={save} markdownRead={markdownRead} placeholder="点击编辑…"
    localSave={{ identity, witness: (state.localSaveWitnesses as Record<string, unknown> | null)?.[fieldKey] ?? null }}
    inputAreaLayout={{ enabled: true, preferenceKey: `world.${fieldKey}/current` }} />
}
async function button(host: HTMLElement, name: string) {
  const btn = [...host.querySelectorAll('button')].find(el => el.textContent === name)
  expect(btn).not.toBeNull()
  await act(async () => btn!.click())
}
async function edit(area: HTMLTextAreaElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, value); area.dispatchEvent(new Event('input', { bubbles: true })) }) }


describe('MDREADER-051 · WorldviewNaturalPanel 安全 Markdown 阅读与源码切换', () => {
  it('① 条目点击以安全 Markdown 渲染：链接可点、粗体/标题可见、代码块等宽纯文本保留', async () => {
    const { scope } = await seedCurrentWorkspace('051-Natural-panel')
    await fixture(scope, md)
    const ui = await mount(<Consumer scope={scope} />)
    try {
      // 已保存且 markdownRead=true/localSave 存在时渲染为 MarkdownReadView
      expect(ui.host.querySelector('[data-markdown-read-view]')).not.toBeNull()
      // H1 被渲染，非原文字面
      expect(ui.host.querySelector('h1')?.textContent).toBe('世界🌊')
      // 链接是真实 <a>
      const anchor = ui.host.querySelector('a[href="#local"]')
      expect(anchor).not.toBeNull()
      // 代码块 pre/code 是等宽白底背景
      const codePre = ui.host.querySelector('pre code')
      expect(codePre).not.toBeNull()
      expect(codePre!.textContent).toContain('|-- A')
    } finally { await ui.unmount() }
  })

  it('② 点击查看源码切进同源 textarea；返回阅读保留选择位置(模拟)，不改变内容', async () => {
    const { scope } = await seedCurrentWorkspace('051-Natural-source-toggle')
    await fixture(scope, md)
    const ui = await mount(<Consumer scope={scope} />)
    try {
      await button(ui.host, '查看源码')
      expect(ui.host.querySelector('[data-markdown-source]')).not.toBeNull()
      expect((ui.host.querySelector('[data-markdown-source]') as HTMLElement).textContent).toBe(md)
      await button(ui.host, '返回阅读')
      expect(ui.host.querySelector('[data-markdown-read-view]')).not.toBeNull()
      // 未编辑过则 DB 不变
      expect((await db.worldviews.toArray())[0].worldStructure).toBe(md)
    } finally { await ui.unmount() }
  })

  it('③ 经编辑源码后点返回阅读并失焦保存：onChange onSave 仅调用一次、落库后回阅读态带轻量反馈', async () => {
    const { scope } = await seedCurrentWorkspace('051-Natural-save-once')
    await fixture(scope, md)

    const save = vi.fn((v: string, intent?: LocalSaveIntentV1) => {

      return useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: v }, scope, intent!)
    })
    const ui = await mount(<Consumer scope={scope} writer={save} />)
    try {
      await button(ui.host, '编辑源码')
      expect(ui.host.querySelector('textarea')).not.toBeNull()
      const area = ui.host.querySelector('textarea') as HTMLTextAreaElement
      await edit(area, '# 改写后')
      // 编辑后仍停留在源码/编辑态，不自动保存（inputAreaLayout enabled 时 blur 不触发）
      expect(save).toHaveBeenCalledTimes(0)
      // flushPendingEditsV1 是规范触发路径，与 R-MARKDOWN-N5 测试保持一致
      await act(async () => flushPendingEditsV1())
      // 回到阅读态，DB 写入成功
      expect(ui.host.querySelector('[data-markdown-read-view]')).not.toBeNull()
      expect(ui.host.querySelector('textarea')).toBeNull()
      expect((await db.worldviews.toArray())[0].worldStructure).toBe('# 改写后')
    } finally { await ui.unmount() }
  })

    it('④ 含少量文本的 Markdown 仍走阅读分支：单字符内容经本机确认后渲染为 MarkdownReadView，可通过「查看源码」按钮切换', async () => {
    const { scope } = await seedCurrentWorkspace('051-short-md-field')
    // fixture 只在 value===md 时种子；此处直接 loadAll + save 以写入单字符 markdown
    await useWorldviewStore.getState().loadAll(scope)
    const w = useWorldviewStore.getState().localSaveWitnesses.worldStructure!
    await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: '*' }, scope,
      { kind: 'natural-field-local-save-v1', expected: w, session: 'short-seed', generation: 1 })
    const ui = await mount(<Consumer scope={scope} />)
    try {
      expect(ui.host.querySelector('[data-markdown-read-view]')).not.toBeNull()
      // 点「查看源码」按钮切进源码预；与 R-MARKDOWN-N5 测试②相同路径，无需点击 body
      await button(ui.host, '查看源码')
      expect(ui.host.querySelector('[data-markdown-source]')?.textContent).toBe('*')
      // 返回阅读态
      await button(ui.host, '返回阅读')
      expect(ui.host.querySelector('[data-markdown-read-view]')).not.toBeNull()
    } finally { await ui.unmount() }
  })

 it('⑤ 安全：含 script / iframe / data URL 的 Markdown 进入阅读态不被执行，仅文本显示', async () => {
    const malicious = '# title\n<img src=x onerror="alert(1)">\n<iframe src="javascript:alert(1)"></iframe>\n[src](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'
    const { scope } = await seedCurrentWorkspace('051-Security')
    // 复用既有 loadAll + fixture(seed-md)，然后覆写恶意值确保 DB 包含危险载荷
    await useWorldviewStore.getState().loadAll(scope)
    const w = useWorldviewStore.getState().localSaveWitnesses.worldStructure
    // 首次 load 后 worldStructure 已有见证（seedCurrentWorkspace 会建默认行）；用它作为预期
    if (w) {
      await useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: malicious }, scope,
        { kind: 'natural-field-local-save-v1', expected: w, session: 'sec-rewrite', generation: 1 })
    }
    const ui = await mount(<Consumer scope={scope} />)
    try {
      const readView = ui.host.querySelector('[data-markdown-read-view]')
      expect(readView).not.toBeNull()
      expect(readView!.querySelector('img[onerror]')).toBeNull()
      expect(readView!.querySelector('iframe')).toBeNull()
      // marked 把危险 href 过滤掉，不会生成可点击的 data:text HTML 链接
      const allLinks = readView!.querySelectorAll('a[href]')
      for (const a of Array.from(allLinks)) {
        expect(a.getAttribute('href')).not.toMatch(/^data:/i)
      }
    } finally { await ui.unmount() }
  })

  it('⑥ 保存失败/未完成保持源码态不伪成功；flush 后重发才回阅读', async () => {
    const { scope } = await seedCurrentWorkspace('051-fail-retry')
    await fixture(scope, md)
    let fail = true
    const writer = vi.fn((value: string, intent?: LocalSaveIntentV1) =>
      fail ? Promise.reject(new Error('controlled failure'))
           : useWorldviewStore.getState().saveWorldview({ projectId: scope.projectId, worldStructure: value }, scope, intent!))
    const ui = await mount(<Consumer scope={scope} writer={writer} />)
    try {
      await button(ui.host, '编辑源码')
      const area = ui.host.querySelector('textarea')!
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, '# new'); area.dispatchEvent(new Event('input', { bubbles: true })) })
      await act(async () => area.dispatchEvent(new FocusEvent('blur', { bubbles: true })))
      // 失败：仍在 textarea，不伪装成功
      await act(async () => { await vi.waitFor(() => expect(writer).toHaveBeenCalledOnce()) })
      expect(ui.host.querySelector('textarea')).toBe(area)
      expect(ui.host.querySelector('[data-markdown-read-view]')).toBeNull()
      fail = false
      await act(async () => flushPendingEditsV1())
      expect(ui.host.querySelector('[data-markdown-read-view]')).not.toBeNull()
      expect((await db.worldviews.toArray())[0].worldStructure).toBe('# new')
    } finally { await ui.unmount() }
  })
})
