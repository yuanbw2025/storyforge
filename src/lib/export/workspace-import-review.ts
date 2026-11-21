import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import type {
  PortableWorkspaceImportReviewReceiptV1,
  WorkspaceImportReviewJsonV1,
  WorkspaceImportReviewReceiptBodyV1,
  WorkspaceImportReviewReportV1,
} from '../types/workspace-import-receipt'

// Pure, unconnected v21 contract. No DB insertion, report creation or format emission.
const HASH = /^[a-f0-9]{64}$/
const BODY_KEYS = [
  'version', 'kind', 'sourceBackupVersion', 'sourceRootContractVersion',
  'sourceParsedJsonSha256', 'reportHash', 'priorReceiptHashes', 'recordedAt',
] as const

function fail(message: string): never {
  throw new Error(`[workspace-import-review] ${message}`)
}

/**
 * Copy JSON semantics from own data descriptors, retaining native key order.
 * Reflection traps on a Proxy may themselves run code; this is not a sandbox.
 * Consumers use only this detached result, never subsequent Gets on the input.
 * Finite -0 follows native JSON semantics (0), not JS representation identity.
 */
export function snapshotWorkspaceImportReviewJsonV1(value: unknown): WorkspaceImportReviewJsonV1 {
  const ancestors = new Set<object>()
  const visit = (item: unknown): WorkspaceImportReviewJsonV1 => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item
    if (typeof item === 'number' && Number.isFinite(item)) return item === 0 ? 0 : item
    if (typeof item !== 'object' || item === null) fail('non-JSON value')
    if (ancestors.has(item)) fail('cyclic JSON value')
    const array = Array.isArray(item)
    const proto: unknown = Object.getPrototypeOf(item)
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) fail('non-JSON prototype')
    ancestors.add(item)
    const keys = Reflect.ownKeys(item)
    let length = 0
    if (array) {
      const descriptor = Object.getOwnPropertyDescriptor(item, 'length')
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        || typeof descriptor.value !== 'number' || !Number.isInteger(descriptor.value)
        || descriptor.value < 0 || descriptor.value > 0xffffffff) fail('invalid JSON array length descriptor')
      length = descriptor.value
      if (keys.length !== length + 1) fail('sparse or extended JSON array')
    }
    const snapshot: Record<string, WorkspaceImportReviewJsonV1> | WorkspaceImportReviewJsonV1[] = array
      ? [] : Object.create(null) as Record<string, WorkspaceImportReviewJsonV1>
    for (const key of keys) {
      if (typeof key !== 'string') fail('symbol JSON key')
      if (array && key === 'length') continue
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) fail('extended JSON array')
      const descriptor = Object.getOwnPropertyDescriptor(item, key)
      if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('non-data JSON property')
      Object.defineProperty(snapshot, key, {
        value: visit(descriptor.value), enumerable: true, configurable: true, writable: true,
      })
    }
    ancestors.delete(item)
    return snapshot
  }
  return visit(value)
}

/** Validation of the descriptor view only; unknown-object consumers must use the detached snapshot. */
export function assertWorkspaceImportReviewJsonV1(value: unknown): asserts value is WorkspaceImportReviewJsonV1 {
  snapshotWorkspaceImportReviewJsonV1(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some(key => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail('unknown or missing field')
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeJson)
    Object.freeze(value)
  }
  return value
}

function reportFromJson(text: unknown): WorkspaceImportReviewReportV1 {
  if (typeof text !== 'string') fail('reportJson must be a string')
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { fail('invalid report JSON') }
  const captured = snapshotWorkspaceImportReviewJsonV1(parsed)
  const report = record(captured, 'report')
  exact(report, ['version', 'issues'])
  if (report.version !== 1 || !Array.isArray(report.issues) || !report.issues.length) fail('report requires nonempty v1 issues')
  for (const value of report.issues) {
    const issue = record(value, 'issue')
    exact(issue, ['table', 'rowIndex', 'rowKey', 'path', 'value', 'reason'], ['resourceUid', 'sampleId'])
    if (!nonnegative(issue.rowIndex) || !nonnegative(issue.rowKey)
      || ['table', 'path', 'reason'].some(key => { const field = issue[key]; return typeof field !== 'string' || !field.length })
      || ('resourceUid' in issue && typeof issue.resourceUid !== 'string')) fail('invalid historical issue')
  }
  if (canonicalStringify(report) !== text) fail('reportJson is not canonical byte-exact JSON')
  return captured as unknown as WorkspaceImportReviewReportV1
}

function readEnvelope(value: unknown): PortableWorkspaceImportReviewReceiptV1 {
  const row = record(value, 'receipt')
  exact(row, [...BODY_KEYS, 'reportJson', 'receiptHash'])
  if (row.version !== 1 || row.kind !== 'backup-import-reference-review'
    || row.sourceBackupVersion !== 21 || row.sourceRootContractVersion !== 2
    || !nonnegative(row.recordedAt)) fail('invalid purpose, version or recordedAt')
  for (const key of ['sourceParsedJsonSha256', 'reportHash', 'receiptHash']) {
    const value = row[key]
    if (typeof value !== 'string' || !HASH.test(value)) fail(`invalid ${key}`)
  }
  if (!Array.isArray(row.priorReceiptHashes)) fail('priorReceiptHashes must be an array')
  let previous = ''
  for (const hash of row.priorReceiptHashes) {
    if (typeof hash !== 'string' || !HASH.test(hash) || hash <= previous) fail('prior hashes must be sorted unique SHA256')
    previous = hash
  }
  reportFromJson(row.reportJson)
  return row as unknown as PortableWorkspaceImportReviewReceiptV1
}

function receiptBody(row: PortableWorkspaceImportReviewReceiptV1): WorkspaceImportReviewReceiptBodyV1 {
  return {
    version: row.version,
    kind: row.kind,
    sourceBackupVersion: row.sourceBackupVersion,
    sourceRootContractVersion: row.sourceRootContractVersion,
    sourceParsedJsonSha256: row.sourceParsedJsonSha256,
    reportHash: row.reportHash,
    priorReceiptHashes: row.priorReceiptHashes,
    recordedAt: row.recordedAt,
  }
}

async function verifyHashes(row: PortableWorkspaceImportReviewReceiptV1): Promise<void> {
  if (await sha256Text(row.reportJson) !== row.reportHash) fail('report hash mismatch')
  if (await hashCanonicalValue(receiptBody(row)) !== row.receiptHash) fail('receipt hash mismatch')
}

/** Hash the captured parsed object in insertion order, NOT canonical JSON or raw file bytes. */
export async function workspaceImportParsedInputSha256V1(input: unknown): Promise<string> {
  const captured = snapshotWorkspaceImportReviewJsonV1(input)
  record(captured, 'captured parsed input')
  const text = JSON.stringify(captured)
  return sha256Text(text)
}

/** Envelope/hash check only. Full-backup callers must also verify the complete lineage set. */
export async function parseWorkspaceImportReviewReceiptV1(input: unknown): Promise<PortableWorkspaceImportReviewReceiptV1> {
  const row = readEnvelope(snapshotWorkspaceImportReviewJsonV1(input))
  await verifyHashes(row)
  return freezeJson(row)
}

/**
 * Validate every archived receipt and its closed, acyclic evidence lineage; never drop rows.
 * A digest alone cannot prove that priors belonged to its historical source input.
 * The actual importer must derive that membership from its captured input, not this codec.
 */
export async function parseWorkspaceImportReviewReceiptsV1(input: unknown): Promise<readonly PortableWorkspaceImportReviewReceiptV1[]> {
  const captured = snapshotWorkspaceImportReviewJsonV1(input)
  if (!Array.isArray(captured)) fail('receipts must be an array')
  const rows = captured.map(readEnvelope)
  const byHash = new Map<string, PortableWorkspaceImportReviewReceiptV1>()
  for (const row of rows) {
    const previous = byHash.get(row.receiptHash)
    if (previous) fail(canonicalStringify(previous) === canonicalStringify(row) ? 'duplicate receipt' : 'conflicting receipt')
    byHash.set(row.receiptHash, row)
  }
  // Topological traversal avoids recursive stack growth on long valid import histories.
  const pending = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const row of rows) {
    pending.set(row.receiptHash, row.priorReceiptHashes.length)
    for (const parent of row.priorReceiptHashes) {
      if (parent === row.receiptHash) fail('self-referential receipt')
      if (!byHash.has(parent)) fail('orphan receipt lineage')
      const list = children.get(parent) ?? []
      list.push(row.receiptHash)
      children.set(parent, list)
    }
  }
  const queue = rows.filter(row => !row.priorReceiptHashes.length).map(row => row.receiptHash)
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) ?? []) {
      const count = pending.get(child)! - 1
      pending.set(child, count)
      if (!count) queue.push(child)
    }
  }
  if (queue.length !== rows.length) fail('cyclic receipt lineage')
  for (const row of rows) await verifyHashes(row)
  return freezeJson(rows)
}
