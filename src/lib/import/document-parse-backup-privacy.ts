import type { ImportSession } from '../types'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { documentImportChunkBindingProjectionV1, hashDocumentImportChunkBindingV1 } from './document-parse-binding'

const privateEntries = new Set(['reference.analysis.private-chunk', 'import.reference-chunk.parse.private'])
const legacyEntry = 'import.document-chunk.parse'
type Row = Record<string, any>

function positive(id: unknown): boolean {
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
}

function invalid(id: number, explanation: string): never {
  throw new Error('[portable-ledger] 导入运行 #' + id + ' ' + explanation + '，无法安全备份或还原。')
}

export async function assertPortableDocumentImportOriginV1(row: Row, contract: Row): Promise<void> {
  const json = row.portableDocumentImportOriginJson
  if (json === undefined) return
  const entries = contract.executionBindings
  if (typeof json !== 'string' || json.length > 4096 || !Array.isArray(entries) || entries.length !== 1 ||
    entries[0]?.formalEntry?.entryId !== legacyEntry) invalid(row.id, '的历史项目导入凭据与正式入口不符')
  let evidence
  try { evidence = JSON.parse(json) } catch { invalid(row.id, '的历史项目导入凭据不是有效 JSON') }
  const binding = evidence?.binding
  if (evidence?.version !== 1 || Object.keys(evidence).length !== 2 || binding?.importTarget !== 'project' ||
    Object.keys(binding).length !== 8 || Object.keys(binding.owner ?? {}).length !== 3 ||
    !positive(binding.owner?.projectId) || !positive(binding.owner?.worldId) || !positive(binding.owner?.workId) ||
    !positive(binding.sessionId) || !Number.isSafeInteger(binding.chunkIndex) || binding.chunkIndex < 0 ||
    (binding.worldGroupId !== null && !positive(binding.worldGroupId)) ||
    typeof binding.fileHash !== 'string' || !binding.fileHash || binding.fileHash.length > 256 ||
    typeof binding.claimKey !== 'string' || !binding.claimKey || binding.claimKey.length > 128 ||
    !/^[a-f0-9]{64}$/.test(binding.sourceTextHash) || await hashCanonicalValue(binding) !== contract.runtimeBindingHash) {
    invalid(row.id, '的历史项目导入凭据与原请求摘要不一致')
  }
}

async function verifyFrozenImportEntry(row: Row, contract: Row): Promise<void> {
  const step = contract.executionBindings[0]
  const entry = step.formalEntry
  if (entry.version !== 1 || typeof entry.bindingJson !== 'string') invalid(row.id, '的正式入口缺少冻结正文')
  const frozen = JSON.parse(entry.bindingJson)
  if (frozen?.entryId !== entry.entryId || frozen?.skillId !== step.skillId ||
    await hashCanonicalValue(frozen) !== entry.bindingHash || await hashCanonicalValue(contract) !== row.contractHash) {
    invalid(row.id, '的正式入口或原冻结合同校验不符')
  }
}

/** Classify only records in the detached backup snapshot. Physical coordinates in an ordinary
 * import proof are immutable preimage values. They never locate a row in the restored database. */
export async function identifyPrivateReferenceRunsV1(
  runs: Row[], contractField: string, readImportSessions: () => Promise<ImportSession[]>,
): Promise<Set<number>> {
  const privateIds = new Set<number>()
  const historical = new Map<number, { row: Row; contract: Row }>()
  for (const row of runs) {
    if (typeof row[contractField] !== 'string') continue
    const contract = JSON.parse(row[contractField])
    if (row.portableDocumentImportOriginJson !== undefined) await assertPortableDocumentImportOriginV1(row, contract)
    if (!Array.isArray(contract?.executionBindings)) continue
    const entries: (string | undefined)[] = contract.executionBindings.map((item: Row) => item?.formalEntry?.entryId)
    const privateEntry = entries.some(id => id != null && privateEntries.has(id))
    if (!privateEntry && !entries.includes(legacyEntry)) continue
    if (entries.length !== 1) invalid(row.id, '绑定多个导入或分析步骤')
    await verifyFrozenImportEntry(row, contract)
    if (privateEntry) privateIds.add(row.id)
    else historical.set(row.id, { row, contract })
  }
  if (!historical.size) return privateIds
  const origins = new Map<number, { session: ImportSession; index: number }>()
  for (const session of await readImportSessions()) {
    if (!Array.isArray(session.chunks)) continue
    for (const [index, chunk] of session.chunks.entries()) {
      const id = chunk?.durableParse?.runId
      if (id == null || !historical.has(id)) continue
      if (origins.has(id)) invalid(id, '在多个原会话或分块中出现')
      origins.set(id, { session, index })
    }
  }
  for (const [id, { row, contract }] of historical) {
    const origin = origins.get(id)
    if (!origin) {
      if (row.portableDocumentImportOriginJson !== undefined) continue
      invalid(id, '缺少可核实的原会话和普通项目导入凭据')
    }
    const { session, index } = origin
    const chunk = session.chunks[index]
    const owner = session.targetScope
    const key = chunk.durableParse?.claimKey
    if (!positive(session.id) || !owner || Object.keys(owner).length !== 3 || !positive(owner.worldId) ||
      owner.projectId !== row.projectId || session.projectId !== row.projectId || !session.fileHash || session.fileHash.length > 256 ||
      owner.workId !== row.workId || (session.targetWorldGroupId ?? null) !== (row.worldGroupId ?? null) ||
      !['reference', 'project'].includes(session.importTarget) || chunk.index !== index || !key || key.length > 128 ||
      !chunk.sourceTextHash || !/^[a-f0-9]{64}$/.test(chunk.sourceTextHash)) invalid(id, '的作品、导入目标或原分块不匹配')
    const bound = { ...session, targetScope: owner }
    if (await hashDocumentImportChunkBindingV1(bound, index, key) !== contract.runtimeBindingHash) {
      invalid(id, '的原会话与冻结请求摘要不符')
    }
    if (session.importTarget === 'reference') {
      privateIds.add(id)
    } else {
      const binding = documentImportChunkBindingProjectionV1(bound, index, key)
      row.portableDocumentImportOriginJson = canonicalStringify({ version: 1, binding })
    }
  }
  return privateIds
}
