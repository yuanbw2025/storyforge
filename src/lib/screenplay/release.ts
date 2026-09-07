import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { parseAndVerifyCreationReleaseManifestV1 } from '../creation-release/contracts'
import { db } from '../db/schema'
import type {
  CreationReleaseV1,
  ScreenplayBlock,
  ScreenplayFrozenBlockV1,
  ScreenplayReleaseManifestV1,
  WorkspaceScope,
} from '../types'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { inspectScreenplayCompletionV1 } from './production'
import { assertScreenplayReleaseManifestV1 } from './release-contracts'

function omitSystem<T extends Record<string, any>>(row: T): Omit<T, 'id' | 'projectId' | 'worldId' | 'workId' | 'adaptationProjectId' | 'createdAt' | 'updatedAt'> {
  const { id: _id, projectId: _projectId, worldId: _worldId, workId: _workId, adaptationProjectId: _adaptationProjectId, createdAt: _createdAt, updatedAt: _updatedAt, ...portable } = row
  return structuredClone(portable)
}

function freezeBlock(block: ScreenplayBlock): ScreenplayFrozenBlockV1 {
  if (block.type !== 'character') return structuredClone(block)
  const { characterId: _characterId, ...portable } = block
  return structuredClone(portable)
}

export async function publishScreenplayReleaseV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; label?: string }): Promise<CreationReleaseV1 & { id: number }> {
  const scope = await resolveScope({ scope: input.scope })
  const [root, work, report] = await Promise.all([
    db.adaptationProjects.where('workId').equals(scope.workId).first(),
    db.works.get(scope.workId),
    inspectScreenplayCompletionV1(scope),
  ])
  if (!root?.id || root.medium !== 'screenplay' || !work || root.projectId !== scope.projectId || root.worldId !== scope.worldId) throw new Error('[screenplay-release] 剧本改编不存在或越界')
  if (root.revision !== input.expectedAdaptationRevision) throw new Error('[screenplay-release] 改编根已变化，请刷新')
  if (!report.ready) throw new Error(`[screenplay-release] 尚未达到发布条件：${report.blockers.join('；')}`)
  if (!root.brief) throw new Error('[screenplay-release] 缺少已确认 Brief')
  const key = [root.id, root.activeSourceManifestVersion] as [number, number]
  const [sourceUnits, facts, causalEdges, decisions, beats, sceneCards, scenes, reviewIssues, latest] = await Promise.all([
    db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
    db.adaptationSourceFacts.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey'),
    db.adaptationCausalEdges.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey'),
    db.adaptationDecisions.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('stableKey'),
    db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
    db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
    db.screenplayScenes.where('adaptationProjectId').equals(root.id).sortBy('order'),
    db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('createdAt'),
    db.creationReleases.where('[workId+productKind+version]').between([scope.workId, 'screenplay', 0], [scope.workId, 'screenplay', Number.MAX_SAFE_INTEGER]).last(),
  ])
  const unitById = new Map(sourceUnits.flatMap(unit => unit.id == null ? [] : [[unit.id, unit.sourceUnitKey] as const]))
  const createdAt = Date.now()
  const manifest: ScreenplayReleaseManifestV1 = {
    schema: 'storyforge.screenplay-release', version: 1, productKind: 'screenplay',
    work: { code: work.code, title: work.title, description: work.description, genres: [...work.genres] },
    adaptation: {
      revision: root.revision, targetSpec: structuredClone(root.targetSpec), brief: structuredClone(root.brief),
      sourceManifestVersion: root.activeSourceManifestVersion, sourceManifestHash: root.activeSourceManifestHash,
    },
    sourceUnits: sourceUnits.map(unit => ({ sourceUnitKey: unit.sourceUnitKey, label: unit.label, order: unit.order, contentHash: unit.contentHash, wordCount: unit.wordCount })),
    facts: facts.map(omitSystem), causalEdges: causalEdges.map(omitSystem), decisions: decisions.map(omitSystem),
    beats: beats.map(omitSystem), sceneCards: sceneCards.map(omitSystem),
    scenes: scenes.map(scene => {
      const portable = omitSystem(scene)
      const { sourceUnitIds, blocks, ...body } = portable
      const sourceUnitKeys = sourceUnitIds.map(id => unitById.get(id)).filter((value): value is string => Boolean(value))
      if (sourceUnitKeys.length !== sourceUnitIds.length) throw new Error(`[screenplay-release] 场景 ${scene.stableKey} 来源引用无法冻结`)
      return { ...body, sourceUnitKeys, blocks: blocks.map(freezeBlock) }
    }),
    reviewIssues: reviewIssues.map(omitSystem),
    verification: {
      blockers: [...report.blockers], warnings: [...report.warnings],
      totalEstimatedSeconds: report.totalEstimatedSeconds, targetEstimatedSeconds: report.targetEstimatedSeconds,
      reviewedAt: createdAt,
    },
    createdAt,
  }
  const manifestJson = canonicalStringify(manifest)
  const contentHash = await hashCanonicalValue(manifest)
  const draftGuard = canonicalStringify({
    rootRevision: root.revision,
    beats: beats.map(row => [row.stableKey, row.revision]),
    cards: sceneCards.map(row => [row.stableKey, row.revision]),
    scenes: scenes.map(row => [row.stableKey, row.revision]),
    issues: reviewIssues.map(row => [row.stableKey, row.status, row.updatedAt]),
  })
  return db.transaction('rw', scopeTransactionTables(
    db.adaptationProjects, db.works, db.creationReleases, db.screenplayBeats, db.screenplaySceneCards, db.screenplayScenes, db.screenplayReviewIssues,
  ), async () => {
    const [currentRoot, currentBeats, currentCards, currentScenes, currentIssues] = await Promise.all([
      db.adaptationProjects.get(root.id!),
      db.screenplayBeats.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
      db.screenplaySceneCards.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('order'),
      db.screenplayScenes.where('adaptationProjectId').equals(root.id!).sortBy('order'),
      db.screenplayReviewIssues.where('[adaptationProjectId+manifestVersion]').equals(key).sortBy('createdAt'),
    ])
    if (!currentRoot || currentRoot.revision !== root.revision || currentRoot.activeSourceManifestHash !== root.activeSourceManifestHash) throw new Error('[screenplay-release] 发布 CAS 失败：改编根已变化')
    const currentGuard = canonicalStringify({
      rootRevision: currentRoot.revision,
      beats: currentBeats.map(row => [row.stableKey, row.revision]), cards: currentCards.map(row => [row.stableKey, row.revision]),
      scenes: currentScenes.map(row => [row.stableKey, row.revision]), issues: currentIssues.map(row => [row.stableKey, row.status, row.updatedAt]),
    })
    if (currentGuard !== draftGuard) throw new Error('[screenplay-release] 发布 CAS 失败：剧本产物已变化')
    const version = (latest?.version ?? 0) + 1
    const row: CreationReleaseV1 = {
      projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, productKind: 'screenplay', version,
      label: input.label?.trim() || `${work.title} v${version}`, parentReleaseId: latest?.id ?? null,
      sourceRevision: root.revision, manifestJson, contentHash, createdAt,
    }
    const id = await db.creationReleases.add(row) as number
    await db.adaptationProjects.update(root.id!, { status: 'complete', revision: root.revision + 1, updatedAt: createdAt })
    await db.works.update(work.id!, { status: 'completed', updatedAt: createdAt })
    return { ...row, id }
  })
}

export async function listScreenplayReleasesV1(scopeInput: WorkspaceScope): Promise<CreationReleaseV1[]> {
  const scope = await resolveScope({ scope: scopeInput })
  return db.creationReleases.where('[workId+productKind+version]').between([scope.workId, 'screenplay', 0], [scope.workId, 'screenplay', Number.MAX_SAFE_INTEGER]).sortBy('version')
}

export async function readScreenplayReleaseManifestV1(scopeInput: WorkspaceScope, releaseId: number): Promise<ScreenplayReleaseManifestV1> {
  const scope = await resolveScope({ scope: scopeInput })
  const [release, work] = await Promise.all([db.creationReleases.get(releaseId), db.works.get(scope.workId)])
  if (!release || release.productKind !== 'screenplay' || release.projectId !== scope.projectId || release.worldId !== scope.worldId || release.workId !== scope.workId || !work) throw new Error('[screenplay-release] Release 不存在或越界')
  const manifest = await parseAndVerifyCreationReleaseManifestV1(release, work.code) as unknown as ScreenplayReleaseManifestV1
  assertScreenplayReleaseManifestV1(manifest, work.code, release.sourceRevision)
  return manifest
}
