import type { Chapter, ChatMessage, MotionDramaSeriesBibleV1, MotionDramaTargetSpecV1 } from '../../src/lib/types'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { db } from '../../src/lib/db/schema'
import { createAdaptation, listActiveSourceUnits } from '../../src/lib/adaptation/source-manifest'
import { defaultComicTargetSpec } from '../../src/lib/comic/authoring'
import { generateComicProfessionalCandidateV1 } from '../../src/lib/comic/durable-production'
import { generateMotionDramaCandidateV1 } from '../../src/lib/motion-drama/durable-production'

export type QualityCreationMedium = 'comic' | 'motion-drama'
export type QualityCreationRunAI = (messages: ChatMessage[]) => Promise<string>

const motionTarget: MotionDramaTargetSpecV1 = {
  format: 'motion-drama', language: 'zh-CN', episodeCount: 12, targetSecondsPerEpisode: 20,
  aspectRatio: '9:16', narrativeMode: 'animated-comic', audience: '成年读者', rating: 'PG-13',
  dialogueDensity: 'balanced', artDirection: '原创测试场景', providerTargets: ['seedance', 'runway', 'ltx'],
}

export const qualityMotionBible: MotionDramaSeriesBibleV1 = {
  version: 1, titlePromise: '最后一张车票通向未完成的告别。', logline: '检票员必须在黎明前辨认一张异常车票。',
  coreTheme: '选择承担真实的代价。', emotionalPromise: '悬疑中的克制希望。', audiencePromise: '每集一个明确选择与后果。',
  storyEngine: '一张车票引出一个具体困境。', worldRules: ['异常仅在末班车之前出现。'],
  seasonArc: '从试图控制结果到承担选择。', protagonistArc: '从逃避转向行动。', relationshipArcs: ['与同伴建立信任。'],
  episodeArchitecture: '异常开场、冲突升级、选择与代价。', hookPatterns: ['异常物件'], visualLanguage: ['雨夜冷暖对照'],
  soundLanguage: ['检票声标记倒计时'], continuityRules: ['主角始终携带银色检票钳。'], productionConstraints: ['单镜头少于十秒。'],
}

export async function createQualityCreationFixture(medium: QualityCreationMedium) {
  const source = await createWorkspace({
    name: '独立创作任务恢复合成来源', description: '只用于隔离数据库回归。', genres: ['other'],
    status: 'drafting', targetWordCount: 8_000,
  }, { kind: 'novel', novelProfile: 'short' })
  const chapter = (await readOwnedRows<Chapter>(source.scope, 'chapters', { owner: 'work' }))[0]
  if (!chapter?.id) throw new Error('合成来源未创建章节')
  await db.chapters.update(chapter.id, {
    content: '<p>雨夜，检票员在封闭站台发现一张没有目的地的车票，并决定留下调查。</p>',
    summary: '原创合成来源：检票员决定调查异常车票。', updatedAt: Date.now(),
  })
  const input = {
    sourceScope: source.scope, sourceWorkId: source.scope.workId, title: `任务恢复 ${medium}`,
    sourceSelection: { mode: 'entire-work' as const },
  }
  const created = medium === 'comic'
    ? await createAdaptation({ ...input, medium: 'comic', targetSpec: { ...defaultComicTargetSpec(), targetPagesPerChapter: 1 } })
    : await createAdaptation({ ...input, medium: 'motion-drama', targetSpec: motionTarget })
  const unit = (await listActiveSourceUnits(created.adaptation.id!)).find(row => row.sourceKind === 'chapter')
  if (!unit) throw new Error('合成改编没有冻结章节来源')
  return { ...created, source, unit }
}

export function generateQualityCreationCandidate(
  medium: QualityCreationMedium,
  item: Awaited<ReturnType<typeof createQualityCreationFixture>>,
  runAI: QualityCreationRunAI,
) {
  return medium === 'comic'
    ? generateComicProfessionalCandidateV1({ scope: item.scope, adaptationProjectId: item.adaptation.id!, stage: 'source-analysis', sourceUnitKeys: [item.unit.sourceUnitKey], runAI })
    : generateMotionDramaCandidateV1({ scope: item.scope, stage: 'series-bible', episodeNumber: 1, runAI })
}
