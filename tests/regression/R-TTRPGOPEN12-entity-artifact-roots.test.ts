import { describe, it, expect } from 'vitest'
import { PROJECT_TABLES } from '../../src/lib/registry/project-tables'
import { extractExactArtifactOwnerRootsV1 } from '../../src/lib/memory/artifact-roots'

const raw = { artifactKind: 'raw-response' as const, contentHash: 'a'.repeat(64) }
const delivered = { artifactKind: 'source-snapshot' as const, contentHash: 'b'.repeat(64) }
// Retention pointers only: these fixtures deliberately do not claim executable plans or source permission.
const operations = [{ plan: { version: 1 } }, { plan: { version: 2, modelOrigin: { artifactRefs: [raw, delivered, raw] } } }]
const state = { ttrpg: { openRun: { entityOperations: operations }, branchLineage: { ancestors: [
  { snapshot: { openRun: { entityOperations: operations } } },
] } } }
const roots = (name: string, value: Record<string, unknown>) => extractExactArtifactOwnerRootsV1(value, PROJECT_TABLES.find(t => t.name === name)!.exactArtifactRoots!)
describe('R-TTRPGOPEN12 model entity evidence owner registration', () => {
  it('retains current and inherited pointers from either saved state field, including the last ancestor', () => {
    for (const field of ['initialStateJson', 'runtimeHeadStateJson']) {
      expect(roots('productRuntimeSessions', { kind: 'ttrpg', [field]: JSON.stringify(state) })).toEqual([raw, delivered])
      const inheritedOnly = structuredClone(state); inheritedOnly.ttrpg.openRun.entityOperations = []
      expect(roots('productRuntimeSessions', { kind: 'ttrpg', [field]: JSON.stringify(inheritedOnly) })).toEqual([raw, delivered])
    }
  })
  it('retains the exact model proposal event without treating human or other-product bytes as these owners', () => {
    const payloadJson = JSON.stringify({ plan: operations[1].plan })
    expect(roots('productRuntimeEvents', { type: 'ttrpg.open.entity.model-proposed', payloadJson })).toEqual([raw, delivered])
    expect(roots('productRuntimeEvents', { type: 'ttrpg.open.entity.proposed', payloadJson })).toEqual([])
    expect(roots('productRuntimeSessions', { kind: 'other', runtimeHeadStateJson: JSON.stringify(state) })).toEqual([])
  })
  it('preserves optional V1 absence and fails closed on a damaged declared model evidence owner', () => {
    expect(roots('productRuntimeSessions', { kind: 'ttrpg', initialStateJson: JSON.stringify({ ttrpg: { openRun: { entityOperations: [{ plan: { version: 1 } }] } } }) })).toEqual([])
    expect(() => roots('productRuntimeEvents', { type: 'ttrpg.open.entity.model-proposed', payloadJson: JSON.stringify({ plan: { modelOrigin: { artifactRefs: [{ ...raw, contentHash: 'broken' }] } } }) })).toThrow(/清理已停止/)
  })
})
