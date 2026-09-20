/* global console, process, URL, fetch, document, window */
import { chromium } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const base = process.env.DOCS_PREVIEW_URL || 'http://127.0.0.1:4173'
const output = mkdtempSync(join(tmpdir(), 'storyforge-docs-preview-'))
const sitemap = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'dist/sitemap.xml'), 'utf8')
const routes = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => new URL(m[1]).pathname)
for (const route of routes) {
  const response = await fetch(base + route)
  if (!response.ok || !(await response.text()).includes('VPContent')) throw new Error('Route failed: ' + route)
}
const browser = await chromium.launch({ headless: true })
const errors = []
const watch = page => {
  page.on('pageerror', error => errors.push(error.message))
  page.on('response', response => {
    if (response.status() >= 400) errors.push('HTTP ' + response.status() + ' ' + response.url())
  })
}
const paths = ['/', '/getting-started/', '/features/longform/', '/features/comic', '/features/interactive/ttrpg', '/guides/backup-restore', '/prompts/', '/updates/changelog', '/feedback/', '/feedback/bug', '/feedback/feature', '/feedback/documentation', '/en/']
try {
  for (const width of [1440, 1024, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    watch(page)
    // Never create real feedback while exercising local pages.
    await page.route('**/api/feedback', route => route.abort())
    for (const path of paths) {
      await page.goto(base + path, { waitUntil: 'networkidle' })
      await page.locator('.VPContent').waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
      if (overflow) errors.push('Horizontal overflow: ' + width + ' ' + path)
      if (await page.locator('.VPNotFound').count()) errors.push('404: ' + path)
      if (path === '/') {
        const banner = await page.locator('.knowledge-banner').boundingBox()
        if (!banner || (width >= 1024 && (banner.height < 140 || banner.height > 180))) errors.push('Banner size: ' + JSON.stringify(banner))
        if (width >= 1024 && !await page.locator('.VPSidebar').isVisible()) errors.push('Missing home sidebar')
        if (await page.locator('.VPHero').count()) errors.push('Unexpected landing hero')
        await page.screenshot({ path: join(output, 'home-' + width + '.png'), fullPage: true })
      }
    }
    await page.goto(base + '/features/longform/', { waitUntil: 'networkidle' })
    await page.screenshot({ path: join(output, 'longform-' + width + '.png'), fullPage: true })
    await page.close()
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  watch(page)
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.locator('.VPNavBarSearch button').click()
  await page.locator('#localsearch-input').fill('漫剧素材')
  await page.locator('#localsearch-list a').first().waitFor()
  if (!await page.locator('#localsearch-list').innerText().then(text => text.includes('漫剧'))) errors.push('Search did not find new guide')
  const searchLinks = await page.locator('#localsearch-list a').evaluateAll(links => links.map(a => a.getAttribute('href')))
  if (searchLinks.some(href => href.includes('/archive/') || href.includes('historical-feature-updates'))) errors.push('Historical results leaked into search')
  await page.keyboard.press('Escape')
  await page.locator('.VPSwitchAppearance').first().click()
  await page.screenshot({ path: join(output, 'home-light.png'), fullPage: true })
  if (await page.locator('html').getAttribute('class').then(value => value?.includes('dark'))) errors.push('Light theme switch failed')
  await page.close()
} finally {
  await browser.close()
}
if (errors.length) throw new Error([...new Set(errors)].join('\n'))
console.log('Preview passed: ' + routes.length + ' routes; ' + paths.length + ' pages at 1440/1024/390 px. Screenshots: ' + output)
