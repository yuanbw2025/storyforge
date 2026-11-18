import { canonicalStringify } from '../agent/run/hash'
import type { AIConfig } from '../types'

const LOCAL_KEY = 'sf-credential-fingerprint-key-v1'

/** A local HMAC binds frozen dispatches without recording the API key or an
 * unsalted key digest in drafts, Runs, exports or diagnostics. Losing this
 * local authority fails closed; it never restores a prior request permission. */
export async function aiCredentialFingerprintV1(config: Pick<AIConfig, 'provider' | 'baseUrl' | 'apiKey'>): Promise<string> {
  if (!config.apiKey.trim()) throw new Error('图片连接缺少凭据，请在设置中重新填写。')
  let encoded = localStorage.getItem(LOCAL_KEY)
  if (encoded === null) {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    encoded = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    localStorage.setItem(LOCAL_KEY, encoded)
    encoded = localStorage.getItem(LOCAL_KEY)
  }
  if (!encoded || !/^[a-f0-9]{64}$/.test(encoded)) throw new Error('本机连接身份不可用，请重新配置后发起新的生成。')
  const bytes = Uint8Array.from(encoded.match(/../g)!, value => parseInt(value, 16))
  const key = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const payload = new TextEncoder().encode(canonicalStringify({ provider: config.provider, baseUrl: config.baseUrl, credential: config.apiKey }))
  const signature = await crypto.subtle.sign('HMAC', key, payload)
  return `credential:hmac-sha256-v1:${Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('')}`
}
