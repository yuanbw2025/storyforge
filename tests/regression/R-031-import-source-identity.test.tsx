import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { File as NativeFile, Blob as NativeBlob } from 'node:buffer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import useImportDocumentPreparation from '../../src/components/system/import/useImportDocumentPreparation'
import * as parser from '../../src/lib/doc-parser'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let source: ReturnType<typeof useImportDocumentPreparation>, root: ReturnType<typeof createRoot>, host: HTMLDivElement
function Harness() { source = useImportDocumentPreparation(); return null }
const result = (text: string): parser.ExtractResult => ({ text, rawChars: text.length, ...parser.assessExtractionQualityV1({ format: 'plain', text }) })
const file = (name: string, bytes = 'synthetic original file bytes') => new NativeFile([bytes], name) as unknown as File
function choose(selected: File) { return source.handleFile({ target: { files: [selected], value: 'selected' } } as unknown as React.ChangeEvent<HTMLInputElement>) }
beforeEach(async () => {
  vi.stubGlobal('Blob', NativeBlob)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<Harness />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps the uploaded original, then gives pasted text a truthful plain-text Blob and filename', async () => {
  vi.spyOn(parser, 'extractTextFromFile').mockResolvedValue(result('已抽取的 Word 内容'))
  const original = file('original.docx', 'synthetic Word fixture original')
  await act(async () => choose(original))
  expect(source.sourceBlob()).toEqual({ blob: original, filename: original.name })
  await act(async () => { source.handleRawTextChange('  # 作者粘贴\r\n\r\n逐字保留🌊。　 ') })
  expect(source.filename).toBe(''); expect(source.extractInfo).toBeNull()
  const pasted = source.sourceBlob()
  expect(pasted.filename).toBe('粘贴内容.txt'); expect(pasted.blob.type).toBe('text/plain;charset=utf-8')
  expect(await pasted.blob.text()).toBe('  # 作者粘贴\r\n\r\n逐字保留🌊。　 ')
})

it.each(['success', 'failure'])('a late decoder %s cannot overwrite a newer pasted source or its status', async kind => {
  let resolve!: (value: parser.ExtractResult) => void, reject!: (cause: Error) => void
  vi.spyOn(parser, 'extractTextFromFile').mockImplementation(() => new Promise((yes, no) => { resolve = yes; reject = no }))
  let reading!: Promise<void>
  await act(async () => { reading = choose(file('slow.docx')) })
  expect(source.loadingFile).toBe(true)
  await act(async () => { source.handleRawTextChange('作者的新内容') })
  expect(source.loadingFile).toBe(false)
  await act(async () => { if (kind === 'success') resolve(result('迟到的旧内容')); else reject(Error('old decoder failure')); await reading })
  expect(source.rawText).toBe('作者的新内容'); expect(source.filename).toBe(''); expect(source.fileError).toBeNull()
  expect(source.loadingFile).toBe(false); expect(await source.sourceBlob().blob.text()).toBe('作者的新内容')
})

it('does not let completion of the first file clear the second pending file or replace its original bytes', async () => {
  let first!: (value: parser.ExtractResult) => void, second!: (value: parser.ExtractResult) => void
  vi.spyOn(parser, 'extractTextFromFile')
    .mockImplementationOnce(() => new Promise(resolve => { first = resolve }))
    .mockImplementationOnce(() => new Promise(resolve => { second = resolve }))
  const originalB = file('second.pdf', 'second synthetic original bytes')
  let a!: Promise<void>, b!: Promise<void>
  await act(async () => { a = choose(file('first.docx')) })
  await act(async () => { b = choose(originalB) })
  await act(async () => { first(result('旧文件正文')); await a })
  expect(source.loadingFile).toBe(true); expect(source.filename).toBe('second.pdf'); expect(source.rawText).toBe('')
  await act(async () => { second(result('新文件正文')); await b })
  expect(source.rawText).toBe('新文件正文'); expect(source.loadingFile).toBe(false); expect(source.fileError).toBeNull()
  expect(source.sourceBlob()).toEqual({ blob: originalB, filename: originalB.name })
  expect(await source.sourceBlob().blob.text()).toBe('second synthetic original bytes')
})

it('keeps a large uploaded original out of the editable preview and replaces it explicitly when the author pastes', async () => {
  const body = '完整原文🌊。'.repeat(160000)
  const original = file('large.txt', body)
  const parserSpy = vi.spyOn(parser, 'extractTextFromFile')
  await act(async () => choose(original))
  expect(parserSpy).not.toHaveBeenCalled()
  expect(source.totalChars).toBe(body.length); expect(source.rawText.length).toBeLessThanOrEqual(8192)
  expect(source.blobTextSource?.blob).toBe(original); expect(source.hasSourceText).toBe(true)
  await act(async () => source.prepareConfirmation())
  expect(source.plans?.[0].endChar).toBe(body.length)
  await act(async () => source.handleRawTextChange('作者改为粘贴的新原文'))
  expect(source.blobTextSource).toBeNull(); expect(source.totalChars).toBe('作者改为粘贴的新原文'.length)
  expect(source.sourceBlob().filename).toBe('粘贴内容.txt')
})
