/**
 * Historical executable WorldRelease fixture.
 *
 * ARCH-02 forbids production code from sealing product-owned executable
 * narrative graphs into a semantic WorldRelease. A number of older product
 * kernel tests still need a frozen, content-addressed input in order to verify
 * their own deterministic algorithms until those products migrate to the
 * neutral semantic gateway. This helper preserves that coverage without
 * reopening the production authoring path.
 *
 * The helper lives under tests/, has no UI or src/ import path, and first uses
 * the real semantic release builder. It then appends only the explicitly named
 * historical narrative graph and removes semanticContract=3 so the fixture can
 * never masquerade as a current pure-semantic release.
 */
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { db } from '../../src/lib/db/schema'
import { deriveStrictExportProjectSnapshot } from '../../src/lib/export/registry-export'
import type { WorkspaceScope, WorldReleaseManifestV2, WorldRevision } from '../../src/lib/types'
import {
  createWorldRevision,
  hashWorldReleaseManifestV1,
  stableJson,
} from '../../src/lib/world-engine/releases'

const EXECUTABLE_TABLES = [
  'narrativeModules',
  'narrativeNodes',
  'narrativeBeats',
  'narrativeChoices',
] as const

function rows(source: Record<string, unknown>, table: string): Array<Record<string, unknown>> {
  const value = source[table]
  return Array.isArray(value)
    ? structuredClone(value) as Array<Record<string, unknown>>
    : []
}

export async function createLegacyExecutableWorldRevisionFixtureV1(input: {
  scope: WorkspaceScope
  label: string
  parentRevisionId?: number | null
  selectedTables?: string[]
  selectedNarrativeModuleIds: number[]
}): Promise<WorldRevision> {
  const uniqueModuleIds = [...new Set(input.selectedNarrativeModuleIds)]
  if (!uniqueModuleIds.length) {
    throw new Error('[fixture] 必须显式选择至少一个历史可执行叙事模块')
  }

  const semantic = await createWorldRevision({
    scope: input.scope,
    label: input.label,
    parentRevisionId: input.parentRevisionId,
    selectedTables: input.selectedTables,
  })
  const snapshot = await deriveStrictExportProjectSnapshot(input.scope.projectId)
  const moduleIds = snapshot.exportIds.get('narrativeModules')
  const selectedExportIds = new Set(uniqueModuleIds.map(id => {
    const exportId = moduleIds?.get(id)
    if (exportId == null) throw new Error(`[fixture] NarrativeModule 不在严格快照中:${id}`)
    return exportId
  }))
  const source = snapshot.data as unknown as Record<string, unknown>
  const selectedRows: Record<(typeof EXECUTABLE_TABLES)[number], Array<Record<string, unknown>>> = {
    narrativeModules: rows(source, 'narrativeModules').filter(row => selectedExportIds.has(Number(row._exportId))),
    narrativeNodes: rows(source, 'narrativeNodes').filter(row => selectedExportIds.has(Number(row._moduleExportId))),
    narrativeBeats: rows(source, 'narrativeBeats').filter(row => selectedExportIds.has(Number(row._moduleExportId))),
    narrativeChoices: rows(source, 'narrativeChoices').filter(row => selectedExportIds.has(Number(row._moduleExportId))),
  }
  if (selectedRows.narrativeModules.length !== selectedExportIds.size) {
    throw new Error('[fixture] 历史叙事模块便携身份不完整')
  }

  const manifest = JSON.parse(semantic.manifestJson) as WorldReleaseManifestV2
  delete manifest.semanticContract
  manifest.selectedNarrativeModules = selectedRows.narrativeModules.map(row => ({
    exportId: Number(row._exportId),
    kind: row.kind as WorldReleaseManifestV2['selectedNarrativeModules'][number]['kind'],
    title: String(row.title ?? ''),
  }))
  const portable = manifest.portableProject as Record<string, unknown>
  for (const table of EXECUTABLE_TABLES) {
    manifest.records[table] = selectedRows[table]
    portable[table] = structuredClone(selectedRows[table])
  }
  manifest.selectedTables = [...new Set([...manifest.selectedTables, ...EXECUTABLE_TABLES])]
  manifest.dependencies = await Promise.all(Object.entries(manifest.records).map(async ([table, tableRows]) => ({
    table,
    rowCount: tableRows.length,
    contentHash: await hashCanonicalValue(tableRows),
  })))

  const manifestJson = stableJson(manifest)
  const contentHash = await hashWorldReleaseManifestV1(JSON.parse(manifestJson))
  const updatedAt = Date.now()
  await db.worldRevisions.update(semantic.id!, { manifestJson, contentHash, updatedAt })
  return { ...semantic, manifestJson, contentHash, updatedAt }
}
