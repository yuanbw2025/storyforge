import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { parseAndVerifyCreationReleaseManifestV1 } from '../creation-release/contracts'
import { db } from '../db/schema'
import { readMediaBlobObjectData } from '../product-production/media-blob-store'
import type { CreationReleaseAssetV1, CreationReleaseV1, MotionDramaPromptPackMaturityV1, MotionDramaProviderTargetV1, MotionDramaReleaseManifestV1, WorkspaceScope } from '../types'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { verifyMotionDramaPromptPackV1 } from './prompt-pack'
import { inspectMotionDramaQualityV1 } from './quality'
import { assertMotionDramaReleaseManifestV1 } from './release-contracts'
import { requireMotionDramaRootsV1 } from './service'

function portable<T extends Record<string, any>>(row: T): Record<string, unknown> {
  const { id: _id, projectId: _projectId, worldId: _worldId, workId: _workId, adaptationProjectId: _adaptationProjectId, createdAt: _createdAt, updatedAt: _updatedAt, ...body } = row
  return structuredClone(body)
}

export async function publishMotionDramaReleaseV1(input: { scope: WorkspaceScope; episodeNumbers: number[]; providers: MotionDramaProviderTargetV1[]; tier: MotionDramaPromptPackMaturityV1; expectedProductionRevision: number; label?: string }): Promise<CreationReleaseV1 & { id: number }> {
  const roots = await requireMotionDramaRootsV1(input.scope, true)
  const episodeNumbers = [...new Set(input.episodeNumbers)].sort((a, b) => a - b)
  const providers = [...new Set(input.providers)]
  if (!episodeNumbers.length || !providers.length || episodeNumbers.some(value => !Number.isInteger(value) || value < 1)) throw new Error('[motion-drama-release] 发布范围非法')
  if (roots.production.revision !== input.expectedProductionRevision) throw new Error('[motion-drama-release] 生产内容已变化，请刷新')
  const reports = await Promise.all(episodeNumbers.map(episodeNumber => inspectMotionDramaQualityV1({ scope: roots.scope, episodeNumber, providers })))
  const blockers = reports.flatMap(report => report.blockers.map(item => `第 ${report.episodeNumber} 集：${item}`))
  if (input.tier === 'reference-ready') blockers.push(...reports.filter(report => report.achievableTier !== 'reference-ready').map(report => `第 ${report.episodeNumber} 集：参考物料尚未就绪`))
  if (blockers.length) throw new Error(`[motion-drama-release] 尚未达到发布条件：${blockers.join('；')}`)
  const [bible, episodes, scenes, assets, versions, shots, references, issues, packs, latest] = await Promise.all([
    db.motionDramaSeriesBibles.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.version === roots.production.activeSeriesBibleVersion).first(),
    db.motionDramaEpisodes.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => episodeNumbers.includes(row.episodeNumber)).sortBy('episodeNumber'),
    db.motionDramaScriptScenes.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => episodeNumbers.includes(row.episodeNumber)).sortBy('order'),
    db.motionDramaAssetSubjects.where('adaptationProjectId').equals(roots.adaptation.id).sortBy('stableKey'),
    db.motionDramaAssetVersions.where('adaptationProjectId').equals(roots.adaptation.id).toArray(),
    db.motionDramaShots.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => episodeNumbers.includes(row.episodeNumber)).sortBy('order'),
    db.motionDramaShotReferences.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.selected).toArray(),
    db.motionDramaReviewIssues.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => episodeNumbers.includes(row.episodeNumber)).sortBy('createdAt'),
    db.motionDramaPromptPacks.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => episodeNumbers.includes(row.episodeNumber) && providers.includes(row.provider)).toArray(),
    db.creationReleases.where('[workId+productKind+version]').between([roots.scope.workId, 'motion-drama', 0], [roots.scope.workId, 'motion-drama', Number.MAX_SAFE_INTEGER]).last(),
  ])
  if (!bible) throw new Error('[motion-drama-release] 系列圣经缺失')
  const latestPacks = episodeNumbers.flatMap(episodeNumber => providers.map(provider => packs.filter(pack => pack.episodeNumber === episodeNumber && pack.provider === provider).sort((a, b) => b.version - a.version)[0]).filter(Boolean))
  const verifiedPacks = await Promise.all(latestPacks.map(verifyMotionDramaPromptPackV1))
  const usedSubjects = new Set(shots.flatMap(shot => [...shot.subjectKeys, ...shot.soundPlan.flatMap(cue => cue.subjectKey ? [cue.subjectKey] : [])]))
  for (const subject of assets) if (subject.kind === 'voice' || subject.kind === 'sound') usedSubjects.add(subject.stableKey)
  const selectedVersions = input.tier === 'reference-ready' ? assets.filter(subject => usedSubjects.has(subject.stableKey)).map(subject => versions.find(version => version.stableKey === subject.selectedVersionKey)).filter((row): row is NonNullable<typeof row> => Boolean(row?.blobObjectId)) : []
  const selectedReferences = input.tier === 'reference-ready' ? references.filter(reference => shots.some(shot => shot.stableKey === reference.shotKey) && reference.blobObjectId != null) : []
  const blobRows = new Map<number, import('../types').MediaBlobObjectRecordV1 & { id: number }>()
  for (const item of [...selectedVersions.map(row => ({ id: row.blobObjectId! })), ...selectedReferences.map(row => ({ id: row.blobObjectId! }))]) if (!blobRows.has(item.id)) {
    const blob = await db.mediaBlobObjects.get(item.id)
    if (!blob?.id || blob.workId !== roots.scope.workId) throw new Error('[motion-drama-release] 参考素材不存在或越界')
    await readMediaBlobObjectData({ scope: roots.scope, blobObjectId: blob.id, expected: { contentHash: blob.contentHash, byteSize: blob.byteSize, mimeType: blob.mimeType } })
    blobRows.set(item.id, blob as import('../types').MediaBlobObjectRecordV1 & { id: number })
  }
  const createdAt = Date.now()
  const manifest: MotionDramaReleaseManifestV1 = {
    schema: 'storyforge.motion-drama-release', version: 1, productKind: 'motion-drama', tier: input.tier, releaseScope: { episodeNumbers, providers },
    work: { code: roots.work.code, title: roots.work.title, description: roots.work.description, genres: [...roots.work.genres] },
    adaptation: { revision: roots.adaptation.revision, targetSpec: structuredClone(roots.adaptation.targetSpec as import('../types').MotionDramaTargetSpecV1), sourceManifestVersion: roots.adaptation.activeSourceManifestVersion, sourceManifestHash: roots.adaptation.activeSourceManifestHash },
    seriesBible: structuredClone(bible.bible), assets: assets.map(portable), episodes: episodes.map(portable), scenes: scenes.map(portable), shots: shots.map(portable),
    promptPacks: verifiedPacks.map(pack => structuredClone(pack) as unknown as Record<string, unknown>), reviewIssues: issues.map(portable),
    verification: { blockers: [], warnings: reports.flatMap(report => report.warnings), reviewedAt: createdAt }, createdAt,
  }
  assertMotionDramaReleaseManifestV1(manifest, roots.work.code)
  const manifestJson = canonicalStringify(manifest); const contentHash = await hashCanonicalValue(manifest)
  const guard = canonicalStringify({ productionRevision: roots.production.revision, episodes: episodes.map(row => [row.stableKey, row.revision]), scenes: scenes.map(row => [row.stableKey, row.revision]), shots: shots.map(row => [row.stableKey, row.revision]), packs: latestPacks.map(row => [row.id, row.contentHash]), versions: selectedVersions.map(row => [row.id, row.contentHash]), refs: selectedReferences.map(row => [row.id, row.blobObjectId]) })
  return db.transaction('rw', scopeTransactionTables(db.motionDramaProductions, db.creationReleases, db.creationReleaseAssets, db.motionDramaEpisodes, db.motionDramaScriptScenes, db.motionDramaShots, db.motionDramaPromptPacks, db.motionDramaAssetVersions, db.motionDramaShotReferences, db.mediaBlobObjects), async () => {
    const production = await db.motionDramaProductions.get(roots.production.id)
    const currentGuard = canonicalStringify({ productionRevision: production?.revision, episodes: (await db.motionDramaEpisodes.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => episodeNumbers.includes(row.episodeNumber)).sortBy('episodeNumber')).map(row => [row.stableKey, row.revision]), scenes: (await db.motionDramaScriptScenes.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => episodeNumbers.includes(row.episodeNumber)).sortBy('order')).map(row => [row.stableKey, row.revision]), shots: (await db.motionDramaShots.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => episodeNumbers.includes(row.episodeNumber)).sortBy('order')).map(row => [row.stableKey, row.revision]), packs: latestPacks.map(row => [row.id, row.contentHash]), versions: selectedVersions.map(row => [row.id, row.contentHash]), refs: selectedReferences.map(row => [row.id, row.blobObjectId]) })
    if (!production || currentGuard !== guard) throw new Error('[motion-drama-release] 发布 CAS 失败：生产内容已变化')
    const version = (latest?.version ?? 0) + 1
    const row: CreationReleaseV1 = { projectId: roots.scope.projectId, worldId: roots.scope.worldId, workId: roots.scope.workId, productKind: 'motion-drama', version, label: input.label?.trim() || `${roots.work.title} 漫剧前期包 v${version}`, parentReleaseId: latest?.id ?? null, sourceRevision: production.revision, manifestJson, contentHash, createdAt }
    const id = await db.creationReleases.add(row) as number
    const pins: CreationReleaseAssetV1[] = [
      ...selectedVersions.map(versionRow => stampNewRecord(roots.scope, 'creationReleaseAssets', { projectId: roots.scope.projectId, worldId: roots.scope.worldId, workId: roots.scope.workId, releaseId: id, assetKey: versionRow.stableKey, role: 'motion-subject-reference' as const, pageKey: null, panelKey: null, blobObjectId: versionRow.blobObjectId!, contentHash: blobRows.get(versionRow.blobObjectId!)!.contentHash, referenceAssetKeys: [], createdAt }, { owner: 'work' })),
      ...selectedReferences.map(reference => stampNewRecord(roots.scope, 'creationReleaseAssets', { projectId: roots.scope.projectId, worldId: roots.scope.worldId, workId: roots.scope.workId, releaseId: id, assetKey: reference.stableKey, role: 'motion-shot-reference' as const, pageKey: null, panelKey: reference.shotKey, blobObjectId: reference.blobObjectId!, contentHash: blobRows.get(reference.blobObjectId!)!.contentHash, referenceAssetKeys: [], createdAt }, { owner: 'work' })),
    ]
    if (pins.length) await db.creationReleaseAssets.bulkAdd(pins)
    await db.motionDramaProductions.update(production.id!, { currentReleaseId: id, phase: 'release-ready', revision: production.revision + 1, updatedAt: createdAt })
    return { ...row, id }
  })
}

export async function listMotionDramaReleasesV1(scopeInput: WorkspaceScope): Promise<CreationReleaseV1[]> {
  const scope = await resolveScope({ scope: scopeInput })
  return db.creationReleases.where('[workId+productKind+version]').between([scope.workId, 'motion-drama', 0], [scope.workId, 'motion-drama', Number.MAX_SAFE_INTEGER]).sortBy('version')
}

export async function readMotionDramaReleaseManifestV1(scopeInput: WorkspaceScope, releaseId: number): Promise<MotionDramaReleaseManifestV1> {
  const scope = await resolveScope({ scope: scopeInput }); const [release, work] = await Promise.all([db.creationReleases.get(releaseId), db.works.get(scope.workId)])
  if (!release || release.productKind !== 'motion-drama' || release.projectId !== scope.projectId || release.worldId !== scope.worldId || release.workId !== scope.workId || !work) throw new Error('[motion-drama-release] Release 不存在或越界')
  const manifest = await parseAndVerifyCreationReleaseManifestV1(release, work.code)
  assertMotionDramaReleaseManifestV1(manifest, work.code)
  return manifest
}
