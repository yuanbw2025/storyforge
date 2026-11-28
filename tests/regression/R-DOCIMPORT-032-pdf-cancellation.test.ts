import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { extractTextFromFile } from '../../src/lib/doc-parser'
const f = vi.hoisted(() => ({ mode: 'success', loaded: 0, destroyed: 0, pages: [] as number[], cleaned: [] as number[], reject: null as ((error: Error) => void) | null }))
vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'data:application/javascript,' }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' }, getDocument: () => {
  f.loaded++
  const pdf = { numPages: 2, getPage: async (index: number) => {
    f.pages.push(index)
    return { cleanup: () => { f.cleaned.push(index); return true }, getTextContent: async () => {
      if (f.mode === 'page-error') throw new Error('原PDF页解析失败')
      if (f.mode === 'page-wait') return new Promise((_resolve, reject) => { f.reject = reject })
      return { items: [{ str: `第${index}页 原始段落保留。` }, { str: '完整文字和空格  ' }] }
    } }
  } }
  return { promise: f.mode === 'load-wait' ? new Promise((_resolve, reject) => { f.reject = reject }) : Promise.resolve(pdf),
    destroy: async () => { f.destroyed++; f.reject?.(new Error('worker destroyed')); if (f.mode === 'destroy-error') throw new Error('释放PDF任务失败') } }
} }))
beforeEach(() => { f.mode = 'success';f.loaded = 0;f.destroyed = 0;f.pages = [];f.cleaned = [];f.reject = null })
afterEach(() => vi.clearAllMocks())
const file = () => new File(['synthetic PDF'], '资料.pdf')
it('keeps exact legacy per-item/page spacing and releases every page and the task once', async () => {
  const controller = new AbortController()
  const result = await extractTextFromFile(file(), { signal: controller.signal })
  expect(result.text).toBe('第1页 原始段落保留。 完整文字和空格  \n\n第2页 原始段落保留。 完整文字和空格  ')
  expect(result.rawChars).toBe(result.text.length);expect(result.pageCount).toBe(2)
  expect(result.formatNotices?.join('')).toContain('不保证逐字保真')
  expect(f.cleaned).toEqual([1, 2]);expect(f.destroyed).toBe(1)
  controller.abort();expect(f.destroyed).toBe(1)
})
it.each(['load-wait', 'page-wait'])('cancels %s with no partial text, releases task once and starts no later page', async mode => {
  f.mode = mode
  const controller = new AbortController(), reason = new DOMException('作者取消原件读取', 'AbortError')
  const result = extractTextFromFile(file(), { signal: controller.signal })
  const rejected = expect(result).rejects.toBe(reason)
  await vi.waitFor(() => expect(f.reject).toBeTypeOf('function'))
  controller.abort(reason);await rejected
  expect(f.destroyed).toBe(1)
  expect(f.pages).toEqual(mode === 'page-wait' ? [1] : [])
  expect(f.cleaned).toEqual(mode === 'page-wait' ? [1] : [])
})
it('releases the worker on a bad page and preserves the original failure instead of returning a prefix', async () => {
  f.mode = 'page-error'
  await expect(extractTextFromFile(file())).rejects.toThrow('原PDF页解析失败')
  expect(f.destroyed).toBe(1);expect(f.cleaned).toEqual([1]);expect(f.pages).toEqual([1])
})
it('never starts a cancelled file and refuses to report success if final task disposal fails', async () => {
  const controller = new AbortController();controller.abort()
  await expect(extractTextFromFile(file(), { signal: controller.signal })).rejects.toThrow()
  expect(f.loaded).toBe(0)
  f.mode = 'destroy-error'
  await expect(extractTextFromFile(file())).rejects.toThrow('释放PDF任务失败')
  expect(f.destroyed).toBe(1)
})
