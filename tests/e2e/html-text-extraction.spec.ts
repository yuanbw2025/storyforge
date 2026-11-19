import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

test.use({ trace: 'off' })
let sourceBundle = ''
test.beforeAll(async () => {
  const entry = 'virtual:html-read-probe'
  const source = fileURLToPath(new URL('../../src/lib/utils/html.ts', import.meta.url))
  const built = await build({ configFile: false, publicDir: false, logLevel: 'silent', plugins: [{
    name: 'actual-html-reader-probe',
    resolveId(id) { if (id === entry) return '\0' + entry },
    load(id) { if (id === '\0' + entry) return `import {htmlToPlainText} from ${JSON.stringify(source)}; globalThis.__actualHtmlReader = htmlToPlainText;` },
  }], build: { write: false, minify: false, rollupOptions: { input: entry, output: { format: 'iife' } } } })
  const outputs = Array.isArray(built) ? built : [built]
  sourceBundle = outputs.flatMap(output => 'output' in output ? output.output : []).filter(output => output.type === 'chunk').map(output => output.code).join('\n')
  expect(sourceBundle).not.toBe('')
})

test('actual text reader preserves legacy text/hash and attempts no resource loads or scripts', async ({ page, context }, info) => {
  const legacyPage = await context.newPage()
  const legacyRequests: string[] = [], actualRequests: string[] = []
  await legacyPage.route('**/*', route => { legacyRequests.push(route.request().url()); return route.abort('blockedbyclient') })
  await page.route('**/*', route => { actualRequests.push(route.request().url()); return route.abort('blockedbyclient') })
  await page.goto('about:blank'); await legacyPage.goto('about:blank')
  await page.addScriptTag({ content: sourceBundle })
  const fixtures = [
    '<p>甲&amp;😀 &nbsp;e\u0301</p><p></p><p></p><p>乙</p>',
    '<h1>一</h1><h6>六</h6><blockquote><p>甲<br>乙</p></blockquote>',
    '<ul><li><p>甲</p><ul><li><p>乙</p></li></ul></li></ul>',
    '<p style="line-height:1.8"><span style="color:red;font-size:18px">旧稿</span></p><pre><code> a\n b\n</code></pre>',
    '<p>原稿<img src="https://html-read.invalid/image" srcset="https://html-read.invalid/srcset 2x"></p><iframe src="https://html-read.invalid/frame"></iframe>',
    '<video poster="https://html-read.invalid/poster"></video><link rel="stylesheet" href="https://html-read.invalid/style"><p>正文</p>',
    '<script>globalThis.__htmlReadExecuted=1</script><script src="https://html-read.invalid/script"></script><style>@import url(https://html-read.invalid/css);p{background:url(https://html-read.invalid/bg)}</style><p>安全读取</p>',
    '<template>模板</template><textarea>甲&amp;乙</textarea><p>甲<div>乙</div></p>',
  ]
  const before = await legacyPage.evaluate(inputs => inputs.map(html => {
    const root = document.createElement('div'); root.innerHTML = html
    root.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,blockquote,br').forEach(element => {
      if (element.tagName === 'BR') element.replaceWith('\n')
      else element.append('\n')
    })
    return (root.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
  }), fixtures)
  const actual = await page.evaluate(inputs => inputs.map(html => (globalThis as typeof globalThis & { __actualHtmlReader: (html: string) => string }).__actualHtmlReader(html)), fixtures)
  expect(actual).toEqual(before)
  const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
  expect(actual.map(hash)).toEqual(before.map(hash))
  await expect.poll(() => legacyRequests.length).toBeGreaterThan(0)
  await page.waitForTimeout(250)
  expect(actualRequests).toEqual([])
  expect(await page.evaluate(() => (globalThis as typeof globalThis & { __htmlReadExecuted?: number }).__htmlReadExecuted ?? 0)).toBe(0)
  expect(await legacyPage.evaluate(() => (globalThis as typeof globalThis & { __htmlReadExecuted?: number }).__htmlReadExecuted ?? 0)).toBe(0)
  const proof = {
    fixtures, before, actual, beforeHashes: before.map(hash), actualHashes: actual.map(hash),
    legacyAttemptedRequests: legacyRequests, actualAttemptedRequests: actualRequests,
    actualScriptExecutions: 0, legacyScriptExecutions: 0,
  }
  const proofPath = info.outputPath('html-text-extraction-proof.json')
  await writeFile(proofPath, JSON.stringify(proof, null, 2))
  await info.attach('html-text-extraction-proof', { contentType: 'application/json', path: proofPath })
  await legacyPage.close()
})
