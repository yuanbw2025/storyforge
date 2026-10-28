import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { avgNativePackage, avgNativeScripts, seedAvgNativePreview, seedAvgNativeRelease } from '../helpers/avg-native-fixture'
import { avgSystemFixture } from '../helpers/avg-system-fixture'
import { legacyPackage } from '../helpers/avg-carrier-fixture'
import { parseProductRuntimePackageV2, requirePlayableProductRuntimePackage } from '../../src/lib/product-production/runtime-package'
import { compileAvgExecutablePackageV2 } from '../../src/lib/avg/executable-compiler'
import { avgExecutableModule, avgRuntimeStage } from '../../src/lib/avg/executable-module'
import { createAvgGameInstance, createProductInitialStateV1, createProductRuntimeInstance } from '../../src/lib/product/runtime-instances'
import { commitNarrativeChoice, readProductRuntimeStateVersion, readProductRuntimeState, createProductRuntimeCheckpoint, branchProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-commands'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import { createProductBuildPreviewManifestV2 } from '../../src/lib/product-production/preview-manifest'
import { verifyProductRuntimeSessionSourceV1 } from '../../src/lib/product-production/preview-source'

async function readLine(id: number, key: string, commandId: string) {
  const base = await readProductRuntimeStateVersion(id)
  return reachAvgPresentationBeat({ sessionId: id, beatKey: key, commandId, baseSequence: base.sequence, baseStateHash: base.stateHash })
}
async function choose(id: number, key: string) {
  const base = await readProductRuntimeStateVersion(id)
  return commitNarrativeChoice({ sessionId: id, choiceKey: key, commandId: crypto.randomUUID(), baseSequence: base.sequence, baseStateHash: base.stateHash })
}
describe('AVG native V2 compilation, event replay and saves', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('preserves native V2 identity and shared Cue protocol while leaving legacy state bytes without new fields', async () => {
    const pkg = avgNativePackage()
    expect(requirePlayableProductRuntimePackage(pkg).version).toBe(2)
    expect(parseProductRuntimePackageV2(pkg)).toEqual(pkg)
    expect(avgExecutableModule(pkg)?.version).toBe(2)
    expect(avgRuntimeStage(pkg)?.version).toBe(1)
    expect(createProductInitialStateV1({ runtimePackage: pkg, runtimeSourceHash: await hashProductProductionValueV2(pkg) }).avgRules?.systemPlan).toEqual(avgSystemFixture())
    const old = createProductInitialStateV1({ runtimePackage: legacyPackage(), runtimeSourceHash: 'a'.repeat(64) })
    expect(old).not.toHaveProperty('avgRules')
  })
  it('refuses drift in rules, canonical lines, initial values, capability, speaker and script choice identity', () => {
    const pkg = avgNativePackage()
    for (const change of [
      (value: typeof pkg) => { value.narrative.beats[0].text = '篡改文本' },
      (value: typeof pkg) => { value.definition.initialVariables = {} },
      (value: typeof pkg) => { value.definition.enabledCapabilities = ['narrative'] },
      (value: typeof pkg) => { value.narrative.choices[0].effectsJson = '[]' },
    ]) { const value = structuredClone(pkg); change(value); expect(() => parseProductRuntimePackageV2(value)).toThrow() }
    const scripts = avgNativeScripts(); scripts[0].choices[0].actionKey = 'unknown'
    expect(() => compileAvgExecutablePackageV2({ product: { key: 'test', title: 'test', description: '' }, sourceWorld: pkg.sourceWorld,
      systemPlan: avgSystemFixture(), scripts, stage: { version: 1, cues: [], assets: [] }, aspectRatio: '16:9' })).toThrow(/选择/)
  })
  it('keeps expression wording and revisions separate from rule identity', () => {
    const scripts = avgNativeScripts(); scripts[0].choices[0].text = '仔细看看封口'
    const pkg = compileAvgExecutablePackageV2({ product: { key: 'test', title: 'test', description: '' }, sourceWorld: legacyPackage().sourceWorld,
      systemPlan: avgSystemFixture(), scripts, scriptRevisions: { desk: 2, wait: 1, handover: 1 }, stage: { version: 1, cues: [], assets: [] }, aspectRatio: '4:3' })
    expect(pkg.narrative.choices[0].text).toBe('仔细看看封口')
    expect(pkg.narrative.choices[0].choiceKey).toBe('inspect')
    expect(avgExecutableModule(pkg)?.lines[0].textRevision).toBe(2)
    expect(avgExecutableModule(pkg)?.systemPlan.actions[0].label).toBe('检查封口')
  })
  it('pins every native stage asset to exactly one physical Build binding', async () => {
    const pkg = avgNativePackage(), module = avgExecutableModule(pkg)!
    const asset = { assetKey: 'background.test', version: 1, kind: 'background' as const, name: '原创测试像素', mimeType: 'image/png',
      byteSize: 68, width: 1, height: 1, durationMs: null, contentHash: 'c'.repeat(64), blobContentHash: 'c'.repeat(64),
      source: 'original engineering fixture', license: 'CC0', altText: '测试背景', characterTag: '', sceneTag: 'desk' }
    module.stage.assets = [asset]
    module.stage.cues = [{ cueKey: 'background.test', beatKey: 'line.desk', type: 'set-background', assetKey: asset.assetKey,
      phase: 'before', durationMs: 0, order: 0, easing: 'linear' }]
    const runtimePackage = parseProductRuntimePackageV2(pkg)
    const base = { productionKey: 'test', buildNumber: 1, buildManifestHash: 'a'.repeat(64), runtimePackage }
    await expect(createProductBuildPreviewManifestV2(base)).rejects.toThrow(/绑定/)
    const binding = { assetKey: asset.assetKey, artifactKey: 'avg.media.0', blobContentHash: asset.blobContentHash }
    expect((await createProductBuildPreviewManifestV2({ ...base, mediaBindings: [binding] })).mediaBindings).toEqual([binding])
    await expect(createProductBuildPreviewManifestV2({ ...base, mediaBindings: [{ ...binding, blobContentHash: 'd'.repeat(64) }] })).rejects.toThrow(/绑定/)
    const unknownCue = structuredClone(runtimePackage)
    ;(avgExecutableModule(unknownCue)!.stage.cues[0] as any).execute = 'arbitrary code'
    expect(() => parseProductRuntimePackageV2(unknownCue)).toThrow(/未知字段/)
    const invalidSnapshot = structuredClone(runtimePackage)
    avgExecutableModule(invalidSnapshot)!.stage.cues.push({ cueKey: 'bad.snapshot', beatKey: 'line.desk', type: 'restore-snapshot', snapshotKey: 'constructor', phase: 'before', order: 1, durationMs: 0, easing: 'linear' })
    expect(() => parseProductRuntimePackageV2(invalidSnapshot)).toThrow(/snapshotKey/)
  })
  it('rejects dynamic effect overflow without appending a partial command or changing state', async () => {
    const plan = avgSystemFixture(); plan.actions[0].effects.push({ op: 'increment', path: 'avg.variables.attempts', value: 2 })
    const s = await seedAvgNativePreview(plan)
    const session = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: '范围约束', productSource: { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash } })
    await readLine(session.id!, 'line.desk', 'read.before.overflow')
    const before = await readProductRuntimeState(session.id!), events = await db.productRuntimeEvents.count()
    await expect(choose(session.id!, 'inspect')).rejects.toThrow(/attempts/)
    expect(await readProductRuntimeState(session.id!)).toEqual(before)
    expect(await db.productRuntimeEvents.count()).toBe(events)
  })
  it('uses canonical replay instead of trusting a rehashed derived cache and rejects corrupted initial rules', async () => {
    const s = await seedAvgNativePreview()
    const session = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: '缓存校验', productSource: { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash } })
    const actual = await readProductRuntimeState(session.id!)
    const forged = structuredClone(actual)
    ;(forged.narrative!.variables.avg as any).knowledge.player.seal = true
    const runtimeHeadStateJson = JSON.stringify(forged)
    const { hashStateJson } = await import('../../src/lib/product/runtime-core')
    await db.productRuntimeSessions.update(session.id!, { runtimeHeadStateJson, runtimeHeadStateHash: await hashStateJson(runtimeHeadStateJson), runtimeHeadSequence: actual.lastSequence })
    expect(await readProductRuntimeState(session.id!)).toEqual(actual)
    const initial = JSON.parse(session.initialStateJson); initial.avgRules.systemPlan.title = '篡改来源'
    await db.productRuntimeSessions.update(session.id!, { initialStateJson: JSON.stringify(initial) })
    await expect(readProductRuntimeState(session.id!)).rejects.toThrow(/冻结来源/)
    await expect(exportProjectJSON(s.scope.projectId)).rejects.toThrow(/冻结来源/)
  })
  it('refuses deleted or replaced native rules on import before creating any project', async () => {
    const s = await seedAvgNativePreview()
    const session = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: '导入防护', productSource: { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash } })
    expect((await verifyProductRuntimeSessionSourceV1({scope:s.scope,session})).runtimePackage.version).toBe(2)
    expect(JSON.parse(session.canonSnapshotJson)).toMatchObject({schema:'storyforge.product-runtime-source',version:2,
      sourceManifest:{readMode:'frozen-product-package',directWorldReads:[]}})
    const snapshot = await exportProjectJSON(s.scope.projectId), count = await db.projects.count()
    for (const mode of ['delete','replace']) {
      const forged = structuredClone(snapshot)
      const row = forged.productRuntimeSessions![0]
      const initial = JSON.parse(row.initialStateJson)
      if (mode === 'delete') delete initial.avgRules
      else initial.avgRules.systemPlan.title = '别的规则'
      row.initialStateJson = JSON.stringify(initial)
      await expect(importProjectJSON(forged)).rejects.toThrow(/冻结来源/)
      expect(await db.projects.count()).toBe(count)
    }
    const initial = JSON.parse(session.initialStateJson); delete initial.avgRules
    await db.productRuntimeSessions.update(session.id!, { initialStateJson: JSON.stringify(initial) })
    await expect(readProductRuntimeState(session.id!)).rejects.toThrow(/冻结来源/)
  })
  it('rejects a legacy native release with both its initial rules and mutable native hint removed despite an intact cached head', async () => {
    const s=await seedAvgNativeRelease()
    const session=await createProductRuntimeInstance({scope:s.scope,kind:'avg',title:'旧版原生缓存守门',productSource:{kind:'release',productReleaseId:s.id}})
    const initial=JSON.parse(session.initialStateJson),canon=JSON.parse(session.canonSnapshotJson)
    delete initial.avgRules;delete canon.packageVersion
    await db.productRuntimeSessions.update(session.id!,{initialStateJson:JSON.stringify(initial),canonSnapshotJson:JSON.stringify(canon)})
    await expect(readProductRuntimeState(session.id!)).rejects.toThrow(/冻结来源/)
  })

  it('runs an actual bound Build preview, stops premature/unavailable choices, saves a repeated visit and restores through backup', async () => {
    const s = await seedAvgNativePreview()
    const session = await createProductRuntimeInstance({ scope: s.scope, kind: 'avg', title: '原生 V2', productSource: { kind: 'build', productBuildId: s.buildId, expectedPreviewHash: s.preview.previewHash } })
    const id = session.id!
    const initialBase = await readProductRuntimeStateVersion(id)
    await expect(reachAvgPresentationBeat({ sessionId: id, beatKey: 'line.desk', commandId: 'invalid.snapshot', baseSequence: initialBase.sequence, baseStateHash: initialBase.stateHash, snapshotKey: '__proto__' })).rejects.toThrow(/snapshotKey/)
    await expect(choose(id, 'inspect')).rejects.toThrow(/读完/)
    await readLine(id, 'line.desk', 'read.first')
    expect((await readProductRuntimeState(id)).presentation?.stage.tone).toBe('night')
    await choose(id, 'inspect')
    const after = await readProductRuntimeState(id)
    expect(after.narrative?.visitedNodeKeys).toEqual(['desk','desk'])
    expect(after.narrative?.variables).toMatchObject({ avg: { knowledge: { player: { seal: true }, keeper: { seal: false } } } })
    expect(after.presentation?.currentBeatKey).toBeNull()
    const checkpoint = await createProductRuntimeCheckpoint({ sessionId: id, name: '检查后的存档' })
    const child = await branchProductRuntimeSession({ parentSessionId: id, throughSequence: checkpoint.throughSequence, title: '恢复分支' })
    const childId = child.id!
    await readLine(childId, 'line.desk', 'read.restored')
    await expect(choose(childId, 'inspect')).rejects.toThrow(/不可用/)
    await choose(childId, 'share')
    expect((await readProductRuntimeState(childId)).narrative?.endingKey).toBe('handover')
    expect((await readProductRuntimeState(id)).narrative?.completed).toBe(false)
    const importedId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const sessions = await db.productRuntimeSessions.where('projectId').equals(importedId).toArray()
    expect(sessions).toHaveLength(2)
    const restored = sessions.find(row => row.parentSessionId != null)!
    expect((await readProductRuntimeState(restored.id!)).narrative?.endingKey).toBe('handover')
    await deleteWork(importedId, restored.workId!)
    expect(await db.productRuntimeSessions.where('projectId').equals(importedId).count()).toBe(0)
    expect(await db.productRuntimeSessions.get(id)).toBeDefined()
  })
  it('starts a native immutable Release through the existing AVG entry and restores its release-bound save', async () => {
    const s = await seedAvgNativeRelease()
    const session = await createAvgGameInstance({ scope: s.scope, productReleaseId: s.id, title: '发布存档' })
    expect(session.productReleaseId).toBe(s.id)
    expect(session.runtimeSourceHash).toBe(s.release.packageHash)
    await readLine(session.id!, 'line.desk', 'release.read')
    await choose(session.id!, 'wait')
    const before = await readProductRuntimeState(session.id!)
    expect(before.narrative?.endingKey).toBe('wait')
    const importedId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const restored = (await db.productRuntimeSessions.where('projectId').equals(importedId).first())!
    expect(restored.productReleaseId).not.toBe(s.id)
    expect(restored.runtimeSourceHash).toBe(s.release.packageHash)
    expect((await readProductRuntimeState(restored.id!)).narrative).toEqual(before.narrative)
  })
})
