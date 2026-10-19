import Dexie from 'dexie'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { avgVersionedPlanningFixture } from '../helpers/avg-versioned-planning-fixture'
import { compileAvgVisualPlanningProposalV1,freezeAvgVisualPlanningScopeV1 } from '../../src/lib/avg/media-source'
import { compileAvgVisualPlanningProposalV2,freezeAvgVisualPlanningScopeV2 } from '../../src/lib/avg/media-source-v2'
import { canonicalProductProductionJsonV2,hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

beforeEach(async()=>{await db.delete();await db.open()})
afterEach(()=>{vi.restoreAllMocks();db.close()})

describe('AVG original visual compilation inside an existing IndexedDB snapshot',()=>{
  it.each([1,2] as const)('keeps proposal%s bytes/hashes and the caller snapshot under contended hash keep-alives',async version=>{
    const f=avgVersionedPlanningFixture(),scope=version===1?await freezeAvgVisualPlanningScopeV1(f.legacy,f.source):await freezeAvgVisualPlanningScopeV2(f.versioned,f.source)
    const input={scope,source:f.source,visualBible:f.visualBible,mediaBriefs:[...f.mediaBriefs].reverse()}
    const compile=version===1?compileAvgVisualPlanningProposalV1:compileAvgVisualPlanningProposalV2
    const expected=await compile(input),original=canonicalProductProductionJsonV2(input)
    console.info('[avg-visual-compiler-baseline]',version,await hashProductProductionValueV2(expected),canonicalProductProductionJsonV2(expected).length)
    const wait=Dexie.waitFor.bind(Dexie),leases=new Set<unknown>()
    // Deterministic contention fault: the real keep-alive still waits on the
    // real WebCrypto result. A second lease in that same transaction fails
    // immediately instead of leaving this regression to a sporadic 60s hang.
    vi.spyOn(Dexie,'waitFor').mockImplementation(((value,timeout)=>{
      const tx=Dexie.currentTransaction
      if(tx&&leases.has(tx))throw new Error('Injected contended transaction hash keep-alive')
      if(tx)leases.add(tx)
      return wait(value,timeout).finally(()=>{if(tx)leases.delete(tx)})
    }) as typeof Dexie.waitFor)
    const result=await db.transaction('r',db.works,async()=>{
      const result=await compile(input)
      expect(await db.works.count()).toBe(0)
      return result
    })
    expect(result).toEqual(expected)
    expect(canonicalProductProductionJsonV2(result)).toBe(canonicalProductProductionJsonV2(expected))
    expect(await hashProductProductionValueV2(result)).toBe(await hashProductProductionValueV2(expected))
    expect(canonicalProductProductionJsonV2(input)).toBe(original)
  })
})
