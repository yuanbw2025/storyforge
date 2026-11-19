/** Registered owner tables and read/retention transaction closure share one metadata source. */
import { PROJECT_TABLES } from '../registry/project-tables'
import type { MemoryArtifactRefV1 } from '../types'
import { extractExactArtifactOwnerRootsV1 } from './artifact-roots'

function owners() {
  return PROJECT_TABLES.filter(spec => spec.exactArtifactRoots?.length)
}
export function exactArtifactOwnerTablesV1() { return owners().map(spec => spec.table) }

/** Call inside the existing exact-owner/delete transaction, before any Run or
 * event is removed. Owners opt in; other products retain their prior policy. */
export async function assertRegisteredSourceRunsUnreferencedV1(runIds: readonly number[]): Promise<void> {
  for (const spec of PROJECT_TABLES.filter(row => row.sourceRunRetention)) {
    const fields = [spec.sourceRunRetention!.field, ...(spec.sourceRunRetention!.additionalFields ?? [])]
    if (!spec.exactArtifactRoots?.length || new Set(fields).size !== fields.length || fields.some(field =>
      !/^[A-Za-z_$][\w$]*$/.test(field) || !spec.table.schema.indexes.some(index => index.name === field)
      || !spec.exportRemap?.some(ref => ref.field === field && ref.remapVia === 'agentRuns'))) {
      throw new Error('来源运行保留字段必须登记逐字证据拥有者与外键索引。')
    }
    for (const field of fields) if (await spec.table.where(field).anyOf([...runIds]).count()) {
      throw new Error('来源运行仍被已保存的内容或采用历史引用；请先按所属作品生命周期处理。')
    }
  }
}

/** Caller enlists exactArtifactOwnerTablesV1 in the same transaction as artifact pruning. */
export async function readRegisteredExactArtifactOwnerRefsV1(projectId: number): Promise<MemoryArtifactRefV1[]> {
  const refs: MemoryArtifactRefV1[] = []
  for (const spec of owners()) {
    if (!spec.exportable || !spec.table.schema.indexes.some(index => index.name === 'projectId')) throw new Error('逐字证据拥有者必须是已登记可搬运的项目作用域表。')
    const rows = await spec.table.where('projectId').equals(projectId).toArray()
    for (const row of rows) for (const ref of extractExactArtifactOwnerRootsV1(row, spec.exactArtifactRoots!)) {
      refs.push({ ...ref, artifactId: 'exact:' + ref.artifactKind + ':' + ref.contentHash, sourceKind: 'agent-run-artifact',
        sourceExportId: 'owner:' + spec.name + ':' + row.id + ':' + ref.artifactKind + ':' + ref.contentHash, authority: 'evidence' })
    }
  }
  return refs
}
