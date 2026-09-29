import { describe, expect, it, vi } from 'vitest'
import { createProjectJSONBlob, readProjectJSONFile } from '../../src/lib/export/json-file'

function chunkedFile(text: string, chunkSize: number): Blob {
  const bytes = new TextEncoder().encode(text)
  return {
    stream: () => new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize))
        controller.close()
      },
    }),
  } as Blob
}

describe('project backup file serialization', () => {
  it('preserves metadata, table order, Unicode, escaping and rows across chunks', async () => {
    const data = {
      version: 14,
      project: { name: '潮钟群岛：最后的灯火', note: '"引号"\\路径\n🌊' },
      empty: [],
      records: Array.from({ length: 97 }, (_, id) => ({
        id, payloadJson: JSON.stringify({ nested: [{ text: '你望向灯塔。' }] }),
        optional: undefined, nullable: null,
      })),
      ownership: { workExportId: 0, worldExportId: 0 },
    }
    const original = JSON.stringify(data)
    const blob = createProjectJSONBlob(data)
    expect(blob.type).toBe('application/json')
    expect(await blob.text()).toBe(original)
    expect(JSON.stringify(data)).toBe(original)
  })

  it('never requires a single project-sized or table-sized JSON string', async () => {
    const data = { version: 14, records: Array.from({ length: 70 }, (_, id) => ({ id })) }
    const stringify = JSON.stringify
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation(((value: unknown) => {
      if (value === data || value === data.records) throw new RangeError('Invalid string length')
      return stringify(value)
    }) as typeof JSON.stringify)
    try {
      expect(JSON.parse(await createProjectJSONBlob(data).text())).toEqual(data)
    } finally {
      spy.mockRestore()
    }
  })

  it('fails before download for non-JSON records rather than omitting them', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => createProjectJSONBlob({ records: [cyclic] })).toThrow()
  })

  it.each([1, 2, 7, 31, 1024])('reads JSON split at arbitrary UTF-8/string/container boundaries (%i bytes)', async size => {
    const text = JSON.stringify({ version: 14, records: [null, false, 0, -125, '潮钟🌊"\\', [], {}, [1, { x: [2, 3] }]], empty: [], project: { text: 'line\nnext' }, ownership: null })
    expect(await readProjectJSONFile(chunkedFile(text, size))).toEqual(JSON.parse(text))
  })

  it('restores the exact serializer output without invoking a whole-file text read', async () => {
    const data = { records: Array.from({ length: 67 }, (_, id) => ({ id, text: '灯火。' })) }
    const blob = createProjectJSONBlob(data)
    const text = await blob.text()
    expect(await readProjectJSONFile(chunkedFile(text, 17))).toEqual(data)
  })

  it.each([
    '', '[]', '{', '{"x":', '{"x":1', '{"x":[1,]}', '{"x":1,}',
    '{"x":tru}', '{"x":01}', '{"x":"bad\\q"}', '{"x":[{]}',
    '{"x":1} trailing', '{"x":1,"x":2}', '{"x":1\u00a0}',
  ])('rejects malformed or ambiguous backups before import: %s', async text => {
    await expect(readProjectJSONFile(chunkedFile(text, 2))).rejects.toThrow()
  })

  it('preserves prototype-looking keys as data without changing the object prototype', async () => {
    const parsed = await readProjectJSONFile(chunkedFile('{"__proto__":{"polluted":true}}', 1))
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
