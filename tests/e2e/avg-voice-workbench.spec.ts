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
  await page.goto(`./avg/production?project=${seed.scope.projectId}&work=${seed.scope.workId}`)
  // A saved editor draft opens its actual workbench automatically.
  await expect(page.getByRole('region', { name: '系统与效果组装（实验）', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '素材', exact: true }).click()
  const panel = page.getByRole('region', { name: '逐句配音需求草稿', exact: true })
  await panel.getByLabel('Agnes 配音模型 ID', { exact: true }).fill('speech-fixture')
  await panel.getByRole('checkbox', { name: /第 1 句/ }).first().check()
  await panel.getByLabel('音色 ID', { exact: true }).fill('voice-a')
  await panel.getByLabel('音色使用权说明', { exact: true }).fill('原创工程声明 e\u0301；不是供应商商用许可或真实人声证据')
  await panel.getByLabel('音色条款或授权依据', { exact: true }).fill('本测试原创声明，待真实服务校准')
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
  await expect(panel.getByLabel('Agnes 配音模型 ID', { exact: true })).toHaveValue('speech-fixture')
  await expect(panel.getByLabel('音色 ID', { exact: true })).toHaveValue('voice-a')
  const closedNotice = page.getByText('配音收费生产尚未开放；可以保存需求草稿并查看已有记录。', { exact: true })
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
  await expect(s.panel.getByLabel('音色 ID', { exact: true })).toHaveValue('voice-a')
  await expect(page.getByRole('button', { name: '制作与试玩', exact: true })).toBeDisabled()
  const actual = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    return (await (await load('/storyforge/src/lib/avg/draft-service.ts')).readAvgDraftV1(scope)).editorJson
  }, s.seed.scope)
  expect(actual).toBe(changed); expect(JSON.parse(actual).voiceProduction).toBeUndefined(); expect(s.requests()).toBe(0)
  await page.screenshot({ path: info.outputPath('avg-voice-draft-stale-native-retained.png') })
})
