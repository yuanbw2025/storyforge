import type { TtrpgRuntimeAssetRequestRecordV1 } from '../types/ttrpg-product'

type Attempt = {
  ordinal: number
  afterSequence: number
  settledSequence: number | null
  dispatchKey: string
  reservationUsd: number
  costUsd: number | null
  receiptHash: string | null
  candidate: { assetKey: string; version: number; contentHash: string } | null
}
type InheritedCost = { costUsd: number | null; holdUsd: number; hasUnknown: boolean }
type Accounting = { version: 1; inherited: InheritedCost | null; attempts: Attempt[] }
type AccountingRow = Pick<TtrpgRuntimeAssetRequestRecordV1, 'attemptAccountingJson' | 'attemptCount'
  | 'maximumAttempts' | 'actualCostUsd' | 'costReservationUsd' | 'status'>

const HASH = /^[a-f0-9]{64}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
const ASSET_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
export const EMPTY_RUNTIME_MEDIA_ACCOUNTING = '{"version":1,"inherited":null,"attempts":[]}'

function invalid(): never { throw new Error('[ttrpg-runtime-media] 媒资尝试账目无效') }
function fields(value: unknown, names: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).length !== names.length || !names.every(name => Object.prototype.hasOwnProperty.call(value, name))) invalid()
  return value as Record<string, unknown>
}
function positiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= max
}
export function isRuntimeMediaCost(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function measuredRuntimeMediaCost(accounting: Accounting): number | null {
  const measured = accounting.attempts.flatMap(attempt => attempt.costUsd === null ? [] : [attempt.costUsd])
  if (accounting.inherited?.costUsd != null) measured.push(accounting.inherited.costUsd)
  const total = measured.reduce((sum, cost) => sum + cost, 0)
  if (!isRuntimeMediaCost(total)) invalid()
  return measured.length ? total : null
}

export function readRuntimeMediaAccounting(row: AccountingRow): Accounting | null {
  if (row.attemptAccountingJson == null) return null // Legacy absence cannot prove a request was never sent.
  if (typeof row.attemptAccountingJson !== 'string' || row.attemptAccountingJson.length > 12_000) invalid()
  const root = fields(JSON.parse(row.attemptAccountingJson), ['version', 'inherited', 'attempts'])
  if (root.version !== 1 || !Array.isArray(root.attempts) || root.attempts.length > 10
    || !positiveInteger(row.maximumAttempts, 10) || !Number.isInteger(row.attemptCount)
    || row.attemptCount < 0 || row.attemptCount > row.maximumAttempts || !isRuntimeMediaCost(row.costReservationUsd)) invalid()
  if (root.inherited !== null) {
    const prior = fields(root.inherited, ['costUsd', 'holdUsd', 'hasUnknown'])
    if ((prior.costUsd !== null && !isRuntimeMediaCost(prior.costUsd)) || !isRuntimeMediaCost(prior.holdUsd) ||
      typeof prior.hasUnknown !== 'boolean' || (!prior.hasUnknown && prior.holdUsd !== 0) || root.attempts.length) invalid()
  }
  const keys = new Set<string>()
  let prior = 0
  for (const value of root.attempts) {
    const attempt = fields(value, ['ordinal', 'afterSequence', 'settledSequence', 'dispatchKey', 'reservationUsd', 'costUsd', 'receiptHash', 'candidate'])
    if (!positiveInteger(attempt.ordinal, row.attemptCount) || attempt.ordinal <= prior ||
      !positiveInteger(attempt.afterSequence) ||
      (attempt.settledSequence !== null && (!positiveInteger(attempt.settledSequence) ||
        attempt.settledSequence <= attempt.afterSequence || attempt.costUsd === null)) ||
      typeof attempt.dispatchKey !== 'string' || !UUID.test(attempt.dispatchKey) || keys.has(attempt.dispatchKey) ||
      attempt.reservationUsd !== row.costReservationUsd || (attempt.costUsd !== null && !isRuntimeMediaCost(attempt.costUsd)) ||
      (attempt.receiptHash !== null && (typeof attempt.receiptHash !== 'string' || !HASH.test(attempt.receiptHash))) ||
      (attempt.receiptHash === null && (attempt.costUsd !== null || attempt.candidate !== null))) invalid()
    if (attempt.candidate !== null) {
      const ref = fields(attempt.candidate, ['assetKey', 'version', 'contentHash'])
      if (typeof ref.assetKey !== 'string' || !ASSET_KEY.test(ref.assetKey) || !positiveInteger(ref.version) ||
        typeof ref.contentHash !== 'string' || !HASH.test(ref.contentHash)) invalid()
    }
    keys.add(attempt.dispatchKey)
    prior = attempt.ordinal
  }
  const accounting = root as Accounting
  if (measuredRuntimeMediaCost(accounting) !== row.actualCostUsd) invalid()
  return accounting
}

export function assertPortableRuntimeMediaAccounting(row: Record<string, unknown>): void {
  if (row.attemptAccountingJson !== undefined && row.attemptAccountingJson !== null) {
    readRuntimeMediaAccounting(row as unknown as AccountingRow)
  }
}

export function hasUnresolvedRuntimeMediaAttempt(row: AccountingRow): boolean {
  const accounting = readRuntimeMediaAccounting(row)
  return !accounting || accounting.inherited?.hasUnknown === true || accounting.attempts.some(attempt => attempt.costUsd === null)
}

/** Include each actual charge, unknown dispatch and current queue admission once. */
export function committedRuntimeMediaCost(row: AccountingRow): number {
  const accounting = readRuntimeMediaAccounting(row)
  const active = row.status === 'queued' || row.status === 'generating'
  if (!accounting) {
    // Legacy scalar is the only measured evidence; older retries could have overwritten it.
    const possible = Math.max(row.attemptCount || 0, 1)
    const unknown = Math.max(0, possible - (row.actualCostUsd != null && row.attemptCount > 0 ? 1 : 0))
    return (row.actualCostUsd ?? 0) + unknown * row.costReservationUsd
  }
  if (accounting.inherited) return (accounting.inherited.costUsd ?? 0) + accounting.inherited.holdUsd
  const pending = active && (row.status === 'queued' ||
    !accounting.attempts.some(attempt => attempt.ordinal === row.attemptCount))
  return accounting.attempts.reduce((sum, attempt) => sum + (attempt.costUsd ?? attempt.reservationUsd),
    pending ? row.costReservationUsd : 0)
}

export function canRetryRuntimeMedia(row: AccountingRow, committedUsd: number, maximumUsd: number): boolean {
  return row.status === 'failed' && row.attemptCount < row.maximumAttempts &&
    hasRuntimeMediaDispatchAuthority(row) && committedUsd + row.costReservationUsd <= maximumUsd
}

export function hasRuntimeMediaDispatchAuthority(row: AccountingRow): boolean {
  const accounting = readRuntimeMediaAccounting(row)
  return accounting != null && accounting.inherited === null &&
    accounting.attempts.every(attempt => attempt.costUsd !== null)
}

export function inheritRuntimeMediaCostAtCut(
  row: AccountingRow & Pick<TtrpgRuntimeAssetRequestRecordV1, 'terminalEventSequence'>,
  throughSequence: number,
  cut: { atHead: boolean; possibleAttempts: number; measuredAtCut: boolean },
): { attemptAccountingJson: string; actualCostUsd: number | null } {
  const source = readRuntimeMediaAccounting(row)
  let inherited = source?.inherited
  if (!inherited) {
    const measured: number[] = []
    let holdUsd = 0
    let hasUnknown = false
    if (source) {
      for (const attempt of source.attempts.filter(item => item.afterSequence <= throughSequence)) {
        // A current native snapshot can see a measured late receipt even
        // after cancellation. Older cuts need a terminal event in their prefix.
        if (attempt.costUsd !== null &&
          (cut.atHead || (attempt.settledSequence !== null && attempt.settledSequence <= throughSequence))) {
          measured.push(attempt.costUsd)
        } else {
          hasUnknown = true
          holdUsd += attempt.reservationUsd
        }
      }
    } else {
      if (cut.measuredAtCut && row.actualCostUsd != null) measured.push(row.actualCostUsd)
      // Legacy retries could overwrite earlier measured charges. Only the last
      // scalar belongs to the cut when its terminal evidence is part of it.
      const possibleUnknown = Math.max(0, cut.possibleAttempts - (measured.length ? 1 : 0))
      hasUnknown = possibleUnknown > 0
      holdUsd = possibleUnknown * row.costReservationUsd
    }
    inherited = { costUsd: measured.length ? measured.reduce((sum, cost) => sum + cost, 0) : null, holdUsd, hasUnknown }
  }
  return { attemptAccountingJson: JSON.stringify({ version: 1, inherited, attempts: [] }), actualCostUsd: inherited.costUsd }
}
