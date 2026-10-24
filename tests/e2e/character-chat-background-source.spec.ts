import {test, expect} from '@playwright/test'

test('author selects world background, confirms each audience and preserves the same permissions through reload and compilation', async ({page}) => {
  let modelCalls = 0
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'e2e'))
  await page.route('**/chat/completions', async route => {modelCalls++; await route.abort()})
  await page.goto('./chat/library')
  const f = await page.evaluate(async () => {
    const load = new Function('p', 'return import(p)')
    const fixture = await (await load('/storyforge/tests/helpers/chat-background-source.ts')).seedChatBackgroundSourceFixture()
    const service = await load('/storyforge/src/lib/character-interaction/draft-service.ts')
    await service.saveChatDraftV1(fixture.scope, fixture.draft.revision, {...fixture.settings, backgroundResourceKeys: []})
    return {scope: fixture.scope, worldReleaseId: fixture.draft.worldReleaseId,
      sources: fixture.options.filter((o: {resourceKind: string}) => ['location', 'codex-entry', 'character-relation'].includes(o.resourceKind)),
      actor: fixture.projection.characters[0]}
  })
  await page.goto(`./chat/cast?project=${f.scope.projectId}&work=${f.scope.workId}`)
  const selector = page.getByTestId('chat-background-selection')
  await selector.locator('summary').click()
  await expect(selector.locator('summary')).toContainText('已选 0 项')
  for (const source of f.sources) await page.getByLabel(`背景资料：${source.label}`, {exact: true}).check()
  await expect(page.getByRole('button', {name: '读取并检查完整资料', exact: true})).toBeDisabled()
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  const location = f.sources.find((s: {resourceKind: string}) => s.resourceKind === 'location')!
  const artifact = f.sources.find((s: {resourceKind: string}) => s.resourceKind === 'codex-entry')!
  const relation = f.sources.find((s: {resourceKind: string}) => s.resourceKind === 'character-relation')!
  for (const source of [location, artifact, relation]) {
    await expect(page.getByLabel(`${source.label} 说明 可见范围`, {exact: true})).toHaveValue('unclassified')
    await expect(page.getByLabel(`${source.label} 说明 用途`, {exact: true})).toBeDisabled()
  }
  await page.getByLabel(`${location.label} 说明 可见范围`, {exact: true}).selectOption('public')
  await page.getByLabel(`${artifact.label} 说明 可见范围`, {exact: true}).selectOption('participants')
  await page.getByLabel(`${relation.label} 说明 可见范围`, {exact: true}).selectOption('author-only')
  const preview = page.locator('details').filter({has: page.locator('summary').filter({hasText: '检查参与者实际获得的资料'})}).last()
  await preview.locator('summary').click()
  await expect(preview).toContainText('潮门关闭前仍可进入的调查起点')
  await expect(preview).not.toContainText('钥匙齿纹')
  await preview.getByRole('combobox').selectOption(f.actor.resourceKey)
  await expect(preview).toContainText('钥匙齿纹对应旧档案中的潮位')
  await expect(preview).not.toContainText('彼此隐瞒动机')
  await page.getByRole('button', {name: '确认可见范围并用于新制作', exact: true}).click()
  await expect(page.getByText('已保存资料确认。更换角色或世界后需要重新检查。', {exact: true})).toBeVisible()
  await page.reload()
  await expect(selector.locator('summary')).toContainText('已选 3 项')
  await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click()
  await expect(page.getByLabel(`${artifact.label} 说明 可见范围`, {exact: true})).toHaveValue('participants')
  await expect(page.getByLabel(`${relation.label} 说明 可见范围`, {exact: true})).toHaveValue('author-only')
  const compiled = await page.evaluate(async f => {
    const load = new Function('p', 'return import(p)')
    const service = await load('/storyforge/src/lib/character-interaction/draft-service.ts')
    const consultation = await load('/storyforge/src/lib/product-production/consultation.ts')
    const source = await load('/storyforge/src/lib/product-production/world-source.ts')
    const compiler = await load('/storyforge/src/lib/product-production/product-module-compilers.ts')
    const draft = await service.readChatDraftV1(f.scope), settings = JSON.parse(draft.settingsJson)
    const starting = await consultation.suggestProductStartingPoints({scope: f.scope, worldReleaseId: f.worldReleaseId})
    const brief = await consultation.draftProductProductionBriefV3({scope: f.scope, worldReleaseId: f.worldReleaseId, suggestionKey: starting.suggestions[0].suggestionKey,
      productType: 'character-interaction', characterChat: settings, playerRole: settings.playerRole, openingSituation: '核对世界资料', visualLevel: 'none', audioLevel: 'none'})
    const sourceCatalog = await source.loadProductProductionWorldSourceCatalogV2({scope: f.scope, worldReleaseId: f.worldReleaseId, selection: brief.source.selection})
    return compiler.prepareChatNarrativeCompilerSourceV1({brief, sourceCatalog})
  }, f)
  expect(compiled.content.version).toBe(2)
  expect(compiled.content.knowledge).toHaveLength(2)
  const privateItem = compiled.content.knowledge.find((k: {content: string}) => k.content.includes('钥匙齿纹'))!
  expect(privateItem.audienceKeys).toEqual([compiled.participantKeys[compiled.characterKeys.indexOf(f.actor.resourceKey)]])
  expect(JSON.stringify(compiled)).not.toContain('彼此隐瞒动机')
  await page.setViewportSize({width: 390, height: 844})
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await selector.locator('summary').click()
  await page.getByLabel(`背景资料：${artifact.label}`, {exact: true}).uncheck()
  await page.getByRole('button', {name: '保存方案', exact: true}).click()
  await expect(page.getByText('开始新制作前，请检查并确认角色资料的可见范围。', {exact: true})).toBeVisible()
  await page.reload()
  await expect(selector.locator('summary')).toContainText('已选 2 项')
  expect(modelCalls).toBe(0)
})
