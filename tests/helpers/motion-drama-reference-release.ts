import { compileMotionDramaPromptPackV1, verifyMotionDramaPromptPackV1 } from '../../src/lib/motion-drama/prompt-pack'
import { publishMotionDramaReleaseV1, readMotionDramaReleaseManifestV1 } from '../../src/lib/motion-drama/release'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { createAdaptation, listActiveSourceUnits } from '../../src/lib/adaptation/source-manifest'
import { adoptMotionDramaCandidateV1, loadMotionDramaStudioV1, commitMotionDramaAssetReferenceV1, commitMotionDramaShotReferenceV1 } from '../../src/lib/motion-drama/service'
import type { Chapter, MotionDramaPromptStageV1, MotionDramaShotCandidateV1, MotionDramaTargetSpecV1, MediaRightsV1 } from '../../src/lib/types'

const targetSpec: MotionDramaTargetSpecV1 = {
  format: 'motion-drama', language: 'zh-CN', episodeCount: 3, targetSecondsPerEpisode: 20,
  aspectRatio: '9:16', narrativeMode: 'animated-comic', audience: '悬疑观众', rating: 'PG-13',
  dialogueDensity: 'balanced', artDirection: '雨夜站台', providerTargets: ['seedance'],
}

async function buildReferenceDraft() {
  const source = await createWorkspace({ name: 'IR事务隔离', genres: ['suspense'], status: 'drafting', description: '', targetWordCount: 8000 }, { kind: 'novel', novelProfile: 'short' })
  const chapter = (await readOwnedRows<Chapter>(source.scope, 'chapters', { owner: 'work' }))[0]
  if (!chapter?.id) throw new Error('Missing source chapter')
  await db.chapters.update(chapter.id, { content: '<p>林岚走到站台，检票钳忽然合拢。</p>' })
  const created = await createAdaptation({ sourceScope: source.scope, sourceWorkId: source.scope.workId, title: 'IR事务漫剧', sourceSelection: { mode: 'entire-work' }, medium: 'motion-drama', targetSpec })
  const unit = (await listActiveSourceUnits(created.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
  const adopt = async (stage: MotionDramaPromptStageV1, payload: unknown) => {
    const snapshot = await loadMotionDramaStudioV1(created.scope)
    return adoptMotionDramaCandidateV1({ scope: created.scope, stage, payload, episodeNumber: 1,
      expectedAdaptationRevision: snapshot.adaptation.revision, expectedProductionRevision: snapshot.production.revision })
  }
  await adopt('series-bible', { version: 1, titlePromise: '末班车回声', logline: '林岚发现异常车票', coreTheme: '面对失去', emotionalPromise: '悬疑',
    audiencePromise: '逐步揭谜', storyEngine: '车票触发回声', worldRules: ['回声在夜间出现'], seasonArc: '接受告别', protagonistArc: '承认失去',
    relationshipArcs: ['找回与妹妹的联系'], episodeArchitecture: '异常、选择、钩子', hookPatterns: ['物件异常'], visualLanguage: ['冷光'], soundLanguage: ['钳子声'],
    continuityRules: ['持钳手固定'], productionConstraints: ['单场景'] })
  await adopt('asset-bible', [{ stableKey: 'prop.punch', kind: 'prop', label: '检票钳', identity: '银色检票钳', appearance: '磨损金属',
    palette: ['银色'], materials: ['金属'], continuityLocks: ['银色'], prohibitedChanges: ['变色'], basePrompt: '银色检票钳', negativePrompt: '水印', referenceBrief: '近景', sourceUnitKeys: [unit.sourceUnitKey] },
    { stableKey: 'voice.unused', kind: 'voice', label: '未使用广播', identity: '备用音色', appearance: '清晰干声', palette: [], materials: [], continuityLocks: ['同一音色'], prohibitedChanges: ['噪声'],
      basePrompt: '平静广播', negativePrompt: '水印', referenceBrief: '备用试听', sourceUnitKeys: [unit.sourceUnitKey] }])
  await adopt('episode-outline', { stableKey: 'episode.1', episodeNumber: 1, title: '回声', logline: '发现车票', synopsis: '检票钳合拢', openingHook: '异常声音',
    beats: [{ stableKey: 'beat.one', order: 0, function: 'hook', visibleAction: '钳子合拢', conflict: '试图离开', turn: '看到姓名', targetSeconds: 20, sourceUnitKeys: [unit.sourceUnitKey] }],
    endHook: '列车到来', continuityIn: [], continuityOut: ['保留车票'], sourceUnitKeys: [unit.sourceUnitKey] })
  await adopt('episode-script', [{ stableKey: 'scene.one', episodeNumber: 1, sceneNumber: 1, order: 0,
    heading: '内景 站台 夜', location: '站台', timeOfDay: '夜', dramaticPurpose: '启动异常', entryState: '寂静', exitState: '钳子合拢',
    visibleAction: '检票钳合拢', dialogue: [], narration: '', soundCues: [], emotionalTurn: '惊讶', estimatedSeconds: 20,
    characterKeys: [], sourceUnitKeys: [unit.sourceUnitKey] }])
  const shots: MotionDramaShotCandidateV1[] = [0, 1].map(order => ({ stableKey: `shot.${order + 1}`, episodeNumber: 1, shotNumber: order + 1,
    sceneKey: 'scene.one', order, narrativeFunction: '推进异常', targetSeconds: 10, shotSize: 'medium', cameraAngle: 'eye-level', cameraMovement: 'static',
    composition: '居中', visibleAction: '检票钳合拢', performance: '克制', lighting: '冷光', transitionIn: '', transitionOut: '', dialogue: '', narration: '',
    soundPlan: [], subjectKeys: ['prop.punch'], sourceUnitKeys: [unit.sourceUnitKey], imagePrompt: '', negativeImagePrompt: '', firstFramePrompt: '', keyFramePrompt: '', lastFramePrompt: '', videoPrompt: '', negativeVideoPrompt: '' }))
  await adopt('shot-design', shots)
  const snapshot = () => loadMotionDramaStudioV1(created.scope)
  const payload = async (stage: 'image-prompts' | 'video-prompts') => (await snapshot()).shots.map(shot => stage === 'image-prompts'
    ? { shotKey: shot.stableKey, expectedRevision: shot.revision, imagePrompt: '静帧', negativeImagePrompt: '水印', firstFramePrompt: '起始姿态', keyFramePrompt: '动作峰值', lastFramePrompt: '结束姿态' }
    : { shotKey: shot.stableKey, expectedRevision: shot.revision, videoPrompt: '合拢检票钳', negativeVideoPrompt: '身份漂移' })
  return { ...created, adopt, snapshot, payload }
}

export function motionReferencePngBytesV1(): ArrayBuffer {
  return Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAkAAAAQCAYAAADESFVDAAAAFklEQVR4nGNQSJjwnxBmGFU0qog4RQAOMiiAK29a7QAAAABJRU5ErkJggg=='), char => char.charCodeAt(0)).buffer
}

export function motionReferenceWavBytesV1(): ArrayBuffer {
  const buffer = new ArrayBuffer(60), view = new DataView(buffer), bytes = new Uint8Array(buffer)
  const text = (at: number, value: string) => [...value].forEach((char, i) => { bytes[at + i] = char.charCodeAt(0) })
  text(0, 'RIFF'); view.setUint32(4, 52, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 16, true)
  return buffer
}

const rights = (): MediaRightsV1 => ({ version: 1, source: 'author-upload', commercialUse: 'allowed', redistribution: 'allowed', attribution: '', declaration: '隔离合成测试素材', declaredAt: 1 })

export async function createMotionDramaReferenceReleaseFixtureV1(options: { promptOnly?: boolean; unusedVoice?: boolean } = {}) {
  const f = await buildReferenceDraft()
  for (const stage of ['image-prompts', 'video-prompts'] as const) await f.adopt(stage, await f.payload(stage))
  if (!options.promptOnly) {
    await commitMotionDramaAssetReferenceV1({ scope: f.scope, subjectKey: 'prop.punch', data: motionReferencePngBytesV1(), rights: rights() })
    if (options.unusedVoice) await commitMotionDramaAssetReferenceV1({ scope: f.scope, subjectKey: 'voice.unused', data: motionReferenceWavBytesV1(), rights: rights() })
    for (const shot of (await f.snapshot()).shots) await commitMotionDramaShotReferenceV1({ scope: f.scope, shotKey: shot.stableKey, role: 'start-frame', data: motionReferencePngBytesV1(), rights: rights() })
  }
  const studio = await f.snapshot()
  const pack = await compileMotionDramaPromptPackV1({ scope: f.scope, episodeNumber: 1, provider: 'seedance', expectedProductionRevision: studio.production.revision })
  const verifiedPack = await verifyMotionDramaPromptPackV1(pack)
  await f.adopt('quality-review', [])
  const current = await f.snapshot()
  const release = await publishMotionDramaReleaseV1({ scope: f.scope, episodeNumbers: [1], providers: ['seedance'], tier: options.promptOnly ? 'prompt-only' : 'reference-ready', expectedProductionRevision: current.production.revision })
  const manifest = await readMotionDramaReleaseManifestV1(f.scope, release.id)
  const pins = await db.creationReleaseAssets.where('releaseId').equals(release.id).toArray()
  return { ...f, release, manifest, pins, verifiedPack }
}
