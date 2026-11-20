import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { build } from 'vite'
import { expect, test } from '@playwright/test'

interface FixtureConfig { enabled?: boolean; disabled?: boolean; readOnly?: boolean; session?: boolean }
declare global {
  interface Window {
    __inputAreaFixture: {
      render: (config: FixtureConfig) => void
      unmount: () => void
      flush: () => Promise<void>
      failNext: boolean
      counts: { saves: string[]; changes: string[]; blurs: { tag: string; id: string; related: string | null }[]; composition: number; scroll: number; submit: number }
    }
    __layoutWrites: number
    __layoutObserverCalls: number
  }
}
test.use({ trace: 'off' })
let bundle = ''
test.beforeAll(async () => {
  const source = (relative: string) => JSON.stringify(fileURLToPath(new URL('../../' + relative, import.meta.url)))
  const entry = 'virtual:input-area-fixture'
  const code = `
import {createElement as h,useState} from 'react'; import {createRoot} from 'react-dom/client';
import {InlineTextarea} from ${source('src/components/shared/InlineEdit.tsx')};
import {CTextarea} from ${source('src/components/shared/CompositionInput.tsx')};
import {flushPendingEditsV1} from ${source('src/lib/authoring/pending-edit-coordinator.ts')};
const root=createRoot(document.getElementById('fixture'));
const counts={saves:[],changes:[],blurs:[],composition:0,scroll:0,submit:0};
function App({config}){
 const [inline,setInline]=useState('基础原文'),[candidate,setCandidate]=useState('候选原文😀\\n'.repeat(12));
 const sizing=role=>config.enabled===false?undefined:{enabled:true,preferenceKey:config.session?undefined:'world.origin/'+role};
 const style={width:'100%',padding:8,lineHeight:'22px',fontSize:14,border:'1px solid #888'};
 const events={onCompositionStartCapture:()=>counts.composition++,onScroll:()=>counts.scroll++};
 return h('form',{onSubmit:e=>{e.preventDefault();counts.submit++}},
  h('section',{id:'inline'},h(InlineTextarea,{value:inline,onChange:async text=>{counts.saves.push(text);if(window.__inputAreaFixture.failNext){window.__inputAreaFixture.failNext=false;throw Error('隔离保存失败')}setInline(text)},inputAreaLayout:sizing('current')})),
  h('div',{className:'comparison'},
   h('label',{id:'left'},'原文（只读）',h(CTextarea,{id:'original',value:'只读原文😀\\n'.repeat(10),readOnly:true,style,inputAreaLayout:sizing('original'),...events})),
   h('label',{id:'right'},'候选内容',h(CTextarea,{id:'candidate',value:candidate,onChange:e=>{counts.changes.push(e.target.value);setCandidate(e.target.value)},onBlur:e=>counts.blurs.push({tag:e.currentTarget.tagName,id:e.currentTarget.id,related:e.relatedTarget?.id??null}),disabled:config.disabled,readOnly:config.readOnly,style,inputAreaLayout:sizing('candidate'),...events}))),
  h('button',{type:'button',id:'outside'},'字段区外'));
}
window.__inputAreaFixture={counts,failNext:false,render:config=>root.render(h(App,{config})),unmount:()=>root.unmount(),flush:flushPendingEditsV1};
window.__inputAreaFixture.render({});`
  const built = await build({ configFile: false, publicDir: false, logLevel: 'silent', plugins: [{ name: 'input-area-fixture', resolveId(id) { if (id === entry) return '\0' + entry }, load(id) { if (id === '\0' + entry) return code } }],
    build: { write: false, minify: false, rollupOptions: { input: entry, output: { format: 'iife' } } } })
  bundle = (Array.isArray(built) ? built : [built]).flatMap(output => 'output' in output ? output.output : []).filter(output => output.type === 'chunk').map(output => output.code).join('\n')
  expect(bundle).not.toBe('')
})
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__layoutWrites = 0; window.__layoutObserverCalls = 0
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function(key, value) { if (key === 'storyforge-input-area-layout-v1') window.__layoutWrites++; return set.call(this, key, value) }
    const Original = window.ResizeObserver
    window.ResizeObserver = class extends Original { constructor(callback: ResizeObserverCallback) { super((entries, observer) => { window.__layoutObserverCalls++; callback(entries, observer) }) } }
  })
  await page.route('**/*', route => route.request().url() === 'https://input-area.fixture.invalid/'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:14px sans-serif}#fixture{padding:24px;width:100%;min-width:0}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.comparison label{display:block;min-width:0}#inline{margin-bottom:16px}@media(max-width:700px){.comparison{grid-template-columns:1fr}}</style><div id="fixture"></div>' })
    : route.abort('blockedbyclient'))
  await page.goto('https://input-area.fixture.invalid/')
  // Match secure localhost/packaged contexts required by the real edit session UUID.
  expect(await page.evaluate(() => isSecureContext && typeof crypto.randomUUID === 'function')).toBe(true)
  await page.addScriptTag({ content: bundle })
  await expect(page.locator('#candidate')).toBeVisible()
})

for (const width of [2560, 1920, 1728, 1366, 390]) test(`foundation two-axis drag, responsive clamp and reset at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const input = page.locator('#candidate'), shell = page.locator('#right [data-input-area-layout]')
  const handle = shell.getByRole('button', { name: '调整输入区大小' })
  const before = await input.boundingBox(); if (!before) throw new Error('missing input')
  const knob = await handle.boundingBox(); if (!knob) throw new Error('missing handle')
  await input.focus(); await input.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 5))
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2); await page.mouse.down()
  await page.mouse.move(knob.x + knob.width / 2 - 90, knob.y + knob.height / 2 + 110, { steps: 10 })
  expect(await page.evaluate(() => window.__layoutWrites)).toBe(0)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__layoutWrites)).toBe(1)
  const resized = await input.boundingBox(); if (!resized) throw new Error('missing resized input')
  expect(resized.width).toBeLessThan(before.width); expect(resized.height).toBeGreaterThan(before.height)
  expect(await input.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([2, 5])
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.changes)).toEqual([])
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.blurs)).toEqual([])
  await page.screenshot({ path: info.outputPath('resized-layout.png'), fullPage: true })
  const preference = await page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))
  await page.setViewportSize({ width: 390, height: 700 })
  await expect.poll(() => input.evaluate(el => el.getBoundingClientRect().width <= el.parentElement!.parentElement!.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))).toBe(preference)
  await page.setViewportSize({ width, height: 900 })
  await expect.poll(async () => Math.round((await input.boundingBox())!.width)).toBe(Math.round(resized.width))
  await page.reload(); await page.addScriptTag({ content: bundle }); await expect(input).toBeVisible()
  await expect.poll(async () => Math.round((await input.boundingBox())!.width)).toBe(Math.round(resized.width))
  await shell.getByRole('button', { name: '恢复自适应' }).click()
  await expect.poll(() => page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))).toBeNull()
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.changes)).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.evaluate(() => window.__layoutObserverCalls)).toBeLessThan(100)
  await writeFile(info.outputPath('layout-measurement.json'), JSON.stringify({ viewport: width, before, resized, preference, observerCalls: await page.evaluate(() => window.__layoutObserverCalls), evidence: 'isolated default-off foundation fixture; no actual product admission consumer yet' }, null, 2))
})

test('keyboard internal focus keeps dirty draft and one true external leave saves; failure and synthetic composition stay guarded', async ({ page }) => {
  await page.getByText('基础原文', { exact: true }).click()
  const textarea = page.locator('#inline textarea'), shell = page.locator('#inline [data-input-area-layout]')
  await textarea.fill('必须保留的作者草稿😀')
  const node = await textarea.elementHandle()
  await page.keyboard.press('Tab')
  await expect(shell.getByRole('button', { name: '调整输入区大小' })).toBeFocused()
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Shift+Tab')
  await expect(shell.getByRole('button', { name: '恢复自适应' })).toBeFocused()
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.saves)).toEqual([])
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.submit)).toBe(0)
  expect(await textarea.evaluate((el, original) => el === original, node)).toBe(true)
  await page.evaluate(() => { window.__inputAreaFixture.failNext = true })
  await page.locator('#outside').focus()
  await expect(page.getByText(/未保存：隔离保存失败/)).toBeVisible()
  await expect(textarea).toHaveValue('必须保留的作者草稿😀')
  await shell.getByRole('button', { name: '调整输入区大小' }).click()
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.saves.length)).toBe(1)
  await textarea.dispatchEvent('compositionstart', { bubbles: true })
  await expect(shell.getByRole('button', { name: '调整输入区大小' })).toBeDisabled()
  expect(await page.evaluate(async () => { try { await window.__inputAreaFixture.flush(); return '' } catch (error) { return String(error) } })).toContain('输入法')
  await textarea.dispatchEvent('compositionend', { bubbles: true })
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await expect(page.getByText('必须保留的作者草稿😀', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.saves)).toEqual(['必须保留的作者草稿😀', '必须保留的作者草稿😀'])
})

test('label-wrapped readonly/candidate refs, capture, scroll and default-off behavior survive layout actions', async ({ page }) => {
  const candidate = page.locator('#candidate'), handle = page.locator('#right').getByRole('button', { name: '调整输入区大小' })
  await candidate.focus(); await page.keyboard.press('Tab'); await expect(handle).toBeFocused()
  await page.keyboard.press('ArrowDown')
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.blurs)).toEqual([])
  await page.locator('#outside').focus()
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.blurs)).toEqual([{ tag: 'TEXTAREA', id: 'candidate', related: 'outside' }])
  await page.locator('#left').getByRole('button', { name: '调整输入区大小' }).click()
  await page.locator('#left').getByRole('button', { name: '宽一点' }).click()
  await expect(page.locator('#original')).toHaveAttribute('readonly', '')
  await candidate.dispatchEvent('scroll')
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.scroll)).toBeGreaterThan(0)
  await candidate.dispatchEvent('compositionstart', { bubbles: true })
  await page.keyboard.insertText('组合文字')
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.changes)).toEqual([])
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.composition)).toBe(1)
  await candidate.dispatchEvent('compositionend', { bubbles: true })
  await page.evaluate(() => window.__inputAreaFixture.render({ enabled: false }))
  await expect(page.locator('[data-input-area-layout]')).toHaveCount(0)
  const writes = await page.evaluate(() => window.__layoutWrites)
  await candidate.fill('未准入的共享字段')
  await page.waitForTimeout(280)
  expect(await page.evaluate(() => window.__layoutWrites)).toBe(writes)
})

test('zero/tiny parent and CSS zoom clamp without preference overwrite; cancelled drag and unmount cannot write late', async ({ page }) => {
  const input = page.locator('#candidate'), right = page.locator('#right'), shell = right.locator('[data-input-area-layout]'), handle = shell.getByRole('button', { name: '调整输入区大小' })
  await handle.focus(); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(280)
  const preference = await page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))
  await right.evaluate(el => { el.style.width = '0px'; el.style.overflow = 'hidden' })
  await page.waitForTimeout(60)
  const visibleWidth = () => input.evaluate(el => {
    const input = el.getBoundingClientRect(), frame = el.parentElement!.parentElement!.getBoundingClientRect()
    return Math.max(0, Math.min(input.right, frame.right) - Math.max(input.left, frame.left))
  })
  // A native input's border/padding can have a physical minimum at width:0;
  // the shell clips that footprint rather than mutating its caller's styles.
  expect(await visibleWidth()).toBe(0)
  expect(await shell.evaluate(el => getComputedStyle(el).overflowX)).toBe('clip')
  await right.evaluate(el => { el.style.width = '12px'; el.style.zoom = '1.25' })
  await expect.poll(visibleWidth).toBeLessThanOrEqual(15)
  expect(await page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))).toBe(preference)
  await right.evaluate(el => { el.style.width = ''; el.style.zoom = '' })
  await expect(handle).toBeVisible()
  expect(await input.evaluate(el => getComputedStyle(el).paddingLeft)).toBe('8px')
  await handle.dispatchEvent('pointerdown', { pointerId: 11, button: 0, clientX: 600, clientY: 200 })
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 11, clientX: 300, clientY: 300 })))
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 11 })))
  expect(await page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))).toBe(preference)
  await handle.focus(); await page.keyboard.press('ArrowDown')
  const writes = await page.evaluate(() => window.__layoutWrites)
  await page.evaluate(() => window.__inputAreaFixture.unmount())
  await page.waitForTimeout(280)
  expect(await page.evaluate(() => window.__layoutWrites)).toBe(writes)
  expect(await page.evaluate(() => window.__layoutObserverCalls)).toBeLessThan(100)
})

for (const raw of [
  ' {"version":2,"boxes":{"world.origin/candidate":{"width":800,"height":600},"world.origin/original":{"width":500,"height":200}}} ',
  '{damaged-original',
]) test(`unsupported original storage stays session-only including delayed persistence: ${raw.startsWith(' {') ? 'future' : 'damaged'}`, async ({ page }) => {
  await page.evaluate(value => localStorage.setItem('storyforge-input-area-layout-v1', value), raw)
  await page.reload(); await page.addScriptTag({ content: bundle })
  const shell = page.locator('#right [data-input-area-layout]')
  await shell.getByRole('button', { name: '调整输入区大小' }).click()
  await shell.getByRole('button', { name: '窄一点' }).click()
  await page.waitForTimeout(280)
  expect(await page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))).toBe(raw)
  await shell.getByRole('button', { name: '恢复自适应' }).click()
  expect(await page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))).toBe(raw)
  // Even if another page replaces the storage later, this already unsupported
  // session must not publish its delayed box or reset into that new baseline.
  await shell.getByRole('button', { name: '窄一点' }).click()
  const external = ' {"version":1,"boxes":{"world.origin/candidate":{"width":900,"height":650},"world.origin/original":{"width":500,"height":200}}} '
  await page.evaluate(value => localStorage.setItem('storyforge-input-area-layout-v1', value), external)
  await page.waitForTimeout(280)
  expect(await page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))).toBe(external)
  await shell.getByRole('button', { name: '恢复自适应' }).click()
  expect(await page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))).toBe(external)
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.changes)).toEqual([])
})

test('single-axis nudges and drags preserve the other desired axis across viewport clamps and return', async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  const seeded = { version: 1, boxes: { 'world.origin/candidate': { width: 800, height: 600 }, 'world.origin/original': { width: 500, height: 200 } } }
  await page.evaluate(value => localStorage.setItem('storyforge-input-area-layout-v1', JSON.stringify(value)), seeded)
  await page.reload(); await page.addScriptTag({ content: bundle })
  const input = page.locator('#candidate'), shell = page.locator('#right [data-input-area-layout]'), handle = shell.getByRole('button', { name: '调整输入区大小' })
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('storyforge-input-area-layout-v1')!).boxes['world.origin/candidate'])
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(600)
  await page.setViewportSize({ width: 1920, height: 400 })
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(300)
  await handle.focus(); await page.keyboard.press('ArrowLeft')
  expect(await stored()).toEqual({ width: 784, height: 600 })
  const drag = async (dx: number, dy: number) => {
    await handle.scrollIntoViewIfNeeded()
    const box = await handle.boundingBox(); if (!box) throw new Error('missing handle')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 4 }); await page.mouse.up()
  }
  await drag(-16, 0)
  expect(await stored()).toEqual({ width: 768, height: 600 })
  await page.setViewportSize({ width: 1920, height: 1000 })
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(600)
  await page.setViewportSize({ width: 600, height: 1000 })
  await expect.poll(async () => (await input.boundingBox())!.width).toBeLessThan(768)
  await handle.focus(); await page.keyboard.press('ArrowUp')
  expect(await stored()).toEqual({ width: 768, height: 584 })
  await drag(0, -16)
  expect(await stored()).toEqual({ width: 768, height: 568 })
  await page.setViewportSize({ width: 1920, height: 1000 })
  await expect.poll(async () => (await input.boundingBox())!.width).toBe(768)
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(568)
  const beforeReset = await stored()
  await shell.getByRole('button', { name: '恢复自适应' }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('storyforge-input-area-layout-v1')!).boxes)).toEqual({ 'world.origin/original': { width: 500, height: 200 } })
  expect(await page.evaluate(() => window.__inputAreaFixture.counts.changes)).toEqual([])
  await writeFile(info.outputPath('single-axis-proof.json'), JSON.stringify({ seeded, beforeReset, expectedOtherRecord: { width: 500, height: 200 } }, null, 2))
})

test('an untouched fractional desired axis is preserved exactly rather than normalized', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 400 })
  await page.evaluate(() => localStorage.setItem('storyforge-input-area-layout-v1', JSON.stringify({ version: 1, boxes: {
    'world.origin/candidate': { width: 800.5, height: 600.5 }, 'world.origin/original': { width: 800.5, height: 600.5 },
  } })))
  await page.reload(); await page.addScriptTag({ content: bundle })
  await page.locator('#right').getByRole('button', { name: '调整输入区大小' }).focus(); await page.keyboard.press('ArrowLeft')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('storyforge-input-area-layout-v1')!).boxes['world.origin/candidate'])).toEqual({ width: 785, height: 600.5 })
  await page.setViewportSize({ width: 600, height: 1000 })
  await expect.poll(async () => (await page.locator('#original').boundingBox())!.height).toBe(600.5)
  await page.locator('#left').getByRole('button', { name: '调整输入区大小' }).focus(); await page.keyboard.press('ArrowUp')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('storyforge-input-area-layout-v1')!).boxes['world.origin/original'])).toEqual({ width: 800.5, height: 585 })
})

test.describe('Chromium emulated touch foundation', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })
  test('offers width/height buttons without editing text, submitting, or unlocking readonly content', async ({ page }) => {
    const original = page.locator('#original'), shell = page.locator('#left [data-input-area-layout]')
    await shell.getByRole('button', { name: '调整输入区大小' }).tap()
    const before = await original.boundingBox(); if (!before) throw new Error('missing original')
    await shell.getByRole('button', { name: '窄一点' }).tap()
    await shell.getByRole('button', { name: '高一点' }).tap()
    await expect.poll(async () => (await original.boundingBox())!.width).toBeLessThan(before.width)
    await expect.poll(async () => (await original.boundingBox())!.height).toBeGreaterThan(before.height)
    await expect.poll(() => page.evaluate(() => window.__layoutWrites)).toBe(1)
    await expect(original).toHaveAttribute('readonly', '')
    expect(await page.evaluate(() => window.__inputAreaFixture.counts.changes)).toEqual([])
    expect(await page.evaluate(() => window.__inputAreaFixture.counts.saves)).toEqual([])
    expect(await page.evaluate(() => window.__inputAreaFixture.counts.submit)).toBe(0)
    await shell.getByRole('button', { name: '恢复自适应' }).tap()
    expect(await page.evaluate(() => localStorage.getItem('storyforge-input-area-layout-v1'))).toBeNull()
  })
})
