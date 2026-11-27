/** Pure display provenance, not field admission or persistence authority.
 * The caller must derive field admission and draft lookup/route from the real
 * existing candidate scope. These consistency checks cannot authenticate props. */
export const WORLDVIEW_DIFF_SOURCE_VERSION_V2 = 'worldview-diff-display-source-v2' as const
export type DiffDraftKindV2 = 'field-value' | 'raw-artifact' | 'unknown'
export type DiffOperationV2 = 'create' | 'rewrite' | 'expand' | 'polish'
export interface DiffCandidateIdentityV2 {
  scope: { projectId: string; worldId?: string; workId?: string; conversationId?: string }
  taskId: string
  eventId: number
  field: string
  runId?: string
  runStepId?: string
  runGeneration?: number
}
export interface DiffSourceBindingV2 {
  identity: DiffCandidateIdentityV2
  payloadField: string
  /** Existing parser result, when available. Never a replacement parser. */
  parserField: string | null
  /** Caller-derived existing registry/contract admission, not a new allowlist. */
  admittedTextField: string
  operation: DiffOperationV2
  baseSnapshot: unknown
}
export interface FrozenDiffBaselineV2 {
  readonly version: typeof WORLDVIEW_DIFF_SOURCE_VERSION_V2
  readonly identity: string
  readonly snapshot: string
  readonly field: string
  readonly operation: DiffOperationV2
  readonly raw: string
}
export interface DiffVisibleDraftLookupV2 {
  /** From the actual readVisibleCandidateDraft(eventId) scope/callsite. The
   * draft has no identity. Do not reconstruct this evidence from draft.rawValue. */
  identity: DiffCandidateIdentityV2
  kind: DiffDraftKindV2
  draft: { rawValue: string; status: 'saving' | 'blocked' | 'failed' | 'discarding' }
}
export interface DiffDisplaySourceInputV2 {
  frozen: FrozenDiffBaselineV2
  binding: DiffSourceBindingV2
  candidateContent: string
  rightRevision: number
  legacyParsedValue?: string
  /** Undefined explicitly means no visible draft in this candidate lookup.
   * Unknown ownership/kind must be passed as unknown, never hidden as absent. */
  visible?: DiffVisibleDraftLookupV2
}
export type DiffDisplaySourceV2 = {
  available: true
  left: string
  right: string
  identity: string
  rightRevision: number
  operation: 'expand' | 'polish'
  source: 'saved-artifact' | 'field-draft' | 'raw-artifact-draft'
  editorKind: 'field-value' | 'raw-artifact'
  /** Display-only notice. No parsed/candidate value is rewritten. */
  legacyBoundaryTrim: boolean
} | { available: false; reason: string; editorKind: DiffDraftKindV2 }
const MAX_JSON_UNITS = 500_000, MAX_JSON_NODES = 100_000, MAX_JSON_DEPTH = 32
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function own(value: Record<string, unknown>, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(value, key)
  if (!d || !('value' in d)) throw new Error(`Missing own data property: ${key}`)
  return d.value
}
/** Sorted, lossless JSON code-unit identity. No TextEncoder/replacement-character
 * aliasing: JSON.stringify escapes lone surrogates distinctly from U+FFFD. */
export function canonicalDiffSourceJsonV2(value: unknown): string {
  let nodes = 0, units = 0
  const seen = new Set<object>()
  const add = (part: string) => { units += part.length; if (units > MAX_JSON_UNITS) throw new Error('Snapshot size limit'); return part }
  const visit = (v: unknown, depth: number): string => {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new Error('Snapshot structure limit')
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return add(JSON.stringify(v))
    if (typeof v === 'number' && Number.isFinite(v)) return add(JSON.stringify(v))
    if (typeof v !== 'object' || v === null || seen.has(v)) throw new Error('Snapshot must be acyclic plain JSON')
    if (Object.getOwnPropertySymbols(v).length) throw new Error('Snapshot symbol keys unsupported')
    seen.add(v)
    let result: string
    if (Array.isArray(v)) {
      if (v.length > MAX_JSON_NODES || Object.getOwnPropertyNames(v).length !== v.length + 1) throw new Error('Sparse/extended snapshot array')
      add('[]' + ','.repeat(Math.max(0, v.length - 1)))
      result = '[' + Array.from({ length: v.length }, (_, i) => visit(own(v as unknown as Record<string, unknown>, String(i)), depth + 1)).join(',') + ']'
    } else {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error('Snapshot must be plain JSON')
      const keys = Object.getOwnPropertyNames(v)
      if (keys.length > MAX_JSON_NODES) throw new Error('Snapshot structure limit')
      keys.sort()
      add('{}' + ','.repeat(Math.max(0, keys.length - 1)))
      result = '{' + keys.map(key => add(JSON.stringify(key) + ':') + visit(own(v as Record<string, unknown>, key), depth + 1)).join(',') + '}'
    }
    seen.delete(v); return result
  }
  return visit(value, 0)
}
function identityKey(identity: DiffCandidateIdentityV2): string {
  if (!object(identity) || !object(identity.scope)) throw new Error('Missing candidate identity')
  const rootKeys = ['scope', 'taskId', 'eventId', 'field', 'runId', 'runStepId', 'runGeneration']
  const scopeKeys = ['projectId', 'worldId', 'workId', 'conversationId']
  if (Object.keys(identity).some(k => !rootKeys.includes(k)) || Object.keys(identity.scope).some(k => !scopeKeys.includes(k))) throw new Error('Unknown identity key')
  for (const key of ['taskId', 'field'] as const) if (typeof identity[key] !== 'string' || !identity[key].length) throw new Error('Invalid candidate identity')
  if (typeof identity.scope.projectId !== 'string' || !identity.scope.projectId.length || !Number.isSafeInteger(identity.eventId) || identity.eventId < 0) throw new Error('Invalid candidate scope/event')
  for (const key of ['runId', 'runStepId'] as const) if (key in identity && (typeof identity[key] !== 'string' || !identity[key]?.length)) throw new Error('Invalid run identity')
  for (const key of scopeKeys) if (key in identity.scope && (typeof identity.scope[key as keyof typeof identity.scope] !== 'string' || !identity.scope[key as keyof typeof identity.scope]?.length)) throw new Error('Invalid scope identity')
  if ('runGeneration' in identity && (!Number.isSafeInteger(identity.runGeneration) || Number(identity.runGeneration) < 0)) throw new Error('Invalid run generation')
  return canonicalDiffSourceJsonV2(identity)
}
function bindingParts(binding: DiffSourceBindingV2) {
  const identity = identityKey(binding.identity), field = binding.identity.field
  if (binding.payloadField !== field || binding.admittedTextField !== field || binding.parserField !== null && binding.parserField !== field) throw new Error('Candidate field mismatch')
  if (!['create', 'rewrite', 'expand', 'polish'].includes(binding.operation)) throw new Error('Unknown frozen operation')
  // Canonicalize before reading: getters/non-JSON snapshot data are rejected.
  const snapshot = canonicalDiffSourceJsonV2(binding.baseSnapshot)
  if (!object(binding.baseSnapshot)) throw new Error('Missing baseline snapshot')
  const values = own(binding.baseSnapshot, 'values')
  if (!object(values)) throw new Error('Missing baseline values')
  const raw = own(values, field)
  if (typeof raw !== 'string') throw new Error('Baseline must be an own raw string')
  return { identity, snapshot, field, raw, operation: binding.operation }
}
/** Cache this once per existing candidate identity in the consumer. A right
 * revision must never cause refreezing; compare against this same frozen copy. */
export function freezeWorldviewDiffBaselineV2(binding: DiffSourceBindingV2): FrozenDiffBaselineV2 {
  return Object.freeze({ version: WORLDVIEW_DIFF_SOURCE_VERSION_V2, ...bindingParts(binding) })
}

/** Strict JSON reader: no repair, duplicate decoded keys rejected in every
 * object, including nested ones. Parsing does not invoke getters/prototypes. */
export function extractWorldviewDiffArtifactValueV2(content: string, admittedField: string): string {
  if (typeof content !== 'string' || content.length > MAX_JSON_UNITS) throw new Error('Artifact size/type limit')
  let source = content, at = 0, nodes = 0
  const whitespace = (c: string | undefined) => c === ' ' || c === '\r' || c === '\n' || c === '\t'
  let start = 0, end = content.length
  while (whitespace(content[start])) start++
  while (end > start && whitespace(content[end - 1])) end--
  source = content.slice(start, end)
  if (source.startsWith('```')) {
    const match = /^```(?:json)?\r?\n([\s\S]*)\r?\n```$/.exec(source)
    if (!match) throw new Error('Incomplete artifact fence')
    source = match[1]
  }
  const skip = () => { while (whitespace(source[at])) at++ }
  const string = (): string => {
    if (source[at] !== '"') throw new Error('Expected JSON string')
    const from = at++
    while (at < source.length) {
      const c = source.charCodeAt(at++)
      if (c === 34) return JSON.parse(source.slice(from, at)) as string
      if (c < 32) throw new Error('Unescaped JSON control character')
      if (c === 92) {
        const escape = source[at++]
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(source.slice(at, at + 4))) throw new Error('Malformed JSON unicode escape')
          at += 4
        } else if (!escape || !'"\\/bfnrt'.includes(escape)) throw new Error('Malformed JSON escape')
      }
    }
    throw new Error('Unterminated JSON string')
  }
  const parse = (depth: number): unknown => {
    if (++nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new Error('Artifact structure limit')
    skip(); const c = source[at]
    if (c === '"') return string()
    if (c === '{') {
      at++; skip(); const result = Object.create(null) as Record<string, unknown>, keys = new Set<string>()
      if (source[at] === '}') { at++; return result }
      while (at < source.length) {
        skip(); const key = string()
        if (keys.has(key)) throw new Error('Duplicate decoded JSON key')
        keys.add(key); skip()
        if (source[at++] !== ':') throw new Error('Expected JSON colon')
        result[key] = parse(depth + 1); skip()
        const next = source[at++]
        if (next === '}') return result
        if (next !== ',') throw new Error('Expected JSON object delimiter')
      }
      throw new Error('Unterminated JSON object')
    }
    if (c === '[') {
      at++; skip(); const result: unknown[] = []
      if (source[at] === ']') { at++; return result }
      while (at < source.length) {
        result.push(parse(depth + 1)); skip(); const next = source[at++]
        if (next === ']') return result
        if (next !== ',') throw new Error('Expected JSON array delimiter')
      }
      throw new Error('Unterminated JSON array')
    }
    for (const [word, value] of [['true', true], ['false', false], ['null', null]] as const) if (source.startsWith(word, at)) { at += word.length; return value }
    const from = at
    while (at < source.length && /[0-9eE+\-.]/.test(source[at])) at++
    const token = source.slice(from, at)
    if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(token)) throw new Error('Invalid JSON value')
    const value = Number(token)
    if (!Number.isFinite(value)) throw new Error('Nonfinite JSON number')
    return value
  }
  const result = parse(0); skip()
  if (at !== source.length || !object(result) || Object.keys(result).some(k => !['field', 'value', 'temporaryAssumptions'].includes(k))) throw new Error('Artifact envelope invalid')
  if (own(result, 'field') !== admittedField) throw new Error('Artifact field mismatch')
  const value = own(result, 'value')
  if (typeof value !== 'string') throw new Error('Artifact value must be string')
  if ('temporaryAssumptions' in result && (!Array.isArray(result.temporaryAssumptions) || result.temporaryAssumptions.some(v => typeof v !== 'string'))) throw new Error('Artifact assumptions invalid')
  return value
}
export function selectWorldviewDiffDisplaySourceV2(input: DiffDisplaySourceInputV2): DiffDisplaySourceV2 {
  let editorKind: DiffDraftKindV2 = input.visible?.kind ?? 'field-value'
  const unavailable = (reason: string): DiffDisplaySourceV2 => ({ available: false, reason, editorKind })
  try {
    const current = bindingParts(input.binding), frozen = input.frozen
    if (frozen.version !== WORLDVIEW_DIFF_SOURCE_VERSION_V2 || current.identity !== frozen.identity) return unavailable('candidate-identity-drift')
    if (current.snapshot !== frozen.snapshot || current.raw !== frozen.raw || current.field !== frozen.field || current.operation !== frozen.operation) return unavailable('frozen-baseline-drift')
    if (current.operation !== 'expand' && current.operation !== 'polish') return unavailable('operation-not-comparable')
    if (!Number.isSafeInteger(input.rightRevision) || input.rightRevision < 0) return unavailable('invalid-right-revision')
    let right: string, source: Extract<DiffDisplaySourceV2, { available: true }>['source']
    if (input.visible) {
      const { draft, kind } = input.visible
      if (identityKey(input.visible.identity) !== frozen.identity) return unavailable('draft-lookup-identity-drift')
      if (!['field-value', 'raw-artifact', 'unknown'].includes(kind)) { editorKind = 'unknown'; return unavailable('unknown-draft-kind') }
      if (kind === 'unknown') return unavailable('unknown-draft-kind')
      if (!draft || typeof draft.rawValue !== 'string' || !['saving', 'blocked', 'failed', 'discarding'].includes(draft.status)) return unavailable('invalid-visible-draft')
      if (draft.status === 'discarding') return unavailable('draft-discarding')
      if (kind === 'field-value') { right = draft.rawValue; source = 'field-draft' }
      else { right = extractWorldviewDiffArtifactValueV2(draft.rawValue, current.field); source = 'raw-artifact-draft' }
    } else {
      right = extractWorldviewDiffArtifactValueV2(input.candidateContent, current.field); source = 'saved-artifact'
    }
    return { available: true, left: frozen.raw, right, identity: frozen.identity, operation: current.operation, rightRevision: input.rightRevision,
      source, editorKind: editorKind as 'field-value' | 'raw-artifact',
      legacyBoundaryTrim: typeof input.legacyParsedValue === 'string' && right !== input.legacyParsedValue && right.trim() === input.legacyParsedValue }
  } catch (error) { return unavailable(error instanceof Error ? error.message : 'display-source-unavailable') }
}
