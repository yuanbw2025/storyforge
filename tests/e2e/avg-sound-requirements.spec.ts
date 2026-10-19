import { expect, test, type Page } from '@playwright/test'

test.setTimeout(120_000)
test.skip(process.env.VITE_STORYFORGE_AVG_SOUND_PRODUCTION === '1', 'This suite verifies saved requirements while the Sound factory is closed')

/** Uses actual Work/source/draft APIs in a fresh isolated browser context.
 * No Build, Run, model response, audio, hearing or adoption is seeded. */
async function open(page: Page, saveBeforeOpening = false) {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.goto('./avg/library')
  const calls: string[] = []
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (['5297', '5298'].includes(url.port) || url.pathname.endsWith('/chat/completions') || url.pathname.endsWith('/audio/speech')) {
      calls.push(url.origin + url.pathname); await route.abort('blockedbyclient')
    } else await route.continue()
  })
  const state = await page.evaluate(async saveBeforeOpening => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, editor, presets, worlds, config] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/avg/editor-service.ts'),
      load('/storyforge/src/lib/avg/authoring-presets.ts'), load('/storyforge/src/lib/world-engine/mist-harbor-preset.ts'), load('/storyforge/src/stores/ai-config.ts')])
    const owner = await drafts.createAvgDraftV1('声音需求原生工程验收'), world = await worlds.createMistHarborWorld()
    const selected = await drafts.selectAvgWorldV1(owner.scope, 0, world.worldReleaseId)
    const saved = await editor.saveAvgAuthorWorkspaceV1(owner.scope, selected.revision, presets.createAvgAuthoringPresetV1('linear'))
    config.useAIConfigStore.getState().setConfig({ provider: 'agnes', apiKey: '', model: 'agnes-2.5-flash' })
    if (saveBeforeOpening) {
      const [sounds, catalog] = await Promise.all([load('/storyforge/src/lib/avg/sound-draft-service.ts'), load('/storyforge/src/lib/avg/sound-provider-contract.ts')])
      const workspace = JSON.parse(saved.editorJson), script = workspace.scripts[0], line = script.lines[0], source = catalog.listAvgSoundLibraryMetadataV1()[0]
      await sounds.saveAvgSoundProductionDraftV1({ scope: owner.scope, expectedDraftRevision: saved.revision, planning: {
        schema: 'storyforge.avg.sound-planning-scope', version: 1, librarySources: [source], templates: [{
          requirementKey: 'saved.click', assetKey: 'saved.click', channel: 'sfx', purpose: '作者保存的操作音效', constraints: [],
          consumer: { consumerKey: 'saved.click.consumer', domain: 'stage', slot: 'sfx', subjectKey: script.sceneKey, sceneKey: script.sceneKey, lineKey: null, required: true, fallback: 'none' },
          cue: { cueKey: 'saved.click.cue', beatKey: line.lineKey, phase: 'before', order: 10, volume: .6, loop: false },
          source: { kind: 'licensed-library', allowedSourceKeys: [source.sourceKey] },
        }],
      } })
    }
    return { scope: owner.scope, originalJson: saved.editorJson }
  }, saveBeforeOpening)
  await page.goto(`./avg/media-all?project=${state.scope.projectId}&work=${state.scope.workId}&assembly=1`)
  const panel = page.getByRole('region', { name: '音乐环境与音效需求（实验）', exact: true })
  await expect(panel).toBeVisible({ timeout: 30_000 })
  return { ...state, panel, calls }
}
async function savedSounds(page: Page) {
  test.skip(process.env.VITE_STORYFORGE_AVG_SOUND_PREPARATION !== '1', 'Sound requirement editing is default hidden; verify it in its explicit experimental build')
  const s = await open(page)
  await s.panel.getByRole('button', { name: '添加背景音乐', exact: true }).click()
  await s.panel.getByRole('group', { name: '声音需求 1', exact: true }).getByRole('textbox', { name: '声音用途', exact: true }).fill('原创安静钢琴氛围，为对白留白')
  await s.panel.getByRole('button', { name: '添加一次性音效', exact: true }).click()
  const effect = s.panel.getByRole('group', { name: '声音需求 2', exact: true })
  await effect.getByRole('textbox', { name: '声音用途', exact: true }).fill('操作确认的轻点击声')
  await effect.getByRole('listbox', { name: '允许的音效来源', exact: true }).selectOption({ label: 'interface-sounds · Audio/click_001.ogg' })
  await expect(page.getByRole('button', { name: '读取已保存版本', exact: true })).toBeDisabled()
  await s.panel.getByRole('button', { name: '保存声音需求', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '声音用途与准确位置已保存' })).toBeVisible()
  await expect(page.getByRole('button', { name: '读取已保存版本', exact: true })).toBeEnabled()
  await expect(s.panel.getByRole('button', { name: '核对并准备声音制作', exact: true })).toBeDisabled()
  return s
}
async function read(page: Page, scope: { projectId: number; worldId: number; workId: number }) {
  return page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, schema] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/db/schema.ts')])
    const draft = await drafts.readAvgDraftV1(scope)
    return { json: draft.editorJson, builds: await schema.db.productBuilds.count(), runs: await schema.db.agentRuns.count(), blobs: await schema.db.mediaBlobObjects.count() }
  }, scope)
}

test('native sound requirements preserve exact author content across save and refresh with no Key, dispatch or audio authority', async ({ page }, info) => {
  const s = await savedSounds(page), before = await read(page, s.scope), workspace = JSON.parse(before.json), original = JSON.parse(s.originalJson)
  expect(workspace.systemPlan).toEqual(original.systemPlan); expect(workspace.scripts).toEqual(original.scripts); expect(workspace.presentation).toEqual(original.presentation)
  expect(workspace.soundProduction.scope.templates.map((t: any) => t.channel)).toEqual(['bgm', 'sfx'])
  expect(workspace.soundProduction.scope.templates[0].cue.loop).toBe(true)
  expect(workspace.soundProduction.scope.librarySources[0].memberPath).toBe('Audio/click_001.ogg')
  await page.reload()
  await expect(s.panel.getByRole('group', { name: '声音需求 1', exact: true }).getByRole('textbox', { name: '声音用途', exact: true })).toHaveValue('原创安静钢琴氛围，为对白留白')
  expect((await read(page, s.scope)).json).toBe(before.json)
  expect(before.builds).toBe(0); expect(before.runs).toBe(0); expect(before.blobs).toBe(0); expect(s.calls).toEqual([])
  // The workbench uses an inner scroll container. Capture actual visible
  // viewport positions; a full element screenshot would include clipped blanks.
  await s.panel.getByRole('heading', { level: 4 }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('sound-requirements-desktop-top.png') })
  await s.panel.getByRole('button', { name: '核对并准备声音制作', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('sound-requirements-desktop-bottom.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  const bounds = await s.panel.boundingBox()
  expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await s.panel.getByRole('heading', { level: 4 }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('sound-requirements-mobile-top.png') })
  await s.panel.getByRole('button', { name: '核对并准备声音制作', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('sound-requirements-mobile-bottom.png') })
})

test('native requirement backup remaps owner and clears only the restored draft without touching the original', async ({ page }) => {
  const s = await savedSounds(page), original = await read(page, s.scope)
  const copy = await page.evaluate(async projectId => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [files, schema] = await Promise.all([load('/storyforge/src/lib/export/json-export.ts'), load('/storyforge/src/lib/db/schema.ts')])
    const id = await files.importProjectJSON(await files.exportProjectJSON(projectId)), draft = await schema.db.avgAuthoringDrafts.where('projectId').equals(id).first()
    return { projectId: id, worldId: draft.worldId, workId: draft.workId }
  }, s.scope.projectId)
  expect(copy.projectId).not.toBe(s.scope.projectId); expect(copy.workId).not.toBe(s.scope.workId)
  await page.goto(`./avg/media-all?project=${copy.projectId}&work=${copy.workId}&assembly=1`)
  await expect(s.panel.getByRole('group', { name: '声音需求 2', exact: true }).getByRole('textbox', { name: '声音用途', exact: true })).toHaveValue('操作确认的轻点击声')
  await s.panel.getByRole('button', { name: '清除未使用声音需求', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '未进入演出的声音需求已清除' })).toBeVisible()
  expect((await read(page, copy)).json).toBe(s.originalJson)
  await page.evaluate(async workId => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    await (await load('/storyforge/src/lib/workspace/lifecycle.ts')).deleteWork(workId)
  }, copy.workId)
  expect((await read(page, s.scope)).json).toBe(original.json); expect(s.calls).toEqual([])
})

test('native source edits leave the frozen requirement hash stale until the author explicitly checks and saves it again', async ({ page }) => {
  const s = await savedSounds(page), old = JSON.parse((await read(page, s.scope)).json)
  const edited = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const [drafts, editor, contracts] = await Promise.all([load('/storyforge/src/lib/avg/draft-service.ts'), load('/storyforge/src/lib/avg/editor-service.ts'), load('/storyforge/src/lib/avg/author-workspace-contract.ts')])
    const draft = await drafts.readAvgDraftV1(scope), workspace = contracts.parseAvgAuthorWorkspaceV1(draft.editorJson)
    workspace.scripts[0].lines[0].text += '作者并发修订'
    return (await editor.saveAvgAuthorWorkspaceV1(scope, draft.revision, workspace)).editorJson
  }, s.scope)
  await page.reload()
  await expect(s.panel.getByRole('status').filter({ hasText: '规则、对白或画幅已变化' })).toBeVisible()
  expect(JSON.parse(edited).soundProduction.scope.sourceInputHash).toBe(old.soundProduction.scope.sourceInputHash)
  await s.panel.getByRole('button', { name: '保存声音需求', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '声音用途与准确位置已保存' })).toBeVisible()
  const next = JSON.parse((await read(page, s.scope)).json)
  expect(next.soundProduction.scope.sourceInputHash).not.toBe(old.soundProduction.scope.sourceInputHash)
  expect(next.scripts).toEqual(JSON.parse(edited).scripts); expect(next.soundProduction.scope.templates).toEqual(old.soundProduction.scope.templates)
  expect(s.calls).toEqual([])
})

test('native saved requirements can be explicitly cleared with the editor switch off and ordinary preparation remains available', async ({ page }) => {
  test.skip(process.env.VITE_STORYFORGE_AVG_SOUND_PREPARATION === '1', 'Run in the default closed editor build')
  const s = await open(page, true)
  await expect(s.panel.getByRole('textbox', { name: '声音用途', exact: true })).toHaveValue('作者保存的操作音效')
  await expect(s.panel.getByRole('textbox', { name: '声音用途', exact: true })).toBeDisabled()
  await expect(s.panel.getByRole('button', { name: '添加背景音乐', exact: true })).toBeDisabled()
  await expect(s.panel.getByRole('button', { name: '核对并准备声音制作', exact: true })).toBeDisabled()
  await s.panel.getByRole('button', { name: '清除未使用声音需求', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '未进入演出的声音需求已清除' })).toBeVisible()
  expect((await read(page, s.scope)).json).toBe(s.originalJson)
  await expect(s.panel).toHaveCount(0)
  await page.getByRole('button', { name: '制作与试玩', exact: true }).click()
  await page.getByRole('button', { name: '准备制作方案', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '制作方案已准备' })).toBeVisible()
  const result = await page.evaluate(async scope => {
    const load = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const draft = await (await load('/storyforge/src/lib/avg/draft-service.ts')).readAvgDraftV1(scope)
    const details = await (await load('/storyforge/src/lib/product-production/service.ts')).readProductProductionDetailsV1(scope, draft.productionId, ['avg'])
    return JSON.parse(details.brief.briefJson)
  }, s.scope)
  expect(result.avgAssembly.version).toBe(1); expect(result.avgSoundPlanning).toBeUndefined()
  const unchanged = await read(page, s.scope)
  expect(unchanged.json).toBe(s.originalJson); expect(unchanged.builds).toBe(0); expect(unchanged.runs).toBe(0); expect(unchanged.blobs).toBe(0)
  expect(s.calls).toEqual([])
})
