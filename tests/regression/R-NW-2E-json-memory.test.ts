import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { assertNarrativeJsonV1, boundedCanonicalNarrativeJsonV1, canonicalNarrativeJsonV1, canonicalNarrativeJsonWithHashV1, freezeNarrativeJsonV1, matchesCanonicalNarrativeJsonV1, compareUnicodeCodePointsV1, equalNarrativeJsonV1, hashNarrativeBytesV1, hashNarrativeValueV1, hashNarrativeValueWithoutKeysV1, narrativeUtf8ByteLengthV1 } from '../../src/lib/world-engine/narrative-json'

describe('NW-2E · 低临时分配的精确 JSON 合同（不是内存性能验收）', () => {
  it('长单字节身份与交错多字节标签的完整编码可立即解析、传输并核对摘要', () => {
    const rows = Array.from({ length: 1025 }, (_, index) => ({
      a: `${index}:` + 'identity:0123456789abcdef'.repeat(80),
      b: index % 2 ? 'é汉𐀀\r\n\\"' : 'latin-ÿ', c: [index, null, true],
    }))
    const expected = JSON.stringify(rows)
    const encoded = canonicalNarrativeJsonWithHashV1(rows)
    expect(encoded.json).toBe(expected)
    expect(JSON.parse(encoded.json)).toEqual(rows)
    expect(Buffer.from(encoded.json, 'utf8')).toEqual(Buffer.from(expected, 'utf8'))
    expect(encoded.hash).toBe(createHash('sha256').update(expected).digest('hex'))
    const bytes = Buffer.byteLength(expected)
    expect(boundedCanonicalNarrativeJsonV1(rows, bytes)).toBe(expected)
    expect(boundedCanonicalNarrativeJsonV1(rows, bytes - 1)).toBeNull()
  })

  it('大量不同键与重复转义字符串保持完整字节，后续调用不复用旧内容', async () => {
    // Insertion order below is already canonical: fieldNNNN < text < z.
    // Native JSON.stringify and Node SHA provide independent expected bytes.
    const rows = Array.from({ length: 1800 }, (_, index) => ({
      [`field${String(index).padStart(4, '0')}`]: `值${index}𐀀`,
      text: '桥𐀀e\u0301\r\n"\\', z: '__proto__',
    }))
    const expected = JSON.stringify(rows)
    expect(canonicalNarrativeJsonV1(rows)).toBe(expected)
    expect(canonicalNarrativeJsonWithHashV1(rows)).toEqual({
      json: expected, hash: createHash('sha256').update(expected).digest('hex'),
    })
    expect(await hashNarrativeValueV1(rows)).toBe(createHash('sha256').update(expected).digest('hex'))
    rows[0].text = '后改的原文'
    expect(canonicalNarrativeJsonV1(rows)).toBe(JSON.stringify(rows))
    expect(canonicalNarrativeJsonV1(rows)).not.toBe(expected)
  })

  it('一次规范编码同时得到完整字节与独立 SHA，跨分块和调用后修改不改变结果', () => {
    const text = '桥𐀀e\u0301\r\n"\\'.repeat(8000)
    const value = { z: text, a: [true, null, 1e-7], '\u{10000}': '后', '\ue000': '先' }
    const expected = `{"a":[true,null,1e-7],"z":${JSON.stringify(text)},"\ue000":"先","𐀀":"后"}`
    const encoded = canonicalNarrativeJsonWithHashV1(value)
    expect(encoded).toEqual({ json: expected, hash: createHash('sha256').update(expected).digest('hex') })
    value.z = '后改'
    expect(encoded.json).toBe(expected)
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    let invoked = false
    const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { invoked = true; return 1 } })
    for (const bad of [cycle, accessor, [undefined], Array(1), { x: -0 }, { x: '\ud800' }]) {
      expect(() => canonicalNarrativeJsonWithHashV1(bad)).toThrow()
    }
    expect(invoked).toBe(false)
  })

  it('深冻结 JSON 凭据保留规范字节，普通冻结、嵌套非法值及克隆不获得信任', async () => {
    const shared = { text: '桥𐀀e\u0301', revisionHash: 'nested' }
    const value = { z: [shared, shared], a: { revisionHash: 'root' } }
    const before = canonicalNarrativeJsonV1(value)
    expect(freezeNarrativeJsonV1(value)).toBe(value)
    expect(Object.isFrozen(shared)).toBe(true)
    expect(Object.isFrozen(value.z)).toBe(true)
    expect(() => { shared.text = 'modified' }).toThrow()
    expect(canonicalNarrativeJsonV1(value)).toBe(before)
    expect(await hashNarrativeValueV1(value)).toBe(createHash('sha256').update(before).digest('hex'))
    expect(await hashNarrativeValueWithoutKeysV1(value, ['revisionHash'])).toBe(
      createHash('sha256').update('{"a":{},"z":[{"text":"桥𐀀é"},{"text":"桥𐀀é"}]}').digest('hex'))
    const clone = structuredClone(value)
    const cloneGetter = vi.fn(() => { throw Error('getter invoked') })
    Object.defineProperty(clone.z[0], 'text', { enumerable: true, get: cloneGetter })
    for (const check of [assertNarrativeJsonV1, canonicalNarrativeJsonV1, freezeNarrativeJsonV1]) {
      expect(() => check(clone)).toThrow()
      expect(cloneGetter).not.toHaveBeenCalled()
    }
    let invoked = false
    const frozenAccessor = Object.freeze(Object.defineProperty({}, 'x', { enumerable: true, get() { invoked = true; return 1 } }))
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    for (const bad of [frozenAccessor, Object.freeze({ child: { x: undefined } }),
      Object.freeze({ x: '\ud800' }), Object.freeze({ x: -0 }), Object.freeze(new Date()),
      Object.freeze(Array(1)), Object.freeze(Object.assign([1], { extra: 2 })), cycle]) {
      expect(() => freezeNarrativeJsonV1(bad)).toThrow()
      expect(() => assertNarrativeJsonV1(bad)).toThrow()
    }
    expect(invoked).toBe(false)
  })
  it('规范原字节核对区分等值但不规范的键序、转义、重复键、空白及数值写法', () => {
    const value = { z: ['桥', 1e-7, 0], a: true }
    const canonical = '{"a":true,"z":["桥",1e-7,0]}'
    expect(matchesCanonicalNarrativeJsonV1(value, canonical)).toBe(true)
    for (const text of ['{"z":["桥",1e-7,0],"a":true}', '{"a":true,"z":["\\u6865",1e-7,0]}',
      '{"a":false,"a":true,"z":["桥",1e-7,0]}', '{"a":true,"z":["桥",0.0000001,0]}',
      '{"a":true,"z":["桥",1e-7,-0]}', ` ${canonical}`, `${canonical}\n`, canonical.slice(0, -1)]) {
      expect(matchesCanonicalNarrativeJsonV1(value, text)).toBe(false)
    }
  })

  it('原字节早期不匹配仍拒绝后部非法值和访问器，不执行 getter', () => {
    let invoked = false
    const invalid = Object.defineProperty({ a: 1 }, 'z', { enumerable: true, get() { invoked = true; return 'private' } })
    const cyclic: Record<string, unknown> = { a: 1 }; cyclic.z = cyclic
    for (const value of [invalid, cyclic, { a: 1, z: '\ud800' }, { a: 1, z: NaN }, { a: 1, z: undefined }]) {
      expect(() => matchesCanonicalNarrativeJsonV1(value, '{}')).toThrow()
    }
    expect(invoked).toBe(false)
  })

  it('百万字符原文、星界键序和末尾差异保持精确，调用不改变输入', () => {
    const long = '桥𐀀e\u0301\r\n"\\'.repeat(125_000)
    const value = { '\u{10000}': long, '\ue000': [true, null] }
    const text = `{"\ue000":[true,null],"𐀀":${JSON.stringify(long)}}`
    expect(matchesCanonicalNarrativeJsonV1(value, text)).toBe(true)
    expect(matchesCanonicalNarrativeJsonV1(value, text.slice(0, -1) + ']')).toBe(false)
    expect(value['\u{10000}']).toBe(long)
    expect(Object.keys(value)).toEqual(['𐀀', '\ue000'])
  })

  it('省略递归版本键的摘要保留键序、空对象和数组元素，与独立固定字节答案一致', async () => {
    const input = { z: '修订𐀀', revisionHash: 'old', a: { revisionVectorHash: 'vector', kept: true, revisionHash: 'nested' },
      values: [{ revisionHash: 'only' }, { revisionHashText: 'revisionHash' }, 3], revisionVectorHash: 'root-vector' }
    const original = structuredClone(input)
    const bytes = '{"a":{"kept":true},"values":[{},{"revisionHashText":"revisionHash"},3],"z":"修订𐀀"}'
    const pending = hashNarrativeValueWithoutKeysV1(input, ['revisionHash', 'revisionVectorHash'])
    expect(input).toEqual(original)
    input.z = '调用之后的修改'
    expect(await pending).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(await hashNarrativeValueWithoutKeysV1(original, [])).toBe(await hashNarrativeValueV1(original))
  })

  it('摘要省略字段仍验证完整 JSON，不隐藏非法值、循环或访问器', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.revisionHash = cyclic
    let invoked = false
    const accessor = Object.defineProperty({}, 'revisionHash', { enumerable: true, get: () => { invoked = true; return 'hidden' } })
    for (const input of [{ revisionHash: undefined }, { revisionHash: NaN }, { revisionHash: '\ud800' }, cyclic, accessor]) {
      expect(() => hashNarrativeValueWithoutKeysV1(input, ['revisionHash'])).toThrow()
    }
    expect(invoked).toBe(false)
  })

  it('原生 BMP 快速排序与码点顺序相同，跨 BMP/星界、共同前缀和组合字符不倒置', () => {
    const values = ['', 'a', 'aa', 'a\u{10000}', 'a\uffff', 'é', 'e\u0301', '桥', '\ud7ff', '\ue000', '\uffff', '\u{10000}', '\u{1f511}', '\u{10ffff}']
    const scalarOrder = (a: string, b: string) => {
      const left = Array.from(a, value => value.codePointAt(0)!), right = Array.from(b, value => value.codePointAt(0)!)
      for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i])
      return Math.sign(left.length - right.length)
    }
    for (const left of values) for (const right of values) expect(Math.sign(compareUnicodeCodePointsV1(left, right))).toBe(scalarOrder(left, right))
  })

  it('跨缓冲边界保留原始 Unicode、转义、码点键序和数组顺序', () => {
    const text = ('桥\r\n𐀀e\u0301"\\').repeat(8000)
    const value = { '\u{10000}': text, '\ue000': 'é', a: [1e-7, 0, 'first', 'last'] }
    const expected = `{"a":[1e-7,0,"first","last"],"\ue000":"é","𐀀":${JSON.stringify(text)}}`
    expect(canonicalNarrativeJsonV1(value)).toBe(expected)
    expect(() => assertNarrativeJsonV1(value)).not.toThrow()
    expect(equalNarrativeJsonV1(value, JSON.parse(expected))).toBe(true)
  })

  it('对象键序可不同，有序数组、Unicode、数值类型和缺失字段不得混同', () => {
    expect(equalNarrativeJsonV1({ b: 2, a: [1, 2] }, { a: [1, 2], b: 2 })).toBe(true)
    for (const pair of [[['a', 'b'], ['b', 'a']], ['é', 'e\u0301'], [1, '1'], [{ a: null }, {}], [[], {}]]) {
      expect(equalNarrativeJsonV1(pair[0], pair[1])).toBe(false)
    }
    const shared = { text: '同一引用可出现两次' }
    expect(equalNarrativeJsonV1([shared, shared], [{ ...shared }, { ...shared }])).toBe(true)
  })

  it.each([undefined, NaN, Infinity, -0, Number.MAX_SAFE_INTEGER + 1, 1n, Symbol('x'), () => 1, new Date(), '\ud800', '\udc00'])(
    '编码、纯校验和相等判断均拒绝非精确 JSON：%s', value => {
      expect(() => canonicalNarrativeJsonV1({ value })).toThrow()
      expect(() => assertNarrativeJsonV1({ value })).toThrow()
      expect(() => equalNarrativeJsonV1({ value }, { value })).toThrow()
      expect(() => hashNarrativeValueV1({ value })).toThrow()
    },
  )

  it('拒绝循环、稀疏/附加属性数组，校验不能执行 accessor 或自定义 iterator', () => {
    let invoked = false
    const accessor = Object.defineProperty({}, 'data', { enumerable: true, get() { invoked = true; return 'secret' } })
    const arrayAccessor = Object.defineProperty([0], '0', { enumerable: true, get() { invoked = true; return 'secret' } })
    const iterable = Object.assign([1], { [Symbol.iterator]: function* () { invoked = true; yield 'secret' } })
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    for (const value of [accessor, arrayAccessor, iterable, cycle, Array(1), Object.assign([1], { extra: 2 })]) {
      expect(() => canonicalNarrativeJsonV1(value)).toThrow()
      expect(() => assertNarrativeJsonV1(value)).toThrow()
      expect(() => equalNarrativeJsonV1(value, value)).toThrow()
      expect(() => hashNarrativeValueV1(value)).toThrow()
    }
    expect(invoked).toBe(false)
  })

  it('分段 SHA-256 与独立 Node 实现及已知答案一致，保留 Unicode 和 byte-view 边界', async () => {
    const reference = (input: string | Uint8Array) => createHash('sha256').update(input).digest('hex')
    expect(await hashNarrativeBytesV1('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await hashNarrativeBytesV1('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
    const unicode = 'a'.repeat(32_767) + '𐀀桥\u0301\r\n"\\\ufeff'.repeat(9000)
    for (const input of ['', 'a'.repeat(55), 'b'.repeat(64), 'c'.repeat(65), unicode,
      Uint8Array.from({ length: 100_000 }, (_, index) => index % 256).subarray(7, 99_999)]) {
      expect(await hashNarrativeBytesV1(input)).toBe(reference(input))
    }
    const value = { '\u{10000}': unicode, '\ue000': [null, true, 1e-7, '\u0000'], a: { z: 1, a: false } }
    expect(await hashNarrativeValueV1(value)).toBe(reference(canonicalNarrativeJsonV1(value)))
    for (const value of ['\ud800', '\udc00']) await expect(hashNarrativeBytesV1(value)).rejects.toThrow()
  })

  it('大对象直接摘要不构建整份 UTF-8 副本，调用后修改输入不能改变已计算摘要', async () => {
    const value = { a: '桥𐀀'.repeat(100_000), b: Array.from({ length: 5000 }, (_, id) => ({ id, text: '原文' })) }
    const expected = createHash('sha256').update(canonicalNarrativeJsonV1(value)).digest('hex')
    const encode = vi.spyOn(TextEncoder.prototype, 'encodeInto')
    try {
      const pending = hashNarrativeValueV1(value)
      value.a = '后改的原文'
      expect(await pending).toBe(expected)
      expect(encode.mock.calls.length).toBeGreaterThan(1)
      expect(encode.mock.calls.every(([text, buffer]) => text.length <= 32_768 && buffer.byteLength <= 32_768)).toBe(true)
      expect(new Set(encode.mock.calls.map(([, buffer]) => buffer)).size).toBeLessThan(encode.mock.calls.length)
    } finally { encode.mockRestore() }
    const bytes = new Uint8Array([0, 1, 2, 3])
    const reference = createHash('sha256').update(bytes).digest('hex')
    const pending = hashNarrativeBytesV1(bytes)
    bytes.fill(255)
    expect(await pending).toBe(reference)
  })

  it('缓存编码以真实 UTF-8 字节为界；拒绝超限，不把截断前缀交付为完整 JSON', () => {
    const value = { a: '桥𐀀e\u0301\r\n"\\'.repeat(8000), b: ['é', null] }
    const canonical = canonicalNarrativeJsonV1(value), bytes = new TextEncoder().encode(canonical).byteLength
    expect(narrativeUtf8ByteLengthV1(canonical)).toBe(bytes)
    expect(boundedCanonicalNarrativeJsonV1(value, bytes)).toBe(canonical)
    expect(boundedCanonicalNarrativeJsonV1(value, bytes - 1)).toBeNull()
    expect(boundedCanonicalNarrativeJsonV1(value, 0)).toBeNull()
    for (const invalid of [-1, 1.5, NaN, Infinity]) expect(() => boundedCanonicalNarrativeJsonV1({}, invalid)).toThrow()
    for (const invalid of ['\ud800', '\udc00']) expect(() => narrativeUtf8ByteLengthV1(invalid)).toThrow()
    expect(() => boundedCanonicalNarrativeJsonV1({ missing: undefined }, 1000)).toThrow()
  })
})
