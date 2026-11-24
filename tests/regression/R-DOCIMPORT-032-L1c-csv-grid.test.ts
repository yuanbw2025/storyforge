import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ACCEPT_ATTR, FILE_SIZE_LIMITS, NO_TEXT_LAYER_NOTICE_V1, extractTextFromFile } from '../../src/lib/doc-parser'
import { parseCsvGridV1 } from '../../src/lib/import/csv-grid'
import { publishCsvGridViewV1, useCsvGridViewV1, ImportDocIntro } from '../../src/components/system/import/ImportDocOverview'
import useImportDocumentPreparation from '../../src/components/system/import/useImportDocumentPreparation'

/** 032-L1-c：CSV 纯函数 + sidecar 准备阶段接线（无恢复钩子，避免 vi.mock hoisting TDZ）。
 * 不 touch AI chain、chunker、pipeline、adopt、package.json、ImportDocPanel、ImportUploadZone。 */

// Module-scope state so vi.mock factories capture at init time (no TDZ).
const fetchSpy = vi.fn(() => { throw new Error('032-L1-c forbids model/network calls') })
const spyState = vi.hoisted(() => ({ registerChunkTexts: vi.fn() }))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'data:application/javascript,' }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [] }) }) }) })),
}))
vi.mock('mammoth', () => ({ default: { extractRawText: vi.fn(async () => ({ value: '' })) } }))
vi.mock('../../src/lib/import/chunker', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/import/chunker')>()
  return { ...actual, chunkDocument: vi.fn(actual.chunkDocument) }
})
vi.mock('../../src/lib/import/pipeline', () => ({ registerChunkTexts: spyState.registerChunkTexts }))
vi.mock('../../src/stores/import-session', () => ({
  hasFrozenImportIdentityV1: vi.fn(() => true),
  readImportSessionAuthorityV1: vi.fn(async () => null),
  hashImportChunkTextV1: vi.fn(async (s: string) => s),
  useImportSessionStore: { getState: () => ({ findReusableCompleted: async () => null, findUnfinished: async () => null, loadBlob: async () => null }) },
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
async function mount(element: React.ReactElement) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => root.render(element)); return host
}
async function flushMicrotasks() { await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }

function CsvViewReader() {
  const grid = useCsvGridViewV1()
  return createElement('span', { 'data-testid': 'snap-cols' }, String(grid?.columnCount ?? -1))
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  spyState.registerChunkTexts.mockClear()
  fetchSpy.mockClear()
  publishCsvGridViewV1(null)
})
afterEach(async () => {
  while (mounted.length) { const item = mounted.pop()!; await act(async () => item.root.unmount()); item.host.remove() }
  vi.unstubAllGlobals()
})

describe('032-L1-c csv-grid pure parser', () => {
  it('strips BOM and records bomRemoved', () => {
    const grid = parseCsvGridV1('\uFEFFa,b,c\n1,2,3')
    expect(grid.bomRemoved).toBe(true)
    expect(grid.rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(grid.columnCount).toBe(3)
  })

  it('handles double-quoted fields with embedded comma (RFC4180 basic case)', () => {
    // Quoted field containing internal comma; no nested-quote escape needed.
    const text = '"a,b",c\nd,e'
    const grid = parseCsvGridV1(text)
    expect(grid.rows[0][0]).toBe('a,b')
    expect(grid.columnCount).toBe(2)
    expect(grid.rows).toHaveLength(2)
  })

  it('preserves empty cells: space between commas becomes content cell', () => {
    const grid = parseCsvGridV1('h1,h2,h3\n, ,\n,,')
    expect(grid.rows).toEqual([['h1', 'h2', 'h3'], ['', ' ', ''], ['', '', '']])
    expect(grid.columnCount).toBe(3)
  })

  it('records raggedRows when rows deviate from mode column count', () => {
    const grid = parseCsvGridV1('a,b\n1,2,3\n4,5')
    expect(grid.columnCount).toBe(2)
    expect(grid.raggedRows).toEqual([1])
  })

  it('records quoteErrors on unterminated quote but still returns what was parsed', () => {
    const grid = parseCsvGridV1('"unclosed,b\nother')
    expect(grid.quoteErrors).toBe(true)
    expect(grid.rows.length).toBeGreaterThanOrEqual(1)
  })

  it('does not treat a trailing newline as an extra empty row', () => {
    const grid = parseCsvGridV1('a,b\n1,2\n')
    expect(grid.rows).toHaveLength(2)
    expect(grid.raggedRows).toEqual([])
  })

  it('detects header row when first line matches mode column count and there are >=2 non-empty rows', () => {
    expect(parseCsvGridV1('col_a,col_b\nval_x,val_y').hasHeaderRow).toBe(true)
    expect(parseCsvGridV1('single').hasHeaderRow).toBe(false)
  })

  it('rawText is preserved byte-for-byte regardless of parsing outcome', () => {
    const original = ' "a","b"\r\n1,2 '
    expect(parseCsvGridV1(original).rawText).toBe(original)
  })
})

describe('032-L1-c extractTextFromFile csv sidecar', () => {
  const normalCsv = 'name,value\nalpha,1\nbeta,2\n'
  it('sets csvGrid only for csv and only when status===ok', async () => {
    const result = await extractTextFromFile(new File([normalCsv], 'test.csv'))
    expect(result.status).toBe('ok')
    expect(result.csvGrid).toBeTruthy()
    expect(result.csvGrid!.rows.length).toBe(3)
    expect(result.csvGrid!.columnCount).toBe(2)
    expect(result.csvGrid!.hasHeaderRow).toBe(true)
  })

  it('leaves txt/md/pdf/docx without csvGrid even if they parse successfully', async () => {
    expect((await extractTextFromFile(new File(['hi'], 'a.txt'))).csvGrid).toBeUndefined()
    expect((await extractTextFromFile(new File(['zip-fake'], 'b.docx'))).csvGrid).toBeUndefined()
    expect((await extractTextFromFile(new File(['pdf-fake'], 'c.pdf'))).csvGrid).toBeUndefined()
  })

  it('keeps plainText/rawChars/textLayerStatus unchanged vs existing behavior for same csv content', async () => {
    const blob = new Blob([normalCsv])
    const result = await extractTextFromFile(new File([blob], 'c.csv'))
    expect(result.text).toBe(normalCsv)
    expect(result.rawChars).toBe(normalCsv.length)
    expect(result.status).toBe('ok')
    expect(result.warnings).not.toContain('plain-text-empty')
    expect(FILE_SIZE_LIMITS.csv).toBeGreaterThan(blob.size)
  })

  it('does not add csvGrid for a blocked/empty csv text layer', async () => {
    const result = await extractTextFromFile(new File([' \n\t '], 'whitespace.csv'))
    expect(result.status).toBe('empty')
    expect(result.csvGrid).toBeUndefined()
  })

  it('preserves ACCEPT_ATTR / .doc refusal wording unchanged', () => {
    expect(ACCEPT_ATTR).toBe('.txt,.md,.csv,.pdf,.docx')
    expect(async () => extractTextFromFile(new File(['legacy'], 'old.doc')))
      .rejects.toThrow('Word 97-2003 二进制格式')
  })
})

describe('032-L1-c preparation hook csvGrid wiring', () => {
  it('stores and publishes csvGrid after successful csv upload, zeroes after clear', async () => {
    const csvText = 'k,v\na,1\nb,2\n'
    let prep: ReturnType<typeof useImportDocumentPreparation>
    function Harness() {
      prep = useImportDocumentPreparation()
      return createElement('div', null,
        createElement('span', { 'data-testid': 'grid-cols' }, String(prep.csvGrid?.columnCount ?? -1)),
        createElement('span', { 'data-testid': 'status' }, String(prep.textLayerBlocked ? 'blocked' : 'free')),
        createElement(CsvViewReader, null),
      )
    }
    const host = await mount(createElement(Harness))
    await act(async () => {
      await prep!.handleFile({ target: { files: [new File([csvText], 't.csv', { type: 'text/csv' })], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>)
    })
    expect(prep!.csvGrid).toBeTruthy()
    expect(prep!.csvGrid!.columnCount).toBe(2)
    expect(host.textContent).toContain('2')
    await act(async () => { prep!.handleRawTextChange('other text'); prep!.closeConfirm() })
    expect(prep!.csvGrid).toBeNull()
    await flushMicrotasks()
  })

  it('blocks csvGrid when text-layer is empty, even for csv extension', async () => {
    let prep: ReturnType<typeof useImportDocumentPreparation>
    function Harness() {
      prep = useImportDocumentPreparation()
      return createElement('div', null,
        createElement('span', { 'data-testid': 'blocked' }, String(!!prep.textLayerBlocked))
      )
    }
    const _host = await mount(createElement(Harness))
    await act(async () => {
      await prep!.handleFile({ target: { files: [new File([' ', '\t'], 'scan.csv')], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>)
    })
    expect(prep!.textLayerBlocked?.status).toBe('empty')
    expect(prep!.csvGrid).toBeNull()
    expect(prep!.fileError).toContain(NO_TEXT_LAYER_NOTICE_V1)
  })
})

describe('032-L1-c csv preview card rendered in ImportDocIntro', () => {
  it('shows header, column/row counts, and sample cells when csvGrid is published', async () => {
    const grid = parseCsvGridV1('a,b\n1,2\n3,4\n')
    publishCsvGridViewV1(grid)
    const host = await mount(createElement(ImportDocIntro, { chunkSize: 50000 }))
    await act(async () => {})
    expect(host.textContent).toContain('CSV 对照预览')
    expect(host.textContent).toContain('共 2 列')
    expect(host.textContent).toContain('3 行')
    expect(host.textContent).toContain('表头行已识别')
    publishCsvGridViewV1(null)
  })

  it('shows ragged-row warning when rows have inconsistent widths', async () => {
    const grid = parseCsvGridV1('h1,h2\n1,2,3\n4,5')
    publishCsvGridViewV1(grid)
    const host = await mount(createElement(ImportDocIntro, { chunkSize: 50000 }))
    await act(async () => {})
    expect(host.textContent).toContain('下列行字段数与多数不一致（可能 ragged）：1')
    publishCsvGridViewV1(null)
  })
})
