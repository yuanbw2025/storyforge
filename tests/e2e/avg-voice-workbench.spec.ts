import { expect, test, type Page } from '@playwright/test'

async function openVoiceDraft(page: Page) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const seed = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, editor, presets, config] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),
      load('/storyforge/src/lib/avg/editor-service.ts'), load('/storyforge/src/lib/avg/authoring-presets.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const owner = await drafts.createAvgDraftV1('配音需求原生表单工程验证'), workspace = presets.createAvgAuthoringPresetV1('linear')
    await editor.saveAvgAuthorWorkspaceV1(owner.scope, 0, workspace)
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: '', model: 'text-fixture-unused', baseUrl: 'https://speech.fixture.invalid/v1' })
    return { scope: owner.scope, scripts: workspace.scripts, systemPlan: workspace.systemPlan }
  })
  let requests = 0
  await page.route('https://speech.fixture.invalid/**', async route => { requests++; await route.abort() })
  await page.route('http://127.0.0.1:5297/**', async route => { requests++; await route.abort() })
  await page.goto(`./avg/production?project=${seed.scope.projectId}&work=${seed.scope.workId}`)
  // A saved editor draft opens its actual workbench automatically.
  await expect(page.getByRole('region', { name: '系统与效果组装（实验）', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '素材', exact: true }).click()
  const panel = page.getByRole('region', { name: '逐句配音需求草稿', exact: true })
  await expect(panel.getByText(/本机免费配音/)).toBeVisible()
  await panel.getByRole('checkbox', { name: /第 1 句/ }).first().check()
  await panel.getByRole('combobox', { name: '音色', exact: true }).selectOption('Serena')
  await panel.getByRole('textbox', { name: '音色使用权说明', exact: true }).fill('原创工程声明 e\u0301；不是供应商商用许可或真实人声证据')
  await panel.getByRole('textbox', { name: '音色条款或授权依据', exact: true }).fill('本测试原创声明，待真实服务校准')
  return { seed, panel, requests: () => requests }
}

test('voice draft saves from native form, blocks other edits while pending and survives refresh without any provider call', async ({ page }, info) => {
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1', 'Experimental media workbench is disabled by default')
  const s = await openVoiceDraft(page)
  await expect(page.getByRole('button', { name: '保存编辑草稿', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '制作与试玩', exact: true })).toBeDisabled()
  await expect(page.getByRole('region', { name: '图片生产（实验）', exact: true }).getByLabel('需求名称', { exact: true })).toBeDisabled()
  await s.panel.getByRole('button', { name: '保存配音需求草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '准确配音需求已保存' })).toBeVisible()
  await expect(page.getByRole('button', { name: '制作与试玩', exact: true })).toBeEnabled()
  await page.reload()
  await page.getByRole('button', { name: '素材', exact: true }).click()
  const panel = page.getByRole('region', { name: '逐句配音需求草稿', exact: true })
  await expect(panel.getByText(/本机免费配音/)).toBeVisible()
  await expect(panel.getByRole('combobox', { name: '音色', exact: true })).toHaveValue('Serena')
  const closedNotice = page.getByText('实验性配音生产尚未开放；可以保存需求草稿并查看已有记录。', { exact: true })
  if (process.env.VITE_STORYFORGE_AVG_VOICE_PRODUCTION === '1') await expect(closedNotice).not.toBeVisible()
  else await expect(closedNotice).toBeVisible()
  const actual = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, contract, schema] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),
      load('/storyforge/src/lib/avg/voice-draft-contract.ts'), load('/storyforge/src/lib/db/schema.ts')])
    const draft = await drafts.readAvgDraftV1(scope), workspace = JSON.parse(draft.editorJson)
    const { voice } = await contract.assertAvgVoiceDraftV1(workspace.voiceProduction)
    return { voice, scripts: workspace.scripts, systemPlan: workspace.systemPlan,
      builds: await schema.db.productBuilds.count(), artifacts: await schema.db.productBuildArtifacts.count(), blobs: await schema.db.mediaBlobObjects.count() }
  }, s.seed.scope)
  expect(actual.scripts).toEqual(s.seed.scripts); expect(actual.systemPlan).toEqual(s.seed.systemPlan)
  expect(actual.voice.protocol.provider).toBe('storyforge-local-qwen3')
  expect(actual.voice.protocol.supportsInstructions).toBe(true)
  expect(actual.voice.protocol.speedRange).toBeNull()
  expect(actual.voice.batch.presets[0].rights.declaration).toContain('e\u0301')
  expect(actual.voice.batch.requirements[0].text).toBe(s.seed.scripts[0].lines[0].text)
  expect([actual.builds, actual.artifacts, actual.blobs, s.requests()]).toEqual([0, 0, 0, 0])
  await page.screenshot({ path: info.outputPath('avg-voice-draft-native-saved.png') })
})

test('voice draft preserves an actual concurrent saved revision and keeps the rejected native form available for correction', async ({ page }, info) => {
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1', 'Experimental media workbench is disabled by default')
  const s = await openVoiceDraft(page)
  const changed = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const drafts = await load('/storyforge/src/lib/avg/draft-service.ts'), editor = await load('/storyforge/src/lib/avg/editor-service.ts')
    const draft = await drafts.readAvgDraftV1(scope), workspace = JSON.parse(draft.editorJson)
    workspace.systemPlan.title += ' 另一编辑器的修订'
    return (await editor.saveAvgAuthorWorkspaceV1(scope, draft.revision, workspace)).editorJson
  }, s.seed.scope)
  await s.panel.getByRole('button', { name: '保存配音需求草稿', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '已变化' })).toBeVisible()
  await expect(s.panel.getByRole('combobox', { name: '音色', exact: true })).toHaveValue('Serena')
  await expect(page.getByRole('button', { name: '制作与试玩', exact: true })).toBeDisabled()
  const actual = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/avg/draft-service.ts')).readAvgDraftV1(scope)).editorJson
  }, s.seed.scope)
  expect(actual).toBe(changed); expect(JSON.parse(actual).voiceProduction).toBeUndefined(); expect(s.requests()).toBe(0)
  await page.screenshot({ path: info.outputPath('avg-voice-draft-stale-native-retained.png') })
})


// Native controls and durable draft only; actual DSP bytes are checked by the
// dedicated native Worker case. No inference, adoption or author-data writes.
test('explicit audio processing controls save the exact V2 requirement and survive native refresh without dispatch', async ({ page }, info) => {
  test.skip(process.env.VITE_STORYFORGE_AVG_MEDIA_PRODUCTION !== '1' || process.env.VITE_STORYFORGE_AVG_AUDIO_PROCESSING !== '1',
    'Experimental media and audio processing are disabled by default')
  const s = await openVoiceDraft(page)
  await s.panel.getByRole('button', { name: '保存配音需求草稿', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '准确配音需求已保存' })).toBeVisible()
  const processing = page.getByRole('region', { name: '配音本地音量调整', exact: true })
  await expect(processing.getByText('目前可以保存调整要求，正式加工尚未开放。保存不会生成或修改音频。', { exact: true })).not.toBeVisible()
  await processing.getByRole('checkbox', { name: '调整此句音量', exact: true }).check()
  await processing.getByRole('spinbutton', { name: '音量增减（dB）', exact: true }).fill('7')
  await processing.getByRole('checkbox', { name: '缓和突出的音量尖峰', exact: true }).check()
  await processing.getByRole('combobox', { name: '采样率', exact: true }).selectOption('explicit')
  await processing.getByRole('spinbutton', { name: '指定采样率（Hz）', exact: true }).fill('48000')
  await processing.getByRole('textbox', { name: '调整说明', exact: true }).fill('原生界面保存本地加工要求，原件保留，结果待独立试听。')
  await expect(page.getByRole('button', { name: '制作与试玩', exact: true })).toBeDisabled()
  await processing.getByRole('button', { name: '保存音量调整要求', exact: true }).click()
  await expect(processing.getByRole('button', { name: '保存音量调整要求', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '制作与试玩', exact: true })).toBeEnabled()
  await page.reload()
  await page.getByRole('button', { name: '素材', exact: true }).click()
  await expect(processing.getByRole('checkbox', { name: '调整此句音量', exact: true })).toBeChecked()
  await expect(processing.getByRole('spinbutton', { name: '音量增减（dB）', exact: true })).toHaveValue('7')
  await expect(processing.getByRole('checkbox', { name: '缓和突出的音量尖峰', exact: true })).toBeChecked()
  await expect(processing.getByRole('combobox', { name: '采样率', exact: true })).toHaveValue('explicit')
  await expect(processing.getByRole('spinbutton', { name: '指定采样率（Hz）', exact: true })).toHaveValue('48000')
  const actual = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, contract, schema] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'),
      load('/storyforge/src/lib/avg/author-workspace-contract.ts'), load('/storyforge/src/lib/db/schema.ts')])
    const draft = await drafts.readAvgDraftV1(scope), workspace = contract.parseAvgAuthorWorkspaceV1(draft.editorJson)
    return { processing: workspace.voiceProcessing, scripts: workspace.scripts, systemPlan: workspace.systemPlan,
      builds: await schema.db.productBuilds.count(), artifacts: await schema.db.productBuildArtifacts.count(),
      blobs: await schema.db.mediaBlobObjects.count(), runs: await schema.db.agentRuns.count() }
  }, s.seed.scope)
  expect(actual.processing).toMatchObject({ schema: 'storyforge.avg.audio-production-processing-plan', version: 2,
    entries: [{ domain: 'voice', recipe: { version: 2, gainMilliDb: 7000, maximumDurationMs: 10_000,
      sampleRatePolicy: 'explicit', targetSampleRateHz: 48000,
      dynamics: { processor: 'linked-lookahead-peak-limit.v1', ceilingMilliDbfs: -1500, lookaheadMs: 3, releaseMs: 80 } } }] })
  expect(actual.scripts).toEqual(s.seed.scripts); expect(actual.systemPlan).toEqual(s.seed.systemPlan)
  expect([actual.builds, actual.artifacts, actual.blobs, actual.runs, s.requests()]).toEqual([0, 0, 0, 0, 0])
  await page.screenshot({ path: info.outputPath('avg-audio-processing-native-saved-v2.png') })
})
