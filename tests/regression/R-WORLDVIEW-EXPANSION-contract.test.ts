import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  freezeWorldviewExpansionBaseV1 as freezeBase,
  freezeWorldviewExpansionAuthorizationV1 as freezeAuthorization,
  parseWorldviewExpansionDeltaV1 as parseDelta,
  materializeWorldviewExpansionV1 as materialize,
  verifyWorldviewExpansionResultV1 as verify,
  WorldviewExpansionContractErrorV1,
  type WorldviewExpansionBaseV1,
  type WorldviewExpansionAuthorizationV1,
  type WorldviewExpansionResultV1,
} from '../../src/lib/agent/worldview-expansion-contract'

type BaseInput = Parameters<typeof freezeBase>[0]
type AuthInput = Parameters<typeof freezeAuthorization>[1]
const original = ' \t军税为17枚，不可夜航。\r\n\r\n重复段😀\r\n重复段😀\r\n尾段　 \r\n'
function base(value: unknown = original, overrides: Partial<BaseInput> = {}) {
  return freezeBase({ scope: { projectId: 1, worldId: 2, workId: 3, worldGroupId: null }, source: { recordId: 4, serializedSnapshotHash: 'a'.repeat(64) },
    field: 'races', value, limits: { maxRawUtf16: 100_000, maxOperations: 32, maxResultUtf16: 100_000, maxLeafUtf16: 50_000 }, ...overrides })
}
function auth(frozen: WorldviewExpansionBaseV1, overrides: Partial<AuthInput> = {}) {
  return freezeAuthorization(frozen, { mode: 'insert-only', leaves: ['text'], ranges: [],
    goal: { metric: 'non-whitespace-utf16-v1', scope: 'added', distribution: 'aggregate-selected-leaves', quantity: 500 }, ...overrides })
}
function insert(frozen: WorldviewExpansionBaseV1, overrides: Record<string, unknown> = {}) {
  return { id: 'first', kind: 'insert', leaf: 'text', segmentId: frozen.leaves[0].segments[0].id, side: 'after', order: 0, text: '新增：守潮人按17枚军税核验。\r\n', ...overrides }
}
function wire(frozen: WorldviewExpansionBaseV1, permitted: WorldviewExpansionAuthorizationV1, edits: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 'worldview-expansion-v1', field: frozen.field, baseHash: frozen.baseHash, authorizationHash: permitted.authorizationHash, edits, ...extra })
}
function code(action: () => unknown, expected: string) {
  try { action(); expect.fail(`Expected ${expected}`) } catch (error) {
    expect(error).toBeInstanceOf(WorldviewExpansionContractErrorV1)
    expect((error as WorldviewExpansionContractErrorV1).code).toBe(expected)
    return error as WorldviewExpansionContractErrorV1
  }
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function retainedExactly(frozen: WorldviewExpansionBaseV1, result: WorldviewExpansionResultV1) {
  for (const span of result.retained) {
    const before = frozen.leaves.find(leaf => leaf.leaf === span.leaf)!.text.slice(span.baseFrom, span.baseTo)
    const after = typeof result.candidate.value === 'string' ? result.candidate.value : result.candidate.value[span.leaf] as string
    expect(after.slice(span.resultFrom, span.resultTo)).toBe(before)
    expect(span.textHash).toBe(createHash('sha256').update(Buffer.from(before, 'utf16le')).digest('hex'))
  }
}

describe('049-A1 exact immutable base and range identities', () => {
  it('retains raw whitespace, CRLF, empty lines, trailing data and duplicate identities across JSON restoration', () => {
    const frozen = base(), leaf = frozen.leaves[0]
    expect(leaf.text).toBe(original)
    expect(leaf.segments.map(segment => original.slice(segment.from, segment.to))).toEqual([' \t军税为17枚，不可夜航。\r\n', '\r\n', '重复段😀\r\n', '重复段😀\r\n', '尾段　 \r\n', ''])
    expect(leaf.segments[2].textHash).toBe(leaf.segments[3].textHash)
    expect(leaf.segments[2].id).not.toBe(leaf.segments[3].id)
    expect(base()).toEqual(frozen)
    const permitted = auth(frozen), response = wire(frozen, permitted, [insert(frozen)])
    expect(materialize(clone(frozen), clone(permitted), response)).toEqual(materialize(frozen, permitted, response))
    expect(Object.isFrozen(frozen.leaves[0].segments[0])).toBe(true)
    expect(Object.isFrozen(permitted.goal)).toBe(true)
  })
  it('binds field/scope/group/record/full snapshot/limits into identity without Unicode normalization', () => {
    const frozen = base('e\u0301 😀\r\n')
    for (const changed of [base('é 😀\r\n'), base('e\u0301 😀\r\n', { field: 'worldOrigin' }), base('e\u0301 😀\r\n', { scope: { ...frozen.scope, workId: 9 } }), base('e\u0301 😀\r\n', { scope: { ...frozen.scope, worldGroupId: 8 } }), base('e\u0301 😀\r\n', { source: { ...frozen.source, recordId: 9 } }), base('e\u0301 😀\r\n', { source: { ...frozen.source, serializedSnapshotHash: 'b'.repeat(64) } }), base('e\u0301 😀\r\n', { limits: { ...frozen.limits, maxOperations: 33 } })]) {
      expect(changed.baseHash).not.toBe(frozen.baseHash)
      expect(changed.leaves[0].segments[0].id).not.toBe(frozen.leaves[0].segments[0].id)
    }
  })
  it('does not retain caller aliases or mutable arrays', () => {
    const value = { hasDivinity: false, divineRank: '  原阶序\r\n', divineNames: '原名', divineRules: '禁忌' }
    const frozen = base(value, { field: 'divineDesign' })
    value.divineRank = '后来改动'
    expect(frozen.value).toEqual({ hasDivinity: false, divineRank: '  原阶序\r\n', divineNames: '原名', divineRules: '禁忌' })
  })
  it.each(['', ' \r\n\t'])('keeps an empty/whitespace original on the create path: %j', value => { code(() => base(value), 'empty-base-use-create') })
  it.each(['\ud800X', 'X\udc00'])('rejects malformed UTF16 instead of silently repairing it: %j', value => { code(() => base(value), 'unpaired-surrogate') })
  it('rejects malformed scope, source hashes, bounds, unknown root data and accessors', () => {
    code(() => base('正文', { scope: { projectId: 1, worldId: 2, workId: 0, worldGroupId: null } }), 'integer-required')
    code(() => base('正文', { source: { recordId: 1, serializedSnapshotHash: 'forged' } }), 'hash-required')
    code(() => base('正文', { limits: { maxRawUtf16: Infinity, maxOperations: 1, maxResultUtf16: 10, maxLeafUtf16: 10 } }), 'integer-required')
    code(() => freezeBase({ ...baseInput(), unexpected: true } as BaseInput), 'unknown-or-missing-property')
    const malicious = { ...baseInput() }
    Object.defineProperty(malicious, 'value', { enumerable: true, get: () => '副作用' })
    code(() => freezeBase(malicious), 'plain-data-required')
  })
})
function baseInput(): BaseInput { const frozen = base(); return { scope: frozen.scope, source: frozen.source, field: frozen.field, value: frozen.value, limits: frozen.limits } }

describe('049-A1 insert-only and explicit local replacement', () => {
  it('inserts at the SECOND duplicate segment without replacing or trimming any original data', () => {
    const frozen = base(), permitted = auth(frozen), anchor = frozen.leaves[0].segments[3]
    const response = wire(frozen, permitted, [insert(frozen, { segmentId: anchor.id, text: '新段\r\n' })])
    const result = materialize(frozen, permitted, response)
    expect(result.candidate.value).toBe(original.slice(0, anchor.to) + '新段\r\n' + original.slice(anchor.to))
    expect(result.retained.reduce((sum, span) => sum + span.baseTo - span.baseFrom, 0)).toBe(original.length)
    retainedExactly(frozen, result)
    expect(result.counts).toMatchObject({ goalQuantity: 500, added: 2, goalActual: 2 }) // Approximate goal is not an exact-size gate.
  })
  it('orders same-offset before/after aliases by explicit order, independent of reply array order; rejects ties', () => {
    const frozen = base('甲\r\n乙'), permitted = auth(frozen), [first, second] = frozen.leaves[0].segments
    const a = insert(frozen, { id: 'a', segmentId: first.id, side: 'after', order: 1, text: '先' })
    const b = insert(frozen, { id: 'b', segmentId: second.id, side: 'before', order: 2, text: '后' })
    expect(materialize(frozen, permitted, wire(frozen, permitted, [b, a])).candidate.value).toBe('甲\r\n先后乙')
    expect(materialize(frozen, permitted, wire(frozen, permitted, [a, b])).candidate.value).toBe('甲\r\n先后乙')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [a, { ...b, order: 1 }])), 'ambiguous-insertion-order')
  })
  it('supports the first and terminal anchors without inventing separators', () => {
    const frozen = base('  正文\r\n'), permitted = auth(frozen), last = frozen.leaves[0].segments[frozen.leaves[0].segments.length - 1]
    const result = materialize(frozen, permitted, wire(frozen, permitted, [insert(frozen, { id: 'prefix', side: 'before', text: '前' }), insert(frozen, { id: 'tail', segmentId: last.id, side: 'after', text: '后  ' })]))
    expect(result.candidate.value).toBe('前  正文\r\n后  ')
    retainedExactly(frozen, result)
  })
  it('blocks replace/delete/full-summary and unselected leaves on the default path', () => {
    const frozen = base(), permitted = auth(frozen)
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [{ id: 'rewrite', kind: 'replace', leaf: 'text', rangeId: 'x', text: '摘要' }])), 'operation-not-authorized')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [{ ...insert(frozen), kind: 'delete' }])), 'operation-not-authorized')
    code(() => parseDelta(frozen, permitted, JSON.stringify({ field: frozen.field, value: '整篇摘要' })), 'unknown-or-missing-property')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [insert(frozen, { leaf: 'hasDivinity' })])), 'unknown-leaf')
  })
  it('requires author-selected exact safe ranges; preserves every unselected byte including adjacent ranges', () => {
    const frozen = base(' 甲😀\r\n乙\r\n ')
    const permitted = auth(frozen, { mode: 'local-replace', ranges: [{ leaf: 'text', from: 1, to: 2 }, { leaf: 'text', from: 2, to: 4 }], goal: { metric: 'non-whitespace-utf16-v1', scope: 'selected-result', distribution: 'aggregate-selected-leaves', quantity: 20 } })
    const edits = permitted.ranges.map((range, index) => ({ id: `r${index}`, kind: 'replace', leaf: 'text', rangeId: range.id, text: index ? '新😀' : '改' }))
    const result = materialize(frozen, permitted, wire(frozen, permitted, edits))
    expect(result.candidate.value).toBe(' 改新😀\r\n乙\r\n ')
    expect(result.counts).toMatchObject({ added: 0, selectedResult: 4, goalActual: 4, goalQuantity: 20 })
    retainedExactly(frozen, result)
    const subset = materialize(frozen, permitted, wire(frozen, permitted, edits), { mode: 'author-selection', edits: [{ id: 'r0' }] })
    expect(subset.candidate.value).toBe(' 改😀\r\n乙\r\n ')
    expect(subset.counts.selectedResult).toBe(3)
    retainedExactly(frozen, subset)
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [{ ...edits[0], rangeId: 'unselected' }])), 'range-not-authorized')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [edits[0], { ...edits[0], id: 'again' }])), 'duplicate-replacement')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [insert(frozen)])), 'operation-not-authorized')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [{ ...edits[0], text: '' }])), 'text-required')
  })
  it.each([{ from: 2, to: 3, error: 'split-surrogate' }, { from: 1, to: 4, error: 'split-crlf' }, { from: 0, to: 7, error: 'range-out-of-bounds' }, { from: 1, to: 1, error: 'empty-range' }])('rejects unsafe range $from..$to', ({ from, to, error }) => {
    const frozen = base('甲😀\r\n乙')
    code(() => auth(frozen, { mode: 'local-replace', ranges: [{ leaf: 'text', from, to }], goal: { metric: 'non-whitespace-utf16-v1', scope: 'selected-result', distribution: 'aggregate-selected-leaves', quantity: 20 } }), error)
  })
  it('rejects overlapping authorization, missing ranges and incompatible target scopes', () => {
    const frozen = base('甲乙丙丁')
    const goal = { metric: 'non-whitespace-utf16-v1' as const, scope: 'selected-result' as const, distribution: 'aggregate-selected-leaves' as const, quantity: 50 }
    code(() => auth(frozen, { mode: 'local-replace', ranges: [{ leaf: 'text', from: 0, to: 3 }, { leaf: 'text', from: 2, to: 4 }], goal }), 'overlapping-ranges')
    code(() => auth(frozen, { mode: 'local-replace', ranges: [], goal }), 'mode-ranges')
    code(() => auth(frozen, { ranges: [{ leaf: 'text', from: 0, to: 1 }] }), 'mode-ranges')
    code(() => auth(frozen, { goal }), 'goal-scope-or-metric')
    code(() => auth(frozen, { leaves: ['text', 'text'] }), 'duplicate-or-empty-leaves')
  })
})

describe('049-A1 bounded object leaves and aggregate targets', () => {
  it('preserves a divine boolean and untouched exact leaves; allows no boolean or arbitrary JSON path edits', () => {
    const frozen = base({ hasDivinity: false, divineRank: ' 原阶序\r\n', divineNames: ' 原名 ', divineRules: '\r\n 禁忌 \r\n' }, { field: 'divineDesign' })
    const permitted = auth(frozen, { leaves: ['divineRank'] })
    const edit = insert(frozen, { leaf: 'divineRank', text: '新增阶序\r\n' })
    const result = materialize(frozen, permitted, wire(frozen, permitted, [edit]))
    expect(result.candidate.value).toEqual({ hasDivinity: false, divineRank: ' 原阶序\r\n新增阶序\r\n', divineNames: ' 原名 ', divineRules: '\r\n 禁忌 \r\n' })
    for (const leaf of ['hasDivinity', '__proto__', 'divineRank.text']) code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [{ ...edit, leaf }])), 'unknown-leaf')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [{ ...edit, leaf: 'divineNames' }])), 'leaf-not-authorized')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [{ ...edit, hasDivinity: true }])), 'unknown-or-missing-property')
    retainedExactly(frozen, result)
  })
  it('has ONE total target across selected resource leaves, including an empty-leaf terminal anchor', () => {
    const frozen = base({ rareCreatures: ' 异兽\r\n ', herbs: '', minerals: '矿脉', others: '保留\r\n' }, { field: 'naturalResources' })
    const permitted = auth(frozen, { leaves: ['minerals', 'herbs'] })
    const herb = frozen.leaves.find(leaf => leaf.leaf === 'herbs')!, mineral = frozen.leaves.find(leaf => leaf.leaf === 'minerals')!
    const result = materialize(frozen, permitted, wire(frozen, permitted, [insert(frozen, { id: 'h', leaf: 'herbs', segmentId: herb.segments[0].id, text: '甲 乙' }), insert(frozen, { id: 'm', leaf: 'minerals', segmentId: mineral.segments[0].id, text: 'ABC😀' })]))
    expect(result.candidate.value).toEqual({ rareCreatures: ' 异兽\r\n ', herbs: '甲 乙', minerals: '矿脉ABC😀', others: '保留\r\n' })
    expect(result.counts).toMatchObject({ metric: 'non-whitespace-utf16-v1', distribution: 'aggregate-selected-leaves', added: 7, goalActual: 7, goalQuantity: 500 })
    code(() => auth(frozen, { leaves: ['herbs'], goal: { ...permitted.goal, distribution: 'per-leaf' } as unknown as AuthInput['goal'] }), 'goal-scope-or-metric')
  })
  it('rejects unknown/missing object properties and non-string leaf values', () => {
    code(() => base({ rareCreatures: '', herbs: '草', minerals: '', others: '', arbitrary: '' }, { field: 'naturalResources' }), 'unknown-or-missing-property')
    code(() => base({ hasDivinity: 'false', divineRank: '神', divineNames: '', divineRules: '' }, { field: 'divineDesign' }), 'divinity-boolean-required')
    code(() => base({ rareCreatures: '', herbs: 42, minerals: '', others: '' }, { field: 'naturalResources' }), 'text-required')
  })
})

describe('049-A1 exact raw, bounded wire and acyclic replay proof', () => {
  it.each(['not json', '```json\n{}\n```', '\ufeff{}'])('preserves rejected raw without repair: %j', response => {
    const frozen = base(), permitted = auth(frozen), error = code(() => parseDelta(frozen, permitted, response), 'invalid-json')!
    expect(error.raw).toBe(response)
    expect(error.rawHash).toBe(createHash('sha256').update(Buffer.from(response, 'utf16le')).digest('hex'))
    expect(error.message).not.toContain(response)
  })
  it('rejects duplicate decoded JSON keys, duplicate operation ids, extra fields, wrong binding and anchor', () => {
    const frozen = base(), permitted = auth(frozen), edit = insert(frozen), response = wire(frozen, permitted, [edit])
    code(() => parseDelta(frozen, permitted, response.replace('"baseHash":', '"ba\\u0073eHash":"forged","baseHash":')), 'duplicate-json-key')
    code(() => parseDelta(frozen, permitted, response.replace('"text":', '"text":"first","text":')), 'duplicate-json-key')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [edit, edit])), 'duplicate-edit-id')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [edit], { value: 'summary' })), 'unknown-or-missing-property')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [edit], { field: 'worldOrigin' })), 'wire-binding-mismatch')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [edit], { baseHash: '0'.repeat(64) })), 'wire-binding-mismatch')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [{ ...edit, segmentId: 'unknown' }])), 'unknown-anchor')
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [{ ...edit, order: -1 }])), 'integer-required')
  })
  it('enforces trusted structural/result bounds without shrinking old content', () => {
    const frozen = base('旧文', { limits: { maxRawUtf16: 10_000, maxOperations: 1, maxResultUtf16: 3, maxLeafUtf16: 3 } }), permitted = auth(frozen)
    const edit = insert(frozen, { text: '新文' })
    const failedRaw = wire(frozen, permitted, [edit])
    expect(code(() => materialize(frozen, permitted, failedRaw), 'result-too-long')!.raw).toBe(failedRaw)
    code(() => parseDelta(frozen, permitted, wire(frozen, permitted, [edit, { ...edit, id: 'more' }])), 'operation-count')
    const tiny = base('旧文', { limits: { ...frozen.limits, maxRawUtf16: 5 } }), tinyAuth = auth(tiny)
    code(() => parseDelta(tiny, tinyAuth, wire(tiny, tinyAuth, [insert(tiny)])), 'raw-too-long')
    expect(frozen.value).toBe('旧文')
  })
  it('binds exact raw separately from parsed delta, and replays rather than trusting a self-hash', () => {
    const frozen = base(), permitted = auth(frozen), response = wire(frozen, permitted, [insert(frozen)])
    const result = materialize(frozen, permitted, response), spaced = materialize(frozen, permitted, ` \r\n${response}\t`)
    expect(spaced.candidate).toEqual(result.candidate)
    expect(spaced.proof.deltaHash).toBe(result.proof.deltaHash)
    expect(spaced.proof.rawHash).not.toBe(result.proof.rawHash)
    expect(spaced.proof.proofHash).not.toBe(result.proof.proofHash)
    expect(verify(frozen, permitted, response, { mode: 'preview' }, clone(result))).toBe(true)
    expect(verify(frozen, permitted, ` ${response}`, { mode: 'preview' }, result)).toBe(false)
    const hashFlatProof = (proof: Record<string, unknown>) => createHash('sha256').update(Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(proof).filter(([key]) => key !== 'proofHash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))), 'utf16le')).digest('hex')
    // Independent SHA256 implementation over the flat proof body: no self-hash,
    // candidateHash or later receipt is required to construct this proof.
    expect(result.proof.proofHash).toBe(hashFlatProof(result.proof))
    const forged = clone(result) as unknown as { candidate: { value: string }; proof: Record<string, unknown> }
    forged.candidate.value = '伪造的全文'
    forged.proof.resultHash = createHash('sha256').update(Buffer.from(JSON.stringify({ field: frozen.field, value: forged.candidate.value }), 'utf16le')).digest('hex')
    forged.proof.proofHash = hashFlatProof(forged.proof) // An internally valid self-claim still cannot replace replay.
    expect(verify(frozen, permitted, response, { mode: 'preview' }, forged as unknown as WorldviewExpansionResultV1)).toBe(false)
    expect(result.proof).not.toHaveProperty('candidateHash')
    expect(result.proof).not.toHaveProperty('receiptHash')
    expect(Object.isFrozen(result.proof)).toBe(true)
  })
  it('recomputes author subset/edited addition from the original wire, including reject-all', () => {
    const frozen = base(), permitted = auth(frozen), response = wire(frozen, permitted, [insert(frozen), insert(frozen, { id: 'second', order: 1, text: '第二段\r\n' })])
    const preview = materialize(frozen, permitted, response)
    const selection = { mode: 'author-selection' as const, edits: [{ id: 'second', text: ' 作者修改😀 \r\n' }] }
    const revision = materialize(frozen, permitted, response, selection)
    const end = frozen.leaves[0].segments[0].to
    expect(revision.candidate.value).toBe(original.slice(0, end) + selection.edits[0].text + original.slice(end))
    expect(revision.raw).toBe(preview.raw)
    expect(revision.proof.rawHash).toBe(preview.proof.rawHash)
    expect(revision.proof.deltaHash).toBe(preview.proof.deltaHash)
    expect(revision.proof.selectionHash).not.toBe(preview.proof.selectionHash)
    expect(verify(frozen, permitted, response, selection, revision)).toBe(true)
    expect(verify(frozen, permitted, response, { mode: 'preview' }, revision)).toBe(false)
    expect(materialize(frozen, permitted, response, { mode: 'author-selection', edits: [] }).candidate.value).toBe(original)
    code(() => materialize(frozen, permitted, response, { mode: 'author-selection', edits: [{ id: 'unknown' }] }), 'unknown-or-duplicate-selection')
    code(() => materialize(frozen, permitted, response, { mode: 'author-selection', edits: [{ id: 'first' }, { id: 'first' }] }), 'unknown-or-duplicate-selection')
    code(() => materialize(frozen, permitted, response, { mode: 'preview', value: '自由全文改写' } as Parameters<typeof materialize>[3]), 'unknown-or-missing-property')
    retainedExactly(frozen, revision)
  })
  it('rejects forged frozen segment/range/base metadata and cross-Work replay', () => {
    const frozen = base(), permitted = auth(frozen), response = wire(frozen, permitted, [insert(frozen)]), preview = materialize(frozen, permitted, response)
    const forged = clone(frozen) as unknown as { leaves: Array<{ segments: Array<{ to: number }> }> }
    forged.leaves[0].segments[0].to--
    code(() => materialize(forged as unknown as WorldviewExpansionBaseV1, permitted, response), 'base-integrity')
    const otherWork = base(original, { scope: { ...frozen.scope, workId: 9 } })
    expect(verify(otherWork, auth(otherWork), response, { mode: 'preview' }, preview)).toBe(false)
    const forgedAuth = { ...clone(permitted), goal: { ...permitted.goal, quantity: 700 } }
    code(() => materialize(frozen, forgedAuth, response), 'authorization-integrity')
  })
})
