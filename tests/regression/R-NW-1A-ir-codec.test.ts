import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import corpus from '../acceptance/narrative-world/corpus-v1.json'
import { db } from '../../src/lib/db/schema'
import { adopt } from '../../src/lib/registry/adopt'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { FIELD_REGISTRY } from '../../src/lib/registry/field-registry'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { seedNarrativeFamily } from '../helpers/narrative-world-evaluation'
import { narrativeIRFixture, NW_HASH, NW_OWNER } from '../helpers/narrative-ir-fixture'
import type { NarrativeRecordV1 } from '../../src/lib/types/narrative-ir'
import type { NarrativeTimeContextV1, TimePointV1 } from '../../src/lib/types/narrative-time'
import {
  createNarrativeSemanticIdV1, freezeNarrativeChapterSequenceV1, inspectNarrativeIdentitiesV1,
  narrativeOwnerKeyV1, parseNarrativeSemanticIdV1, resolveNarrativeLegacyAliasV1, resolveNarrativeRegisteredFkV1,
} from '../../src/lib/world-engine/narrative-identity'
import {
  compileNarrativeIRBundleV1, hashNarrativeBundleV1, hashNarrativeRecordV1, verifyNarrativeEvidenceV1, verifyNarrativeIRBundleV1,
} from '../../src/lib/world-engine/narrative-ir'
import { encodeNarrativeIRBundleV1, parseNarrativeIRBundleV1, typedValueDecoderV1 } from '../../src/lib/world-engine/narrative-ir-codec'
import { createWorldPackage, importWorldPackage, WORLD_PACKAGE_USES } from '../../src/lib/world-engine/world-package'
import { canonicalNarrativeJsonV1, hashNarrativeBytesV1, hashNarrativeValueV1 } from '../../src/lib/world-engine/narrative-json'
import {
  compareNarrativeTimeV1, legacyNarrativeTimeV1, narrativeIntervalContainsV1, parseNarrativeTimeContextV1,
  parseNarrativeTimeV1, resolveLegacyNarrativeCutoffV1, unknownNarrativeTimeV1,
} from '../../src/lib/world-engine/narrative-time'

const tick = (value: string, timelineKey = 'days'): TimePointV1 => ({ kind: 'tick', timelineKey, value })
const anchor = (eventKey: string, side: 'before' | 'at' | 'after' = 'at'): TimePointV1 => ({ kind: 'event-anchor', eventKey, side })
const timeContext = (): NarrativeTimeContextV1 => ({ version: 1,
  timelines: ['days', 'foreign'].map(timelineKey => ({ timelineKey, worldKey: timelineKey === 'days' ? 'world-A' : 'world-B',
    branchKey: 'canon', calendar: 'fictional', unit: 'day', epoch: 'zero' })),
  sequences: [], anchors: [{ eventKey: 'A', timelineKey: 'days', value: '2' },
    { eventKey: 'B', timelineKey: 'days', value: null }, { eventKey: 'C', timelineKey: 'days', value: '8' }],
  before: [{ beforeEventKey: 'A', afterEventKey: 'B' }, { beforeEventKey: 'B', afterEventKey: 'C' }], mappings: [],
})

describe('NW-1A · strict wire codec, hashes and evidence', () => {
  it('all eight variants round-trip; stable golden vectors use Unicode code points and raw UTF-8', async () => {
    const fixture = await narrativeIRFixture()
    const encoded = encodeNarrativeIRBundleV1(fixture.bundle)
    expect(await verifyNarrativeIRBundleV1(encoded, fixture.sources)).toEqual(fixture.bundle)
    expect(new Set(fixture.bundle.records.map(r => r.kind)).size).toBe(8)
    const canonical = canonicalNarrativeJsonV1({ '\u{10000}': '𐀀', '\ue000': '私', a: ['e\u0301', 'é', '\r\n'] })
    expect(canonical).toBe('{"a":["é","é","\\r\\n"],"":"私","𐀀":"𐀀"}')
    const observed = { schema: 'storyforge.narrative-ir-golden', version: 1, canonical,
      canonicalSha256: createHash('sha256').update(canonical).digest('hex'),
      semanticRootHash: fixture.bundle.semanticRootHash,
      recordHashes: fixture.bundle.records.map(r => ({ semanticId: r.semanticId, revisionHash: r.revisionHash })),
      encodedSha256: createHash('sha256').update(encoded).digest('hex') }
    expect(await hashNarrativeValueV1(JSON.parse(canonical))).toBe(observed.canonicalSha256)
    const file = 'tests/acceptance/narrative-world/ir-codec-golden-v1.json'
    if (process.env.NW_IR_WRITE_GOLDEN === '1') fs.writeFileSync(file, JSON.stringify(observed, null, 2) + '\n')
    else expect(observed).toEqual(JSON.parse(fs.readFileSync(file, 'utf8')))
  })

  it('semantic sets normalize deterministically, while ordered values and source bytes preserve order', async () => {
    const f = await narrativeIRFixture()
    const reversed = structuredClone(f.input)
    reversed.records.reverse(); reversed.evidence.reverse()
    expect((await compileNarrativeIRBundleV1(reversed, [...f.sources].reverse())).semanticRootHash).toBe(f.bundle.semanticRootHash)
    const first = { kind: 'ordered-set', values: [{ kind: 'text', value: '甲' }, { kind: 'text', value: '乙' }] }
    expect(typedValueDecoderV1(first, 'value')).toEqual(first)
    expect(await hashNarrativeValueV1(first)).not.toBe(await hashNarrativeValueV1({ ...first, values: [...first.values].reverse() }))
    expect(await hashNarrativeBytesV1('e\u0301\r\n')).not.toBe(await hashNarrativeBytesV1('é\n'))
  })

  it.each(['root-extra', 'scope-extra', 'owner-extra', 'payload-extra', 'time-extra', 'future', 'unknown-kind',
    'numeric-id', 'wrong-source', 'entity-kind', 'mixed-owner', 'confidence', 'intent-public', 'non-json', 'pointer'])(
    'rejects exact-contract violation: %s', async mutation => {
      const f = await narrativeIRFixture()
      const changed: any = structuredClone(f.bundle)
      const entity = changed.records.find((r: NarrativeRecordV1) => r.kind === 'entity')
      if (mutation === 'root-extra') changed.runtime = {}
      if (mutation === 'scope-extra') changed.scope.projectId = 1
      if (mutation === 'owner-extra') changed.scope.owner.worldCode = 'W-ABCDE-1234'
      if (mutation === 'payload-extra') entity.payload.secret = 'secret'
      if (mutation === 'time-extra') entity.time.createdAt = 1
      if (mutation === 'future') changed.irVersion = 2
      if (mutation === 'unknown-kind') entity.kind = 'runtime'
      if (mutation === 'numeric-id') entity.semanticId = 'character:1'
      if (mutation === 'wrong-source') entity.provenance.sourceResourceKey = 'character:another'
      if (mutation === 'entity-kind') entity.payload.entityType = 'location'
      if (mutation === 'mixed-owner') entity.scope.owner.workCode = 'WORK-00000000-0000-4000-8000-000000000999'
      if (mutation === 'confidence') entity.confidence = 1.1
      if (mutation === 'intent-public') changed.records.find((r: NarrativeRecordV1) => r.modality === 'intent').visibility.class = 'public'
      if (mutation === 'non-json') entity.confidence = NaN
      if (mutation === 'pointer') entity.provenance.sourceField = '/bad~escape'
      expect(() => parseNarrativeIRBundleV1(changed)).toThrow()
    },
  )
  it.each(['duplicate-record', 'missing-reference', 'stale-reference', 'wrong-reference-kind', 'source-tamper', 'span-split',
    'span-empty', 'root-tamper', 'sequence-missing', 'unregistered-predicate', 'predicate-value', 'hard-validator'])(
    'fails verification instead of accepting incomplete/tampered closure: %s', async mutation => {
      const f = await narrativeIRFixture()
      const changed: any = structuredClone(f.bundle)
      const sources = structuredClone(f.sources)
      const relation = changed.records.find((r: NarrativeRecordV1) => r.kind === 'relation')
      if (mutation === 'duplicate-record') changed.records.push(changed.records[0])
      if (mutation === 'missing-reference') changed.records = changed.records.filter((r: NarrativeRecordV1) => r.semanticId !== f.ids[0])
      if (mutation === 'stale-reference') relation.payload.fromRef.revisionHash = 'b'.repeat(64)
      if (mutation === 'wrong-reference-kind') relation.payload.fromRef.kind = 'event'
      if (mutation === 'source-tamper') sources[0].text += '改'
      if (mutation === 'span-split') changed.evidence[0].start = 1
      if (mutation === 'span-empty') changed.evidence[0].end = 0
      if (mutation === 'root-tamper') changed.semanticRootHash = NW_HASH
      if (mutation === 'sequence-missing') changed.timeContext.sequences = []
      if (mutation === 'unregistered-predicate') changed.records.find((r: NarrativeRecordV1) => r.kind === 'assertion').payload.predicateKey = 'unregistered'
      if (mutation === 'predicate-value') changed.records.find((r: NarrativeRecordV1) => r.kind === 'assertion').payload.value = { kind: 'boolean', value: true }
      if (mutation === 'hard-validator') Object.assign(changed.records.find((r: NarrativeRecordV1) => r.kind === 'rule').payload,
        { strength: 'hard', validatorRef: { key: 'model-guessed-validator', version: '1' } })
      if (['unregistered-predicate', 'predicate-value', 'hard-validator'].includes(mutation)) {
        await expect(compileNarrativeIRBundleV1(changed, sources)).rejects.toThrow()
      } else await expect(verifyNarrativeIRBundleV1(changed, sources)).rejects.toThrow()
    },
  )
  it('cyclic semantic dependencies hash in two stages; changed target hashes are still rejected', async () => {
    const f = await narrativeIRFixture()
    f.input.records[0].dependencies = [{ semanticId: f.ids[1], revisionHash: NW_HASH, role: 'contradicts' }]
    f.input.records[1].dependencies = [{ semanticId: f.ids[0], revisionHash: NW_HASH, role: 'contradicts' }]
    const bundle = await compileNarrativeIRBundleV1(f.input, f.sources)
    expect(await verifyNarrativeIRBundleV1(bundle, f.sources)).toEqual(bundle)
    const altered = structuredClone(bundle)
    const changed = altered.records.find(r => r.semanticId === f.ids[0])!
    changed.dependencies[0].revisionHash = 'f'.repeat(64)
    expect(await hashNarrativeRecordV1(changed)).toBe(bundle.records.find(r => r.semanticId === changed.semanticId)!.revisionHash)
    expect(await hashNarrativeBundleV1(altered)).not.toBe(bundle.semanticRootHash)
    await expect(verifyNarrativeIRBundleV1(altered, f.sources)).rejects.toThrow('stale-reference')
  })
  it('content changes revise hashes but never identity; a global revision vector does not recursively revise every record', async () => {
    const f = await narrativeIRFixture()
    const renamed = structuredClone(f.input)
    const entity = renamed.records[0]
    if (entity.kind !== 'entity') throw new Error('fixture')
    entity.payload.canonicalLabel = '改名'
    const next = await compileNarrativeIRBundleV1(renamed, f.sources)
    expect(next.records.map(r => r.semanticId)).toEqual(f.bundle.records.map(r => r.semanticId))
    expect(next.records.find(r => r.semanticId === entity.semanticId)?.revisionHash).not.toBe(f.bundle.records.find(r => r.semanticId === entity.semanticId)?.revisionHash)
    const vector = structuredClone(f.input)
    vector.scope.revisionVectorHash = 'c'.repeat(64)
    vector.records.forEach(r => { r.scope.revisionVectorHash = vector.scope.revisionVectorHash })
    const recompiled = await compileNarrativeIRBundleV1(vector, f.sources)
    expect(recompiled.records.map(r => r.revisionHash)).toEqual(f.bundle.records.map(r => r.revisionHash))
    expect(recompiled.semanticRootHash).not.toBe(f.bundle.semanticRootHash)
  })
  it('compilation refuses stale bound input and does not silently repair a dependency receipt', async () => {
    const f = await narrativeIRFixture()
    const stale = structuredClone(f.bundle)
    const relation = stale.records.find(r => r.kind === 'relation')!
    relation.payload.fromRef.revisionHash = 'd'.repeat(64)
    await expect(compileNarrativeIRBundleV1(stale, f.sources)).rejects.toThrow('stale-reference')
    expect(relation.payload.fromRef.revisionHash).toBe('d'.repeat(64))
  })
  it('narrated offsets must refer to evidence in the frozen unit and lie on UTF-8 boundaries', async () => {
    const f = await narrativeIRFixture()
    f.input.records[8].time.narratedAt = { sequenceKey: 'main-sequence', unitKey: f.identities[8].sourceUid, spanStart: 0 }
    expect((await compileNarrativeIRBundleV1(f.input, f.sources)).records.find(r => r.kind === 'disclosure')?.time.narratedAt?.spanStart).toBe(0)
    f.input.records[8].time.narratedAt.spanStart = 1
    await expect(compileNarrativeIRBundleV1(f.input, f.sources)).rejects.toThrow('narration-evidence')
  })
  it('shared-source evidence still verifies each span and provenance, and later source edits cannot reuse a prior verification', async () => {
    const f = await narrativeIRFixture()
    f.input.evidence.push({ ...f.input.evidence[0], evidenceId: 'partial-proof', start: 3, end: 6, spanHash: await hashNarrativeBytesV1('青') })
    f.input.records[0].evidenceIds.push('partial-proof')
    const bundle = await compileNarrativeIRBundleV1(f.input, f.sources)
    expect(await verifyNarrativeIRBundleV1(bundle, f.sources)).toEqual(bundle)
    const corruptSpan = structuredClone(bundle)
    corruptSpan.evidence.find(span => span.evidenceId === 'partial-proof')!.spanHash = NW_HASH
    await expect(verifyNarrativeIRBundleV1(corruptSpan, f.sources)).rejects.toThrow('evidence-hash')
    const corruptProvenance = structuredClone(f.input)
    corruptProvenance.records[0].provenance.sourceContentHash = NW_HASH
    await expect(compileNarrativeIRBundleV1(corruptProvenance, f.sources)).rejects.toThrow('provenance-hash')
    f.sources[0].text += '后改原文'
    await expect(verifyNarrativeIRBundleV1(bundle, f.sources)).rejects.toThrow('evidence-hash')
  })
  it('typed scalar alternatives and historical validity survive codec without becoming current Canon or correcting beliefs', async () => {
    const f = await narrativeIRFixture()
    for (const value of [{ kind: 'decimal', value: '12345678901234567890.123', unit: 'day' },
      { kind: 'enum', value: 'unknown' }, { kind: 'entity-ref', value: { kind: 'entity', semanticId: f.ids[0], revisionHash: NW_HASH } }]) {
      expect(typedValueDecoderV1(value, 'value')).toEqual(value)
    }
    for (const value of ['01', '1.0', '-0', '1e5']) expect(() => typedValueDecoderV1({ kind: 'decimal', value, unit: null }, 'value')).toThrow('decimal')
    const historical = f.input.records[3]
    historical.reviewState = 'historical'
    historical.time.valid = { start: tick('1'), end: tick('2'), endMeaning: 'known' }
    const compiled = await compileNarrativeIRBundleV1(f.input, f.sources)
    expect(compiled.records.find(r => r.semanticId === historical.semanticId)).toMatchObject({ reviewState: 'historical', time: { valid: historical.time.valid } })
    expect(compiled.records.find(r => r.kind === 'epistemic-event')).toMatchObject({ modality: 'belief', payload: { attitude: 'believe', assertedValue: { value: '茶摊' } } })
    expect(compiled.records.find(r => r.kind === 'development')).toMatchObject({ modality: 'intent', visibility: { class: 'author-only' } })
  })
  it('same name, stable subrecord, namespace and explicit aliases remain distinct', async () => {
    const f = await narrativeIRFixture()
    expect(f.ids[0]).not.toBe(f.ids[1])
    const source = { ...f.identities[0], subKey: 'sub:v1:00000000-0000-4000-8000-000000000003' }
    const validOldUid = { ...f.identities[0], sourceUid: 'res:v1:character:ABCDEFAB-0000-4000-8000-000000000001' }
    expect(parseNarrativeSemanticIdV1(createNarrativeSemanticIdV1(NW_OWNER, 'entity', validOldUid)).source.sourceUid).toBe(validOldUid.sourceUid)
    expect(createNarrativeSemanticIdV1(NW_OWNER, 'entity', source)).not.toBe(f.ids[0])
    expect(() => createNarrativeSemanticIdV1(NW_OWNER, 'entity', { ...source, subKey: '0' })).toThrow('subkey')
    const worldOwner = { kind: 'world' as const, worldCode: 'W-ABCDE-1234', sourceWorkCode: NW_OWNER.kind === 'work' ? NW_OWNER.workCode : null }
    const world = await narrativeIRFixture(worldOwner)
    expect(world.ids[0]).not.toBe(f.ids[0])
    world.input.aliases = [{ version: 1, from: { kind: 'semantic', semanticId: f.ids[0], revisionHash: f.bundle.records.find(r => r.semanticId === f.ids[0])!.revisionHash },
      toSemanticId: world.ids[0], reason: 'derivation', confirmationRef: 'explicit-derivation-1' }]
    const derived = await compileNarrativeIRBundleV1(world.input, world.sources)
    expect(derived.aliases[0].from).toEqual(world.input.aliases[0].from)
    world.input.aliases[0].reason = 'merge'
    await expect(compileNarrativeIRBundleV1(world.input, world.sources)).rejects.toThrow('alias-scope')
    world.input.aliases[0].reason = 'derivation'
    const wrongLineage = structuredClone(world.input)
    if (wrongLineage.scope.owner.kind !== 'world') throw new Error('fixture')
    wrongLineage.scope.owner.sourceWorkCode = 'WORK-00000000-0000-4000-8000-000000000999'
    wrongLineage.records.forEach(r => { r.scope.owner = structuredClone(wrongLineage.scope.owner) })
    await expect(compileNarrativeIRBundleV1(wrongLineage, world.sources)).rejects.toThrow('alias-lineage')
  })
  it('v3 legacy coordinates require exact release binding and never guess by label', async () => {
    const world = await narrativeIRFixture({ kind: 'world', worldCode: 'W-ABCDE-1234', sourceWorkCode: null })
    const old = { kind: 'legacy-release' as const, worldCode: 'W-ABCDE-1234', releaseHash: 'e'.repeat(64), resourceKey: 'character:1' }
    expect(resolveNarrativeLegacyAliasV1(old, [])).toMatchObject({ status: 'release-local' })
    const aliases = [{ version: 1 as const, from: old, toSemanticId: world.ids[0], reason: 'legacy' as const, confirmationRef: 'verified-uid-match' }]
    expect(resolveNarrativeLegacyAliasV1(old, aliases)).toEqual({ status: 'mapped', semanticId: world.ids[0] })
    expect(resolveNarrativeLegacyAliasV1({ ...old, releaseHash: 'f'.repeat(64) }, aliases).status).toBe('release-local')
    expect(() => resolveNarrativeLegacyAliasV1(old, [...aliases, ...aliases])).toThrow('alias-conflict')
    world.input.aliases = aliases
    expect((await compileNarrativeIRBundleV1(world.input, world.sources)).aliases).toEqual(aliases)
  })
  it('rejects merge-alias cycles and preserves explicit same-owner alias receipts', async () => {
    const f = await narrativeIRFixture()
    const hashes = new Map(f.bundle.records.map(r => [r.semanticId, r.revisionHash]))
    f.input.aliases = [{ version: 1, from: { kind: 'semantic', semanticId: f.ids[0], revisionHash: hashes.get(f.ids[0])! },
      toSemanticId: f.ids[1], reason: 'merge', confirmationRef: 'author-merge' }]
    expect((await compileNarrativeIRBundleV1(f.input, f.sources)).aliases).toHaveLength(1)
    f.input.aliases.push({ ...f.input.aliases[0], from: { kind: 'semantic', semanticId: f.ids[1], revisionHash: hashes.get(f.ids[1])! }, toSemanticId: f.ids[0] })
    await expect(compileNarrativeIRBundleV1(f.input, f.sources)).rejects.toThrow('alias-cycle')
  })
  it.each([undefined, NaN, Infinity, -0, Number.MAX_SAFE_INTEGER + 1, '\ud800', new Date(), new Array(2)])('rejects lossy JSON input %#', value => {
    expect(() => canonicalNarrativeJsonV1({ value })).toThrow()
  })
})

describe('NW-1A · independent time axes, partial order and explicit mappings', () => {
  it('large/negative ticks compare exactly without Number precision or calendar guessing', () => {
    expect(compareNarrativeTimeV1(tick('9007199254740993'), tick('9007199254740992'), timeContext())).toBe('after')
    expect(compareNarrativeTimeV1(tick('-1000000000000000000'), tick('2'), timeContext())).toBe('before')
    for (const invalid of ['02', '-0', '+2', '2.0', '2026-10-13', '初三', '1e6']) {
      expect(() => compareNarrativeTimeV1(tick(invalid), tick('2'), timeContext())).toThrow()
    }
  })
  it('keeps occurred day 2, disclosure chapter 8, acquired day 5 and audit timestamps independent', async () => {
    const f = await narrativeIRFixture()
    const event = f.bundle.records.find(r => r.kind === 'event')!, belief = f.bundle.records.find(r => r.kind === 'epistemic-event')!
    expect(event.time.occurred?.start).toEqual(tick('2'))
    expect(f.bundle.timeContext.sequences[0].units[0].ordinal).toBe(7)
    expect(belief.time.acquiredAt).toEqual(tick('5'))
    expect(event.authorUpdatedAt).toBe(2)
    const legacy = legacyNarrativeTimeV1({ chapterUnitKey: 'chapter-8', sequenceKey: 'main', storyTime: '初三' })
    expect(legacy.time).toMatchObject({ narratedAt: { unitKey: 'chapter-8' }, acquiredAt: { kind: 'unknown', label: '初三' }, occurred: null })
    expect(legacy.diagnostics).toContain('unparsed-story-time')
  })
  it('state validity uses [start,end); unknown end is not open-ended truth', () => {
    const interval = { start: tick('2'), end: tick('5'), endMeaning: 'known' as const }
    expect(narrativeIntervalContainsV1(interval, tick('2'), timeContext())).toBe('contains')
    expect(narrativeIntervalContainsV1(interval, tick('5'), timeContext())).toBe('outside')
    expect(narrativeIntervalContainsV1({ ...interval, end: null, endMeaning: 'unknown' }, tick('6'), timeContext())).toBe('uncertain')
    expect(narrativeIntervalContainsV1({ ...interval, end: null, endMeaning: 'open' }, tick('6'), timeContext())).toBe('contains')
    expect(() => narrativeIntervalContainsV1({ ...interval, end: tick('1') }, tick('2'), timeContext())).toThrow('interval-order')
    expect(() => parseNarrativeTimeV1({ ...unknownNarrativeTimeV1(), valid: { ...interval, end: null } })).toThrow('interval-end')
  })
  it('before/after is a partial order, not cause or an arbitrary total sort', () => {
    expect(compareNarrativeTimeV1(anchor('A'), anchor('C'), timeContext())).toBe('before')
    expect(compareNarrativeTimeV1(anchor('C'), anchor('A'), timeContext())).toBe('after')
    expect(compareNarrativeTimeV1(anchor('A', 'after'), anchor('B', 'before'), timeContext())).toBe('unknown-time')
    expect(compareNarrativeTimeV1(anchor('A', 'before'), anchor('A'), timeContext())).toBe('before')
    const unknown = { kind: 'unknown' as const, label: '很久以前' }
    expect(compareNarrativeTimeV1(unknown, tick('1'), timeContext())).toBe('unknown-time')
    expect(timeContext()).not.toHaveProperty('causes')
  })
  it.each(['cycle', 'tick-conflict', 'cross-timeline-edge', 'missing-anchor', 'duplicate-unit'])(
    'rejects contradictory frozen time data: %s', mutation => {
      const context = timeContext()
      if (mutation === 'cycle') context.before.push({ beforeEventKey: 'C', afterEventKey: 'A' })
      if (mutation === 'tick-conflict') context.anchors[2].value = '1'
      if (mutation === 'cross-timeline-edge') context.anchors[2].timelineKey = 'foreign'
      if (mutation === 'missing-anchor') context.anchors.pop()
      if (mutation === 'duplicate-unit') context.sequences = [{ sequenceKey: 's', ownerKey: 'o', revision: '1', units: [{ unitKey: 'c', ordinal: 1 }, { unitKey: 'c', ordinal: 2 }] }]
      expect(() => parseNarrativeTimeContextV1(context)).toThrow()
    },
  )
  it('only a confirmed, evidenced directed mapping compares different timelines; no implicit inverse or fractional tick', () => {
    const context = timeContext()
    expect(compareNarrativeTimeV1(tick('2'), tick('2', 'foreign'), context)).toBe('incomparable-time')
    context.mappings.push({ mappingKey: 'm1', revision: '1', fromTimelineKey: 'days', toTimelineKey: 'foreign',
      fromStart: '0', fromEnd: '10', numerator: '3', denominator: '2', offset: '4', evidenceIds: ['declaration'], confirmationRef: 'confirmed-1' })
    expect(compareNarrativeTimeV1(tick('2'), tick('7', 'foreign'), context)).toBe('equal')
    expect(compareNarrativeTimeV1(tick('1'), tick('7', 'foreign'), context)).toBe('incomparable-time')
    expect(compareNarrativeTimeV1(tick('10'), tick('19', 'foreign'), context)).toBe('incomparable-time')
    expect(compareNarrativeTimeV1(tick('7', 'foreign'), tick('2'), context)).toBe('incomparable-time')
    context.mappings.push({ ...context.mappings[0], mappingKey: 'overlap' })
    expect(() => parseNarrativeTimeContextV1(context)).toThrow('time-mapping-conflict')
  })
  it('throughChapterId translates only with the exact frozen release coordinate map', () => {
    const sequence = { sequenceKey: 'main', ownerKey: narrativeOwnerKeyV1(NW_OWNER), revision: '1', units: [{ unitKey: 'portable-chapter', ordinal: 7 }] }
    const input = { sequence, releaseHash: 'a'.repeat(64), chapterId: 99, coordinates: [{ releaseHash: 'a'.repeat(64), chapterId: 99, unitKey: 'portable-chapter' }] }
    expect(resolveLegacyNarrativeCutoffV1(input)).toEqual({ status: 'supported', sequenceKey: 'main', unitKey: 'portable-chapter', ordinal: 7 })
    expect(resolveLegacyNarrativeCutoffV1({ ...input, releaseHash: 'b'.repeat(64) }).status).toBe('unsupported')
    expect(resolveLegacyNarrativeCutoffV1({ ...input, chapterId: 7 }).status).toBe('unsupported')
  })
})

describe('NW-1A · NW-0B corpus evidence and current database lifecycle', () => {
  const corpusResults: Array<{ family: string; split: string; distinctEntityCount: number; identitySurvivesRenameAndReorder: boolean;
    frozenSequencePreserved: boolean; originalQueries: number; originalEdits: number; verifiedSpans: number; originalReleasePreserved: boolean }> = []
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it.each(corpus.families)('$title [$split]: identity survives rename/reorder, and original counterexample spans pass the production codec', async family => {
    const f = await seedNarrativeFamily(family)
    const owner = { kind: 'world' as const, worldCode: f.world.code, sourceWorkCode: f.work.code }
    const requests = ['a', 'b'].map(suffix => ({ tableName: 'characters', recordId: f.localIds.get(`${family.id}:character-${suffix}`)!, kind: 'entity' as const }))
    const before = await inspectNarrativeIdentitiesV1({ scope: f.scope, owner, requests })
    expect(before.every(r => r.status === 'available')).toBe(true)
    const ids = before.map(r => r.status === 'available' && r.semanticId)
    expect(new Set(ids).size).toBe(2)
    await db.characters.update(requests[0].recordId, { name: '改名不换身份' })
    const after = await inspectNarrativeIdentitiesV1({ scope: f.scope, owner, requests: [...requests].reverse() })
    expect(after.reverse()).toEqual(before)
    const chapters = await readOwnedRows<any>(f.scope, 'chapters', { owner: 'work' })
    const outlineNodes = await readOwnedRows<any>(f.scope, 'outlineNodes', { owner: 'work' })
    const freeze = (nodes: typeof outlineNodes, revision: string) => freezeNarrativeChapterSequenceV1({ owner, sequenceKey: 'main', revision, chapters, outlineNodes: nodes })
    const first = freeze(outlineNodes, '1')
    expect(first.diagnostics).toEqual([])
    const frozenBytes = canonicalNarrativeJsonV1(first.sequence)
    const second = freeze(outlineNodes.map(n => ({ ...n, order: 3 - n.order })), '2')
    expect(second.sequence?.units.map(u => u.unitKey)).toEqual(first.sequence?.units.map(u => u.unitKey).reverse())
    expect(canonicalNarrativeJsonV1(first.sequence)).toBe(frozenBytes)
    const spans = [...family.queries.flatMap(query => query.evidence), ...family.edits.flatMap(edit => [edit.evidence, ...edit.dependencyEvidence])]
    for (const span of spans) {
      const source = family.sources.find(s => s.id === span.sourceId)!
      await verifyNarrativeEvidenceV1({ evidenceId: `${span.sourceId}:${span.start}`, sourceResourceKey: span.sourceId,
        fieldPointer: '/text', sourceRevision: 'corpus-v1', sourceContentHash: span.sourceHash, normalizationVersion: 'raw-utf8-v1',
        start: span.start, end: span.end, spanHash: span.spanHash, supportRole: 'supports' },
      { sourceResourceKey: span.sourceId, fieldPointer: '/text', sourceRevision: 'corpus-v1', text: source.text })
    }
    const protectedRelease = await db.worldReleases.get(f.release.id!)
    expect(protectedRelease?.contentHash).toBe(f.release.contentHash)
    corpusResults.push({ family: family.id, split: family.split, distinctEntityCount: new Set(ids).size,
      identitySurvivesRenameAndReorder: JSON.stringify(after) === JSON.stringify(before),
      frozenSequencePreserved: canonicalNarrativeJsonV1(first.sequence) === frozenBytes,
      originalQueries: family.queries.length, originalEdits: family.edits.length, verifiedSpans: spans.length,
      originalReleasePreserved: protectedRelease?.contentHash === f.release.contentHash })
  }, 30_000)

  it('backup restoration preserves source UID/namespace while remapping numeric FK and keeping source bytes unchanged', async () => {
    const f = await seedNarrativeFamily(corpus.families[0])
    const exported = await exportProjectJSON(f.scope.projectId)
    const sourceBytes = JSON.stringify(exported)
    const importedId = await importProjectJSON(exported)
    const restored = await resolveWorkspaceOwnership(importedId)
    const originalRows = await readOwnedRows<any>(f.scope, 'characters')
    const restoredRows = await readOwnedRows<any>(restored.scope, 'characters')
    expect(restoredRows.map(r => r.ragDocumentId).sort()).toEqual(originalRows.map(r => r.ragDocumentId).sort())
    expect(restored.world.code).toBe(f.world.code)
    const projectIdentity = async (scope: typeof f.scope, world: typeof f.world, work: typeof f.work, rows: typeof restoredRows) => inspectNarrativeIdentitiesV1({ scope,
      owner: { kind: 'world', worldCode: world.code, sourceWorkCode: work.code },
      requests: rows.map(r => ({ tableName: 'characters', recordId: r.id, kind: 'entity' })) })
    const oldIds = await projectIdentity(f.scope, f.world, f.work, originalRows)
    const newIds = await projectIdentity(restored.scope, restored.world, restored.work, restoredRows)
    expect(newIds.map(r => r.status === 'available' && r.semanticId)).toEqual(oldIds.map(r => r.status === 'available' && r.semanticId))
    const knowledge = await readOwnedRows<any>(restored.scope, 'knowledgeLedger', { owner: 'work' })
    expect(restoredRows.some(r => r.id === knowledge[0].characterId)).toBe(true)
    expect(resolveNarrativeRegisteredFkV1({ tableName: 'knowledgeLedger', field: 'characterId', targetId: knowledge[0].characterId, identities: newIds })).toContain('nir:v1:')
    expect(() => resolveNarrativeRegisteredFkV1({ tableName: 'knowledgeLedger', field: 'inventedId', targetId: 1, identities: newIds })).toThrow('fk-unregistered')
    expect(JSON.stringify(exported)).toBe(sourceBytes)
  }, 30_000)

  it('world-package remix creates a new namespace and preserves the source release hash and lineage', async () => {
    const f = await seedNarrativeFamily(corpus.families[0])
    const pkg = await createWorldPackage(f.release.id!, { authorName: 'NW-1A fixture', license: 'CC-BY-4.0',
      allowedUses: Object.fromEntries(WORLD_PACKAGE_USES.map(use => [use, true])) as Record<typeof WORLD_PACKAGE_USES[number], boolean> })
    const original = JSON.stringify(pkg)
    const importedId = await importWorldPackage(pkg)
    const copied = await resolveWorkspaceOwnership(importedId)
    expect(copied.world.code).not.toBe(f.world.code)
    expect(copied.world.communityOrigin?.sourceWorldCode).toBe(f.world.code)
    const rows = await readOwnedRows<any>(copied.scope, 'characters')
    const identities = await inspectNarrativeIdentitiesV1({ scope: copied.scope,
      owner: { kind: 'world', worldCode: copied.world.code, sourceWorkCode: copied.work.code },
      requests: rows.map(row => ({ tableName: 'characters', recordId: row.id, kind: 'entity' })) })
    for (const identity of identities) {
      expect(identity.status).toBe('available')
      if (identity.status === 'available') expect(identity.semanticId).toContain(encodeURIComponent(copied.world.code))
    }
    expect((await db.worldReleases.where('projectId').equals(importedId).first())?.contentHash).toBe(f.release.contentHash)
    expect(JSON.stringify(pkg)).toBe(original)
  }, 30_000)

  it('old missing identity remains partial without writes; duplicates and foreign Work/World are rejected', async () => {
    const f = await seedNarrativeFamily(corpus.families[0])
    const ids = ['a', 'b'].map(suffix => f.localIds.get(`${corpus.families[0].id}:character-${suffix}`)!)
    const owner = { kind: 'world' as const, worldCode: f.world.code, sourceWorkCode: f.work.code }
    const query = { scope: f.scope, owner, requests: ids.map(recordId => ({ tableName: 'characters', recordId, kind: 'entity' as const })) }
    const firstUid = (await db.characters.get(ids[0]))!.ragDocumentId
    await db.characters.update(ids[1], { ragDocumentId: firstUid })
    await expect(inspectNarrativeIdentitiesV1(query)).rejects.toThrow('duplicate-uid')
    await expect(inspectNarrativeIdentitiesV1({ ...query, requests: [query.requests[0]] })).rejects.toThrow('duplicate-uid')
    await db.characters.update(ids[1], { ragDocumentId: undefined })
    const old = JSON.stringify(await db.characters.get(ids[1]))
    expect((await inspectNarrativeIdentitiesV1(query))[1]).toMatchObject({ status: 'partial', reason: 'source-uid-missing' })
    expect(JSON.stringify(await db.characters.get(ids[1]))).toBe(old)
    await expect(inspectNarrativeIdentitiesV1({ ...query, requests: [{ tableName: 'chapters', recordId: f.foreignChapterId, kind: 'disclosure' }] })).rejects.toThrow('scope')
    await expect(inspectNarrativeIdentitiesV1({ ...query, owner: { ...owner, worldCode: 'W-OTHER-1234' } })).rejects.toThrow('owner')
    await expect(inspectNarrativeIdentitiesV1({ ...query, owner: { ...owner, sourceWorkCode: null }, requests: [{ tableName: 'chapters', recordId: f.localIds.get(`${corpus.families[0].id}:chapter-1`)!, kind: 'disclosure' }] })).rejects.toThrow('lineage')
  })
  it('system identity metadata is rejected by the shared adoption boundary', async () => {
    const f = await seedNarrativeFamily(corpus.families[0])
    const recordId = f.localIds.get(`${corpus.families[0].id}:character-a`)!
    const before = await db.characters.get(recordId)
    const keys = ['ragDocumentId', 'semanticSubKey', 'semanticId', 'revisionHash']
    expect(FIELD_REGISTRY.filter(field => keys.includes(field.field))).toEqual([])
    const result = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'characters', recordId, mode: 'merge',
      data: Object.fromEntries(keys.map(key => [key, 'model-forged'])) })
    expect(result.written).toEqual([])
    expect(result.unknown.sort()).toEqual([...keys].sort())
    // NW-1B registers typed time proposals, but only its confirmation/CAS
    // extension may adopt them. This is not permission for a generic write.
    expect(FIELD_REGISTRY.find(field => field.target === 'characters' && field.field === 'narrativeTimeV1')?.adoptionPolicy)
      .toBe('narrative-annotation-v1')
    const proposal = await adopt({ projectId: f.scope.projectId, scope: f.scope, target: 'characters', recordId, mode: 'merge',
      data: { narrativeTimeV1: 'model-forged' } })
    expect(proposal.written).toEqual([])
    expect(proposal.skipped[0]?.reason).toContain('确认与来源 CAS')
    expect(await db.characters.get(recordId)).toEqual(before)
    expect(PROJECT_TABLES.filter(s => s.resourceIdentity?.narrativeEntityType).map(s => s.name).sort()).toEqual(['characters', 'codexEntries', 'importantLocations', 'worldGroups'])
  })
  afterAll(() => {
    expect(corpusResults).toHaveLength(12)
    const paths = ['src/lib/types/narrative-ir.ts', 'src/lib/types/narrative-time.ts',
      'src/lib/world-engine/narrative-ir.ts', 'src/lib/world-engine/narrative-ir-codec.ts', 'src/lib/world-engine/narrative-identity.ts',
      'src/lib/world-engine/narrative-json.ts', 'src/lib/narrative-domain/json.ts', 'src/lib/narrative-domain/sha256.ts', 'src/lib/world-engine/narrative-time.ts',
      'src/lib/registry/types.ts', 'src/lib/registry/project-tables.ts', 'src/lib/registry/field-registry.ts', 'src/lib/types/state-card.ts',
      'tests/helpers/narrative-ir-fixture.ts', 'tests/helpers/narrative-world-evaluation.ts',
      'tests/regression/R-NW-1A-ir-codec.test.ts', 'tests/acceptance/narrative-world/ir-codec-golden-v1.json',
      'tests/acceptance/narrative-world/corpus-v1.json']
    const receipt = { schema: 'storyforge.narrative-ir-contract-evaluation', version: 1, workPackage: 'NW-1A', datasetVersion: 1,
      evidenceLevel: 'deterministic-contract-and-isolated-database; not-semantic-extraction-or-provider-improvement',
      modelCalls: 0, productE2ERuns: 0, independentHumanReviews: 0,
      cases: corpusResults.sort((a, b) => a.family.localeCompare(b.family, 'en')),
      inputHashes: Object.fromEntries(paths.sort().map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')])) }
    if (process.env.NW_IR_REPORT) fs.writeFileSync(process.env.NW_IR_REPORT, JSON.stringify(receipt, null, 2) + '\n')
    else expect(receipt).toEqual(JSON.parse(fs.readFileSync('tests/acceptance/narrative-world/ir-contract-20261027-workflow-continuation-v3.json', 'utf8')))
  })
})
