import { expect, it } from 'vitest'
import { documentImportChunkBindingProjectionV1, hashDocumentImportChunkBindingV1 } from '../../src/lib/import/document-parse-binding'

const session = { id: 17, targetScope: { projectId: 7, worldId: 11, workId: 13 },
  importTarget: 'reference' as const, fileHash: 'a'.repeat(64), chunks: [{ sourceTextHash: 'b'.repeat(64) }] }

it('preserves the complete former binding projection including absent world group and exact Unicode claim', async () => {
  const claimKey = 'claim-e\u0301'
  expect(documentImportChunkBindingProjectionV1(session, 0, claimKey)).toEqual({
    owner: { projectId: 7, worldId: 11, workId: 13 }, importTarget: 'reference', worldGroupId: null,
    fileHash: 'a'.repeat(64), sessionId: 17, chunkIndex: 0, sourceTextHash: 'b'.repeat(64), claimKey,
  })
  expect(await hashDocumentImportChunkBindingV1(session, 0, claimKey)).toBe("72e4a675cbcaf1fa98fcb0f948abe441f1247a3067a54f427af19611bb1639b0")
})

it.each([
  { importTarget: 'project' as const }, { targetScope: { projectId: 7, worldId: 11, workId: 14 } },
  { id: 18 }, { targetWorldGroupId: 19 }, { fileHash: 'c'.repeat(64) },
  { chunks: [{ sourceTextHash: 'd'.repeat(64) }] },
])('does not conflate changed source or owner evidence %o', async change => {
  expect(await hashDocumentImportChunkBindingV1({ ...session, ...change }, 0, 'claim'))
    .not.toBe(await hashDocumentImportChunkBindingV1(session, 0, 'claim'))
})

it('keeps chunk coordinate and exact claim identity in the original binding', async () => {
  const two = { ...session, chunks: [session.chunks[0], session.chunks[0]] }
  const hash = await hashDocumentImportChunkBindingV1(two, 0, 'claim-e\u0301')
  expect(await hashDocumentImportChunkBindingV1(two, 1, 'claim-e\u0301')).not.toBe(hash)
  expect(await hashDocumentImportChunkBindingV1(two, 0, 'claim-é')).not.toBe(hash)
})
