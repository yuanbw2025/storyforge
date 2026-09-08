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
