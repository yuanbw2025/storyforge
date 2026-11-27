import { createNativeFetch, type NativeHttp } from './android-fetch'

/** Only existing model endpoints use native HTTP. Assets, fixed local proxies,
 * telemetry, downloads and all ordinary browser builds retain their transport. */
export function createDesktopFetch(native: NativeHttp, browserFetch: typeof fetch, origin: string): typeof fetch {
  const nativeFetch = createNativeFetch(native, browserFetch, origin, { label: '桌面端', allowHttp: true })
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (headers.has('x-storyforge-image-adapter')) {
      if (headers.get('x-storyforge-image-adapter') !== 'work-cover-b64-sync-v1' || method !== 'POST'
        || url.protocol !== 'https:' || url.hostname !== 'apihub.agnes-ai.com' || url.port
        || url.pathname !== '/v1/images/generations' || /[?#]/.test(url.href) || url.username || url.password)
        throw new TypeError('桌面封面图片请求不符合已登记的同步协议。')
      return nativeFetch(input, init)
    }
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
