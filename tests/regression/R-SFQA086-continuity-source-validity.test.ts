import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { CONTINUITY_MARKERS as markers, seedSFQA086Continuity as fixture } from '../helpers/sfqa086-continuity'
import { UNCACHED_CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'
import type { Chapter } from '../../src/lib/types'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

async function read(f: Awaited<ReturnType<typeof fixture>>) {
  return UNCACHED_CANON_RESOURCE_PROVIDER_V1.read({ scope: f.frozenScope, resourceKey: f.key, depth: 'full', maxTokens: 10000 })
}

describe('SFQA-086 · continuity never promotes stale derived content through the current manuscript', () => {
  it('keeps each fresh derived field with the exact current source hash and a derived authority', async () => {
    const f = await fixture()
    const result = await read(f)
    for (const marker of Object.values(markers)) expect(result.content).toContain(marker)
    expect(result.content).toContain('当前作者原文')
    expect(result.descriptor.authority).toBe('derived-summary')
  })

  it.each(['summary', 'continuityHandoff', 'planReconciliation'] as const)('excludes stale %s independently of the other fresh fields', async field => {
    const f = await fixture()
    const patch: Partial<Chapter> = field === 'summary' ? { summarySourceTextHash: 'a'.repeat(64) }
      : field === 'continuityHandoff' ? { continuityHandoff: { ...f.priorRow.continuityHandoff!, sourceTextHash: 'a'.repeat(64) } }
        : { planReconciliation: { ...f.priorRow.planReconciliation!, sourceTextHash: 'a'.repeat(64) } }
    await db.chapters.update(f.priorId, patch)
    const result = await read(f)
    expect(result.content).not.toContain(markers[field])
    for (const key of Object.keys(markers) as Array<keyof typeof markers>) if (key !== field) expect(result.content).toContain(markers[key])
    expect(result.content).toContain('当前作者原文')
    expect((await db.chapters.get(f.priorId))?.[field]).toEqual(field === 'summary' ? markers.summary : patch[field as keyof typeof patch])
  })

  it('falls back to real source text with no handoff and no summary evidence, without rewriting old evidence', async () => {
    const f = await fixture()
    await db.chapters.update(f.priorId, { continuityHandoff: undefined, planReconciliation: undefined, summarySourceTextHash: undefined })
    const result = await read(f)
    expect(result.content).not.toContain(markers.summary)
    expect(result.content).toContain('当前作者原文')
    expect(result.descriptor.authority).toBe('author-canon')
    expect((await db.chapters.get(f.priorId))?.summary).toBe(markers.summary)
  })

  it.each(['summary', 'continuityHandoff', 'planReconciliation'] as const)('quarantines missing hashes and incompatible normalization in %s without promoting the field or aggregate', async field => {
    const f = await fixture()
    for (const kind of ['missing-hash', 'normalization-version']) {
      const patch = field === 'summary'
        ? kind === 'missing-hash' ? { summarySourceTextHash: undefined } : { summarySourceTextHash: f.priorRow.summarySourceTextHash, summaryTextNormalizationVersion: 'unknown-version' }
        : { [field]: { ...f.priorRow[field]!, ...(kind === 'missing-hash' ? { sourceTextHash: undefined } : { textNormalizationVersion: 'unknown-version' }) } }
      // This negative case deliberately injects invalid stored evidence, including
      // missing required nested hashes, at the single database test boundary.
      await db.chapters.update(f.priorId, patch as Partial<Chapter>)
      const result = await read(f)
      expect(result.content).not.toContain(markers[field])
      expect(result.content).toContain('当前作者原文')
      const original = await UNCACHED_CANON_RESOURCE_PROVIDER_V1.read({ scope: f.frozenScope, resourceKey: f.key.replace(':continuity-tail', `:field:${field}`), depth: 'full', maxTokens: 10000 })
      expect(original.descriptor.authority).toBe('candidate')
      expect(original.content).toContain(markers[field])
    }
  })

  it.each(['generate', 'continue'] as const)('the real %s Gateway and a fresh reread exclude all stale facts while retaining current source text', async operation => {
    const f = await fixture()
    await db.chapters.update(f.priorId, { summarySourceTextHash: 'a'.repeat(64), continuityHandoff: { ...f.priorRow.continuityHandoff!, sourceTextHash: 'a'.repeat(64) }, planReconciliation: { ...f.priorRow.planReconciliation!, sourceTextHash: 'a'.repeat(64) } })
    for (let index = 0; index < 2; index++) {
      const result = await prepareProseGatewayAssemblyV1({ projectId: f.created.scope.projectId, scope: f.created.scope, worldGroupId: null, chapterId: f.targetId, outlineNodeId: f.outlineId, operation, authorRequest: '打开蓝门', config: useAIConfigStore.getState().config })
      for (const marker of Object.values(markers)) expect(result.text).not.toContain(marker)
      expect(result.text).toContain('当前作者原文')
      expect(result.contextGatewayExecution.retrievalTrace.mandatory.some(item => item.resourceKey === f.key)).toBe(true)
    }
  })
})
