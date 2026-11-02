import Dexie from 'dexie'
import { verifyWorkspaceContentRevisionV1 } from '../authoring/content-revision'
import { db } from '../db/schema'
import type { WorkspaceScope, WorldDerivationV1, WorldRelease, WorldRevision } from '../types'
import { nameDerivedWorldV1, type DeriveNovelToWorldInput, type DerivedNovelWorldResult } from './derivation'
import { importProjectJSON } from '../export/json-export'
import { deriveRegisteredSemanticRowsV1 } from '../export/registry-export'
import { generateWorkspaceUid } from '../memory/identity'
import { generateWorldCode } from '../workspace/identity'
import { resolveScope } from '../workspace/scope'
import { effectiveNovelProfile, effectiveWorkKind } from '../workspace/work-kind'
import { captureNarrativeDomainInTransactionV1, hashNarrativeDomainSourceV1, narrativeDomainCaptureTablesV1,
  type NarrativeDomainCaptureV1 } from './narrative-domain-capture'
import { deriveNarrativeSemanticTransferV1 } from './narrative-semantic-transfer'
import { projectNarrativeDomainCaptureV1 } from './narrative-domain-projection'
import { CURRENT_NARRATIVE_DOMAIN_COMPILER_V4 } from '../types/narrative-release'
import { canonicalNarrativeJsonV1, hashNarrativeValueV1 } from './narrative-json'
import { prepareNarrativeDomainConfirmationV1 } from './narrative-domain-authoring'
import { createNarrativeLineageV1 } from './narrative-lineage'
import { materializeWorldReleaseBackupV1 } from './semantic-snapshot'
import { worldReleaseUidV1 } from './releases'
import { captureFrozenNarrativeSourcesV4, verifyWorldReleaseContentV4 } from './narrative-release-v4'
import { compileNarrativeReleaseInWorkerV1 } from './narrative-release-worker'
import { captureWorldReleaseInputInTransactionV4, type WorldReleaseInputV4 } from './narrative-release-capture'

async function captureIndependent(scope: WorkspaceScope, selectedTables?: readonly string[]) {
  return db.transaction('r', narrativeDomainCaptureTablesV1(), async () => {
    const [project, world, work] = await Dexie.Promise.all([
      db.projects.get(scope.projectId), db.worlds.get(scope.worldId), db.works.get(scope.workId),
    ])
    if (!project || !world || !work || world.projectId !== project.id || work.projectId !== project.id || work.worldId !== world.id
      || project.workspacePurpose !== 'independent-work' || effectiveWorkKind(work) !== 'novel') throw Error('[derivation] 只有独立长篇或短篇小说可以派生世界')
    const capture = await Dexie.Promise.resolve(captureNarrativeDomainInTransactionV1({ scope, owner: { kind: 'work', workCode: work.code } }))
    return { project, world, work, ...deriveNarrativeSemanticTransferV1({ capture, project, world, work, selectedTables }) }
  })
}

/** Explicit copy of already-reviewed meaning. Verify every copied field/FK
 * under the original namespace before issuing a new target confirmation.
 * Missing/stale confirmations remain unreviewed; no extraction or guessing. */
async function copyConfirmedAnnotations(source: NarrativeDomainCaptureV1, target: NarrativeDomainCaptureV1) {
  for (const spec of source.registry.tables) {
    if (!spec.worldSemantic?.projector || !spec.resourceIdentity) continue
    for (const row of source.rows.get(spec.name) ?? []) {
      if (!row.narrativeAuthorityV1) continue
      const sourceHash = await hashNarrativeDomainSourceV1(source, spec.name, row)
      if (sourceHash !== row.narrativeAuthorityV1.contentHash) continue
      const copied = target.rows.get(spec.name)?.find(item => item[spec.resourceIdentity!.field] === row[spec.resourceIdentity!.field])
      if (!copied || await hashNarrativeDomainSourceV1({ ...target, worldCode: source.worldCode, workCode: source.workCode }, spec.name, copied) !== sourceHash) {
        throw Error('[derivation] 复制后的正文、注释、稳定身份或引用与来源不一致')
      }
      const prepared = await prepareNarrativeDomainConfirmationV1({ capture: target, current: copied, table: spec.name,
        expectedSourceHash: await hashNarrativeDomainSourceV1(target, spec.name, copied), annotations: {} })
      // This capture is private preparation, shared with peers for reference
      // validation. It has no database IDs and has not been persisted.
      Object.assign(copied, prepared.row)
    }
  }
}

function sourceState(source: Awaited<ReturnType<typeof captureIndependent>>) {
  return canonicalNarrativeJsonV1({ transfer: source.transfer, work: { code: source.work.code, title: source.work.title,
    description: source.work.description, updatedAt: source.work.updatedAt } })
}

/** Experimental v4 branch of the existing explicit derivation action. The
 * immutable original capture and target namespace are distinct throughout.
 * Compile and verify before writing; the sole registry import transaction
 * commits the complete target or nothing, including on process termination. */
export async function deriveNarrativeNovelToWorldV4(input: DeriveNovelToWorldInput): Promise<DerivedNovelWorldResult> {
  const request = { ...input, sourceScope: { ...input.sourceScope }, selectedTables: input.selectedTables && [...input.selectedTables],
    expectedSourceRevision: input.expectedSourceRevision && structuredClone(input.expectedSourceRevision) }
  const sourceScope = await resolveScope({ scope: request.sourceScope })
  const source = await captureIndependent(sourceScope, request.selectedTables)
  if (request.expectedSourceRevision) {
    const expected = await verifyWorkspaceContentRevisionV1(request.expectedSourceRevision, { scope: sourceScope, worldGroupId: null })
    if (!expected.fresh) throw Error('[derivation] 作者预览后源作品已变化，请重新检查来源再派生世界草稿')
  }
  const sourceJson = sourceState(source), sourceContentHash = await hashNarrativeValueV1(source.transfer)
  const projection = await projectNarrativeDomainCaptureV1(source.capture, { branchKey: 'canon' })

  const workspaceUid = generateWorkspaceUid(), worldCode = generateWorldCode(), workCode = source.work.code
  const targetName = request.targetName?.trim() || `${source.work.title} · 世界`
  const description = source.work.description || `由作品《${source.work.title}》的已确认语义内容显式派生。`
  const transfer = structuredClone(source.transfer)
  Object.assign(transfer.semanticSnapshot.project, { workspaceUid, workspacePurpose: 'world-engine', name: targetName })
  Object.assign(transfer.semanticSnapshot.worlds[0], { identityKind: 'world-draft', code: worldCode, name: targetName, description })
  transfer.semanticSnapshot.works[0].title = targetName
  const targetCapture = captureFrozenNarrativeSourcesV4({ ...transfer, worldCode, sourceWorkCode: workCode })
  await copyConfirmedAnnotations(source.capture, targetCapture)
  transfer.records = deriveRegisteredSemanticRowsV1({
    rows: new Map(transfer.selectedTables.map(name => [name, targetCapture.rows.get(name)!])),
    worldId: targetCapture.scope.worldId, workId: targetCapture.scope.workId,
  }).records
  const lineage = await createNarrativeLineageV1({ source: projection,
    targetOwner: { kind: 'world', worldCode, sourceWorkCode: workCode },
    sourceWorkspaceUid: source.project.workspaceUid, sourceContentHash })
  const capturedInput: WorldReleaseInputV4 = { schema: 'storyforge.world-release', version: 4, semanticContract: 4,
    registryVersion: 'world-semantic-v4', compilerVersion: CURRENT_NARRATIVE_DOMAIN_COMPILER_V4, worldCode, worldName: targetName,
    ...transfer, sourceManifest: { sourceKind: 'world-draft', sourceWorkspaceUid: workspaceUid,
      sourceWorldCode: worldCode, sourceWorkCode: workCode, lineage } }
  const inputJson = canonicalNarrativeJsonV1(capturedInput)
  const compiled = await compileNarrativeReleaseInWorkerV1(capturedInput)
  const { narrative: _narrative, semanticRootHash: _root, indexDescriptor: _index, ...compiledSource } = compiled.manifest
  if (canonicalNarrativeJsonV1(compiledSource) !== inputJson
    || canonicalNarrativeJsonV1(compiled.manifest) !== compiled.manifestJson) throw Error('[derivation] 编译结果与准备来源不一致')
  await verifyWorldReleaseContentV4({ manifest: compiled.manifest, expectedContentHash: compiled.contentHash, index: compiled.index })

  let result: DerivedNovelWorldResult | undefined
  await importProjectJSON(materializeWorldReleaseBackupV1(transfer), { finalizeInTransaction: async targetProjectId => {
    // Source read and every target write share the registered import transaction.
    // No Worker, network or whole-release verification holds this transaction.
    if (sourceState(await captureIndependent(sourceScope, request.selectedTables)) !== sourceJson) {
      throw Error('[derivation:stale] 派生期间源作品已变化，请重新审阅后派生')
    }
    const targetScope = await resolveScope({ projectId: targetProjectId })
    const targetProject = (await db.projects.get(targetProjectId))!
    const targetWorld = (await db.worlds.get(targetScope.worldId))!, targetWork = (await db.works.get(targetScope.workId))!
    if (targetProject.workspaceUid !== workspaceUid || targetWorld.code !== worldCode || targetWork.code !== workCode
      || (await db.worlds.where('code').equals(worldCode).count()) !== 1) {
      throw Error('[derivation:identity] 新世界身份冲突，未保存派生目标')
    }
    await nameDerivedWorldV1(targetScope, targetName, description)
    const now = Date.now()
    const row: WorldDerivationV1 = { projectId: targetProjectId, worldId: targetScope.worldId,
      sourceWorkspaceUid: source.project.workspaceUid, sourceWorkCode: source.work.code, sourceWorkRevision: source.work.updatedAt,
      sourceRevisionVectorJson: canonicalNarrativeJsonV1({ version: 1, revisionVectorHash: projection.bundle.scope.revisionVectorHash }),
      sourceKind: effectiveNovelProfile(source.work) === 'short' ? 'short-novel' : 'long-novel',
      sourceRangeJson: canonicalNarrativeJsonV1({ kind: 'registered-tables', tables: source.transfer.selectedTables }),
      selectedResourceIdsJson: canonicalNarrativeJsonV1(projection.coverage.eligibleSelected), sourceContentHash,
      narrativeLineageJson: canonicalNarrativeJsonV1(lineage), targetRevisionId: null, targetReleaseId: null, createdAt: now }
    const id = await db.worldDerivations.add(row) as number
    const current = await Dexie.Promise.resolve(captureWorldReleaseInputInTransactionV4({ scope: targetScope,
      includeWorkSources: true, selectedTables: transfer.selectedTables, compilerVersion: capturedInput.compilerVersion }))
    if (canonicalNarrativeJsonV1(current) !== inputJson) throw Error('[derivation] 导入后的来源与已验证编译不一致')
    const revision: WorldRevision = { projectId: targetProjectId, worldId: targetScope.worldId, parentRevisionId: null,
      revision: 1, label: `源自《${source.work.title}》的叙事世界快照`, manifestJson: compiled.manifestJson,
      contentHash: compiled.contentHash, createdAt: now, updatedAt: now }
    revision.id = await db.worldRevisions.add(revision) as number
    let release: WorldRelease | null = null
    if (request.publish) {
      release = { projectId: targetProjectId, worldId: targetScope.worldId, revisionId: revision.id, version: 1,
        releaseUid: worldReleaseUidV1({ worldCode, version: 1, contentHash: revision.contentHash }),
        label: revision.label, manifestJson: revision.manifestJson, contentHash: revision.contentHash,
        sourceWorldCode: worldCode, createdAt: now }
      release.id = await db.worldReleases.add(release) as number
      await db.worlds.update(targetScope.worldId, { currentVersion: 1, updatedAt: now })
    }
    await db.worldDerivations.update(id, { targetRevisionId: revision.id!, targetReleaseId: release?.id ?? null })
    result = { sourceScope, targetScope, targetProjectId, revision, release,
      derivation: { ...row, id, targetRevisionId: revision.id!, targetReleaseId: release?.id ?? null } }
  } })
  if (!result) throw Error('[derivation] 导入事务未返回完整派生结果')
  return result
}
