import { test, type BrowserContext, type Page } from '@playwright/test'
import type { AIConfig } from '../../../src/lib/types'

type FixtureConfig = Partial<AIConfig>
type ConfigSource = FixtureConfig | ((destination: URL) => FixtureConfig)
interface Registration { source: ConfigSource; once: boolean; ifAbsent: boolean; applied: WeakSet<Page> }
const configurations = new WeakMap<Page | BrowserContext, Registration>()

/** Explicit synthetic fixture input, never a production credential migration. */
export function registerBrowserFixtureAIConfigV1(
  target: Page | BrowserContext, source: ConfigSource, options: { once?: boolean; ifAbsent?: boolean } = {},
): void {
  configurations.set(target, {
    source: typeof source === 'function' ? source : structuredClone(source),
    once: options.once === true, ifAbsent: options.ifAbsent === true, applied: new WeakSet(),
  })
}

/** A test that explicitly replaces its fixture through the public store owns it afterward. */
export function unregisterBrowserFixtureAIConfigV1(target: Page | BrowserContext): void {
  configurations.delete(target)
}

export async function prepareBrowserFixtureAIConfigV1(page: Page, destination?: string): Promise<void> {
  const registration = configurations.get(page) ?? configurations.get(page.context())
  if (!registration || (registration.once && registration.applied.has(page))) return
  const configured = test.info().project.use.baseURL
  if (!configured) throw new Error('Synthetic AI fixture requires the configured loopback server')
  const base = new URL(configured)
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(base.hostname)) {
    throw new Error('Synthetic AI fixture refuses an external or author browser origin')
  }
  const next = new URL(destination ?? page.url(), base)
  if (next.origin !== base.origin || !next.pathname.startsWith(base.pathname)) return
  const current = new URL(page.url())
  // An empty new tab needs the app origin before the real store can use storage.
  // The native target navigation below is still executed with its original args.
  if (current.origin !== base.origin || !current.pathname.startsWith(base.pathname)) {
    await page.goto(base.href, { waitUntil: 'domcontentloaded' })
  }
  const source = registration.source
  const config = structuredClone(typeof source === 'function' ? source(next) : source)
  await page.evaluate(async ({ input, ifAbsent }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { useAIConfigStore } = await load<typeof import('../../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts')
    const alreadySaved = localStorage.getItem('storyforge-ai-config') != null
    // The old conditional fixture retained author-edited metadata but supplied
    // its explicit synthetic key on each document. Do that through the store.
    useAIConfigStore.getState().setConfig(ifAbsent && alreadySaved ? { apiKey: input.apiKey } : input)
  }, { input: config, ifAbsent: registration.ifAbsent })
  registration.applied.add(page)
}

/** Preserve the real navigation/response; configure through the public store. */
export async function gotoWithBrowserFixtureAIConfigV1(page: Page, ...args: Parameters<Page['goto']>) {
  await prepareBrowserFixtureAIConfigV1(page, args[0])
  return page.goto(...args)
}

export async function reloadWithBrowserFixtureAIConfigV1(page: Page, ...args: Parameters<Page['reload']>) {
  await prepareBrowserFixtureAIConfigV1(page)
  return page.reload(...args)
}
