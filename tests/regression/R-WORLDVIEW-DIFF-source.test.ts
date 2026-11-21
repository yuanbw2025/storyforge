import { describe, expect, it } from 'vitest'
import {
  canonicalDiffSourceJsonV2, extractWorldviewDiffArtifactValueV2, freezeWorldviewDiffBaselineV2, selectWorldviewDiffDisplaySourceV2,
  type DiffSourceBindingV2, type DiffDisplaySourceInputV2,
} from '../../src/lib/agent/worldview-diff-display-source'
const field = 'worldStructure'
function binding(): DiffSourceBindingV2 {
  return { identity: { scope: { projectId: 'project', worldId: 'world', conversationId: 'conversation' }, taskId: 'task', eventId: 17, runId: 'run', runGeneration: 2, field },
    payloadField: field, parserField: field, admittedTextField: field, operation: 'expand', baseSnapshot: { version: 3, values: { [field]: ' 原文\r\n\ud800 ' }, context: { order: ['a', 'b'] } } }
}
function input(): DiffDisplaySourceInputV2 {
  const b = binding()
  return { binding: b, frozen: freezeWorldviewDiffBaselineV2(b), candidateContent: JSON.stringify({ field, value: ' 新文\r\n\ud800 ' }), rightRevision: 0 }
}
const artifact = (raw: string) => JSON.stringify({ field, value: raw })
const selected = (v: DiffDisplaySourceInputV2) => { const r = selectWorldviewDiffDisplaySourceV2(v); expect(r.available).toBe(true); if (!r.available) throw new Error(r.reason); return r }
describe('054-A frozen display source', () => {
  it('freezes an immutable raw copy; right revisions never redefine the left identity', () => {
    const v = input(), first = selected(v)
    expect(Object.isFrozen(v.frozen)).toBe(true)
    for (let i = 1; i < 5; i++) {
      v.candidateContent = artifact(`修订${i}`); v.rightRevision = i
      const next = selected(v)
      expect(next.left).toBe(first.left); expect(next.identity).toBe(first.identity); expect(next.right).toBe(`修订${i}`)
    }
    expect(first.left).toBe(' 原文\r\n\ud800 ')
  })
  it('canonical snapshot key order is irrelevant, but any full snapshot/value drift declines', () => {
    const v = input()
    v.binding.baseSnapshot = { context: { order: ['a', 'b'] }, values: { [field]: ' 原文\r\n\ud800 ' }, version: 3 }
    expect(selected(v).left).toBe(v.frozen.raw)
    for (const snapshot of [{ version: 4, values: { [field]: v.frozen.raw }, context: { order: ['a', 'b'] } }, { version: 3, values: { [field]: 'latest database text' }, context: { order: ['a', 'b'] } }]) {
      v.binding.baseSnapshot = snapshot
      expect(selectWorldviewDiffDisplaySourceV2(v)).toMatchObject({ available: false, reason: 'frozen-baseline-drift' })
    }
  })
  it.each(['payloadField', 'parserField', 'admittedTextField'] as const)('rejects %s mismatch without a new admission allowlist', key => {
    const v = input(); v.binding[key] = 'races'
    expect(selectWorldviewDiffDisplaySourceV2(v).available).toBe(false)
  })
  it('rejects scope, event, task, run or field identity drift', () => {
    const mutations: Array<(b: DiffSourceBindingV2) => void> = [b => { b.identity.scope.projectId = 'other' }, b => { b.identity.scope.conversationId = 'other' }, b => { b.identity.eventId++ }, b => { b.identity.taskId = 'other' }, b => { b.identity.runGeneration = 3 }, b => { b.identity.runId = 'other' }, b => { b.identity.field = 'races' }]
    for (const mutate of mutations) { const v = input(); mutate(v.binding); expect(selectWorldviewDiffDisplaySourceV2(v).available).toBe(false) }
  })
  it('uses frozen operation and rejects changing it or comparing create/rewrite', () => {
    const v = input(); v.binding.operation = 'polish'
    expect(selectWorldviewDiffDisplaySourceV2(v)).toMatchObject({ available: false, reason: 'frozen-baseline-drift' })
    for (const operation of ['create', 'rewrite'] as const) { const b = binding(); b.operation = operation; expect(selectWorldviewDiffDisplaySourceV2({ ...input(), binding: b, frozen: freezeWorldviewDiffBaselineV2(b) })).toMatchObject({ available: false, reason: 'operation-not-comparable' }) }
  })
  it.each([undefined, null, {}, 0, false])('never coerces ambiguous baseline %j to empty text', raw => {
    const b = binding(); b.baseSnapshot = { values: { [field]: raw } }
    expect(() => freezeWorldviewDiffBaselineV2(b)).toThrow()
  })
  it('empty own baseline is valid but inherited properties/accessors/cycles are not', () => {
    const b = binding(); b.baseSnapshot = { values: { [field]: '' } }; expect(freezeWorldviewDiffBaselineV2(b).raw).toBe('')
    const cycle: Record<string, unknown> = {}; cycle.self = cycle
    let getterCalled = false
    for (const value of [Object.create({ values: { [field]: '' } }), { values: Object.create({ [field]: '' }) }, cycle, { get values() { getterCalled = true; return { [field]: '' } } }, { values: { [field]: '' }, extra: NaN }]) { b.baseSnapshot = value; expect(() => freezeWorldviewDiffBaselineV2(b)).toThrow() }
    expect(getterCalled).toBe(false)
  })
  it('lossless canonical identity distinguishes lone surrogates and replacement characters', () => {
    expect(canonicalDiffSourceJsonV2({ raw: '\ud800' })).not.toBe(canonicalDiffSourceJsonV2({ raw: '\ufffd' }))
    expect(canonicalDiffSourceJsonV2({ raw: '\udc00' })).not.toBe(canonicalDiffSourceJsonV2({ raw: '\ud800' }))
  })
  it.each(['saving', 'blocked', 'failed'] as const)('uses actual lookup-bound field draft during %s, including empty invalid edits', status => {
    const v = input(); v.visible = { identity: structuredClone(v.binding.identity), kind: 'field-value', draft: { rawValue: '', status } }
    expect(selected(v)).toMatchObject({ right: '', source: 'field-draft', editorKind: 'field-value' })
    v.visible.draft.rawValue = '未闭合{\n👩🏽‍🚀'; expect(selected(v).right).toBe('未闭合{\n👩🏽‍🚀')
    v.visible.identity.eventId++; expect(selectWorldviewDiffDisplaySourceV2(v)).toMatchObject({ available: false, reason: 'draft-lookup-identity-drift' })
  })
  it('raw artifact repair held/rejected persists its route; a valid optimistic event cannot change it', () => {
    for (const status of ['saving', 'failed', 'blocked'] as const) {
      const v = input(); v.binding.parserField = null
      v.visible = { identity: v.binding.identity, kind: 'raw-artifact', draft: { rawValue: '{broken', status } }
      expect(selectWorldviewDiffDisplaySourceV2(v)).toMatchObject({ available: false, editorKind: 'raw-artifact' })
      v.visible.draft.rawValue = artifact('修复后的正文'); v.candidateContent = v.visible.draft.rawValue; v.binding.parserField = field; v.rightRevision++
      expect(selected(v)).toMatchObject({ right: '修复后的正文', source: 'raw-artifact-draft', editorKind: 'raw-artifact' })
      // IME tail/rejected syntax must not expose stale optimistic content.
      v.visible.draft.rawValue += '组合中'; expect(selectWorldviewDiffDisplaySourceV2(v)).toMatchObject({ available: false, editorKind: 'raw-artifact' })
    }
  })
  it('JSON-looking genuine field prose remains literal; source kind is never inferred from content', () => {
    const v = input(), jsonLooking = artifact('这是字面正文')
    v.visible = { identity: v.binding.identity, kind: 'field-value', draft: { rawValue: jsonLooking, status: 'saving' } }
    expect(selected(v).right).toBe(jsonLooking)
    v.visible.kind = 'raw-artifact'; expect(selected(v).right).toBe('这是字面正文')
    v.visible.kind = 'unknown'; expect(selectWorldviewDiffDisplaySourceV2(v)).toMatchObject({ available: false, reason: 'unknown-draft-kind' })
    // Remount cannot recover route from parsed success. Missing route evidence
    // stays unknown until the real consumer resolves ack/discard/session state.
    const remounted = structuredClone(v); remounted.candidateContent = jsonLooking
    expect(selectWorldviewDiffDisplaySourceV2(remounted).available).toBe(false)
    v.visible.draft.status = 'discarding'; v.visible.kind = 'field-value'
    expect(selectWorldviewDiffDisplaySourceV2(v)).toMatchObject({ available: false, reason: 'draft-discarding' })
  })
  it('lossless saved source is a display-only difference from the old trimmed parser', () => {
    const v = input(); v.legacyParsedValue = '新文\r\n\ud800'
    const prior = v.candidateContent
    expect(selected(v)).toMatchObject({ right: ' 新文\r\n\ud800 ', legacyBoundaryTrim: true })
    expect(v.candidateContent).toBe(prior)
    v.candidateContent = '{field: "worldStructure", value:"repaired by legacy only"}'
    expect(selectWorldviewDiffDisplaySourceV2(v).available).toBe(false)
  })
  it.each([NaN, -1, 0.5, Infinity])('rejects invalid right revision %s', revision => {
    expect(selectWorldviewDiffDisplaySourceV2({ ...input(), rightRevision: revision }).available).toBe(false)
  })
})
describe('054-A strict whole-artifact extraction', () => {
  it.each(['', ' \t\r\n', '\ud800\udc00\ud800\ufffd', 'e\u0301👩🏽‍🚀', '{"field":"races","value":"literal"}'])('preserves raw value %j', raw => {
    expect(extractWorldviewDiffArtifactValueV2(artifact(raw), field)).toBe(raw)
    expect(extractWorldviewDiffArtifactValueV2(' \t```json\r\n' + artifact(raw) + '\r\n```\r\n', field)).toBe(raw)
  })
  it.each([
    '{"field":"worldStructure","value":"a","value":"b"}',
    '{"field":"worldStructure","value":"a","\\u0076alue":"b"}',
    '{"field":"worldStructure","\\u0066ield":"worldStructure","value":"b"}',
    '{"field":"worldStructure","value":"a","extra":{"x":1,"\\u0078":2}}',
    '{"field":"worldStructure","value":"a","temporaryAssumptions":[{"x":1,"x":2}]}',
    '{"field":"worldStructure","value":"a","__proto__":{}}',
    '{"field":"races","value":"a"}', '{"field":"worldStructure","value":null}', '{"field":"worldStructure","value":{}}',
    '{"field":"worldStructure","value":"a","extra":0}', '{"field":"worldStructure","value":"a","temporaryAssumptions":[1]}',
    '{"field":"worldStructure","value":"a"}junk', '{"field":"worldStructure","value":"a"}{}',
    '{"field":"worldStructure","value":"bad\\x20"}', '{"field":"worldStructure","value":"bad\\u12xx"}',
    '{"field":"worldStructure","value":"a",}', '{field:"worldStructure",value:"a"}',
    '{"field":"worldStructure","value":"a"', '[{"field":"worldStructure","value":"a"}]',
    '```json\n{"field":"worldStructure","value":"a"}\n```\nextra', '```json\n{"field":"worldStructure","value":"a"}',
    '\ufeff{"field":"worldStructure","value":"a"}',
  ])('rejects ambiguous, repaired or incomplete artifact %s', content => {
    expect(() => extractWorldviewDiffArtifactValueV2(content, field)).toThrow()
  })
  it('accepts only string assumptions and rejects bounded-depth/size attacks', () => {
    expect(extractWorldviewDiffArtifactValueV2(JSON.stringify({ field, value: '正文', temporaryAssumptions: ['未确认'] }), field)).toBe('正文')
    expect(() => extractWorldviewDiffArtifactValueV2('['.repeat(40) + '0' + ']'.repeat(40), field)).toThrow('structure limit')
    expect(() => extractWorldviewDiffArtifactValueV2(' '.repeat(500001), field)).toThrow('size/type limit')
  })
})
