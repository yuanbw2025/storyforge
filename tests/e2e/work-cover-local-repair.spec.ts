import { expect, test, type Page } from '@playwright/test'
import { createCanvas } from '@napi-rs/canvas'

const canvas = createCanvas(12, 18)
canvas.getContext('2d').fillRect(0, 0, 12, 18)
const base64 = canvas.toBuffer('image/png').toString('base64')
type RepairInput = { scope: { projectId: number; worldId: number; workId: number }; sourceRunId: number;
  draftId: number; expectedDraftRevision: number; expectedWorkUpdatedAt: number }

async function seed(page: Page): Promise<RepairInput> {
  return page.evaluate(async () => {
    const root = '/storyforge/'
    const { seedCurrentWorkspace } = await import(root + 'tests/helpers/current-workspace.ts')
    const { saveWorkCoverDraftV1 } = await import(root + 'src/lib/work-cover/drafts.ts')
    const { prepareCoverRunV1, submitCoverImageOnceV1 } = await import(root + 'src/lib/work-cover/run.ts')
    const { failCoverRunV1 } = await import(root + 'src/lib/work-cover/run-evidence.ts')
    const { db } = await import(root + 'src/lib/db/schema.ts')
    await seedCurrentWorkspace('排除相同坐标')
    const { scope, work } = await seedCurrentWorkspace('同存储双标签页封面恢复')
    const draft = await saveWorkCoverDraftV1({ scope, prompt: '海上灯塔', expectedRevision: null, expectedWorkUpdatedAt: work.updatedAt })
    const connection = { presetId: 'fixture-image', imageModel: 'agnes-image-2.1-flash', config: {
      provider: 'agnes', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: 'isolated-fixture-key', model: 'fixture-text', temperature: 0.7, maxTokens: 0 } }
    const auth = await prepareCoverRunV1({ scope, draftId: draft.id, expectedDraftRevision: draft.revision, connection, currentConnection: () => connection })
    await submitCoverImageOnceV1(auth)
    const buffer = await db.workCoverResponseBuffers.where('runId').equals(auth.runId).first()
    await db.workCoverResponseBuffers.update(buffer.id, { state: 'failed', errorCode: 'image-response-rejected' })
    await failCoverRunV1(scope, auth.runId, 'image-response-rejected')
    return { scope, sourceRunId: auth.runId, draftId: draft.id, expectedDraftRevision: draft.revision, expectedWorkUpdatedAt: work.updatedAt }
  })
}
async function state(page: Page, input: RepairInput) {
  return page.evaluate(async input => {
    const path = '/storyforge/src/lib/db/schema.ts', { db } = await import(path)
    const buffer = await db.workCoverResponseBuffers.where('runId').equals(input.sourceRunId).first()
    const runs = await db.agentRuns.where('workId').equals(input.scope.workId).toArray()
    return { runs: runs.map((row: { id: number; status: string }) => ({ id: row.id, status: row.status })),
      assets: await db.workCoverAssets.where('workId').equals(input.scope.workId).count(), phase: buffer.localRepairJson ? JSON.parse(buffer.localRepairJson).phase : null,
      sourceState: buffer.state, raw: Boolean(buffer.payload), cover: (await db.works.get(input.scope.workId)).coverImage ?? '' }
  }, input)
}
test.use({ trace: 'off' })

test('two pages share actual IDB/Web Lock; one intent/root/result settles before release', async ({ context, page }) => {
  let posts = 0, forbidden = 0
  await context.route('**/*', route => {
    const request = route.request()
    if (request.url() === 'https://apihub.agnes-ai.com/v1/images/generations' && request.method() === 'POST') {
      posts++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ task_id: 'fixture-receipt', data: [{ url: '', b64_json: base64 }] }) })
    }
    if (!request.url().startsWith('http://127.0.0.1:') || !['GET', 'HEAD'].includes(request.method())) { forbidden++; return route.abort() }
    return route.continue()
  })
  await page.goto('long')
  const input = await seed(page), second = await context.newPage()
  await second.goto('long')
  await page.evaluate(async input => {
    const path = '/storyforge/src/lib/work-cover/repair.ts', { repairSavedWorkCoverImageV1 } = await import(path)
    const testWindow = window as unknown as Record<string, any>
    const original = navigator.locks.request.bind(navigator.locks)
    navigator.locks.request = ((name: string, options: LockOptions, callback: LockGrantedCallback) => original(name, options, async lock => {
      testWindow.holdingRepair = true
      await new Promise<void>(resolve => { testWindow.releaseRepairStart = resolve })
      const result = await callback(lock)
      testWindow.repairSettledInsideLock = true
      await new Promise<void>(resolve => { testWindow.releaseRepairEnd = resolve })
      return result
    })) as typeof navigator.locks.request
    testWindow.repairPromise = repairSavedWorkCoverImageV1(input).then((asset: { id: number }) => asset.id)
  }, input)
  await expect.poll(() => page.evaluate(() => Boolean((window as any).holdingRepair))).toBe(true)
  await second.evaluate(async input => {
    const path = '/storyforge/src/lib/work-cover/repair.ts', { repairSavedWorkCoverImageV1 } = await import(path)
    ;(window as any).repairPromise = repairSavedWorkCoverImageV1(input).then((asset: { id: number }) => asset.id)
  }, input)
  await expect.poll(() => second.evaluate(async () => (await navigator.locks.query()).pending?.filter(lock => lock.name?.startsWith('storyforge:work-cover-repair:')).length)).toBe(1)
  expect((await state(second, input)).runs).toHaveLength(1)
  await page.evaluate(() => (window as any).releaseRepairStart())
  await expect.poll(() => page.evaluate(() => Boolean((window as any).repairSettledInsideLock))).toBe(true)
  const committed = await state(second, input)
  expect(committed).toMatchObject({ assets: 1, phase: 'candidate-ready', sourceState: 'failed', raw: false, cover: '' })
  expect(committed.runs.map(run => run.status).sort()).toEqual(['completed', 'failed'])
  expect(await second.evaluate(async () => (await navigator.locks.query()).pending?.length)).toBe(1)
  await page.evaluate(() => (window as any).releaseRepairEnd())
  const ids = await Promise.all([page.evaluate(() => (window as any).repairPromise), second.evaluate(() => (window as any).repairPromise)])
  expect(ids[0]).toBe(ids[1]); expect(await state(second, input)).toEqual(committed)
  expect(posts).toBe(1); expect(forbidden).toBe(0)
})

test('another page reconciles a committed root after creator closes before Buffer binding', async ({ context, page }) => {
  let posts = 0
  await context.route('https://apihub.agnes-ai.com/v1/images/generations', route => {
    posts++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: [{ url: null, b64_json: base64 }] }) })
  })
  await page.goto('long')
  const input = await seed(page), second = await context.newPage()
  await second.goto('long')
  const error = await page.evaluate(async input => {
    const root = '/storyforge/src/lib/', { db } = await import(root + 'db/schema.ts')
    const { repairSavedWorkCoverImageV1 } = await import(root + 'work-cover/repair.ts')
    const update = db.workCoverResponseBuffers.update.bind(db.workCoverResponseBuffers)
    db.workCoverResponseBuffers.update = (key: number, changes: { localRepairJson?: string }) => {
      if (changes.localRepairJson && JSON.parse(changes.localRepairJson).phase === 'bound') throw Error('fixture-creator-ended-before-bind')
      return update(key, changes)
    }
    try { await repairSavedWorkCoverImageV1(input); return 'unexpected success' } catch (error) { return String(error) }
  }, input)
  expect(error).toContain('fixture-creator-ended-before-bind')
  const interrupted = await state(second, input)
  expect(interrupted).toMatchObject({ phase: 'creating-root', assets: 0, raw: true })
  expect(interrupted.runs).toHaveLength(2)
  await page.close()
  await second.evaluate(async input => {
    const path = '/storyforge/src/lib/work-cover/repair.ts', { repairSavedWorkCoverImageV1 } = await import(path)
    await repairSavedWorkCoverImageV1(input)
  }, input)
  const result = await state(second, input)
  expect(result).toMatchObject({ phase: 'candidate-ready', assets: 1, raw: false, cover: '' })
  expect(result.runs).toHaveLength(2); expect(posts).toBe(1)
})
