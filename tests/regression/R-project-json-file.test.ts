import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
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

  it('reads an actual streamed record beyond the former 128 MiB character ceiling without a whole-file text read', async () => {
    const bodyLength = 128 * 1024 * 1024 + 1
    const head = '【首部】', tail = '【尾部】'
    const encoder = new TextEncoder(), block = encoder.encode('x'.repeat(64 * 1024))
    const prefix = encoder.encode('{"records":[{"payload":"' + head)
    const suffix = encoder.encode(tail + '"}]}')
    const expected = createHash('sha256').update(head)
    for (let offset = 0; offset < bodyLength; offset += block.length) {
      expected.update(block.subarray(0, Math.min(block.length, bodyLength - offset)))
    }
    expected.update(tail)
    let phase = 0, remaining = bodyLength
    const text = vi.fn(() => { throw new Error('whole-file text must not be used') })
    const file = {
      text,
      stream: () => new ReadableStream<Uint8Array>({
        pull(controller) {
          if (phase === 0) { phase = 1; controller.enqueue(prefix); return }
          if (remaining > 0) {
            const length = Math.min(remaining, block.length)
            controller.enqueue(block.subarray(0, length)); remaining -= length; return
          }
          if (phase === 1) { phase = 2; controller.enqueue(suffix); return }
          controller.close()
        },
      }),
    } as unknown as Blob
    const parsed = await readProjectJSONFile(file)
    if (!parsed || typeof parsed !== 'object' || !('records' in parsed) || !Array.isArray(parsed.records)) {
      throw new Error('Full record array missing')
    }
    const first: unknown = parsed.records[0]
    if (!first || typeof first !== 'object' || !('payload' in first) || typeof first.payload !== 'string') {
      throw new Error('Full record payload missing')
    }
    expect(first.payload.length).toBe(bodyLength + head.length + tail.length)
    expect(first.payload.slice(0, head.length)).toBe(head)
    expect(first.payload.slice(-tail.length)).toBe(tail)
    expect(createHash('sha256').update(first.payload).digest('hex')).toBe(expected.digest('hex'))
    expect(text).not.toHaveBeenCalled()
  }, 60_000)

  it('preserves prototype-looking keys as data without changing the object prototype', async () => {
    const parsed = await readProjectJSONFile(chunkedFile('{"__proto__":{"polluted":true}}', 1))
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(parsed, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})
