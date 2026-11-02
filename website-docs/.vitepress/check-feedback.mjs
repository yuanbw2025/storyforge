import { env } from 'node:process'
import { log } from 'node:console'
import { Buffer } from 'node:buffer'
import { chromium, expect } from '@playwright/test'

const browser = await chromium.launch({ ...(env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1' ? { channel: 'chrome' } : {}) })
const base = env.DOCS_PREVIEW_URL || 'http://127.0.0.1:4173'
try {
  const page = await browser.newPage()
  /** @type {import('@playwright/test').Request[]} */
  const requests = []
  /** @type {{status: number, payload: {ok: true, issueNumber: number} | {ok: false, error: string}}} */
  let response = { status: 200, payload: { ok: true, issueNumber: 123 } }
  /** @type {Promise<void> | undefined} */
  let release
  await page.route('**/api/feedback', async route => {
    requests.push(route.request())
    if (release) await release
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.payload) })
  })
  for (const locale of ['', '/en']) {
    const summary = { format: 'storyforge-failure-summary', version: 1, application: 'v4.0.0+local',
      platform: 'Windows', browser: 'Chrome 140', errors: [], launcher: null, secret: 'DO-NOT-IMPORT' }
    const count = requests.length
    await page.goto(base + locale + '/feedback/bug#storyforge-report=' + encodeURIComponent(JSON.stringify(summary)))
    await expect(page.locator('#bug-version')).toHaveValue('v4.0.0+local')
    const extra = await page.locator('#bug-extra').inputValue()
    if (!extra.includes('storyforge-failure-summary') || extra.includes('DO-NOT-IMPORT')) throw new Error('Unsafe diagnostic handoff')
    if (await page.evaluate(() => globalThis.location.hash) !== '' || requests.length !== count) throw new Error('Handoff leaked or submitted automatically')
  }
  for (const locale of ['', '/en']) for (const type of ['bug', 'feature', 'documentation']) {
    await page.goto(base + locale + '/feedback/' + type)
    await page.locator('#' + type + '-title').fill('Local mock only')
    await page.locator('#' + type + (type === 'feature' ? '-problem' : '-description')).fill('Test description')
    if (type === 'feature') {
      await page.locator('#feature-workaround').fill('Workaround')
      await page.locator('#feature-extra').fill('Extra')
    }
    await page.locator('.feedback-file-input').setInputFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('local mock') })
    /** @type {() => void} */
    let unlock = () => { throw new Error('Response barrier was not initialized') }
    release = new Promise(resolve => { unlock = () => resolve() })
    const before = requests.length
    await page.locator('.feedback-submit-button').click()
    await expect(page.locator('.feedback-submit-button')).toBeDisabled()
    await page.locator('form').evaluate(form => form.dispatchEvent(new globalThis.Event('submit', { bubbles: true, cancelable: true })))
    await expect.poll(() => requests.length).toBe(before + 1)
    unlock(); release = undefined
    await expect(page.locator('.feedback-notice--success')).toContainText('#123')
    const request = requests.at(-1)
    if (!request) throw new Error('No feedback request was captured')
    const payload = request.postDataBuffer()
    if (!payload) throw new Error('Feedback request has no body')
    const body = payload.toString()
    if (!request.headers()['content-type'].includes('multipart/form-data; boundary=')) throw new Error('Missing browser boundary')
    for (const key of ['type', 'title', 'description', 'website', 'attachments']) if (!body.includes('name="' + key + '"')) throw new Error('Missing ' + key)
    if (!body.includes('\r\n\r\n' + type + '\r\n')) throw new Error('Wrong type')
    if (type === 'feature' && (!body.includes('Workaround') || !body.includes('Extra'))) throw new Error('Missing workaround/extra')
    await expect(page.locator('#' + type + '-title')).toHaveValue('')
    await expect(page.locator('.feedback-file-item')).toHaveCount(0)
  }
  for (const locale of ['', '/en']) for (const type of ['bug', 'feature', 'documentation']) for (const succeeds of [true, false]) {
    await page.goto(base + locale + '/feedback/' + type)
    const description = '#' + type + (type === 'feature' ? '-problem' : '-description')
    await page.locator('#' + type + '-title').fill('Submitted title')
    await page.locator(description).fill('Submitted description')
    await page.locator('#' + type + '-contact').fill('submitted@example.invalid')
    await page.locator('.feedback-file-input').setInputFiles({ name: 'old.txt', mimeType: 'text/plain', buffer: Buffer.from('old payload') })
    response = succeeds
      ? { status: 200, payload: { ok: true, issueNumber: 138 } }
      : { status: 500, payload: { ok: false, error: 'Local delayed failure' } }
    /** @type {() => void} */
    let unlock = () => { throw new Error('Response barrier was not initialized') }
    release = new Promise(resolve => { unlock = () => resolve() })
    const before = requests.length
    await page.locator('.feedback-submit-button').click()
    await expect.poll(() => requests.length).toBe(before + 1)
    await page.locator('#' + type + '-title').fill('Unsubmitted newer title')
    await page.locator(description).fill('Unsubmitted newer description')
    await page.locator('.feedback-file-remove').click()
    await page.locator('.feedback-file-input').setInputFiles([
      { name: 'next.txt', mimeType: 'text/plain', buffer: Buffer.from('unsent next file') },
      { name: 'old.txt', mimeType: 'text/plain', buffer: Buffer.from('new payload') },
    ])
    await page.locator('form').evaluate(form => form.dispatchEvent(new globalThis.Event('submit', { bubbles: true, cancelable: true })))
    await expect(page.locator('.feedback-submit-button')).toBeDisabled()
    if (requests.length !== before + 1) throw new Error('Repeated request while awaiting the first response')
    const payload = requests.at(-1)?.postDataBuffer()
    if (!payload) throw new Error('Feedback request has no body')
    const body = payload.toString()
    for (const value of ['Submitted title', 'Submitted description', 'old payload']) {
      if (!body.includes(value)) throw new Error('Submitted snapshot missing ' + value)
    }
    for (const value of ['Unsubmitted newer', 'next.txt', 'new payload']) {
      if (body.includes(value)) throw new Error('Newer draft unexpectedly sent: ' + value)
    }
    unlock(); release = undefined
    if (succeeds) await expect(page.locator('.feedback-notice--success')).toContainText('#138')
    else await expect(page.locator('[role="alert"]')).toHaveText('Local delayed failure')
    await expect(page.locator('#' + type + '-title')).toHaveValue('Unsubmitted newer title')
    await expect(page.locator(description)).toHaveValue('Unsubmitted newer description')
    await expect(page.locator('#' + type + '-contact')).toHaveValue(succeeds ? '' : 'submitted@example.invalid')
    await expect(page.locator('.feedback-file-item')).toHaveCount(2)
    await expect(page.locator('.feedback-file-meta strong')).toHaveText(['next.txt', 'old.txt'])
    await expect(page.locator('.feedback-submit-button')).toBeEnabled()
  }
  await page.goto(base + '/en/feedback/bug')
  await page.locator('#bug-title').fill('Local mock only')
  await page.locator('#bug-description').fill('Test')
  for (const status of [400, 413, 429, 500, 502]) {
    const error = 'Server message ' + status + ' <b>plain text</b>'
    response = { status, payload: { ok: false, error } }
    await page.locator('.feedback-submit-button').click()
    await expect(page.locator('[role="alert"]')).toHaveText(error)
    await expect(page.locator('[role="alert"] b')).toHaveCount(0)
  }
  /** @param {string} name
   * @param {number} mb */
  const add = async (name, mb, type = 'application/zip', paste = false) => page.evaluate(({ name, mb, type, paste }) => {
    const dt = new globalThis.DataTransfer()
    dt.items.add(new globalThis.File([new Uint8Array(Math.round(mb * 1024 * 1024))], name, { type }))
    const dropzone = globalThis.document.querySelector('.feedback-dropzone')
    if (!dropzone) throw new Error('Feedback dropzone is missing')
    dropzone.dispatchEvent(paste ? new globalThis.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }) : new globalThis.DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, { name, mb, type, paste })
  const clear = async () => { while (await page.locator('.feedback-file-remove').count()) await page.locator('.feedback-file-remove').first().click() }
  await add('capture.png', .01, 'image/png', true)
  await expect(page.locator('.feedback-file-meta')).toContainText('screenshot-')
  await clear()
  /** @type {Array<[string, number, string]>} */
  const oversizedFiles = [['big.png', 10.01, 'image/png'], ['big.mp4', 100.01, 'video/mp4'], ['big.zip', 30.01, 'application/zip']]
  for (const [name, size, mime] of oversizedFiles) {
    await add(name, size, mime)
    await expect(page.locator('.feedback-file-item')).toHaveCount(0)
    await expect(page.locator('[role="alert"]')).toContainText('per-file limit')
  }
  await add('clip.mp4', 100, 'video/mp4'); await add('one.zip', 30); await add('two.zip', 16)
  await expect(page.locator('.feedback-file-item')).toHaveCount(2)
  await expect(page.locator('[role="alert"]')).toContainText('145 MB')
  await clear()
  for (const name of ['a.zip', 'a.zip', 'b.zip', 'c.zip', 'd.zip']) await add(name, .01)
  await expect(page.locator('.feedback-file-item')).toHaveCount(3)
  await expect(page.locator('[role="alert"]')).toContainText('3 attachments')
  await clear()
  log('Feedback passed: both languages, all 3 types, multipart boundary/fields, duplicate-submit lock, issueNumber, delayed success/failure preserves newer text and added/replaced attachments, 400/413/429/500/502 plain-text errors, picker/drop/paste, removal/deduplication, per-file/count/total limits. All API calls mocked locally.')
} finally { await browser.close() }
