import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { scopeTransactionTables } from '../../src/lib/workspace/scope'
import { DEFAULT_AVG_SETTINGS, parseAvgAuthoringSettingsV1 } from '../../src/lib/avg/authoring-contract'
import { deriveAvgAuthoringSettingsV2, parseAvgAuthoringSettings, parseAvgSettingsForLegacyProduction } from '../../src/lib/avg/settings-v2'
import { parseAvgConsumerV1, parseAvgMediaBindingV1, parseAvgPresentationContentV2, parseAvgRuntimeModuleV1 } from '../../src/lib/avg/runtime-contract-v2'
import { AVG_PROFESSIONAL_OUTPUTS_V1, applyAvgDialoguePatchV1, avgProfessionalOutputForKeyV1, parseAvgProfessionalArtifactV1, prepareAvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'
import { assertAvgProfessionalArtifactAdmissionV1 } from '../../src/lib/avg/artifact-admission'
import { acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import { parseProductRuntimePackageV2, verifyProductReleaseManifest } from '../../src/lib/product-production/runtime-package'
import { verifyProductBuildPreviewManifest } from '../../src/lib/product-production/preview-manifest'
import { hashProductProductionValueV2, canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { createReleasedProductRuntimeSession } from '../../src/lib/product/runtime-core'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { fixture, seedBuild } from '../helpers/avg-carrier-fixture'
import { AVG_SCRIPT, PROFESSIONAL_FIXTURES, avgModule, avgCarrierWithModule, binding } from '../helpers/avg-private-contract-fixture'

describe('AVG-BASE-00B · private carrier validation and closed professional admission', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('explicitly derives an inert V2 proposal, preserves V1 bytes and keeps voice off', async () => {
    const original = JSON.stringify(DEFAULT_AVG_SETTINGS)
    const settings = await deriveAvgAuthoringSettingsV2(DEFAULT_AVG_SETTINGS)
    expect(parseAvgAuthoringSettings(JSON.stringify(settings))).toEqual(settings)
    expect(JSON.stringify(DEFAULT_AVG_SETTINGS)).toBe(original)
    expect(parseAvgAuthoringSettings(DEFAULT_AVG_SETTINGS)).toEqual(parseAvgAuthoringSettingsV1(DEFAULT_AVG_SETTINGS))
    expect(settings.presentation.voice).toBe('off')
    expect(settings.investment.batch.modelCalls).toBe(0)
    expect(settings.derivedFrom?.settingsHash).toBe(await hashProductProductionValueV2(DEFAULT_AVG_SETTINGS))
    expect(() => parseAvgSettingsForLegacyProduction(settings)).toThrow(/不得降级/)
    expect(parseAvgSettingsForLegacyProduction(DEFAULT_AVG_SETTINGS)).toEqual(DEFAULT_AVG_SETTINGS)
    expect((await deriveAvgAuthoringSettingsV2({ ...DEFAULT_AVG_SETTINGS, targetEndingCount: 1, visualLevel: 'none' })).storyMode).toBe('linear')
  })
  it('supports explicit no aggregate ceiling while retaining finite batches and strict desired scope', async () => {
    const settings = await deriveAvgAuthoringSettingsV2(DEFAULT_AVG_SETTINGS)
    settings.investment.batch = { modelCalls: 20, mediaCalls: 4, inputTokens: 100000, outputTokens: 16000, durationMs: 600000, maxAttempts: 2 }
    expect(parseAvgAuthoringSettings(settings)).toEqual(settings)
    for (const invalid of [ { ...settings, version: 3 }, { ...settings, ready: true },
      { ...settings, modules: [...settings.modules, ...settings.modules] },
      { ...settings, modules: [...settings.modules, { name: 'evidence', version: 1 }] },
      { ...settings, viewpoint: { ...settings.viewpoint, perspective: 'first-person' } },
      { ...settings, delivery: { ...settings.delivery, devices: [] } },
      { ...settings, delivery: { ...settings.delivery, textLocale: 'en' } },
      { ...settings, investment: { ...settings.investment, batch: { ...settings.investment.batch, maxAttempts: Infinity } } } ]) {
      expect(() => parseAvgAuthoringSettings(invalid)).toThrow()
    }
    expect(() => parseAvgAuthoringSettings([])).toThrow()
    expect(() => parseAvgAuthoringSettings({ ...settings, investment: { ...settings.investment, totalCostUsd: -1 } })).toThrow()
  })
  it('keeps observed reference metadata separate from readiness and rejects unknown reference/version fields', async () => {
    const settings = await deriveAvgAuthoringSettingsV2(DEFAULT_AVG_SETTINGS)
    settings.qualityTarget.references = [{ title: 'Research fixture', platform: 'PC', releaseVersion: '1', locale: 'zh-CN', sceneLocator: 'scene1', sourceUrl: 'https://example.org/authorized', observation: 'text' }]
    settings.investment.totalCostUsd = 10; settings.investment.manualHours.writing = 2
    settings.viewpoint = { perspective: 'third-person-limited', anchorSubjectKey: 'lin', allowSwitch: false }
    expect(parseAvgAuthoringSettings(settings)).toEqual(settings)
    expect(() => parseAvgAuthoringSettings({ ...settings, derivedFrom: { ...settings.derivedFrom, version: 2 } })).toThrow()
    expect(() => parseAvgAuthoringSettings({ ...settings, qualityTarget: { ...settings.qualityTarget, references: [{ ...settings.qualityTarget.references[0], sourceUrl: 'file:///private' }] } })).toThrow()
  })

  it.each(PROFESSIONAL_FIXTURES)('prepares the closed $key schema without gaining writer authority', async ({ key, payload }) => {
    const kind = payload.schema.endsWith('review-issues') ? 'quality-report' : 'narrative'
    const prepared = prepareAvgProfessionalArtifactV1({ artifactKey: key, kind, payload, allowedOutputKeys: [key] })
    expect(parseAvgProfessionalArtifactV1(prepared.payloadJson)).toEqual(payload)
    expect(() => prepareAvgProfessionalArtifactV1({ artifactKey: key, kind, payload, allowedOutputKeys: [] })).toThrow(/冻结写域/)
    expect(() => assertAvgProfessionalArtifactAdmissionV1({ productType: 'avg', artifactKey: key, kind, payload, metadata: {} })).toThrow(/采用尚未就绪/)
    expect(() => parseAvgProfessionalArtifactV1({ ...payload, passed: true })).toThrow(/未知字段/)
  })
  it('reserves 22 unique role/Skill/output families and rejects arbitrary, wrong-role and unimplemented payloads', () => {
    expect(new Set(AVG_PROFESSIONAL_OUTPUTS_V1.map(row => row[0])).size).toBe(22)
    expect(new Set(AVG_PROFESSIONAL_OUTPUTS_V1.map(row => row[1])).size).toBe(22)
    expect(new Set(AVG_PROFESSIONAL_OUTPUTS_V1.map(row => row[2])).size).toBe(22)
    for (const role of AVG_PROFESSIONAL_OUTPUTS_V1) expect(avgProfessionalOutputForKeyV1(role[2].endsWith('.') ? role[2] + 'fixture' : role[2])).toEqual(role)
    expect(() => avgProfessionalOutputForKeyV1('avg.content.arbitrary')).toThrow()
    expect(() => avgProfessionalOutputForKeyV1('bad key')).toThrow()
    expect(() => parseAvgProfessionalArtifactV1({ schema: 'storyforge.avg.system-plan', version: 1 })).toThrow(/尚未就绪/)
    expect(() => parseAvgProfessionalArtifactV1({ ...AVG_SCRIPT, version: 2 })).toThrow()
    expect(() => prepareAvgProfessionalArtifactV1({ artifactKey: 'avg.content.scene-script.other', kind: 'narrative', payload: AVG_SCRIPT, allowedOutputKeys: ['avg.content.scene-script.other'] })).toThrow(/场景/)
    expect(() => prepareAvgProfessionalArtifactV1({ artifactKey: 'avg.content.story-bible', kind: 'narrative', payload: AVG_SCRIPT, allowedOutputKeys: ['avg.content.story-bible'] })).toThrow(/岗位/)
    expect(() => prepareAvgProfessionalArtifactV1({ artifactKey: 'avg.content.scene-script.archive', kind: 'image', payload: AVG_SCRIPT, allowedOutputKeys: ['avg.content.scene-script.archive'] })).toThrow(/kind/)
  })
  it('rejects cyclic recommendations, duplicate character sources, invalid beat identity and forged review certification', () => {
    const plan = PROFESSIONAL_FIXTURES[0].payload
    expect(() => parseAvgProfessionalArtifactV1({ ...plan, dependencySuggestions: [
      { outputKey: 'avg.content.story-bible', inputKeys: ['avg.content.cast-bible'] },
      { outputKey: 'avg.content.cast-bible', inputKeys: ['avg.content.story-bible'] },
    ] })).toThrow(/cycle/)
    const cast = PROFESSIONAL_FIXTURES[3].payload
    if (cast.schema !== 'storyforge.avg.cast-bible') throw new Error('fixture')
    expect(() => parseAvgProfessionalArtifactV1({ ...cast, characters: [cast.characters[0], { ...cast.characters[0], characterKey: 'another' }] })).toThrow(/source character/)
    expect(() => parseAvgProfessionalArtifactV1({ ...AVG_SCRIPT, lines: [{ ...AVG_SCRIPT.lines[0], beatKey: 'other' }] })).toThrow(/同一 key/)
    expect(() => parseAvgProfessionalArtifactV1({ ...PROFESSIONAL_FIXTURES[7].payload, humanAccepted: true })).toThrow(/未知字段/)
    expect(() => parseAvgProfessionalArtifactV1({ ...PROFESSIONAL_FIXTURES[4].payload, storyMode: 'linear', routes: [] })).toThrow()
  })
  it('applies expression changes atomically to a new script candidate, preserving all rule/knowledge/identity fields', async () => {
    const baseScriptHash = await hashProductProductionValueV2(AVG_SCRIPT)
    const patch = { schema: 'storyforge.avg.dialogue-patch', version: 1, sceneKey: AVG_SCRIPT.sceneKey, baseScriptHash, changes: [
      { targetKey: AVG_SCRIPT.lines[0].lineKey, field: 'text', oldValueHash: await hashProductProductionValueV2(AVG_SCRIPT.lines[0].text), newText: '别急，封口还在。', reason: '让回应贴近当下动作' },
      { targetKey: AVG_SCRIPT.choices[0].choiceKey, field: 'choiceText', oldValueHash: await hashProductProductionValueV2(AVG_SCRIPT.choices[0].text), newText: '等收信人回来', reason: '明确行动代价' },
    ] }
    const result = await applyAvgDialoguePatchV1(AVG_SCRIPT, patch)
    expect(result.script.lines[0]).toEqual({ ...AVG_SCRIPT.lines[0], text: '别急，封口还在。' })
    expect(result.script.choices[0].actionKey).toBe(AVG_SCRIPT.choices[0].actionKey)
    expect(AVG_SCRIPT.lines[0].text).toBe('信封还没打开。')
    expect(result.lineage.baseScriptHash).toBe(baseScriptHash)
    expect(result.scriptHash).not.toBe(baseScriptHash)
    await expect(applyAvgDialoguePatchV1(result.script, patch)).rejects.toThrow(/stale/)
    await expect(applyAvgDialoguePatchV1(AVG_SCRIPT, { ...patch, changes: [{ ...patch.changes[0], oldValueHash: 'a'.repeat(64) }] })).rejects.toThrow(/stale/)
    await expect(applyAvgDialoguePatchV1(AVG_SCRIPT, { ...patch, changes: [{ ...patch.changes[0], field: 'speakerKey' }] })).rejects.toThrow()
  })

  it('validates inventory/detail and precise voice binding contracts without certifying actual media bytes', () => {
    const icon = binding()
    expect(parseAvgMediaBindingV1(JSON.stringify(icon))).toEqual(icon)
    const detail = { ...icon, bindingKey: 'envelope.detail', consumer: { ...icon.consumer, domain: 'evidence', slot: 'detail' } }
    expect(parseAvgMediaBindingV1(detail).consumer.domain).toBe('evidence')
    const voice = { ...icon, family: { ...icon.family, subjectKey: 'lin' }, consumer: { ...icon.consumer,
      domain: 'dialogue', slot: 'voice', subjectKey: 'lin', sceneKey: 'archive', lineKey: 'line.envelope' },
      asset: { ...icon.asset, mimeType: 'audio/mpeg' }, voice: { textHash: 'c'.repeat(64), performanceHash: 'd'.repeat(64), durationMs: 1200 } }
    expect(parseAvgMediaBindingV1(voice).voice?.durationMs).toBe(1200)
    for (const invalid of [ { ...icon, version: 2 }, { ...icon, workId: 99 }, { ...icon, consumer: { ...icon.consumer, domain: 'stage' } },
      { ...icon, asset: { ...icon.asset, mimeType: 'audio/mpeg' } }, { ...icon, family: { ...icon.family, subjectKey: 'other' } },
      { ...voice, voice: null }, { ...voice, voice: { ...voice.voice, durationMs: 0 } } ]) expect(() => parseAvgMediaBindingV1(invalid)).toThrow()
    expect(() => parseAvgConsumerV1({ ...icon.consumer, fallback: 'text' })).toThrow()
    expect(() => parseAvgConsumerV1({ ...icon.consumer, required: false, fallback: 'silence' })).toThrow()
    expect(() => parseAvgConsumerV1({ ...icon.consumer, domain: 'reference', slot: 'identity' })).toThrow()
  })
  it('admits only registered structural AVG modules, pins lines to the shared narrative, and rejects duplicate consumers/unready effects', async () => {
    const f = await fixture(); const module = avgModule(f.runtimePackage)
    const pkg = { ...f.runtimePackage, modules: [module] }
    expect(parseProductRuntimePackageV2(pkg)).toEqual(pkg)
    expect(parseAvgRuntimeModuleV1(module)).toEqual(module)
    for (const invalid of [ { ...pkg, modules: [module, module] },
      { ...pkg, modules: [{ ...module, lines: [{ ...module.lines[0], text: 'changed' }] }] },
      { ...pkg, modules: [{ ...module, actions: [{ type: 'execute-js' }] }] },
      { ...pkg, modules: [{ ...module, capabilities: [{ name: 'inventory', version: 1, dependsOn: [] }] }] },
      { ...pkg, modules: [{ ...module, mediaBindings: [binding()] }] } ]) expect(() => parseProductRuntimePackageV2(invalid)).toThrow()
    const consumer = { ...binding().consumer, required: false }
    expect(() => parseAvgPresentationContentV2({ ...module.presentation, consumers: [consumer, consumer] })).toThrow(/重复/)
    expect(() => parseAvgPresentationContentV2({ ...module.presentation, consumers: [{ ...consumer, domain: 'marketing', slot: 'cover' }] })).toThrow(/宣传/)
    expect(() => parseAvgRuntimeModuleV1({ ...module, presentation: { ...module.presentation, consumers: [consumer] } })).toThrow(/主体不存在/)
  })
  it('round-trips the new module through immutable Preview and registry backup while runtime admission stays closed', async () => {
    const s = await seedBuild(); const { release, preview } = await avgCarrierWithModule()
    expect(await verifyProductBuildPreviewManifest(preview)).toEqual(preview)
    expect(await verifyProductReleaseManifest(release)).toEqual(release)
    await db.productBuilds.update(s.buildId, { previewManifestJson: canonicalProductProductionJsonV2(preview), previewHash: preview.previewHash, packageHash: preview.packageHash })
    await db.productReleases.update(s.id, { manifestJson: canonicalProductProductionJsonV2(release), contentHash: await hashProductProductionValueV2(release) })
    const serialized = await exportProjectJSON(s.scope.projectId)
    const imported = await importProjectJSON(serialized)
    const importedBuild = await db.productBuilds.where('projectId').equals(imported).first()
    expect(importedBuild?.previewManifestJson).toBe(canonicalProductProductionJsonV2(preview))
    expect((await db.productReleases.where('projectId').equals(imported).first())?.manifestJson).toBe(canonicalProductProductionJsonV2(release))
    await expect(createReleasedProductRuntimeSession({ ...s.scope, productReleaseId: s.id,
      origin: 'release', kind: 'avg', title: 'Closed carrier' })).rejects.toThrow(/V2/)
    expect(await db.productRuntimeSessions.count()).toBe(0)
    expect(release.version).toBe(2)
  })
  it('closes both wrapper and direct legacy adoption routes, rejects cross-product/Work and schema laundering with zero writes', async () => {
    const s = await seedBuild()
    const input = { scope: s.scope, buildId: s.buildId, controlEpoch: 1, artifactKey: 'avg.content.scene-script.archive',
      kind: 'narrative' as const, payload: AVG_SCRIPT, inputHash: 'a'.repeat(64) }
    await expect(acceptProductBuildArtifact(input)).rejects.toThrow(/采用尚未就绪/)
    const legacyStore = await import('../../src/lib/product-production/text-adventure-artifact-store')
    await expect(legacyStore.acceptProductBuildArtifact({ ...input, artifactKey: 'runtime.narrative' })).rejects.toThrow(/未登记/)
    await db.productProductions.update(s.productionId, { productType: 'text-adventure' })
    await expect(acceptProductBuildArtifact(input)).rejects.toThrow(/跨产品/)
    await db.productProductions.update(s.productionId, { workId: s.scope.workId + 99 })
    await expect(acceptProductBuildArtifact(input)).rejects.toThrow(/跨 Work/)
    expect(await db.productBuildArtifacts.count()).toBe(0)
  })
  it('preserves the legacy transaction table closure and rejects sparse consumer catalogs', async () => {
    const s = await seedBuild()
    const legacyStore = await import('../../src/lib/product-production/text-adventure-artifact-store')
    const artifact = await db.transaction('rw', scopeTransactionTables(db.productBuilds, db.productBuildArtifacts, db.mediaBlobObjects, db.agentRuns), () =>
      legacyStore.acceptProductBuildArtifact({ scope: s.scope, buildId: s.buildId, controlEpoch: 1,
        artifactKey: 'runtime.narrative', kind: 'narrative', payload: { legacy: true }, inputHash: 'a'.repeat(64) }))
    expect(artifact.status).toBe('accepted')
    expect(() => parseAvgPresentationContentV2({ schema: 'storyforge.avg.presentation', version: 2,
      aspectRatio: '16:9', consumers: new Array(1), cues: [] })).toThrow(/稀疏数组/)
  })
  it('preserves V1 numbered author media adoption while rejecting schema laundering through the same key', async () => {
    const s = await seedBuild()
    const data = new Uint8Array([137, 80, 78, 71]).buffer
    const bytes = await crypto.subtle.digest('SHA-256', data)
    const contentHash = Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
    const now = Date.now()
    const blobObjectId = await db.mediaBlobObjects.add({ ...s.scope, contentHash, mimeType: 'image/png', byteSize: data.byteLength,
      backend: 'indexeddb', storageState: 'ready', data, opfsPath: null, leaseOwner: null, leaseExpiresAt: null,
      lastVerifiedAt: now, createdAt: now, updatedAt: now }) as number
    const input = { scope: s.scope, buildId: s.buildId, controlEpoch: 1, artifactKey: 'avg.media.0', kind: 'image' as const,
      mediaKind: 'background' as const, payload: { assetKey: 'author.background' }, metadata: { assetKey: 'author.background' },
      inputHash: 'a'.repeat(64), contentHash, blobObjectId, mimeType: 'image/png', byteSize: data.byteLength }
    expect((await acceptProductBuildArtifact(input)).status).toBe('accepted')
    await expect(acceptProductBuildArtifact({ ...input, payload: AVG_SCRIPT })).rejects.toThrow(/未登记/)
    expect(await db.productBuildArtifacts.count()).toBe(1)
  })
})
