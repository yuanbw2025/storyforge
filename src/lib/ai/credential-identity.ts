import type { AIConfig } from '../types'
import { AI_PROXY_ENDPOINTS, EMBEDDING_PROXY_ENDPOINTS } from './proxy-endpoints'

type CredentialAuthority = Pick<AIConfig, 'provider' | 'baseUrl'>

function endpointIdentity(baseUrl: string): string | null {
  const raw = baseUrl
  // URL parsing removes tabs/newlines and treats backslashes as slashes;
  // these spellings must not turn a relative path into a different host.
  if (!raw || raw.startsWith('//') || /[\\\u0000-\u0020\u007f#]/.test(raw)) return null
  try {
    let url: URL
    if (raw.startsWith('/')) {
      const relative = new URL(raw, 'https://storyforge-credential.invalid')
      if (relative.origin !== 'https://storyforge-credential.invalid') return null
      const path = relative.pathname.replace(/\/+$/, '')
      const aliases = [...Object.values(AI_PROXY_ENDPOINTS), ...EMBEDDING_PROXY_ENDPOINTS]
      const alias = aliases.find(pair => pair?.proxy === path)
      if (!alias) return `relative:${path}${relative.search}`
      url = new URL(alias.direct)
      url.search = relative.search
    } else {
      if (!/^https?:\/\/[^/]/i.test(raw)) return null
      url = new URL(raw)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    url.hash = '' // Fragments are never transmitted by fetch.
    return url.href
  } catch { return null }
}

/** A provider name alone cannot authorize forwarding a key to another URL. */
export function sameAICredentialAuthorityV1(left: CredentialAuthority, right: CredentialAuthority): boolean {
  if (left.provider !== right.provider) return false
  // The request builders append their endpoint to the entire base string.
  // With a query (even an empty one), only the exact spelling is reusable.
  if ((left.baseUrl.includes('?') || right.baseUrl.includes('?')) && left.baseUrl !== right.baseUrl) return false
  const endpoint = endpointIdentity(left.baseUrl)
  return endpoint !== null && endpoint === endpointIdentity(right.baseUrl)
}
