import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Lexer, marked } from 'marked'
import { afterEach, expect, it, vi } from 'vitest'
import MarkdownReadView, { type MarkdownReadViewProps } from '../../src/components/shared/MarkdownReadView'
import { markdownReadHrefV1, markdownReadTextV1 } from '../../src/lib/authoring/markdown-read-safety'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: { host: HTMLDivElement; root: ReturnType<typeof createRoot> }[] = []
afterEach(async () => { for (const ui of mounted.splice(0)) { await act(async () => ui.root.unmount()); ui.host.remove() } vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function mount(props: MarkdownReadViewProps) {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); mounted.push({ host, root })
  const render = async (next = props) => { await act(async () => root.render(<MarkdownReadView {...next} />)) }; await render()
  return { host, root, render }
}
async function click(host: HTMLElement, text: string) { await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === text)!.click()) }
const raw = '  # 世界🌊\r\n\r\n**粗体** 和 *斜体* 与 ~~删线~~\r\n\r\n> 引用\r\n\r\n- 一\r\n- [x] 完成\r\n\r\n3. 三\r\n4. 四\r\n\r\n| 港 | 山 |\r\n| :-- | --: |\r\n| A | `B` |\r\n\r\n```text\r\n+---+   +---+\r\n| A |---| B |  \r\n+---+   +---+\r\n```\r\n  '
it('uses actual tokens to render semantic headings, emphasis, lists, quotes, GFM table and monospace ASCII code', async () => {
  const parse = vi.spyOn(marked, 'parse'); const ui = await mount({ value: raw })
  expect(ui.host.querySelector('h1')?.textContent).toBe('世界🌊'); expect(ui.host.querySelector('strong')?.textContent).toBe('粗体')
  expect(ui.host.querySelector('em')?.textContent).toBe('斜体'); expect(ui.host.querySelector('del')?.textContent).toBe('删线')
  expect(ui.host.querySelector('blockquote')?.textContent).toContain('引用'); expect(ui.host.querySelector('ol')?.start).toBe(3)
  expect(ui.host.querySelectorAll('th')).toHaveLength(2); expect(ui.host.querySelectorAll('td')).toHaveLength(2)
  expect(ui.host.querySelector('pre code')?.textContent).toBe('+---+   +---+\n| A |---| B |  \n+---+   +---+')
  expect(ui.host.querySelector('pre')?.style.whiteSpace).toBe('pre'); expect(ui.host.querySelector('pre')?.style.overflowX).toBe('auto')
  expect(ui.host.querySelector('[data-markdown-table-scroll]')?.getAttribute('style')).toContain('overflow-x: auto')
  expect(parse).not.toHaveBeenCalled(); expect(ui.host.querySelector('input')).toBeNull()
})
it('keeps HTML literal and every image inert, including table cells, links, SVG, srcdoc, handlers and entity text', async () => {
  const attack = '<script>window.hacked=1</script>\n<img src="https://bad.invalid/html" onerror="alert(1)">\n<iframe srcdoc="<script>alert(1)</script>"></iframe>\n<svg onload="alert(1)"></svg>\n\n![外图](https://bad.invalid/md)\n\n| x |\n| -- |\n| <img src=x onerror=alert(1)> |\n\n[![内图](https://bad.invalid/nested)](javascript:alert(1))\n\n&lt;script&gt; &amp; &#x1f30a;'
  const ui = await mount({ value: attack })
  expect(ui.host.querySelectorAll('script,img,iframe,svg,object,embed,style,link,video,audio,source')).toHaveLength(0)
  expect(ui.host.querySelectorAll('[src],[srcset],[onerror],[onload]')).toHaveLength(0)
  expect(ui.host.querySelectorAll('a')).toHaveLength(0); expect(ui.host.textContent).toContain('<script>window.hacked=1</script>')
  expect(ui.host.textContent).toContain('［图片：外图］'); expect(ui.host.textContent).toContain('［图片：内图］')
  expect(ui.host.textContent).toContain('<script> & 🌊')
})
it('copies and displays original code units, never normalized token.raw or a rendered projection; copy errors are visible', async () => {
  const copy = vi.fn().mockResolvedValue(undefined); vi.stubGlobal('navigator', { clipboard: { writeText: copy } })
  const edit = vi.fn(); const ui = await mount({ value: raw, onRequestEdit: edit })
  await click(ui.host, '复制源码'); expect(copy).toHaveBeenCalledExactlyOnceWith(raw)
  await click(ui.host, '查看源码'); expect(ui.host.querySelector('[data-markdown-source]')?.textContent).toBe(raw)
  expect(edit).not.toHaveBeenCalled(); await click(ui.host, '编辑源码'); expect(edit).toHaveBeenCalledExactlyOnceWith(raw)
  copy.mockRejectedValueOnce(new Error('denied')); await click(ui.host, '复制源码'); expect(ui.host.textContent).toContain('复制失败')
})
it('separates body edit requests from selection/double-click, safe links, code/table scroll and readonly source actions', async () => {
  vi.useFakeTimers(); const edit = vi.fn(); const value = '可选择段落\n\n[安全](https://example.test/a%20b)\n\n```text\n ASCII\n```'
  const ui = await mount({ value, onRequestEdit: edit }); const body = ui.host.querySelector('[data-markdown-body]')!
  const paragraph = body.querySelector('p')!; const selection = window.getSelection()!
  const range = document.createRange(); range.selectNodeContents(paragraph); selection.removeAllRanges(); selection.addRange(range)
  await act(async () => { paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); vi.advanceTimersByTime(300) }); expect(edit).not.toHaveBeenCalled()
  selection.removeAllRanges()
  await act(async () => { paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); paragraph.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })); vi.advanceTimersByTime(300) }); expect(edit).not.toHaveBeenCalled()
  const anchor = body.querySelector('a')!; anchor.addEventListener('click', event => event.preventDefault())
  await act(async () => { anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); body.querySelector('code')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); vi.advanceTimersByTime(300) }); expect(edit).not.toHaveBeenCalled()
  await act(async () => { paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); vi.advanceTimersByTime(300) }); expect(edit).toHaveBeenCalledExactlyOnceWith(value)
  edit.mockClear(); await ui.render({ value, readOnly: true, onRequestEdit: edit }); await click(ui.host, '查看源码')
  expect([...ui.host.querySelectorAll('button')].some(button => button.textContent === '编辑源码')).toBe(false)
  await act(async () => { paragraph.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); vi.advanceTimersByTime(300) }); expect(edit).not.toHaveBeenCalled()
})
it('cancels delayed requests on raw/readonly change and unmount', async () => {
  vi.useFakeTimers(); const edit = vi.fn(); const ui = await mount({ value: 'old', onRequestEdit: edit })
  await act(async () => ui.host.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
  await ui.render({ value: 'new', onRequestEdit: edit }); await act(async () => vi.advanceTimersByTime(300)); expect(edit).not.toHaveBeenCalled()
  await act(async () => ui.host.querySelector('p')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })))
  await act(async () => ui.root.unmount()); mounted.splice(mounted.findIndex(item => item.root === ui.root), 1); ui.host.remove()
  await act(async () => vi.advanceTimersByTime(300)); expect(edit).not.toHaveBeenCalled()
})
it('falls back safely for unknown tokens or lexer errors without losing the original source', async () => {
  const lexer = vi.spyOn(Lexer.prototype, 'lex').mockReturnValueOnce(Object.assign([{ type: 'future-extension', raw: '<svg onload=alert(1)>' }], { links: {} }))
  const ui = await mount({ value: 'source' }); expect(ui.host.textContent).toContain('<svg onload=alert(1)>'); expect(ui.host.querySelector('svg')).toBeNull()
  lexer.mockImplementationOnce(() => { throw new Error('synthetic lexer fault') })
  await ui.render({ value: raw }); expect(ui.host.querySelector('[data-markdown-fallback]')?.textContent).toBe(raw)
})
for (const href of ['https://example.test/docs?a=1&b=2', 'HTTP://example.test/a%20b', '#section', '#%E4%B8%96%E7%95%8C']) it(`keeps an approved link verbatim: ${href}`, () => expect(markdownReadHrefV1(href)).toBe(href))
for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', 'file:///tmp/x', 'blob:https://x/y', 'mailto:x@example.test', '//example.test/x', '/local/route', ' https://example.test', 'https://example.test/a\nb', 'https:\\example.test', 'https://user:pass@example.test', 'https%3a%2f%2fexample.test', '&#106;avascript:alert(1)', 'java&Tab;script:alert(1)', 'https://example.test/?x=&NewLine;', 'https://example.test/%0a', 'https://example.test/%250a', 'https://example.test/%00', 'https://example.test/%C2%85', 'https://example.test/%E2%80%8B', 'https://example.test/%ZZ']) it(`keeps a rejected URL inert: ${JSON.stringify(href)}`, () => expect(markdownReadHrefV1(href)).toBeNull())
it('decodes text without markup parsing and preserves unknown entities and code characters', () => {
  expect(markdownReadTextV1('&lt;img&gt; &amp; &#128512; &#x1f30a; &unknown;')).toBe('<img> & 😀 🌊 &unknown;')
  expect(markdownReadTextV1('&#0; &#xD800;')).toBe('� �')
})
it('bounds recursive display and falls back to the whole original without truncating it', async () => {
  const lexer = vi.spyOn(Lexer.prototype, 'lex')
  let nested: import('marked').Token[] = [{ type: 'text', raw: 'deep', text: 'deep' }]
  for (let i = 0; i < 45; i++) nested = [{ type: 'blockquote', raw: 'nested', text: 'nested', tokens: nested }]
  lexer.mockReturnValueOnce(Object.assign(nested, { links: {} }))
  const ui = await mount({ value: raw }); expect(ui.host.querySelector('[data-markdown-fallback]')?.textContent).toBe(raw)
})
it('does not convert an ordinary copy event into an edit request or prevent the native selection action', async () => {
  vi.useFakeTimers(); const edit = vi.fn(); const ui = await mount({ value: 'select and copy', onRequestEdit: edit })
  const event = new Event('copy', { bubbles: true, cancelable: true }); ui.host.querySelector('p')!.dispatchEvent(event)
  await act(async () => vi.advanceTimersByTime(300)); expect(event.defaultPrevented).toBe(false); expect(edit).not.toHaveBeenCalled()
})
