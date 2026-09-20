/* global console, document, File, DataTransfer, DragEvent, ClipboardEvent, Uint8Array */
import { chromium, expect } from '@playwright/test'

const browser = await chromium.launch()
const base = 'http://127.0.0.1:4173'
try {
  const page = await browser.newPage()
  let requests = [], response = { status: 200, payload: { ok: true, issueNumber: 123 } }
  let release
  await page.route('**/api/feedback', async route => {
    requests.push(route.request())
    if (release) await release
    await route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.payload) })
  })
  for (const locale of ['', '/en']) for (const type of ['bug', 'feature', 'documentation']) {
    await page.goto(base + locale + '/feedback/' + type)
    await page.locator('#' + type + '-title').fill('Local mock only')
    await page.locator('#' + type + (type === 'feature' ? '-problem' : '-description')).fill('Test description')
    if (type === 'feature') {
      await page.locator('#feature-workaround').fill('Workaround')
      await page.locator('#feature-extra').fill('Extra')
    }
    await page.locator('.feedback-file-input').setInputFiles({ name: 'sample.txt', mimeType: 'text/plain', buffer: Buffer.from('local mock') })
    let unlock
    release = new Promise(resolve => { unlock = resolve })
    const before = requests.length
    await page.locator('.feedback-submit-button').click()
    await expect(page.locator('.feedback-submit-button')).toBeDisabled()
    await page.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    await expect.poll(() => requests.length).toBe(before + 1)
    unlock(); release = undefined
    await expect(page.locator('.feedback-notice--success')).toContainText('#123')
    const request = requests.at(-1), body = request.postDataBuffer().toString()
    if (!request.headers()['content-type'].includes('multipart/form-data; boundary=')) throw new Error('Missing browser boundary')
    for (const key of ['type', 'title', 'description', 'website', 'attachments']) if (!body.includes('name="' + key + '"')) throw new Error('Missing ' + key)
    if (!body.includes('\r\n\r\n' + type + '\r\n')) throw new Error('Wrong type')
    if (type === 'feature' && (!body.includes('Workaround') || !body.includes('Extra'))) throw new Error('Missing workaround/extra')
  }
  await page.goto(base + '/en/feedback/bug')
  await page.locator('#bug-title').fill('Local mock only')
  await page.locator('#bug-description').fill('Test')
  for (const status of [400, 413, 429, 500, 502]) {
    response = { status, payload: { ok: false, error: 'Server message ' + status + ' <b>plain text</b>' } }
    await page.locator('.feedback-submit-button').click()
    await expect(page.locator('[role="alert"]')).toHaveText(response.payload.error)
    await expect(page.locator('[role="alert"] b')).toHaveCount(0)
  }
  const add = async (name, mb, type = 'application/zip', paste = false) => page.evaluate(({ name, mb, type, paste }) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(Math.round(mb * 1024 * 1024))], name, { type }))
    document.querySelector('.feedback-dropzone').dispatchEvent(paste ? new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, { name, mb, type, paste })
  const clear = async () => { while (await page.locator('.feedback-file-remove').count()) await page.locator('.feedback-file-remove').first().click() }
  await add('capture.png', .01, 'image/png', true)
  await expect(page.locator('.feedback-file-meta')).toContainText('screenshot-')
  await clear()
  for (const [name, size, mime] of [['big.png', 10.01, 'image/png'], ['big.mp4', 100.01, 'video/mp4'], ['big.zip', 30.01, 'application/zip']]) {
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
  console.log('Feedback passed: both languages, all 3 types, multipart boundary/fields, duplicate-submit lock, issueNumber, 400/413/429/500/502 plain-text errors, picker/drop/paste, removal/deduplication, per-file/count/total limits. All API calls mocked locally.')
} finally { await browser.close() }
