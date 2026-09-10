import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearLogs,
  createLog,
  formatLog,
  getLogs,
  sanitizeAILogUrl,
  updateLog,
} from '../../src/lib/ai/logger'

const apiKey = 'caller-provided-value-7f9d'
const baseUrl = 'https://api-user:api-password@example.test:9443/private/v1?apiKey=url-secret#private-fragment'

describe('AI connection log redaction boundary', () => {
  beforeEach(() => clearLogs())

  it('keeps external-store snapshots referentially stable until the log version changes', () => {
    const emptySnapshot = getLogs()
    expect(getLogs()).toBe(emptySnapshot)

    const created = createLog({
      type: 'test',
      provider: 'custom',
      model: 'snapshot-model',
      url: 'https://example.test/v1',
      status: 'pending',
    })
    const createdSnapshot = getLogs()
    expect(createdSnapshot).not.toBe(emptySnapshot)
    expect(getLogs()).toBe(createdSnapshot)

    updateLog(created.id, { status: 'success' })
    const updatedSnapshot = getLogs()
    expect(updatedSnapshot).not.toBe(createdSnapshot)
    expect(getLogs()).toBe(updatedSnapshot)
    expect(createdSnapshot[0].status).toBe('pending')

    clearLogs()
    expect(getLogs()).not.toBe(updatedSnapshot)
    expect(getLogs()).toBe(getLogs())
  })

  it('keeps only a safe endpoint origin and never stores caller-provided secrets', () => {
    const created = createLog({
      type: 'chat',
      provider: `custom ${apiKey}`,
      model: `model ${apiKey}`,
      url: `${baseUrl}/chat/completions?token=request-secret#response-fragment`,
      status: 'pending',
      errorMessage: `request ${baseUrl} Authorization: Bearer ${apiKey}`,
    }, {
      sensitiveValues: [apiKey],
      baseUrl,
    })

    expect(created.url).toBe('https://example.test:9443')
    expect(getLogs()[0].url).toBe('https://example.test:9443')
    const serialized = JSON.stringify({ created, stored: getLogs() })
    expect(serialized).not.toMatch(/caller-provided-value|api-user|api-password|url-secret|private-fragment|private\/v1/)
    expect(serialized).toContain('[REDACTED]')
  })

  it('sanitizes updates and formatted diagnostics without erasing useful status evidence', () => {
    const created = createLog({
      type: 'test',
      provider: 'openai-compatible',
      model: 'diagnostic-model',
      url: `${baseUrl}/chat/completions`,
      status: 'pending',
    }, {
      sensitiveValues: [apiKey, 'arbitrary-vault-value'],
      baseUrl,
    })

    updateLog(created.id, {
      status: 'error',
      statusCode: 401,
      duration: 27,
      errorMessage: `Bearer ${apiKey}; arbitrary-vault-value; apiKey=generic-secret`,
      responseBody: JSON.stringify({ api_key: 'body-secret', authorization: 'Basic body-auth' }),
      responseSummary: 'access_token: summary-secret at https://person:password@example.test/a?token=query-secret#fragment',
      url: 'https://second-user:second-password@api.example.test/v1?key=second-query#second-fragment',
    })

    const stored = getLogs()[0]
    expect(stored).toMatchObject({
      id: created.id,
      timestamp: created.timestamp,
      status: 'error',
      statusCode: 401,
      duration: 27,
      url: 'https://api.example.test',
    })
    const formatted = formatLog(stored)
    expect(formatted).toContain('HTTP 401')
    expect(formatted).toContain('(27ms)')
    expect(formatted).toContain('openai-compatible')
    expect(`${JSON.stringify(stored)}\n${formatted}`).not.toMatch(
      /caller-provided-value|arbitrary-vault-value|generic-secret|body-secret|body-auth|summary-secret|person|password|query-secret|fragment|second-user|second-password|second-query/,
    )
  })

  it('redacts common credential shapes even without caller context and clears retained logs', () => {
    const created = createLog({
      type: 'stream',
      provider: 'custom',
      model: 'model',
      url: 'not a valid endpoint?apiKey=raw-secret',
      status: 'error',
      errorMessage: 'Authorization=Bearer raw-bearer and x-api-key: raw-header',
      responseBody: '{"secretKey":"raw-json","password":"raw-password"}',
      responseSummary: 'token=raw-token sk-1234567890abcdef AIza1234567890abcdefghijklmnop',
    })

    expect(created.url).toBe('[endpoint unavailable]')
    created.errorMessage = 'late diagnostic contains Bearer late-format-secret'
    const formatted = formatLog(created)
    expect(formatted).not.toMatch(/raw-secret|raw-bearer|raw-header|raw-json|raw-password|raw-token|late-format-secret|1234567890abcdef/)
    expect(formatted).toContain('[REDACTED]')

    clearLogs()
    expect(getLogs()).toEqual([])
  })

  it('normalizes valid HTTP endpoints and rejects unsafe or malformed URL schemes', () => {
    expect(sanitizeAILogUrl('http://localhost:11434/v1/chat?key=secret#fragment')).toBe('http://localhost:11434')
    expect(sanitizeAILogUrl('file:///tmp/private')).toBe('[endpoint unavailable]')
    expect(sanitizeAILogUrl('not a url')).toBe('[endpoint unavailable]')
  })

  it('does not retain an endpoint origin when its hostname itself contains a Key', () => {
    const contextual = createLog({
      type: 'chat',
      provider: 'custom',
      model: 'model',
      url: `https://${apiKey}.relay.example/v1/chat/completions`,
      status: 'pending',
    }, { sensitiveValues: [apiKey], baseUrl: `https://${apiKey}.relay.example/v1` })
    const shaped = createLog({
      type: 'test',
      provider: 'custom',
      model: 'model',
      url: 'https://sk-1234567890abcdef.relay.example/v1',
      status: 'pending',
    })

    expect(contextual.url).toBe('[endpoint unavailable]')
    expect(shaped.url).toBe('[endpoint unavailable]')
    expect(JSON.stringify(getLogs())).not.toMatch(/caller-provided-value|sk-1234567890abcdef/)
  })
})
