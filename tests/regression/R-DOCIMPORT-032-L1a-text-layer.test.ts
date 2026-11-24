import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ACCEPT_ATTR, FILE_SIZE_LIMITS, NO_TEXT_LAYER_NOTICE_V1, TEXT_LAYER_MIN_TOTAL_UNITS_V1,
  assessExtractionQualityV1, extractTextFromFile, textLayerReportLineV1,
} from '../../src/lib/doc-parser'
import { chunkDocument } from '../../src/lib/import/chunker'
import { registerChunkTexts } from '../../src/lib/import/pipeline'
import useImportDocumentPreparation from '../../src/components/system/import/useImportDocumentPreparation'
import useImportSessionRecovery from '../../src/components/system/import/useImportSessionRecovery'

// 032-L1-a direct positives/negatives. PDF/DOCX readers are deterministic
// fixtures: no OCR, no network, no model, no adopt, no IndexedDB lifecycle.
const state = vi.hoisted(() => ({
  pdfPages: [['']] as string[][],
  docxText: '',
  session: null as unknown,
  frozen: null as unknown,
  blob: null as unknown,
}))

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: 'data:application/javascript,' }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: state.pdfPages.length,
      getPage: async (pageNo: number) => ({
        getTextContent: async () => ({ items: (state.pdfPages[pageNo - 1] ?? []).map(str => ({ str })) }),
      }),
    }),
  })),
}))
vi.mock('mammoth', () => ({
  default: { extractRawText: vi.fn(async () => ({ value: state.docxText })) },
}))
vi.mock('../../src/lib/import/chunker', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/import/chunker')>()
  return { ...actual, chunkDocument: vi.fn(actual.chunkDocument) }
})
vi.mock('../../src/lib/import/pipeline', () => ({
  hasChunkTexts: vi.fn(() => false),
  registerChunkTexts: vi.fn(),
}))
vi.mock('../../src/stores/import-session', () => ({
  hasFrozenImportIdentityV1: vi.fn(() => true),
  readImportSessionAuthorityV1: vi.fn(async () => state.frozen),
  hashImportChunkTextV1: vi.fn(async (text: string) => text),
  useImportSessionStore: {
    getState: () => ({
      findReusableCompleted: async () => null,
      findUnfinished: async () => state.session,
      loadBlob: async () => state.blob,
    }),
  },
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
const fetchSpy = vi.fn(() => { throw new Error('032-L1-a forbids model/network calls') })

async function mount(element: React.ReactElement) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  mounted.push({ host, root })
  await act(async () => root.render(element))
  return host
}
function uploadEvent(file: File) {
  return { target: { files: [file], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>
}
async function flushMicrotasks() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
}

beforeEach(() => {
  state.pdfPages = [['']]
  state.docxText = ''
  state.session = null
  state.frozen = null
  state.blob = null
  vi.mocked(chunkDocument).mockClear()
  vi.mocked(registerChunkTexts).mockClear()
  vi.stubGlobal('fetch', fetchSpy)
  fetchSpy.mockClear()
})
afterEach(async () => {
  while (mounted.length) {
    const item = mounted.pop()!
    await act(async () => item.root.unmount())
    item.host.remove()
  }
  vi.unstubAllGlobals()
})

describe('032-L1-a text-layer detection and original-file preservation', () => {
  it('marks an empty PDF text layer as empty and keeps the existing paging text unchanged', async () => {
    state.pdfPages = [['', '  '], ['\t']]
    const result = await extractTextFromFile(new File(['pdf-bytes'], '扫描件.pdf', { type: 'application/pdf' }))
    expect(result.status).toBe('empty')
    expect(result.warnings).toContain('pdf-text-layer-empty')
    expect(result.diagnostics.thresholdUnits).toBe(TEXT_LAYER_MIN_TOTAL_UNITS_V1)
    expect(result.pageCount).toBe(2)
    expect(result.text).toBe('   \n\n\t') // same per-item ' ' join and page '\n\n' join as before
    expect(result.rawChars).toBe(result.text.length)
    expect(textLayerReportLineV1({ filename: '扫描件.pdf', sizeBytes: 123, pageCount: 2, status: result.status }))
      .toContain(NO_TEXT_LAYER_NOTICE_V1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps a normal PDF ok and byte-for-byte equivalent to the existing extractor behavior', async () => {
    const first = '镜海之门在退潮后开启，守潮人仍然按旧约巡夜。'
    const second = '第二段完整保留了可复制正文与页间换行。'
    state.pdfPages = [[first, '补充说明'], [second]]
    const result = await extractTextFromFile(new File(['pdf-bytes'], '正常.pdf', { type: 'application/pdf' }))
    expect(result.status).toBe('ok')
    expect(result.warnings).not.toContain('pdf-text-layer-empty')
    expect(result.text).toBe(`${first} 补充说明\n\n${second}`)
    expect(result.text).toContain('\n\n')
    expect(result.pageCount).toBe(2)
    expect(result.diagnostics.nonWhitespaceUnits).toBeGreaterThanOrEqual(TEXT_LAYER_MIN_TOTAL_UNITS_V1)
  })

  it('marks an empty docx and empty csv explicitly while leaving normal docx/plain text unchanged', async () => {
    state.docxText = ''
    const emptyDocx = await extractTextFromFile(new File(['zip'], '空文档.docx'))
    expect(emptyDocx.status).toBe('empty')
    expect(emptyDocx.warnings).toContain('docx-text-empty')
    const emptyCsv = await extractTextFromFile(new File([' \n\t'], '空表.csv'))
    expect(emptyCsv.status).toBe('empty')
    expect(emptyCsv.warnings).toContain('plain-text-empty')
    state.docxText = '世界来源原文。\n第二段仍逐字保留。'
    const normalDocx = await extractTextFromFile(new File(['zip'], '正文.docx'))
    expect(normalDocx.status).toBe('ok')
    expect(normalDocx.text).toBe(state.docxText)
    expect(normalDocx.rawChars).toBe(state.docxText.length)
    for (const ext of ['txt', 'md', 'csv']) {
      const text = '第一行\n第二行，含空格和尾部空格  '
      const result = await extractTextFromFile(new File([text], `正常.${ext}`))
      expect(result.status).toBe('ok')
      expect(result.text).toBe(text)
      expect(result.rawChars).toBe(text.length)
    }
  })

  it('records the sparse-text threshold for a non-empty but effectively unreadable PDF footer', () => {
    const footer = '页脚 1'
    const assessed = assessExtractionQualityV1({ format: 'pdf', text: footer, pages: [footer] })
    expect(assessed.status).toBe('empty')
    expect(assessed.warnings).toContain('pdf-text-layer-empty')
    expect(assessed.diagnostics.thresholdUnits).toBe(TEXT_LAYER_MIN_TOTAL_UNITS_V1)
    expect(assessed.diagnostics.nonWhitespaceUnits).toBeLessThan(TEXT_LAYER_MIN_TOTAL_UNITS_V1)
    expect(assessed.diagnostics.sparsePages).toEqual([0])
  })

  it('preparation hook blocks empty text layers: zero chunks, zero model calls, fixed notice, original file retained', async () => {
    state.pdfPages = [[' ', '\t']]
    let prep: ReturnType<typeof useImportDocumentPreparation>
    function Harness() {
      prep = useImportDocumentPreparation()
      return createElement('div', null,
        createElement('span', { 'data-testid': 'notice' }, prep.fileError ?? ''),
        createElement('span', { 'data-testid': 'confirm' }, String(prep.showConfirm)),
        createElement('span', { 'data-testid': 'preview' }, String(prep.previewPlans?.length ?? 0)),
      )
    }
    const host = await mount(createElement(Harness))
    const file = new File(['scan'], '扫描件.pdf', { type: 'application/pdf' })
    await act(async () => { await prep!.handleFile(uploadEvent(file)) })
    expect(prep!.textLayerBlocked?.status).toBe('empty')
    expect(prep!.fileError).toContain(NO_TEXT_LAYER_NOTICE_V1)
    expect(prep!.fileError).toContain('扫描件.pdf')
    expect(prep!.fileError).toContain('状态 无可复制文本')
    expect(host.textContent).toContain(NO_TEXT_LAYER_NOTICE_V1)
    expect(prep!.sourceBlob().blob).toBe(file) // existing importFiles/saveBlob path can still retain it
    expect(prep!.sourceBlob().filename).toBe('扫描件.pdf')
    await act(async () => { prep!.prepareConfirmation() })
    expect(prep!.showConfirm).toBe(false)
    expect(prep!.plans).toBeNull()
    expect(prep!.previewPlans).toBeNull()
    expect(chunkDocument).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('recovery hook stops before chunk registration or model calls when the restored original has no text layer', async () => {
    state.pdfPages = [['']]
    const fileHash = 'frozen-file-hash'
    state.session = { id: 7, projectId: 1, filename: '扫描件.pdf' }
    state.frozen = { id: 7, fileHash, chunkSize: 50000, totalChunks: 1, chunks: [] }
    state.blob = { filename: '扫描件.pdf', fileHash, blob: new Blob(['scan'], { type: 'application/pdf' }) }
    let recovery: ReturnType<typeof useImportSessionRecovery>
    function Harness() {
      recovery = useImportSessionRecovery(1, 1, 1)
      return createElement('div', null,
        createElement('span', { 'data-testid': 'blocked' }, recovery.textLayerBlocked ?? ''),
        createElement('span', { 'data-testid': 'restored' }, String(recovery.blobRestored)),
      )
    }
    const host = await mount(createElement(Harness))
    await flushMicrotasks()
    expect(recovery!.textLayerBlocked).toContain(NO_TEXT_LAYER_NOTICE_V1)
    expect(recovery!.textLayerBlocked).toContain('扫描件.pdf')
    expect(host.textContent).toContain(NO_TEXT_LAYER_NOTICE_V1)
    expect(recovery!.blobRestored).toBe(false)
    expect(recovery!.unfinished).toBeTruthy() // original session is preserved, not discarded
    expect(chunkDocument).not.toHaveBeenCalled()
    expect(registerChunkTexts).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not alter existing file-format limits, accept list, or .doc refusal wording', async () => {
    expect(FILE_SIZE_LIMITS).toEqual({ txt: 5 * 1024 * 1024, md: 5 * 1024 * 1024, csv: 2 * 1024 * 1024, pdf: 20 * 1024 * 1024, docx: 10 * 1024 * 1024 })
    expect(ACCEPT_ATTR).toBe('.txt,.md,.csv,.pdf,.docx')
    await expect(extractTextFromFile(new File(['legacy'], '旧版.doc'))).rejects.toThrow('Word 97-2003 二进制格式')
  })
})
