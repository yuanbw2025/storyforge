import { assertMotionDramaTargetSpecV1 } from '../adaptation/contracts'
import type { MotionDramaReleaseManifestV1 } from '../types'
import {
  assertMotionDramaAssetSubjectCandidateV1,
  assertMotionDramaEpisodeCandidateV1,
  assertMotionDramaReviewIssueCandidateV1,
  assertMotionDramaScriptSceneCandidateV1,
  assertMotionDramaSeriesBibleV1,
  assertMotionDramaShotCandidateV1,
} from './contracts'
import { assertMotionDramaPromptPackManifest } from './prompt-pack-contracts'

const PROVIDERS = new Set(['seedance', 'runway', 'ltx', 'generic'])

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[motion-drama-release] ${label} 必须是对象`)
  return value as Record<string, any>
}

function array(value: unknown, label: string): Record<string, any>[] {
  if (!Array.isArray(value)) throw new Error(`[motion-drama-release] ${label} 必须是数组`)
  return value.map((item, index) => record(item, `${label}[${index}]`))
}

function select(row: Record<string, any>, fields: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field, structuredClone(row[field])]))
}

const ASSET_FIELDS = ['stableKey', 'kind', 'label', 'identity', 'appearance', 'palette', 'materials', 'continuityLocks', 'prohibitedChanges', 'basePrompt', 'negativePrompt', 'referenceBrief', 'sourceUnitKeys'] as const
const EPISODE_FIELDS = ['stableKey', 'episodeNumber', 'title', 'logline', 'synopsis', 'openingHook', 'beats', 'endHook', 'continuityIn', 'continuityOut', 'sourceUnitKeys'] as const
const SCENE_FIELDS = ['stableKey', 'episodeNumber', 'sceneNumber', 'order', 'heading', 'location', 'timeOfDay', 'dramaticPurpose', 'entryState', 'exitState', 'visibleAction', 'dialogue', 'narration', 'soundCues', 'emotionalTurn', 'estimatedSeconds', 'characterKeys', 'sourceUnitKeys'] as const
const SHOT_FIELDS = ['stableKey', 'episodeNumber', 'sceneKey', 'shotNumber', 'order', 'narrativeFunction', 'targetSeconds', 'shotSize', 'cameraAngle', 'cameraMovement', 'composition', 'visibleAction', 'performance', 'lighting', 'transitionIn', 'transitionOut', 'dialogue', 'narration', 'soundPlan', 'subjectKeys', 'sourceUnitKeys', 'imagePrompt', 'negativeImagePrompt', 'firstFramePrompt', 'keyFramePrompt', 'lastFramePrompt', 'videoPrompt', 'negativeVideoPrompt'] as const
const ISSUE_FIELDS = ['stableKey', 'episodeNumber', 'sceneKey', 'shotKey', 'subjectKey', 'category', 'severity', 'evidence', 'problem', 'suggestion'] as const

/** Deep codec for immutable motion-drama releases; hash verification remains in the shared release contract. */
export function assertMotionDramaReleaseManifestV1(value: unknown, workCode: string): asserts value is MotionDramaReleaseManifestV1 {
  const manifest = record(value, 'manifest')
  if (manifest.schema !== 'storyforge.motion-drama-release' || manifest.version !== 1 || manifest.productKind !== 'motion-drama') throw new Error('[motion-drama-release] manifest 身份无效')
  if (!['prompt-only', 'reference-ready'].includes(manifest.tier)) throw new Error('[motion-drama-release] 发布层级无效')
  const work = record(manifest.work, 'work')
  if (work.code !== workCode || typeof work.title !== 'string' || !work.title.trim() || !Array.isArray(work.genres)) throw new Error('[motion-drama-release] Work 身份无效')
  const adaptation = record(manifest.adaptation, 'adaptation')
  if (!Number.isInteger(adaptation.revision) || adaptation.revision < 1 || !Number.isInteger(adaptation.sourceManifestVersion) || adaptation.sourceManifestVersion < 1 || !/^[a-f0-9]{64}$/i.test(String(adaptation.sourceManifestHash ?? ''))) throw new Error('[motion-drama-release] 改编来源证据无效')
  assertMotionDramaTargetSpecV1(adaptation.targetSpec)
  assertMotionDramaSeriesBibleV1(manifest.seriesBible)
  const releaseScope = record(manifest.releaseScope, 'releaseScope')
  if (!Array.isArray(releaseScope.episodeNumbers) || !releaseScope.episodeNumbers.length || releaseScope.episodeNumbers.some((item: unknown) => !Number.isInteger(item) || Number(item) < 1) || new Set(releaseScope.episodeNumbers).size !== releaseScope.episodeNumbers.length) throw new Error('[motion-drama-release] 发布集范围无效')
  if (!Array.isArray(releaseScope.providers) || !releaseScope.providers.length || releaseScope.providers.some((item: unknown) => !PROVIDERS.has(String(item))) || new Set(releaseScope.providers).size !== releaseScope.providers.length) throw new Error('[motion-drama-release] 发布工具范围无效')

  const assets = array(manifest.assets, 'assets'); const assetKeys = new Set<string>()
  for (const row of assets) {
    assertMotionDramaAssetSubjectCandidateV1(select(row, ASSET_FIELDS))
    if (assetKeys.has(row.stableKey)) throw new Error('[motion-drama-release] 物料 stableKey 重复')
    assetKeys.add(row.stableKey)
  }
  const episodes = array(manifest.episodes, 'episodes'); const episodeNumbers = new Set<number>()
  for (const row of episodes) {
    assertMotionDramaEpisodeCandidateV1(select(row, EPISODE_FIELDS))
    if (!releaseScope.episodeNumbers.includes(row.episodeNumber) || episodeNumbers.has(row.episodeNumber)) throw new Error('[motion-drama-release] 分集身份重复或越界')
    episodeNumbers.add(row.episodeNumber)
  }
  if (releaseScope.episodeNumbers.some((item: number) => !episodeNumbers.has(item))) throw new Error('[motion-drama-release] 发布范围缺少分集')

  const scenes = array(manifest.scenes, 'scenes'); const sceneKeys = new Set<string>()
  for (const row of scenes) {
    assertMotionDramaScriptSceneCandidateV1(select(row, SCENE_FIELDS))
    if (!episodeNumbers.has(row.episodeNumber) || sceneKeys.has(row.stableKey)) throw new Error('[motion-drama-release] 场景身份重复或越界')
    sceneKeys.add(row.stableKey)
  }
  const shots = array(manifest.shots, 'shots'); const shotKeys = new Set<string>()
  for (const row of shots) {
    assertMotionDramaShotCandidateV1(select(row, SHOT_FIELDS))
    if (!episodeNumbers.has(row.episodeNumber) || !sceneKeys.has(row.sceneKey) || shotKeys.has(row.stableKey) || row.subjectKeys.some((key: string) => !assetKeys.has(key))) throw new Error('[motion-drama-release] 镜头身份、场景或物料引用无效')
    if (![row.imagePrompt, row.firstFramePrompt, row.keyFramePrompt, row.lastFramePrompt, row.videoPrompt].every((item: unknown) => typeof item === 'string' && item.trim())) throw new Error('[motion-drama-release] 镜头 Prompt IR 不完整')
    shotKeys.add(row.stableKey)
  }

  const issues = array(manifest.reviewIssues, 'reviewIssues'); const issueKeys = new Set<string>()
  for (const row of issues) {
    assertMotionDramaReviewIssueCandidateV1(select(row, ISSUE_FIELDS))
    if (!episodeNumbers.has(row.episodeNumber) || issueKeys.has(row.stableKey) || row.sceneKey != null && !sceneKeys.has(row.sceneKey) || row.shotKey != null && !shotKeys.has(row.shotKey) || row.subjectKey != null && !assetKeys.has(row.subjectKey)) throw new Error('[motion-drama-release] 审查问题身份或定位引用无效')
    issueKeys.add(row.stableKey)
  }

  const packs = array(manifest.promptPacks, 'promptPacks'); const packPairs = new Set<string>()
  for (const pack of packs) {
    assertMotionDramaPromptPackManifest(pack)
    if (pack.schema !== 'storyforge.motion-drama-prompt-pack' || ![1, 2].includes(pack.version) || !PROVIDERS.has(pack.provider) || !episodeNumbers.has(pack.episodeNumber) || !['prompt-only', 'reference-ready'].includes(pack.maturity) || !Array.isArray(pack.shots)) throw new Error('[motion-drama-release] Prompt Pack 身份无效')
    const pair = `${pack.episodeNumber}:${pack.provider}`
    if (packPairs.has(pair) || pack.shots.length !== shots.filter(shot => shot.episodeNumber === pack.episodeNumber).length || pack.shots.some((shot: any) => !shotKeys.has(shot.shotKey) || typeof shot.providerPrompt !== 'string' || !shot.providerPrompt.trim())) throw new Error('[motion-drama-release] Prompt Pack 覆盖、镜头或工具提示词无效')
    packPairs.add(pair)
  }
  for (const episodeNumber of releaseScope.episodeNumbers) for (const provider of releaseScope.providers) if (!packPairs.has(`${episodeNumber}:${provider}`)) throw new Error('[motion-drama-release] 发布范围缺少 Prompt Pack')
  const verification = record(manifest.verification, 'verification')
  if (!Array.isArray(verification.blockers) || verification.blockers.length || !Array.isArray(verification.warnings) || !Number.isInteger(verification.reviewedAt) || verification.reviewedAt < 1 || !Number.isInteger(manifest.createdAt) || manifest.createdAt < 1) throw new Error('[motion-drama-release] 发布验收证据无效')
}
