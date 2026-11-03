import type { AIConfig } from '../types'

type CredentialOwner = Pick<AIConfig, 'provider' | 'baseUrl'>

/** The reference pairs two independent storage writes; it grants no authority. */
export interface SessionCredentialV1 extends CredentialOwner {
  version: 1
  referenceId: string
  apiKey: string
}

export function createSessionCredentialV1(owner: CredentialOwner, referenceId: string, apiKey: string): SessionCredentialV1 {
  return { version: 1, referenceId, provider: owner.provider, baseUrl: owner.baseUrl, apiKey }
}

/** Legacy strings have no owner evidence and are never silently rebound.
 * Compare the saved raw owner, not another endpoint's normalized alias. */
export function readSessionCredentialV1(input: unknown, owner: CredentialOwner, referenceId: unknown): string {
  if (typeof referenceId !== 'string' || !referenceId) return ''
  let value = input
  if (typeof value === 'string') {
    try { value = JSON.parse(value) as unknown } catch { return '' }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const entry = value as Record<string, unknown>
  const keys = ['version', 'referenceId', 'provider', 'baseUrl', 'apiKey']
  if (Object.keys(entry).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(entry, key))) return ''
  return entry.version === 1 && entry.referenceId === referenceId
    && entry.provider === owner.provider && entry.baseUrl === owner.baseUrl
    && typeof entry.apiKey === 'string' ? entry.apiKey : ''
}
