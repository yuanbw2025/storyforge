const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const WORKSPACE_UID_RE = /^WS-([0-9a-f-]{36})$/i
const DOCUMENT_ID_RE = /^DOC-([0-9a-f-]{36})$/i
const WORK_CODE_RE = /^WORK-([0-9a-f-]{36})$/i

function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function validPrefixedUuid(value: unknown, prefix: RegExp): value is string {
  if (typeof value !== 'string') return false
  const match = prefix.exec(value)
  return Boolean(match?.[1] && UUID_RE.test(match[1]))
}

export function generateWorkspaceUid(): string {
  return `WS-${randomUuid()}`
}

export function generateDocumentId(): string {
  return `DOC-${randomUuid()}`
}

export function generateWorkCode(): string {
  return `WORK-${randomUuid()}`
}

export function isWorkspaceUid(value: unknown): value is string {
  return validPrefixedUuid(value, WORKSPACE_UID_RE)
}

export function isWorkspaceDocumentId(value: unknown): value is string {
  return validPrefixedUuid(value, DOCUMENT_ID_RE)
}

export function isWorkCode(value: unknown): value is string {
  return validPrefixedUuid(value, WORK_CODE_RE)
}
