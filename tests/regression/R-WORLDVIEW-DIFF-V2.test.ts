import { describe, expect, it, vi } from 'vitest'
import {
  DIFF_BUDGET_V2, assertWorldviewDiffExactV2, diffWorldviewTextExactV2,
  isSafeDiffBoundaryV2, reconstructDiffSideV2, validateDiffBudgetV2,
  type DiffInputV2, type DiffResultV2,
} from '../../src/lib/agent/worldview-text-diff-v2'
const segmentation = { kind: 'intl-grapheme', version: 1, locale: 'zh' } as const
function check(left: string, right: string, options: Partial<DiffInputV2> = {}) {
  const result = diffWorldviewTextExactV2({ left, right, segmentation, ...options })
  assertWorldviewDiffExactV2(left, right, result)
  expect(reconstructDiffSideV2(left, result, 'left')).toBe(left)
  expect(reconstructDiffSideV2(right, result, 'right')).toBe(right)
  for (const [side, raw] of [['left', left], ['right', right]] as const) {
    const occurrences = result.rows.flatMap(r => r[side === 'left' ? 'leftRefs' : 'rightRefs'].map(ref => raw.slice(...ref.range))).join('')
    expect(occurrences).toBe(raw)
    for (const row of result.rows) for (const offset of row[side]) expect(isSafeDiffBoundaryV2(raw, offset)).toBe(true)
  }
  return result
}
const editText = (r: DiffResultV2, raw: string, kind: 'remove' | 'add') => r.ops.filter(o => o.kind === kind).map(o => raw.slice(...o[kind === 'remove' ? 'left' : 'right'])).join('')
describe('054-A exact canonical diff', () => {
  it.each([
    ['', ''], ['', ' \r\n'], ['\t\n', ''], ['Harbor', 'harbor'], ['Ａ港', 'A港'], ['港  口', '港 口'],
    ['港\r\n城', '港\n城'], ['a\r', 'a\r\n'], ['末尾\n', '末尾'], ['a\n\n\n', 'a\n\n'],
    ['👩🏽‍🚀e\u0301🇨🇳', '👩🏽‍🚀é🇺🇸'], ['a\ud800b\udc00', 'a\ufffdb\udc00'], ['x\0y', 'x\0z'],
    ['一行\n二行\n三行\n', '二行\n一行\n三行\n'], ['重复\n重复\n尾', '重复\n新增\n重复\n尾'],
    ['|甲|乙|\n|1|2|\n', '|甲|乙|\n|1|3|\n'],
  ])('exactly reconstructs raw case %j → %j', (left, right) => {
    const r = check(left, right)
    expect(diffWorldviewTextExactV2({ left, right, segmentation })).toEqual(r)
    if (left !== right) { expect(r.ops.some(o => o.kind !== 'equal')).toBe(true); expect(r.rows.every(row => row.kind === 'unchanged')).toBe(false) }
  })
  it('keeps three inserted quotation blocks at their actual middle offsets with left padding', () => {
    const paragraphs = ['## 港口\n守夜人沿堤巡查，所有船只按潮序进港。\n', '\n## 议席\n仲裁须有两名证人。\n', '\n## 尾声\n钟响之后城门关闭。\n']
    const blocks = ['> 因果约束：潮闸关闭后不可入港。\n', '> 势力关联：领航员受议席监督。\n', '> 剧情伏笔：盐灯里藏着旧名册。\n']
    const left = paragraphs.join(''), right = paragraphs.map((p, i) => p + blocks[i]).join('')
    const r = check(left, right)
    expect(r.coarseReasons).toEqual([])
    expect(editText(r, left, 'remove')).toBe('')
    expect(editText(r, right, 'add')).toBe(blocks.join(''))
    let offset = 0
    for (let i = 0; i < paragraphs.length; i++) {
      offset += paragraphs[i].length
      const added = r.rows.find(row => row.kind === 'added' && row.right[0] === offset)
      expect(added).toBeDefined(); expect(added!.left[0]).toBe(added!.left[1]); expect(added!.leftRefs).toEqual([])
      expect(right.slice(...added!.right)).toBe(blocks[i]); offset += blocks[i].length
    }
    expect(r.rows.filter(row => row.kind === 'unchanged').map(row => left.slice(...row.left)).join('')).toBe(left)
  })
  it('shrinks a >4096-grapheme paragraph before a small inline insertion', () => {
    const before = '潮门守夜。'.repeat(510), after = '船只依序进港。'.repeat(440)
    const insertion = '【因果约束：先闭闸再点灯】', left = before + after, right = before + insertion + after
    const r = check(left, right)
    expect(r.coarseReasons).toEqual([])
    expect(r.ops.map(op => op.kind)).toEqual(['equal', 'add', 'equal'])
    expect(r.ops[1].left).toEqual([before.length, before.length])
    expect(r.ops[1].right).toEqual([before.length, before.length + insertion.length])
  })
  it('does not split a grapheme when a matching prefix ends inside it', () => {
    const r = check('Ae\u0301B👩🏽‍🚀C', 'Ae\u0300B👩🏽‍🚒C')
    expect(editText(r, 'Ae\u0301B👩🏽‍🚀C', 'remove')).toBe('e\u0301👩🏽‍🚀')
  })
  it('uses missing/unavailable/malformed/replayed segmentation only as declared coarse ranges', () => {
    const left = '👩🏽‍🚀\r\n尾', right = '👩🏽‍🚒\r\n尾'
    const coarse = check(left, right, { segmentation: undefined })
    expect(coarse.profile).toBeNull(); expect(coarse.coarseReasons).toContain('segmentation-unavailable')
    const actual = check(left, right).profile!
    expect(check(left, right, { segmentation: { ...segmentation, expected: actual } }).profile).toEqual(actual)
    const sparse = [0, 1, left.length]; delete sparse[1]
    for (const breaks of [[0, 1, left.length], [0, NaN, left.length], [0, Infinity, left.length], [0, 0, left.length], [0, -1, left.length], [0, left.indexOf('\n'), left.length], sparse, [0, left.length + 1]]) {
      const r = check(left, right, { segmentation: { ...segmentation, expected: { ...actual, left: breaks } } })
      expect(r.profile).toBeNull(); expect(r.coarseReasons.length).toBeGreaterThan(0)
    }
    const r = check(left, right, { segmentation: { ...segmentation, expected: { ...actual, left: [0, left.length] } } })
    expect(r.profile).toBeNull(); expect(r.coarseReasons).toContain('segmentation-replay-mismatch')
    const spy = vi.spyOn(Intl, 'Segmenter').mockImplementation(() => { throw new Error('unavailable') })
    try { expect(check(left, right).profile).toBeNull() } finally { spy.mockRestore() }
  })
  it.each(['maxScanUnits', 'maxAnchorUnits', 'maxDiffSteps', 'maxTraceCells'] as const)('exhausting %s retains full coverage', key => {
    const r = check('甲\n乙\n旧', '新\n乙\n丙', { budget: { ...DIFF_BUDGET_V2, [key]: 0 } })
    expect(r.coarseReasons.length).toBeGreaterThan(0)
    expect(r.work[{ maxScanUnits: 'scan', maxAnchorUnits: 'anchor', maxDiffSteps: 'diff', maxTraceCells: 'trace' }[key] as keyof typeof r.work]).toBe(0)
  })
  it.each([{ maxGapTokens: 1 }, { maxOps: 2 }, { maxRows: 1 }])('output/gap budget %j cannot duplicate partial output', override => {
    const r = check('abc甲def乙ghi', 'abc新def改ghi', { budget: { ...DIFF_BUDGET_V2, ...override } })
    expect(r.coarseReasons.length).toBeGreaterThan(0)
  })
  it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER])('rejects invalid numeric budget %s', n => {
    expect(() => validateDiffBudgetV2({ ...DIFF_BUDGET_V2, maxDiffSteps: n })).toThrow()
  })
  it('rejects incomplete/unknown budget shape and invalid minimum output limits', () => {
    for (const b of [{}, { ...DIFF_BUDGET_V2, extra: 1 }, { ...DIFF_BUDGET_V2, maxOps: 1 }, { ...DIFF_BUDGET_V2, maxRows: 0 }]) expect(() => validateDiffBudgetV2(b)).toThrow()
  })
  it('property: fixed-seed mixed Unicode mutations preserve every occurrence once', () => {
    let seed = 54817
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed }
    const units = ['甲', '乙', '\r\n', '\n', ' ', '\t', '👩🏽‍🚀', 'e\u0301', '\ud800', '\ufffd', '|', 'A', 'Ａ']
    for (let n = 0; n < 140; n++) {
      const a = Array.from({ length: random() % 45 }, () => units[random() % units.length]), b = [...a]
      for (let j = 0; j < 8; j++) b.splice(random() % (b.length + 1), random() % 3, units[random() % units.length])
      check(a.join(''), b.join(''))
    }
  })
  it('position links are annotations only and duplicated lines cannot claim unique movement', () => {
    const left = '甲甲\n乙乙\n丙丙\n丁丁\n', right = '丙丙\n甲甲\n乙乙\n丁丁\n'
    const r = check(left, right)
    expect(r.positionLinks.length).toBeGreaterThan(0)
    for (const link of r.positionLinks) expect(left.slice(...link.left)).toBe(right.slice(...link.right))
    expect(check('甲甲\n甲甲\n乙乙\n', '甲甲\n乙乙\n甲甲\n').positionLinks).toEqual([])
  })
  it('annotation validation rejects an unchanged line mislabeled as movement or repeated annotation', () => {
    const left = '甲甲\n乙乙\n丙丙\n丁丁\n', right = '丙丙\n甲甲\n乙乙\n丁丁\n', r = check(left, right)
    const duplicate = structuredClone(r); duplicate.positionLinks.push(duplicate.positionLinks[0])
    expect(() => assertWorldviewDiffExactV2(left, right, duplicate)).toThrow()
    const unchanged = structuredClone(r); unchanged.positionLinks = [{ left: [0, 3], right: [3, 6], kind: 'unique-exact-text' }]
    expect(() => assertWorldviewDiffExactV2(left, right, unchanged)).toThrow()
  })
  it('rejects tampered canonical partitions, alignment duplication, unsafe cuts and counters', () => {
    const left = 'a👩🏽‍🚀b\r\nc', right = 'a👩🏽‍🚀x\r\nc', r = check(left, right)
    const mutations: Array<(r: DiffResultV2) => void> = [
      x => { x.ops[0].left = [1, x.ops[0].left[1]] },
      x => { x.ops[0].left = [0, 2] },
      x => { x.ops[0].kind = 'add' },
      x => { x.rows[0].leftRefs.push(x.rows[0].leftRefs[0]) },
      x => { x.rows[0].kind = 'added' },
      x => { x.rows[0].right = [0, right.length] },
      x => { x.work.diff = Infinity },
      x => { x.profile!.left = [0, 2, left.length] },
      x => { x.positionLinks.push({ left: [0, 1], right: [right.length - 1, right.length], kind: 'unique-exact-text' }) },
    ]
    for (const mutate of mutations) { const clone = structuredClone(r); mutate(clone); expect(() => assertWorldviewDiffExactV2(left, right, clone)).toThrow() }
  })
})
