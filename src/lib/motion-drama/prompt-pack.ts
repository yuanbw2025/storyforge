import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import { readMediaBlobObjectData } from '../product-production/media-blob-store'
import type {
  MotionDramaAssetSubjectV1,
  MotionDramaAssetVersionV1,
  MotionDramaPromptPackMaturityV1,
  MotionDramaPromptPackV1,
  MotionDramaPromptStageV1,
  MotionDramaProviderTargetV1,
  MotionDramaShotReferenceV1,
  MotionDramaShotV1,
  MotionDramaTargetSpecV1,
  WorkspaceScope,
} from '../types'
import { MOTION_DRAMA_PROMPT_STAGES_V1 } from '../types'
import { scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import {
  assertMotionDramaPromptPackManifest,
  type MotionDramaContinuityHandoffV2,
  type MotionDramaPromptPackManifest,
  type MotionDramaPromptPackManifestV2,
  type MotionDramaPromptPackReferenceV1,
  type MotionDramaProviderInputV2,
} from './prompt-pack-contracts'
import { resolveMotionDramaPromptV1 } from './prompts'
import { requireMotionDramaRootsV1 } from './service'

export type { MotionDramaPromptPackManifest, MotionDramaPromptPackManifestV1, MotionDramaPromptPackManifestV2 } from './prompt-pack-contracts'

export const SEEDANCE_PROVIDER_PROFILE_IDS = ['seedance-2.5-2026-07', 'seedance-2.0-2026-02'] as const
export type SeedanceProviderProfileId = typeof SEEDANCE_PROVIDER_PROFILE_IDS[number]

const SEEDANCE_PROFILES: Record<SeedanceProviderProfileId, MotionDramaPromptPackManifestV2['providerProfile']> = {
  'seedance-2.5-2026-07': {
    id: 'seedance-2.5-2026-07',
    label: 'Seedance 2.5 多模态参考',
    verifiedAt: '2026-09-09',
    limits: { maxDurationSeconds: 30, maxImages: 30, maxVideos: 10, maxAudios: 10 },
    supportsTailContinuation: true,
    sourceUrl: 'https://seed.bytedance.com/en/blog/one-take-creation-flexible-referencing-introducing-seedance-2-5',
  },
  'seedance-2.0-2026-02': {
    id: 'seedance-2.0-2026-02',
    label: 'Seedance 2.0 兼容画像',
    verifiedAt: '2026-09-09',
    limits: { maxDurationSeconds: 15, maxImages: 9, maxVideos: 3, maxAudios: 3 },
    supportsTailContinuation: true,
    sourceUrl: 'https://seed.bytedance.com/en/blog/seedance-2-0-official-launch',
  },
}

const PROVIDER_PROFILES: Record<Exclude<MotionDramaProviderTargetV1, 'seedance'>, MotionDramaPromptPackManifestV2['providerProfile']> = {
  runway: {
    id: 'runway-current-interface', label: 'Runway 参考图工作流', verifiedAt: '2026-09-09',
    limits: { maxDurationSeconds: null, maxImages: null, maxVideos: null, maxAudios: null }, supportsTailContinuation: true, sourceUrl: null,
  },
  ltx: {
    id: 'ltx-current-interface', label: 'LTX Elements + Storyboard', verifiedAt: '2026-09-09',
    limits: { maxDurationSeconds: null, maxImages: null, maxVideos: null, maxAudios: null }, supportsTailContinuation: true, sourceUrl: null,
  },
  generic: {
    id: 'provider-neutral-v1', label: '厂商中立逐镜包', verifiedAt: '2026-09-09',
    limits: { maxDurationSeconds: null, maxImages: null, maxVideos: null, maxAudios: null }, supportsTailContinuation: false, sourceUrl: null,
  },
}

function resolveProviderProfile(provider: MotionDramaProviderTargetV1, requested?: string): MotionDramaPromptPackManifestV2['providerProfile'] {
  if (provider !== 'seedance') return PROVIDER_PROFILES[provider]
  const id = requested ?? SEEDANCE_PROVIDER_PROFILE_IDS[0]
  if (!SEEDANCE_PROVIDER_PROFILE_IDS.includes(id as SeedanceProviderProfileId)) throw new Error('[motion-drama-pack] Seedance 能力画像无效')
  return SEEDANCE_PROFILES[id as SeedanceProviderProfileId]
}

function stableKeyTail(stableKey: string): string {
  const segments = stableKey.split('.')
  return (segments[segments.length - 1] || stableKey).toLocaleLowerCase()
}

function voiceMatchesCharacter(voice: MotionDramaAssetSubjectV1, character: MotionDramaAssetSubjectV1): boolean {
  if (stableKeyTail(voice.stableKey) === stableKeyTail(character.stableKey)) return true
  const voiceLabel = voice.label.replace(/(?:角色)?(?:音色|声音|声线|配音)$/u, '').trim()
  const characterLabel = character.label.replace(/角色$/u, '').trim()
  return Boolean(voiceLabel && characterLabel && (voiceLabel === characterLabel || voiceLabel.includes(characterLabel)))
}

function inferredVoiceSubjectKeys(subjects: MotionDramaAssetSubjectV1[], shot: MotionDramaShotV1): string[] {
  if (!shot.dialogue.trim()) return []
  const voices = subjects.filter(subject => subject.kind === 'voice')
  const shotCharacters = subjects.filter(subject => subject.kind === 'character' && shot.subjectKeys.includes(subject.stableKey))
  const namedSpeakers = shotCharacters.filter(character => {
    const escaped = character.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?:^|[\\n；;])\\s*${escaped}\\s*[：:]`, 'u').test(shot.dialogue)
  })
  const speakers = namedSpeakers.length ? namedSpeakers : shotCharacters.length === 1 ? shotCharacters : []
  return unique(speakers.flatMap(character => voices.filter(voice => voiceMatchesCharacter(voice, character)).map(voice => voice.stableKey)))
}

function shotSubjectKeys(subjects: MotionDramaAssetSubjectV1[], shot: MotionDramaShotV1): string[] {
  return unique([
    ...shot.subjectKeys,
    ...inferredVoiceSubjectKeys(subjects, shot),
    ...shot.soundPlan.flatMap(cue => cue.subjectKey ? [cue.subjectKey] : []),
  ])
}

function usedSubjects(subjects: MotionDramaAssetSubjectV1[], shots: MotionDramaShotV1[]): MotionDramaAssetSubjectV1[] {
  const used = new Set(shots.flatMap(shot => shotSubjectKeys(subjects, shot)))
  return subjects.filter(subject => used.has(subject.stableKey))
}

function selectedActualVersion(subject: MotionDramaAssetSubjectV1, versions: MotionDramaAssetVersionV1[]): MotionDramaAssetVersionV1 | null {
  return versions.find(version => version.stableKey === subject.selectedVersionKey && version.blobObjectId != null && version.origin !== 'prompt-only') ?? null
}

function allowed(rights: { commercialUse: string; redistribution: string } | null): boolean {
  return rights?.commercialUse === 'allowed' && rights.redistribution === 'allowed'
}

export function inspectMotionDramaPackMaturityV1(input: { subjects: MotionDramaAssetSubjectV1[]; versions: MotionDramaAssetVersionV1[]; shots: MotionDramaShotV1[]; references: MotionDramaShotReferenceV1[] }): { maturity: MotionDramaPromptPackMaturityV1; missing: string[] } {
  const missing: string[] = []
  for (const subject of usedSubjects(input.subjects, input.shots)) {
    const version = selectedActualVersion(subject, input.versions)
    const mediaLabel = subject.kind === 'voice' || subject.kind === 'sound' ? '试听音频' : '参考图'
    if (!version || !allowed(version.rights)) missing.push(`物料 ${subject.label} 缺少可商用、可再分发的已选${mediaLabel}`)
  }
  for (const shot of input.shots) {
    if (shot.dialogue.trim() && !shotSubjectKeys(input.subjects, shot).some(key => input.subjects.some(subject => subject.stableKey === key && subject.kind === 'voice'))) {
      missing.push(`镜头 ${shot.shotNumber} 有对白但未绑定对应角色的声音物料`)
    }
    const start = input.references.find(reference => reference.shotKey === shot.stableKey && reference.role === 'start-frame' && reference.selected && reference.blobObjectId != null)
    if (!start || !allowed(start.rights)) missing.push(`镜头 ${shot.shotNumber} 缺少可用起始帧`)
  }
  return { maturity: missing.length ? 'prompt-only' : 'reference-ready', missing }
}

function providerNotes(provider: MotionDramaProviderTargetV1, profile: MotionDramaPromptPackManifestV2['providerProfile']): string[] {
  if (provider === 'seedance') return [
    '逐镜单独生成；按每镜 providerInputs 的 uploadOrder 上传，并以“图片N / 音频N”核对用途后再复制 providerPrompt。',
    '每镜先生成多个候选，只选择身份、动作、构图和尾帧都合格的一条；未选定前不要推进下一镜。',
    'tail-frame-chain 镜头应从上一镜已选成片导出末帧，替换当前图片1后再生成，以维持姿态、视线、光线和动作方向。',
    `当前按 ${profile.label} 编译：每次最多 ${profile.limits.maxImages} 图、${profile.limits.maxVideos} 视频、${profile.limits.maxAudios} 音频、${profile.limits.maxDurationSeconds} 秒；实际入口版本不一致时必须切换画像后重新编译。`,
  ]
  if (provider === 'runway') return [
    '先选起始图，再把 providerPrompt 作为运动指令；静态外观尽量由参考图承担。',
    '逐镜生成并先选片，长序列通过已选镜头的最后一帧接续；界面参数以当前 Runway 模型为准。',
  ]
  if (provider === 'ltx') return [
    '将 subject references 建为 Elements，将每个镜头作为 storyboard shot；逐镜检查角色与场景映射。',
    '对白、旁白、环境声和音效按 sound 数组进入音频/时间线环节；具体模型能力以当前 LTX 版本为准。',
  ]
  return ['这是厂商中立包：逐镜复制 image/video IR，并在目标工具中重新核对时长、画幅、参考图和声音能力。']
}

function referencePurpose(reference: MotionDramaPromptPackReferenceV1): string {
  const labels: Record<string, string> = {
    character: '锁定角色身份、脸型、发型与体态', costume: '锁定本镜服装版型、材质与配色', location: '锁定场景结构、空间方位与光源',
    prop: '锁定剧情道具外形、尺度与持有关系', style: '锁定二维漫剧画风、线条与渲染', voice: '锁定角色音色与说话质感', sound: '锁定本镜核心音效或环境声',
    'start-frame': '锁定镜头起始构图、人物站位、视线和动作起点', 'key-frame': '锁定动作峰值与决定性姿态', 'end-frame': '锁定动作停点与镜头出口状态',
  }
  return labels[reference.role] ?? `锁定 ${reference.role}`
}

function referenceMediaType(reference: MotionDramaPromptPackReferenceV1): 'image' | 'audio' {
  return reference.mimeType?.startsWith('audio/') || ['voice', 'sound'].includes(reference.role) ? 'audio' : 'image'
}

function providerInputs(provider: MotionDramaProviderTargetV1, aliases: string[], references: MotionDramaPromptPackReferenceV1[], rightsReadyAliases: ReadonlySet<string>, subjectLabels: ReadonlyMap<string, string>): MotionDramaProviderInputV2[] {
  let image = 0; let audio = 0
  return aliases.map((alias, index) => {
    const reference = references.find(row => row.alias === alias)!
    const mediaType = referenceMediaType(reference)
    const number = mediaType === 'image' ? ++image : ++audio
    const prefix = provider === 'seedance' ? mediaType === 'image' ? '图片' : '音频' : mediaType === 'image' ? 'IMAGE_' : 'AUDIO_'
    return {
      slot: `${prefix}${number}`,
      uploadOrder: index + 1,
      referenceAlias: alias,
      mediaType,
      purpose: `${reference.subjectKey ? `${subjectLabels.get(reference.subjectKey) ?? reference.subjectKey}：` : ''}${referencePurpose(reference)}`,
      ready: reference.contentHash !== null && reference.mimeType !== null && rightsReadyAliases.has(alias),
    }
  })
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

function handoffStrategy(previous: MotionDramaShotV1 | null, current: MotionDramaShotV1): MotionDramaContinuityHandoffV2['strategy'] {
  if (!previous) return 'independent-start'
  const transition = `${previous.transitionOut} ${current.transitionIn}`.toLowerCase()
  if (/match|匹配|同形|同动作/.test(transition)) return 'match-cut'
  if (/continu|接续|动作接|尾帧|接着/.test(transition)) return 'tail-frame-chain'
  if (previous.sceneKey === current.sceneKey && !/hard|jump|smash|cutaway|dissolve|fade|硬切|跳切|闪回|叠化|淡/.test(transition)) return 'tail-frame-chain'
  return 'independent-cut'
}

function continuityHandoff(shots: MotionDramaShotV1[], index: number): MotionDramaContinuityHandoffV2 {
  const current = shots[index]; const previous = shots[index - 1] ?? null; const next = shots[index + 1] ?? null
  const strategy = handoffStrategy(previous, current)
  const lockedSubjectKeys = previous ? current.subjectKeys.filter(key => previous.subjectKeys.includes(key)) : [...current.subjectKeys]
  const transition = previous ? `${previous.transitionOut || '未标注'} → ${current.transitionIn || '未标注'}` : current.transitionIn || '开场建立'
  const isChained = strategy === 'tail-frame-chain'
  return {
    strategy,
    previousShotKey: previous?.stableKey ?? null,
    nextShotKey: next?.stableKey ?? null,
    transition,
    previousEndState: previous?.lastFramePrompt ?? '',
    currentStartState: current.firstFramePrompt,
    lockedSubjectKeys,
    positionAndGazeLock: previous ? `承接上一镜尾帧的屏幕方位、人物站位、视线目标与轴线；当前构图变化仅按“${current.composition}”执行。` : `本镜建立轴线与人物站位：${current.composition}`,
    motionHandoff: previous ? `上一镜动作停点“${previous.visibleAction}”之后，当前镜从“${current.visibleAction}”的起点继续，禁止回弹、重复起步或瞬移。` : `从稳定起始姿态进入“${current.visibleAction}”，动作只执行一次并落到明确停点。`,
    lightingAndPaletteLock: previous?.sceneKey === current.sceneKey ? `同场连续：继承上一镜光源方向与冷暖关系；本镜光线为“${current.lighting}”。` : `新场建立：以“${current.lighting}”为唯一光线与色彩基线。`,
    allowedChanges: ['当前镜规定的景别、机位和单一摄影机运动', '剧本规定的表情、动作与环境响应'],
    operatorInstruction: isChained
      ? '先从上一镜已选候选导出最后一帧；将其作为当前图片1，替换预制起始帧，再生成当前镜。若尾帧身份或姿态漂移，先返修上一镜，不把错误传给下一镜。'
      : strategy === 'match-cut'
        ? '分别生成两镜，但让上一镜尾帧与本镜首帧保持同一视觉形状、动作方向或注视点；剪辑点以形状/动作匹配，不强行保持同一空间。'
        : previous
          ? '本镜独立生成；剪辑前核对共同角色身份、服装、道具持有关系和视线方向，允许按转场建立新构图。'
          : '先用已确认起始帧建立角色、空间、光线和轴线；选择合格候选后再推进下一镜。',
  }
}

function isHeroShot(shot: MotionDramaShotV1): boolean {
  return /hook|climax|cliff|reveal|reversal|钩|高潮|反转|揭示|悬念/.test(shot.narrativeFunction.toLowerCase()) || ['extreme-close-up', 'insert'].includes(shot.shotSize)
}

function selectionChecks(shot: MotionDramaShotV1, continuity: MotionDramaContinuityHandoffV2): string[] {
  return [
    `身份与物料：${shot.subjectKeys.length ? shot.subjectKeys.join('、') : '本镜无登记主体'} 与参考一致，无换脸、换装、道具换手或画风漂移`,
    `动作：${shot.visibleAction} 只发生一次，重心、方向、速度和停点自然，无抽搐、融化、穿模或循环`,
    `摄影：仅执行 ${shot.cameraMovement} 主运动；${shot.shotSize}、${shot.cameraAngle} 和轴线清楚，无无意晃动或跳变`,
    `尾帧：停在“${shot.lastFramePrompt}”，可直接承担 ${continuity.nextShotKey ? `下一镜 ${continuity.nextShotKey} 的衔接` : '本集镜头出口'}`,
    `声音：对白、旁白和音效节奏不挤压 ${shot.targetSeconds}s 画面；不生成字幕、水印或无关画面文字`,
  ]
}

function retryPrompts(shot: MotionDramaShotV1, continuity: MotionDramaContinuityHandoffV2) {
  const subjects = shot.subjectKeys.join('、') || '画面主体'
  return {
    identityDrift: `只返修身份连续性：严格沿用参考槽位中的 ${subjects}；保持脸型、发型、服装、道具持有手、身材比例与画风不变。动作、机位、时长和结尾状态均不改。`,
    motionFailure: `只返修动作与摄影：${shot.visibleAction} 按起点—发力—环境响应—停点执行一次；摄影机仅做 ${shot.cameraMovement}，保持轴线和主体比例。禁止抽搐、循环、瞬移、穿模、镜头乱摆。`,
    continuityFailure: `只返修镜间衔接：${continuity.positionAndGazeLock} ${continuity.motionHandoff} ${continuity.lightingAndPaletteLock} 其余已合格内容不改。`,
  }
}

function seedancePrompt(shot: MotionDramaShotV1, inputs: MotionDramaProviderInputV2[], continuity: MotionDramaContinuityHandoffV2, aspectRatio: MotionDramaTargetSpecV1['aspectRatio']): string {
  const firstEnd = Number((shot.targetSeconds * 0.2).toFixed(1))
  const actionEnd = Number((shot.targetSeconds * 0.75).toFixed(1))
  const shotSize = ({ 'extreme-wide': '大远景', wide: '远景', full: '全景', medium: '中景', 'close-up': '近景', 'extreme-close-up': '特写', insert: '插入特写' } as const)[shot.shotSize]
  const refs = inputs.length ? [
    '【上传槽位与用途】',
    ...inputs.map(input => `@${input.slot}：${input.purpose}${input.ready ? '' : '（待补齐后才可直接生成）'}`),
  ] : ['【参考】无外部物料；按画面提示词从文本建立。']
  const sound = shot.soundPlan.map(cue => `${cue.timing} ${cue.kind}：${cue.cue}`).join('；')
  return [
    `生成一段 ${shot.targetSeconds} 秒、${aspectRatio} 画幅、精品二维漫剧质感、${shotSize} 的单镜头视频。`,
    ...refs,
    '【镜间交接】',
    `${continuity.strategy}；${continuity.positionAndGazeLock}`,
    `${continuity.motionHandoff} ${continuity.lightingAndPaletteLock}`,
    '【时间轴】',
    `[0.0s-${firstEnd.toFixed(1)}s] ${shot.firstFramePrompt}；保持短暂稳定，建立视线、重心和动作起点。`,
    `[${firstEnd.toFixed(1)}s-${actionEnd.toFixed(1)}s] ${shot.videoPrompt}；决定性中间状态为：${shot.keyFramePrompt}`,
    `[${actionEnd.toFixed(1)}s-${shot.targetSeconds.toFixed(1)}s] 动作减速并落到唯一停点：${shot.lastFramePrompt}`,
    shot.dialogue ? `【对白】${shot.dialogue}；口型、呼吸、视线和微表演同步，禁止抢拍。` : '',
    shot.narration ? `【旁白】${shot.narration}；作为画外音，不改变画面人物口型。` : '',
    sound ? `【声音】${sound}` : '',
    `【全程锁定】角色身份、服装版型与配色、道具持有关系、空间左右、光源方向、二维线条和渲染风格。摄影机只执行 ${shot.cameraMovement}，不添加第二个主运动。`,
    `【排除】${shot.negativeVideoPrompt}；同时避免字幕、水印、画面文字、换脸、换装、错误人数、左右翻转、无意切镜。`,
  ].filter(Boolean).join('\n')
}

function providerPrompt(provider: MotionDramaProviderTargetV1, shot: MotionDramaShotV1, inputs: MotionDramaProviderInputV2[], continuity: MotionDramaContinuityHandoffV2, aspectRatio: MotionDramaTargetSpecV1['aspectRatio']): string {
  if (provider === 'seedance') return seedancePrompt(shot, inputs, continuity, aspectRatio)
  const refs = inputs.length ? `参考绑定：${inputs.map(input => `${input.slot}=${input.purpose}`).join('；')}。` : ''
  const sound = shot.soundPlan.map(cue => `${cue.timing} ${cue.kind}: ${cue.cue}`).join('；')
  if (provider === 'runway') return [refs, `衔接：${continuity.operatorInstruction}`, `主体动作：${shot.videoPrompt}`, `摄影机：${shot.cameraMovement}；${shot.cameraAngle}；${shot.shotSize}`, `结束状态：${shot.lastFramePrompt}`, `保持项：身份、服装、场景结构、光线方向。避免：${shot.negativeVideoPrompt}`].filter(Boolean).join('\n')
  if (provider === 'ltx') return [refs, `SHOT ${shot.shotNumber} / ${shot.targetSeconds}s / ${shot.shotSize}`, `CONTINUITY: ${continuity.operatorInstruction}`, `视觉：${shot.imagePrompt}`, `动作与摄影机：${shot.videoPrompt}`, shot.dialogue ? `DIALOGUE: ${shot.dialogue}` : '', shot.narration ? `NARRATION: ${shot.narration}` : '', sound ? `SOUND: ${sound}` : '', `NEGATIVE: ${shot.negativeVideoPrompt}`].filter(Boolean).join('\n')
  return [refs, `衔接：${continuity.operatorInstruction}`, shot.videoPrompt, `首帧：${shot.firstFramePrompt}`, `尾帧：${shot.lastFramePrompt}`, sound ? `声音：${sound}` : '', `避免：${shot.negativeVideoPrompt}`].filter(Boolean).join('\n')
}

function assertProviderBudget(provider: MotionDramaProviderTargetV1, profile: MotionDramaPromptPackManifestV2['providerProfile'], shot: MotionDramaShotV1, inputs: MotionDramaProviderInputV2[]) {
  const limits = profile.limits
  const images = inputs.filter(input => input.mediaType === 'image').length
  const audios = inputs.filter(input => input.mediaType === 'audio').length
  if (limits.maxDurationSeconds !== null && shot.targetSeconds > limits.maxDurationSeconds) throw new Error(`[motion-drama-pack] 镜头 ${shot.shotNumber} 为 ${shot.targetSeconds}s，超过 ${provider} 当前 ${limits.maxDurationSeconds}s 上限；请先拆镜`)
  if (limits.maxImages !== null && images > limits.maxImages) throw new Error(`[motion-drama-pack] 镜头 ${shot.shotNumber} 需要 ${images} 个图片槽位，超过 ${provider} 当前 ${limits.maxImages} 图上限；请拆镜或减少主体引用`)
  if (limits.maxAudios !== null && audios > limits.maxAudios) throw new Error(`[motion-drama-pack] 镜头 ${shot.shotNumber} 需要 ${audios} 个音频槽位，超过 ${provider} 当前 ${limits.maxAudios} 音频上限；请拆镜或合并声音设计`)
}

export async function compileMotionDramaPromptPackV1(input: { scope: WorkspaceScope; episodeNumber: number; provider: MotionDramaProviderTargetV1; providerProfileId?: string; expectedProductionRevision: number }): Promise<MotionDramaPromptPackV1 & { id: number }> {
  const roots = await requireMotionDramaRootsV1(input.scope, true)
  if (roots.production.revision !== input.expectedProductionRevision) throw new Error('[motion-drama-pack] 生产内容已变化，请刷新')
  const [subjects, versions, shots, references] = await Promise.all([
    db.motionDramaAssetSubjects.where('adaptationProjectId').equals(roots.adaptation.id).toArray(),
    db.motionDramaAssetVersions.where('adaptationProjectId').equals(roots.adaptation.id).toArray(),
    db.motionDramaShots.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === input.episodeNumber).sortBy('order'),
    db.motionDramaShotReferences.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.selected).toArray(),
  ])
  if (!shots.length || shots.some(shot => !shot.imagePrompt.trim() || !shot.videoPrompt.trim())) throw new Error('[motion-drama-pack] 请先完整确认当前集的分镜、画面 IR 与视频 IR')
  const maturity = inspectMotionDramaPackMaturityV1({ subjects, versions, shots, references })
  const refRows: MotionDramaPromptPackReferenceV1[] = []
  const aliasByStableKey = new Map<string, string>()
  const rightsReadyAliases = new Set<string>()
  for (const subject of usedSubjects(subjects, shots)) {
    const version = selectedActualVersion(subject, versions)
    const blob = version?.blobObjectId == null ? null : await db.mediaBlobObjects.get(version.blobObjectId)
    if (version && (!blob || blob.contentHash !== version.contentHash || blob.workId !== roots.scope.workId
      || (subject.kind === 'voice' || subject.kind === 'sound' ? !blob.mimeType.startsWith('audio/') : !blob.mimeType.startsWith('image/')))) {
      throw new Error(`[motion-drama-pack] 物料 ${subject.label} 的参考文件类型、hash 或作用域无效`)
    }
    if (version && blob) await readMediaBlobObjectData({ scope: roots.scope, blobObjectId: blob.id!, expected: { contentHash: blob.contentHash, byteSize: blob.byteSize, mimeType: blob.mimeType } })
    const alias = `subject_${refRows.length + 1}`
    aliasByStableKey.set(subject.stableKey, alias)
    if (version && allowed(version.rights)) rightsReadyAliases.add(alias)
    refRows.push({ alias, kind: 'subject', stableKey: version?.stableKey ?? subject.stableKey, role: subject.kind, subjectKey: subject.stableKey, contentHash: version?.contentHash ?? null, mimeType: blob?.mimeType ?? null })
  }
  for (const reference of references.filter(row => shots.some(shot => shot.stableKey === row.shotKey) && row.blobObjectId != null)) {
    const blob = await db.mediaBlobObjects.get(reference.blobObjectId!)
    if (!blob?.id || blob.workId !== roots.scope.workId || !blob.mimeType.startsWith('image/')) throw new Error('[motion-drama-pack] 分镜参考图不存在、越界或类型错误')
    await readMediaBlobObjectData({ scope: roots.scope, blobObjectId: blob.id, expected: { contentHash: blob.contentHash, byteSize: blob.byteSize, mimeType: blob.mimeType } })
    const alias = `frame_${refRows.length + 1}`
    aliasByStableKey.set(reference.stableKey, alias)
    if (allowed(reference.rights)) rightsReadyAliases.add(alias)
    refRows.push({ alias, kind: 'frame', stableKey: reference.stableKey, role: reference.role, subjectKey: reference.subjectKey, contentHash: blob.contentHash, mimeType: blob.mimeType })
  }
  const startAliasByShot = new Map<string, string>()
  for (const shot of shots) {
    const start = references.find(reference => reference.shotKey === shot.stableKey && reference.role === 'start-frame' && reference.blobObjectId != null)
    if (start) startAliasByShot.set(shot.stableKey, aliasByStableKey.get(start.stableKey)!)
    else {
      const alias = `frame_${refRows.length + 1}`
      refRows.push({ alias, kind: 'frame', stableKey: `planned.${shot.stableKey}.start-frame`, role: 'start-frame', subjectKey: null, contentHash: null, mimeType: null })
      startAliasByShot.set(shot.stableKey, alias)
    }
  }
  const promptVersions = Object.fromEntries(await Promise.all(MOTION_DRAMA_PROMPT_STAGES_V1.map(async stage => [stage, (await resolveMotionDramaPromptV1(roots.scope, stage, input.episodeNumber)).contentHash]))) as Record<MotionDramaPromptStageV1, string>
  const target = structuredClone(roots.adaptation.targetSpec as MotionDramaTargetSpecV1)
  const profile = structuredClone(resolveProviderProfile(input.provider, input.providerProfileId))
  const subjectLabels = new Map(subjects.map(subject => [subject.stableKey, subject.label]))
  const compiledShots: MotionDramaPromptPackManifestV2['shots'] = shots.map((shot, index) => {
    const shotReferences = references.filter(row => row.shotKey === shot.stableKey && row.role !== 'start-frame')
    const referenceAliases = unique([
      startAliasByShot.get(shot.stableKey),
      ...shotSubjectKeys(subjects, shot).map(key => aliasByStableKey.get(key)),
      ...shotReferences.map(row => aliasByStableKey.get(row.stableKey)),
    ])
    const inputs = providerInputs(input.provider, referenceAliases, refRows, rightsReadyAliases, subjectLabels)
    assertProviderBudget(input.provider, profile, shot, inputs)
    const continuity = continuityHandoff(shots, index)
    const candidateCount = isHeroShot(shot) ? 4 : 3
    const hasBoundVoice = !shot.dialogue.trim() || inputs.some(row => row.mediaType === 'audio' && refRows.find(reference => reference.alias === row.referenceAlias)?.role === 'voice')
    const directUseReady = input.provider === 'seedance' && inputs.length > 0 && inputs.every(row => row.ready) && hasBoundVoice
    return {
      shotKey: shot.stableKey,
      durationSeconds: shot.targetSeconds,
      imagePrompt: shot.imagePrompt,
      negativeImagePrompt: shot.negativeImagePrompt,
      firstFramePrompt: shot.firstFramePrompt,
      keyFramePrompt: shot.keyFramePrompt,
      lastFramePrompt: shot.lastFramePrompt,
      videoPrompt: shot.videoPrompt,
      negativeVideoPrompt: shot.negativeVideoPrompt,
      providerPrompt: providerPrompt(input.provider, shot, inputs, continuity, target.aspectRatio),
      referenceAliases,
      dialogue: shot.dialogue,
      narration: shot.narration,
      sound: shot.soundPlan.map(cue => `${cue.timing} ${cue.kind}: ${cue.cue}`),
      directUseReady,
      providerInputs: inputs,
      continuity,
      generation: {
        mode: inputs.some(row => row.ready && row.mediaType === 'image') ? inputs.some(row => row.ready && row.mediaType === 'audio') ? 'multimodal-reference' : 'image-to-video' : 'text-to-video',
        durationSeconds: shot.targetSeconds,
        aspectRatio: target.aspectRatio,
        candidateCount,
        selectionChecks: selectionChecks(shot, continuity),
      },
      retryPrompts: retryPrompts(shot, continuity),
    }
  })
  const createdAt = Date.now()
  const manifest: MotionDramaPromptPackManifestV2 = {
    schema: 'storyforge.motion-drama-prompt-pack',
    version: 2,
    provider: input.provider,
    episodeNumber: input.episodeNumber,
    maturity: maturity.maturity,
    directUseReady: compiledShots.every(shot => shot.directUseReady),
    target,
    providerProfile: profile,
    executionPlan: {
      generationUnit: 'one-shot-per-generation',
      assemblyOrder: shots.map(shot => shot.stableKey),
      defaultCandidateCount: 3,
      heroShotCandidateCount: 4,
      selectBeforeNextShot: true,
      operatorChecklist: [
        '按 assemblyOrder 逐镜处理；先上传 providerInputs，再逐字复制 providerPrompt。',
        '普通镜头至少生成 3 个候选，关键镜头至少 4 个；按 selectionChecks 选定唯一候选。',
        '先确认当前镜尾帧，再生成下一镜；tail-frame-chain 必须把当前已选候选的末帧交给下一镜。',
        '只用 retryPrompts 定点修复单类失败；若身份与尾帧同时失败，先修身份，再修连续性。',
        '全部镜头选定后，按对白、旁白、SFX 与音乐计划进入外部剪辑；StoryForge 不把未生成视频冒充成片。',
      ],
    },
    providerNotes: providerNotes(input.provider, profile),
    references: refRows,
    shots: compiledShots,
    createdAt,
  }
  assertMotionDramaPromptPackManifest(manifest)
  const manifestJson = canonicalStringify(manifest)
  const contentHash = await hashCanonicalValue(manifest)
  return db.transaction('rw', scopeTransactionTables(db.motionDramaPromptPacks, db.motionDramaProductions), async () => {
    const production = await db.motionDramaProductions.get(roots.production.id)
    if (!production || production.revision !== input.expectedProductionRevision) throw new Error('[motion-drama-pack] 编译 CAS 失败：生产内容已变化')
    const existing = await db.motionDramaPromptPacks.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === input.episodeNumber && row.provider === input.provider).toArray()
    const version = Math.max(0, ...existing.map(row => row.version)) + 1
    const row: MotionDramaPromptPackV1 = stampNewRecord(roots.scope, 'motionDramaPromptPacks', { projectId: roots.scope.projectId, workId: roots.scope.workId, adaptationProjectId: roots.adaptation.id, episodeNumber: input.episodeNumber, provider: input.provider, version, maturity: maturity.maturity, sourceManifestVersion: roots.adaptation.activeSourceManifestVersion, sourceRevision: production.revision, promptVersions, manifestJson, contentHash, createdAt }, { owner: 'work' })
    const id = await db.motionDramaPromptPacks.add(row) as number
    await db.motionDramaProductions.update(production.id!, { phase: 'review', revision: production.revision + 1, updatedAt: createdAt })
    return { ...row, id }
  })
}

export function parseMotionDramaPromptPackManifestV1(row: MotionDramaPromptPackV1): MotionDramaPromptPackManifest {
  let value: MotionDramaPromptPackManifest
  try { value = JSON.parse(row.manifestJson) as MotionDramaPromptPackManifest } catch { throw new Error('[motion-drama-pack] manifest 不是 JSON') }
  assertMotionDramaPromptPackManifest(value)
  if (value.schema !== 'storyforge.motion-drama-prompt-pack' || ![1, 2].includes(value.version) || value.provider !== row.provider || value.episodeNumber !== row.episodeNumber || value.maturity !== row.maturity) throw new Error('[motion-drama-pack] manifest 身份不匹配')
  return value
}

export async function verifyMotionDramaPromptPackV1(row: MotionDramaPromptPackV1): Promise<MotionDramaPromptPackManifest> {
  const manifest = parseMotionDramaPromptPackManifestV1(row)
  if (await hashCanonicalValue(manifest) !== row.contentHash) throw new Error('[motion-drama-pack] manifest hash 不匹配')
  return manifest
}
