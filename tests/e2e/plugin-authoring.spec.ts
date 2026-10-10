import { test, expect } from '@playwright/test'
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { createLongform } from './helpers/product-entry'

async function openHelp(page: import('@playwright/test').Page, route: string) {
  await page.goto(route)
  const preview = page.getByRole('button', { name: '开启工坊开发预览' })
  await expect(preview.or(page.getByTestId('plugin-workshop'))).toBeVisible()
  if (await preview.isVisible()) await preview.click()
}

test('community entry downloads matching Skill references and copies complete AI instructions', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openHelp(page, './workshop/discover')
  await page.getByRole('link', { name: '安装与使用教程', exact: true }).click()
  await expect(page.getByRole('heading', { name: '第一次安装与使用', exact: true })).toBeVisible()
  await page.getByRole('link', { name: '我想用 AI 开发插件', exact: true }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: '下载开发资料包与 Skill', exact: true }).click(),
  ])
  const bytes = await readFile((await download.path())!)
  const zip = await JSZip.loadAsync(bytes)
  const root = 'storyforge-plugin-author/'
  const metadata = JSON.parse(await zip.file(`${root}developer-kit.json`)!.async('string')) as { sources: Record<string, { sha256: string }> }
  for (const [name, { sha256 }] of Object.entries(metadata.sources)) {
    expect(createHash('sha256').update(await zip.file(root + name)!.async('nodebuffer')).digest('hex')).toBe(sha256)
  }
  expect(await zip.file(root + 'references/index.d.ts')!.async('string')).toBe(await readFile('tools/plugin-sdk/index.d.ts', 'utf8'))
  for (const name of ['SKILL.md', 'START-HERE.md', 'guides/develop.md', 'guides/en/publish.md', 'examples/writing-notes/manifest.json']) expect(zip.file(root + name)).not.toBeNull()
  await page.getByRole('button', { name: '复制 AI 开发指令', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '已复制。' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await zip.file(root + 'developer-prompt.txt')!.async('string'))
  await page.screenshot({ path: '/tmp/storyforge-plugin-authoring-desktop.png', fullPage: true })
})

test('manual instruction fallback and help remain usable on narrow screens without model setup', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('Denied') } } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await openHelp(page, './workshop/develop?project=0&owner=world')
  await page.getByRole('button', { name: '复制 AI 开发指令', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: '未能访问剪贴板' })).toBeVisible()
  await page.getByText('查看并手动复制指令', { exact: true }).click()
  await expect(page.getByLabel('AI 插件开发指令')).toHaveValue(await readFile('tools/plugin-sdk/authoring/developer-prompt.txt', 'utf8'))
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(392)
  await page.screenshot({ path: '/tmp/storyforge-plugin-authoring-mobile.png', fullPage: true })
  await page.getByRole('link', { name: '我想先了解怎么安装', exact: true }).click()
  expect(new URL(page.url()).searchParams.get('owner')).toBe('world')
  await expect(page.getByRole('heading', { name: '你的数据保存在哪里', exact: true })).toBeVisible()
})

test('documented public SDK recipe yields a separately installable, upgradable and recoverable plugin', async ({ page }) => {
  test.setTimeout(180_000)
  const folder = await mkdtemp(path.join(tmpdir(), 'sf-community-recipe-'))
  const source = path.join(folder, 'chapter-checklist')
  const cli = (args: string[]) => execFileSync(process.execPath, ['tools/plugin-sdk/cli.mjs', ...args], { encoding: 'utf8', timeout: 60_000 })
  cli(['create', source])
  const manifestFile = path.join(source, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  Object.assign(manifest, { id: 'reader.chapter-checklist', version: '0.1.0', name: '章节检查便笺', description: '保存章节修改清单', author: 'Community reader' })
  manifest.views[0].title = '章节检查便笺'
  await writeFile(manifestFile, JSON.stringify(manifest))
  const sourceFile = path.join(source, 'src/index.tsx')
  await writeFile(sourceFile, (await readFile(sourceFile, 'utf8')).replace('留住一闪而过的念头', '本章修改清单'))
  await mkdir(path.join(source, 'assets'))
  await writeFile(path.join(source, 'assets/readme.txt'), 'Community plugin asset')
  cli(['check', source])
  const v1 = path.join(folder, 'checklist-0.1.0.sfplugin'), v2 = path.join(folder, 'checklist-0.2.0.sfplugin')
  cli(['pack', source, v1])
  const repeat = path.join(folder, 'repeat.sfplugin')
  cli(['pack', source, repeat])
  expect(await readFile(repeat)).toEqual(await readFile(v1))
  manifest.version = '0.2.0'
  await writeFile(manifestFile, JSON.stringify(manifest))
  cli(['pack', source, v2])
  await createLongform(page, '公开教程独立插件验收')
  const project = new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1]
  await openHelp(page, `./workshop/installed?project=${project}&owner=work`)
  await expect(page.getByLabel('安装插件文件')).toBeEnabled()
  await page.getByLabel('安装插件文件').setInputFiles(v1)
  const card = (version: string) => page.locator('.sf-workshop-card').filter({ has: page.getByRole('heading', { name: '章节检查便笺', exact: true }) }).filter({ hasText: version })
  await card('0.1.0').getByRole('button', { name: '启用', exact: true }).click()
  await page.getByRole('button', { name: '信任并启用', exact: true }).click()
  const notes = async () => {
    await page.getByRole('link', { name: '插件工作台', exact: true }).click()
    await page.getByRole('button', { name: '章节检查便笺', exact: true }).click()
  }
  await notes()
  await expect(page.getByRole('heading', { name: '本章修改清单' })).toBeVisible()
  await page.getByLabel('插件创作便笺').fill('第三章补足动机')
  await page.getByRole('button', { name: '保存便笺' }).click()
  await expect(page.getByText('已保存到这部作品。')).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: '章节检查便笺', exact: true }).click()
  await expect(page.getByLabel('插件创作便笺')).toHaveValue('第三章补足动机')
  await page.getByRole('link', { name: '已安装', exact: true }).click()
  await card('0.1.0').getByRole('button', { name: '停用', exact: true }).click()
  await expect(page.getByLabel('安装插件文件')).toBeEnabled()
  await page.getByLabel('安装插件文件').setInputFiles(v2)
  await card('0.2.0').getByRole('button', { name: '切换到此版本', exact: true }).click()
  await page.getByRole('button', { name: '信任并升级', exact: true }).click()
  await card('0.2.0').getByRole('button', { name: '启用', exact: true }).click()
  await page.getByRole('button', { name: '信任并启用', exact: true }).click()
  await notes()
  await expect(page.getByLabel('插件创作便笺')).toHaveValue('第三章补足动机')
  await page.getByRole('link', { name: '已安装', exact: true }).click()
  await card('0.2.0').getByRole('button', { name: '停用', exact: true }).click()
  await card('0.2.0').getByRole('button', { name: '卸载', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '卸载', exact: true }).click()
  await expect(card('0.2.0')).toHaveCount(0)
  await expect(page.getByLabel('安装插件文件')).toBeEnabled()
  await page.getByLabel('安装插件文件').setInputFiles(v2)
  await expect(page.getByRole('status').filter({ hasText: '章节检查便笺 已安装，尚未执行' })).toBeVisible()
  await card('0.2.0').getByRole('button', { name: '启用', exact: true }).click()
  await page.getByRole('button', { name: '信任并启用', exact: true }).click()
  await notes()
  await expect(page.getByLabel('插件创作便笺')).toHaveValue('第三章补足动机')
})
