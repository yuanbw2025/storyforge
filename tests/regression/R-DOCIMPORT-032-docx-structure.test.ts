import { afterEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { projectDocxStructureV1 } from '../../src/lib/import/docx-structure'
import { extractTextFromFile } from '../../src/lib/doc-parser'
import { ImportDocIntro } from '../../src/components/system/import/ImportDocOverview'

const state = vi.hoisted(() => ({ raw: '  作者原稿 e\u0301🌙\r\n表格文字\n\n', html: '<h1>第一章</h1><p>作者原稿</p>', fail: false, cancelled: null as AbortController | null }))
vi.mock('mammoth', () => ({ default: {
  extractRawText: vi.fn(async () => ({ value: state.raw, messages: [{ type: 'warning', message: '原件含未识别样式' }] })),
  images: { imgElement: (callback: unknown) => callback },
  convertToHtml: vi.fn(async () => {
    if (state.cancelled) state.cancelled.abort()
    if (state.fail) throw new Error('结构转换失败样本')
    return { value: state.html, messages: [{ type: 'warning', message: '排版需核对' }] }
  }),
} }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { state.fail = false; state.cancelled = null; vi.clearAllMocks() })

it('projects original structure and merged cell values without publishing executable HTML or URLs', () => {
  const projected = projectDocxStructureV1('<h2>标题🌙</h2><p>段落<br>换行</p><p></p><table><tr><td colspan="2"><p>甲 e\u0301</p><p>乙</p></td><td rowspan="2">尾格</td></tr><tr><td colspan="999999">保留文字</td></tr></table><script>危险脚本</script><p><a href="javascript:alert(1)">只保留链接文字</a><img src="https://invalid.example/x" onerror="alert(1)"></p>')
  expect(projected.blocks).toEqual([
    { kind: 'heading', index: 0, level: 2, text: '标题🌙' },
    { kind: 'paragraph', index: 1, text: '段落\n换行' },
    { kind: 'paragraph', index: 2, text: '' },
    { kind: 'table', index: 3, rows: [[{ text: '甲 e\u0301\n乙', colSpan: 2, rowSpan: 1 }, { text: '尾格', colSpan: 1, rowSpan: 2 }], [{ text: '保留文字', colSpan: 1, rowSpan: 1 }]] },
    { kind: 'paragraph', index: 4, text: '只保留链接文字' },
  ])
  expect(JSON.stringify(projected)).not.toMatch(/javascript:|invalid.example|危险脚本|onerror/)
})
it('keeps the original text and diagnostics exactly while exposing conversion limitations and structure', async () => {
  const original = await extractTextFromFile(new File(['synthetic docx'], '旧调用.docx'))
  expect(original.text).toBe(state.raw); expect(original.docxStructure).toBeUndefined()
  const result = await extractTextFromFile(new File(['synthetic docx'], '原稿.docx'), { includeDocxStructure: true })
  expect(result.text).toBe(state.raw); expect(result.rawChars).toBe(state.raw.length)
  expect(result.docxStructure?.blocks[0]).toMatchObject({ kind: 'heading', text: '第一章' })
  expect(result.formatNotices?.join('\n')).toContain('原件含未识别样式')
  expect(result.docxStructure?.notices.join('\n')).toContain('排版需核对')
})
it('reports failed structure explicitly without rewriting text, and abort never returns a partial success', async () => {
  state.fail = true
  const result = await extractTextFromFile(new File(['synthetic docx'], '原稿.docx'), { includeDocxStructure: true })
  expect(result.text).toBe(state.raw)
  expect(result.docxStructure?.blocks).toEqual([])
  expect(result.docxStructure?.notices.join('\n')).toContain('Word 结构对照未能生成')
  state.fail = false; state.cancelled = new AbortController()
  await expect(extractTextFromFile(new File(['synthetic docx'], '取消.docx'), { signal: state.cancelled.signal, includeDocxStructure: true })).rejects.toThrow()
})
it('renders a bounded read-only preview with full structure retained and no live document HTML', async () => {
  const structure = projectDocxStructureV1('<h1>作者标题</h1>' + '<p>段落</p>'.repeat(25) + '<table><tr><td>完整末尾格</td></tr></table>')
  const host = document.createElement('div');document.body.append(host);const root = createRoot(host)
  try {
    await act(async () => root.render(createElement(ImportDocIntro, { chunkSize: 50000, docxStructure: structure })))
    expect(host.querySelector('[aria-label="Word 文档结构对照"]')?.textContent).toContain('27 段结构 · 1 张表格')
    expect(host.textContent).toContain('只限制此处展示')
    expect(structure.blocks[structure.blocks.length - 1]).toMatchObject({ kind: 'table', rows: [[{ text: '完整末尾格' }]] })
    expect(host.querySelector('iframe,script,img,a')).toBeNull()
    await act(async () => root.render(createElement(ImportDocIntro, { chunkSize: 50000, docxStructure: null })))
    expect(host.querySelector('[aria-label="Word 文档结构对照"]')).toBeNull()
  } finally { await act(async () => root.unmount());host.remove() }
})
