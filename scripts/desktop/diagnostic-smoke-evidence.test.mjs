import { test } from 'node:test'
import assert from 'node:assert/strict'
import { boundedContext, preserveDiagnosticSmokeEvidence } from './diagnostic-smoke-evidence.mjs'

test('failure evidence keeps only closed metadata and bounded times, including slight future clock evidence', () => {
  const now = Date.now()
  const step = { at: new Date(now + 1).toISOString(), area: 'home', action: 'save', text: 'PRIVATE', key: 'SECRET' }
  const evidence = boundedContext({ enabled: true, trail: [null, step, { ...step, area: 'PRIVATE' }, { ...step, action: 'SECRET' }, { ...step, at: 'PRIVATE' }, { ...step, at: new Date(now - 300001).toISOString() }, { ...step, at: new Date(now + 5001).toISOString() }] }, now)
  assert.deepEqual(evidence, { enabled: true, trail: [{ at: step.at, area: 'home', action: 'save' }] })
  assert.equal(JSON.stringify(evidence).includes('PRIVATE'), false)
  assert.equal(JSON.stringify(evidence).includes('SECRET'), false)
  assert.equal(boundedContext({ trail: Array(30).fill(step) }, now).trail.length, 20)
  assert.deepEqual(boundedContext({ enabled: 'true', trail: 'PRIVATE' }, now), { enabled: false, trail: [] })
})

test('failure evidence refuses real profiles before using browser or filesystem', async () => {
  // Deliberately invalid dependencies prove the profile guard runs before either is used.
  const absentApp = /** @type {import('playwright').ElectronApplication} */ (/** @type {unknown} */ (undefined))
  const absentPage = /** @type {import('playwright').Page} */ (/** @type {unknown} */ (undefined))
  await assert.rejects(preserveDiagnosticSmokeEvidence(absentApp, absentPage, '/users/author/profile'), /isolated smoke profile/)
})
