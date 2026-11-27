import { test, expect } from '@playwright/test'

test('runtime errors survive refresh and remain local until the author opens a reviewed feedback handoff', async ({ page }) => {
  const reports: string[] = []
  await page.route('**/api/feedback', async route => {
    reports.push(route.request().url())
    await route.fulfill({ status: 500, body: 'Local interception: no real submission' })
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'failure-feedback-isolated-check'))
  await page.goto('home/settings')
  await expect(page.getByRole('region', { name: '问题与故障反馈' })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => {
    localStorage.setItem('failure-test-private-config', 'API-PRIVATE-SENTINEL')
    const error = new TypeError('MANUSCRIPT-PRIVATE-SENTINEL')
    error.stack = 'TypeError: MANUSCRIPT-PRIVATE-SENTINEL\n at render (http://localhost/storyforge/assets/example-app.js:40:2)'
    window.dispatchEvent(new ErrorEvent('error', { error }))
  })
  await page.reload()
  const panel = page.getByRole('region', { name: '问题与故障反馈' })
  await panel.getByRole('button', { name: '查看故障摘要并反馈' }).click()
  const preview = panel.getByLabel('故障摘要预览')
  await expect(preview).toContainText('TypeError')
  await expect(preview).not.toContainText('PRIVATE-SENTINEL')
  await expect(panel.getByRole('button', { name: '提交反馈', exact: true })).toBeVisible()
  expect(reports).toEqual([])
  await panel.getByRole('button', { name: '取消', exact: true }).click()
  await expect(preview).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('failure-test-private-config'))).toBe('API-PRIVATE-SENTINEL')
  expect(reports).toEqual([])
})

test('an application module loading failure still offers a database-independent local feedback preview', async ({ page }) => {
  await page.route('**/src/main.tsx*', route => route.abort())
  await page.goto('home/settings')
  const button = page.getByRole('button', { name: '查看故障摘要并反馈' })
  await expect(button).toBeVisible()
  await button.click()
  await expect(page.locator('#root pre')).toContainText('bootstrap')
  await expect(page.getByRole('link', { name: '带摘要打开官方反馈表单（不会自动提交）' })).toHaveAttribute('href', /#storyforge-report=/)
})

test('explicit retry recovers a failed home import after pending edits persist without clearing browser data', async ({ page }) => {
  let attempts = 0
  await page.route('**/src/pages/HomePage.tsx*', route => {
    attempts++
    return attempts === 1 ? route.abort() : route.continue()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'isolated-import-retry'))
  await page.goto('home')
  await expect(page.getByRole('heading', { name: '出了点问题 😅' })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(async () => {
    localStorage.setItem('import-retry-sentinel', 'retain-author-settings')
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('import-retry-isolated-data', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('saved')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const { registerPendingDraftFlusherV1 } = await (new Function('path', 'return import(path)'))('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')
    registerPendingDraftFlusherV1(async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('saved', 'readwrite')
        transaction.objectStore('saved').put('persisted-before-retry', 'draft')
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
      })
      database.close()
    })
  })
  expect(attempts).toBe(1)
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible({ timeout: 15_000 })
  expect(attempts).toBe(2)
  expect(await page.evaluate(() => localStorage.getItem('import-retry-sentinel'))).toBe('retain-author-settings')
  expect(await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('import-retry-isolated-data', 1)
      open.onsuccess = () => {
        const database = open.result
        const request = database.transaction('saved').objectStore('saved').get('draft')
        request.onsuccess = () => { resolve(request.result); database.close() }
        request.onerror = () => reject(request.error)
      }
      open.onerror = () => reject(open.error)
    })
  })).toBe('persisted-before-retry')
})

test('failed pending saves prevent an explicit module recovery reload', async ({ page }) => {
  let attempts = 0
  await page.route('**/src/pages/HomePage.tsx*', route => { attempts++; return route.abort() })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'isolated-import-save-failure'))
  await page.goto('home')
  await expect(page.getByRole('heading', { name: '出了点问题 😅' })).toBeVisible({ timeout: 30_000 })
  await page.evaluate(async () => {
    localStorage.setItem('import-retry-unsaved', 'retain-draft')
    const imp = new Function('path', 'return import(path)')
    const { registerPendingDraftFlusherV1 } = await imp('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')
    registerPendingDraftFlusherV1(() => Promise.reject(new Error('synthetic save failure')))
  })
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('编辑尚未保存成功，未重新加载。请保留当前页面并重试保存。')
  expect(attempts).toBe(1)
  expect(await page.evaluate(() => localStorage.getItem('import-retry-unsaved'))).toBe('retain-draft')
})

test('a persistent module outage retries only on author request and keeps the error visible', async ({ page }) => {
  let attempts = 0
  await page.route('**/src/pages/HomePage.tsx*', route => { attempts++; return route.abort() })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'isolated-persistent-import-outage'))
  await page.goto('home')
  await expect(page.getByRole('heading', { name: '出了点问题 😅' })).toBeVisible({ timeout: 30_000 })
  expect(attempts).toBe(1)
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect.poll(() => attempts).toBe(2)
  await expect(page.getByRole('heading', { name: '出了点问题 😅' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试', exact: true })).toBeEnabled()
  expect(attempts).toBe(2)
})

test('world rules with a missing text field remain readable without implicit writes and can be explicitly repaired', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'isolated-partial-rule'))
  await page.goto('world/worlds')
  await expect(page.getByTestId('world-engine-page')).toBeVisible({ timeout: 30_000 })
  const fixture = await page.evaluate(async () => {
    const imp = new Function('path', 'return import(path)')
    const { createWorkspace } = await imp('/storyforge/src/lib/workspace/create-workspace.ts')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    const { useWorldRulesStore } = await imp('/storyforge/src/stores/world-rules.ts')
    const created = await createWorkspace({ name: '规则缺字段隔离回归', description: '', genres: [], status: 'drafting', targetWordCount: 0 }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
    await useWorldRulesStore.getState().loadProfile(created.project.id)
    const id = useWorldRulesStore.getState().profile.id
    await db.worldRulesProfiles.update(id, { entries: { 'era.period': { historicalAnchors: '既有规则文字必须保留', priority: 'historical' } }, updatedAt: 1 })
    return { projectId: created.project.id, id, original: JSON.stringify(await db.worldRulesProfiles.get(id)) }
  })
  await page.goto(`world/basics?project=${fixture.projectId}&module=world-rules`)
  await expect(page.getByRole('heading', { name: /真实与幻想/ })).toBeVisible()
  await page.getByRole('button', { name: /历史时期/ }).click()
  const historical = page.getByPlaceholder(/这个维度中有哪些内容是取自真实历史或现实的/)
  const fictional = page.getByPlaceholder('这个维度中有哪些内容是虚构或改编的？例如：在真实官制基础上增设灵修院，专管修士事务')
  await expect(historical).toHaveValue('既有规则文字必须保留')
  await expect(fictional).toHaveValue('')
  const read = () => page.evaluate(async id => {
    const imp = new Function('path', 'return import(path)')
    const { db } = await imp('/storyforge/src/lib/db/schema.ts')
    return await db.worldRulesProfiles.get(id)
  }, fixture.id)
  expect(JSON.stringify(await read())).toBe(fixture.original)
  await page.reload()
  await page.getByRole('button', { name: /历史时期/ }).click()
  await expect(historical).toHaveValue('既有规则文字必须保留')
  expect(JSON.stringify(await read())).toBe(fixture.original)
  await fictional.fill('作者明确补全的架空规则')
  await expect.poll(async () => (await read()).entries['era.period'].fictionalAdaptations).toBe('作者明确补全的架空规则')
  await page.reload()
  await page.getByRole('button', { name: /历史时期/ }).click()
  await expect(fictional).toHaveValue('作者明确补全的架空规则')
  await expect(historical).toHaveValue('既有规则文字必须保留')
})


test('native history replay after browser summary rotation retains the acknowledged occurrence across refresh', async ({ page }) => {
  const reports: unknown[][] = []
  await page.route('**/v1/client-support/events', async route => {
    const body = route.request().postDataJSON()
    reports.push(body.events)
    await route.fulfill({ json: { accepted: body.events.map((row: { id: string }) => row.id), discarded: [] } })
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'isolated-native-replay'))
  await page.goto('home')
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible({ timeout: 30_000 })
  const occurredAt = new Date(Date.now() - 120_000).toISOString()
  const collect = async (fresh: boolean) => page.evaluate(async ({ occurredAt, fresh }) => {
    const load = new Function('path', 'return import(path)')
    const telemetry = await load('/storyforge/src/lib/feedback/client-telemetry.ts')
    const runtime = await load('/storyforge/src/lib/diagnostics/runtime-errors.ts')
    const native = await load('/storyforge/src/lib/platform/native-diagnostics.ts')
    const unsubscribe = runtime.subscribeRuntimeDiagnostics(telemetry.recordClientError)
    const oldBridge = window.storyforgeClient
    const row = { occurredAt, source: 'native', name: 'NativeInterrupted', build: 'v4.0.3+local', frames: [] }
    try {
      window.storyforgeClient = { diagnostics: async () => fresh ? [row, { ...row, occurredAt: new Date().toISOString() }] : [row] } as unknown as typeof window.storyforgeClient
      telemetry.setTelemetryPreferences(false, true)
      await native.collectNativeDiagnostics()
      await telemetry.flushClientTelemetry()
      return JSON.parse(localStorage.getItem(telemetry.TELEMETRY_KEY)!).queue.length
    } finally {
      window.storyforgeClient = oldBridge
      unsubscribe()
    }
  }, { occurredAt, fresh })
  expect(await collect(false)).toBe(0)
  expect(reports).toHaveLength(1)
  await page.evaluate(() => {
    localStorage.setItem('storyforge-runtime-diagnostics-v1', JSON.stringify(Array.from({ length: 20 }, (_, i) => ({
      occurredAt: new Date(Date.now() - i * 1000).toISOString(), source: 'react', name: 'TypeError', build: 'v4.0.4+local', frames: [],
    }))))
  })
  await page.reload()
  await expect(page.getByRole('heading', { name: '首页', exact: true })).toBeVisible()
  expect(await collect(false)).toBe(0)
  expect(reports).toHaveLength(1)
  expect(await collect(true)).toBe(1)
  await page.evaluate(async () => {
    const telemetry = await (new Function('path', 'return import(path)'))('/storyforge/src/lib/feedback/client-telemetry.ts')
    telemetry.setTelemetryPreferences(false, false)
    const state = JSON.parse(localStorage.getItem(telemetry.TELEMETRY_KEY)!)
    if (state.queue.length || state.nativeSeen.length) throw new Error('Consent withdrawal must clear pending and replay metadata')
  })
  expect(reports).toHaveLength(1)
})
