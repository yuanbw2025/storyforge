import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { assertMotionDramaPromptPackManifestV1 } from '../../src/lib/motion-drama/prompt-pack-contracts'
import { publishMotionDramaReleaseV1, readMotionDramaReleaseManifestV1 } from '../../src/lib/motion-drama/release'
import { exportMotionMaterialBundle } from '../../src/lib/motion-drama/delivery'
import { createMotionDramaReferenceReleaseFixtureV1, motionReferencePngBytesV1, motionReferenceWavBytesV1, restoreHistoricalMotionDramaReferenceRelease } from '../helpers/motion-drama-reference-release'

async function expectBundleRejected(f: Awaited<ReturnType<typeof createMotionDramaReferenceReleaseFixtureV1>>) {
  expect(await exportMotionMaterialBundle(f.scope, f.release.id).then(() => false, () => true)).toBe(true)
}

describe('SFQA-025 · 冻结素材包引用完整性', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('正常reference-ready原字节导出，prompt-only合法无素材仍可导出', async () => {
    const f = await createMotionDramaReferenceReleaseFixtureV1()
    const zip = await JSZip.loadAsync(await (await exportMotionMaterialBundle(f.scope, f.release.id)).arrayBuffer())
    const index = JSON.parse(await zip.file('references.json')!.async('string')) as Array<{ key: string; file: string; hash: string }>
    expect(index).toHaveLength(f.pins.length)
    expect(index.map(row => row.key).sort()).toEqual(f.pins.map(row => row.assetKey).sort())
    for (const row of index) expect(await zip.file(row.file)!.async('uint8array')).toEqual(new Uint8Array(motionReferencePngBytesV1()))
    expect(await zip.file('manifest.json')!.async('string')).toBe(JSON.stringify(f.manifest, null, 2))
    const prompt = await createMotionDramaReferenceReleaseFixtureV1({ promptOnly: true })
    const plain = await JSZip.loadAsync(await (await exportMotionMaterialBundle(prompt.scope, prompt.release.id)).arrayBuffer())
    expect(JSON.parse(await plain.file('references.json')!.async('string'))).toEqual([])
  })

  it.each(['all', 'one'] as const)('必需pins缺失%s时拒绝，保留原Release字节', async mode => {
    const f = await createMotionDramaReferenceReleaseFixtureV1(), original = await db.creationReleases.get(f.release.id)
    await db.creationReleaseAssets.bulkDelete((mode === 'all' ? f.pins : f.pins.slice(0, 1)).map(row => row.id!))
    await expectBundleRejected(f)
    expect(await db.creationReleases.get(f.release.id)).toEqual(original)
  })

  it.each(['duplicate', 'foreign-owner', 'wrong-hash', 'wrong-mime', 'wrong-role', 'extra'] as const)('%s证据拒绝而不从当前草稿补齐', async mutation => {
    const f = await createMotionDramaReferenceReleaseFixtureV1(), pin = f.pins[0]
    if (!pin?.id) throw new Error('Missing frozen pin')
    if (mutation === 'duplicate') {
      const copy = { ...pin }; delete copy.id
      await expect(db.creationReleaseAssets.add(copy)).rejects.toThrow()
      expect((await db.creationReleaseAssets.where('releaseId').equals(f.release.id).toArray()).length).toBe(f.pins.length)
      await expect(exportMotionMaterialBundle(f.scope, f.release.id).then(() => true)).resolves.toBe(true)
      return
    }
    else if (mutation === 'foreign-owner') await db.creationReleaseAssets.update(pin.id, { worldId: (pin.worldId ?? f.scope.worldId) + 1000 })
    else if (mutation === 'wrong-hash') await db.creationReleaseAssets.update(pin.id, { contentHash: '0'.repeat(64) })
    else if (mutation === 'wrong-mime') await db.mediaBlobObjects.update(pin.blobObjectId, { mimeType: 'image/jpeg' })
    else if (mutation === 'wrong-role') await db.creationReleaseAssets.update(pin.id, { role: 'motion-shot-reference' })
    else { const copy = { ...pin }; delete copy.id; await db.creationReleaseAssets.add({ ...copy, assetKey: 'unfrozen.extra' }) }
    await expectBundleRejected(f)
  })

  it('旧public publisher额外冻结的已选音色仍按同一冻结资产选择保留原字节', async () => {
    const f = await createMotionDramaReferenceReleaseFixtureV1({ unusedVoice: true })
    const expected = new Set(f.verifiedPack.references.filter(row => row.contentHash != null).map(row => row.stableKey))
    const selected = f.manifest.assets.find(row => row.stableKey === 'voice.unused')?.selectedVersionKey
    expect(typeof selected).toBe('string')
    expect(f.pins.find(row => row.assetKey === selected)?.role).toBe('motion-subject-reference')
    expect(expected.has(String(selected))).toBe(false)
    const original = await db.creationReleases.get(f.release.id)
    const zip = await JSZip.loadAsync(await (await exportMotionMaterialBundle(f.scope, f.release.id)).arrayBuffer())
    const index = JSON.parse(await zip.file('references.json')!.async('string')) as Array<{ key: string; file: string }>
    expect(index.some(row => row.key === selected)).toBe(true)
    const audio = index.find(row => row.key === selected)!
    expect(await zip.file(audio.file)!.async('uint8array')).toEqual(new Uint8Array(motionReferenceWavBytesV1()))
    expect(await db.creationReleases.get(f.release.id)).toEqual(original)
  })

  it('未出场的已选音色也属于已发布素材，缺 pin 时不能交付残缺的 ZIP', async () => {
    const f = await createMotionDramaReferenceReleaseFixtureV1({ unusedVoice: true })
    const selected = f.manifest.assets.find(subject => subject.stableKey === 'voice.unused')?.selectedVersionKey
    const audio = f.pins.find(pin => pin.assetKey === selected)
    if (!audio?.id) throw new Error('发布器没有封存已选音色')
    expect(f.verifiedPack.references.some(ref => ref.stableKey === selected)).toBe(false)
    await db.creationReleaseAssets.delete(audio.id)
    await expectBundleRejected(f)
    expect(await db.creationReleases.get(f.release.id)).toEqual(f.release)
  })

  it('即使提示词包已有可用参考，prompt-only 发布仍拒绝来自同一 Work 的素材 pin', async () => {
    const f = await createMotionDramaReferenceReleaseFixtureV1()
    const studio = await f.snapshot()
    const release = await publishMotionDramaReleaseV1({ scope: f.scope, episodeNumbers: [1], providers: ['seedance'],
      tier: 'prompt-only', expectedProductionRevision: studio.production.revision })
    const plain = await JSZip.loadAsync(await (await exportMotionMaterialBundle(f.scope, release.id)).arrayBuffer())
    expect(JSON.parse(await plain.file('references.json')!.async('string'))).toEqual([])
    const { id: _id, ...pin } = f.pins[0]
    expect(f.verifiedPack.references.some(ref => ref.stableKey === pin.assetKey && ref.contentHash === pin.contentHash)).toBe(true)
    await db.creationReleaseAssets.add({ ...pin, releaseId: release.id })
    await expect(exportMotionMaterialBundle(f.scope, release.id)).rejects.toThrow()
    expect(await db.creationReleases.get(release.id)).toEqual(release)
  })

  it('已选择但未被本集引用的视觉物料没有发布 pin，加入同 owner、同字节的 pin 仍拒绝', async () => {
    const f = await createMotionDramaReferenceReleaseFixtureV1({ unusedVisual: true })
    const selected = f.manifest.assets.find(subject => subject.stableKey === 'prop.clock')?.selectedVersionKey
    if (typeof selected !== 'string') throw new Error('缺少已选视觉物料')
    expect(f.verifiedPack.references.some(ref => ref.stableKey === selected)).toBe(false)
    expect(f.pins.some(pin => pin.assetKey === selected)).toBe(false)
    const used = f.pins.find(pin => pin.role === 'motion-subject-reference')
    if (!used) throw new Error('缺少同字节的已发布道具')
    const { id: _id, ...pin } = used
    await db.creationReleaseAssets.add({ ...pin, assetKey: selected })
    await expectBundleRejected(f)
    expect(await db.creationReleases.get(f.release.id)).toEqual(f.release)
  })

  it('真实 V1 发布保留只出现在 soundPlan 的已选道具、全部原始字节和原始 Release', async () => {
    const { scope, release, pins } = await restoreHistoricalMotionDramaReferenceRelease()
    expect(release.contentHash).toBe('22d90bbc2e9dfb7f5b43040b611e4907bdfc435924dfb49a1b7ece92a3585617')
    const manifest = await readMotionDramaReleaseManifestV1(scope, release.id)
    expect(manifest.tier).toBe('reference-ready')
    const pack = manifest.promptPacks[0]
    assertMotionDramaPromptPackManifestV1(pack)
    expect(pack.references.map(ref => ref.stableKey)).not.toContain('prop.clock.v2')
    expect(pins.map(pin => pin.assetKey)).toContain('prop.clock.v2')
    const zip = await JSZip.loadAsync(await (await exportMotionMaterialBundle(scope, release.id)).arrayBuffer())
    expect(await zip.file('manifest.json')!.async('string')).toBe(JSON.stringify(manifest, null, 2))
    const index = JSON.parse(await zip.file('references.json')!.async('string')) as Array<{ key: string; file: string }>
    expect(index.map(entry => entry.key).sort()).toEqual(pins.map(pin => pin.assetKey).sort())
    for (const entry of index) {
      const bytes = entry.key === 'voice.unused.v2' ? motionReferenceWavBytesV1() : motionReferencePngBytesV1()
      expect(await zip.file(entry.file)!.async('uint8array')).toEqual(new Uint8Array(bytes))
    }
    expect(await db.creationReleases.get(release.id)).toEqual(release)
  })

  it('已冻结附加音色也须核实际格式，不能用改写的MIME误标字节', async () => {
    const f = await createMotionDramaReferenceReleaseFixtureV1({ unusedVoice: true })
    const selected = f.manifest.assets.find(row => row.stableKey === 'voice.unused')?.selectedVersionKey
    const audio = f.pins.find(row => row.assetKey === selected)!
    await db.mediaBlobObjects.update(audio.blobObjectId, { mimeType: 'audio/mpeg' })
    await expectBundleRejected(f)
  })

  it('当前草稿选择/物料版本被改或清除时仍导出旧发布字节，实际Blob缺失则失败', async () => {
    const f = await createMotionDramaReferenceReleaseFixtureV1(), before = await db.creationReleases.get(f.release.id)
    await db.motionDramaAssetSubjects.where('adaptationProjectId').equals(f.adaptation.id!).modify({ selectedVersionKey: null })
    await db.motionDramaAssetVersions.where('adaptationProjectId').equals(f.adaptation.id!).delete()
    const zip = await JSZip.loadAsync(await (await exportMotionMaterialBundle(f.scope, f.release.id)).arrayBuffer())
    const index = JSON.parse(await zip.file('references.json')!.async('string')) as Array<{ file: string }>
    for (const row of index) expect(await zip.file(row.file)!.async('uint8array')).toEqual(new Uint8Array(motionReferencePngBytesV1()))
    expect(await db.creationReleases.get(f.release.id)).toEqual(before)
    await db.mediaBlobObjects.delete(f.pins[0].blobObjectId)
    await expectBundleRejected(f)
    expect(await db.creationReleases.get(f.release.id)).toEqual(before)
  })
})
