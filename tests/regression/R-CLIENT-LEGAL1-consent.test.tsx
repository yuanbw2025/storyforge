import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ClientLegalDocuments } from '../../src/components/settings/ClientAgreement'
import { CLIENT_AGREEMENT_KEY, CLIENT_LEGAL_VERSION, acceptClientAgreement, clientAgreementAccepted } from '../../src/lib/feedback/client-legal'
import { TELEMETRY_KEY, flushClientTelemetry, recordClientActivity, setTelemetryPreferences, telemetryPreferences } from '../../src/lib/feedback/client-telemetry'
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement
beforeEach(() => {
  localStorage.clear(); vi.stubEnv('MODE', 'portable'); vi.stubEnv('DEV', false)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })
const render = () => act(async () => root.render(createElement(ClientLegalDocuments)))
it('offers a collapsed offline agreement with no checkbox or acceptance side effects', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
  await render()
  const details = container.querySelector('details')!
  expect(details.open).toBe(false)
  expect(details.querySelector('summary')?.textContent).toBe('用户协议')
  expect(container.querySelectorAll('input,button')).toHaveLength(0)
  await act(async () => details.querySelector('summary')!.click())
  expect(details.open).toBe(true)
  expect(container.textContent).toContain('API 密钥')
  expect(container.textContent).toContain(CLIENT_LEGAL_VERSION)
  expect(localStorage.getItem(CLIENT_AGREEMENT_KEY)).toBeNull()
  expect(telemetryPreferences()).toMatchObject({ analytics: false, errors: false })
  expect(fetcher).not.toHaveBeenCalled()
})
it('keeps existing support-processing consent boundaries independent of viewing the document', async () => {
  setTelemetryPreferences(true, true)
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => new Response(JSON.stringify({ accepted: JSON.parse(String(init?.body)).events.map((e: {id: string}) => e.id), discarded: [] })))
  await render(); recordClientActivity(); await flushClientTelemetry(); expect(fetcher).not.toHaveBeenCalled()
  expect(acceptClientAgreement()).toBe(true)
  recordClientActivity(); await flushClientTelemetry(); expect(fetcher).toHaveBeenCalledTimes(1)
  localStorage.setItem(CLIENT_AGREEMENT_KEY, JSON.stringify({ terms: 'old', acceptedAt: new Date().toISOString() }))
  recordClientActivity(Date.now() + 86400000); await flushClientTelemetry(); expect(fetcher).toHaveBeenCalledTimes(1)
  expect(JSON.parse(localStorage.getItem(TELEMETRY_KEY)!).queue).toHaveLength(0)
})
it('can display the document even when local storage is unavailable', async () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('full') } })
  await render()
  const details = container.querySelector('details')!
  await act(async () => details.querySelector('summary')!.click())
  expect(details.open).toBe(true)
  expect(container.textContent).toContain('用户协议')
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
it('continues validating historical receipts without creating one when the document is viewed', async () => {
  for (const value of ['broken', '{}', JSON.stringify({ terms: CLIENT_LEGAL_VERSION, acceptedAt: 'bad' })]) { localStorage.setItem(CLIENT_AGREEMENT_KEY, value); expect(clientAgreementAccepted()).toBe(false) }
  expect(acceptClientAgreement()).toBe(true)
  localStorage.clear(); await render(); expect(localStorage.getItem(CLIENT_AGREEMENT_KEY)).toBeNull()
})
