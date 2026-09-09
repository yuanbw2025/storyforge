import { expect, test } from '@playwright/test'

test('漫剧工坊从一句话建立独立小说来源并呈现完整八步前期流程', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./')

  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /漫剧工坊/ }).click()
  await page.getByLabel('名称').fill('E2E 末班车回声')
  await page.getByLabel('简介').fill('检票员从废弃车票中听见未完成的告别，却在最后一班车上看见死去的妹妹。')
  await page.getByLabel('漫剧计划集数').fill('12')
  await page.getByLabel('漫剧单集秒数').fill('60')
  await page.getByLabel('漫剧美术方向').fill('雨夜霓虹、冷暖对撞、稳定二维人物与克制电影光影')
  await page.getByRole('button', { name: '创建漫剧工坊', exact: true }).click()

  await expect(page.getByRole('heading', { name: '漫剧工坊', exact: true })).toBeVisible()
  const studio = page.getByTestId('motion-drama-studio')
  await expect(studio).toBeVisible()
  await expect(studio.getByRole('heading', { name: 'E2E 末班车回声', exact: true })).toBeVisible()
  await expect(studio.getByText('9:16', { exact: true })).toBeVisible()
  await expect(studio.getByText('60s / 集', { exact: true })).toBeVisible()
  await expect(studio.getByText('12 集', { exact: true })).toBeVisible()
  await expect(studio.getByText('来源已冻结', { exact: true })).toBeVisible()
  await expect(studio.getByRole('heading', { name: 'E2E 末班车回声 · 原著', exact: true })).toBeVisible()

  for (const step of ['小说来源', '系列圣经', '物料圣经', '单集节拍', '漫剧剧本', '分镜与双 IR', '工具适配包', '审查与发布']) {
    await expect(studio.locator('.motion-rail').getByText(step, { exact: true })).toBeVisible()
  }

  await studio.getByRole('button', { name: /提示词库/ }).click()
  const library = page.locator('.motion-prompt-library')
  await expect(library.getByRole('heading', { name: '漫剧专业提示词库', exact: true })).toBeVisible()
  await expect(library.getByText('优先级：单集覆盖 ＞ 项目覆盖 ＞ 内置专业基线', { exact: true })).toBeVisible()
  await expect(library.locator('textarea')).toContainText('不针对任何比赛、活动或单一厂商')
  await library.locator('header button').click()

  await studio.locator('.motion-rail').getByRole('button', { name: /物料圣经/ }).click()
  await expect(studio.getByText('角色身份与服装分开版本化', { exact: false })).toBeVisible()
  await studio.locator('.motion-rail').getByRole('button', { name: /工具适配包/ }).click()
  for (const provider of ['SEEDANCE', 'RUNWAY', 'LTX']) await expect(studio.getByText(provider, { exact: true })).toBeVisible()
  await expect(studio.getByText('适配包不会调用或冒充目标视频工具。', { exact: false })).toBeVisible()

  await studio.locator('.motion-rail').getByRole('button', { name: /审查与发布/ }).click()
  await expect(studio.getByText('DELIVERY READINESS', { exact: true })).toBeVisible()
  await expect(studio.getByRole('button', { name: '发布 Prompt-only 包', exact: true })).toBeDisabled()
  await expect(studio.getByRole('button', { name: '发布 Reference-ready 包', exact: true })).toBeDisabled()

  const state = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const project = (await db.projects.toArray()).find((row: any) => row.name === 'E2E 末班车回声 · 原著')
    const works = await db.works.where('projectId').equals(project.id).toArray()
    const adaptation = await db.adaptationProjects.where('projectId').equals(project.id).first()
    const production = await db.motionDramaProductions.where('projectId').equals(project.id).first()
    return { workKinds: works.map((work: any) => work.kind).sort(), medium: adaptation.medium, phase: production.phase }
  })
  expect(state).toEqual({ workKinds: ['motion-drama', 'novel'], medium: 'motion-drama', phase: 'source' })
})

test('粘贴小说正文先建立独立来源 Work，再以完整正文解锁漫剧改编', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /漫剧工坊/ }).click()
  await page.getByLabel('名称').fill('E2E 导入原著')
  await page.getByLabel('简介').fill('一次无法撤销的地铁告别。')
  await page.getByLabel('漫剧故事来源').selectOption('import-text')
  await page.getByLabel('导入漫剧小说正文').fill('午夜前，林岚在封闭站台捡到一张写着妹妹名字的旧车票。检票钳自行合拢，隧道里传来三年前那句没有说完的告别。她抬起头，熄灭三年的站台灯正一盏一盏亮向隧道深处。')
  await page.getByRole('button', { name: '创建漫剧工坊', exact: true }).click()

  const studio = page.getByTestId('motion-drama-studio')
  await expect(studio).toBeVisible()
  await expect(studio.getByText('完整正文', { exact: true })).toBeVisible()
  await expect(studio.getByText('先完成小说，再进入漫剧改编', { exact: true })).toHaveCount(0)
  await studio.locator('.motion-rail').getByRole('button', { name: /系列圣经/ }).click()
  await expect(studio.getByRole('button', { name: '生成专业候选', exact: true })).toBeEnabled()

  const state = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const source = (await db.works.toArray()).find((row: any) => row.title === 'E2E 导入原著 · 原著')
    const chapter = (await db.chapters.toArray()).find((row: any) => row.workId === source.id)
    const adaptation = (await db.adaptationProjects.toArray()).find((row: any) => row.sourceWorkId === source.id)
    return { sourceKind: source.kind, chapterStatus: chapter.status, hasContent: chapter.content.includes('封闭站台'), coverage: adaptation.sourceCoverage }
  })
  expect(state).toEqual({ sourceKind: 'novel', chapterStatus: 'draft', hasContent: true, coverage: 'full-text' })
})

test('Seedance 执行包呈现能力画像、真实槽位、时间轴、镜间交接与返修入口', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./')
  await page.getByRole('banner').getByRole('button', { name: '新建', exact: true }).click()
  await page.getByRole('button', { name: /漫剧工坊/ }).click()
  await page.getByLabel('名称').fill('E2E Seedance 执行包')
  await page.getByLabel('简介').fill('检票员从旧车票里听见失踪妹妹的声音。')
  await page.getByLabel('漫剧故事来源').selectOption('import-text')
  await page.getByLabel('导入漫剧小说正文').fill('午夜，林岚拾起妹妹留下的旧车票。检票钳自行咬下，熄灭三年的站台灯逐盏亮向隧道，车窗里出现了妹妹。')
  await page.getByLabel('漫剧单集秒数').fill('20')
  await page.getByRole('button', { name: '创建漫剧工坊', exact: true }).click()

  const compiled = await page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { listActiveSourceUnits } = await importer('/storyforge/src/lib/adaptation/source-manifest.ts')
    const service = await importer('/storyforge/src/lib/motion-drama/service.ts')
    const packs = await importer('/storyforge/src/lib/motion-drama/prompt-pack.ts')
    const adaptation = (await db.adaptationProjects.toArray()).find((row: any) => row.medium === 'motion-drama')
    const work = (await db.works.toArray()).find((row: any) => row.kind === 'motion-drama')
    const scope = { projectId: adaptation.projectId, worldId: adaptation.worldId, workId: work.id }
    const sourceUnitKey = (await listActiveSourceUnits(adaptation.id)).find((row: any) => row.sourceKind === 'chapter').sourceUnitKey
    const adopt = async (stage: string, payload: unknown) => {
      const studio = await service.loadMotionDramaStudioV1(scope)
      await service.adoptMotionDramaCandidateV1({ scope, stage, payload, episodeNumber: 1, expectedAdaptationRevision: studio.adaptation.revision, expectedProductionRevision: studio.production.revision })
    }
    await adopt('series-bible', {
      version: 1, titlePromise: '旧车票会让未完成的告别重新上车。', logline: '夜班检票员必须在末班车消失前决定是否追上死去的妹妹。', coreTheme: '接受失去不是遗忘。', emotionalPromise: '悬疑中的克制治愈。', audiencePromise: '每集一次异常回声与一个不可逆选择。', storyEngine: '旧票触发回声，选择真相就会失去一段记忆。', worldRules: ['回声只在末班车前出现。'], seasonArc: '林岚从追索妹妹到接受告别。', protagonistArc: '从控制失去到承担失去。', relationshipArcs: ['姐妹误解逐集反转。'], episodeArchitecture: '异常冷开场，压力升级，代价尾钩。', hookPatterns: ['物件异常'], visualLanguage: ['冷蓝现实与琥珀回声'], soundLanguage: ['检票钳声触发能力'], continuityRules: ['左眉旧伤固定。'], productionConstraints: ['单镜不超过十秒。'],
    })
    await adopt('asset-bible', [{ stableKey: 'character.linlan', kind: 'character', label: '林岚', identity: '28岁东亚女性，左眉旧伤。', appearance: '黑色短发，克制警觉。', palette: ['冷蓝'], materials: ['湿呢料'], continuityLocks: ['左眉旧伤', '右手持钳'], prohibitedChanges: ['左右翻转'], basePrompt: '二维漫剧角色设定，林岚，左眉旧伤。', negativePrompt: '换脸，换装。', referenceBrief: '正侧面与持钳姿态。', sourceUnitKeys: [sourceUnitKey] }, { stableKey: 'voice.linlan', kind: 'voice', label: '林岚音色', identity: '成年女声，低沉克制。', appearance: '中低音区。', palette: [], materials: [], continuityLocks: ['普通语速'], prohibitedChanges: ['幼态'], basePrompt: '中低音区克制女声。', negativePrompt: '播音腔。', referenceBrief: '干声试听。', sourceUnitKeys: [sourceUnitKey] }, { stableKey: 'sound.ticket', kind: 'sound', label: '检票钳声', identity: '金属咔哒后接隧道低频。', appearance: '短促近场瞬态。', palette: [], materials: ['金属'], continuityLocks: ['音色固定'], prohibitedChanges: ['卡通音效'], basePrompt: '金属检票钳咔哒。', negativePrompt: '爆音。', referenceBrief: '两秒干净试听。', sourceUnitKeys: [sourceUnitKey] }])
    await adopt('episode-outline', { stableKey: 'episode.1', episodeNumber: 1, title: '妹妹的车票', logline: '旧车票召回妹妹的声音。', synopsis: '车票启动回声，神秘列车进站。', openingHook: '检票钳无人触碰却自行合拢。', beats: [{ stableKey: 'episode.1.beat.1', order: 0, function: 'hook', visibleAction: '检票钳咬穿车票。', conflict: '林岚想丢票却听见妹妹。', turn: '车票显出妹妹姓名。', targetSeconds: 10, sourceUnitKeys: [sourceUnitKey] }, { stableKey: 'episode.1.beat.2', order: 1, function: 'cliffhanger', visibleAction: '站台灯亮向隧道。', conflict: '列车即将进站。', turn: '车窗内坐着妹妹。', targetSeconds: 10, sourceUnitKeys: [sourceUnitKey] }], endHook: '妹妹隔窗抬眼。', continuityIn: [], continuityOut: ['神秘列车进站。'], sourceUnitKeys: [sourceUnitKey] })
    await adopt('episode-script', [{ stableKey: 'episode.1.scene.1', episodeNumber: 1, sceneNumber: 1, order: 0, heading: '内景·封闭站台·午夜', location: '废弃站台', timeOfDay: '午夜', dramaticPurpose: '异常物件召回妹妹。', entryState: '林岚独自巡检。', exitState: '神秘列车进站。', visibleAction: '检票钳自行合拢，林岚抬头看见列车。', dialogue: [{ speakerKey: 'character.linlan', text: '不可能。', delivery: '压住颤抖', estimatedSeconds: 2 }], narration: '', soundCues: [{ kind: 'sfx', cue: '检票钳声', timing: '动作点', subjectKey: 'sound.ticket' }], emotionalTurn: '冷静被恐惧击穿。', estimatedSeconds: 20, characterKeys: ['character.linlan'], sourceUnitKeys: [sourceUnitKey] }])
    const base = { episodeNumber: 1, sceneKey: 'episode.1.scene.1', narrativeFunction: '用异常推动悬疑', targetSeconds: 10, cameraAngle: 'eye-level', cameraMovement: 'dolly', performance: '呼吸变浅，目光由车票抬向隧道。', lighting: '冷蓝顶灯与琥珀逆光。', narration: '', soundPlan: [{ kind: 'sfx', cue: '检票钳咔哒', timing: '动作同步', subjectKey: 'sound.ticket' }], subjectKeys: ['character.linlan'], sourceUnitKeys: [sourceUnitKey], imagePrompt: '', negativeImagePrompt: '', firstFramePrompt: '', keyFramePrompt: '', lastFramePrompt: '', videoPrompt: '', negativeVideoPrompt: '' }
    await adopt('shot-design', [{ ...base, stableKey: 'episode.1.shot.1', shotNumber: 1, order: 0, shotSize: 'close-up', composition: '手与车票占前景，林岚虚焦在后。', visibleAction: '检票钳自行咬穿旧车票。', transitionIn: 'cut', transitionOut: 'match-cut', dialogue: '林岚：不可能。' }, { ...base, stableKey: 'episode.1.shot.2', shotNumber: 2, order: 1, shotSize: 'medium', composition: '林岚在左侧三分线，隧道光从右后逼近。', visibleAction: '林岚抬头，列车窗内显出妹妹。', transitionIn: 'match-cut', transitionOut: 'cut', dialogue: '' }])
    let studio = await service.loadMotionDramaStudioV1(scope)
    await adopt('image-prompts', studio.shots.map((shot: any) => ({ shotKey: shot.stableKey, expectedRevision: shot.revision, imagePrompt: `${shot.visibleAction}，电影化二维漫剧。`, negativeImagePrompt: '换脸，额外肢体，文字，水印。', firstFramePrompt: `${shot.visibleAction}前的稳定动作起点。`, keyFramePrompt: `${shot.visibleAction}的动作峰值。`, lastFramePrompt: `${shot.visibleAction}后的稳定停点。` })))
    studio = await service.loadMotionDramaStudioV1(scope)
    await adopt('video-prompts', studio.shots.map((shot: any) => ({ shotKey: shot.stableKey, expectedRevision: shot.revision, videoPrompt: `从稳定姿态开始，${shot.visibleAction}，环境光响应，摄影机缓慢推进，动作落到停点。`, negativeVideoPrompt: '抽搐，融化，瞬移，循环，镜头乱摆。' })))
    const png = new Uint8Array(32); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); new DataView(png.buffer).setUint32(16, 1024); new DataView(png.buffer).setUint32(20, 1536)
    const wav = new Uint8Array(44); wav.set([82, 73, 70, 70], 0); wav.set([87, 65, 86, 69], 8); wav.set([102, 109, 116, 32], 12); wav.set([100, 97, 116, 97], 36)
    const rights = () => ({ version: 1, source: 'author-upload', commercialUse: 'allowed', redistribution: 'allowed', attribution: '', declaration: 'E2E 测试拥有完整商用与再分发权利。', declaredAt: Date.now() })
    await service.commitMotionDramaAssetReferenceV1({ scope, subjectKey: 'character.linlan', data: png.buffer, rights: rights() })
    await service.commitMotionDramaAssetReferenceV1({ scope, subjectKey: 'voice.linlan', data: wav.buffer, rights: rights() })
    await service.commitMotionDramaAssetReferenceV1({ scope, subjectKey: 'sound.ticket', data: wav.buffer, rights: rights() })
    studio = await service.loadMotionDramaStudioV1(scope)
    for (const shot of studio.shots) await service.commitMotionDramaShotReferenceV1({ scope, shotKey: shot.stableKey, role: 'start-frame', data: png.buffer, rights: rights() })
    studio = await service.loadMotionDramaStudioV1(scope)
    const row = await packs.compileMotionDramaPromptPackV1({ scope, episodeNumber: 1, provider: 'seedance', providerProfileId: 'seedance-2.5-2026-07', expectedProductionRevision: studio.production.revision })
    const manifest = await packs.verifyMotionDramaPromptPackV1(row)
    return { version: manifest.version, directUseReady: manifest.directUseReady }
  })
  expect(compiled).toEqual({ version: 2, directUseReady: true })

  await page.reload()
  await page.getByText('继续创作', { exact: true }).click()
  const studio = page.getByTestId('motion-drama-studio')
  await studio.locator('.motion-rail').getByRole('button', { name: /工具适配包/ }).click()
  await expect(studio.getByLabel('Seedance 能力画像')).toHaveValue('seedance-2.5-2026-07')
  await expect(studio.getByRole('heading', { name: '逐镜生成、选片与交接运行单', exact: true })).toBeVisible()
  await expect(studio.getByText('可直接投喂', { exact: true }).last()).toBeVisible()
  await expect(studio.getByText('SHOT 01', { exact: true })).toBeVisible()
  await expect(studio.getByText('图片1', { exact: true }).first()).toBeVisible()
  await expect(studio.getByText('@图片1：锁定镜头起始构图', { exact: false }).first()).toBeVisible()
  await expect(studio.getByText('match-cut', { exact: false }).last()).toBeVisible()
  await expect(studio.getByRole('button', { name: '复制镜头 1 Seedance 提示词', exact: true })).toBeVisible()
})
