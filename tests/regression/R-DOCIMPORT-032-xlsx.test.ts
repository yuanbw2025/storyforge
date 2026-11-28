import { describe, expect, it, vi } from 'vitest'
import { ACCEPT_ATTR, extractTextFromFile } from '../../src/lib/doc-parser'
import { extractXlsxTextV1 } from '../../src/lib/import/xlsx-text'
import { xlsxImportFixtureV1 } from '../fixtures/xlsx-import'

function source(bytes: Uint8Array, name = '人物资料.xlsx'): File {
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer } as File
}
// Native XML namespace/malformed-XML behavior is exercised in the corresponding
// isolated Chromium test, not happy-dom's permissive HTML-backed XML emulation.
describe('032 XLSX archive admission', () => {
  it('advertises XLSX and rejects obsolete binary/macro formats with a usable conversion path', async () => {
    expect(ACCEPT_ATTR).toContain('.xlsx')
    for (const ext of ['xls', 'xlsm', 'xlsb']) await expect(extractTextFromFile(source(new Uint8Array(), `旧表.${ext}`))).rejects.toThrow('无宏 .xlsx')
  })
  it('rejects corrupt, encrypted and excessive expanded archives before XML parsing', async () => {
    await expect(extractXlsxTextV1(source(new Uint8Array([0, 1, 2])))).rejects.toThrow('XLSX')
    const bytes = await xlsxImportFixtureV1(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let entry = -1
    for (let i = 0; i + 46 < bytes.length; i++) if (view.getUint32(i, true) === 0x02014b50) { entry = i; break }
    expect(entry).toBeGreaterThan(0)
    view.setUint16(entry + 8, 1, true)
    await expect(extractXlsxTextV1(source(bytes))).rejects.toThrow('加密')
    view.setUint16(entry + 8, 0, true); view.setUint32(entry + 24, 17 * 1024 * 1024, true)
    await expect(extractXlsxTextV1(source(bytes))).rejects.toThrow('展开内容超过')
    const noRead = vi.fn()
    await expect(extractXlsxTextV1({ name: 'big.xlsx', size: 11 * 1024 * 1024, arrayBuffer: noRead } as unknown as File)).rejects.toThrow('10 MB')
    expect(noRead).not.toHaveBeenCalled()
  })
  it('aborts before reading and after a pending native file read without partial text', async () => {
    const controller = new AbortController(); controller.abort()
    const noRead = vi.fn()
    await expect(extractXlsxTextV1({ size: 1, arrayBuffer: noRead } as unknown as File, controller.signal)).rejects.toHaveProperty('name', 'AbortError')
    expect(noRead).not.toHaveBeenCalled()
    const other = new AbortController(), bytes = await xlsxImportFixtureV1()
    const file = { size: bytes.length, arrayBuffer: async () => { other.abort(); return bytes.buffer } } as File
    await expect(extractXlsxTextV1(file, other.signal)).rejects.toHaveProperty('name', 'AbortError')
  })
})
