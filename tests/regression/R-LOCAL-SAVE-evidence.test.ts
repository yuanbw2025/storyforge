import { expect, it } from 'vitest'
import { hashAdoptFieldValueV1 } from '../../src/lib/registry/adopt'
import { localSaveIdentityKeyV1, matchingLocalSaveAckV1, type LocalSaveAckV1, type LocalSaveIntentV1 } from '../../src/lib/authoring/local-save-evidence'
const identity = { projectId: 1, worldId: 2, workId: 3, worldGroupId: null, table: 'worldviews' as const, field: 'worldStructure' as const }
const intent: LocalSaveIntentV1 = { kind: 'natural-field-local-save-v1', session: 'session1', generation: 3, expected: { version: 1, source: 'database-read', identity, recordId: 4, resourceUid: 'uid1', present: true, value: 'old', valueHash: 'oldhash', confirmedAt: 1 } }
function ack(): LocalSaveAckV1 { return { kind: 'natural-field-local-save-ack-v1', session: intent.session, generation: 3, witness: { ...intent.expected, source: 'committed-write', value: '  新\r\n🌊  ', valueHash: 'newhash' } } }
it('requires committed witness, exact scope/record/session/generation/raw value, not a void callback', () => {
  expect(matchingLocalSaveAckV1(ack(), intent, '  新\r\n🌊  ')).toBe(true)
  expect(matchingLocalSaveAckV1(undefined, intent, '  新\r\n🌊  ')).toBe(false)
  for (const mutate of [(a: LocalSaveAckV1) => { a.session = 'other' }, (a: LocalSaveAckV1) => { a.generation++ }, (a: LocalSaveAckV1) => { a.witness.recordId = 5 }, (a: LocalSaveAckV1) => { a.witness.resourceUid = 'recreated' }, (a: LocalSaveAckV1) => { a.witness.identity = { ...identity, workId: 9 } }, (a: LocalSaveAckV1) => { a.witness.source = 'database-read' }, (a: LocalSaveAckV1) => { a.witness.present = false }]) {
    const a = ack(); mutate(a); expect(matchingLocalSaveAckV1(a, intent, '  新\r\n🌊  ')).toBe(false)
  }
  expect(matchingLocalSaveAckV1(ack(), intent, '新\n🌊')).toBe(false)
})
it('does not normalize raw value hashes or collapse absence/null/empty and keeps group/Work identities distinct', async () => {
  const values = [undefined, null, '', ' ', '\r\n', '\n', 'Ａ', 'A', '😀', '😀 ']
  expect(new Set(await Promise.all(values.map(hashAdoptFieldValueV1))).size).toBe(values.length)
  expect(localSaveIdentityKeyV1(identity)).not.toBe(localSaveIdentityKeyV1({ ...identity, worldGroupId: 4 }))
  expect(localSaveIdentityKeyV1(identity)).not.toBe(localSaveIdentityKeyV1({ ...identity, workId: 4 }))
})
