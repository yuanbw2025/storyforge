/** Registered owner tables and read/retention transaction closure share one metadata source. */
import { PROJECT_TABLES } from '../registry/project-tables'
import type { MemoryArtifactRefV1 } from '../types'
import { extractExactArtifactOwnerRootsV1 } from './artifact-roots'

function owners() {
  return PROJECT_TABLES.filter(spec => spec.exactArtifactRoots?.length)
}
export function exactArtifactOwnerTablesV1() { return owners().map(spec => spec.table) }

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
