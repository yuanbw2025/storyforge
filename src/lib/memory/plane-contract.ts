import { REGISTRY_BY_NAME } from '../registry/project-tables'
import type { MemoryPlaneIdV1 } from '../types'

/**
 * MEMINT-0 boundary declaration, not a fourth data registry. Table lifecycle
 * continues to come exclusively from PROJECT_TABLES; this map only prevents a
 * memory consumer from treating evidence/cache/projection as Canon.
 */
export const MEMORY_PLANE_CONTRACT_V1 = {
  version: 1,
  planes: {
    'canon-authority': {
      authority: 'author-confirmed-domain-records',
      mutableBy: 'adopt-only',
      tableNames: [] as const,
    },
    'derived-narrative-memory': {
      authority: 'derived-rebuildable',
      mutableBy: 'deterministic-or-governed-rebuild',
      tableNames: [
        'retrievalChunks',
        'narrativeSummaryNodes',
        'referenceAnalysisRuns',
        'referenceChunkAnalysis',
        'referenceAnalysisSources',
        'aiUsageLog',
      ] as const,
    },
    'execution-evidence': {
      authority: 'immutable-ledger-evidence',
      mutableBy: 'harness-ledger',
      tableNames: [
        'agentConversations',
        'agentEvents',
        'agentRuns',
        'agentRunEvents',
        'agentRunCheckpoints',
        'agentRunArtifacts',
        'nodeFlows',
        'nodeRuns',
        'productRuntimeSessions',
        'productRuntimeEvents',
        'productRuntimeCheckpoints',
      ] as const,
    },
    'bounded-working-context': {
      authority: 'ephemeral-or-checkpointed-projection',
      mutableBy: 'context-gateway',
      tableNames: ['agentRunCheckpoints'] as const,
    },
    'projection-recovery': {
      authority: 'non-canon-projection',
      mutableBy: 'workspace-sync-or-recovery',
      tableNames: [
        'workspaceDocuments',
        'ownershipScopeChanges',
        'snapshots',
        'importSessions',
        'importJobs',
        'importLogs',
        'importFiles',
      ] as const,
    },
  },
} as const

const NON_CANON_TABLE_PLANES = new Map<string, MemoryPlaneIdV1>()
for (const [plane, declaration] of Object.entries(MEMORY_PLANE_CONTRACT_V1.planes)) {
  if (plane === 'canon-authority' || plane === 'bounded-working-context') continue
  for (const tableName of declaration.tableNames) {
    if (NON_CANON_TABLE_PLANES.has(tableName)) {
      throw new Error(`[memory-plane] ${tableName} 被分配到多个持久记忆平面`)
    }
    NON_CANON_TABLE_PLANES.set(tableName, plane as MemoryPlaneIdV1)
  }
}

/**
 * Classifies registered persistent tables without owning their lifecycle. A
 * table absent from the explicit non-Canon set remains domain authority only
 * if PROJECT_TABLES says it is project/world data.
 */
export function memoryPlaneForTableV1(tableName: string): MemoryPlaneIdV1 | null {
  const spec = REGISTRY_BY_NAME.get(tableName)
  if (!spec) {
    throw new Error(`[memory-plane] 未登记 PROJECT_TABLES: ${tableName}`)
  }
  const explicit = NON_CANON_TABLE_PLANES.get(tableName)
  if (explicit) return explicit
  if (spec.owner === 'global') return null
  if (spec.owner === 'transient' || spec.owner === 'blob') return 'projection-recovery'
  return 'canon-authority'
}

export function assertMemoryPlaneContractV1(): void {
  for (const declaration of Object.values(MEMORY_PLANE_CONTRACT_V1.planes)) {
    for (const tableName of declaration.tableNames) {
      if (!REGISTRY_BY_NAME.has(tableName)) {
        throw new Error(`[memory-plane] 合同引用未登记表: ${tableName}`)
      }
    }
  }
  for (const tableName of REGISTRY_BY_NAME.keys()) memoryPlaneForTableV1(tableName)
}
