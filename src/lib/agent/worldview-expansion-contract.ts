import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { WorldviewGeneratableField } from '../registry/field-registry'
import type { DivineDesign, NaturalResources } from '../types/worldview'

/** Pure expansion protocol: no field admission, model, storage or adoption.
 * The registered adapter supplies the real scope, existing row and complete
 * snapshot hash. These representational bounds are not model budgets. Hashes prove deterministic
 * derivation, never author identity, semantic consistency or DB poststate.
 * All hashes below use SHA256 over exact UTF16LE code units (including raw
 * malformed replies); no trim, Unicode normalization or newline conversion.
 */
const VERSION = 'worldview-expansion-v1' as const
const HASH = 'sha256-utf16le-v1' as const
const METRIC = 'non-whitespace-utf16-v1' as const
const DIVINE = ['divineRank', 'divineNames', 'divineRules'] as const satisfies readonly Exclude<keyof DivineDesign, 'hasDivinity'>[]
const RESOURCES = ['rareCreatures', 'herbs', 'minerals', 'others'] as const satisfies readonly (keyof NaturalResources)[]
type Leaf = 'text' | typeof DIVINE[number] | typeof RESOURCES[number]
type Value = string | Readonly<Record<string, string | boolean>>
interface Scope { readonly projectId: number; readonly worldId: number; readonly workId: number; readonly worldGroupId: number | null }
interface Limits { readonly maxRawUtf16: number; readonly maxOperations: number; readonly maxResultUtf16: number; readonly maxLeafUtf16: number }
interface Segment { readonly id: string; readonly index: number; readonly from: number; readonly to: number; readonly textHash: string }
interface TextLeaf { readonly leaf: Leaf; readonly text: string; readonly segments: readonly Segment[] }
export interface WorldviewExpansionBaseV1 {
  readonly version: typeof VERSION
  readonly scope: Scope
  readonly source: { readonly recordId: number; readonly serializedSnapshotHash: string }
  readonly field: WorldviewGeneratableField
  readonly value: Value
  readonly limits: Limits
  readonly baseHash: string
  readonly leaves: readonly TextLeaf[]
}
interface Range { readonly id: string; readonly leaf: Leaf; readonly from: number; readonly to: number; readonly textHash: string }
interface RangeInput { leaf: Leaf; from: number; to: number }
interface Goal {
  readonly metric: typeof METRIC
  readonly scope: 'added' | 'selected-result'
  readonly distribution: 'aggregate-selected-leaves'
  readonly quantity: number
}
export interface WorldviewExpansionAuthorizationV1 {
  readonly version: typeof VERSION
  readonly baseHash: string
  readonly mode: 'insert-only' | 'local-replace'
  readonly leaves: readonly Leaf[]
  readonly ranges: readonly Range[]
  readonly goal: Goal
  readonly authorizationHash: string
}
interface Insert { readonly id: string; readonly kind: 'insert'; readonly leaf: Leaf; readonly segmentId: string; readonly side: 'before' | 'after'; readonly order: number; readonly text: string }
interface Replace { readonly id: string; readonly kind: 'replace'; readonly leaf: Leaf; readonly rangeId: string; readonly text: string }
type Edit = Insert | Replace
export interface WorldviewExpansionDeltaV1 {
  readonly version: typeof VERSION
  readonly field: WorldviewGeneratableField
  readonly baseHash: string
  readonly authorizationHash: string
  readonly edits: readonly Edit[]
  readonly temporaryAssumptions?: readonly string[]
}
export type WorldviewExpansionSelectionV1 =
  | { readonly mode: 'preview' }
  | { readonly mode: 'author-selection'; readonly edits: readonly { readonly id: string; readonly text?: string }[] }
interface Retained { readonly leaf: Leaf; readonly baseFrom: number; readonly baseTo: number; readonly resultFrom: number; readonly resultTo: number; readonly textHash: string }
export interface WorldviewExpansionResultV1 {
  readonly candidate: { readonly field: WorldviewGeneratableField; readonly value: Value; readonly temporaryAssumptions?: readonly string[] }
  readonly raw: string
  readonly delta: WorldviewExpansionDeltaV1
  readonly selection: WorldviewExpansionSelectionV1
  readonly retained: readonly Retained[]
  readonly counts: { readonly metric: typeof METRIC; readonly distribution: 'aggregate-selected-leaves'; readonly added: number; readonly selectedResult: number; readonly final: number; readonly goalActual: number; readonly goalQuantity: number }
  readonly proof: { readonly version: typeof VERSION; readonly hashAlgorithm: typeof HASH; readonly baseHash: string; readonly authorizationHash: string; readonly rawHash: string; readonly deltaHash: string; readonly selectionHash: string; readonly resultHash: string; readonly retainedHash: string; readonly countsHash: string; readonly proofHash: string }
}

export class WorldviewExpansionContractErrorV1 extends Error {
  readonly rawHash?: string
  constructor(readonly code: string, readonly raw?: string) {
    super(`Worldview expansion contract: ${code}`)
    this.name = 'WorldviewExpansionContractErrorV1'
    if (raw !== undefined) this.rawHash = textHash(raw)
  }
}
function fail(code: string): never { throw new WorldviewExpansionContractErrorV1(code) }
function textHash(text: string): string {
  const bytes = new Uint8Array(text.length * 2)
  for (let i = 0; i < text.length; i++) { const unit = text.charCodeAt(i); bytes[i * 2] = unit & 255; bytes[i * 2 + 1] = unit >>> 8 }
  return bytesToHex(sha256(bytes))
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>
    return `{${Object.keys(row).sort().map(key => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`
  }
  const result = JSON.stringify(value)
  if (result === undefined) fail('non-json-value')
  return result
}
function hash(value: unknown): string { return textHash(canonical(value)) }
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) frozen(item); Object.freeze(value) }
  return value
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('object-required')
  if (Object.getOwnPropertySymbols(value).length
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(item => !item.enumerable || !('value' in item))) fail('plain-data-required')
  return value as Record<string, unknown>
}
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const row = object(value)
  const actual = Object.keys(row)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) fail('unknown-or-missing-property')
  return row
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.keys(value).length !== value.length
    || Object.getOwnPropertySymbols(value).length
    || Object.keys(value).some((key, index) => key !== String(index) || !('value' in Object.getOwnPropertyDescriptor(value, key)!))) fail('dense-array-required')
  return value
}
function integer(value: unknown, min = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) fail('integer-required')
  return value
}
function digest(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('hash-required'); return value }
function text(value: unknown, meaningful = false): string {
  if (typeof value !== 'string' || meaningful && !value.trim()) fail('text-required')
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i)
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('unpaired-surrogate')
    } else if (code >= 0xdc00 && code <= 0xdfff) fail('unpaired-surrogate')
  }
  return value
}
function id(value: unknown): string { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) fail('edit-id-required'); return value }
function boundary(value: string, offset: number): void {
  integer(offset, 0)
  if (offset > value.length) fail('range-out-of-bounds')
  if (offset > 0 && offset < value.length) {
    const previous = value.charCodeAt(offset - 1), next = value.charCodeAt(offset)
    if (previous === 13 && next === 10) fail('split-crlf')
    if (previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) fail('split-surrogate')
  }
}
function leafValue(base: WorldviewExpansionBaseV1, name: unknown): TextLeaf {
  const found = base.leaves.find(item => item.leaf === name)
  if (!found) fail('unknown-leaf')
  return found
}
function validateLength(leaves: readonly TextLeaf[], limits: Limits): void {
  if (leaves.some(leaf => leaf.text.length > limits.maxLeafUtf16)
    || leaves.reduce((sum, leaf) => sum + leaf.text.length, 0) > limits.maxResultUtf16) fail('result-too-long')
}
/** Each physical line includes its exact CR/LF separator. Empty lines are
 * segments; a separate terminal zero-width anchor makes empty leaves usable.
 * Identity binds ordinal and offsets, so duplicate paragraphs never alias. */
function segments(baseHash: string, leaf: Leaf, value: string): Segment[] {
  const result: Segment[] = []
  const add = (from: number, to: number) => {
    const body = { index: result.length, from, to, textHash: textHash(value.slice(from, to)) }
    result.push({ ...body, id: hash({ version: VERSION, baseHash, leaf, ...body }) })
  }
  let from = 0
  for (let at = 0; at < value.length; at++) {
    if (value[at] !== '\r' && value[at] !== '\n') continue
    if (value[at] === '\r' && value[at + 1] === '\n') at++
    add(from, at + 1); from = at + 1
  }
  if (from < value.length) add(from, value.length)
  add(value.length, value.length)
  return result
}

/** Field is a type-only reference to the existing registry, not another
 * writable-field registry. Runtime formal admission remains the adapter's job. */
export function freezeWorldviewExpansionBaseV1(input: {
  scope: Scope; source: { recordId: number; serializedSnapshotHash: string }; field: WorldviewGeneratableField; value: unknown; limits: Limits
}): WorldviewExpansionBaseV1 {
  exact(input, ['scope', 'source', 'field', 'value', 'limits'])
  const rawScope = exact(input.scope, ['projectId', 'worldId', 'workId', 'worldGroupId'])
  const scope = { projectId: integer(rawScope.projectId), worldId: integer(rawScope.worldId), workId: integer(rawScope.workId), worldGroupId: rawScope.worldGroupId === null ? null : integer(rawScope.worldGroupId) }
  const sourceRow = exact(input.source, ['recordId', 'serializedSnapshotHash'])
  const source = { recordId: integer(sourceRow.recordId), serializedSnapshotHash: digest(sourceRow.serializedSnapshotHash) }
  const bound = exact(input.limits, ['maxRawUtf16', 'maxOperations', 'maxResultUtf16', 'maxLeafUtf16'])
  const limits = { maxRawUtf16: integer(bound.maxRawUtf16), maxOperations: integer(bound.maxOperations), maxResultUtf16: integer(bound.maxResultUtf16), maxLeafUtf16: integer(bound.maxLeafUtf16) }
  if (typeof input.field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9]{0,99}$/.test(input.field)
    || ['constructor', 'prototype'].includes(input.field)) fail('field-required')
  let value: Value, entries: Array<{ leaf: Leaf; text: string }>
  if (input.field === 'divineDesign' || input.field === 'naturalResources') {
    const paths = input.field === 'divineDesign' ? DIVINE : RESOURCES
    const row = exact(input.value, input.field === 'divineDesign' ? ['hasDivinity', ...paths] : paths)
    if (input.field === 'divineDesign' && typeof row.hasDivinity !== 'boolean') fail('divinity-boolean-required')
    entries = paths.map(leaf => ({ leaf, text: text(row[leaf]) }))
    value = { ...(input.field === 'divineDesign' ? { hasDivinity: row.hasDivinity as boolean } : {}), ...Object.fromEntries(entries.map(item => [item.leaf, item.text])) }
  } else {
    value = text(input.value)
    entries = [{ leaf: 'text', text: value }]
  }
  if (!entries.some(item => item.text.trim())) fail('empty-base-use-create')
  const body = { version: VERSION, scope, source, field: input.field, value, limits }
  const baseHash = hash(body)
  const leaves = entries.map(item => ({ ...item, segments: segments(baseHash, item.leaf, item.text) }))
  validateLength(leaves, limits)
  return frozen({ ...body, baseHash, leaves })
}
function checkedBase(base: WorldviewExpansionBaseV1): WorldviewExpansionBaseV1 {
  exact(base, ['version', 'scope', 'source', 'field', 'value', 'limits', 'baseHash', 'leaves'])
  const rebuilt = freezeWorldviewExpansionBaseV1({ scope: base.scope, source: base.source, field: base.field, value: base.value, limits: base.limits })
  if (canonical(base) !== canonical(rebuilt)) fail('base-integrity')
  return rebuilt
}
export function freezeWorldviewExpansionAuthorizationV1(baseInput: WorldviewExpansionBaseV1, input: {
  mode: 'insert-only' | 'local-replace'; leaves: readonly Leaf[]; ranges: readonly RangeInput[]; goal: Goal
}): WorldviewExpansionAuthorizationV1 {
  const base = checkedBase(baseInput)
  exact(input, ['mode', 'leaves', 'ranges', 'goal'])
  if (!['insert-only', 'local-replace'].includes(input.mode)) fail('unknown-mode')
  const requestedLeaves = array(input.leaves).map(name => leafValue(base, name).leaf)
  if (!requestedLeaves.length || new Set(requestedLeaves).size !== requestedLeaves.length) fail('duplicate-or-empty-leaves')
  const leaves = base.leaves.map(item => item.leaf).filter(name => requestedLeaves.includes(name))
  const goal = exact(input.goal, ['metric', 'scope', 'distribution', 'quantity'])
  if (goal.metric !== METRIC || goal.distribution !== 'aggregate-selected-leaves'
    || goal.scope !== (input.mode === 'insert-only' ? 'added' : 'selected-result')) fail('goal-scope-or-metric')
  const target: Goal = { metric: METRIC, scope: input.mode === 'insert-only' ? 'added' : 'selected-result', distribution: 'aggregate-selected-leaves', quantity: integer(goal.quantity) }
  const ranges = array(input.ranges).map(item => {
    const row = exact(item, ['leaf', 'from', 'to']), leaf = leafValue(base, row.leaf)
    if (!leaves.includes(leaf.leaf)) fail('range-leaf-not-authorized')
    const from = integer(row.from, 0), to = integer(row.to, 0)
    boundary(leaf.text, from); boundary(leaf.text, to)
    if (from >= to) fail('empty-range')
    return { leaf: leaf.leaf, from, to, textHash: textHash(leaf.text.slice(from, to)) }
  }).sort((a, b) => leaves.indexOf(a.leaf) - leaves.indexOf(b.leaf) || a.from - b.from || a.to - b.to)
  if (input.mode === 'insert-only' ? ranges.length !== 0 : ranges.length === 0 || leaves.some(name => !ranges.some(range => range.leaf === name))) fail('mode-ranges')
  for (let i = 1; i < ranges.length; i++) if (ranges[i - 1].leaf === ranges[i].leaf && ranges[i].from < ranges[i - 1].to) fail('overlapping-ranges')
  const body = { version: VERSION, baseHash: base.baseHash, mode: input.mode, leaves, ranges: ranges.map(range => ({ ...range, id: hash({ baseHash: base.baseHash, ...range }) })), goal: target }
  return frozen({ ...body, authorizationHash: hash(body) })
}
function checkedAuthorization(base: WorldviewExpansionBaseV1, auth: WorldviewExpansionAuthorizationV1): WorldviewExpansionAuthorizationV1 {
  exact(auth, ['version', 'baseHash', 'mode', 'leaves', 'ranges', 'goal', 'authorizationHash'])
  const rebuilt = freezeWorldviewExpansionAuthorizationV1(base, { mode: auth.mode, leaves: auth.leaves, ranges: array(auth.ranges).map(item => {
    const row = exact(item, ['id', 'leaf', 'from', 'to', 'textHash'])
    return { leaf: row.leaf as Leaf, from: row.from as number, to: row.to as number }
  }), goal: auth.goal })
  if (canonical(auth) !== canonical(rebuilt)) fail('authorization-integrity')
  return rebuilt
}
/** JSON.parse accepts duplicate keys; the wire contract does not. Decoded
 * names (including escaped names) share one set per object, never globally. */
function strictJson(raw: string): unknown {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { fail('invalid-json') }
  const stack: Array<{ object: boolean; key: boolean; keys: Set<string> }> = []
  for (const match of raw.matchAll(/"(?:\\.|[^"\\])*"|[{}[\],:]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g)) {
    const token = match[0], frame = stack[stack.length - 1]
    if (token === '{' || token === '[') { stack.push({ object: token === '{', key: token === '{', keys: new Set() }); if (stack.length > 12) fail('wire-nesting'); continue }
    if (token === '}' || token === ']') { stack.pop(); continue }
    if (token === ',') { if (frame?.object) frame.key = true; continue }
    if (token[0] === '"' && frame?.object && frame.key) {
      const name = JSON.parse(token) as string
      if (frame.keys.has(name)) fail('duplicate-json-key')
      frame.keys.add(name); frame.key = false
    }
  }
  return parsed
}
export function parseWorldviewExpansionDeltaV1(baseInput: WorldviewExpansionBaseV1, authInput: WorldviewExpansionAuthorizationV1, raw: string): WorldviewExpansionDeltaV1 {
  try {
    const base = checkedBase(baseInput), auth = checkedAuthorization(base, authInput)
    if (typeof raw !== 'string') fail('raw-text-required')
    if (raw.length > base.limits.maxRawUtf16) fail('raw-too-long')
    const source = object(strictJson(raw))
    const row = exact(source, ['version', 'field', 'baseHash', 'authorizationHash', 'edits',
      ...(Object.prototype.hasOwnProperty.call(source, 'temporaryAssumptions') ? ['temporaryAssumptions'] : [])])
    if (row.version !== VERSION || row.field !== base.field || row.baseHash !== base.baseHash || row.authorizationHash !== auth.authorizationHash) fail('wire-binding-mismatch')
    const assumptions = row.temporaryAssumptions === undefined ? undefined : array(row.temporaryAssumptions).map(item => text(item, true))
    const operations = array(row.edits)
    if (!operations.length || operations.length > base.limits.maxOperations) fail('operation-count')
    const ids = new Set<string>(), positions = new Set<string>(), replacements = new Set<string>()
    const edits = operations.map(item => {
      const edit = object(item), editId = id(edit.id), leaf = leafValue(base, edit.leaf)
      if (ids.has(editId)) fail('duplicate-edit-id')
      ids.add(editId)
      if (!auth.leaves.includes(leaf.leaf)) fail('leaf-not-authorized')
      const content = text(edit.text, true)
      if (content.length > base.limits.maxLeafUtf16) fail('edit-too-long')
      if (edit.kind === 'insert' && auth.mode === 'insert-only') {
        exact(edit, ['id', 'kind', 'leaf', 'segmentId', 'side', 'order', 'text'])
        const segment = leaf.segments.find(segment => segment.id === edit.segmentId)
        if (!segment || !['before', 'after'].includes(String(edit.side))) fail('unknown-anchor')
        const order = integer(edit.order, 0), offset = edit.side === 'before' ? segment.from : segment.to
        // Before/after aliases at one offset share the SAME order namespace.
        const key = `${leaf.leaf}:${offset}:${order}`
        if (positions.has(key)) fail('ambiguous-insertion-order')
        positions.add(key)
        return { id: editId, kind: 'insert' as const, leaf: leaf.leaf, segmentId: segment.id, side: edit.side as 'before' | 'after', order, text: content }
      }
      if (edit.kind === 'replace' && auth.mode === 'local-replace') {
        exact(edit, ['id', 'kind', 'leaf', 'rangeId', 'text'])
        const range = auth.ranges.find(range => range.id === edit.rangeId && range.leaf === leaf.leaf)
        if (!range) fail('range-not-authorized')
        if (replacements.has(range.id)) fail('duplicate-replacement')
        replacements.add(range.id)
        return { id: editId, kind: 'replace' as const, leaf: leaf.leaf, rangeId: range.id, text: content }
      }
      fail('operation-not-authorized')
    })
    return frozen({ version: VERSION, field: base.field, baseHash: base.baseHash, authorizationHash: auth.authorizationHash, edits,
      ...(assumptions ? { temporaryAssumptions: assumptions } : {}) })
  } catch (error) {
    if (typeof raw !== 'string') throw error
    throw new WorldviewExpansionContractErrorV1(error instanceof WorldviewExpansionContractErrorV1 ? error.code : 'invalid-wire', raw)
  }
}
function selectionFor(delta: WorldviewExpansionDeltaV1, input: WorldviewExpansionSelectionV1): { selection: WorldviewExpansionSelectionV1; edits: Edit[] } {
  const row = object(input)
  if (row.mode === 'preview') {
    exact(row, ['mode'])
    return { selection: { mode: 'preview' }, edits: [...delta.edits] }
  }
  exact(row, ['mode', 'edits'])
  if (row.mode !== 'author-selection') fail('selection-mode')
  const seen = new Set<string>()
  const decisions = array(row.edits).map(item => {
    const choice = object(item)
    exact(choice, Object.prototype.hasOwnProperty.call(choice, 'text') ? ['id', 'text'] : ['id'])
    const editId = id(choice.id), edit = delta.edits.find(edit => edit.id === editId)
    if (!edit || seen.has(editId)) fail('unknown-or-duplicate-selection')
    seen.add(editId)
    return { id: editId, ...(Object.prototype.hasOwnProperty.call(choice, 'text') ? { text: text(choice.text, true) } : {}) }
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  return { selection: { mode: 'author-selection', edits: decisions }, edits: delta.edits.filter(edit => seen.has(edit.id)).map(edit => ({ ...edit, text: decisions.find(choice => choice.id === edit.id)!.text ?? edit.text })) }
}
function count(value: string): number { return value.replace(/\s/g, '').length }

/** Rebuild every revision from immutable base/raw and an explicit selection.
 * Preview is NOT author adoption. Local replacement is deliberately a separate
 * mode, not arbitrary mixed JSON Patch. Goal quantity is advisory, not a cap. */
function materializeResult(baseInput: WorldviewExpansionBaseV1, authInput: WorldviewExpansionAuthorizationV1, raw: string, choice: WorldviewExpansionSelectionV1 = { mode: 'preview' }): WorldviewExpansionResultV1 {
  const base = checkedBase(baseInput), auth = checkedAuthorization(base, authInput)
  const delta = parseWorldviewExpansionDeltaV1(base, auth, raw)
  const { selection, edits } = selectionFor(delta, choice)
  if (edits.some(edit => edit.text.length > base.limits.maxLeafUtf16)) fail('edited-addition-too-long')
  const retained: Retained[] = [], values: Record<string, string> = {}
  for (const leaf of base.leaves) {
    const operations = edits.filter(edit => edit.leaf === leaf.leaf).map(edit => {
      if (edit.kind === 'replace') { const range = auth.ranges.find(range => range.id === edit.rangeId)!; return { from: range.from, to: range.to, order: 0, text: edit.text } }
      const segment = leaf.segments.find(segment => segment.id === edit.segmentId)!, at = edit.side === 'before' ? segment.from : segment.to
      return { from: at, to: at, order: edit.order, text: edit.text }
    }).sort((a, b) => a.from - b.from || a.order - b.order)
    let cursor = 0, result = ''
    const preserve = (to: number) => {
      if (to > cursor) {
        const original = leaf.text.slice(cursor, to)
        retained.push({ leaf: leaf.leaf, baseFrom: cursor, baseTo: to, resultFrom: result.length, resultTo: result.length + original.length, textHash: textHash(original) })
        result += original
      }
      cursor = to
    }
    for (const operation of operations) { preserve(operation.from); result += operation.text; cursor = operation.to }
    preserve(leaf.text.length)
    values[leaf.leaf] = result
  }
  const leaves = base.leaves.map(leaf => ({ ...leaf, text: values[leaf.leaf] }))
  validateLength(leaves, base.limits)
  const value: Value = typeof base.value === 'string' ? values.text : { ...base.value, ...values }
  const candidate = { field: base.field, value, ...(delta.temporaryAssumptions ? { temporaryAssumptions: delta.temporaryAssumptions } : {}) }
  const added = edits.filter(edit => edit.kind === 'insert').reduce((sum, edit) => sum + count(edit.text), 0)
  const selectedResult = auth.ranges.reduce((sum, range) => sum + count(edits.find(edit => edit.kind === 'replace' && edit.rangeId === range.id)?.text ?? leafValue(base, range.leaf).text.slice(range.from, range.to)), 0)
  const counts = { metric: METRIC, distribution: 'aggregate-selected-leaves' as const, added, selectedResult, final: leaves.reduce((sum, leaf) => sum + count(leaf.text), 0), goalActual: auth.mode === 'insert-only' ? added : selectedResult, goalQuantity: auth.goal.quantity }
  const proofBody = { version: VERSION, hashAlgorithm: HASH, baseHash: base.baseHash, authorizationHash: auth.authorizationHash, rawHash: textHash(raw), deltaHash: hash(delta), selectionHash: hash(selection), resultHash: hash(candidate), retainedHash: hash(retained), countsHash: hash(counts) }
  return frozen({ candidate, raw, delta, selection, retained, counts, proof: { ...proofBody, proofHash: hash(proofBody) } })
}
/** Failures retain the exact raw reply too; callers still persist raw before
 * materialization. No repair, normalization or fallback is attempted here. */
export function materializeWorldviewExpansionV1(base: WorldviewExpansionBaseV1, auth: WorldviewExpansionAuthorizationV1, raw: string, selection: WorldviewExpansionSelectionV1 = { mode: 'preview' }): WorldviewExpansionResultV1 {
  try { return materializeResult(base, auth, raw, selection) } catch (error) {
    if (typeof raw !== 'string') throw error
    if (error instanceof WorldviewExpansionContractErrorV1 && error.raw === raw) throw error
    throw new WorldviewExpansionContractErrorV1(error instanceof WorldviewExpansionContractErrorV1 ? error.code : 'invalid-derivation', raw)
  }
}
/** Replay against the caller's expected base/auth/raw/selection; never accept a
 * claimed self-hash or a React-assembled full draft as a derivation proof. */
export function verifyWorldviewExpansionResultV1(base: WorldviewExpansionBaseV1, auth: WorldviewExpansionAuthorizationV1, raw: string, selection: WorldviewExpansionSelectionV1, claimed: WorldviewExpansionResultV1): boolean {
  try { return canonical(materializeWorldviewExpansionV1(base, auth, raw, selection)) === canonical(claimed) } catch { return false }
}
