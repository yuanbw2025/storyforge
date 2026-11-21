import { describe, expect, it } from 'vitest'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import {
  parseCapturedWorkspaceBackupRootV1,
  parseWorkspaceBackupRootV1,
  selectCapturedWorkspaceBackupRootV1,
} from '../../src/lib/export/workspace-backup-root'
import {
  assertWorkspaceImportReviewJsonV1,
  parseWorkspaceImportReviewReceiptV1,
  parseWorkspaceImportReviewReceiptsV1,
  snapshotWorkspaceImportReviewJsonV1,
  workspaceImportParsedInputSha256V1,
} from '../../src/lib/export/workspace-import-review'
import type {
  PortableWorkspaceImportReviewReceiptV1,
  WorkspaceImportReviewReceiptBodyV1,
} from '../../src/lib/types/workspace-import-receipt'

// Root-slice fixtures only: these do not pretend to be complete registered backups.
interface RootCapture {
  version: number
  ownership?: unknown
  project: {
    workspaceUid: string
    workspacePurpose: string
    _activeWorldExportId?: number | null
    _activeWorkExportId?: number | null
  }
  worlds: { _exportId: number; identityKind: string; code: string }[]
  works: { _exportId: number; _worldExportId: number; code: string }[]
  [key: string]: unknown
}

const WORKSPACE = 'WS-00000000-0000-4000-8000-000000000001'
const WORK = 'WORK-00000000-0000-4000-8000-000000000002'
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

// The accessor is configurable, so the Proxy can lawfully expose a data descriptor.
// Reflection traps themselves are outside the no-subsequent-Get invariant.
function maskGetter<T extends object>(target: T, key: string, value: unknown, onRead: () => void): T {
  Object.defineProperty(target, key, {
    enumerable: true, configurable: true, get: () => { onRead(); return value },
  })
  return new Proxy(target, {
    getOwnPropertyDescriptor(object, property) {
      return property === key
        ? { value, enumerable: true, configurable: true, writable: true }
        : Reflect.getOwnPropertyDescriptor(object, property)
    },
  })
}

function countArrayLengthGets<T>(values: T[], onRead: () => void): T[] {
  return new Proxy(values, {
    get(target, key, receiver) {
      if (key === 'length') onRead()
      return Reflect.get(target, key, receiver)
    },
  })
}

function root1(version = 21): RootCapture {
  return {
    version,
    ownership: { contractVersion: 1, worldExportId: 0, workExportId: 0 },
    project: { workspaceUid: WORKSPACE, workspacePurpose: 'world-engine', _activeWorldExportId: 0, _activeWorkExportId: 0 },
    worlds: [{ _exportId: 0, identityKind: 'world-draft', code: 'W-00000-0001' }],
    works: [{ _exportId: 0, _worldExportId: 0, code: WORK }],
  }
}

function root2(): RootCapture {
  const input = root1()
  input.ownership = { contractVersion: 2, kind: 'world-only', worldExportId: 0, workExportId: null }
  input.project._activeWorkExportId = null
  // Another World's real Work remains in the complete root set, never the author scope.
  input.worlds.push({ _exportId: 1, identityKind: 'world-draft', code: 'W-00000-0002' })
  input.works[0]._worldExportId = 1
  return input
}

function issue(value: unknown = { oldId: 71, nested: [null, false, '原值'] }): Record<string, unknown> {
  return {
    table: 'outlineNodes', rowIndex: 0, rowKey: 71,
    resourceUid: 'res:v1:outline:historical-audit-only', path: 'revisionPairs[0].sourceChapterId',
    value, reason: '便携坐标无有效同域目标', sampleId: { source: 71 },
  }
}

async function receipt(options: {
  issues?: readonly unknown[]
  prior?: readonly string[]
  captured?: unknown
  recordedAt?: number
} = {}): Promise<PortableWorkspaceImportReviewReceiptV1> {
  const reportJson = canonicalStringify({ version: 1, issues: options.issues ?? [issue()] })
  const body: WorkspaceImportReviewReceiptBodyV1 = {
    version: 1, kind: 'backup-import-reference-review', sourceBackupVersion: 21, sourceRootContractVersion: 2,
    sourceParsedJsonSha256: await sha256Text(JSON.stringify(options.captured ?? root2())),
    reportHash: await sha256Text(reportJson), priorReceiptHashes: options.prior ?? [], recordedAt: options.recordedAt ?? 1,
  }
  return { ...body, reportJson, receiptHash: await hashCanonicalValue(body) }
}

describe('SFQA061 A0 closed backup root contract (pure, no production format activation)', () => {
  it.each([14, 15, 16, 17, 18, 19, 20, 21])('retains canonical Root1 in source v%i without normalizing input', version => {
    const input = root1(version)
    const original = JSON.stringify(input)
    expect(parseCapturedWorkspaceBackupRootV1(input)).toEqual(input.ownership)
    expect(JSON.stringify(input)).toBe(original)
  })

  it('preserves independent-work Root1 with its actual internal World identity', () => {
    const input = root1()
    input.project.workspacePurpose = 'independent-work'
    input.worlds[0] = { _exportId: 0, identityKind: 'workspace-scope', code: 'S-000000-000001' }
    expect(parseCapturedWorkspaceBackupRootV1(input).contractVersion).toBe(1)
  })

  it('does not relabel archived World-only receipts when current v21 active roots are Root1', async () => {
    const input = root1()
    const archived = await receipt()
    input.workspaceImportReceipts = [archived]
    const original = JSON.stringify(input)
    expect(parseCapturedWorkspaceBackupRootV1(input).contractVersion).toBe(1)
    expect(JSON.stringify(input)).toBe(original)
  })

  it('selects World-only Root2 while retaining valid other-World Works, and accepts truly empty Works', () => {
    const input = root2()
    const original = JSON.stringify(input)
    expect(parseCapturedWorkspaceBackupRootV1(input)).toEqual({ contractVersion: 2, kind: 'world-only', worldExportId: 0, workExportId: null })
    expect(JSON.stringify(input)).toBe(original)
    input.works = []
    expect(parseCapturedWorkspaceBackupRootV1(input).workExportId).toBeNull()
  })

  it('can select captured roots before wire creation, but wire parsing cannot repair a missing declaration', () => {
    const input = root2()
    delete input.ownership
    expect(selectCapturedWorkspaceBackupRootV1(input).contractVersion).toBe(2)
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('missing ownership')
  })

  it.each([null, undefined, {}, { contractVersion: 3, worldExportId: 0, workExportId: 0 },
    { contractVersion: 1, worldExportId: -1, workExportId: 0 },
    { contractVersion: 1, worldExportId: 0, workExportId: null },
    { contractVersion: 1, worldExportId: 0, workExportId: 0, kind: 'work' },
    { contractVersion: 2, kind: 'world-only', worldExportId: 0 },
    { contractVersion: 2, kind: 'world-only', worldExportId: 0, workExportId: undefined },
    { contractVersion: 2, kind: 'world-only', worldExportId: 0, workExportId: null, workId: 7 },
    { contractVersion: 2, kind: 'other', worldExportId: 0, workExportId: null },
    { contractVersion: 1, worldExportId: Number.MAX_SAFE_INTEGER + 1, workExportId: 0 },
  ])('rejects malformed/unknown root %#', value => {
    expect(() => parseWorkspaceBackupRootV1(value, 21)).toThrow()
  })

  it.each([13, 22, NaN, 20.5])('rejects unsupported source version %s', version => {
    expect(() => parseWorkspaceBackupRootV1(root1().ownership, version)).toThrow()
  })

  it.each([14, 15, 16, 17, 18, 19, 20])('rejects Root2 under original v%i before future normalization', version => {
    expect(() => parseWorkspaceBackupRootV1(root2().ownership, version)).toThrow()
    const input = root2()
    input.version = version
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow()
    expect(input.version).toBe(version)
  })

  it('rejects World-only when selected World has a real Work even though activeWork is explicitly null', () => {
    const input = root2()
    input.works[0]._worldExportId = 0
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('no Work in the selected World')
  })

  it('does not borrow another World Work, or silently treat missing/undefined activeWork as null', () => {
    const input = root2()
    input.project._activeWorkExportId = 0
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('active Work')
    delete input.project._activeWorkExportId
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('explicit')
    input.project._activeWorkExportId = undefined
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('non-JSON')
  })

  it('uses the detached descriptor snapshot for a masked root contract/version getter', () => {
    let getterReads = 0
    const declared = { contractVersion: 2, kind: 'world-only', worldExportId: 0, workExportId: null }
    const wire = maskGetter(declared, 'contractVersion', 2, () => { getterReads++ })
    expect(parseWorkspaceBackupRootV1(wire, 21)).toEqual({ contractVersion: 2, kind: 'world-only', worldExportId: 0, workExportId: null })
    const input = maskGetter(root2(), 'version', 21, () => { getterReads++ })
    expect(selectCapturedWorkspaceBackupRootV1(input).contractVersion).toBe(2)
    expect(parseCapturedWorkspaceBackupRootV1(input).contractVersion).toBe(2)
    expect(getterReads).toBe(0)
  })

  it.each(['_activeWorldExportId', '_activeWorkExportId'] as const)('never Gets a masked project active pointer %s', key => {
    let getterReads = 0
    const input = root2()
    input.project = maskGetter(input.project, key, key === '_activeWorldExportId' ? 0 : null, () => { getterReads++ })
    expect(selectCapturedWorkspaceBackupRootV1(input).contractVersion).toBe(2)
    expect(parseCapturedWorkspaceBackupRootV1(input).contractVersion).toBe(2)
    expect(getterReads).toBe(0)
  })

  it('rejects foreign/missing/null World and mismatching declared roots', () => {
    const input = root1()
    input.project._activeWorldExportId = 9
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('active World')
    input.project._activeWorldExportId = null
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('active World')
    delete input.project._activeWorldExportId
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('active World')
    const other = root2()
    other.ownership = { contractVersion: 1, worldExportId: 1, workExportId: 0 }
    expect(() => parseCapturedWorkspaceBackupRootV1(other)).toThrow('differs')
  })

  it('rejects World-only purpose/identity substitution', () => {
    const input = root2()
    input.project.workspacePurpose = 'independent-work'
    input.worlds[0] = { _exportId: 0, identityKind: 'workspace-scope', code: 'S-000000-000001' }
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('World-only')
    input.project.workspacePurpose = 'world-engine'
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('identity')
  })

  it('validates every other-World Work identity and parent instead of dropping it', () => {
    const input = root2()
    input.works[0]._worldExportId = 99
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('Work root identity/parent')
    input.works[0]._worldExportId = 1
    input.works[0].code = 'invented'
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('Work root identity/parent')
    input.works[0].code = WORK
    input.works.push({ ...input.works[0] })
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('duplicate Work')
  })

  it('rejects duplicate World IDs/codes and invalid stable workspace identity', () => {
    const input = root2()
    input.worlds[1]._exportId = 0
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('World root identity')
    input.worlds[1]._exportId = 1
    input.worlds[1].code = input.worlds[0].code
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('World root identity')
    const invalid = root1()
    invalid.project.workspaceUid = 'invented'
    expect(() => parseCapturedWorkspaceBackupRootV1(invalid)).toThrow('workspace root identity')
  })

  it.each([14, 15, 16, 17, 18, 19, 20])('rejects even an empty new receipt table in v%i', version => {
    const input = root1(version)
    input.workspaceImportReceipts = []
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('v21 receipt table')
  })

  it.each(['_worldOwnerExportId', '_worldExportId', 'worldId', 'worldAuthoring'])('rejects operative old-format run field %s, including null padding', key => {
    const input = root1(20)
    input.agentRuns = [{ [key]: null, contractJson: JSON.stringify({ scope: {} }) }]
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('operative World run owner')
  })

  it('rejects old-format current contract World-author scope without regex-scanning opaque history', () => {
    const input = root1(20)
    input.agentRuns = [{ contractJson: JSON.stringify({ scope: { worldAuthoring: { worldId: 7 } } }) }]
    expect(() => parseCapturedWorkspaceBackupRootV1(input)).toThrow('World authoring scope')
    const historical = '{"scope":{"worldAuthoring":{"worldId":7}},"_worldOwnerExportId":7}'
    input.agentRuns = [{ _workOwnerExportId: 0, contractJson: JSON.stringify({ scope: { projectId: 1, worldGroupId: null }, authorRequest: historical }) }]
    input.agentRunArtifacts = [{ content: historical }]
    input.agentRunEvents = [{ payloadJson: historical }]
    input.notes = [{ content: historical }]
    const before = JSON.stringify(input)
    expect(parseCapturedWorkspaceBackupRootV1(input).contractVersion).toBe(1)
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('SFQA061 A0 purpose-only immutable import review codec', () => {
  it('preserves all issue values and archived bytes, with no truncation or live-coordinate conversion', async () => {
    const issues = [issue({ worldId: 71, workId: 71, projectId: 71, arbitrary: ['原文', true, null] }), issue('长'.repeat(120_001))]
    const row = await receipt({ issues })
    const original = JSON.stringify(row)
    const parsed = await parseWorkspaceImportReviewReceiptV1(row)
    expect(JSON.parse(parsed.reportJson).issues).toEqual(issues)
    expect(JSON.stringify(parsed)).toBe(original)
    expect(parsed).not.toHaveProperty('projectId')
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.priorReceiptHashes)).toBe(true)
  })

  it('binds the parsed input digest to insertion-order JSON.stringify, not raw file or canonical JSON', async () => {
    const raw = '{ "z": 2, "a": { "y": 3, "x": 1 } }\n'
    const captured: unknown = JSON.parse(raw)
    const digest = await workspaceImportParsedInputSha256V1(captured)
    expect(digest).toBe(await sha256Text(JSON.stringify(captured)))
    expect(digest).not.toBe(await sha256Text(raw))
    expect(digest).not.toBe(await hashCanonicalValue(captured))
  })

  it('accepts a complete real hash lineage in any row order, including the captured archived receipts in the next digest', async () => {
    const first = await receipt()
    const captured = { ...root2(), workspaceImportReceipts: [first] }
    const second = await receipt({ captured, prior: [first.receiptHash], recordedAt: 2 })
    expect(second.sourceParsedJsonSha256).toBe(await workspaceImportParsedInputSha256V1(captured))
    const thirdCaptured = { ...root2(), workspaceImportReceipts: [first, second] }
    const third = await receipt({ captured: thirdCaptured, prior: [first.receiptHash, second.receiptHash].sort(), recordedAt: 3 })
    expect(third.sourceParsedJsonSha256).toBe(await workspaceImportParsedInputSha256V1(thirdCaptured))
    const before = JSON.stringify([third, first, second])
    const parsed = await parseWorkspaceImportReviewReceiptsV1([third, first, second])
    expect(JSON.stringify(parsed)).toBe(before)
    expect(await parseWorkspaceImportReviewReceiptsV1([])).toEqual([])
  })

  it('captures input before the first async hash so later caller edits cannot alter verified output', async () => {
    const row = await receipt()
    const input = { ...row, priorReceiptHashes: [...row.priorReceiptHashes] }
    const pending = parseWorkspaceImportReviewReceiptV1(input)
    input.reportJson = '{}'
    input.priorReceiptHashes.push(HASH_A)
    expect(await pending).toEqual(row)
  })

  it('parses/digests masked receipt data descriptors without invoking the real getter', async () => {
    const row = await receipt()
    const ordinary = { ...row }
    let getterReads = 0
    const wrapped = maskGetter(row, 'sourceParsedJsonSha256', row.sourceParsedJsonSha256, () => { getterReads++ })
    expect(await parseWorkspaceImportReviewReceiptV1(wrapped)).toEqual(ordinary)
    expect(await parseWorkspaceImportReviewReceiptsV1([wrapped])).toEqual([ordinary])
    expect(await workspaceImportParsedInputSha256V1(wrapped)).toBe(await sha256Text(JSON.stringify(ordinary)))
    expect(getterReads).toBe(0)
  })

  it('rejects report and receipt hash tampering independently', async () => {
    const row = await receipt()
    await expect(parseWorkspaceImportReviewReceiptV1({ ...row, reportJson: row.reportJson.replace('原值', '篡改') })).rejects.toThrow('report hash')
    await expect(parseWorkspaceImportReviewReceiptV1({ ...row, receiptHash: HASH_A })).rejects.toThrow('receipt hash')
    await expect(parseWorkspaceImportReviewReceiptV1({ ...row, recordedAt: 99 })).rejects.toThrow('receipt hash')
  })

  it('rejects noncanonical report bytes even when their SHA matches', async () => {
    const row = await receipt()
    const reportJson = JSON.stringify(JSON.parse(row.reportJson), null, 2)
    await expect(parseWorkspaceImportReviewReceiptV1({ ...row, reportJson, reportHash: await sha256Text(reportJson) })).rejects.toThrow('canonical byte-exact')
  })

  it.each(['id', 'projectId', 'worldId', 'workId', 'runId', 'payload', 'title'])('rejects receipt envelope injection: %s', async field => {
    const row = await receipt()
    await expect(parseWorkspaceImportReviewReceiptV1({ ...row, [field]: 71 })).rejects.toThrow('unknown or missing')
  })

  it.each([
    { version: 2 }, { kind: 'raw-response' }, { sourceBackupVersion: 20 }, { sourceBackupVersion: 22 },
    { sourceRootContractVersion: 1 }, { recordedAt: -1 }, { recordedAt: 0.5 }, { sourceParsedJsonSha256: 'raw-file-hash' },
  ])('rejects purpose/version/header forgery %#', async patch => {
    await expect(parseWorkspaceImportReviewReceiptV1({ ...await receipt(), ...patch })).rejects.toThrow()
  })

  it('requires nonempty exact historical issue/report schemas', async () => {
    await expect(parseWorkspaceImportReviewReceiptV1(await receipt({ issues: [] }))).rejects.toThrow('nonempty')
    await expect(parseWorkspaceImportReviewReceiptV1(await receipt({ issues: [{ ...issue(), ownerId: 1 }] }))).rejects.toThrow('unknown or missing')
    await expect(parseWorkspaceImportReviewReceiptV1(await receipt({ issues: [{ ...issue(), rowKey: -1 }] }))).rejects.toThrow('historical issue')
    const row = await receipt()
    const reportJson = canonicalStringify({ ...JSON.parse(row.reportJson), projectId: 71 })
    await expect(parseWorkspaceImportReviewReceiptV1({ ...row, reportJson })).rejects.toThrow('unknown or missing')
  })

  it('rejects missing receipt fields, malformed report JSON and nonfinite numbers decoded from report text', async () => {
    const row = await receipt()
    const missing: Record<string, unknown> = { ...row }
    delete missing.receiptHash
    await expect(parseWorkspaceImportReviewReceiptV1(missing)).rejects.toThrow('unknown or missing')
    await expect(parseWorkspaceImportReviewReceiptV1({ ...row, reportJson: '{' })).rejects.toThrow('invalid report JSON')
    const withNumber = await receipt({ issues: [issue(987654321)] })
    await expect(parseWorkspaceImportReviewReceiptV1({ ...withNumber, reportJson: withNumber.reportJson.replace('987654321', '1e400') })).rejects.toThrow('non-JSON value')
  })

  it('rejects identical duplicates and conflicting bodies without dropping either row', async () => {
    const row = await receipt()
    await expect(parseWorkspaceImportReviewReceiptsV1([row, row])).rejects.toThrow('duplicate receipt')
    await expect(parseWorkspaceImportReviewReceiptsV1([row, { ...row, recordedAt: 2 }])).rejects.toThrow('conflicting receipt')
  })

  it('rejects missing ancestors, unsorted/duplicate prior hashes and malformed hash syntax', async () => {
    const orphan = await receipt({ prior: [HASH_A] })
    await expect(parseWorkspaceImportReviewReceiptsV1([orphan])).rejects.toThrow('orphan')
    for (const prior of [[HASH_B, HASH_A], [HASH_A, HASH_A], ['invalid']]) {
      await expect(parseWorkspaceImportReviewReceiptsV1([await receipt({ prior })])).rejects.toThrow('sorted unique SHA256')
    }
  })

  it('rejects self/cyclic lineage structurally before hash verification (no fabricated valid hash fixed points)', async () => {
    const row = await receipt()
    await expect(parseWorkspaceImportReviewReceiptsV1([{ ...row, receiptHash: HASH_A, priorReceiptHashes: [HASH_A] }])).rejects.toThrow('self-referential')
    await expect(parseWorkspaceImportReviewReceiptsV1([
      { ...row, receiptHash: HASH_A, priorReceiptHashes: [HASH_B] },
      { ...row, receiptHash: HASH_B, priorReceiptHashes: [HASH_A] },
    ])).rejects.toThrow('cyclic receipt lineage')
  })
})

describe('SFQA061 A0 lossless JSON admission before canonicalization', () => {
  const invalid: [string, () => unknown][] = [
    ['undefined', () => ({ value: undefined })],
    ['nonfinite', () => ({ value: Infinity })],
    ['NaN', () => [NaN]],
    ['function', () => ({ value: () => 1 })],
    ['symbol value', () => ({ value: Symbol('value') })],
    ['symbol key', () => ({ [Symbol('key')]: 1 })],
    ['bigint', () => ({ value: 1n })],
    ['sparse', () => Array(2)],
    ['extended array', () => Object.assign([1], { extra: 2 })],
    ['nonenumerable', () => Object.defineProperty({}, 'value', { value: 1 })],
    ['prototype serializer', () => new Date(0)],
    ['cycle', () => { const value: Record<string, unknown> = {}; value.self = value; return value }],
  ]
  it.each(invalid)('hard-rejects %s instead of silently losing data', async (_label, make) => {
    const value = make()
    expect(() => assertWorkspaceImportReviewJsonV1(value)).toThrow()
    await expect(workspaceImportParsedInputSha256V1({ value })).rejects.toThrow()
    await expect(parseWorkspaceImportReviewReceiptV1(value)).rejects.toThrow()
  })

  it('rejects accessor input without executing the getter', async () => {
    let invoked = false
    const value = Object.defineProperty({}, 'value', { enumerable: true, get: () => { invoked = true; return 1 } })
    expect(() => assertWorkspaceImportReviewJsonV1(value)).toThrow('non-data JSON property')
    await expect(workspaceImportParsedInputSha256V1(value)).rejects.toThrow('non-data JSON property')
    expect(invoked).toBe(false)
  })

  it('reads original array length through its descriptor, including receipt/root and public digest paths', async () => {
    let lengthGets = 0
    const read = () => { lengthGets++ }
    const values = countArrayLengthGets([1, 2], read)
    expect(snapshotWorkspaceImportReviewJsonV1(values)).toEqual([1, 2])
    assertWorkspaceImportReviewJsonV1(values)
    expect(await workspaceImportParsedInputSha256V1({ values })).toBe(await sha256Text('{"values":[1,2]}'))
    const row = await receipt()
    const wrapped = { ...row, priorReceiptHashes: countArrayLengthGets<string>([], read) }
    expect(await parseWorkspaceImportReviewReceiptV1(wrapped)).toEqual(row)
    expect(await parseWorkspaceImportReviewReceiptsV1(countArrayLengthGets([wrapped], read))).toEqual([row])
    const input = root2()
    input.worlds = countArrayLengthGets(input.worlds, read)
    input.works = countArrayLengthGets(input.works, read)
    expect(parseCapturedWorkspaceBackupRootV1(input).contractVersion).toBe(2)
    expect(lengthGets).toBe(0)
  })

  it('preserves JSON numeric semantics: native parsed-input stringify represents finite -0 as 0', async () => {
    const input = JSON.parse('{"z":-0,"a":[-0]}') as { z: number; a: number[] }
    const snapshot = snapshotWorkspaceImportReviewJsonV1(input) as { z: number; a: number[] }
    expect(Object.is(snapshot.z, 0)).toBe(true)
    expect(Object.is(snapshot.a[0], 0)).toBe(true)
    expect(Object.is(input.z, -0)).toBe(true)
    expect(await workspaceImportParsedInputSha256V1(input)).toBe(await sha256Text('{"z":0,"a":[0]}'))
    expect(JSON.stringify(snapshot)).toBe(JSON.stringify(input))
    const row = await receipt({ recordedAt: -0, issues: [issue(-0)] })
    const parsed = await parseWorkspaceImportReviewReceiptV1(row)
    expect(Object.is(parsed.recordedAt, 0)).toBe(true)
    expect(JSON.parse(parsed.reportJson).issues[0].value).toBe(0)
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(row))
  })

  it('allows repeated shared JSON subvalues and null-prototype records without mistaking them for cycles', async () => {
    const shared = { original: [null, false, 0, ''] }
    const value = Object.assign(Object.create(null) as Record<string, unknown>, { first: shared, second: shared })
    expect(() => assertWorkspaceImportReviewJsonV1(value)).not.toThrow()
    expect(await workspaceImportParsedInputSha256V1(value)).toBe(await sha256Text(JSON.stringify(value)))
  })
})
