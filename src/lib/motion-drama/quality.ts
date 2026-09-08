import { db } from '../db/schema'
import type { MotionDramaPromptPackMaturityV1, MotionDramaProviderTargetV1, WorkspaceScope } from '../types'
import { verifyMotionDramaPromptPackV1, inspectMotionDramaPackMaturityV1 } from './prompt-pack'
import { requireMotionDramaRootsV1 } from './service'

export interface MotionDramaQualityReportV1 {
  episodeNumber: number
  ready: boolean
  achievableTier: MotionDramaPromptPackMaturityV1
  blockers: string[]
  warnings: string[]
  metrics: { sceneCount: number; shotCount: number; totalSeconds: number; promptCoverage: number; openCritical: number; openMajor: number; providerPackCount: number }
}

export async function inspectMotionDramaQualityV1(input: { scope: WorkspaceScope; episodeNumber: number; providers?: MotionDramaProviderTargetV1[] }): Promise<MotionDramaQualityReportV1> {
  const roots = await requireMotionDramaRootsV1(input.scope)
  const target = roots.adaptation.targetSpec as import('../types').MotionDramaTargetSpecV1
  const providers = input.providers?.length ? [...new Set(input.providers)] : target.providerTargets
  const [bible, episode, scenes, subjects, versions, shots, references, issues, packs] = await Promise.all([
    roots.production.activeSeriesBibleVersion == null ? null : db.motionDramaSeriesBibles.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.version === roots.production.activeSeriesBibleVersion).first(),
    db.motionDramaEpisodes.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === input.episodeNumber).first(),
    db.motionDramaScriptScenes.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === input.episodeNumber).sortBy('order'),
    db.motionDramaAssetSubjects.where('adaptationProjectId').equals(roots.adaptation.id).toArray(),
    db.motionDramaAssetVersions.where('adaptationProjectId').equals(roots.adaptation.id).toArray(),
    db.motionDramaShots.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === input.episodeNumber).sortBy('order'),
    db.motionDramaShotReferences.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.selected).toArray(),
    db.motionDramaReviewIssues.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === input.episodeNumber && row.status === 'open').toArray(),
    db.motionDramaPromptPacks.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === input.episodeNumber).toArray(),
  ])
  const blockers: string[] = []; const warnings: string[] = []
  const freshness = await (await import('../adaptation/source-manifest')).inspectAdaptationFreshness(roots.adaptation.id)
  if (freshness.status !== 'unchanged') blockers.push('冻结小说来源已变化或缺失')
  if (roots.adaptation.sourceCoverage !== 'full-text') blockers.push('小说正文尚未完成并冻结，不能跳过小说阶段')
  if (!bible) blockers.push('缺少已确认系列圣经')
  if (!subjects.length) blockers.push('缺少已确认物料圣经')
  if (!episode) blockers.push(`第 ${input.episodeNumber} 集缺少已确认节拍`)
  if (!scenes.length) blockers.push(`第 ${input.episodeNumber} 集缺少漫剧剧本场景`)
  if (!shots.length) blockers.push(`第 ${input.episodeNumber} 集缺少分镜`)
  const totalSeconds = shots.reduce((sum, shot) => sum + shot.targetSeconds, 0)
  if (shots.length && (totalSeconds < target.targetSecondsPerEpisode * 0.75 || totalSeconds > target.targetSecondsPerEpisode * 1.25)) blockers.push(`分镜总时长 ${totalSeconds}s 超出目标 ${target.targetSecondsPerEpisode}s 的 ±25%`)
  const prompted = shots.filter(shot => shot.imagePrompt.trim() && shot.firstFramePrompt.trim() && shot.lastFramePrompt.trim() && shot.videoPrompt.trim()).length
  if (shots.length && prompted !== shots.length) blockers.push(`仍有 ${shots.length - prompted} 个镜头缺少完整 Image/Video Prompt IR`)
  const sceneKeys = new Set(scenes.map(scene => scene.stableKey)); const subjectKeys = new Set(subjects.map(subject => subject.stableKey))
  if (shots.some(shot => !sceneKeys.has(shot.sceneKey))) blockers.push('存在引用失效场景的分镜')
  const missingSubjects = [...new Set(shots.flatMap(shot => shot.subjectKeys).filter(key => !subjectKeys.has(key)))]
  if (missingSubjects.length) blockers.push(`分镜引用了未登记物料：${missingSubjects.join('、')}`)
  const openCritical = issues.filter(issue => issue.severity === 'critical').length; const openMajor = issues.filter(issue => issue.severity === 'major').length
  if (openCritical) blockers.push(`仍有 ${openCritical} 个 critical 审查问题`)
  if (openMajor) warnings.push(`仍有 ${openMajor} 个 major 审查问题，建议发布前处理`)
  for (const provider of providers) {
    const latest = packs.filter(pack => pack.provider === provider).sort((a, b) => b.version - a.version)[0]
    if (!latest) blockers.push(`缺少 ${provider} 适配包`)
    else {
      try { await verifyMotionDramaPromptPackV1(latest) } catch { blockers.push(`${provider} 适配包损坏`) }
    }
  }
  const maturity = inspectMotionDramaPackMaturityV1({ subjects, versions, shots, references })
  warnings.push(...maturity.missing)
  return { episodeNumber: input.episodeNumber, ready: blockers.length === 0, achievableTier: maturity.maturity, blockers, warnings, metrics: { sceneCount: scenes.length, shotCount: shots.length, totalSeconds, promptCoverage: shots.length ? prompted / shots.length : 0, openCritical, openMajor, providerPackCount: packs.length } }
}
