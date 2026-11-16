import { expect, test } from '@playwright/test'
import type { MotionDramaPromptStageV1, MotionDramaShotCandidateV1 } from '../../src/lib/types'

test('SFQA023024 native IR adoption rejects duplicate shots and concurrent episode CAS stays visible after reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto('./motion/library')
  await page.getByRole('button', { name: '新建素材项目', exact: true }).click()
  await page.getByLabel('漫剧素材名称', { exact: true }).fill('SFQA023024 事务')
  await page.getByLabel('来源方式', { exact: true }).selectOption('import')
  await page.getByLabel('计划集数', { exact: true }).fill('3')
  await page.getByLabel('单集目标秒数', { exact: true }).fill('20')
  await page.getByLabel('导入原作内容', { exact: true }).fill('午夜，林岚走到站台。旧车票上浮现了妹妹的姓名，检票钳自行合拢，熄灭三年的站台灯逐盏亮向隧道。')
  await page.getByRole('button', { name: '创建漫剧素材', exact: true }).click()
  await expect(page.getByTestId('motion-drama-studio')).toBeVisible()
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { listActiveSourceUnits } = await load<typeof import('../../src/lib/adaptation/source-manifest')>('/storyforge/src/lib/adaptation/source-manifest.ts')
    const { adoptMotionDramaCandidateV1, loadMotionDramaStudioV1, setCurrentMotionDramaEpisodeV1 } = await load<typeof import('../../src/lib/motion-drama/service')>('/storyforge/src/lib/motion-drama/service.ts')
    const work = (await db.works.toArray()).find(row => row.kind === 'motion-drama' && row.title === 'SFQA023024 事务')
    const adaptation = work?.id == null ? undefined : await db.adaptationProjects.where('workId').equals(work.id).first()
    if (!adaptation?.id || !adaptation.worldId || !work?.id) throw new Error('Missing created MotionDrama roots')
    const scope = { projectId: adaptation.projectId, worldId: adaptation.worldId, workId: work.id }
    const unit = (await listActiveSourceUnits(adaptation.id)).find(row => row.sourceKind === 'chapter')
    if (!unit) throw new Error('Missing frozen chapter source')
    const adopt = async (stage: MotionDramaPromptStageV1, payload: unknown) => {
      const studio = await loadMotionDramaStudioV1(scope)
      await adoptMotionDramaCandidateV1({ scope, stage, payload, episodeNumber: 1,
        expectedAdaptationRevision: studio.adaptation.revision, expectedProductionRevision: studio.production.revision })
    }
    await adopt('series-bible', { version: 1, titlePromise: '末班车回声', logline: '林岚发现异常车票', coreTheme: '面对失去', emotionalPromise: '悬疑',
      audiencePromise: '逐步揭谜', storyEngine: '车票触发回声', worldRules: ['回声在夜间出现'], seasonArc: '接受告别', protagonistArc: '承认失去',
      relationshipArcs: ['找回与妹妹的联系'], episodeArchitecture: '异常、选择、钩子', hookPatterns: ['物件异常'], visualLanguage: ['冷光'], soundLanguage: ['钳子声'], continuityRules: ['持钳手固定'], productionConstraints: ['单场景'] })
    await adopt('asset-bible', [{ stableKey: 'prop.punch', kind: 'prop', label: '检票钳', identity: '银色检票钳', appearance: '磨损金属', palette: ['银色'], materials: ['金属'],
      continuityLocks: ['银色'], prohibitedChanges: ['变色'], basePrompt: '银色检票钳', negativePrompt: '水印', referenceBrief: '近景', sourceUnitKeys: [unit.sourceUnitKey] }])
    await adopt('episode-outline', { stableKey: 'episode.1', episodeNumber: 1, title: '回声', logline: '发现车票', synopsis: '检票钳合拢', openingHook: '异常声音',
      beats: [{ stableKey: 'beat.one', order: 0, function: 'hook', visibleAction: '钳子合拢', conflict: '试图离开', turn: '看到姓名', targetSeconds: 20, sourceUnitKeys: [unit.sourceUnitKey] }],
      endHook: '列车到来', continuityIn: [], continuityOut: ['保留车票'], sourceUnitKeys: [unit.sourceUnitKey] })
    await adopt('episode-script', [{ stableKey: 'scene.one', episodeNumber: 1, sceneNumber: 1, order: 0, heading: '内景 站台 夜', location: '站台', timeOfDay: '夜', dramaticPurpose: '启动异常',
      entryState: '寂静', exitState: '钳子合拢', visibleAction: '检票钳合拢', dialogue: [], narration: '', soundCues: [], emotionalTurn: '惊讶', estimatedSeconds: 20, characterKeys: [], sourceUnitKeys: [unit.sourceUnitKey] }])
    const shots: MotionDramaShotCandidateV1[] = [0, 1].map(order => ({ stableKey: `shot.${order + 1}`, episodeNumber: 1, shotNumber: order + 1, sceneKey: 'scene.one', order,
      narrativeFunction: '推进异常', targetSeconds: 10, shotSize: 'medium', cameraAngle: 'eye-level', cameraMovement: 'static', composition: '居中', visibleAction: '检票钳合拢', performance: '克制', lighting: '冷光',
      transitionIn: '', transitionOut: '', dialogue: '', narration: '', soundPlan: [], subjectKeys: [], sourceUnitKeys: [unit.sourceUnitKey], imagePrompt: '', negativeImagePrompt: '', firstFramePrompt: '', keyFramePrompt: '', lastFramePrompt: '', videoPrompt: '', negativeVideoPrompt: '' }))
    await adopt('shot-design', shots)
    const before = await loadMotionDramaStudioV1(scope)
    const image = before.shots.map(shot => ({ shotKey: shot.stableKey, expectedRevision: shot.revision, imagePrompt: '静帧', negativeImagePrompt: '水印', firstFramePrompt: '起始姿态', keyFramePrompt: '动作峰值', lastFramePrompt: '结束姿态' }))
    const duplicateRejected = await adopt('image-prompts', [image[0], image[0]]).then(() => false, () => true)
    const afterInvalid = await loadMotionDramaStudioV1(scope)
    await adopt('image-prompts', image)
    const afterImage = await loadMotionDramaStudioV1(scope)
    await adopt('video-prompts', afterImage.shots.map(shot => ({ shotKey: shot.stableKey, expectedRevision: shot.revision, videoPrompt: '合拢检票钳', negativeVideoPrompt: '身份漂移' })))
    const afterVideo = await loadMotionDramaStudioV1(scope)
    const switches = await Promise.allSettled([2, 3].map(episodeNumber => setCurrentMotionDramaEpisodeV1({ scope, episodeNumber, expectedRevision: afterVideo.production.revision })))
    const final = await loadMotionDramaStudioV1(scope)
    return { duplicateRejected, before: { shots: before.shots, production: before.production }, afterInvalid: { shots: afterInvalid.shots, production: afterInvalid.production },
      afterImage: afterImage.shots, afterVideo: afterVideo.shots, switches: switches.map(row => row.status), final: final.production, beforeSwitch: afterVideo.production }
  })
  expect(result.duplicateRejected).toBe(true)
  expect(result.afterInvalid).toEqual(result.before)
  expect(result.afterImage.map(shot => shot.revision)).toEqual(result.before.shots.map(shot => shot.revision + 1))
  expect(result.afterVideo.map(shot => shot.revision)).toEqual(result.before.shots.map(shot => shot.revision + 2))
  expect(result.switches.filter(status => status === 'fulfilled')).toHaveLength(1)
  expect(result.final.revision).toBe(result.beforeSwitch.revision + 1)
  await page.reload()
  await expect(page.getByLabel('当前漫剧集数')).toHaveValue(String(result.final.currentEpisodeNumber))
  await page.getByLabel('当前漫剧集数').selectOption('1')
  await expect(page.getByLabel('当前漫剧集数')).toHaveValue('1')
  await expect.poll(() => page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    return (await db.motionDramaProductions.get(id))?.currentEpisodeNumber
  }, result.final.id)).toBe(1)
  await page.reload()
  await expect(page.getByLabel('当前漫剧集数')).toHaveValue('1')
  expect(errors).toEqual([])
})
