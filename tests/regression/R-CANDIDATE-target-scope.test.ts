import { describe, expect, it } from 'vitest'
import {
  CandidateTargetContractErrorV1,
  candidateTargetIdentitiesOverlapV1,
  candidateTargetPathsOverlapV1,
  compareCandidateTargetFootprintsV1,
  normalizeCandidateTargetFootprintV1,
  type CandidateTargetFootprintV1,
  type CandidateTargetWriteV1,
} from '../../src/lib/agent/candidate-target-scope'
import { WORLDVIEW_GENERATABLE_FIELD_SPECS } from '../../src/lib/registry/field-registry'

const scope = { projectId: 1, worldId: 2, workId: 3 }
function footprint(
  paths: string[][] = [['races']],
  write: Partial<CandidateTargetWriteV1> = {},
  overrides: Partial<CandidateTargetFootprintV1> = {},
): CandidateTargetFootprintV1 {
  return { version: 1, scope, worldGroupId: null,
    writes: [{ table: 'worldviews', target: { kind: 'singleton' }, paths, semantics: 'patch', ...write }],
    ...overrides }
}
const compare = compareCandidateTargetFootprintsV1

describe('064 F0 registered target contracts (no dispatch/adoption authority)', () => {
  it('permits pending story premise alongside races and independent fields in the same singleton', () => {
    expect(compare(footprint(), footprint([['concept']], { table: 'storyCores' }))).toEqual([])
    expect(compare(footprint(), footprint([['powerHierarchy']]))).toEqual([])
    expect(compare(footprint(), footprint([['factionLayout']]))).toEqual([])
  })

  it('reports exact intersecting write indices/paths across all multi-field targets', () => {
    const pending = footprint([['powerHierarchy'], ['races']])
    const requested = footprint([['concept']], { table: 'storyCores' })
    requested.writes = [...requested.writes, ...footprint().writes]
    expect(compare(requested, pending)).toEqual([{
      requestedIndex: 1, pendingIndex: 0, table: 'worldviews', kind: 'field-overlap',
      requestedPath: ['races'], pendingPath: ['races'],
    }])
  })

  it('uses the formal World owner across producing Works and keeps worlds/projects separate', () => {
    expect(compare(footprint(), footprint(undefined, {}, { scope: { ...scope, workId: 4 } }))).toHaveLength(1)
    expect(compare(footprint(), footprint(undefined, {}, { scope: { ...scope, worldId: 4 } }))).toEqual([])
    expect(compare(footprint(), footprint(undefined, {}, { scope: { ...scope, projectId: 4 } }))).toEqual([])
  })

  it('applies group partition only to a registered worldScoped table', () => {
    expect(compare(footprint(), footprint(undefined, {}, { worldGroupId: 9 }))).toEqual([])
    const story = footprint([['concept']], { table: 'storyCores' })
    expect(compare(story, { ...story, worldGroupId: 9 })).toHaveLength(1)
    expect(compare(story, { ...story, scope: { ...scope, workId: 9 } })).toEqual([])
  })

  it('distinguishes actual record replacement from a partial patch regardless of API mode labels', () => {
    expect(compare(footprint(), footprint([['powerHierarchy']]))).toEqual([])
    expect(compare(footprint(), footprint([['powerHierarchy']], { semantics: 'record-replace' }))[0]?.kind)
      .toBe('record-replace')
    expect(() => normalizeCandidateTargetFootprintV1({ ...footprint(), mode: 'replace' }))
      .toThrow(CandidateTargetContractErrorV1)
  })

  it('keeps a singleton slot stable before/after row creation, without aliasing all record IDs', () => {
    expect(compare(footprint(), footprint(undefined, { target: { kind: 'singleton', recordId: 12 } }))).toHaveLength(1)
    expect(compare(footprint(), footprint([['powerHierarchy']], { target: { kind: 'singleton', recordId: 12 } }))).toEqual([])
    expect(compare(footprint(undefined, { target: { kind: 'record', recordId: 12 } }),
      footprint(undefined, { target: { kind: 'record', recordId: 13 } }))).toEqual([])
    expect(compare(footprint(undefined, { target: { kind: 'record', recordId: 12 } }),
      footprint(undefined, { target: { kind: 'singleton', recordId: 12 } }))).toHaveLength(1)
  })

  it('compares path segments symmetrically without string-prefix mistakes', () => {
    expect(candidateTargetPathsOverlapV1(['entries'], ['entries', 'rule'])).toBe(true)
    expect(candidateTargetPathsOverlapV1(['entries', 'rule'], ['entries'])).toBe(true)
    expect(candidateTargetPathsOverlapV1(['entry'], ['entries'])).toBe(false)
    expect(candidateTargetPathsOverlapV1(['entries', 'first'], ['entries', 'second'])).toBe(false)
  })

  it('normalizes object child requests to the actual top-level replacement boundary', () => {
    expect(compare(footprint([['divineDesign', 'divineNames']]),
      footprint([['divineDesign', 'divineRules']]))[0]?.requestedPath).toEqual(['divineDesign'])
    expect(() => normalizeCandidateTargetFootprintV1(footprint([['races', 'inventedChild']])))
      .toThrow('标量字段')
  })

  it('compares bound stable intent identities without treating null or names as create identities', () => {
    expect(candidateTargetIdentitiesOverlapV1({ kind: 'create', intentId: 'stable-a' },
      { kind: 'create', intentId: 'stable-b' })).toBe(false)
    expect(candidateTargetIdentitiesOverlapV1({ kind: 'create', intentId: 'stable-a' },
      { kind: 'create', intentId: 'stable-a' })).toBe(true)
    expect(() => candidateTargetIdentitiesOverlapV1({ kind: 'record', recordId: null } as never,
      { kind: 'record', recordId: 1 })).toThrow(CandidateTargetContractErrorV1)
  })

  it('does not mistake distinct UUIDs for proof of independent name/composite upserts', () => {
    const a = footprint([['name']], { table: 'characters', target: { kind: 'create', intentId: 'stable-a' } })
    const b = footprint([['name']], { table: 'characters', target: { kind: 'create', intentId: 'stable-b' } })
    expect(normalizeCandidateTargetFootprintV1(a)[0]?.target.kind).toBe('unknown')
    expect(compare(a, b)[0]?.kind).toBe('uncertain-target')
    expect(() => normalizeCandidateTargetFootprintV1(footprint(undefined,
      { target: { kind: 'create', intentId: 'not-a-singleton-slot' } }))).toThrow('集合创建')
  })

  it('bounds legacy uncertainty to its nonempty table/owner/field or explicit possible records', () => {
    const unknown = footprint(undefined, { target: { kind: 'unknown', reason: '历史契约仅确定种族字段' } })
    expect(compare(footprint(), unknown)[0]?.kind).toBe('uncertain-target')
    expect(compare(footprint([['powerHierarchy']]), unknown)).toEqual([])
    expect(compare(footprint([['concept']], { table: 'storyCores' }), unknown)).toEqual([])
    const possible = footprint(undefined, { target: { kind: 'possible-records', recordIds: [12, 14], reason: '冻结记录集合' } })
    expect(compare(footprint(undefined, { target: { kind: 'record', recordId: 13 } }), possible)).toEqual([])
    expect(compare(footprint(undefined, { target: { kind: 'record', recordId: 14 } }), possible)).toHaveLength(1)
  })

  it.each([
    ['version', { ...footprint(), version: 2 }],
    ['table', footprint(undefined, { table: 'notRegistered' })],
    ['field', footprint([['notRegistered']])],
    ['owner', footprint(undefined, { owner: 'work' })],
    ['scope', { ...footprint(), scope: { ...scope, worldId: 0 } }],
    ['empty plan', { ...footprint(), writes: [] }],
    ['empty fields', footprint([])],
    ['empty path', footprint([[]])],
    ['dotted path', footprint([['divineDesign.divineNames']])],
    ['unsafe path', footprint([['divineDesign', '__proto__']])],
    ['empty uncertainty', footprint([], { target: { kind: 'unknown', reason: 'unknown' } })],
    ['empty possible set', footprint(undefined, { target: { kind: 'possible-records', recordIds: [], reason: 'unknown' } })],
    ['empty intent', footprint(undefined, { target: { kind: 'create', intentId: '' } })],
  ])('rejects malformed %s rather than admitting an empty footprint', (_label, value) => {
    expect(() => normalizeCandidateTargetFootprintV1(value)).toThrow(CandidateTargetContractErrorV1)
  })

  it('derives current fields from the registry and returns detached normalized data', () => {
    const input = footprint(WORLDVIEW_GENERATABLE_FIELD_SPECS.map(field => [field.field]))
    const serialized = JSON.stringify(input)
    const normalized = normalizeCandidateTargetFootprintV1(input)
    expect(normalized[0]?.paths).toHaveLength(WORLDVIEW_GENERATABLE_FIELD_SPECS.length)
    expect(normalized[0]?.paths).not.toBe(input.writes[0]?.paths)
    expect(JSON.stringify(input)).toBe(serialized)
  })
})
