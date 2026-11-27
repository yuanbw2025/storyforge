import { Blob as NativeBlob } from 'node:buffer'
import { expect, it } from 'vitest'
import { openImportBlobTextSourceV1, IMPORT_TEXT_FILE_MAX_BYTES_V1, IMPORT_TEXT_PREVIEW_CHARS_V1 } from '../../src/lib/import/blob-text-source'
import { quickHash, createImportQuickHashV1 } from '../../src/lib/import/chunker'
import { captureChunkTextReaderV1, clearChunkTexts, getChunkText, registerChunkTextReaderV1 } from '../../src/lib/import/chunk-text-registry'

it('matches native UTF-8 decoding at every byte cut, including malformed sequences and embedded BOMs', async () => {
  const content = new TextEncoder().encode('\uFEFF中😀𠀀e\u0301\r\n\uFEFF尾部')
  const malformed = [0xc0, 0x80, 0xe0, 0x80, 0x80, 0xed, 0xa0, 0x80, 0xf4, 0x90, 0x80, 0x80, 0xe2, 0x82]
  for (let pad = 0; pad < 16; pad++) {
    const blob = new NativeBlob([new Uint8Array(pad).fill(65), content, new Uint8Array(malformed), content]) as unknown as Blob
    const expected = await blob.text()
    const source = await openImportBlobTextSourceV1(blob, { blockBytes: 8 })
    expect(source.totalChars).toBe(expected.length); expect(source.fileHash).toBe(quickHash(expected))
    expect(await source.read(0, source.totalChars)).toBe(expected)
    for (let i = 0; i < expected.length; i++) expect(await source.read(i, Math.min(i + 5, expected.length))).toBe(expected.slice(i, i + 5))
  }
})

it('retains the legacy quick-hash identity across incremental updates without finalizing the running state', () => {
  const text = '😀逐字\r\n\u0000e\u0301　尾部'
  const sink = createImportQuickHashV1()
  sink.update(text.slice(0, 1)); sink.digest(); sink.update(text.slice(1, 7)); sink.update(text.slice(7))
  expect(sink.digest()).toBe(quickHash(text)); expect(sink.digest()).toBe(sink.digest())
})

it('scans a 192 MiB original through bounded slices and reads the exact final range without whole-file decoding', async () => {
  const part = '海🌊\r\n'.repeat(8192), bytes = new TextEncoder().encode(part)
  const count = Math.ceil(192 * 1024 * 1024 / bytes.length)
  const native = new NativeBlob([...Array.from({ length: count }, () => bytes), new TextEncoder().encode('末尾原文。')])
  const size = native.size
  let maxRead = 0, readBytes = 0
  const instrumented = {
    size,
    slice(start: number, end: number) {
      maxRead = Math.max(maxRead, Math.min(end, size) - start)
      return native.slice(start, end)
    },
    text() { throw Error('whole-file decode forbidden') },
    arrayBuffer() { throw Error('whole-file buffer forbidden') },
  } as Blob
  const source = await openImportBlobTextSourceV1(instrumented, { onProgress: read => { readBytes = read } })
  expect(readBytes).toBe(size); expect(maxRead).toBeLessThanOrEqual(65539)
  expect(source.preview.length).toBe(IMPORT_TEXT_PREVIEW_CHARS_V1)
  expect(source.totalChars).toBe(count * part.length + 5)
  expect(await source.read(source.totalChars - 14, source.totalChars)).toBe((part + '末尾原文。').slice(-14))
  expect(source.hasText).toBe(true)
}, 15_000)

it('cancels the scan between bounded reads and refuses oversized files before any IO', async () => {
  const controller = new AbortController(), blob = new NativeBlob(['海'.repeat(100)]) as unknown as Blob
  await expect(openImportBlobTextSourceV1(blob, { blockBytes: 8, signal: controller.signal, onProgress: () => controller.abort() })).rejects.toThrow()
  await expect(openImportBlobTextSourceV1({ size: IMPORT_TEXT_FILE_MAX_BYTES_V1 + 1 } as Blob)).rejects.toThrow('512 MB')
})

it('keeps only the selected lazy chunk and rejects a source replacement during an asynchronous read', async () => {
  const id = 310031
  try {
    registerChunkTextReaderV1(id, async index => `原文${index}`)
    const captured = captureChunkTextReaderV1(id)
    expect(await captured.read(0)).toBe('原文0'); expect(getChunkText(id, 0)).toBe('原文0')
    expect(await captured.read(1)).toBe('原文1'); expect(getChunkText(id, 0)).toBeUndefined()
    let release!: (value: string) => void
    registerChunkTextReaderV1(id, () => new Promise(resolve => { release = resolve }))
    const pending = captureChunkTextReaderV1(id).read(0)
    clearChunkTexts(id); release('迟到的原文')
    await expect(pending).rejects.toThrow('原文件已经替换')
    expect(getChunkText(id, 0)).toBeUndefined()
  } finally { clearChunkTexts(id) }
})
