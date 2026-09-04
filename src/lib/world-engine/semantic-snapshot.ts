import { CURRENT_BACKUP_VERSION } from '../export/backup-trust'
import type { ProjectExportData } from '../export/json-export'
import { PROJECT_TABLES } from '../registry/project-tables'
import type { WorldReleaseManifestV3, WorldSemanticSnapshotV1 } from '../types'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function assertWorldSemanticSnapshotV1(value: unknown): asserts value is WorldSemanticSnapshotV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('世界语义快照必须是对象。')
  }
  const snapshot = value as Record<string, unknown>
  const expectedKeys = ['schema', 'version', 'ownership', 'project', 'worlds', 'works']
  const unknownKeys = Object.keys(snapshot).filter(key => !expectedKeys.includes(key))
  if (unknownKeys.length) throw new Error(`世界语义快照包含未知字段：${unknownKeys.join('、')}。`)
  if (snapshot.schema !== 'storyforge.world-semantic-snapshot' || snapshot.version !== 1) {
    throw new Error('只接受当前世界语义快照协议。')
  }
  if (!snapshot.project || typeof snapshot.project !== 'object' || Array.isArray(snapshot.project)) {
    throw new Error('世界语义快照缺少项目根。')
  }
  if (!Array.isArray(snapshot.worlds) || snapshot.worlds.length !== 1
    || !Array.isArray(snapshot.works) || snapshot.works.length !== 1) {
    throw new Error('世界语义快照必须且只能包含一个 World/Work 根。')
  }
  const ownership = snapshot.ownership
  if (!ownership || typeof ownership !== 'object' || Array.isArray(ownership)) {
    throw new Error('世界语义快照缺少所有权根。')
  }
  const owner = ownership as Record<string, unknown>
  if (owner.contractVersion !== 1
    || !Number.isInteger(owner.worldExportId)
    || !Number.isInteger(owner.workExportId)
    || (snapshot.worlds[0] as Record<string, unknown>)._exportId !== owner.worldExportId
    || (snapshot.works[0] as Record<string, unknown>)._exportId !== owner.workExportId) {
    throw new Error('世界语义快照所有权根无效。')
  }
}

/**
 * Materialize a frozen semantic release into the sole current full-backup
 * protocol. Empty product-private tables are intentional new-workspace state,
 * not compatibility defaults for an older backup.
 */
export function materializeWorldReleaseBackupV1(
  manifest: WorldReleaseManifestV3,
  projectPatch: Record<string, unknown> = {},
): ProjectExportData {
  assertWorldSemanticSnapshotV1(manifest.semanticSnapshot)
  const selected = new Set(manifest.selectedTables)
  if (Object.keys(manifest.records).length !== selected.size
    || Object.keys(manifest.records).some(table => !selected.has(table))) {
    throw new Error('世界发布 records 与 selectedTables 不闭合。')
  }

  const snapshot = manifest.semanticSnapshot
  const backup: Record<string, unknown> = {
    version: CURRENT_BACKUP_VERSION,
    exportedAt: Date.now(),
    ownership: clone(snapshot.ownership),
    project: { ...clone(snapshot.project), ...clone(projectPatch) },
  }
  for (const spec of PROJECT_TABLES) {
    if (!spec.exportable || spec.name === 'projects') continue
    backup[spec.name] = []
  }
  backup.worlds = clone(snapshot.worlds)
  backup.works = clone(snapshot.works)
  for (const table of manifest.selectedTables) {
    const spec = PROJECT_TABLES.find(candidate => candidate.name === table)
    if (!spec?.worldSemantic || !Array.isArray(manifest.records[table])) {
      throw new Error(`世界发布包含未登记或非法的语义资源：${table}。`)
    }
    backup[table] = clone(manifest.records[table])
  }
  return backup as unknown as ProjectExportData
}
