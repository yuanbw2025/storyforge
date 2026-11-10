import { createNativeFetch, type NativeHttp } from './android-fetch'

/** Only existing model endpoints use native HTTP. Assets, fixed local proxies,
 * telemetry, downloads and all ordinary browser builds retain their transport. */
export function createDesktopFetch(native: NativeHttp, browserFetch: typeof fetch, origin: string): typeof fetch {
  const nativeFetch = createNativeFetch(native, browserFetch, origin, { label: '桌面端', allowHttp: true })
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (url.origin !== origin && ['https:', 'http:'].includes(url.protocol) && ['GET', 'POST'].includes(method)
        && /\/(?:models|embeddings|chat\/completions|messages|responses)\/?$/.test(url.pathname)) return nativeFetch(input, init)
    return browserFetch(input, init)
  }
}

export function installDesktopFetch(): void {
  if (window.storyforgeClient?.http) {
    window.fetch = createDesktopFetch(window.storyforgeClient.http, window.fetch.bind(window), location.origin)
  }
}
