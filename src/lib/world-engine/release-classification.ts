import { hashCanonicalValue } from '../agent/run/hash'
import { PROJECT_TABLES, REGISTRY_BY_NAME } from '../registry/project-tables'
import type { WorldReleaseManifestV2 } from '../types'

export type LegacyWorldTableRole =
  | 'world-semantic'
  | 'product-content'
  | 'product-media'
  | 'runtime'
  | 'infrastructure'
  | 'unknown'

export interface LegacyWorldTableClassificationV1 {
  table: string
  role: LegacyWorldTableRole
  rowCount: number
  byteSize: number
  contentHash: string
}

export interface WorldReleaseClassificationV1 {
  version: 1
  contract: 'semantic-v3' | 'legacy-mixed'
  migrationRequired: boolean
  tables: LegacyWorldTableClassificationV1[]
  totals: Record<LegacyWorldTableRole, { tableCount: number; rowCount: number; byteSize: number }>
}

const ROOT_OR_INFRASTRUCTURE = new Set([
  'projects', 'worlds', 'works', 'worldRevisions', 'worldReleases', 'worldDerivations',
  'worldReleaseMigrations', 'ownershipMigrations',
])

export function classifyLegacyWorldTable(table: string): LegacyWorldTableRole {
  if (ROOT_OR_INFRASTRUCTURE.has(table)) return 'infrastructure'
  const spec = REGISTRY_BY_NAME.get(table)
  if (!spec) return 'unknown'
  if (spec.worldSemantic) return 'world-semantic'
  if (
    spec.mediaRef
    || spec.portableData?.kind === 'binary-blob'
    || spec.portableData?.kind === 'shared-media-object'
    || /(?:media|asset|blob|audio|image|video)/i.test(table)
  ) return 'product-media'
  if (spec.domainOwner?.allowed.includes('instance') || /(?:session|runtime|checkpoint|eventLog)/i.test(table)) {
    return 'runtime'
  }
  return 'product-content'
}

function rowsForTable(source: Record<string, unknown>, table: string): unknown[] {
  return Array.isArray(source[table]) ? source[table] as unknown[] : []
}

export async function classifyWorldReleasePayloadV1(input: {
  manifest?: WorldReleaseManifestV2 | null
  portableProject?: Record<string, unknown> | null
}): Promise<WorldReleaseClassificationV1> {
  const records = input.manifest?.records && typeof input.manifest.records === 'object'
    ? input.manifest.records
    : {}
  const portable = input.portableProject ?? input.manifest?.portableProject ?? {}
  const tableNames = new Set<string>([
    ...Object.keys(records),
    ...Object.keys(portable).filter(name => Array.isArray(portable[name])),
  ])
  const tables: LegacyWorldTableClassificationV1[] = []
  for (const table of [...tableNames].sort()) {
    const recordRows = rowsForTable(records, table)
    const rows = recordRows.length > 0 || table in records ? recordRows : rowsForTable(portable, table)
    const serialized = JSON.stringify(rows)
    tables.push({
      table,
      role: classifyLegacyWorldTable(table),
      rowCount: rows.length,
      byteSize: new TextEncoder().encode(serialized).byteLength,
      contentHash: await hashCanonicalValue(rows),
    })
  }
  const roles: LegacyWorldTableRole[] = [
    'world-semantic', 'product-content', 'product-media', 'runtime', 'infrastructure', 'unknown',
  ]
  const totals = Object.fromEntries(roles.map(role => {
    const matches = tables.filter(table => table.role === role)
    return [role, {
      tableCount: matches.length,
      rowCount: matches.reduce((sum, table) => sum + table.rowCount, 0),
      byteSize: matches.reduce((sum, table) => sum + table.byteSize, 0),
    }]
  })) as WorldReleaseClassificationV1['totals']
  const pureSemantic = input.manifest?.semanticContract === 3
    && tables.every(table => table.role === 'world-semantic' || table.role === 'infrastructure' || table.rowCount === 0)
    && (input.manifest.selectedNarrativeModules?.length ?? 0) === 0
  return {
    version: 1,
    contract: pureSemantic ? 'semantic-v3' : 'legacy-mixed',
    migrationRequired: !pureSemantic,
    tables,
    totals,
  }
}

export const WORLD_SEMANTIC_TABLE_NAMES = PROJECT_TABLES
  .filter(spec => spec.worldSemantic)
  .map(spec => spec.name)
  .sort()
