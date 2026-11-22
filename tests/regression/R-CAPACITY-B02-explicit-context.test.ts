import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assembleContext, assembleCapturedWorldviewContextV2, captureRegisteredContextSourceV2 } from '../../src/lib/registry/assemble-context'
import { CONTEXT_SOURCES, CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { checkRegistry } from '../../src/lib/registry/validate'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'

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

const exactKeys = ['worldviewFieldBaselineV2', 'worldviewFieldContextV2'] as const
async function fixture() {
  const { scope } = await seedCurrentWorkspace('B02 显式完整来源')
  const baseline = `完整基线首${'基础设定'.repeat(6000)}完整基线尾`
  const rule = `正式约束首${'正式约束'.repeat(6000)}正式约束尾`
  await db.worldviews.add(stampNewRecord(scope, 'worldviews', { projectId: scope.projectId,
    worldGroupId: null, worldOrigin: baseline, createdAt: 1, updatedAt: 1 }, { owner: 'world' }) as never)
  await db.worldRulesProfiles.add(stampNewRecord(scope, 'worldRulesProfiles', { projectId: scope.projectId,
    worldGroupId: null, globalNote: rule, entries: {}, customNodes: [], createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
  return { scope, baseline, rule }
}

describe('B02 explicit full readers preserve ordinary default selection', () => {
  it.each(['missing', 'empty'] as const)('does not scan new readers for %s sourceKeys, while retaining shared manual semantics', async selection => {
    const f = await fixture()
    const baselineRead = vi.spyOn(CONTEXT_SOURCE_BY_KEY.get(exactKeys[0])!, 'read')
    const contextRead = vi.spyOn(CONTEXT_SOURCE_BY_KEY.get(exactKeys[1])!, 'read')
    const codexBaselineRead = vi.spyOn(CONTEXT_SOURCE_BY_KEY.get('codexExtractionBaseline')!, 'read')
    const codexProgressRead = vi.spyOn(CONTEXT_SOURCE_BY_KEY.get('codexExtractionProgressV2')!, 'read')
    const preserved = new Set<string>([...exactKeys, 'manualText', 'codexExtractionBaseline', 'codexExtractionProgressV2'])
    for (const source of CONTEXT_SOURCES) {
      if (!preserved.has(source.key)) vi.spyOn(source, 'read').mockResolvedValue('')
    }
    const post = vi.fn(() => { throw new Error('source selection must not invoke a model') })
    vi.stubGlobal('fetch', post)
    const result = await assembleContext({ projectId: f.scope.projectId, scope: f.scope, worldGroupId: null,
      ...(selection === 'empty' ? { sourceKeys: [] } : {}), manualSourceText: '既有用户明确原文仍进入缺省来源' })
    expect(result.included).toContain('manualText')
    expect(result.text).toContain('既有用户明确原文仍进入缺省来源')
    for (const key of exactKeys) {
      expect(result.included).not.toContain(key)
      expect(result.omitted).not.toContain(key)
      expect(result.sourceEvidence?.some(row => row.key === key)).toBe(false)
      expect(CONTEXT_SOURCE_BY_KEY.get(key)?.explicitSelectionOnly).toBe(true)
    }
    expect(result.text).not.toContain('完整基线首')
    expect(result.text).not.toContain('正式约束尾')
    expect(baselineRead).not.toHaveBeenCalled()
    expect(contextRead).not.toHaveBeenCalled()
    // These existing Codex sources already guard their target selectors. They
    // retain that contract instead of being relabelled as new full recipes.
    expect(codexBaselineRead).not.toHaveBeenCalled()
    expect(codexProgressRead).not.toHaveBeenCalled()
    for (const key of ['manualText', 'codexExtractionBaseline', 'codexExtractionProgressV2']) expect(CONTEXT_SOURCE_BY_KEY.get(key)?.explicitSelectionOnly).not.toBe(true)
    expect(post).not.toHaveBeenCalled()
  })

  it('keeps both real explicit full captures and their original authority/versions, including long tails', async () => {
    const f = await fixture()
    const context = { projectId: f.scope.projectId, scope: f.scope, worldGroupId: null }
    const manual = await captureRegisteredContextSourceV2({ sourceKey: 'manualText', context: { ...context, manualSourceText: '本轮作者明确要求' } })
    const baseline = await captureRegisteredContextSourceV2({ sourceKey: 'worldviewFieldBaselineV2', context })
    const constraints = await captureRegisteredContextSourceV2({ sourceKey: 'worldviewFieldContextV2', context })
    expect(baseline.sourceVersion).toBe('worldview-field-baseline-full-v2')
    expect(constraints.sourceVersion).toBe('worldview-field-constraints-full-v2')
    expect(baseline.scope).toEqual(f.scope)
    expect(constraints.scope).toEqual(f.scope)
    expect(baseline.rawText).toContain(f.baseline)
    expect(constraints.rawText).toContain(f.rule)
    const assembled = await assembleCapturedWorldviewContextV2([manual, baseline, constraints])
    expect(assembled.included).toEqual(['manualText', ...exactKeys])
    expect(assembled.trimmed).toEqual([])
    expect(assembled.text).toContain('完整基线尾')
    expect(assembled.text).toContain('正式约束尾')
    expect(assembled.sourceEvidence?.every(row => row.delivery === 'full')).toBe(true)
    expect(assembled.sourceEvidence?.map(row => row.inputCharacters)).toEqual([manual.rawUTF16Length, baseline.rawUTF16Length, constraints.rawUTF16Length])
  })

  it('does not grant a new reader without its existing frozen owner/world-group requirements', async () => {
    const f = await fixture()
    await expect(captureRegisteredContextSourceV2({ sourceKey: 'worldviewFieldBaselineV2',
      context: { projectId: f.scope.projectId, scope: f.scope } })).rejects.toThrow('读取条件')
    await expect(captureRegisteredContextSourceV2({ sourceKey: 'worldviewFieldContextV2',
      context: { projectId: f.scope.projectId + 100, scope: f.scope, worldGroupId: null } })).rejects.toThrow()
  })
})


describe('B02 exact complete source registry budget closure', () => {
  it.each(exactKeys)('admits the actual exact %s registration', key => {
    expect(CONTEXT_SOURCE_BY_KEY.get(key)?.budgetTokens).toBeNull()
    expect(checkRegistry()).toMatchObject({ ok: true, errors: [] })
  })
  for (const key of exactKeys) {
    it.each(['key', 'source-version', 'protocol-version', 'owner', 'scope', 'explicit', 'protected', 'atomic', 'group', 'layer'] as const)(
      `rejects ${key} with forged %s metadata rather than admitting arbitrary full capture`, mutation => {
        const source = CONTEXT_SOURCE_BY_KEY.get(key)!, saved = { ...source }
        try {
          if (mutation === 'key') source.key = 'forgedWorldviewSource'
          else if (mutation === 'source-version') source.fullCapture = { ...source.fullCapture!, sourceVersion: 'forged-source-version' }
          else if (mutation === 'protocol-version') source.fullCapture = { ...source.fullCapture!, version: 'forged-protocol' as never }
          else if (mutation === 'owner') source.ownerFrom = source.ownerFrom === 'work' ? 'world' : 'work'
          else if (mutation === 'scope') source.scope = source.scope === 'world' ? 'project' : 'world'
          else if (mutation === 'explicit') source.explicitSelectionOnly = false
          else if (mutation === 'protected') source.protectedFromTrim = false
          else if (mutation === 'atomic') source.atomic = false
          else if (mutation === 'group') source.requiresWorldGroupId = false
          else source.layer = 'L1'
          expect(checkRegistry().errors).toContain(`CONTEXT_SOURCES budgetTokens 必须为正数: ${source.key}`)
        } finally { Object.assign(source, saved) }
        expect(checkRegistry()).toMatchObject({ ok: true, errors: [] })
      })
  }
  it('retains the ordinary positive budget requirement outside the exact product registrations', () => {
    const source = CONTEXT_SOURCE_BY_KEY.get('worldview')!, budget = source.budgetTokens
    try {
      source.budgetTokens = null
      expect(checkRegistry().errors).toContain('CONTEXT_SOURCES budgetTokens 必须为正数: worldview')
    } finally { source.budgetTokens = budget }
    expect(checkRegistry()).toMatchObject({ ok: true, errors: [] })
  })
})
