import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { expect, test } from '@playwright/test'
import type { MotionDramaPromptStageV1, MotionDramaShotCandidateV1, MediaRightsV1 } from '../../src/lib/types'

test('SFQA025 missing frozen pin fails visibly and restored release downloads the original bytes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route(/^https?:\/\//, route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto('./motion/library')
  await page.getByRole('button', { name: '新建素材项目', exact: true }).click()
  await page.getByLabel('漫剧素材名称', { exact: true }).fill('SFQA025 冻结交付')
  await page.getByLabel('来源方式', { exact: true }).selectOption('import')
  await page.getByLabel('计划集数', { exact: true }).fill('1')
  await page.getByLabel('单集目标秒数', { exact: true }).fill('20')
  await page.getByLabel('导入原作内容', { exact: true }).fill('午夜，林岚走到站台。旧车票上浮现了妹妹的姓名，检票钳自行合拢，熄灭三年的站台灯逐盏亮向隧道。')
  await page.getByRole('button', { name: '创建漫剧素材', exact: true }).click()
  await expect(page.getByTestId('motion-drama-studio')).toBeVisible()
  const versionsUrl = page.url().replace('/source?', '/versions?')
  const result = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { listActiveSourceUnits } = await load<typeof import('../../src/lib/adaptation/source-manifest')>('/storyforge/src/lib/adaptation/source-manifest.ts')
    const { adoptMotionDramaCandidateV1, loadMotionDramaStudioV1, commitMotionDramaAssetReferenceV1, commitMotionDramaShotReferenceV1 } = await load<typeof import('../../src/lib/motion-drama/service')>('/storyforge/src/lib/motion-drama/service.ts')
    const work = (await db.works.toArray()).find(row => row.kind === 'motion-drama' && row.title === 'SFQA025 冻结交付')
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
    let studio = await loadMotionDramaStudioV1(scope)
    await adopt('image-prompts', studio.shots.map(shot => ({ shotKey: shot.stableKey, expectedRevision: shot.revision, imagePrompt: '静帧', negativeImagePrompt: '水印', firstFramePrompt: '起始姿态', keyFramePrompt: '动作峰值', lastFramePrompt: '结束姿态' })))
    studio = await loadMotionDramaStudioV1(scope)
    await adopt('video-prompts', studio.shots.map(shot => ({ shotKey: shot.stableKey, expectedRevision: shot.revision, videoPrompt: '合拢检票钳', negativeVideoPrompt: '身份漂移' })))
    const data = () => Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAkAAAAQCAYAAADESFVDAAAAFklEQVR4nGNQSJjwnxBmGFU0qog4RQAOMiiAK29a7QAAAABJRU5ErkJggg=='), char => char.charCodeAt(0)).buffer
    const rights: MediaRightsV1 = { version: 1, source: 'author-upload', commercialUse: 'allowed', redistribution: 'allowed', attribution: '', declaration: '隔离合成测试素材', declaredAt: 1 }
    await commitMotionDramaAssetReferenceV1({ scope, subjectKey: 'prop.punch', data: data(), rights })
    for (const shot of studio.shots) await commitMotionDramaShotReferenceV1({ scope, shotKey: shot.stableKey, role: 'start-frame', data: data(), rights })
    const { compileMotionDramaPromptPackV1 } = await load<typeof import('../../src/lib/motion-drama/prompt-pack')>('/storyforge/src/lib/motion-drama/prompt-pack.ts')
    const { publishMotionDramaReleaseV1 } = await load<typeof import('../../src/lib/motion-drama/release')>('/storyforge/src/lib/motion-drama/release.ts')
    const { exportMotionMaterialBundle } = await load<typeof import('../../src/lib/motion-drama/delivery')>('/storyforge/src/lib/motion-drama/delivery.ts')
    studio = await loadMotionDramaStudioV1(scope)
    await compileMotionDramaPromptPackV1({ scope, episodeNumber: 1, provider: 'seedance', expectedProductionRevision: studio.production.revision })
    await adopt('quality-review', [])
    studio = await loadMotionDramaStudioV1(scope)
    const release = await publishMotionDramaReleaseV1({ scope, episodeNumbers: [1], providers: ['seedance'], tier: 'reference-ready', expectedProductionRevision: studio.production.revision })
    const pins = await db.creationReleaseAssets.where('releaseId').equals(release.id).toArray()
    const blob = await exportMotionMaterialBundle(scope, release.id)
    if (blob.size === 0 || !pins[0]?.id) throw new Error('Missing valid baseline bundle/pins')
    await db.creationReleaseAssets.delete(pins[0].id)
    return { release, missingPin: pins[0], pinKeys: pins.map(pin => pin.assetKey), expectedBytes: Array.from(new Uint8Array(data())) }
  })
  await page.goto(versionsUrl)
  await page.getByRole('button', { name: '下载提示词与素材 ZIP', exact: true }).click()
  await expect(page.getByText(/冻结素材pin缺失/)).toBeVisible()
  await page.evaluate(async pin => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    await db.creationReleaseAssets.put(pin)
  }, result.missingPin)
  await page.reload()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载提示词与素材 ZIP', exact: true }).click()
  const file = await downloading
  expect(file.suggestedFilename()).toMatch(/-v1\.zip$/)
  const path = await file.path()
  if (!path) throw new Error('Missing native download')
  const zip = await JSZip.loadAsync(await readFile(path))
  expect(JSON.parse(await zip.file('manifest.json')!.async('string'))).toEqual(JSON.parse(result.release.manifestJson))
  const index = JSON.parse(await zip.file('references.json')!.async('string')) as Array<{ key: string; file: string }>
  expect(index.map(row => row.key).sort()).toEqual(result.pinKeys.sort())
  for (const row of index) expect(Array.from(await zip.file(row.file)!.async('uint8array'))).toEqual(result.expectedBytes)
  const unchanged = await page.evaluate(async expected => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const row = await db.creationReleases.get(expected.id)
    return row?.manifestJson === expected.manifestJson && row.contentHash === expected.contentHash
  }, result.release)
  expect(unchanged).toBe(true)
  expect(errors).toEqual([])
})
