import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeCatalogEntries } from './catalog-entries.mjs'

test('reference rebuild retains community metadata and older versions without mutation', () => {
  const community = { id: 'writer.cards', version: '1.0.0', digest: 'community', dependencies: { 'storyforge.calendar': '1.0.0' } }
  const historical = { id: 'storyforge.calendar', version: '0.9.0', digest: 'old' }
  const previous = [community, historical, { id: 'storyforge.calendar', version: '1.0.0', digest: 'reference-before' }]
  const before = JSON.stringify(previous)
  const current = { id: 'storyforge.calendar', version: '1.0.0', digest: 'reference-now' }
  const result = mergeCatalogEntries(previous, [current])
  assert.deepEqual(result, [current, community, historical])
  assert.equal(JSON.stringify(previous), before)
  assert.deepEqual(mergeCatalogEntries(result, [current]), result)
})
test('duplicate identities fail instead of silently deleting submitted listings', () => {
  const row = { id: 'writer.cards', version: '1.0.0' }
  assert.throws(() => mergeCatalogEntries([row, row], []), /Duplicate existing/)
  assert.throws(() => mergeCatalogEntries([], [row, row]), /Duplicate reference/)
})
