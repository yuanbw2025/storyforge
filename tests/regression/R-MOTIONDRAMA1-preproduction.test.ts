import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createAdaptation, listActiveSourceUnits } from '../../src/lib/adaptation/source-manifest'
import { db, STORYFORGE_SCHEMA_VERSION } from '../../src/lib/db/schema'
import type {
  ChatMessage,
  MediaRightsV1,
  MotionDramaPromptStageV1,
  MotionDramaTargetSpecV1,
  WorkspaceScope,
} from '../../src/lib/types'
import {
  adoptMotionDramaCandidateV1,
  commitMotionDramaAssetReferenceV1,
  commitMotionDramaShotReferenceV1,
  loadMotionDramaStudioV1,
  resyncMotionDramaSourceV1,
} from '../../src/lib/motion-drama/service'
import {
  adoptMotionDramaProfessionalCandidateV1,
  generateMotionDramaCandidateV1,
} from '../../src/lib/motion-drama/durable-production'
import {
  deleteMotionDramaPromptOverrideV1,
  getMotionDramaPromptDefinitionV1,
  resolveMotionDramaPromptV1,
  saveMotionDramaPromptOverrideV1,
} from '../../src/lib/motion-drama/prompts'
import {
  compileMotionDramaPromptPackV1,
  verifyMotionDramaPromptPackV1,
} from '../../src/lib/motion-drama/prompt-pack'
import { assertMotionDramaPromptPackManifestV2 } from '../../src/lib/motion-drama/prompt-pack-contracts'
import { inspectMotionDramaQualityV1 } from '../../src/lib/motion-drama/quality'
import {
  publishMotionDramaReleaseV1,
  readMotionDramaReleaseManifestV1,
} from '../../src/lib/motion-drama/release'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { collectUnreferencedMediaBlobObjects } from '../../src/lib/product-production/media-blob-store'

const targetSpec: MotionDramaTargetSpecV1 = {
  format: 'motion-drama', language: 'zh-CN', episodeCount: 12, targetSecondsPerEpisode: 20,
  aspectRatio: '9:16', narrativeMode: 'animated-comic', audience: '成年悬疑观众', rating: 'PG-13',
  dialogueDensity: 'balanced', artDirection: '雨夜霓虹、冷暖对撞、电影化条漫动效',
  providerTargets: ['seedance', 'runway', 'ltx'],
}

const seriesBible = {
  version: 1 as const,
  titlePromise: '每一张被撕掉的车票，都能改写一个人的告别。',
  logline: '能听见遗憾回声的检票员必须在末班车消失前，决定是否改写妹妹的死亡。',
  coreTheme: '接受失去不是背叛记忆。', emotionalPromise: '悬疑推进中的克制治愈。',
  audiencePromise: '每集解开一张车票背后的遗憾，同时逼近主角自己的真相。',
  storyEngine: '一张异常车票触发一段可见回声；主角帮助陌生人选择，也付出记忆被抹去的代价。',
  worldRules: ['回声只在末班车进站前出现。', '改写一次选择会抹去主角一段私人记忆。'],
  seasonArc: '从利用能力逃避妹妹之死，到放弃最后一次改写并真正告别。',
  protagonistArc: '林岚从控制一切走向承认有些失去无法修正。',
  relationshipArcs: ['林岚与妹妹的误解通过车票回声逐层反转。'],
  episodeArchitecture: '3 秒异常冷开场，12 秒追逼与选择，5 秒代价显现并留下尾钩。',
  hookPatterns: ['物件异常', '身份反转', '倒计时中断'],
  visualLanguage: ['冷蓝现实与琥珀回声分层', '近景微表演承担心理转折'],
  soundLanguage: ['检票钳声作为能力触发音', '列车低频承担倒计时'],
  continuityRules: ['林岚左眉旧伤固定。', '银色检票钳始终在右手。'],
  productionConstraints: ['单镜头不超过 10 秒。', '避免复杂群像和画面内文字。'],
}

function pngBytes(): ArrayBuffer {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, 1024); view.setUint32(20, 1536)
  return bytes.buffer
}

function wavBytes(): ArrayBuffer {
  const bytes = new Uint8Array(44)
  bytes.set([...'RIFF'].map(char => char.charCodeAt(0)), 0)
  bytes.set([...'WAVE'].map(char => char.charCodeAt(0)), 8)
  bytes.set([...'fmt '].map(char => char.charCodeAt(0)), 12)
  bytes.set([...'data'].map(char => char.charCodeAt(0)), 36)
  return bytes.buffer
}

function rights(): MediaRightsV1 {
  return { version: 1, source: 'author-upload', commercialUse: 'allowed', redistribution: 'allowed', attribution: '', declaration: '作者确认拥有测试参考素材完整商用与再分发权利。', declaredAt: Date.now() }
}

async function fixture() {
  const source = await createWorkspace({
    name: '末班车回声', genres: ['suspense'], status: 'drafting',
    description: '检票员林岚能从废弃车票中听见未完成的告别。', targetWordCount: 8_000, enableMultiWorld: false,
  }, { kind: 'novel', novelProfile: 'short' })
  const chapter = await db.chapters.where('projectId').equals(source.scope.projectId).filter(row => row.workId === source.scope.workId).first()
  await db.chapters.update(chapter!.id!, {
    content: '<p>午夜前，检票员林岚在封闭站台捡到一张写着妹妹名字的旧车票。检票钳自行合拢，隧道里传来三年前那句没有说完的告别。</p>',
    summary: '林岚拾到妹妹的旧车票，能力被迫启动。', updatedAt: Date.now(),
  })
  const created = await createAdaptation({
    sourceScope: source.scope, sourceWorkId: source.scope.workId, title: '末班车回声·漫剧',
    sourceSelection: { mode: 'entire-work' }, medium: 'motion-drama', targetSpec,
  })
  const unit = (await listActiveSourceUnits(created.adaptation.id!)).find(row => row.sourceKind === 'chapter')!
  return { ...created, source, unit, sourceChapter: chapter! }
}

async function adopt(scope: WorkspaceScope, stage: MotionDramaPromptStageV1, payload: unknown) {
  const snapshot = await loadMotionDramaStudioV1(scope)
  await adoptMotionDramaCandidateV1({
    scope, stage, payload, episodeNumber: 1,
    expectedAdaptationRevision: snapshot.adaptation.revision,
    expectedProductionRevision: snapshot.production.revision,
  })
}

function assetBible(sourceUnitKey: string) {
  return [{
    stableKey: 'character.linlan', kind: 'character', label: '林岚', identity: '28 岁夜班检票员，左眉有旧伤。',
    appearance: '黑色短发，疲惫但警觉的眼神，克制的微表情。', palette: ['炭黑', '冷蓝'], materials: ['哑光皮肤', '湿呢料'],
    continuityLocks: ['左眉旧伤', '黑色短发', '右手持银色检票钳'], prohibitedChanges: ['改变年龄', '交换持钳手'],
    basePrompt: '林岚，28 岁东亚女性检票员，黑色短发，左眉旧伤，克制神情，电影化二维漫剧角色设定。',
    negativePrompt: '身份漂移，左右翻转，额外肢体，画面文字，水印。',
    referenceBrief: '正面、左右侧面、全身比例、六种克制表情与右手持钳动作。', sourceUnitKeys: [sourceUnitKey],
  }, {
    stableKey: 'voice.linlan', kind: 'voice', label: '林岚音色', identity: '低沉克制的成年女声，职业性冷静下藏着疲惫。',
    appearance: '中低音区，气息轻，咬字清楚。', palette: [], materials: [], continuityLocks: ['普通语速', '情绪不外放'], prohibitedChanges: ['夸张哭腔', '卡通幼态'],
    basePrompt: '28 岁女性，中低音区，轻气声，普通话，克制而警觉。', negativePrompt: '播音腔，过度表演，机械音，背景噪声。',
    referenceBrief: '同一段中性、怀疑、恐惧三种强度的干声试听。', sourceUnitKeys: [sourceUnitKey],
  }, {
    stableKey: 'voice.announcer', kind: 'voice', label: '站内广播音色', identity: '遥远、失真的中性广播声。',
    appearance: '窄频、长混响。', palette: [], materials: [], continuityLocks: ['距离感固定'], prohibitedChanges: ['贴耳近讲'],
    basePrompt: '废弃地铁站的中性广播声。', negativePrompt: '播音棚干声。',
    referenceBrief: '两句站内广播试听；未出场时不得绑定给角色对白。', sourceUnitKeys: [sourceUnitKey],
  }, {
    stableKey: 'sound.ticket-punch', kind: 'sound', label: '检票钳触发音', identity: '清脆金属咔哒后拖出极轻的低频回声。',
    appearance: '短促近场金属瞬态与远处隧道低频。', palette: [], materials: ['金属', '隧道混响'], continuityLocks: ['每次能力触发使用相同音色'], prohibitedChanges: ['喜剧卡通音效'],
    basePrompt: '近场老式金属检票钳咔哒，尾部连接幽深地铁隧道低频回声。', negativePrompt: '爆音，白噪，音乐旋律，卡通音效。',
    referenceBrief: '无对白、无音乐、峰值不过载的 2 秒干净试听。', sourceUnitKeys: [sourceUnitKey],
  }]
}

function episode(sourceUnitKey: string) {
  return {
    stableKey: 'episode.1', episodeNumber: 1, title: '妹妹的车票',
    logline: '林岚在末班车到站前听见死去妹妹的回声。',
    synopsis: '车票唤醒回声；林岚试图追问真相，却发现列车正在驶向早已封闭的站台。',
    openingHook: '检票钳在无人触碰时咔哒合拢。',
    beats: [
      { stableKey: 'episode.1.beat.1', order: 0, function: 'hook', visibleAction: '检票钳自行咬穿旧车票。', conflict: '林岚想丢掉车票，妹妹的声音却从隧道传来。', turn: '车票浮出妹妹姓名。', targetSeconds: 10, sourceUnitKeys: [sourceUnitKey] },
      { stableKey: 'episode.1.beat.2', order: 1, function: 'cliffhanger', visibleAction: '熄灭三年的站台灯依次亮向隧道。', conflict: '末班车倒计时只剩十秒。', turn: '封闭轨道传来列车灯。', targetSeconds: 10, sourceUnitKeys: [sourceUnitKey] },
    ],
    endHook: '列车窗内坐着三年前的妹妹。', continuityIn: [], continuityOut: ['林岚保留旧车票。', '神秘列车已经进站。'], sourceUnitKeys: [sourceUnitKey],
  }
}

function script(sourceUnitKey: string) {
  return [{
    stableKey: 'episode.1.scene.1', episodeNumber: 1, sceneNumber: 1, order: 0,
    heading: '内景·封闭站台·午夜', location: '废弃地铁站台', timeOfDay: '午夜', dramaticPurpose: '用异常物件启动能力并抛出妹妹回归的钩子。',
    entryState: '站台黑暗，林岚独自巡检。', exitState: '神秘列车冲出隧道，妹妹出现在车窗内。',
    visibleAction: '检票钳自行合拢；灯带逐盏亮起；林岚抬头看向驶来的列车。',
    dialogue: [{ speakerKey: 'character.linlan', text: '这张票……不可能。', delivery: '压住颤抖，几乎是气声', estimatedSeconds: 3 }],
    narration: '', soundCues: [{ kind: 'sfx', cue: '清脆检票钳声后接列车低频', timing: '0s 起，10s 增强', subjectKey: null }],
    emotionalTurn: '职业性冷静被失而复得的恐惧击穿。', estimatedSeconds: 20,
    characterKeys: ['character.linlan'], sourceUnitKeys: [sourceUnitKey],
  }]
}

function shots(sourceUnitKey: string) {
  const base = {
    episodeNumber: 1, sceneKey: 'episode.1.scene.1', narrativeFunction: '用可见异常推动悬疑', targetSeconds: 10,
    cameraAngle: 'eye-level' as const, cameraMovement: 'dolly' as const, performance: '呼吸变浅，目光先落车票再抬向隧道。',
    lighting: '冷蓝顶灯与隧道琥珀逆光对撞。', transitionIn: 'cut', transitionOut: 'match-cut', narration: '',
    soundPlan: [{ kind: 'sfx' as const, cue: '检票钳咔哒声与列车低频', timing: '动作点同步', subjectKey: 'sound.ticket-punch' }],
    subjectKeys: ['character.linlan'], sourceUnitKeys: [sourceUnitKey], imagePrompt: '', negativeImagePrompt: '', firstFramePrompt: '', keyFramePrompt: '', lastFramePrompt: '', videoPrompt: '', negativeVideoPrompt: '',
  }
  return [
    { ...base, stableKey: 'episode.1.shot.1', shotNumber: 1, order: 0, shotSize: 'close-up' as const, composition: '手与车票占画面下三分之一，林岚虚焦在后景。', visibleAction: '银色检票钳自行合拢并咬穿旧车票。', dialogue: '林岚：这张票……不可能。' },
    { ...base, stableKey: 'episode.1.shot.2', shotNumber: 2, order: 1, shotSize: 'medium' as const, composition: '林岚位于左侧三分线，隧道光从右后方逼近。', visibleAction: '林岚抬头，站台灯依次亮起，列车窗里显出妹妹。', dialogue: '' },
  ]
}

describe('MOTION-DRAMA-1 · independent preproduction pipeline', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('八岗位提示词和 durable 候选保持作者确认边界，并拒绝 stale 候选', async () => {
    const item = await fixture()
    expect(STORYFORGE_SCHEMA_VERSION).toBe(6)
    for (const stage of ['series-bible', 'asset-bible', 'episode-outline', 'episode-script', 'shot-design', 'image-prompts', 'video-prompts', 'quality-review'] as MotionDramaPromptStageV1[]) {
      const definition = getMotionDramaPromptDefinitionV1(stage)
      expect(definition.instruction).toContain('不针对任何比赛')
      expect(definition.instruction).toContain('只输出协议要求的单个 JSON 值')
    }
    let calls = 0
    const generated = await generateMotionDramaCandidateV1({
      scope: item.scope, stage: 'series-bible', episodeNumber: 1,
      runAI: async (messages: ChatMessage[]) => {
        calls += 1
        expect(messages[0].content).toContain('系列开发制片人')
        if (calls === 1) return JSON.stringify({ ...seriesBible, extra: 'closed shape violation' })
        expect(messages.at(-1)?.content).toContain('JSON 值')
        return JSON.stringify(seriesBible)
      },
    })
    expect(calls).toBe(2)
    expect(await db.motionDramaSeriesBibles.count()).toBe(0)
    const adopted = await adoptMotionDramaProfessionalCandidateV1({ scope: item.scope, runId: generated.snapshot.run.id })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(await db.motionDramaSeriesBibles.count()).toBe(1)

    const pending = await generateMotionDramaCandidateV1({ scope: item.scope, stage: 'asset-bible', episodeNumber: 1, runAI: async () => JSON.stringify(assetBible(item.unit.sourceUnitKey)) })
    const current = await loadMotionDramaStudioV1(item.scope)
    await saveMotionDramaPromptOverrideV1({ scope: item.scope, stage: 'asset-bible', overrideScope: 'episode', episodeNumber: 1, instruction: '保留左眉旧伤，并强化材质连续性。' })
    await expect(adoptMotionDramaProfessionalCandidateV1({ scope: item.scope, runId: pending.snapshot.run.id })).rejects.toThrow('stale')
    expect((await loadMotionDramaStudioV1(item.scope)).production.revision).toBe(current.production.revision + 1)
  })

  it('小说到三厂商提示词包、参考物料、不可变发布与完整备份形成闭环', async () => {
    const item = await fixture()
    await adopt(item.scope, 'series-bible', seriesBible)
    await adopt(item.scope, 'asset-bible', assetBible(item.unit.sourceUnitKey))
    await adopt(item.scope, 'episode-outline', episode(item.unit.sourceUnitKey))
    await adopt(item.scope, 'episode-script', script(item.unit.sourceUnitKey))
    await adopt(item.scope, 'shot-design', shots(item.unit.sourceUnitKey))
    let studio = await loadMotionDramaStudioV1(item.scope)
    await adopt(item.scope, 'image-prompts', studio.shots.map(shot => ({
      shotKey: shot.stableKey, expectedRevision: shot.revision,
      imagePrompt: `${shot.visibleAction}，${shot.composition}，冷蓝与琥珀电影光，二维精品漫剧定帧。`,
      negativeImagePrompt: '身份漂移，左右翻转，额外肢体，糊脸，画面文字，水印。',
      firstFramePrompt: `${shot.visibleAction}发生前的稳定起始姿态。`, keyFramePrompt: `${shot.visibleAction}的决定性动作峰值。`, lastFramePrompt: `${shot.visibleAction}完成后的明确停点。`,
    })))
    studio = await loadMotionDramaStudioV1(item.scope)
    await adopt(item.scope, 'video-prompts', studio.shots.map(shot => ({
      shotKey: shot.stableKey, expectedRevision: shot.revision,
      videoPrompt: `初始静止；${shot.visibleAction}；环境光作出响应；摄影机缓慢推进；动作落在明确停点。`,
      negativeVideoPrompt: '抽搐，融化，身份切换，穿模，瞬移，镜头乱摆，循环动作。',
    })))

    studio = await loadMotionDramaStudioV1(item.scope)
    const firstPack = await compileMotionDramaPromptPackV1({ scope: item.scope, episodeNumber: 1, provider: 'seedance', expectedProductionRevision: studio.production.revision })
    const firstManifest = await verifyMotionDramaPromptPackV1(firstPack)
    expect(firstManifest.version).toBe(2)
    if (firstManifest.version !== 2) throw new Error('expected v2 prompt pack')
    expect(firstManifest).toMatchObject({ directUseReady: false, providerProfile: { id: 'seedance-2.5-2026-07', limits: { maxDurationSeconds: 30, maxImages: 30, maxVideos: 10, maxAudios: 10 } } })
    expect(firstManifest.executionPlan).toMatchObject({ generationUnit: 'one-shot-per-generation', selectBeforeNextShot: true, defaultCandidateCount: 3 })
    expect(firstManifest.shots[0].providerInputs.map(input => input.slot)).toEqual(['图片1', '图片2', '音频1', '音频2'])
    expect(firstManifest.references.some(reference => reference.subjectKey === 'voice.announcer')).toBe(false)
    expect(firstManifest.shots[0].providerInputs.find(input => input.mediaType === 'audio')?.purpose).toContain('林岚音色')
    expect(firstManifest.shots[0].providerInputs.some(input => !input.ready)).toBe(true)
    expect(firstManifest.shots[0].providerPrompt).toContain('【上传槽位与用途】')
    expect(firstManifest.shots[0].providerPrompt).toContain('[0.0s-')
    expect(firstManifest.shots[1].continuity).toMatchObject({ previousShotKey: 'episode.1.shot.1', strategy: 'match-cut' })
    expect(firstManifest.shots[1].continuity.operatorInstruction).toContain('剪辑点')
    expect(firstManifest.shots[0].retryPrompts.identityDrift).toContain('只返修身份连续性')
    studio = await loadMotionDramaStudioV1(item.scope)
    const compatibilityPack = await compileMotionDramaPromptPackV1({ scope: item.scope, episodeNumber: 1, provider: 'seedance', providerProfileId: 'seedance-2.0-2026-02', expectedProductionRevision: studio.production.revision })
    const compatibilityManifest = await verifyMotionDramaPromptPackV1(compatibilityPack)
    expect(compatibilityManifest.version).toBe(2)
    if (compatibilityManifest.version !== 2) throw new Error('expected v2 compatibility pack')
    expect(compatibilityManifest.providerProfile).toMatchObject({ id: 'seedance-2.0-2026-02', limits: { maxDurationSeconds: 15, maxImages: 9, maxVideos: 3, maxAudios: 3 } })
    const overLimit = structuredClone(compatibilityManifest)
    overLimit.shots[0].durationSeconds = 16
    overLimit.shots[0].generation.durationSeconds = 16
    expect(() => assertMotionDramaPromptPackManifestV2(overLimit)).toThrow('超出 providerProfile 能力')
    await saveMotionDramaPromptOverrideV1({ scope: item.scope, stage: 'video-prompts', overrideScope: 'work', episodeNumber: 1, instruction: '动作必须有起点、方向、速度与停点。' })
    await saveMotionDramaPromptOverrideV1({ scope: item.scope, stage: 'video-prompts', overrideScope: 'episode', episodeNumber: 1, instruction: '本集所有推进镜头保持缓慢压迫感。' })
    expect(await db.motionDramaPromptPacks.count()).toBe(0)
    expect((await resolveMotionDramaPromptV1(item.scope, 'video-prompts', 1)).source).toBe('episode')
    expect((await resolveMotionDramaPromptV1(item.scope, 'video-prompts', 2)).source).toBe('work')
    await deleteMotionDramaPromptOverrideV1({ scope: item.scope, stage: 'video-prompts', overrideScope: 'episode', episodeNumber: 1 })
    expect((await resolveMotionDramaPromptV1(item.scope, 'video-prompts', 1)).source).toBe('work')

    const providers = ['seedance', 'runway', 'ltx'] as const
    for (const provider of providers) {
      studio = await loadMotionDramaStudioV1(item.scope)
      await compileMotionDramaPromptPackV1({ scope: item.scope, episodeNumber: 1, provider, expectedProductionRevision: studio.production.revision })
    }
    await adopt(item.scope, 'quality-review', [])
    let quality = await inspectMotionDramaQualityV1({ scope: item.scope, episodeNumber: 1, providers: [...providers] })
    expect(quality).toMatchObject({ ready: true, achievableTier: 'prompt-only' })
    studio = await loadMotionDramaStudioV1(item.scope)
    const promptRelease = await publishMotionDramaReleaseV1({ scope: item.scope, episodeNumbers: [1], providers: [...providers], tier: 'prompt-only', expectedProductionRevision: studio.production.revision })
    const promptManifest = await readMotionDramaReleaseManifestV1(item.scope, promptRelease.id)
    expect(promptManifest.releaseScope).toEqual({ episodeNumbers: [1], providers: [...providers] })
    expect(promptManifest.shots).toHaveLength(2)

    await commitMotionDramaAssetReferenceV1({ scope: item.scope, subjectKey: 'character.linlan', data: pngBytes(), rights: rights(), note: '角色三视图与表情参考。' })
    await commitMotionDramaAssetReferenceV1({ scope: item.scope, subjectKey: 'voice.linlan', data: wavBytes(), rights: rights(), note: '角色干声试听。' })
    await commitMotionDramaAssetReferenceV1({ scope: item.scope, subjectKey: 'sound.ticket-punch', data: wavBytes(), rights: rights(), note: '能力触发音试听。' })
    for (const shot of (await loadMotionDramaStudioV1(item.scope)).shots) {
      await commitMotionDramaShotReferenceV1({ scope: item.scope, shotKey: shot.stableKey, role: 'start-frame', data: pngBytes(), rights: rights(), note: '作者确认的起始帧。' })
    }
    for (const provider of providers) {
      studio = await loadMotionDramaStudioV1(item.scope)
      const pack = await compileMotionDramaPromptPackV1({ scope: item.scope, episodeNumber: 1, provider, expectedProductionRevision: studio.production.revision })
      expect(pack.maturity).toBe('reference-ready')
      const manifest = await verifyMotionDramaPromptPackV1(pack)
      expect(manifest.version).toBe(2)
      if (manifest.version !== 2) throw new Error('expected v2 prompt pack')
      expect(manifest.references.length).toBeGreaterThanOrEqual(5)
      expect(manifest.references.filter(reference => reference.mimeType === 'audio/wav')).toHaveLength(2)
      expect(manifest.directUseReady).toBe(provider === 'seedance')
      if (provider === 'seedance') {
        expect(manifest.shots.every(shot => shot.directUseReady && shot.providerInputs.every(input => input.ready))).toBe(true)
        expect(manifest.shots[0].providerPrompt).toContain('@图片1：锁定镜头起始构图')
      }
    }
    quality = await inspectMotionDramaQualityV1({ scope: item.scope, episodeNumber: 1, providers: [...providers] })
    expect(quality).toMatchObject({ ready: true, achievableTier: 'reference-ready', metrics: { directUseReadyProviderCount: 1 } })
    studio = await loadMotionDramaStudioV1(item.scope)
    const referenceRelease = await publishMotionDramaReleaseV1({ scope: item.scope, episodeNumbers: [1], providers: [...providers], tier: 'reference-ready', expectedProductionRevision: studio.production.revision })
    expect(referenceRelease).toMatchObject({ version: 2, parentReleaseId: promptRelease.id })
    expect(await db.creationReleaseAssets.where('releaseId').equals(referenceRelease.id).count()).toBe(5)
    const protectedBlobIds = (await db.creationReleaseAssets.where('releaseId').equals(referenceRelease.id).toArray())
      .map(row => row.blobObjectId)
    const gcReceipt = await collectUnreferencedMediaBlobObjects({ scope: item.scope })
    expect(gcReceipt.retained).toEqual(expect.arrayContaining(protectedBlobIds))
    expect(gcReceipt.deleted).toHaveLength(0)

    const frozen = promptRelease.manifestJson
    await saveMotionDramaPromptOverrideV1({ scope: item.scope, stage: 'shot-design', overrideScope: 'work', episodeNumber: 1, instruction: '镜头必须服务单一叙事动作。' })
    expect((await db.creationReleases.get(promptRelease.id))?.manifestJson).toBe(frozen)
    expect(await db.motionDramaPromptPacks.count()).toBe(0)

    const backup = await exportProjectJSON(item.scope.projectId)
    expect(backup.motionDramaProductions).toHaveLength(1)
    expect(backup.motionDramaAssetVersions.some(row => row._blobObjectExportId != null)).toBe(true)
    expect(backup.motionDramaShotReferences).toHaveLength(2)
    const tampered = structuredClone(backup)
    tampered.motionDramaShots[0].sceneKey = 'episode.1.scene.missing'
    await expect(importProjectJSON(tampered)).rejects.toThrow('MotionDramaShot')
    const importedProjectId = await importProjectJSON(structuredClone(backup))
    const [world, work, importedProduction, importedReleases] = await Promise.all([
      db.worlds.where('projectId').equals(importedProjectId).first(),
      db.works.where('projectId').equals(importedProjectId).filter(row => row.kind === 'motion-drama').first(),
      db.motionDramaProductions.where('projectId').equals(importedProjectId).first(),
      db.creationReleases.where('projectId').equals(importedProjectId).filter(row => row.productKind === 'motion-drama').sortBy('version'),
    ])
    expect(importedReleases).toHaveLength(2)
    expect(importedReleases[1].parentReleaseId).toBe(importedReleases[0].id)
    expect(importedProduction?.currentReleaseId).toBe(importedReleases[1].id)
    const importedManifest = await readMotionDramaReleaseManifestV1({ projectId: importedProjectId, worldId: world!.id!, workId: work!.id! }, importedReleases[1].id!)
    expect(importedManifest).toMatchObject({ productKind: 'motion-drama', tier: 'reference-ready' })

    await db.chapters.update(item.sourceChapter.id!, { content: '<p>小说来源已经由作者改写，增加了一辆没有司机的列车。</p>', updatedAt: Date.now() })
    studio = await loadMotionDramaStudioV1(item.scope)
    expect(studio.sourceFreshness.status).toBe('changed')
    await resyncMotionDramaSourceV1({ scope: item.scope, expectedAdaptationRevision: studio.adaptation.revision, expectedProductionRevision: studio.production.revision })
    studio = await loadMotionDramaStudioV1(item.scope)
    expect(studio).toMatchObject({ production: { phase: 'source', activeSeriesBibleVersion: null }, sourceFreshness: { status: 'unchanged' } })
    expect(studio.adaptation.activeSourceManifestVersion).toBe(2)
    expect(studio.assets).toHaveLength(0); expect(studio.shots).toHaveLength(0); expect(studio.promptPacks).toHaveLength(0)
    expect((await db.creationReleases.where('workId').equals(item.scope.workId).toArray())).toHaveLength(2)
    expect(await readMotionDramaReleaseManifestV1(item.scope, referenceRelease.id)).toMatchObject({ tier: 'reference-ready' })
  })
})
