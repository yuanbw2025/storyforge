import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { assertOfflineReferenceCapacityEntry } from './reference-capacity-contract.mjs'
const registry = () => JSON.parse(readFileSync(new URL('../src/lib/agent/ai-entry-registry.json', import.meta.url), 'utf8'))
test('capacity evaluation is registered and cannot acquire writing or other transport authority', () => {
  const original = registry()
  assert.doesNotThrow(() => assertOfflineReferenceCapacityEntry(original))
  for (const patch of [{ boundary: 'formal' }, { adoptAllowed: true }, { adoptionTargets: ['references'] },
    { transport: 'local-codex-subscription' }, { caller: 'scripts/other.mjs' }, { contract: 'scripts/reference-quality-contract.mjs' }]) {
    const changed = registry()
    Object.assign(changed.offlineEvaluations.find(entry => entry.entryId === 'eval.reference.service-capacity'), patch)
    assert.throws(() => assertOfflineReferenceCapacityEntry(changed), /Missing read-only/)
  }
  assert.throws(() => assertOfflineReferenceCapacityEntry({}), /Missing read-only/)
  assert.deepEqual(original, registry())
})
