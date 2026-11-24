/** Display-only exact diff. No persistence, adoption, model, DOM or wall clock.
 * Budgets bound work/allocations, not AI tokens. Coarse ranges still consume
 * every original code unit. Alignment is presentation, never semantic proof. */
export const WORLDVIEW_TEXT_DIFF_VERSION_V2 = 'worldview-exact-display-diff-v2' as const
export type DiffRangeV2 = readonly [number, number]
export interface DiffBudgetV2 {
  maxCodeUnits: number
  maxScanUnits: number
  maxAnchorUnits: number
  maxDiffSteps: number
  maxTraceCells: number
  maxGapTokens: number
  maxOps: number
  maxRows: number
}
export const DIFF_BUDGET_V2: Readonly<DiffBudgetV2> = Object.freeze({
  maxCodeUnits: 50_000, maxScanUnits: 2_000_000, maxAnchorUnits: 200_000,
  maxDiffSteps: 200_000, maxTraceCells: 200_000, maxGapTokens: 4096, maxOps: 8000, maxRows: 4000,
})
const HARD: DiffBudgetV2 = { maxCodeUnits: 50_000, maxScanUnits: 8_000_000, maxAnchorUnits: 2_000_000,
  maxDiffSteps: 8_000_000, maxTraceCells: 2_000_000, maxGapTokens: 4096, maxOps: 20_000, maxRows: 10_000 }
export interface DiffBoundaryProfileV2 {
  kind: 'intl-grapheme'
  locale: string
  left: readonly number[]
  right: readonly number[]
}
export interface DiffSegmentationRequestV2 {
  kind: 'intl-grapheme'
  version: 1
  locale: string
  /** A replay expectation, not a caller-minted proof. Checked against actual
   * runtime Intl boundaries; a different ICU/profile explicitly falls back. */
  expected?: DiffBoundaryProfileV2
}
export interface DiffInputV2 {
  left: string
  right: string
  budget?: DiffBudgetV2
  segmentation?: DiffSegmentationRequestV2
}
export interface DiffOpV2 { id: string; kind: 'equal' | 'remove' | 'add'; left: DiffRangeV2; right: DiffRangeV2 }
export interface DiffCellRefV2 { op: number; range: DiffRangeV2 }
export interface DiffRowV2 {
  id: string
  kind: 'unchanged' | 'modified' | 'removed' | 'added'
  left: DiffRangeV2
  right: DiffRangeV2
  leftRefs: DiffCellRefV2[]
  rightRefs: DiffCellRefV2[]
  precision: 'grapheme' | 'line' | 'whole'
}
export interface DiffResultV2 {
  version: typeof WORLDVIEW_TEXT_DIFF_VERSION_V2
  leftLength: number
  rightLength: number
  profile: DiffBoundaryProfileV2 | null
  budget: DiffBudgetV2
  ops: DiffOpV2[]
  rows: DiffRowV2[]
  positionLinks: Array<{ left: DiffRangeV2; right: DiffRangeV2; kind: 'unique-exact-text' }>
  annotationsComplete: boolean
  coarseReasons: string[]
  work: { scan: number; anchor: number; diff: number; trace: number }
}
class WorkLimit extends Error { constructor(readonly reason: string) { super(reason) } }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
export function validateDiffBudgetV2(value: unknown): DiffBudgetV2 {
  if (!record(value) || Object.keys(value).length !== Object.keys(HARD).length) throw new Error('Invalid diff budget')
  for (const key of Object.keys(HARD) as Array<keyof DiffBudgetV2>) {
    const n = value[key]
    const minimum = key === 'maxOps' ? 2 : key === 'maxRows' || key === 'maxGapTokens' ? 1 : 0
    if (!Number.isSafeInteger(n) || Number(n) < minimum || Number(n) > HARD[key]) throw new Error(`Invalid diff budget: ${key}`)
  }
  return { ...value } as unknown as DiffBudgetV2
}
export function isSafeDiffBoundaryV2(raw: string, offset: number): boolean {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > raw.length) return false
  if (!offset || offset === raw.length) return true
  const a = raw.charCodeAt(offset - 1), b = raw.charCodeAt(offset)
  return !(a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff) && !(a === 13 && b === 10)
}
function validBreaks(raw: string, value: unknown): value is readonly number[] {
  if (!Array.isArray(value) || value.length > raw.length + 1 || value[0] !== 0 || value[value.length - 1] !== raw.length) return false
  for (let i = 0; i < value.length; i++) if (!isSafeDiffBoundaryV2(raw, value[i]) || i > 0 && value[i] <= value[i - 1]) return false
  return true
}
interface Atom { start: number; end: number; text: string }
type AtomEdit = { kind: DiffOpV2['kind']; a?: Atom; b?: Atom }
/** Bounded Myers frontiers with a hard trace-cell cap. It does not allocate an
 * n*m matrix or claim universally linear time/space. */
function myers(a: Atom[], b: Atom[], spend: (kind: 'scan' | 'diff' | 'trace', n?: number) => void, maxTokens: number): AtomEdit[] {
  if (a.length > maxTokens || b.length > maxTokens) throw new WorkLimit('gap-token-limit')
  let previous = new Map<number, number>([[1, 0]])
  const trace: Map<number, number>[] = []
  for (let d = 0; d <= a.length + b.length; d++) {
    spend('trace', previous.size); trace.push(previous)
    const next = new Map<number, number>()
    for (let k = -d; k <= d; k += 2) {
      spend('diff')
      let x = k === -d || (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1))
        ? previous.get(k + 1) ?? 0 : (previous.get(k - 1) ?? 0) + 1
      let y = x - k
      while (x < a.length && y < b.length && x >= 0 && y >= 0) {
        spend('diff'); spend('scan', a[x].text.length + b[y].text.length)
        if (a[x].text !== b[y].text) break
        x++; y++
      }
      next.set(k, x)
      if (x >= a.length && y >= b.length) {
        const edits: AtomEdit[] = []; x = a.length; y = b.length
        for (let back = d; back >= 0; back--) {
          spend('diff'); const v = trace[back], diagonal = x - y
          const prevK = diagonal === -back || (diagonal !== back && (v.get(diagonal - 1) ?? -1) < (v.get(diagonal + 1) ?? -1)) ? diagonal + 1 : diagonal - 1
          const px = v.get(prevK) ?? 0, py = px - prevK
          while (x > px && y > py) { spend('diff'); edits.push({ kind: 'equal', a: a[--x], b: b[--y] }) }
          if (back) {
            if (x === px) edits.push({ kind: 'add', b: b[--y] })
            else edits.push({ kind: 'remove', a: a[--x] })
          }
        }
        if (x || y) throw new Error('Diff traceback did not reach origin')
        return edits.reverse()
      }
    }
    previous = next
  }
  throw new Error('Diff path unavailable')
}
export function diffWorldviewTextExactV2(input: DiffInputV2): DiffResultV2 {
  if (!input || typeof input.left !== 'string' || typeof input.right !== 'string') throw new Error('Diff sources must be raw strings')
  const { left, right } = input
  const budget = validateDiffBudgetV2(input.budget ?? DIFF_BUDGET_V2)
  const work = { scan: 0, anchor: 0, diff: 0, trace: 0 }
  const limits = { scan: budget.maxScanUnits, anchor: budget.maxAnchorUnits, diff: budget.maxDiffSteps, trace: budget.maxTraceCells }
  const spend = (kind: keyof typeof work, n = 1) => {
    if (!Number.isSafeInteger(n) || n < 0 || n > limits[kind] - work[kind]) throw new WorkLimit(`${kind}-limit`)
    work[kind] += n
  }
  const reasons = new Set<string>()
  let profile: DiffBoundaryProfileV2 | null = null
  const fallback = (reason: string): DiffResultV2 => {
    reasons.add(reason)
    const ops: DiffOpV2[] = []
    if (left.length) ops.push({ id: 'op-0', kind: 'remove', left: [0, left.length], right: [0, 0] })
    if (right.length) ops.push({ id: `op-${ops.length}`, kind: 'add', left: [left.length, left.length], right: [0, right.length] })
    const rows: DiffRowV2[] = ops.length ? [{ id: 'row-0', kind: left.length && right.length ? 'modified' : left.length ? 'removed' : 'added', left: [0, left.length], right: [0, right.length],
      leftRefs: ops.flatMap((op, i) => op.left[1] > op.left[0] ? [{ op: i, range: op.left }] : []), rightRefs: ops.flatMap((op, i) => op.right[1] > op.right[0] ? [{ op: i, range: op.right }] : []), precision: 'whole' }] : []
    return { version: WORLDVIEW_TEXT_DIFF_VERSION_V2, leftLength: left.length, rightLength: right.length, profile: null, budget,
      ops, rows, positionLinks: [], annotationsComplete: false, coarseReasons: [...reasons], work: { ...work } }
  }
  if (left.length > budget.maxCodeUnits || right.length > budget.maxCodeUnits) return fallback('input-size-limit')
  try {
    spend('scan', left.length + right.length)
    const lines = (raw: string): Atom[] => {
      const result: Atom[] = []; let start = 0
      for (let i = 0; i < raw.length; i++) {
        spend('scan')
        if (raw[i] !== '\r' && raw[i] !== '\n') continue
        if (raw[i] === '\r' && raw[i + 1] === '\n') { spend('scan'); i++ }
        result.push({ start, end: i + 1, text: raw.slice(start, i + 1) }); start = i + 1
      }
      if (start < raw.length) result.push({ start, end: raw.length, text: raw.slice(start) })
      return result
    }
    const lLines = lines(left), rLines = lines(right)
    const segmentation = input.segmentation as unknown
    const intl = Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: string }) => { segment(raw: string): Iterable<{ index: number; segment: string }>; resolvedOptions(): { locale: string } } }
    if (record(segmentation) && segmentation.kind === 'intl-grapheme' && segmentation.version === 1
      && typeof segmentation.locale === 'string' && segmentation.locale.length > 0 && segmentation.locale.length <= 128 && Object.keys(segmentation).every(k => ['kind', 'version', 'locale', 'expected'].includes(k)) && intl.Segmenter) {
      const expected = segmentation.expected
      if (record(expected)) for (const side of ['left', 'right']) if (Array.isArray(expected[side])) spend('scan', Math.min(expected[side].length, (side === 'left' ? left : right).length + 1))
      const expectedValid = expected === undefined || (record(expected) && expected.kind === 'intl-grapheme' && typeof expected.locale === 'string'
        && Object.keys(expected).every(k => ['kind', 'locale', 'left', 'right'].includes(k)) && validBreaks(left, expected.left) && validBreaks(right, expected.right))
      if (expectedValid) {
        try {
          const segmenter = new intl.Segmenter(segmentation.locale, { granularity: 'grapheme' })
          const breaks = (raw: string): number[] => {
            spend('scan', raw.length); const boundaries = [0]; let at = 0
            for (const item of segmenter.segment(raw)) {
              spend('scan', item.segment.length + 1)
              if (item.index !== at || !item.segment.length || item.segment !== raw.slice(at, at + item.segment.length)) throw new Error('Untrusted segmentation')
              at += item.segment.length; boundaries.push(at)
              if (!isSafeDiffBoundaryV2(raw, at)) throw new Error('Unsafe segmentation')
            }
            if (at !== raw.length || !validBreaks(raw, boundaries)) throw new Error('Incomplete segmentation')
            return boundaries
          }
          const actual: DiffBoundaryProfileV2 = { kind: 'intl-grapheme', locale: segmenter.resolvedOptions().locale, left: breaks(left), right: breaks(right) }
          const same = (a: readonly number[], b: unknown) => Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i])
          if (expected === undefined || (record(expected) && actual.locale === expected.locale && same(actual.left, expected.left) && same(actual.right, expected.right))) profile = actual
          else reasons.add('segmentation-replay-mismatch')
        } catch (error) { if (error instanceof WorkLimit) throw error; reasons.add('segmentation-unavailable') }
      } else reasons.add('invalid-segmentation-profile')
    } else reasons.add('segmentation-unavailable')
    const ops: DiffOpV2[] = [], draftRows: Array<{ left: DiffRangeV2; right: DiffRangeV2; precision: DiffRowV2['precision']; unchanged: boolean }> = []
    let lc = 0, rc = 0
    const emit = (kind: DiffOpV2['kind'], le: number, re: number) => {
      if (le === lc && re === rc) return
      const previous = ops[ops.length - 1]
      if (previous?.kind === kind) { previous.left = [previous.left[0], le]; previous.right = [previous.right[0], re] }
      else { if (ops.length >= budget.maxOps) throw new WorkLimit('output-op-limit'); ops.push({ id: `op-${ops.length}`, kind, left: [lc, le], right: [rc, re] }) }
      lc = le; rc = re
    }
    const row = (l: DiffRangeV2, r: DiffRangeV2, precision: DiffRowV2['precision'], unchanged = false) => {
      const previous = draftRows[draftRows.length - 1]
      if (unchanged && previous?.unchanged) { previous.left = [previous.left[0], l[1]]; previous.right = [previous.right[0], r[1]] }
      else { if (draftRows.length >= budget.maxRows) throw new WorkLimit('output-row-limit'); draftRows.push({ left: l, right: r, precision, unchanged }) }
    }
    const atoms = (raw: string, boundaries: readonly number[], start: number, end: number): Atom[] => {
      let lo = 0, hi = boundaries.length
      while (lo < hi) { spend('diff'); const mid = (lo + hi) >>> 1; if (boundaries[mid] < start) lo = mid + 1; else hi = mid }
      if (boundaries[lo] !== start) throw new WorkLimit('unsafe-gap-boundary')
      const result: Atom[] = []
      for (let i = lo; boundaries[i] < end; i++) {
        if (result.length >= budget.maxGapTokens || boundaries[i + 1] > end) throw new WorkLimit('gap-token-limit')
        spend('scan', boundaries[i + 1] - boundaries[i]); result.push({ start: boundaries[i], end: boundaries[i + 1], text: raw.slice(boundaries[i], boundaries[i + 1]) })
      }
      return result
    }
    const boundarySets = profile ? { left: new Set(profile.left), right: new Set(profile.right) } : null
    // Equal runs get their own rows. Padding belongs only to a changed row's
    // empty side; it is never a fabricated text occurrence.
    const emitEdits = (edits: AtomEdit[]) => {
      let i = 0
      while (i < edits.length) {
        const unchanged = edits[i].kind === 'equal', lStart = lc, rStart = rc
        do {
          const e = edits[i++]; emit(e.kind, e.a?.end ?? lc, e.b?.end ?? rc)
        } while (i < edits.length && (edits[i].kind === 'equal') === unchanged)
        row([lStart, lc], [rStart, rc], 'grapheme', unchanged)
      }
    }
    const changed = (le: number, re: number) => {
      if (lc === le && rc === re) return
      let prefix = 0, suffix = 0
      if (profile && boundarySets) {
        // Shrink long, mostly unchanged physical paragraphs before token limits.
        // Equality is UTF-16 exact; cut only at both runtime grapheme boundaries.
        while (lc + prefix < le && rc + prefix < re) {
          spend('scan', 2)
          if (left.charCodeAt(lc + prefix) !== right.charCodeAt(rc + prefix)) break
          prefix++
        }
        while (prefix && (!boundarySets.left.has(lc + prefix) || !boundarySets.right.has(rc + prefix))) { spend('scan'); prefix-- }
        while (le - suffix > lc + prefix && re - suffix > rc + prefix) {
          spend('scan', 2)
          if (left.charCodeAt(le - suffix - 1) !== right.charCodeAt(re - suffix - 1)) break
          suffix++
        }
        while (suffix && (!boundarySets.left.has(le - suffix) || !boundarySets.right.has(re - suffix))) { spend('scan'); suffix-- }
      }
      if (prefix) {
        const lStart = lc, rStart = rc
        emit('equal', lc + prefix, rc + prefix); row([lStart, lc], [rStart, rc], 'grapheme', true)
      }
      const lEnd = le - suffix, rEnd = re - suffix
      let edits: AtomEdit[] | null = null
      if (profile && lc < lEnd && rc < rEnd) {
        try { edits = myers(atoms(left, profile.left, lc, lEnd), atoms(right, profile.right, rc, rEnd), spend, budget.maxGapTokens) }
        catch (error) { if (!(error instanceof WorkLimit)) throw error; reasons.add(error.reason) }
      }
      if (edits) emitEdits(edits)
      else if (lc !== lEnd || rc !== rEnd) {
        const lStart = lc, rStart = rc
        emit('remove', lEnd, rc); emit('add', lc, rEnd)
        row([lStart, lc], [rStart, rc], profile && (lStart === lEnd || rStart === rEnd) ? 'grapheme' : 'line')
      }
      if (suffix) {
        const lStart = lc, rStart = rc
        emit('equal', le, re); row([lStart, lc], [rStart, rc], 'grapheme', true)
      }
    }
    const gap = (la: Atom[], ra: Atom[], le: number, re: number) => {
      let edits: AtomEdit[]
      try { edits = myers(la, ra, spend, budget.maxGapTokens) }
      catch (error) { if (!(error instanceof WorkLimit)) throw error; reasons.add(error.reason); changed(le, re); return }
      let i = 0
      while (i < edits.length) {
        if (edits[i].kind === 'equal') {
          const e = edits[i++], lStart = lc, rStart = rc
          emit('equal', e.a!.end, e.b!.end); row([lStart, lc], [rStart, rc], 'line', true)
        } else {
          let aEnd = lc, bEnd = rc
          while (i < edits.length && edits[i].kind !== 'equal') { const e = edits[i++]; aEnd = e.a?.end ?? aEnd; bEnd = e.b?.end ?? bEnd }
          changed(aEnd, bEnd)
        }
      }
    }
    const counts = (tokens: Atom[]) => {
      const result = new Map<string, { count: number; index: number }>()
      tokens.forEach((t, i) => { spend('anchor'); spend('scan', t.text.length); const old = result.get(t.text); result.set(t.text, { count: (old?.count ?? 0) + 1, index: i }) })
      return result
    }
    const lCounts = counts(lLines), rCounts = counts(rLines)
    const candidates: Array<{ l: number; r: number }> = []
    lLines.forEach((t, l) => { spend('anchor'); const a = lCounts.get(t.text), b = rCounts.get(t.text); if (a?.count === 1 && b?.count === 1) { spend('scan', t.text.length + rLines[b.index].text.length); if (t.text === rLines[b.index].text) candidates.push({ l, r: b.index }) } })
    const tails: number[] = [], predecessors: number[] = []
    candidates.forEach((candidate, i) => {
      let lo = 0, hi = tails.length
      while (lo < hi) { spend('anchor'); const mid = (lo + hi) >>> 1; if (candidates[tails[mid]].r < candidate.r) lo = mid + 1; else hi = mid }
      predecessors[i] = lo ? tails[lo - 1] : -1; tails[lo] = i
    })
    const anchors: Array<{ l: number; r: number }> = []
    for (let i = tails[tails.length - 1] ?? -1; i >= 0; i = predecessors[i]) anchors.push(candidates[i])
    anchors.reverse(); let li = 0, ri = 0
    for (const anchor of anchors) {
      gap(lLines.slice(li, anchor.l), rLines.slice(ri, anchor.r), lLines[anchor.l].start, rLines[anchor.r].start)
      const lStart = lc, rStart = rc; emit('equal', lLines[anchor.l].end, rLines[anchor.r].end); row([lStart, lc], [rStart, rc], 'line', true)
      li = anchor.l + 1; ri = anchor.r + 1
    }
    gap(lLines.slice(li), rLines.slice(ri), left.length, right.length)
    const pointers = { left: 0, right: 0 }
    const refs = (range: DiffRangeV2, side: 'left' | 'right'): DiffCellRefV2[] => {
      const result: DiffCellRefV2[] = []; let i = pointers[side]
      while (i < ops.length && ops[i][side][1] <= range[0]) { spend('anchor'); i++ }
      for (; i < ops.length && ops[i][side][0] < range[1]; i++) {
        spend('anchor'); const raw = ops[i][side], a = Math.max(raw[0], range[0]), b = Math.min(raw[1], range[1])
        if (b > a) result.push({ op: i, range: [a, b] })
      }
      // A merged equal operation can continue into the following row.
      pointers[side] = Math.max(0, i - 1); return result
    }
    const rows = draftRows.map((r, i): DiffRowV2 => ({ id: `row-${i}`, left: r.left, right: r.right, precision: r.precision,
      kind: r.unchanged ? 'unchanged' : r.left[0] === r.left[1] ? 'added' : r.right[0] === r.right[1] ? 'removed' : 'modified', leftRefs: refs(r.left, 'left'), rightRefs: refs(r.right, 'right') }))
    const positionLinks: DiffResultV2['positionLinks'] = []; let annotationsComplete = true
    try {
      for (const token of lLines) {
        spend('anchor'); const a = lCounts.get(token.text), b = rCounts.get(token.text)
        if (a?.count !== 1 || b?.count !== 1 || token.text.length < 2) continue
        spend('scan', token.text.length)
        if (!/[^\r\n\t ]/.test(token.text)) continue
        const target = rLines[b.index]
        const contains = (side: 'left' | 'right', range: DiffRangeV2, kind: DiffOpV2['kind']) => {
          let lo = 0, hi = ops.length
          while (lo < hi) { spend('anchor'); const mid = (lo + hi) >>> 1; if (ops[mid][side][1] <= range[0]) lo = mid + 1; else hi = mid }
          return ops[lo]?.kind === kind && ops[lo][side][0] <= range[0] && ops[lo][side][1] >= range[1]
        }
        if (contains('left', [token.start, token.end], 'remove') && contains('right', [target.start, target.end], 'add')) {
          spend('scan', token.text.length + target.text.length)
          if (positionLinks.length >= budget.maxOps) throw new WorkLimit('annotation-output-limit')
          if (token.text === target.text) positionLinks.push({ left: [token.start, token.end], right: [target.start, target.end], kind: 'unique-exact-text' })
        }
      }
    } catch (error) { if (!(error instanceof WorkLimit)) throw error; annotationsComplete = false; positionLinks.length = 0; reasons.add(error.reason) }
    // Reserve conservative verification work before validating the output.
    spend('scan', 6 * (left.length + right.length))
    spend('anchor', ops.length + rows.length + rows.reduce((n, r) => n + r.leftRefs.length + r.rightRefs.length, 0)
      + positionLinks.length * (2 * Math.ceil(Math.log2(ops.length + 1)) + 4))
    const result: DiffResultV2 = { version: WORLDVIEW_TEXT_DIFF_VERSION_V2, leftLength: left.length, rightLength: right.length,
      profile, budget, ops, rows, positionLinks, annotationsComplete, coarseReasons: [...reasons], work: { ...work } }
    assertWorldviewDiffExactV2(left, right, result); return result
  } catch (error) { if (!(error instanceof WorkLimit)) throw error; return fallback(error.reason) }
}

/** Structural proof of exact ranges/coverage only, not a claim of optimality,
 * historical movement, profile authentication, semantic quality or adoption. */
export function assertWorldviewDiffExactV2(left: string, right: string, result: DiffResultV2): void {
  if (result.version !== WORLDVIEW_TEXT_DIFF_VERSION_V2 || result.leftLength !== left.length || result.rightLength !== right.length) throw new Error('Diff source binding mismatch')
  const budget = validateDiffBudgetV2(result.budget)
  if (result.ops.length > budget.maxOps || result.rows.length > budget.maxRows) throw new Error('Diff output limit')
  const limits = { scan: budget.maxScanUnits, anchor: budget.maxAnchorUnits, diff: budget.maxDiffSteps, trace: budget.maxTraceCells }
  for (const k of Object.keys(limits) as Array<keyof typeof limits>) if (!Number.isSafeInteger(result.work[k]) || result.work[k] < 0 || result.work[k] > limits[k]) throw new Error('Diff work limit')
  if (typeof result.annotationsComplete !== 'boolean' || !Array.isArray(result.coarseReasons) || result.coarseReasons.some(r => typeof r !== 'string')) throw new Error('Diff metadata invalid')
  if (result.profile && (result.profile.kind !== 'intl-grapheme' || typeof result.profile.locale !== 'string' || !validBreaks(left, result.profile.left) || !validBreaks(right, result.profile.right))) throw new Error('Diff profile bounds invalid')
  const breaks = result.profile ? { left: new Set(result.profile.left), right: new Set(result.profile.right) } : null
  const sources = { left, right }, cursor = { left: 0, right: 0 }
  const range = (raw: string, r: DiffRangeV2) => Array.isArray(r) && r.length === 2 && r[0] <= r[1] && isSafeDiffBoundaryV2(raw, r[0]) && isSafeDiffBoundaryV2(raw, r[1])
  for (let i = 0; i < result.ops.length; i++) {
    const op = result.ops[i]
    if (op.id !== `op-${i}` || !['equal', 'remove', 'add'].includes(op.kind)) throw new Error('Diff op invalid')
    for (const side of ['left', 'right'] as const) {
      if (!range(sources[side], op[side]) || op[side][0] !== cursor[side]) throw new Error('Diff partition has a gap/overlap')
      if (breaks && (!breaks[side].has(op[side][0]) || !breaks[side].has(op[side][1]))) throw new Error('Diff splits grapheme')
      cursor[side] = op[side][1]
    }
    const ll = op.left[1] - op.left[0], rl = op.right[1] - op.right[0]
    if (op.kind === 'equal' ? !ll || !rl || left.slice(...op.left) !== right.slice(...op.right)
      : op.kind === 'remove' ? !ll || !!rl : !rl || !!ll) throw new Error('Diff op text/type mismatch')
  }
  if (cursor.left !== left.length || cursor.right !== right.length) throw new Error('Diff partition incomplete')
  const consumed = { left: result.ops.map(op => op.left[0]), right: result.ops.map(op => op.right[0]) }, rowCursor = { left: 0, right: 0 }
  result.rows.forEach((row, i) => {
    if (row.id !== `row-${i}` || !['unchanged', 'modified', 'removed', 'added'].includes(row.kind) || !['grapheme', 'line', 'whole'].includes(row.precision)) throw new Error('Diff row invalid')
    for (const side of ['left', 'right'] as const) {
      if (!range(sources[side], row[side]) || row[side][0] !== rowCursor[side] || breaks && (!breaks[side].has(row[side][0]) || !breaks[side].has(row[side][1]))) throw new Error('Diff rows cross/gap')
      let at = row[side][0], lastOp = -1
      for (const ref of row[side === 'left' ? 'leftRefs' : 'rightRefs']) {
        const op = result.ops[ref.op]
        if (!Number.isSafeInteger(ref.op) || !op || ref.op < lastOp || !range(sources[side], ref.range) || ref.range[0] !== at
          || breaks && (!breaks[side].has(ref.range[0]) || !breaks[side].has(ref.range[1]))
          || ref.range[0] !== consumed[side][ref.op] || ref.range[1] > op[side][1] || ref.range[1] <= ref.range[0]) throw new Error('Diff row reference duplicates/crosses text')
        at = ref.range[1]; consumed[side][ref.op] = at; lastOp = ref.op
      }
      if (at !== row[side][1]) throw new Error('Diff row reference incomplete')
      rowCursor[side] = at
    }
    const ll = row.left[1] - row.left[0], rl = row.right[1] - row.right[0]
    if (!ll && !rl || row.kind === 'added' && (ll !== 0 || rl === 0) || row.kind === 'removed' && (rl !== 0 || ll === 0) || ['modified', 'unchanged'].includes(row.kind) && (!ll || !rl)) throw new Error('Diff row kind mismatch')
    if (row.precision === 'grapheme' && !result.profile) throw new Error('Diff row lacks segmentation')
    if (row.kind === 'unchanged' && (left.slice(...row.left) !== right.slice(...row.right)
      || [...row.leftRefs, ...row.rightRefs].some(ref => result.ops[ref.op].kind !== 'equal'))) throw new Error('Unchanged row is not exact')
  })
  for (const side of ['left', 'right'] as const) if (rowCursor[side] !== sources[side].length || consumed[side].some((at, i) => at !== result.ops[i][side][1])) throw new Error('Diff row coverage incomplete')
  if (result.positionLinks.length > budget.maxOps || !result.annotationsComplete && result.positionLinks.length) throw new Error('Invalid annotation output')
  if (result.positionLinks.length) {
    const lineOccurrences = (raw: string) => {
      const counts = new Map<string, { count: number; range: DiffRangeV2 }>(); let start = 0
      const add = (end: number) => { const text = raw.slice(start, end), previous = counts.get(text); counts.set(text, { count: (previous?.count ?? 0) + 1, range: [start, end] }); start = end }
      for (let i = 0; i < raw.length; i++) if (raw[i] === '\r' || raw[i] === '\n') { if (raw[i] === '\r' && raw[i + 1] === '\n') i++; add(i + 1) }
      if (start < raw.length) add(raw.length)
      return counts
    }
    const counts = { left: lineOccurrences(left), right: lineOccurrences(right) }, used = new Set<string>()
    const contains = (side: 'left' | 'right', r: DiffRangeV2, kind: DiffOpV2['kind']) => {
      let lo = 0, hi = result.ops.length
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (result.ops[mid][side][1] <= r[0]) lo = mid + 1; else hi = mid }
      return result.ops[lo]?.kind === kind && result.ops[lo][side][0] <= r[0] && result.ops[lo][side][1] >= r[1]
    }
    for (const link of result.positionLinks) {
      if (link.kind !== 'unique-exact-text' || !range(left, link.left) || !range(right, link.right)) throw new Error('Invalid position annotation')
      const text = left.slice(...link.left), a = counts.left.get(text), b = counts.right.get(text)
      if (text.length < 2 || !/[^\r\n\t ]/.test(text) || text !== right.slice(...link.right) || a?.count !== 1 || b?.count !== 1
        || a.range[0] !== link.left[0] || a.range[1] !== link.left[1] || b.range[0] !== link.right[0] || b.range[1] !== link.right[1] || used.has(text)
        || !contains('left', link.left, 'remove') || !contains('right', link.right, 'add')) throw new Error('Position annotation is not a unique exact removed/added line')
      used.add(text)
    }
  }
}
export function reconstructDiffSideV2(raw: string, result: DiffResultV2, side: 'left' | 'right'): string {
  return result.ops.map(op => raw.slice(...op[side])).join('')
}
