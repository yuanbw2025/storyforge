import Dexie from 'dexie'
import { db } from '../db/schema'
import { BACKUP_REFERENCE_REVIEW_TITLE, referenceReviewScopeMatchesV1 } from '../export/backup-trust'
import { readPortableOwnerShadowV1 } from '../export/portable-table-structure'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import type { WorkspaceScope } from '../types'
import type { Note } from '../types/note'
import type { NarrativeDomainAuthorityV1 } from '../types/narrative-domain'
import { readOwnedRows, stampNewRecord } from '../workspace/scope'
import type { WorldReleaseInputV4 } from './narrative-release-capture'
import { materializeWorldReleaseBackupV1 } from './semantic-snapshot'

type RecordRow = Record<string, unknown>
type ExportIds = ReadonlyMap<string, ReadonlyMap<number, number>>
type Reference = { field: string; remapVia: string; exportAs: string; reviewLocal?: string }
type Locator = { table: string; rowIndex: number; field: string; target: string; original: unknown; requiresReview: boolean }
type Binding = Locator & ({ kind: 'scalar'; portable: number | null }
  | { kind: 'array'; portable: number[]; storage: 'array' | 'json-string' })

export const DERIVATION_CONFIRMATION_REVIEW_TITLE = '派生世界：待复核语义确认'

function parseArray(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) as unknown } catch { return undefined }
}

function sameIndexes(actual: readonly unknown[], expected: readonly unknown[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

/** Translate only the disposable backup copy. V4 records keep their original
 * values, which are not portable chapter indexes. */
export function prepareNarrativeDerivationBackupV4(
  transfer: Pick<WorldReleaseInputV4, 'selectedTables' | 'records' | 'semanticSnapshot'>, sourceIds: ExportIds,
) {
  const backup = materializeWorldReleaseBackupV1(transfer)
  const rows = backup as unknown as Record<string, RecordRow[]>
  const bindings: Binding[] = []
  for (const table of transfer.selectedTables) {
    const spec = REGISTRY_BY_NAME.get(table)!
    rows[table].forEach((row, rowIndex) => {
      const resolve = (ref: Reference, value: unknown): number | undefined => {
        if (typeof value !== 'number') return undefined
        const index = sourceIds.get(ref.remapVia)?.get(value)
        const targetSpec = REGISTRY_BY_NAME.get(ref.remapVia)
        const target = index === undefined ? undefined : rows[ref.remapVia]?.[index]
        if (!target || !targetSpec?.resourceIdentity || !target[targetSpec.resourceIdentity.field]) return undefined
        const holder = readPortableOwnerShadowV1(spec, row)
        const owner = readPortableOwnerShadowV1(targetSpec, target)
        // The v4 capture has exactly one neutral World/Work root, both indexed at zero.
        return referenceReviewScopeMatchesV1(ref.reviewLocal, holder, owner,
          candidate => candidate.kind !== 'instance' && candidate.exportId === 0 ? 0 : null) ? index : undefined
      }
      for (const ref of spec.exportRemap ?? []) {
        if (!ref.reviewLocal) continue
        const original = row[ref.field]
        const applies = !ref.when || row[ref.when.field] === ref.when.equals
        const portable = applies ? resolve(ref, original) ?? null : null
        if (portable !== null) {
          row[ref.exportAs] = portable
          delete row[ref.field]
        }
        bindings.push({ table, rowIndex, field: ref.field, target: ref.remapVia, original, portable,
          kind: 'scalar', requiresReview: original != null && portable === null })
      }
      for (const ref of spec.exportRefRemap ?? []) {
        if (ref.kind !== 'id-array' || !ref.reviewLocal) continue
        const original = row[ref.field], parsed = parseArray(original)
        if (original == null || (Array.isArray(parsed) && parsed.length === 0)) continue
        const portable = Array.isArray(parsed)
          ? parsed.map(value => resolve(ref, value)).filter((index): index is number => index !== undefined)
          : []
        const requiresReview = !Array.isArray(parsed) || parsed.length !== portable.length
        row[ref.exportAs] = portable
        if (!requiresReview) delete row[ref.field]
        bindings.push({ table, rowIndex, field: ref.field, target: ref.remapVia, original, portable,
          kind: 'array', storage: ref.storage ?? 'array', requiresReview })
      }
    })
  }
  return { backup, bindings }
}

/** Prove restored links against the fresh target capture. Restore a business
 * field's original absence on the verified new row inside the import transaction.
 * Other normalization affects only the detached comparison. Approvals are unchanged. */
export async function reconcileNarrativeDerivationBackupV4(input: {
  scope: WorkspaceScope; current: WorldReleaseInputV4; targetIds: ExportIds; bindings: readonly Binding[]
  frozenContentHash: string; frozenConfirmations: ReadonlySet<string>
}) {
  const { scope, current, targetIds, bindings } = input
  const notes: string[] = []
  const localIds = new Map<string, Map<number, number>>()
  const fail = () => { throw Error('[derivation] 导入后的章节或子世界关联与已验证来源不一致') }
  const portableIndex = (table: string, id: unknown) =>
    typeof id === 'number' ? targetIds.get(table)?.get(id) : undefined
  for (const binding of bindings) {
    const { table, rowIndex, field, target, original } = binding
    const row = current.records[table]?.[rowIndex]
    if (!row) throw Error('[derivation] 导入后的关联来源缺失')
    const actual = row[field]
    if (binding.kind === 'scalar') {
      if (binding.portable === null ? actual !== null : portableIndex(target, actual) !== binding.portable) fail()
    } else {
      const actualIds = parseArray(actual)
      if ((binding.storage === 'json-string' ? typeof actual !== 'string' : !Array.isArray(actual))
        || !Array.isArray(actualIds) || !sameIndexes(actualIds.map(id => portableIndex(target, id)), binding.portable)) fail()
    }
    const spec = REGISTRY_BY_NAME.get(table)!
    if (actual !== original && spec.worldSemantic?.projector?.sourceFields.includes(field)) {
      if (original === undefined) {
        // Import added a null default, but the v4 business hash distinguishes
        // absence. Remove only that default from the verified new draft row.
        let ids = localIds.get(table)
        if (!ids) {
          ids = new Map([...(targetIds.get(table) ?? [])].map(([id, index]) => [index, id]))
          localIds.set(table, ids)
        }
        const id = ids.get(rowIndex)
        if (id === undefined || await spec.table.update(id, { [field]: undefined }) !== 1) fail()
      } else {
        const confirmation = row._narrativeAuthorityV1Portable as NarrativeDomainAuthorityV1 | undefined
        const identity = spec.resourceIdentity!
        const sourceUid = row[identity.field]
        if (confirmation && input.frozenConfirmations.has(JSON.stringify([`${identity.contextKind}:${sourceUid}`, confirmation.confirmationUid]))) {
          const targetIdentity = REGISTRY_BY_NAME.get(target)?.resourceIdentity
          const targetUid = binding.kind === 'scalar' && binding.portable !== null && targetIdentity
            ? current.records[target][binding.portable]?.[targetIdentity.field] : null
          notes.push(JSON.stringify({ 来源表: table, 资源UID: sourceUid, 字段: field,
            封存原值: original, 草稿当前值: actual, 目标UID: targetUid,
            封存确认: confirmation.confirmationUid, 原确认摘要: confirmation.contentHash }))
        }
      }
    }
    if (original === undefined) delete row[field]
    else row[field] = original
  }
  const unresolved = bindings.filter(binding => binding.requiresReview)
  if (unresolved.length > 0) {
    const existing = await Dexie.Promise.resolve(readOwnedRows<Note>(scope, 'notes', { owner: 'work' }))
    const note = existing.find(item => item.pinned && item.content.startsWith(BACKUP_REFERENCE_REVIEW_TITLE + '\n'))
    const originals = new Set(note?.content.split('\n').filter(line => line.startsWith('{')).map(line => {
      const entry = JSON.parse(line) as RecordRow
      return JSON.stringify([entry.来源表, entry.原行序号, entry.字段, entry.原值])
    }))
    if (unresolved.some(binding => !originals.has(JSON.stringify([binding.table, binding.rowIndex, binding.field, binding.original])))) fail()
  }
  if (notes.length) {
    const now = Date.now()
    await db.notes.add(stampNewRecord(scope, 'notes', {
      projectId: scope.projectId, pinned: true, color: 'yellow' as const, createdAt: now, updatedAt: now,
      content: [DERIVATION_CONFIRMATION_REVIEW_TITLE, `原封存 SHA-256：${input.frozenContentHash}`,
        '封存确认保留原文。下列字段在目标草稿中的关联已变化，请核对后重新确认。', ...notes].join('\n'),
    }, { owner: 'work' }))
  }
}
