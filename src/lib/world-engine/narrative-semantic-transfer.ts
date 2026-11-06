import type { Project, World, Work } from '../types'
import type { WorldSemanticSnapshotV1 } from '../types/world-release'
import type { NarrativeDomainCaptureV1 } from './narrative-domain-capture'
import { deriveRegisteredSemanticRowsV1 } from '../export/registry-export'
import { WORLD_SEMANTIC_REGISTRY_V4 } from './semantic-registry-v4'
import { isWorldReleaseSourceEligibleV4 } from './narrative-release-v4'
import { compareUnicodeCodePointsV1, narrativeFail } from './narrative-json'

/** Portable source content, not a release. It can represent an independent
 * Work before an explicit copy creates a public World namespace. */
export function deriveNarrativeSemanticTransferV1(input: {
  capture: NarrativeDomainCaptureV1; project: Project; world: World; work: Work; selectedTables?: readonly string[]
}) {
  const { project, world, work } = input
  const selectedTables = [...(input.selectedTables ?? WORLD_SEMANTIC_REGISTRY_V4.tables.map(spec => spec.name))].sort(compareUnicodeCodePointsV1)
  if (new Set(selectedTables).size !== selectedTables.length || selectedTables.some(name => !WORLD_SEMANTIC_REGISTRY_V4.tables.some(spec => spec.name === name))) {
    narrativeFail('release-selection', '封存领域重复或未登记在 v4 合同中')
  }
  const rows = new Map(selectedTables.map(name => [name,
    input.capture.rows.get(name)!.filter(row => isWorldReleaseSourceEligibleV4(name, row))] as const))
  const { records, exportIds } = deriveRegisteredSemanticRowsV1({ rows, worldId: world.id!, workId: work.id! })
  const semanticSnapshot: WorldSemanticSnapshotV1 = {
    schema: 'storyforge.world-semantic-snapshot', version: 1,
    ownership: { contractVersion: 1, worldExportId: 0, workExportId: 0 },
    project: { workspaceUid: project.workspaceUid, workspacePurpose: project.workspacePurpose, name: world.name,
      enableMultiWorld: project.enableMultiWorld === true, _activeWorldExportId: 0, _activeWorkExportId: 0, createdAt: 0, updatedAt: 0 },
    worlds: [{ _exportId: 0, identityKind: world.identityKind, code: world.code, name: world.name,
      description: world.description, currentVersion: 0, createdAt: 0, updatedAt: 0 }],
    works: [{ _exportId: 0, _worldExportId: 0, code: work.code, kind: 'novel', novelProfile: 'long', title: world.name,
      description: '', genres: [], status: 'drafting', targetWordCount: 0, currentWordCount: 0,
      includeCultivationProgressInAI: false, _activeCharacterDrivenPlanExportId: null, _activeNarrativeModuleExportId: null,
      postAdoptionPolicy: 'off', postAdoptionTaskTypes: [],
      postAdoptionBudget: { maxModelCalls: 0, maxInputTokens: 0, maxOutputTokens: 0, maxCostUsd: 0, allowUnknownCost: false },
      createdAt: 0, updatedAt: 0 }],
  }
  const selectedCapture: NarrativeDomainCaptureV1 = { ...input.capture,
    rows: new Map([...input.capture.rows.keys()].map(name => [name, rows.get(name) ?? []])) }
  return { transfer: { selectedTables, records, semanticSnapshot }, capture: selectedCapture, exportIds }
}
