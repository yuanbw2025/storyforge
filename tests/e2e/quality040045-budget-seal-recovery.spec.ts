import { expect, test, type Page } from '@playwright/test'
import type * as Fixture from '../helpers/sfqa040045-native-budget'

const helper = '/storyforge/tests/helpers/sfqa040045-native-budget.ts'
async function isolated(page: Page, baseURL: string | undefined) {
  if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('Use isolated loopback storage')
  const origin = new URL(baseURL).origin
  let modelRequests = 0
  await page.route('**/*', route => {
    const request = route.request(), url = new URL(request.url())
    if (/\/chat\/completions|\/(?:responses|requests|messages)(?:\/|$)/.test(url.pathname)) {
      modelRequests++; return route.abort()
    }
    return url.origin === origin && ['GET', 'HEAD'].includes(request.method()) ? route.continue() : route.abort()
  })
  await page.addInitScript(() => localStorage.setItem('storyforge_guide_completed', 'sfqa040045-native'))
  await page.goto('./')
  return () => modelRequests
}

test('040 native stopped original response is charged once and cannot regain adoption on reload', async ({ page, baseURL }, info) => {
  const models = await isolated(page, baseURL)
  const before = await page.evaluate(async path => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<typeof Fixture>
    return (await load(path)).stoppedLateUsage()
  }, helper)
  expect(before.attempts).toEqual([{ ...before.attempts[0], ...before.expectedAttempt, usageKnown: true, usage: before.expectedUsage }])
  expect(before.artifactCount).toBe(0)
  expect(before.lateCalls).toBe(1)
  expect(before.runState).toBe('cancelled')
  await page.reload()
  const after = await page.evaluate(async input => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<typeof Fixture>
    return (await load(input.helper)).recoverStopped(input.before)
  }, { helper, before })
  expect(after).toMatchObject({ calls: 0, status: 'recovery-required', ledger: before.ledger, worlds: before.worlds })
  expect(models()).toBe(0)
  await info.attach('native-late-accounting', { body: JSON.stringify({ before, after, modelRequests: models() }), contentType: 'application/json' })
})

test('040045 native root events and Build seal roll back together and resume with no task dispatch', async ({ page, baseURL }, info) => {
  const models = await isolated(page, baseURL)
  const before = await page.evaluate(async path => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<typeof Fixture>
    return (await load(path)).rollbackRootSeal()
  }, helper)
  expect(before).toMatchObject({ failure: 'native isolated terminal Build write failure', sawUncommittedRoot: true,
    rootState: 'running', rootEventsExact: true, rootRowExact: true, rootReceipt: null })
  await page.reload()
  const recover = () => page.evaluate(async input => {
    const load = new Function('path', 'return import(path)') as (path: string) => Promise<typeof Fixture>
    return (await load(input.helper)).recoverRootSeal(input.before)
  }, { helper, before })
  const sealed = await recover()
  expect(sealed).toMatchObject({ calls: 0, status: 'release-ready', terminal: true, rootState: 'completed',
    ledger: before.ledger, acceptedEvents: 1, worlds: before.worlds })
  expect(sealed.rootReceipt).toMatch(/^[a-f0-9]{64}$/)
  expect(sealed.rootReceipt).toBe(sealed.buildReceipt)
  await page.reload()
  expect(await recover()).toEqual(sealed)
  expect(models()).toBe(0)
  await info.attach('native-root-seal-rollback', { body: JSON.stringify({ before, sealed, modelRequests: models() }), contentType: 'application/json' })
})
