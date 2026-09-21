import { deflateSync } from 'node:zlib'
import { expect, test } from '@playwright/test'

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, checksum])
}

function solidPng(width: number, height: number, color: [number, number, number, number]): Buffer {
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const pixel = row + 1 + x * 4
      raw[pixel] = color[0]
      raw[pixel + 1] = color[1]
      raw[pixel + 2] = color[2]
      raw[pixel + 3] = color[3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

test('旧两图商业 Build 可在同一 Production 取消、修订为十二图 Brief 并重新授权', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-adventure-legacy-media-repair-e2e')
    localStorage.setItem('storyforge-ai-api-key-remember', 'true')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'agnes', apiKey: 'e2e-existing-global-key', model: 'agnes-2.0-flash',
      baseUrl: 'https://apihub.agnes-ai.com/v1', temperature: 0, maxTokens: 0,
    }))
  })
  let imageRequests = 0
  await page.route('**/images/generations', async route => {
    imageRequests += 1
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"unexpected image request"}' })
  })
  await page.route('**/chat/completions', async route => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"intentional e2e stop"}' })
  })
  const image = solidPng(1280, 720, [28, 52, 70, 255])
  await page.goto('./')
  const seeded = await page.evaluate(async imageBase64 => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const fixture = await importer('/storyforge/tests/helpers/text-adventure-media-revision-workbench.ts')
    return fixture.seedTextAdventureLegacyCommercialGateV1(imageBase64)
  }, image.toString('base64'))

  await page.reload()
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '制作', exact: true }).click()
  const studio = page.getByTestId('product-production-studio')
  await expect(studio).toContainText('潮门灯塔 · 媒资修订验收')
  await expect(page.getByTestId('text-adventure-media-plan-blocker')).toContainText('2 张图片')
  await expect(page.getByTestId('text-adventure-media-plan-blocker')).toContainText('12 张底线')
  await expect(studio.getByRole('button', { name: '确认角色锚点并开始出图' })).toBeDisabled()
  expect(imageRequests).toBe(0)

  await studio.getByRole('button', { name: '拒绝并取消 Build' }).click()
  await expect(page.getByTestId('product-production-command-activity')).toContainText('处理角色视觉锚点决策 · succeeded')
  await expect(page.getByTestId('text-adventure-commercial-media-repair')).toContainText('旧 Build 已安全取消')
  await studio.getByRole('button', { name: '生成 12 图修订 Brief' }).click()
  const diff = page.getByTestId('text-adventure-commercial-media-repair-diff')
  await expect(diff).toContainText('图片：2 → 12')
  await expect(diff).toContainText('来源 hash：保持不变')
  await studio.getByRole('button', { name: '保存为 Brief r2' }).click()
  await expect(studio).toContainText('r2 · 草稿')
  await expect(studio).toContainText('#1 · 已取消')

  const revised = await page.evaluate(async productionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const production = await db.productProductions.get(productionId)
    const briefs = await db.productProductionBriefs.where('productionId').equals(productionId).sortBy('revision')
    const builds = await db.productBuilds.where('productionId').equals(productionId).sortBy('buildNumber')
    return {
      productionKey: production?.productionKey,
      status: production?.status,
      briefs: briefs.map((row: any) => {
        const brief = JSON.parse(row.briefJson)
        return {
          revision: row.revision, status: row.status, worldHash: brief.source.worldContentHash,
          imageCount: brief.media.imageCount,
          maximumMediaCalls: brief.productionBudget.maximumMediaCalls,
        }
      }),
      builds: builds.map((row: any) => ({ number: row.buildNumber, status: row.status })),
    }
  }, seeded.productionId)
  expect(revised.status).toBe('brief-ready')
  expect(revised.briefs).toHaveLength(2)
  expect(revised.briefs[0]).toMatchObject({ revision: 1, imageCount: 2 })
  expect(revised.briefs[1]).toMatchObject({ revision: 2, status: 'draft', imageCount: 12, maximumMediaCalls: 12 })
  expect(revised.briefs[1].worldHash).toBe(revised.briefs[0].worldHash)
  expect(revised.builds).toEqual([{ number: 1, status: 'cancelled' }])

  const authorize = studio.getByRole('button', { name: '作者授权并开始自动制作' })
  await expect(authorize).toBeEnabled()
  await authorize.click()
  await expect.poll(async () => page.evaluate(async productionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const build = await db.productBuilds.where('[productionId+buildNumber]').equals([productionId, 2]).first()
    return build?.planRevision ?? 0
  }, seeded.productionId), { timeout: 20_000 }).toBe(1)

  const lineage = await page.evaluate(async productionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const rows = await db.productBuilds.where('productionId').equals(productionId).sortBy('buildNumber')
    const child = rows[1]
    const plan = JSON.parse(child.planJson)
    return {
      builds: rows.map((row: any) => ({
        number: row.buildNumber, briefRevision: row.briefRevision,
        parentBuildNumber: row.parentBuildNumber, status: row.status,
      })),
      visualTasks: plan.tasks.filter((task: any) => /^media\.visual\.\d{3}$/.test(task.taskKey)).length,
    }
  }, seeded.productionId)
  expect(lineage.builds[0]).toMatchObject({ number: 1, briefRevision: 1, status: 'cancelled' })
  expect(lineage.builds[1]).toMatchObject({ number: 2, briefRevision: 2, parentBuildNumber: 1 })
  expect(lineage.visualTasks).toBe(12)
  expect(imageRequests).toBe(0)

  const stop = studio.getByRole('button', { name: '停止', exact: true })
  if (await stop.isVisible()) await stop.click()
})

test('作者退回单图后从真实文件输入派生新 Build，并只在新 hash 上重新通过逐图验收', async ({ page }) => {
  test.setTimeout(120_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-adventure-media-revision-e2e')
  })
  const parentImage = solidPng(1280, 720, [18, 39, 58, 255])
  const replacementImage = solidPng(1280, 720, [72, 102, 132, 255])
  await page.goto('./')
  const seeded = await page.evaluate(async imageBase64 => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const fixture = await importer('/storyforge/tests/helpers/text-adventure-media-revision-workbench.ts')
    return fixture.seedTextAdventureMediaRevisionWorkbenchV1(imageBase64)
  }, parentImage.toString('base64'))

  await page.reload()
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '制作', exact: true }).click()
  const studio = page.getByTestId('product-production-studio')
  await expect(studio).toBeVisible({ timeout: 15_000 })
  await expect(studio).toContainText('潮门灯塔 · 媒资修订验收')
  const media = page.getByTestId('text-adventure-media-authoring')
  await expect(media).toContainText('2 张冻结图片')
  const reviewLayers = page.getByTestId('text-adventure-visual-review-layers')
  await expect(reviewLayers.locator('div').nth(0)).toContainText('已通过')
  await expect(reviewLayers.locator('div').nth(1)).toContainText('已实际观察并通过')
  await expect(studio).toContainText('Production 可预览')
  const first = media.locator('article').filter({ hasText: 'media.visual.001' })
  const second = media.locator('article').filter({ hasText: 'media.visual.002' })
  const firstImage = page.getByTestId('text-adventure-media-image-media.visual.001')
  await expect(firstImage).toHaveClass(/object-contain/)
  await expect(firstImage).not.toHaveClass(/object-cover/)
  const firstContract = page.getByTestId('text-adventure-media-contract-media.visual.001')
  await expect(firstContract).toContainText('职责：')
  await expect(firstContract).toContainText('场景 / 节拍：')
  await expect(firstContract).toContainText('请求 / 实际尺寸：')
  await expect(firstContract).toContainText('替代文本：')
  await expect(firstContract).toContainText('角色锚点：')
  await expect(firstContract).toContainText('硬约束：')
  await expect(firstContract).toContainText('Visual QA：accept')
  await first.getByRole('button', { name: '放大查看 media.visual.001' }).click()
  const lightbox = page.getByTestId('text-adventure-media-lightbox-media.visual.001')
  await expect(lightbox).toBeVisible()
  await expect(lightbox.locator('img')).toHaveClass(/object-contain/)
  await expect(lightbox.getByRole('link', { name: '新窗口打开' })).toHaveAttribute('target', '_blank')
  await lightbox.getByRole('button', { name: '关闭' }).click()
  await expect(lightbox).toBeHidden()
  await first.getByRole('textbox').fill('开场灯塔主体过暗，需要提高视觉焦点。')
  const rejectFirst = first.getByRole('button', { name: '退回修改' })
  await rejectFirst.click()
  await expect(rejectFirst).toHaveAttribute('aria-pressed', 'true')
  await second.getByRole('button', { name: '接受此图' }).click()
  await expect(second.getByRole('button', { name: '接受此图' })).toHaveAttribute('aria-pressed', 'true')
  const freezeReview = media.getByRole('button', { name: '冻结本次逐图审查回执' })
  await expect(freezeReview).toBeEnabled()
  await freezeReview.click()
  await expect(page.getByTestId('product-production-command-activity')).toContainText('冻结逐图审查回执 · succeeded')
  await expect(page.getByTestId('text-adventure-human-visual-review')).toContainText('1 张退回')
  await expect(page.getByTestId('text-adventure-human-visual-blocker')).toContainText('请修订后在新 Build 重新审查')

  const parentEvidence = await page.evaluate(async parentBuildId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const rows = await db.productQualityGateReceipts.where('buildId').equals(parentBuildId).toArray()
    return rows.filter((row: any) => row.gateId === 'text-adventure.visual.author-approval')
      .map((row: any) => ({ status: row.status, receiptHash: row.receiptHash }))
  }, seeded.parentBuildId)
  expect(parentEvidence).toEqual([{ status: 'failed', receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/) }])

  await media.getByLabel('我确认允许商业使用').check()
  await media.getByLabel('我确认允许随导出包与社区作品再分发').check()
  await first.locator('input[type="file"]').setInputFiles({
    name: 'author-replacement.png', mimeType: 'image/png', buffer: replacementImage,
  })
  await expect.poll(async () => page.evaluate(async productionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const production = await db.productProductions.get(productionId)
    return production?.currentBuildNumber ?? 0
  }, seeded.productionId), { timeout: 20_000 }).toBe(2)
  const pause = studio.getByRole('button', { name: '暂停', exact: true })
  await expect(pause).toBeEnabled({ timeout: 15_000 })
  await pause.click()
  await expect(studio).toContainText('Production 已暂停', { timeout: 15_000 })

  const child = await page.evaluate(async ({ scope, productionId }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const fixture = await importer('/storyforge/tests/helpers/text-adventure-media-revision-workbench.ts')
    return fixture.finalizeTextAdventureMediaRevisionBuildV1({ scope, productionId })
  }, { scope: seeded.scope, productionId: seeded.productionId })
  await studio.getByRole('button', { name: '刷新当前 Production' }).click()
  await expect(studio).toContainText('#2 · 可预览')
  await expect(media).not.toContainText('1 张退回')
  await expect(first).toContainText('author-upload')
  await expect(second).toContainText('e2e-controlled-fixture')

  await first.getByRole('button', { name: '接受此图' }).click()
  await second.getByRole('button', { name: '接受此图' }).click()
  await media.getByRole('button', { name: '冻结本次逐图审查回执' }).click()
  await expect(page.getByTestId('text-adventure-human-visual-review')).toContainText('全部接受')

  const evidence = await page.evaluate(async ({ parentBuildId, childBuildId }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const read = async (buildId: number) => (await db.productQualityGateReceipts
      .where('buildId').equals(buildId).toArray())
      .filter((row: any) => row.gateId === 'text-adventure.visual.author-approval')
      .map((row: any) => ({ status: row.status, receiptHash: row.receiptHash }))
    const childImages = (await db.productBuildArtifacts.where('buildId').equals(childBuildId).toArray())
      .filter((row: any) => row.kind === 'image')
      .map((row: any) => ({
        artifactKey: row.artifactKey,
        status: row.status,
        assetKey: JSON.parse(row.metadataJson).assetKey,
        source: JSON.parse(row.metadataJson).source,
      }))
      .sort((left: any, right: any) => left.artifactKey.localeCompare(right.artifactKey))
    return { parent: await read(parentBuildId), child: await read(childBuildId), childImages }
  }, { parentBuildId: seeded.parentBuildId, childBuildId: child.childBuildId })
  expect(evidence.parent).toEqual([{ status: 'failed', receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/) }])
  expect(evidence.child).toEqual([{ status: 'passed', receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/) }])
  expect(evidence.childImages).toEqual([
    {
      artifactKey: 'media.visual.001', status: 'accepted',
      assetKey: 'e2e.text-adventure.media-revision.build-2.media.visual.001', source: 'author-upload',
    },
    {
      artifactKey: 'media.visual.002', status: 'carried-forward',
      assetKey: 'e2e.text-adventure.media-revision.build-2.media.visual.002', source: 'e2e-controlled-fixture',
    },
  ])
})

test('作者退回意见绑定旧图 hash 与失败回执，单图重生成只让图片任务消费 repair feedback', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'text-adventure-author-repair-e2e')
  })
  let imageRequests = 0
  await page.route('**/images/generations', async route => {
    imageRequests += 1
    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"must-not-run"}' })
  })
  const parentImage = solidPng(1280, 720, [38, 56, 78, 255])
  await page.goto('./')
  const seeded = await page.evaluate(async imageBase64 => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const fixture = await importer('/storyforge/tests/helpers/text-adventure-media-revision-workbench.ts')
    return fixture.seedTextAdventureMediaRevisionWorkbenchV1(imageBase64)
  }, parentImage.toString('base64'))
  await page.reload()
  await page.getByTestId('product-tab-text-games').click()
  await page.getByRole('button', { name: '制作', exact: true }).click()
  const media = page.getByTestId('text-adventure-media-authoring')
  await expect(media).toContainText('2 张冻结图片')
  await expect(page.getByTestId('text-adventure-visual-review-layers')).toContainText('已实际观察并通过')
  const first = media.locator('article').filter({ hasText: 'media.visual.001' })
  const second = media.locator('article').filter({ hasText: 'media.visual.002' })
  const note = '角色脸型和年龄偏离冻结锚点；保留服装与构图，只修正五官和年龄。'
  const noteInput = first.getByRole('textbox')
  await expect(noteInput).toBeEnabled()
  await noteInput.fill(note)
  await expect(noteInput).toHaveValue(note)
  await first.getByRole('button', { name: '退回修改' }).click()
  await expect(first.getByRole('button', { name: '退回修改' })).toHaveAttribute('aria-pressed', 'true')
  await second.getByRole('button', { name: '接受此图' }).click()
  await expect(second.getByRole('button', { name: '接受此图' })).toHaveAttribute('aria-pressed', 'true')
  const freezeReview = media.getByRole('button', { name: '冻结本次逐图审查回执' })
  await expect(freezeReview).toBeEnabled()
  await freezeReview.click()
  const regenerate = first.getByRole('button', { name: '按作者意见重生成' })
  await expect(regenerate).toBeEnabled()
  await regenerate.click()
  await expect.poll(async () => page.evaluate(async productionId => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return (await db.productProductions.get(productionId))?.currentBuildNumber ?? 0
  }, seeded.productionId), { timeout: 20_000 }).toBe(2)

  const repair = await page.evaluate(async ({ productionId, note }) => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const builds = await db.productBuilds.where('productionId').equals(productionId).sortBy('buildNumber')
    const parent = builds[0]
    const child = builds[1]
    const receipt = (await db.productQualityGateReceipts.where('buildId').equals(parent.id).toArray())
      .find((row: any) => row.gateId === 'text-adventure.visual.author-approval')
    const feedback = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([child.id, 'media.repair-feedback']).first()
    const payload = JSON.parse(feedback.payloadJson)
    const plan = JSON.parse(child.planJson)
    const imageTask = plan.tasks.find((task: any) => task.taskKey === 'media.visual.001')
    const qaTasks = plan.tasks.filter((task: any) => task.kind === 'text-adventure-visual-quality-review-batch')
    return {
      parentStatus: parent.status, childNumber: child.buildNumber,
      receiptHash: receipt.receiptHash, feedbackParentHash: feedback.parentArtifactHash,
      carriedFrom: feedback.carriedFrom,
      sourceReceiptHash: payload.sourceReview.gateReceiptHash,
      priorContentHash: payload.targets[0].priorContentHash,
      issue: payload.targets[0].issues[0],
      imageInputs: imageTask.inputArtifactKeys,
      qaConsumesFeedback: qaTasks.some((task: any) => task.inputArtifactKeys.includes('media.repair-feedback')),
      note,
    }
  }, { productionId: seeded.productionId, note })
  expect(repair).toMatchObject({
    parentStatus: 'preview-ready', childNumber: 2,
    receiptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    feedbackParentHash: repair.receiptHash, carriedFrom: null,
    sourceReceiptHash: repair.receiptHash,
    priorContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    issue: { severity: 'blocking', category: 'author-direction', detail: note, recommendation: note },
    imageInputs: expect.arrayContaining(['media.repair-feedback']), qaConsumesFeedback: false,
  })
  expect(imageRequests).toBe(0)
})
