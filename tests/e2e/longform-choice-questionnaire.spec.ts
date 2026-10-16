import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { makeQuestionnairePackets, readChoiceReviewHtml, renderQuestionnaire } from '../../scripts/quality-evals/longform-choice-questionnaire.mjs'

const { packets } = makeQuestionnairePackets({ studyId: 'Q10-ui-preview', mode: 'preview', participants: ['R01', 'R02'], samples: [1, 2].map(chapter => ({ pairId: `demo-${chapter}`, workId: 'demo', chapter, genre: '都市系统文', baseline: '第一段原稿。\n第二段原稿。', improved: '第一段另一稿。\n第二段另一稿。' })) }, 'ui-frozen-seed')

test('选择问卷无需打字，自动保存和刷新恢复，只有含答案 HTML 的保存入口', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/__choice-preview', route => route.fulfill({ contentType: 'text/html', body: renderQuestionnaire(packets[0]) }))
  await page.goto('__choice-preview')
  await expect(page.getByText('流程预览：', { exact: false })).toBeVisible()
  await expect(page.locator('textarea, input[type="text"], input[type="email"], input[type="number"]')).toHaveCount(0)
  await page.getByText('参与情况（首次填写即可）', { exact: true }).click()
  await page.getByRole('radio', { name: '读者', exact: true }).check()
  await page.getByRole('radio', { name: '经常', exact: true }).check()
  await page.getByRole('radio', { name: '是', exact: true }).check()
  for (const side of ['A', 'B']) {
    await page.getByLabel(`版本${side}阅读位置`).selectOption('end')
    await page.getByRole('group', { name: '愿意读这版的下一章吗？' }).nth(side === 'A' ? 0 : 1).getByRole('radio', { name: '可能', exact: true }).check()
  }
  for (const label of ['代入与期待', '因果与主动选择', '情绪与兑现', '人物声音', '节奏与重复', '前后连贯']) {
    const groups = page.getByRole('group', { name: label, exact: true })
    for (const index of [0, 1]) await groups.nth(index).getByRole('radio', { name: '3', exact: true }).check()
  }
  await page.getByRole('group', { name: '综合比较，你更想继续读哪一版？' }).getByRole('radio', { name: '持平', exact: true }).check()
  await page.getByRole('checkbox', { name: '无明显差别', exact: true }).check()
  await expect(page.locator('#progress')).toContainText('1 / 2 组已填完')
  await page.reload()
  await expect(page.getByRole('radio', { name: '持平', exact: true })).toBeChecked()
  await page.getByRole('button', { name: '下一组', exact: true }).click()
  await expect(page.locator('#chapter')).toContainText('第 2 章')
  await page.getByRole('button', { name: '上一组', exact: true }).click()
  await expect(page.locator('input[type="file"], #export, #restore, #download-questionnaire')).toHaveCount(0)
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存已填写 HTML', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Q10-ui-preview-R01-result.html')
  const savedPath = testInfo.outputPath('complete-first-pair.html')
  await download.saveAs(savedPath)
  const saved = readChoiceReviewHtml(packets[0], await readFile(savedPath, 'utf8'))
  expect(saved.review.answers[0].preference).toBe('tie')
  expect(saved.review.mode).toBe('preview')
  expect(saved.validation.completedPairs).toBe(1)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(errors).toEqual([])
})

test('只保存并回传一份已填写 HTML，另一设备断网直接打开自动恢复，不需导入', async ({ page, browser }, testInfo) => {
  await page.route('**/__choice-single-file', route => route.fulfill({ contentType: 'text/html', body: renderQuestionnaire(packets[0]) }))
  await page.goto('__choice-single-file')
  await page.getByText('参与情况（首次填写即可）', { exact: true }).click()
  await page.getByRole('radio', { name: '读者', exact: true }).check()
  await page.getByRole('group', { name: '综合比较，你更想继续读哪一版？' }).getByRole('radio', { name: 'A', exact: true }).check()
  await page.getByRole('checkbox', { name: '语言更自然', exact: true }).check()
  await page.getByLabel('版本A阅读位置').selectOption('1')
  await page.getByRole('button', { name: '下一组', exact: true }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '保存已填写 HTML', exact: true }).click()
  const downloaded = await downloadPromise
  expect(downloaded.suggestedFilename()).toBe('Q10-ui-preview-R01-result.html')
  const path = testInfo.outputPath('answered.html')
  await downloaded.saveAs(path)
  const result = readChoiceReviewHtml(packets[0], await readFile(path, 'utf8'))
  expect(result.review.role).toBe('reader')
  expect(result.review.answers[0].preference).toBe('A')
  expect(result.review.answers[0].reasons).toEqual(['prose'])
  expect(result.validation.complete).toBe(false)

  const freshContext = await browser.newContext({ offline: true, acceptDownloads: true })
  try {
    await freshContext.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('storage disabled', 'SecurityError') } }))
    const fresh = await freshContext.newPage()
    await fresh.goto(pathToFileURL(path).href)
    await expect(fresh.locator('#notice')).toContainText('已自动恢复这份 HTML 中的答案')
    await expect(fresh.locator('#chapter')).toContainText('第 2 章')
    await fresh.getByRole('button', { name: '上一组', exact: true }).click()
    await expect(fresh.getByRole('radio', { name: 'A', exact: true })).toBeChecked()
    await expect(fresh.getByRole('checkbox', { name: '语言更自然', exact: true })).toBeChecked()
    await expect(fresh.getByLabel('版本A阅读位置')).toHaveValue('1')
    await fresh.getByText('参与情况（首次填写即可）', { exact: true }).click()
    await expect(fresh.getByRole('radio', { name: '读者', exact: true })).toBeChecked()
    await fresh.getByRole('radio', { name: 'B', exact: true }).check()
    const resavedPromise = fresh.waitForEvent('download')
    await fresh.getByRole('button', { name: '保存已填写 HTML', exact: true }).click()
    const resaved = await resavedPromise
    const resavedPath = testInfo.outputPath('answered-again.html')
    await resaved.saveAs(resavedPath)
    const newResult = readChoiceReviewHtml(packets[0], await readFile(resavedPath, 'utf8'))
    expect(newResult.review.answers[0].preference).toBe('B')
    expect(newResult.review.role).toBe('reader')
    expect((await readFile(resavedPath, 'utf8')).match(/<script id="saved-review"/g)).toHaveLength(1)
  } finally { await freshContext.close() }
})

test('空白 HTML 断网打开，保存的问卷在另一浏览器自动恢复且不联网', async ({ browser }, testInfo) => {
  const htmlPath = testInfo.outputPath('blank.html')
  await writeFile(htmlPath, renderQuestionnaire(packets[0]))
  const offline = await browser.newContext({ offline: true, acceptDownloads: true })
  const restored = await browser.newContext({ offline: true, acceptDownloads: true })
  const requests: string[] = []
  const errors: string[] = []
  try {
    await offline.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('storage disabled', 'SecurityError') } }))
    for (const context of [offline, restored]) context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
    const local = await offline.newPage()
    local.on('pageerror', error => errors.push(error.message))
    await local.goto(pathToFileURL(htmlPath).href)
    await expect(local.locator('input:checked')).toHaveCount(0)
    await local.getByRole('group', { name: '综合比较，你更想继续读哪一版？' }).getByRole('radio', { name: 'B', exact: true }).check()
    await local.getByLabel('版本A阅读位置').selectOption('end')
    const resultPromise = local.waitForEvent('download')
    await local.getByRole('button', { name: '保存已填写 HTML', exact: true }).click()
    const result = await resultPromise
    const resultPath = testInfo.outputPath('saved-result.html')
    await result.saveAs(resultPath)
    const review = readChoiceReviewHtml(packets[0], await readFile(resultPath, 'utf8')).review
    expect(review.participantCode).toBe('R01')
    expect(review.answers[0].preference).toBe('B')
    expect(review.answers[0].a.readTo).toBe('end')
    expect(review.answers[0].a.scores.immersion).toBeNull()
    const fresh = await restored.newPage()
    fresh.on('pageerror', error => errors.push(error.message))
    await fresh.goto(pathToFileURL(resultPath).href)
    await expect(fresh.getByRole('radio', { name: 'B', exact: true })).toBeChecked()
    await expect(fresh.getByLabel('版本A阅读位置')).toHaveValue('end')
    await expect(fresh.locator('#notice')).toContainText('已自动恢复这份 HTML 中的答案')
    expect(requests).toEqual([])
    expect(errors).toEqual([])
  } finally { await offline.close(); await restored.close() }
})
