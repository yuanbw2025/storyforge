import { db } from '../../src/lib/db/schema'
import { seedAvgAuthorSystem, stageAvgAuthorSystem } from './avg-author-system-fixture'
import { avgSystemFixture } from './avg-system-fixture'
import { authorFixtureCommand } from './avg-author-artifact-fixture'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { stageAvgAuthorArtifactV1 } from '../../src/lib/avg/author-artifacts'
import { compileConfirmedAvgBuildV2, compileAvgExecutablePackageV2 } from '../../src/lib/avg/executable-compiler'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { createProductBuildPreviewManifestV2 } from '../../src/lib/product-production/preview-manifest'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { legacyPackage } from './avg-carrier-fixture'
import { fixture as carrierFixture } from './avg-carrier-fixture'
import { createAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { createProductReleaseManifestV2, productReleaseIdentityHashV2 } from '../../src/lib/product-production/runtime-package'
import { createProductReleaseLineageV1, productReleaseUidV1 } from '../../src/lib/product/source-contracts'
import type { FrozenRuntimeMediaAssetV2 } from '../../src/lib/types'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { acceptProductBuildArtifact } from '../../src/lib/product-production/artifact-store'
import type { AvgSystemPlan } from '../../src/lib/avg/system-contract'
import type { AvgSceneScriptV1 } from '../../src/lib/avg/artifact-contract'

export function avgNativeScripts(plan: AvgSystemPlan = avgSystemFixture()): AvgSceneScriptV1[] {
  return plan.scenes.map(scene => ({ schema: 'storyforge.avg.scene-script', version: 1, sceneKey: scene.key,
    lines: [{ lineKey: `line.${scene.key}`, beatKey: `line.${scene.key}`, speakerKey: scene.key === 'desk' ? 'keeper' : null,
      text: scene.key === 'desk' ? '封口仍在。' : scene.key === 'wait' ? '你把信封放回桌上。' : '保管员收下信封。', informationKeys: [], actionKeys: [] }],
    choices: plan.actions.filter(action => action.fromSceneKey === scene.key).map(action => ({ choiceKey: action.key, actionKey: action.key, text: action.label })) }))
}
export function avgNativePackage() {
  return compileAvgExecutablePackageV2({ product: { key: 'fixture.native', title: '规则与舞台试验', description: '原创工程测试场景' }, sourceWorld: legacyPackage().sourceWorld,
    systemPlan: avgSystemFixture(), scripts: avgNativeScripts(), stage: { version: 1, cues: [], assets: [] }, aspectRatio: '16:9' })
}

/** Controlled preparation of a real AVG Work/start/author receipt closure.
 * The final Preview freeze is fixture-only, not a claim of a live new planner. */
export async function seedAvgNativePreview(systemPlan: AvgSystemPlan = avgSystemFixture(), media: Array<{ asset: FrozenRuntimeMediaAssetV2; data: ArrayBuffer }> = []) {
  const s = await seedAvgAuthorSystem()
  const rule = s.plan.tasks[0]
  const tasks = [rule, ...avgNativeScripts(systemPlan).map(script => ({ ...rule, taskKey: `script.${script.sceneKey}`, lane: 'content' as const,
    kind: 'avg-author-scene-script', outputArtifactKeys: [`avg.content.scene-script.${script.sceneKey}`],
    subjectLockKeys: [`avg.content.scene-script.${script.sceneKey}`], dependsOn: [rule.taskKey], requiredReceipts: [{ taskKey: rule.taskKey, receiptHash: null }], inputArtifactKeys: ['avg.system.plan'] }))]
  for (const [index] of media.entries()) tasks.push({ ...rule, taskKey: `media.${index}`, lane: 'visual', kind: 'fixture-original-media', outputArtifactKeys: [`avg.media.${index}`], subjectLockKeys: [`avg.media.${index}`], dependsOn: [rule.taskKey], requiredReceipts: [{ taskKey: rule.taskKey, receiptHash: null }], inputArtifactKeys: ['avg.system.plan'] })
  const join = { ...rule, taskKey: 'fixture.join', lane: 'integration' as const, executionMode: 'deterministic' as const,
    outputArtifactKeys: ['fixture.join'], subjectLockKeys: ['fixture.join'], dependsOn: tasks.slice(1).map(task => task.taskKey),
    requiredReceipts: tasks.slice(1).map(task => ({ taskKey: task.taskKey, receiptHash: null })), inputArtifactKeys: tasks.map(task => task.outputArtifactKeys[0]) }
  const build = (await db.productBuilds.get(s.buildId))!
  const brief = (await db.productProductionBriefs.where('productionId').equals(s.productionId).first())!
  const plan = parseProductProductionPlanV3({ ...s.plan, tasks: [...tasks, join], terminalTaskKey: join.taskKey }, parseProductProductionBriefV3(brief.briefJson), build.briefHash)
  await db.productBuilds.update(s.buildId, { planJson: canonicalProductProductionJsonV2(plan), planHash: await hashProductProductionValueV2(plan) })
  const rules = await stageAvgAuthorSystem(s, systemPlan)
  const adopt = async (candidate: typeof rules) => {
    const result = await executeProductProductionCommand({ scope: s.scope, productionId: s.productionId, command: await authorFixtureCommand(s, candidate) })
    if (!result.ok) throw new Error(JSON.stringify(result.result))
  }
  await adopt(rules)
  for (const script of avgNativeScripts(systemPlan)) {
    const latest = (await db.productBuilds.get(s.buildId))!
    await adopt(await stageAvgAuthorArtifactV1({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: latest.stateRevision,
      controlEpoch: latest.controlEpoch, taskKey: `script.${script.sceneKey}`, artifactKey: `avg.content.scene-script.${script.sceneKey}`,
      kind: 'narrative', payload: script, declaration: '作者原创测试句；工程场景，不是文学/商业验收' }))
  }
  for (const [index, { asset, data }] of media.entries()) {
    const blob = await putMediaBlobObject({ scope: s.scope, data, mimeType: asset.mimeType, expectedContentHash: asset.contentHash, backend: 'indexeddb', sanitizedSvg: true })
    await acceptProductBuildArtifact({ scope: s.scope, buildId: s.buildId, controlEpoch: build.controlEpoch, artifactKey: `avg.media.${index}`, kind: 'image', mediaKind: asset.kind, payload: { assetKey: asset.assetKey }, metadata: asset, inputHash: await hashProductProductionValueV2(asset), contentHash: blob.contentHash, blobObjectId: blob.id!, mimeType: blob.mimeType, byteSize: blob.byteSize, rights: { origin: 'original-fixture', license: asset.license } })
  }
  const latest = (await db.productBuilds.get(s.buildId))!
  const compiled = await compileConfirmedAvgBuildV2({ scope: s.scope, buildId: s.buildId, expectedBuildRevision: latest.stateRevision,
    controlEpoch: latest.controlEpoch, product: { key: 'avg.author.fixture', title: '规则与舞台试验', description: '原创工程测试场景' },
    stage: { version: 1, cues: [{ cueKey: 'tone.desk', beatKey: 'line.desk', type: 'set-tone', tone: 'night', phase: 'before', durationMs: 0, order: 0, easing: 'linear' }], assets: media.map(m => m.asset) }, aspectRatio: '16:9' })
  const manifestHash = await hashProductProductionValueV2({ fixture: 'author-inputs', source: compiled.source })
  const preview = await createProductBuildPreviewManifestV2({ runtimePackage: compiled.runtimePackage,
    productionKey: 'avg.author.fixture', buildNumber: latest.buildNumber, buildManifestHash: manifestHash, mediaBindings: media.map((m, index) => ({ assetKey: m.asset.assetKey, artifactKey: `avg.media.${index}`, blobContentHash: m.asset.blobContentHash })) })
  await db.productBuilds.update(s.buildId, { status: 'preview-ready', manifestHash, previewManifestJson: canonicalProductProductionJsonV2(preview), previewHash: preview.previewHash, packageHash: preview.packageHash })
  return { ...s, plan, preview, runtimePackage: compiled.runtimePackage }
}

/** Structural imported-release fixture, separate from production acceptance. */
export async function seedAvgNativeRelease() {
  const f = await carrierFixture(), owner = await createAvgDraftV1('原生 AVG 发布运行隔离')
  const { productionProvenance, sourceContracts } = f.release
  const runtimePackage = compileAvgExecutablePackageV2({ product: { key: productionProvenance.productionKey, title: '原生发布试验', description: '结构与运行夹具' },
    sourceWorld: f.runtimePackage.sourceWorld, systemPlan: avgSystemFixture(), scripts: avgNativeScripts(), stage: { version: 1, cues: [], assets: [] }, aspectRatio: '16:9' })
  const body = { schema: 'storyforge.product-release' as const, version: 2 as const, productType: 'avg' as const,
    sourceWorldRelease: f.release.sourceWorldRelease, runtimePackage, packageHash: await hashProductProductionValueV2(runtimePackage), productionProvenance, sourceContracts }
  const releaseHash = await productReleaseIdentityHashV2(body)
  const { sourcePlan, confirmedBrief, sourceManifest } = sourceContracts
  const lineage = await createProductReleaseLineageV1({ productType: 'avg', productInstanceKey: sourcePlan.productInstanceKey,
    releaseUid: productReleaseUidV1({ productType: 'avg', productInstanceKey: sourcePlan.productInstanceKey, releaseVersion: 1, releaseHash }),
    releaseVersion: 1, releaseHash, parentRelease: null, worldReference: sourcePlan.worldReference, sourcePlan, confirmedBrief, sourceManifest,
    build: f.release.lineage.build, quality: f.release.lineage.quality, compatibility: f.release.lineage.compatibility, createdAt: f.release.lineage.createdAt })
  const release = await createProductReleaseManifestV2({ runtimePackage, productionProvenance, sourceContracts, lineage })
  const id = await db.productReleases.add({ ...owner.scope, productionKey: productionProvenance.productionKey, productType: 'avg', worldReleaseId: null,
    version: 1, label: '原生发布结构试验', manifestJson: canonicalProductProductionJsonV2(release), contentHash: await hashProductProductionValueV2(release), createdAt: Date.now() }) as number
  return { ...owner, id, release }
}
