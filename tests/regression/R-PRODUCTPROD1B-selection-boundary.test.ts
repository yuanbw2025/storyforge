import { describe, expect, it } from 'vitest'
import { narrowProductProductionReadBoundaryV1 } from '../../src/lib/product-production/source-contracts'

describe('R-PRODUCTPROD-1B · frozen product selection boundary', () => {
  it('不会把同类型但未进入 SourceSelection 的世界记录交给正式生产', () => {
    const boundary = narrowProductProductionReadBoundaryV1({
      boundary: {
        sourceScope: { projectId: 1, workId: 1, worldId: 1, worldGroupId: null } as never,
        allowedResourceKeys: ['character:blank-a', 'character:blank-b', 'character:real', 'ending:final'],
        mandatoryResourceKeys: ['character:blank-a', 'character:real', 'ending:final'],
        mandatoryFullResourceKeys: ['character:blank-a', 'character:real', 'ending:final'],
        targetResourceKeys: ['character:real'],
      },
      selectionResourceKeys: ['character:real', 'ending:final'],
    })
    expect(boundary.allowedResourceKeys).toEqual(['character:real', 'ending:final'])
    expect(boundary.mandatoryResourceKeys).toEqual(['character:real', 'ending:final'])
    expect(boundary.mandatoryFullResourceKeys).toEqual(['character:real', 'ending:final'])
  })

  it('允许显式冻结的依赖闭包，但拒绝越过 SourcePlan permission', () => {
    const base = {
      sourceScope: { projectId: 1, workId: 1, worldId: 1, worldGroupId: null } as never,
      allowedResourceKeys: ['character:a', 'character:b', 'relation:a-b'],
      mandatoryResourceKeys: ['character:a'], mandatoryFullResourceKeys: ['character:a'],
      targetResourceKeys: ['character:a'],
    }
    expect(narrowProductProductionReadBoundaryV1({
      boundary: base,
      selectionResourceKeys: ['character:a', 'character:b'],
      dependencyClosureResourceKeys: ['relation:a-b'],
    }).allowedResourceKeys).toEqual(['character:a', 'character:b', 'relation:a-b'])
    expect(() => narrowProductProductionReadBoundaryV1({
      boundary: base, selectionResourceKeys: ['character:a'],
      dependencyClosureResourceKeys: ['relation:outside'],
    })).toThrow(/越过 SourcePlan permission/)
  })
})
