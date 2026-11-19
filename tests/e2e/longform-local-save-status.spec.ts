import { expect, test, type Page } from '@playwright/test'
const fields = ['worldStructure', 'worldDimensions', 'continentLayout', 'mountainsRivers', 'climateByRegion'] as const
const labels = ['世界结构', '疆域尺寸', '地貌分布', '山川水系', '气候环境']
let modelAttempts = 0
test.beforeEach(async ({ context, page, baseURL }) => {
  modelAttempts = 0; const origin = new URL(baseURL!).origin
  await context.addInitScript(() => localStorage.setItem('storyforge_guide_completed', '050-isolated'))
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (/\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)) modelAttempts++
    return url.origin === origin && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()
  })
  await page.goto('./')
})
test.afterEach(() => expect(modelAttempts).toBe(0))
async function seed(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { seedCurrentWorkspace } = await load<typeof import('../helpers/current-workspace')>('/storyforge/tests/helpers/current-workspace.ts')
    return (await seedCurrentWorkspace('050 隔离保存验收')).scope
  })
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    return (await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')).db.worldviews.toArray()
  })
}
async function flush(page: Page) {
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    await (await load<typeof import('../../src/lib/authoring/pending-edit-coordinator')>('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')).flushPendingEditsV1()
  })
}
const pane = (page: Page) => page.locator('.lf-world-field:visible').first()
async function enter(page: Page) {
  const field = pane(page)
  const entry = field.getByRole('button', { name: '编辑源码', exact: true }).or(field.locator('.cursor-text').first()).first()
  // Re-evaluate the live entry if DB loading swaps an empty placeholder for
  // the explicit Markdown source action; never choose via a premature probe.
  await expect(entry).toBeVisible(); await entry.click()
  return field.locator('textarea').first()
}
async function select(page: Page, index: number) { await page.locator('nav button').filter({ hasText: labels[index] }).first().click() }
test('N5 native input → dirty → committed saved → reload → closed tab and new tab retain exact submitted source', async ({ page, context }, info) => {
  const scope = await seed(page); const url = `./workspace/${scope.projectId}?module=worldview-natural`
  await page.goto(url); await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'unconfirmed')
  const originals: string[] = []
  for (let i = 0; i < fields.length; i++) {
    await select(page, i); const area = await enter(page)
    await area.fill(`  # ${labels[i]} 🌊\r\n\r\n| 港 | 山 |\r\n| -- | -- |\r\n\r\n\`\`\`text\r\n  |-- 河  \r\n\`\`\`\r\n  `)
    // Native textarea input normalizes CRLF to LF. Confirm exactly the actual
    // submitted value; a separate native writer test covers original CRLF.
    originals.push(await area.inputValue())
    await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'dirty')
    await flush(page)
    await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
    expect((await snapshot(page))[0][fields[i]]).toBe(originals[i])
  }
  await page.reload(); await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.screenshot({ path: info.outputPath('n5-local-saved.png'), fullPage: true })
  const reopenUrl = page.url(); await page.close(); const reopened = await context.newPage(); await reopened.goto(reopenUrl)
  for (let i = 0; i < fields.length; i++) {
    await select(reopened, i); await expect(pane(reopened).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
    expect((await snapshot(reopened))[0][fields[i]]).toBe(originals[i])
  }
})
test('native registered writer preserves first-create CRLF/edge whitespace, rolls back second-write and poststate faults, and never acknowledges empty absence', async ({ page }) => {
  const scope = await seed(page)
  const result = await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const store = useWorldviewStore; await store.getState().loadAll(scope)
    const expected = () => ({ kind: 'natural-field-local-save-v1' as const, session: 'native', generation: 1, expected: store.getState().localSaveWitnesses.worldStructure! })
    const raw = '  # CRLF🌊\r\n\r\n```text\r\n  |-- A  \r\n```\r\n  '
    const save = (value: string) => store.getState().saveWorldview({ projectId: scope.projectId, worldStructure: value }, scope, expected())
    const errors: string[] = []
    try { await save('') } catch (e) { errors.push(String(e)) }
    const countEmpty = await db.worldviews.count()
    const fault = () => { throw new DOMException('simulated quota', 'QuotaExceededError') }; db.worldviews.hook('updating', fault)
    try { await save(raw) } catch (e) { errors.push(String(e)) } finally { db.worldviews.hook('updating').unsubscribe(fault) }
    const countFault = await db.worldviews.count()
    const corrupt = () => ({ worldStructure: 'wrong poststate' }); db.worldviews.hook('updating', corrupt)
    try { await save(raw) } catch (e) { errors.push(String(e)) } finally { db.worldviews.hook('updating').unsubscribe(corrupt) }
    const countPoststate = await db.worldviews.count()
    const ack = await save(raw); db.close(); await db.open()
    return { errors, countEmpty, countFault, countPoststate, actual: (await db.worldviews.get(ack.witness.recordId!))?.worldStructure, raw, ack }
  }, scope)
  expect(result.errors.join(' ')).toContain('尚未填写'); expect(result.errors.join(' ')).toContain('simulated quota'); expect(result.errors.join(' ')).toContain('精确保存')
  expect([result.countEmpty, result.countFault, result.countPoststate]).toEqual([0, 0, 0]); expect(result.actual).toBe(result.raw); expect(result.ack.witness.value).toBe(result.raw)
  await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`)
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  await page.reload(); expect((await snapshot(page))[0].worldStructure).toBe(result.raw)
  const beforeNoInput = JSON.stringify(await snapshot(page))
  const untouchedArea = await enter(page)
  await untouchedArea.evaluate(element => (element as HTMLTextAreaElement).setSelectionRange(2, 8))
  await select(page, 1); await flush(page)
  // Merely mounting/selecting a textarea normalizes DOM.value, but never
  // authorizes writing that DOM projection back into the original CRLF field.
  expect(JSON.stringify(await snapshot(page))).toBe(beforeNoInput)
})
test('native same-field stale preserves draft, unrelated field update succeeds, and IME/resize/window-return retain source', async ({ page }) => {
  const scope = await seed(page); await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`)
  let area = await enter(page); await area.fill('first'); await flush(page)
  area = await enter(page); await area.fill('author draft')
  await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { adopt } = await load<typeof import('../../src/lib/registry/adopt')>('/storyforge/src/lib/registry/adopt.ts')
    const row = (await db.worldviews.toArray())[0]
    await adopt({ projectId: scope.projectId, scope, target: 'worldviews', recordId: row.id!, mode: 'replace', preserveAuthorText: true, data: { worldStructure: 'other tab' } })
  }, scope)
  await expect(flush(page)).rejects.toThrow('已被修改'); await expect(area).toHaveValue('author draft')
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  // A reload deliberately discards only this isolated test's failed draft.
  await page.reload(); await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  area = await enter(page); await area.fill('same field remains valid')
  await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { adopt } = await load<typeof import('../../src/lib/registry/adopt')>('/storyforge/src/lib/registry/adopt.ts')
    await adopt({ projectId: scope.projectId, scope, target: 'worldviews', recordId: (await db.worldviews.toArray())[0].id!, mode: 'replace', preserveAuthorText: true, data: { mountainsRivers: 'other field' } })
  }, scope)
  await area.dispatchEvent('compositionstart'); await area.fill('中文尾字🌊')
  await expect(flush(page)).rejects.toThrow('输入法')
  await area.dispatchEvent('compositionend'); const handle = pane(page).getByRole('button', { name: '调整输入区大小', exact: true })
  await handle.press('ArrowDown'); await expect(area).toHaveValue('中文尾字🌊')
  await page.evaluate(() => { window.dispatchEvent(new Event('blur')); window.dispatchEvent(new Event('focus')) })
  await flush(page); await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  expect((await snapshot(page))[0]).toMatchObject({ worldStructure: '中文尾字🌊', mountainsRivers: 'other field' })
})
test('native old ack cannot finish a new draft or IME tail; latest flush drains and quota failure retries without losing input', async ({ page }) => {
  const scope = await seed(page); await page.goto(`./workspace/${scope.projectId}?module=worldview-natural`)
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'unconfirmed')
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useWorldviewStore } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const original = useWorldviewStore.getState().saveWorldview
    const state = window as unknown as { release050?: () => void; attempts050: number; flush050?: string }
    state.attempts050 = 0
    // Hold only notification of the first real committed ack. Every write still
    // executes the actual registered writer exactly once.
    useWorldviewStore.setState({ saveWorldview: ((...args: Parameters<typeof original>) => {
      state.attempts050++
      const result = original(...args)
      return state.attempts050 === 1 ? result.then(ack => new Promise<typeof ack>(resolve => { state.release050 = () => resolve(ack) })) : result
    }) as typeof original })
  })
  const area = await enter(page); await area.fill('first committed')
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { flushPendingEditsV1 } = await load<typeof import('../../src/lib/authoring/pending-edit-coordinator')>('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')
    const state = window as unknown as { flush050?: string }; state.flush050 = 'pending'
    void flushPendingEditsV1().then(() => { state.flush050 = 'resolved' }, error => { state.flush050 = String(error) })
  })
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saving')
  await expect.poll(() => page.evaluate(() => typeof (window as unknown as { release050?: () => void }).release050)).toBe('function')
  await area.dispatchEvent('compositionstart'); await area.fill('new 中文尾🌊')
  await page.evaluate(() => (window as unknown as { release050: () => void }).release050())
  await expect.poll(() => page.evaluate(() => (window as unknown as { flush050: string }).flush050)).toContain('输入法')
  await expect(area).toHaveValue('new 中文尾🌊'); expect((await snapshot(page))[0].worldStructure).toBe('first committed')
  await area.dispatchEvent('compositionend'); await flush(page)
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  expect((await snapshot(page))[0].worldStructure).toBe('new 中文尾🌊')
  expect(await page.evaluate(() => (window as unknown as { attempts050: number }).attempts050)).toBe(2)
  await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const fault = () => { throw new DOMException('simulated browser quota', 'QuotaExceededError') }; db.worldviews.hook('updating', fault)
    ;(window as unknown as { cleanup050: () => void }).cleanup050 = () => db.worldviews.hook('updating').unsubscribe(fault)
  })
  const retryArea = await enter(page); await retryArea.fill('quota retry 原稿🌊')
  await expect(flush(page)).rejects.toThrow('simulated browser quota')
  await expect(retryArea).toHaveValue('quota retry 原稿🌊'); await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'failed')
  await page.evaluate(() => (window as unknown as { cleanup050: () => void }).cleanup050())
  await pane(page).getByRole('button', { name: '重试', exact: true }).click()
  await expect(pane(page).locator('[data-local-save-status]')).toHaveAttribute('data-local-save-status', 'saved')
  expect((await snapshot(page))[0].worldStructure).toBe('quota retry 原稿🌊')
})
test('native fact invalidation rolls back with a failed field write; committed Canon cache and exact original read reflect the final source', async ({ page }) => {
  const scope = await seed(page)
  const result = await page.evaluate(async scope => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const { useWorldviewStore: store } = await load<typeof import('../../src/stores/worldview')>('/storyforge/src/stores/worldview.ts')
    const { fingerprintSettingSource } = await load<typeof import('../../src/lib/fact-ledger/setting-assertions')>('/storyforge/src/lib/fact-ledger/setting-assertions.ts')
    const { CANON_RESOURCE_PROVIDER_V1: canon } = await load<typeof import('../../src/lib/context-gateway/canon-provider')>('/storyforge/src/lib/context-gateway/canon-provider.ts')
    await store.getState().saveWorldview({ projectId: scope.projectId, worldStructure: 'old native source' }, scope)
    await store.getState().loadAll(scope); const old = (await db.worldviews.toArray())[0]
    const factId = await db.temporalFacts.add({ projectId: scope.projectId, workId: scope.workId, subjectName: '港', predicate: 'technologyLevel', factKind: 'state', value: 'old native source', sourceType: 'setting', sourceRecordTable: 'worldviews', sourceWorldviewId: old.id!, sourceField: 'worldStructure', sourceFingerprint: fingerprintSettingSource('old native source'), status: 'confirmed', locked: false, createdAt: 1, updatedAt: 1 })
    const frozen = { ...scope, worldGroupId: null }
    const before = await canon.listMetadata({ scope: frozen, kinds: ['worldview-field'], limit: 100 })
    const oldDescriptor = before.items.find(item => item.resourceKey.endsWith(':field:worldStructure'))!
    const raw = '  # native final 🌊\r\n  |-- A  \r\n  '
    const save = () => store.getState().saveWorldview({ projectId: scope.projectId, worldStructure: raw }, scope, { kind: 'natural-field-local-save-v1', expected: store.getState().localSaveWitnesses.worldStructure!, session: 'native-facts', generation: 1 })
    const fault = () => { throw new Error('native fact fault') }; db.temporalFacts.hook('updating', fault)
    let rejected = ''; try { await save() } catch (error) { rejected = String(error) } finally { db.temporalFacts.hook('updating').unsubscribe(fault) }
    const rollback = { field: (await db.worldviews.get(old.id!))?.worldStructure, fact: (await db.temporalFacts.get(factId))?.status }
    const ack = await save()
    const after = await canon.listMetadata({ scope: frozen, kinds: ['worldview-field'], limit: 100 })
    const descriptor = after.items.find(item => item.resourceKey === oldDescriptor.resourceKey)!
    const original = await canon.readOriginal({ scope: frozen, resourceKey: descriptor.resourceKey, sourceRef: descriptor.sourceRefs[0], maxTokens: 1000 })
    return { rejected, rollback, fact: (await db.temporalFacts.get(factId))?.status, uidStable: (await db.worldviews.get(old.id!))?.ragDocumentId === old.ragDocumentId, changedHash: descriptor.contentHash !== oldDescriptor.contentHash, raw, actual: original.content, ack: ack.witness.value }
  }, scope)
  expect(result.rejected).toContain('native fact fault'); expect(result.rollback).toEqual({ field: 'old native source', fact: 'confirmed' })
  expect(result.fact).toBe('stale'); expect(result.uidStable).toBe(true); expect(result.changedHash).toBe(true); expect(result.actual).toBe(result.raw); expect(result.ack).toBe(result.raw)
})
