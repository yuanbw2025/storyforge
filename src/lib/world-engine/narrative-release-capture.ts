import Dexie from 'dexie'
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types/world-ownership'
import { CURRENT_NARRATIVE_DOMAIN_COMPILER_V4, NARRATIVE_DOMAIN_COMPILERS_V4, type NarrativeDomainCompilerV4, type WorldReleaseSemanticContentV4 } from '../types/narrative-release'
import { captureNarrativeDomainInTransactionV1, narrativeDomainCaptureTablesV1 } from './narrative-domain-capture'
import { isShareableWorld } from './world-identity'
import { canonicalNarrativeJsonV1, narrativeFail } from './narrative-json'
import { deriveNarrativeSemanticTransferV1 } from './narrative-semantic-transfer'
import { parseNarrativeLineageV1 } from './narrative-lineage'

export type WorldReleaseInputV4 = Omit<WorldReleaseSemanticContentV4, 'narrative'>

export function narrativeReleaseCaptureTablesV4() { return [...narrativeDomainCaptureTablesV1(), db.worldDerivations] }

type WorldReleaseCaptureRequestV4 = {
  scope: WorkspaceScope; selectedTables?: readonly string[]; includeWorkSources?: boolean
  compilerVersion?: NarrativeDomainCompilerV4
}

/** Semantic-only capture. Product/media state is never read into the snapshot.
 * Reused inside the final write transaction for a source compare-and-swap. */
export function captureWorldReleaseInputInTransactionV4(input: WorldReleaseCaptureRequestV4): Promise<WorldReleaseInputV4> {
  return captureWorldReleaseSourceInTransactionV4(input).then(captured => captured.input)
}

/** These indexes prove local restoration during derivation, outside the wire. */
export function captureWorldReleaseSourceInTransactionV4(input: WorldReleaseCaptureRequestV4) {
  if (input.compilerVersion !== undefined && !NARRATIVE_DOMAIN_COMPILERS_V4.includes(input.compilerVersion)) {
    narrativeFail('compiler-version', '叙事封存编译器版本不受支持')
  }
  return Dexie.Promise.all([
    db.projects.get(input.scope.projectId), db.worlds.get(input.scope.worldId), db.works.get(input.scope.workId),
    db.worldDerivations.where('worldId').equals(input.scope.worldId).toArray(),
  ]).then(([project, world, work, derivations]) => {
    if (!project || !world || !work || world.projectId !== project.id || work.projectId !== project.id || work.worldId !== world.id
      || project.workspacePurpose !== 'world-engine' || !isShareableWorld(world)) {
      narrativeFail('release-owner', 'v4 封存必须明确选择世界引擎草稿；独立作品须先显式派生')
    }
    const lineages = derivations.filter(row => row.narrativeLineageJson !== undefined)
    if (lineages.length > 1 || lineages.some(row => row.projectId !== project.id)) narrativeFail('release-lineage', '世界派生来源不唯一或不属于当前工作区')
    const lineage = lineages[0] && parseNarrativeLineageV1(JSON.parse(lineages[0].narrativeLineageJson!))
    if (lineage && (lineage.targetWorldCode !== world.code || lineage.sourceContentHash !== lineages[0].sourceContentHash)) narrativeFail('release-lineage', '派生回执与世界来源不匹配')
    if (input.includeWorkSources !== undefined && typeof input.includeWorkSources !== 'boolean') narrativeFail('release-lineage', '作品来源选择必须明确')
    const sourceWorkCode = input.includeWorkSources ? work.code : lineage?.sourceOwner.kind === 'work' ? lineage.sourceOwner.workCode : null
    return Dexie.Promise.resolve(captureNarrativeDomainInTransactionV1({ scope: input.scope,
      owner: { kind: 'world', worldCode: world.code, sourceWorkCode: input.includeWorkSources ? work.code : null } })).then(captured => {
      const { transfer, exportIds } = deriveNarrativeSemanticTransferV1({ capture: captured, project, world, work, selectedTables: input.selectedTables })
      // Fixed neutral roots support import without transporting a product workflow.
      // The source Work is a local locator, never the owner of frozen world records.
      const releaseInput: WorldReleaseInputV4 = {
        schema: 'storyforge.world-release', version: 4, semanticContract: 4,
        registryVersion: 'world-semantic-v4', compilerVersion: input.compilerVersion ?? CURRENT_NARRATIVE_DOMAIN_COMPILER_V4,
        worldCode: world.code, worldName: world.name, ...transfer,
        sourceManifest: { sourceKind: 'world-draft', sourceWorkspaceUid: project.workspaceUid,
          sourceWorldCode: world.code, sourceWorkCode, ...(lineage ? { lineage } : {}) },
      }
      return { input: releaseInput, exportIds }
    })
  })
}

export async function captureWorldReleaseInputV4(input: {
  scope: WorkspaceScope; selectedTables?: readonly string[]; includeWorkSources?: boolean
  compilerVersion?: NarrativeDomainCompilerV4
}): Promise<{ input: WorldReleaseInputV4; inputJson: string }> {
  const request = { scope: { ...input.scope }, selectedTables: input.selectedTables && [...input.selectedTables],
    includeWorkSources: input.includeWorkSources, compilerVersion: input.compilerVersion }
  const captured = await db.transaction('r', narrativeReleaseCaptureTablesV4(), async () =>
    await Dexie.Promise.resolve(captureWorldReleaseInputInTransactionV4(request)))
  const inputJson = canonicalNarrativeJsonV1(captured)
  return { input: JSON.parse(inputJson) as WorldReleaseInputV4, inputJson }
}
