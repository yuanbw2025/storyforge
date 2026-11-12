import { expect, test } from '@playwright/test'

interface SvgObservation {
  created: string[]
  revoked: string[]
  expectedSvg: string
  outsideBefore: string
  controlEscaped: boolean
  rootsBefore: string
  projectId: number
  decodeFailureInjected: boolean
  decodeFailureEnabled: boolean
  decodeFailureUrl: string | null
}
declare global {
  interface Window { __sfqa131?: SvgObservation; __sfqa131ScriptRuns?: number }
}

test.use({ storageState: { cookies: [], origins: [] } })

// A real workspace/Geography route recovers a controlled memory-draft response
// through its existing session store. No real provider or author data is used.
test('Geography SVG image preserves local drawing while host CSS, owners and URL lifetime stay isolated', async ({ page, baseURL }, testInfo) => {
  const origin = new URL(baseURL!).origin
  let modelRequests = 0
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (/\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)|:(?:streamGenerateContent|generateContent)/.test(url.pathname)) {
      modelRequests += 1
      return route.abort()
    }
    return url.origin === origin ? route.continue() : route.abort()
  })
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'sfqa131-isolated')
    localStorage.setItem('storyforge:experimental-products', 'enabled')
  })
  await page.goto('./')
  await page.getByRole('navigation', { name: '产品导航', exact: true }).waitFor({ state: 'visible' })
  const projectId = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const [fixtures, schema, scopes] = await Promise.all([
      load('/storyforge/tests/helpers/current-workspace.ts'),
      load('/storyforge/src/lib/db/schema.ts'),
      load('/storyforge/src/lib/workspace/scope.ts'),
    ]) as [typeof import('../helpers/current-workspace'), typeof import('../../src/lib/db/schema'), typeof import('../../src/lib/workspace/scope')]
    const made = await fixtures.seedCurrentWorkspace('131 native private map')
    await schema.db.geographies.add(scopes.stampNewRecord(made.scope, 'geographies', {
      projectId: made.scope.projectId, worldGroupId: null, overview: '131原始地理记录',
      locations: JSON.stringify([{ id: 'harbor', name: '港口', type: 'city', description: '', significance: '', parentId: null, order: 0 }]),
      createdAt: 1, updatedAt: 1,
    }, { owner: 'world' }))
    return made.scope.projectId
  })
  await page.goto(new URL(`workspace/${projectId}?module=geography`, baseURL!).href)
  const panel = page.getByRole('group', { name: '地理读取保护', exact: true })
  await expect(panel).toBeEnabled()
  await expect(panel.getByPlaceholder('描述这个世界的整体地理面貌、大陆分布、气候特征等...')).toHaveValue('131原始地理记录')
  await page.evaluate(async id => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const [schema, sanitizer, sessions, author] = await Promise.all([
      load('/storyforge/src/lib/db/schema.ts'),
      load('/storyforge/src/lib/utils/sanitize-svg.ts'),
      load('/storyforge/src/stores/ai-generation-session.ts'),
      load('/storyforge/src/components/world-group/ScopedWorldAuthoringBoundary.tsx'),
    ]) as [typeof import('../../src/lib/db/schema'), typeof import('../../src/lib/utils/sanitize-svg'),
      typeof import('../../src/stores/ai-generation-session'), typeof import('../../src/components/world-group/ScopedWorldAuthoringBoundary')]
    const { db } = schema
    const project = await db.projects.get(id)
    if (!project?.activeWorldId || !project.activeWorkId) throw new Error('131 fixture lacks current owner roots')
    const raw = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" id="sfqa131-native-map" width="100" height="100" viewBox="0 0 100 100"><defs><linearGradient id="shade"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#123456"/></linearGradient></defs><style>#sfqa131-native-outside { color: rgb(255, 0, 0) !important; } .map-region { fill: url(#shade); }</style><rect class="map-region" width="100" height="100"/><text x="2" y="95">港口</text><script>window.__sfqa131ScriptRuns=99</script><a xlink:href="javascript:alert(1)"><text x="2" y="90">链接</text></a><path onload="window.__sfqa131ScriptRuns=99" d="M0 0L10 10"/></svg>'
    const safe = sanitizer.sanitizeSvg(raw)
    if (!safe.includes('.map-region') || !safe.includes('linearGradient')) throw new Error('131 fixture lost valid SVG geometry/style')
    window.__sfqa131ScriptRuns = 0
    const outside = document.createElement('div')
    outside.id = 'sfqa131-native-outside'; outside.textContent = '131 outside style control'; outside.style.color = 'rgb(1, 2, 3)'
    document.body.append(outside)
    const outsideBefore = getComputedStyle(outside).color
    // A positive attack control proves this valid sanitized stylesheet affects
    // the host if inserted inline. The real panel is tested separately below.
    const control = document.createElement('div'); control.innerHTML = safe; document.body.append(control)
    const controlEscaped = getComputedStyle(outside).color === 'rgb(255, 0, 0)'
    control.remove()
    if (getComputedStyle(outside).color !== outsideBefore) throw new Error('131 attack control did not clean up')
    const rootsBefore = JSON.stringify({ project, world: await db.worlds.get(project.activeWorldId),
      work: await db.works.get(project.activeWorkId), geography: await db.geographies.where('projectId').equals(id).toArray() })
    const observation: SvgObservation = { created: [], revoked: [], expectedSvg: safe, outsideBefore, controlEscaped, rootsBefore, projectId: id, decodeFailureInjected: false, decodeFailureEnabled: true, decodeFailureUrl: null }
    window.__sfqa131 = observation
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = blob => {
      // Keep the real decode failure armed across StrictMode effect setup.
      // Only the explicit UI retry below receives the original SVG Blob.
      const inject = blob instanceof Blob && blob.type === 'image/svg+xml' && observation.decodeFailureEnabled
      if (inject) observation.decodeFailureInjected = true
      const url = create(inject ? new Blob(['not an SVG document'], { type: 'image/svg+xml' }) : blob)
      if (inject) observation.decodeFailureUrl = url
      observation.created.push(url); return url
    }
    URL.revokeObjectURL = url => { observation.revoked.push(url); revoke(url) }
    const key = sessions.createAISessionKey(id, 'geography.concept-map', author.worldAuthorViewKey({ project, activeGroupId: null }))
    sessions.useAIGenerationSessionStore.getState().patchSession(key, { output: raw, isStreaming: false, error: null, tokenUsage: null })
  }, projectId)
  const image = panel.getByAltText('地理概念地图')
  await expect(panel.getByRole('alert').filter({ hasText: '地图预览暂不可用' })).toBeVisible()
  await expect(image).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const state = window.__sfqa131
    return !!state?.decodeFailureUrl && state.revoked.includes(state.decodeFailureUrl)
  })).toBe(true)
  expect(modelRequests).toBe(0)
  await page.evaluate(() => {
    const state = window.__sfqa131
    if (!state) throw new Error('131 observation unavailable before explicit retry')
    state.decodeFailureEnabled = false
  })
  await panel.getByRole('button', { name: '重试预览', exact: true }).click()
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate(node => node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0)).toBe(true)
  const proof = await image.evaluate(async node => {
    if (!(node instanceof HTMLImageElement) || !window.__sfqa131) throw new Error('131 actual image/observation unavailable')
    const state = window.__sfqa131
    const text = await fetch(node.src).then(response => response.text())
    const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 100
    const context = canvas.getContext('2d'); if (!context) throw new Error('131 canvas unavailable')
    context.drawImage(node, 0, 0, 100, 100)
    return { url: node.src, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight,
      localGradientPixel: [...context.getImageData(20, 20, 1, 1).data],
      sourceBytesPreserved: text === state.expectedSvg, localStylePreserved: text.includes('.map-region') && text.includes('linearGradient'),
      executableContentRemoved: !/<script|onload=|javascript:/i.test(text), hostPayloadAbsent: !document.getElementById('sfqa131-native-map'),
      hostColor: getComputedStyle(document.getElementById('sfqa131-native-outside')!).color,
      outsideBefore: state.outsideBefore, controlEscaped: state.controlEscaped,
      scriptRuns: window.__sfqa131ScriptRuns ?? 0, trackedRealUrl: state.created.includes(node.src) }
  })
  expect(proof.controlEscaped).toBe(true)
  expect(proof.hostColor).toBe(proof.outsideBefore)
  expect(proof.hostPayloadAbsent).toBe(true)
  expect(proof.sourceBytesPreserved).toBe(true)
  expect(proof.localStylePreserved).toBe(true)
  expect(proof.localGradientPixel).toEqual([18, 52, 86, 255])
  expect(proof.executableContentRemoved).toBe(true)
  expect(proof.scriptRuns).toBe(0)
  expect(proof.trackedRealUrl).toBe(true)
  await image.screenshot({ path: testInfo.outputPath('geography-local-style.png') })
  await panel.getByRole('button', { name: '列表', exact: true }).click()
  await expect(image).toHaveCount(0)
  await expect.poll(() => page.evaluate(url => window.__sfqa131?.revoked.includes(url) ?? false, proof.url)).toBe(true)
  await panel.getByRole('button', { name: 'AI地图', exact: true }).click()
  await expect(image).toBeVisible()
  const restored = await image.getAttribute('src')
  expect(restored).not.toBe(proof.url)
  await page.getByRole('navigation', { name: '产品导航', exact: true }).getByText('首页', { exact: true }).click()
  await expect.poll(() => page.evaluate(url => url != null && (window.__sfqa131?.revoked.includes(url) ?? false), restored)).toBe(true)
  const final = await page.evaluate(async () => {
    const state = window.__sfqa131; if (!state) throw new Error('131 observation unavailable after navigation')
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await load('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const project = await db.projects.get(state.projectId)
    if (!project?.activeWorldId || !project.activeWorkId) throw new Error('131 owner roots changed')
    return { ownersAndGeographyUnchanged: state.rootsBefore === JSON.stringify({ project,
      world: await db.worlds.get(project.activeWorldId), work: await db.works.get(project.activeWorkId),
      geography: await db.geographies.where('projectId').equals(state.projectId).toArray() }),
      hostColor: getComputedStyle(document.getElementById('sfqa131-native-outside')!).color,
      created: state.created, revoked: state.revoked, scriptRuns: window.__sfqa131ScriptRuns ?? 0,
      decodeFailureInjected: state.decodeFailureInjected, decodeFailureUrl: state.decodeFailureUrl }
  })
  expect(final.ownersAndGeographyUnchanged).toBe(true)
  expect(final.decodeFailureInjected).toBe(true)
  expect(final.revoked.filter(url => url === final.decodeFailureUrl)).toHaveLength(1)
  expect(final.hostColor).toBe(proof.outsideBefore)
  expect(final.scriptRuns).toBe(0)
  expect(modelRequests).toBe(0)
  await testInfo.attach('sfqa131-svg-isolation-proof', { body: Buffer.from(JSON.stringify({ proof, final, modelRequests }, null, 2)), contentType: 'application/json' })
})
