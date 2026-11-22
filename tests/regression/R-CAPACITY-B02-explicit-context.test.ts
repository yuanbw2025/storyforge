import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { CONTEXT_SOURCES, CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })

describe('explicit selection metadata preserves existing registered reader authority', () => {
  it.each(['missing', 'empty'] as const)('excludes an explicit-only reader from %s defaults, but still permits its explicit selection', async selection => {
    const { scope } = await seedCurrentWorkspace('显式选源中立机制')
    const source = CONTEXT_SOURCE_BY_KEY.get('manualText')!
    const previous = source.explicitSelectionOnly
    // Temporarily exercise the trait on an existing registered reader. No new
    // product source/permission is registered by this shared prerequisite.
    source.explicitSelectionOnly = true
    try {
      for (const other of CONTEXT_SOURCES) {
        if (other !== source) vi.spyOn(other, 'read').mockResolvedValue('')
      }
      const read = vi.spyOn(source, 'read')
      const post = vi.fn(() => { throw new Error('selection must not call a model') })
      vi.stubGlobal('fetch', post)
      const context = { projectId: scope.projectId, scope, worldGroupId: null, manualSourceText: '作者明确选择的原文尾部' }
      const defaults = await assembleContext({ ...context, ...(selection === 'empty' ? { sourceKeys: [] } : {}) })
      expect(read).not.toHaveBeenCalled()
      expect(defaults.included).not.toContain('manualText')
      expect(defaults.omitted).not.toContain('manualText')
      expect(defaults.sourceEvidence?.some(row => row.key === 'manualText')).toBe(false)
      expect(defaults.text).not.toContain(context.manualSourceText)
      const explicit = await assembleContext({ ...context, sourceKeys: ['manualText'] })
      expect(read).toHaveBeenCalledOnce()
      expect(explicit.included).toEqual(['manualText'])
      expect(explicit.text).toContain(context.manualSourceText)
      expect(post).not.toHaveBeenCalled()
    } finally {
      if (previous === undefined) delete source.explicitSelectionOnly
      else source.explicitSelectionOnly = previous
    }
  })

  it('keeps unmarked legacy manual content in the default source set', async () => {
    const { scope } = await seedCurrentWorkspace('原缺省来源')
    expect(CONTEXT_SOURCE_BY_KEY.get('manualText')?.explicitSelectionOnly).toBeUndefined()
    for (const source of CONTEXT_SOURCES) {
      if (source.key !== 'manualText') vi.spyOn(source, 'read').mockResolvedValue('')
    }
    const result = await assembleContext({ projectId: scope.projectId, scope, worldGroupId: null, manualSourceText: '原缺省作者资料' })
    expect(result.included).toContain('manualText')
    expect(result.text).toContain('原缺省作者资料')
  })
})
