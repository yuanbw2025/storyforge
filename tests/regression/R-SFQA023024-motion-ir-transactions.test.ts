import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { readOwnedRows } from '../../src/lib/workspace/scope'
import { createAdaptation, listActiveSourceUnits } from '../../src/lib/adaptation/source-manifest'
import { parseMotionDramaCandidatePayloadV1 } from '../../src/lib/motion-drama/contracts'
import { adoptMotionDramaCandidateV1, loadMotionDramaStudioV1, setCurrentMotionDramaEpisodeV1 } from '../../src/lib/motion-drama/service'
import { adoptMotionDramaProfessionalCandidateV1, generateMotionDramaCandidateV1 } from '../../src/lib/motion-drama/durable-production'
import type { Chapter, MotionDramaPromptStageV1, MotionDramaShotCandidateV1, MotionDramaTargetSpecV1 } from '../../src/lib/types'

const targetSpec: MotionDramaTargetSpecV1 = {
  format: 'motion-drama', language: 'zh-CN', episodeCount: 3, targetSecondsPerEpisode: 20,
  aspectRatio: '9:16', narrativeMode: 'animated-comic', audience: '悬疑观众', rating: 'PG-13',
  dialogueDensity: 'balanced', artDirection: '雨夜站台', providerTargets: ['seedance'],
}

async function fixture() {
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
    palette: ['银色'], materials: ['金属'], continuityLocks: ['银色'], prohibitedChanges: ['变色'], basePrompt: '银色检票钳', negativePrompt: '水印', referenceBrief: '近景', sourceUnitKeys: [unit.sourceUnitKey] }])
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
    soundPlan: [], subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], imagePrompt: '', negativeImagePrompt: '', firstFramePrompt: '', keyFramePrompt: '', lastFramePrompt: '', videoPrompt: '', negativeVideoPrompt: '' }))
  await adopt('shot-design', shots)
  const snapshot = () => loadMotionDramaStudioV1(created.scope)
  const payload = async (stage: 'image-prompts' | 'video-prompts') => (await snapshot()).shots.map(shot => stage === 'image-prompts'
    ? { shotKey: shot.stableKey, expectedRevision: shot.revision, imagePrompt: '静帧', negativeImagePrompt: '水印', firstFramePrompt: '起始姿态', keyFramePrompt: '动作峰值', lastFramePrompt: '结束姿态' }
    : { shotKey: shot.stableKey, expectedRevision: shot.revision, videoPrompt: '合拢检票钳', negativeVideoPrompt: '身份漂移' })
  return { ...created, adopt, snapshot, payload }
}

describe('SFQA-023/024 · 漫剧IR全覆盖和切集CAS', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it.each(['image-prompts', 'video-prompts'] as const)('%s共享解析入口按shotKey拒绝重复', async stage => {
    const f = await fixture(), payload = await f.payload(stage)
    expect(() => parseMotionDramaCandidatePayloadV1(stage, [payload[0], payload[0]])).toThrow('shotKey')
    expect(() => parseMotionDramaCandidatePayloadV1(stage, payload)).not.toThrow()
  })

  it.each(['image-prompts', 'video-prompts'] as const)('%s durable输出及作者编辑使用同一shotKey唯一约束', async stage => {
    const f = await fixture()
    if (stage === 'video-prompts') await f.adopt('image-prompts', await f.payload('image-prompts'))
    const payload = await f.payload(stage), before = await f.snapshot()
    let calls = 0
    await expect(generateMotionDramaCandidateV1({ scope: f.scope, stage, episodeNumber: 1,
      runAI: async () => { calls++; return JSON.stringify([payload[0], payload[0]]) } })).rejects.toThrow('shotKey')
    expect(calls).toBe(2)
    const generated = await generateMotionDramaCandidateV1({ scope: f.scope, stage, episodeNumber: 1, runAI: async () => JSON.stringify(payload) })
    const runId = generated.snapshot.run.id
    if (runId == null) throw new Error('Missing candidate run')
    await expect(adoptMotionDramaProfessionalCandidateV1({ scope: f.scope, runId, authorPayload: [payload[0], payload[0]] })).rejects.toThrow('shotKey')
    expect((await f.snapshot()).shots).toEqual(before.shots)
  })

  it.each(['image-prompts', 'video-prompts'] as const)('%s重复、遗漏、额外键和旧revision均零部分写入', async stage => {
    const f = await fixture(), payload = await f.payload(stage)
    const before = await f.snapshot()
    for (const invalid of [[payload[0], payload[0]], [payload[0]], [payload[0], { ...payload[1], shotKey: 'foreign.shot' }],
      [payload[0], { ...payload[1], expectedRevision: payload[1].expectedRevision + 1 }]]) {
      await expect(f.adopt(stage, invalid)).rejects.toThrow()
      const after = await f.snapshot()
      expect(after.shots).toEqual(before.shots)
      expect(after.production).toEqual(before.production)
      expect(after.promptPacks).toEqual(before.promptPacks)
    }
  })

  it.each(['image-prompts', 'video-prompts'] as const)('%s必须先完成全目标验证才发出任一镜头更新', async stage => {
    const f = await fixture(), payload = await f.payload(stage)
    let writes = 0
    const count = () => { writes++ }
    db.motionDramaShots.hook('updating', count)
    try { await expect(f.adopt(stage, [payload[0], { ...payload[1], expectedRevision: 999999 }])).rejects.toThrow() }
    finally { db.motionDramaShots.hook('updating').unsubscribe(count) }
    expect(writes).toBe(0)
  })

  it('正常image/video逐镜更新且每轮revision只加一；其他Work镜头保持原字节', async () => {
    const f = await fixture(), other = await fixture(), sibling = await other.snapshot()
    for (const stage of ['image-prompts', 'video-prompts'] as const) {
      const before = await f.snapshot(), payload = await f.payload(stage)
      await f.adopt(stage, payload)
      const after = await f.snapshot()
      expect(after.shots.map(shot => shot.revision)).toEqual(before.shots.map(shot => shot.revision + 1))
      expect(after.production.revision).toBe(before.production.revision + 1)
      for (const shot of after.shots) expect(stage === 'image-prompts' ? shot.imagePrompt : shot.videoPrompt).toBe(stage === 'image-prompts' ? '静帧' : '合拢检票钳')
    }
    expect((await other.snapshot()).shots).toEqual(sibling.shots)
  })

  it('并发同expectedRevision切集最多一项成功且版本只加一', async () => {
    const f = await fixture(), before = await f.snapshot()
    const results = await Promise.allSettled([2, 3].map(episodeNumber => setCurrentMotionDramaEpisodeV1({ scope: f.scope, episodeNumber, expectedRevision: before.production.revision })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const after = await f.snapshot()
    expect(after.production.revision).toBe(before.production.revision + 1)
    expect([2, 3]).toContain(after.production.currentEpisodeNumber)
  })

  it('省略expectedRevision的合法请求仍串行读取最新根、不回退revision', async () => {
    const f = await fixture(), before = await f.snapshot()
    await Promise.all([2, 3].map(episodeNumber => setCurrentMotionDramaEpisodeV1({ scope: f.scope, episodeNumber })))
    expect((await f.snapshot()).production.revision).toBe(before.production.revision + 2)
  })

  it('排队切集冻结点击时的集号、scope与预期版本，不读取后来改写的请求对象', async () => {
    const f = await fixture(), before = await f.snapshot()
    const input = { scope: { ...f.scope }, episodeNumber: 2, expectedRevision: before.production.revision }
    const pending = setCurrentMotionDramaEpisodeV1(input)
    input.episodeNumber = 0
    input.expectedRevision++
    input.scope.workId = -1
    await pending
    expect((await f.snapshot()).production).toMatchObject({ currentEpisodeNumber: 2, revision: before.production.revision + 1 })
  })

  it('正式IR采纳后旧切集被拒；同集操作及上下界保留既有版本语义', async () => {
    const f = await fixture(), before = await f.snapshot()
    await f.adopt('image-prompts', await f.payload('image-prompts'))
    const adopted = await f.snapshot()
    await expect(setCurrentMotionDramaEpisodeV1({ scope: f.scope, episodeNumber: 2, expectedRevision: before.production.revision })).rejects.toThrow('变化')
    expect((await f.snapshot()).production).toEqual(adopted.production)
    for (const episodeNumber of [0, 4, 201, 1.5]) await expect(setCurrentMotionDramaEpisodeV1({ scope: f.scope, episodeNumber })).rejects.toThrow()
    expect((await f.snapshot()).production).toEqual(adopted.production)
    await setCurrentMotionDramaEpisodeV1({ scope: f.scope, episodeNumber: 1, expectedRevision: adopted.production.revision })
    const same = await f.snapshot()
    expect(same.production.currentEpisodeNumber).toBe(1)
    expect(same.production.revision).toBe(adopted.production.revision + 1)
    await setCurrentMotionDramaEpisodeV1({ scope: f.scope, episodeNumber: 3, expectedRevision: same.production.revision })
    expect((await f.snapshot()).production.currentEpisodeNumber).toBe(3)
  })
})
