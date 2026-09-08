import Dexie from 'dexie'
import { nanoid } from 'nanoid'
import { db } from '../db/schema'
import { inspectAdaptationFreshness } from '../adaptation/source-manifest'
import { resyncAdaptationSource } from '../adaptation/source-manifest'
import { hashCanonicalValue } from '../agent/run/hash'
import { prepareAudioBlobV1, prepareMediaBlobV1, putPreparedAudioBlobV1, putPreparedMediaBlobV1 } from '../media/blob-store'
import { assertMediaRightsV1 } from '../media/rights'
import type {
  AdaptationProject,
  MediaRightsV1,
  MotionDramaAssetSubjectCandidateV1,
  MotionDramaAssetSubjectV1,
  MotionDramaAssetVersionV1,
  MotionDramaEpisodeCandidateV1,
  MotionDramaEpisodeV1,
  MotionDramaImagePromptCandidateV1,
  MotionDramaProductionPhaseV1,
  MotionDramaProductionV1,
  MotionDramaPromptPackV1,
  MotionDramaPromptStageV1,
  MotionDramaReferenceRoleV1,
  MotionDramaReviewIssueCandidateV1,
  MotionDramaReviewIssueV1,
  MotionDramaScriptSceneCandidateV1,
  MotionDramaScriptSceneV1,
  MotionDramaSeriesBibleRecordV1,
  MotionDramaSeriesBibleV1,
  MotionDramaShotCandidateV1,
  MotionDramaShotReferenceV1,
  MotionDramaShotV1,
  MotionDramaVideoPromptCandidateV1,
  Work,
  WorkspaceScope,
} from '../types'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { parseMotionDramaCandidatePayloadV1 } from './contracts'

export type MotionDramaCandidatePayloadV1 =
  | MotionDramaSeriesBibleV1
  | MotionDramaAssetSubjectCandidateV1[]
  | MotionDramaEpisodeCandidateV1
  | MotionDramaScriptSceneCandidateV1[]
  | MotionDramaShotCandidateV1[]
  | MotionDramaImagePromptCandidateV1[]
  | MotionDramaVideoPromptCandidateV1[]
  | MotionDramaReviewIssueCandidateV1[]

export interface MotionDramaStudioSnapshotV1 {
  scope: WorkspaceScope
  adaptation: AdaptationProject
  production: MotionDramaProductionV1 & { id: number }
  work: Work
  sourceWork: Work | null
  seriesBibleRecord: MotionDramaSeriesBibleRecordV1 | null
  episodes: MotionDramaEpisodeV1[]
  scenes: MotionDramaScriptSceneV1[]
  assets: MotionDramaAssetSubjectV1[]
  assetVersions: MotionDramaAssetVersionV1[]
  shots: MotionDramaShotV1[]
  shotReferences: MotionDramaShotReferenceV1[]
  promptPacks: MotionDramaPromptPackV1[]
  reviewIssues: MotionDramaReviewIssueV1[]
  sourceFreshness: Awaited<ReturnType<typeof inspectAdaptationFreshness>>
}

export async function requireMotionDramaRootsV1(scopeInput: WorkspaceScope, requireFresh = false): Promise<{ scope: WorkspaceScope; adaptation: AdaptationProject & { id: number }; production: MotionDramaProductionV1 & { id: number }; work: Work }> {
  const scope = await resolveScope({ scope: scopeInput })
  const [adaptation, production, work] = await Promise.all([
    db.adaptationProjects.where('workId').equals(scope.workId).first(),
    db.motionDramaProductions.where('workId').equals(scope.workId).first(),
    db.works.get(scope.workId),
  ])
  if (!adaptation?.id || adaptation.medium !== 'motion-drama' || !production?.id || !work
    || adaptation.projectId !== scope.projectId || adaptation.worldId !== scope.worldId
    || production.adaptationProjectId !== adaptation.id || production.projectId !== scope.projectId || production.worldId !== scope.worldId) {
    throw new Error('[motion-drama] 漫剧生产根不存在或越过当前 Work')
  }
  if (requireFresh && (await inspectAdaptationFreshness(adaptation.id)).status !== 'unchanged') throw new Error('[motion-drama] 冻结小说来源已变化，请先显式同步或继续使用当前快照')
  return { scope, adaptation: adaptation as AdaptationProject & { id: number }, production: production as MotionDramaProductionV1 & { id: number }, work }
}

export async function loadMotionDramaStudioV1(scopeInput: WorkspaceScope): Promise<MotionDramaStudioSnapshotV1> {
  const roots = await requireMotionDramaRootsV1(scopeInput)
  const adaptationId = roots.adaptation.id
  const [sourceWork, bibles, episodes, scenes, assets, assetVersions, shots, shotReferences, promptPacks, reviewIssues, sourceFreshness] = await Promise.all([
    roots.adaptation.sourceWorkId == null ? null : db.works.get(roots.adaptation.sourceWorkId),
    db.motionDramaSeriesBibles.where('adaptationProjectId').equals(adaptationId).sortBy('version'),
    db.motionDramaEpisodes.where('adaptationProjectId').equals(adaptationId).sortBy('episodeNumber'),
    db.motionDramaScriptScenes.where('adaptationProjectId').equals(adaptationId).sortBy('order'),
    db.motionDramaAssetSubjects.where('adaptationProjectId').equals(adaptationId).sortBy('stableKey'),
    db.motionDramaAssetVersions.where('adaptationProjectId').equals(adaptationId).sortBy('createdAt'),
    db.motionDramaShots.where('adaptationProjectId').equals(adaptationId).sortBy('order'),
    db.motionDramaShotReferences.where('adaptationProjectId').equals(adaptationId).sortBy('createdAt'),
    db.motionDramaPromptPacks.where('adaptationProjectId').equals(adaptationId).sortBy('createdAt'),
    db.motionDramaReviewIssues.where('adaptationProjectId').equals(adaptationId).sortBy('createdAt'),
    inspectAdaptationFreshness(adaptationId),
  ])
  const active = roots.production.activeSeriesBibleVersion
  return { ...roots, sourceWork: sourceWork ?? null, seriesBibleRecord: bibles.find(row => row.version === active) ?? null, episodes, scenes, assets, assetVersions, shots, shotReferences, promptPacks, reviewIssues, sourceFreshness }
}

function nextPhase(stage: MotionDramaPromptStageV1, issues: MotionDramaReviewIssueCandidateV1[] = []): MotionDramaProductionPhaseV1 {
  if (stage === 'series-bible') return 'asset-bible'
  if (stage === 'asset-bible') return 'episode-outline'
  if (stage === 'episode-outline') return 'script'
  if (stage === 'episode-script') return 'storyboard'
  if (stage === 'shot-design' || stage === 'image-prompts') return 'prompt-pack'
  if (stage === 'video-prompts') return 'review'
  return issues.some(issue => issue.severity === 'critical') ? 'review' : 'release-ready'
}

async function assertSourceKeys(adaptationId: number, manifestVersion: number, sourceKeys: string[]): Promise<void> {
  const valid = new Set((await db.adaptationSourceUnits.where('[adaptationProjectId+manifestVersion]').equals([adaptationId, manifestVersion]).toArray()).map(row => row.sourceUnitKey))
  if (!sourceKeys.length || sourceKeys.some(key => !valid.has(key))) throw new Error('[motion-drama] 候选引用了当前冻结来源之外的 sourceUnitKey')
}

function allSourceKeys(stage: MotionDramaPromptStageV1, payload: MotionDramaCandidatePayloadV1): string[] {
  if (stage === 'series-bible' || stage === 'image-prompts' || stage === 'video-prompts' || stage === 'quality-review') return []
  if (stage === 'episode-outline') return [...new Set((payload as MotionDramaEpisodeCandidateV1).sourceUnitKeys.concat((payload as MotionDramaEpisodeCandidateV1).beats.flatMap(beat => beat.sourceUnitKeys)))]
  return [...new Set((payload as Array<{ sourceUnitKeys: string[] }>).flatMap(row => row.sourceUnitKeys))]
}

export async function setCurrentMotionDramaEpisodeV1(input: { scope: WorkspaceScope; episodeNumber: number; expectedRevision?: number }): Promise<void> {
  if (!Number.isInteger(input.episodeNumber) || input.episodeNumber < 1 || input.episodeNumber > 200) throw new Error('[motion-drama] 集号非法')
  const roots = await requireMotionDramaRootsV1(input.scope)
  const targetSpec = roots.adaptation.targetSpec as import('../types').MotionDramaTargetSpecV1
  if (input.episodeNumber > targetSpec.episodeCount) throw new Error('[motion-drama] 集号超过目标总集数')
  if (input.expectedRevision != null && roots.production.revision !== input.expectedRevision) throw new Error('[motion-drama] 生产根已变化，请刷新')
  await db.motionDramaProductions.update(roots.production.id, { currentEpisodeNumber: input.episodeNumber, revision: roots.production.revision + 1, updatedAt: Date.now() })
}

async function clearEpisodeDownstream(adaptationId: number, episodeNumber: number, from: 'outline' | 'script' | 'shots'): Promise<void> {
  const scenes = await db.motionDramaScriptScenes.where('adaptationProjectId').equals(adaptationId).filter(row => row.episodeNumber === episodeNumber).toArray()
  const shots = await db.motionDramaShots.where('adaptationProjectId').equals(adaptationId).filter(row => row.episodeNumber === episodeNumber).toArray()
  const shotKeys = shots.map(row => row.stableKey)
  if (from === 'outline' || from === 'script') await db.motionDramaScriptScenes.bulkDelete(scenes.flatMap(row => row.id == null ? [] : [row.id]))
  if (from !== 'shots' || shots.length) await db.motionDramaShots.bulkDelete(shots.flatMap(row => row.id == null ? [] : [row.id]))
  if (shotKeys.length) {
    const refs = await db.motionDramaShotReferences.where('adaptationProjectId').equals(adaptationId).filter(row => shotKeys.includes(row.shotKey)).toArray()
    await db.motionDramaShotReferences.bulkDelete(refs.flatMap(row => row.id == null ? [] : [row.id]))
  }
  const [packs, issues] = await Promise.all([
    db.motionDramaPromptPacks.where('adaptationProjectId').equals(adaptationId).filter(row => row.episodeNumber === episodeNumber).toArray(),
    db.motionDramaReviewIssues.where('adaptationProjectId').equals(adaptationId).filter(row => row.episodeNumber === episodeNumber).toArray(),
  ])
  await db.motionDramaPromptPacks.bulkDelete(packs.flatMap(row => row.id == null ? [] : [row.id]))
  await db.motionDramaReviewIssues.bulkDelete(issues.flatMap(row => row.id == null ? [] : [row.id]))
}

/** The only formal author-confirmed write boundary for all eight AI stages. */
export async function adoptMotionDramaCandidateV1(input: { scope: WorkspaceScope; stage: MotionDramaPromptStageV1; payload: unknown; expectedAdaptationRevision: number; expectedProductionRevision: number; episodeNumber: number }): Promise<void> {
  const parsed = parseMotionDramaCandidatePayloadV1(input.stage, input.payload) as MotionDramaCandidatePayloadV1
  const roots = await requireMotionDramaRootsV1(input.scope, true)
  if (roots.adaptation.sourceCoverage !== 'full-text') throw new Error('[motion-drama] 请先完成小说正文并显式同步完整来源，不能从一句话或空大纲直接跳过小说')
  if (roots.adaptation.revision !== input.expectedAdaptationRevision || roots.production.revision !== input.expectedProductionRevision) throw new Error('[motion-drama] 候选已过期，请基于最新内容重新生成')
  if (input.episodeNumber !== roots.production.currentEpisodeNumber) throw new Error('[motion-drama] 当前集已切换，候选 stale')
  if (input.stage === 'episode-outline' && (parsed as MotionDramaEpisodeCandidateV1).episodeNumber !== input.episodeNumber) throw new Error('[motion-drama] 候选集号与当前集不一致')
  const sourceKeys = allSourceKeys(input.stage, parsed)
  if (sourceKeys.length) await assertSourceKeys(roots.adaptation.id, roots.adaptation.activeSourceManifestVersion, sourceKeys)
  const now = Date.now()
  const assetPrepared = input.stage === 'asset-bible'
    ? await Promise.all((parsed as MotionDramaAssetSubjectCandidateV1[]).map(async candidate => ({ candidate, contentHash: await hashCanonicalValue({ prompt: candidate.basePrompt, negativePrompt: candidate.negativePrompt, referenceBrief: candidate.referenceBrief }) })))
    : []
  await db.transaction('rw', scopeTransactionTables(
    db.adaptationProjects, db.motionDramaProductions, db.motionDramaSeriesBibles, db.motionDramaEpisodes,
    db.motionDramaScriptScenes, db.motionDramaAssetSubjects, db.motionDramaAssetVersions, db.motionDramaShots,
    db.motionDramaShotReferences, db.motionDramaPromptPacks, db.motionDramaReviewIssues,
  ), async () => {
    const [adaptation, production] = await Promise.all([db.adaptationProjects.get(roots.adaptation.id), db.motionDramaProductions.get(roots.production.id)])
    if (!adaptation || !production || adaptation.revision !== input.expectedAdaptationRevision || production.revision !== input.expectedProductionRevision || production.currentEpisodeNumber !== input.episodeNumber) throw new Error('[motion-drama] 采纳 CAS 失败：生产内容已变化')
    const scope = roots.scope
    if (input.stage === 'series-bible') {
      const latest = await db.motionDramaSeriesBibles.where('adaptationProjectId').equals(adaptation.id!).last()
      const version = (latest?.version ?? 0) + 1
      const bible = structuredClone(parsed as MotionDramaSeriesBibleV1)
      const row: MotionDramaSeriesBibleRecordV1 = stampNewRecord(scope, 'motionDramaSeriesBibles', { projectId: scope.projectId, workId: scope.workId, adaptationProjectId: adaptation.id!, version, sourceManifestVersion: adaptation.activeSourceManifestVersion, bible, contentHash: await Dexie.waitFor(hashCanonicalValue(bible)), createdAt: now }, { owner: 'work' })
      await db.motionDramaSeriesBibles.add(row)
      await db.motionDramaProductions.update(production.id!, { activeSeriesBibleVersion: version })
    } else if (input.stage === 'asset-bible') {
      for (const prepared of assetPrepared) {
        const candidate = prepared.candidate
        const existing = await db.motionDramaAssetSubjects.where('adaptationProjectId').equals(adaptation.id!).filter(row => row.stableKey === candidate.stableKey).first()
        const subject: MotionDramaAssetSubjectV1 = stampNewRecord(scope, 'motionDramaAssetSubjects', {
          ...(existing?.id ? { id: existing.id } : {}), projectId: scope.projectId, workId: scope.workId, adaptationProjectId: adaptation.id!, manifestVersion: adaptation.activeSourceManifestVersion,
          ...structuredClone(candidate), selectedVersionKey: existing?.selectedVersionKey ?? null, authorStatus: 'confirmed', revision: (existing?.revision ?? 0) + 1,
          createdAt: existing?.createdAt ?? now, updatedAt: now,
        }, { owner: 'work' })
        await db.motionDramaAssetSubjects.put(subject)
        const versions = await db.motionDramaAssetVersions.where('adaptationProjectId').equals(adaptation.id!).filter(row => row.subjectKey === candidate.stableKey).toArray()
        if (!versions.some(row => row.contentHash === prepared.contentHash)) {
          const version = Math.max(0, ...versions.map(row => row.version)) + 1
          const stableKey = `${candidate.stableKey}.v${version}`
          const versionRow: MotionDramaAssetVersionV1 = stampNewRecord(scope, 'motionDramaAssetVersions', { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, adaptationProjectId: adaptation.id!, subjectKey: candidate.stableKey, stableKey, version, prompt: candidate.basePrompt, negativePrompt: candidate.negativePrompt, referenceNotes: candidate.referenceBrief, blobObjectId: null, origin: 'prompt-only', provider: null, model: null, rights: null, contentHash: prepared.contentHash, createdAt: now, updatedAt: now }, { owner: 'work' })
          await db.motionDramaAssetVersions.add(versionRow)
        }
      }
    } else if (input.stage === 'episode-outline') {
      const candidate = parsed as MotionDramaEpisodeCandidateV1
      const existing = await db.motionDramaEpisodes.where('adaptationProjectId').equals(adaptation.id!).filter(row => row.episodeNumber === candidate.episodeNumber).first()
      await clearEpisodeDownstream(adaptation.id!, candidate.episodeNumber, 'outline')
      const row: MotionDramaEpisodeV1 = stampNewRecord(scope, 'motionDramaEpisodes', { ...(existing?.id ? { id: existing.id } : {}), projectId: scope.projectId, workId: scope.workId, adaptationProjectId: adaptation.id!, manifestVersion: adaptation.activeSourceManifestVersion, ...structuredClone(candidate), authorStatus: 'confirmed', revision: (existing?.revision ?? 0) + 1, createdAt: existing?.createdAt ?? now, updatedAt: now }, { owner: 'work' })
      await db.motionDramaEpisodes.put(row)
    } else if (input.stage === 'episode-script') {
      const scenes = parsed as MotionDramaScriptSceneCandidateV1[]
      if (scenes.some(row => row.episodeNumber !== input.episodeNumber)) throw new Error('[motion-drama] 剧本候选混入其他集')
      await clearEpisodeDownstream(adaptation.id!, input.episodeNumber, 'script')
      await db.motionDramaScriptScenes.bulkAdd(scenes.map(candidate => stampNewRecord(scope, 'motionDramaScriptScenes', { projectId: scope.projectId, workId: scope.workId, adaptationProjectId: adaptation.id!, manifestVersion: adaptation.activeSourceManifestVersion, ...structuredClone(candidate), authorStatus: 'confirmed' as const, revision: 1, createdAt: now, updatedAt: now }, { owner: 'work' })))
    } else if (input.stage === 'shot-design') {
      const shots = parsed as MotionDramaShotCandidateV1[]
      if (shots.some(row => row.episodeNumber !== input.episodeNumber)) throw new Error('[motion-drama] 分镜候选混入其他集')
      const validScenes = new Set((await db.motionDramaScriptScenes.where('adaptationProjectId').equals(adaptation.id!).filter(row => row.episodeNumber === input.episodeNumber).toArray()).map(row => row.stableKey))
      if (shots.some(row => !validScenes.has(row.sceneKey))) throw new Error('[motion-drama] 分镜引用了当前集之外的场景')
      await clearEpisodeDownstream(adaptation.id!, input.episodeNumber, 'shots')
      await db.motionDramaShots.bulkAdd(shots.map(candidate => stampNewRecord(scope, 'motionDramaShots', { projectId: scope.projectId, workId: scope.workId, adaptationProjectId: adaptation.id!, manifestVersion: adaptation.activeSourceManifestVersion, ...structuredClone(candidate), authorStatus: 'confirmed' as const, revision: 1, createdAt: now, updatedAt: now }, { owner: 'work' })))
    } else if (input.stage === 'image-prompts' || input.stage === 'video-prompts') {
      const candidates = parsed as Array<MotionDramaImagePromptCandidateV1 | MotionDramaVideoPromptCandidateV1>
      const shots = await db.motionDramaShots.where('adaptationProjectId').equals(adaptation.id!).filter(row => row.episodeNumber === input.episodeNumber).toArray()
      if (candidates.length !== shots.length) throw new Error('[motion-drama] Prompt IR 必须完整覆盖当前集全部镜头')
      const byKey = new Map(shots.map(row => [row.stableKey, row]))
      for (const candidate of candidates) {
        const shot = byKey.get(candidate.shotKey)
        if (!shot || shot.revision !== candidate.expectedRevision) throw new Error(`[motion-drama] 镜头 ${candidate.shotKey} 已变化`)
        if (input.stage === 'image-prompts') {
          const image = candidate as MotionDramaImagePromptCandidateV1
          await db.motionDramaShots.update(shot.id!, { imagePrompt: image.imagePrompt, negativeImagePrompt: image.negativeImagePrompt, firstFramePrompt: image.firstFramePrompt, keyFramePrompt: image.keyFramePrompt, lastFramePrompt: image.lastFramePrompt, revision: shot.revision + 1, updatedAt: now })
        } else {
          const video = candidate as MotionDramaVideoPromptCandidateV1
          await db.motionDramaShots.update(shot.id!, { videoPrompt: video.videoPrompt, negativeVideoPrompt: video.negativeVideoPrompt, revision: shot.revision + 1, updatedAt: now })
        }
      }
      const packs = await db.motionDramaPromptPacks.where('adaptationProjectId').equals(adaptation.id!).filter(row => row.episodeNumber === input.episodeNumber).toArray()
      await db.motionDramaPromptPacks.bulkDelete(packs.flatMap(row => row.id == null ? [] : [row.id]))
    } else {
      const issues = parsed as MotionDramaReviewIssueCandidateV1[]
      if (issues.some(row => row.episodeNumber !== input.episodeNumber)) throw new Error('[motion-drama] 审查候选混入其他集')
      const previous = await db.motionDramaReviewIssues.where('adaptationProjectId').equals(adaptation.id!).filter(row => row.episodeNumber === input.episodeNumber).toArray()
      await db.motionDramaReviewIssues.bulkDelete(previous.flatMap(row => row.id == null ? [] : [row.id]))
      if (issues.length) await db.motionDramaReviewIssues.bulkAdd(issues.map(candidate => stampNewRecord(scope, 'motionDramaReviewIssues', { projectId: scope.projectId, workId: scope.workId, adaptationProjectId: adaptation.id!, manifestVersion: adaptation.activeSourceManifestVersion, ...structuredClone(candidate), status: 'open' as const, reviewedRevision: production.revision, createdAt: now, updatedAt: now }, { owner: 'work' })))
    }
    await db.motionDramaProductions.update(production.id!, { phase: nextPhase(input.stage, input.stage === 'quality-review' ? parsed as MotionDramaReviewIssueCandidateV1[] : []), revision: production.revision + 1, updatedAt: now })
  })
}

export async function updateMotionDramaReviewIssueStatusV1(input: { scope: WorkspaceScope; issueId: number; status: 'resolved' | 'dismissed'; expectedProductionRevision: number }): Promise<void> {
  const roots = await requireMotionDramaRootsV1(input.scope)
  const issue = await db.motionDramaReviewIssues.get(input.issueId)
  if (!issue || issue.adaptationProjectId !== roots.adaptation.id || issue.workId !== roots.scope.workId || roots.production.revision !== input.expectedProductionRevision) throw new Error('[motion-drama] 问题不存在、越界或生产内容已变化')
  await db.transaction('rw', scopeTransactionTables(db.motionDramaReviewIssues, db.motionDramaProductions), async () => {
    const production = await db.motionDramaProductions.get(roots.production.id)
    if (!production || production.revision !== input.expectedProductionRevision) throw new Error('[motion-drama] 问题处理 CAS 失败')
    const now = Date.now()
    await db.motionDramaReviewIssues.update(input.issueId, { status: input.status, updatedAt: now })
    await db.motionDramaProductions.update(production.id!, { revision: production.revision + 1, updatedAt: now })
  })
}

export async function commitMotionDramaAssetReferenceV1(input: { scope: WorkspaceScope; subjectKey: string; data: ArrayBuffer; rights: MediaRightsV1; note?: string }): Promise<MotionDramaAssetVersionV1 & { id: number }> {
  assertMediaRightsV1(input.rights)
  if (input.rights.source !== 'author-upload') throw new Error('[motion-drama-media] 上传参考素材必须声明 author-upload')
  const roots = await requireMotionDramaRootsV1(input.scope, true)
  const subjectBefore = await db.motionDramaAssetSubjects.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.stableKey === input.subjectKey).first()
  if (!subjectBefore) throw new Error('[motion-drama-media] 物料不存在')
  const audioKind = subjectBefore.kind === 'voice' || subjectBefore.kind === 'sound'
  const prepared = audioKind ? await prepareAudioBlobV1(input.data) : await prepareMediaBlobV1(input.data)
  return db.transaction('rw', scopeTransactionTables(db.motionDramaAssetSubjects, db.motionDramaAssetVersions, db.mediaBlobObjects, db.motionDramaProductions, db.motionDramaPromptPacks), async () => {
    const subject = await db.motionDramaAssetSubjects.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.stableKey === input.subjectKey).first()
    const production = await db.motionDramaProductions.get(roots.production.id)
    if (!subject?.id || !production || production.revision !== roots.production.revision || audioKind !== (subject.kind === 'voice' || subject.kind === 'sound')) throw new Error('[motion-drama-media] 物料不存在、类型或内容已变化')
    const blob = audioKind ? await putPreparedAudioBlobV1(roots.scope, prepared as Awaited<ReturnType<typeof prepareAudioBlobV1>>) : await putPreparedMediaBlobV1(roots.scope, prepared as Awaited<ReturnType<typeof prepareMediaBlobV1>>)
    const versions = await db.motionDramaAssetVersions.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.subjectKey === subject.stableKey).toArray()
    const version = Math.max(0, ...versions.map(row => row.version)) + 1
    const now = Date.now(); const stableKey = `${subject.stableKey}.v${version}`
    const row: MotionDramaAssetVersionV1 = stampNewRecord(roots.scope, 'motionDramaAssetVersions', { projectId: roots.scope.projectId, worldId: roots.scope.worldId, workId: roots.scope.workId, adaptationProjectId: roots.adaptation.id, subjectKey: subject.stableKey, stableKey, version, prompt: subject.basePrompt, negativePrompt: subject.negativePrompt, referenceNotes: input.note?.trim() || subject.referenceBrief, blobObjectId: blob.id, origin: 'author-upload', provider: null, model: null, rights: structuredClone(input.rights), contentHash: blob.contentHash, createdAt: now, updatedAt: now }, { owner: 'work' })
    const id = await db.motionDramaAssetVersions.add(row) as number
    await db.motionDramaAssetSubjects.update(subject.id, { selectedVersionKey: stableKey, revision: subject.revision + 1, updatedAt: now })
    const packs = await db.motionDramaPromptPacks.where('adaptationProjectId').equals(roots.adaptation.id).toArray()
    await db.motionDramaPromptPacks.bulkDelete(packs.flatMap(row => row.id == null ? [] : [row.id]))
    await db.motionDramaProductions.update(production.id!, { revision: production.revision + 1, updatedAt: now })
    return { ...row, id }
  })
}

export async function commitMotionDramaShotReferenceV1(input: { scope: WorkspaceScope; shotKey: string; role: Extract<MotionDramaReferenceRoleV1, 'start-frame' | 'key-frame' | 'end-frame'>; data: ArrayBuffer; rights: MediaRightsV1; note?: string }): Promise<MotionDramaShotReferenceV1 & { id: number }> {
  assertMediaRightsV1(input.rights)
  if (input.rights.source !== 'author-upload') throw new Error('[motion-drama-media] 上传分镜参考必须声明 author-upload')
  const roots = await requireMotionDramaRootsV1(input.scope, true)
  const prepared = await prepareMediaBlobV1(input.data)
  return db.transaction('rw', scopeTransactionTables(db.motionDramaShots, db.motionDramaShotReferences, db.mediaBlobObjects, db.motionDramaProductions, db.motionDramaPromptPacks), async () => {
    const shot = await db.motionDramaShots.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.stableKey === input.shotKey).first()
    const production = await db.motionDramaProductions.get(roots.production.id)
    if (!shot || !production || production.revision !== roots.production.revision) throw new Error('[motion-drama-media] 镜头不存在或内容已变化')
    const blob = await putPreparedMediaBlobV1(roots.scope, prepared)
    const current = await db.motionDramaShotReferences.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.shotKey === shot.stableKey && row.role === input.role && row.selected).toArray()
    for (const row of current) if (row.id) await db.motionDramaShotReferences.update(row.id, { selected: false, updatedAt: Date.now() })
    const now = Date.now(); const stableKey = `${shot.stableKey}.${input.role}.${nanoid(10)}`
    const row: MotionDramaShotReferenceV1 = stampNewRecord(roots.scope, 'motionDramaShotReferences', { projectId: roots.scope.projectId, worldId: roots.scope.worldId, workId: roots.scope.workId, adaptationProjectId: roots.adaptation.id, shotKey: shot.stableKey, stableKey, role: input.role, subjectKey: null, assetVersionId: null, blobObjectId: blob.id, timing: input.role === 'start-frame' ? '0s' : input.role === 'end-frame' ? `${shot.targetSeconds}s` : `${Math.max(1, Math.floor(shot.targetSeconds / 2))}s`, note: input.note?.trim() || '', rights: structuredClone(input.rights), selected: true, createdAt: now, updatedAt: now }, { owner: 'work' })
    const id = await db.motionDramaShotReferences.add(row) as number
    const packs = await db.motionDramaPromptPacks.where('adaptationProjectId').equals(roots.adaptation.id).filter(pack => pack.episodeNumber === shot.episodeNumber).toArray()
    await db.motionDramaPromptPacks.bulkDelete(packs.flatMap(pack => pack.id == null ? [] : [pack.id]))
    await db.motionDramaProductions.update(production.id!, { revision: production.revision + 1, updatedAt: now })
    return { ...row, id }
  })
}

/** Explicit destructive draft reset after the author accepts a newer novel snapshot. Immutable releases remain untouched. */
export async function resyncMotionDramaSourceV1(input: { scope: WorkspaceScope; expectedAdaptationRevision: number; expectedProductionRevision: number }): Promise<void> {
  const roots = await requireMotionDramaRootsV1(input.scope)
  if (roots.adaptation.revision !== input.expectedAdaptationRevision || roots.production.revision !== input.expectedProductionRevision) throw new Error('[motion-drama] 来源同步前内容已变化，请刷新')
  const freshness = await inspectAdaptationFreshness(roots.adaptation.id)
  if (freshness.status !== 'changed') throw new Error('[motion-drama] 当前小说来源没有可同步变化')
  const draftTables = [db.motionDramaSeriesBibles, db.motionDramaEpisodes, db.motionDramaScriptScenes, db.motionDramaAssetSubjects, db.motionDramaAssetVersions, db.motionDramaAssetBindings, db.motionDramaShots, db.motionDramaShotReferences, db.motionDramaPromptPacks, db.motionDramaReviewIssues] as const
  const next = await resyncAdaptationSource({
    adaptationProjectId: roots.adaptation.id,
    expectedRevision: input.expectedAdaptationRevision,
    additionalTransactionTables: [db.motionDramaProductions, ...draftTables],
    beforeSourceCommit: async ({ root }) => {
      const production = await db.motionDramaProductions.get(roots.production.id)
      if (!production || production.revision !== input.expectedProductionRevision || production.adaptationProjectId !== root.id) throw new Error('[motion-drama] 来源同步与草稿重置 CAS 失败')
      for (const table of draftTables) {
        const rows = await table.where('adaptationProjectId').equals(root.id!).toArray() as Array<{ id?: number }>
        await table.bulkDelete(rows.flatMap(row => row.id == null ? [] : [row.id]) as never[])
      }
      await db.motionDramaProductions.update(production.id!, { phase: 'source', activeSeriesBibleVersion: null, revision: production.revision + 1, updatedAt: Date.now() })
    },
  })
  if (next.activeSourceManifestVersion !== roots.adaptation.activeSourceManifestVersion + 1) throw new Error('[motion-drama] 来源同步版本异常')
}
