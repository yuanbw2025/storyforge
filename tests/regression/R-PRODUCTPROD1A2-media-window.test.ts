import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createBuildProductMediaResolver } from '../../src/lib/product-production/media-resolver'
import { seedAvgNativePreview } from '../helpers/avg-native-fixture'
import { avgInventoryMediaFixture } from '../helpers/avg-inventory-media-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'
import type { ProductMediaResolverV1 } from '../../src/lib/types'

/** URL bookkeeping uses a test browser API. Owner/artifact/blob reads and hash
 * verification are real; actual image/audio decode remains a browser gate. */
describe('registered media resolver bounded windows',()=>{
  const readers:ProductMediaResolverV1[]=[]
  let nextUrl=0
  beforeEach(async()=>{
    await db.delete();await db.open();nextUrl=0
    vi.spyOn(URL,'createObjectURL').mockImplementation(()=>`blob:window-test-${++nextUrl}`)
    vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>undefined)
  })
  afterEach(async()=>{
    for(const reader of readers)reader.dispose()
    readers.length=0
    await vi.waitFor(async()=>expect((await db.mediaBlobObjects.toArray()).every(row=>!row.leaseOwner)).toBe(true))
    vi.restoreAllMocks();db.close()
  })
  const fixture=async()=>{
    const media=await avgInventoryMediaFixture(),s=await seedAvgNativePreview(avgSystemFixture(),media)
    const create=async()=>{const reader=await createBuildProductMediaResolver({scope:s.scope,productBuildId:s.buildId,preview:s.preview});readers.push(reader);return reader}
    return {...s,media,create}
  }
  it('keeps legacy cached URLs until dispose when no window was requested',async()=>{
    const s=await fixture(),reader=await s.create(),[a,b]=s.media.map(row=>row.asset.assetKey)
    const first=await reader.preload({assetKeys:[a],maximumBytes:4096})
    await reader.preload({assetKeys:[b],maximumBytes:4096})
    expect((await reader.preload({assetKeys:[a],maximumBytes:4096})).urls[a]).toBe(first.urls[a])
    expect(URL.revokeObjectURL).not.toHaveBeenCalled()
    reader.dispose();expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2)
  })
  it('evicts old URLs and raw byte cache, then detects damaged physical bytes on reentry',async()=>{
    const s=await fixture(),reader=await s.create(),[a,b]=s.media.map(row=>row.asset.assetKey)
    const first=await reader.preload({assetKeys:[a],maximumBytes:4096,retainOnlyRequested:true})
    await reader.preload({assetKeys:[b],maximumBytes:4096,retainOnlyRequested:true})
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first.urls[a])
    const artifact=await db.productBuildArtifacts.where('buildId').equals(s.buildId).filter(row=>row.contentHash===s.media[0].asset.contentHash).first()
    await db.mediaBlobObjects.update(artifact!.blobObjectId!,{data:new ArrayBuffer(s.media[0].data.byteLength)})
    const back=await reader.preload({assetKeys:[a],maximumBytes:4096,retainOnlyRequested:true})
    expect(back.urls).toEqual({});expect(back.failures).toEqual([expect.objectContaining({assetKey:a,reason:expect.stringMatching(/哈希|hash/iu)})])
  })
  it('bounds the retained window itself, drops over-budget cached entries, and accepts an explicit empty window',async()=>{
    const s=await fixture(),reader=await s.create(),[a,b]=s.media.map(row=>row.asset.assetKey)
    const old=await reader.preload({assetKeys:[b],maximumBytes:4096})
    const result=await reader.preload({assetKeys:[a,b,a,'undeclared'],maximumBytes:s.media[0].asset.byteSize,retainOnlyRequested:true})
    expect(Object.keys(result.urls)).toEqual([a]);expect(result.usedBytes).toBe(s.media[0].asset.byteSize)
    expect(result.failures.map(row=>row.assetKey)).toEqual([b,'undeclared'])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(old.urls[b])
    const empty=await reader.preload({assetKeys:[],maximumBytes:0,retainOnlyRequested:true})
    expect(empty).toEqual({urls:{},failures:[],usedBytes:0})
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.urls[a])
  })
  it('serializes competing windows and lets a new resolver start while an old in-flight reader is disposed',async()=>{
    const s=await fixture(),reader=await s.create(),[a,b]=s.media.map(row=>row.asset.assetKey)
    const [first,second]=await Promise.all([reader.preload({assetKeys:[a],maximumBytes:4096,retainOnlyRequested:true}),reader.preload({assetKeys:[b],maximumBytes:4096,retainOnlyRequested:true})])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(first.urls[a]);expect(second.failures).toEqual([])
    const old=await s.create(),pending=old.preload({assetKeys:[a],maximumBytes:4096,retainOnlyRequested:true})
    await Promise.resolve();old.dispose()
    const fresh=await s.create(),result=await fresh.preload({assetKeys:[a],maximumBytes:4096,retainOnlyRequested:true})
    await pending
    expect(result.failures).toEqual([]);expect(result.urls[a]).toBeTruthy()
    await expect(old.read(a)).rejects.toThrow(/释放/)
  })
  it('preserves per-asset failure results when an already requested legacy preload is disposed before its queued read starts',async()=>{
    const s=await fixture(),reader=await s.create(),key=s.media[0].asset.assetKey
    const pending=reader.preload({assetKeys:[key],maximumBytes:4096})
    reader.dispose()
    expect(await pending).toEqual({urls:{},usedBytes:0,failures:[{assetKey:key,reason:expect.stringMatching(/已释放/)}]})
    await expect(reader.preload({assetKeys:[key],maximumBytes:4096})).rejects.toThrow(/已释放/)
  })
})
