import type { AvgRuntimeModuleV1, AvgMediaBindingV1 } from '../../src/lib/avg/runtime-contract-v2'
import type { AvgSceneScriptV1, AvgProfessionalArtifactV1 } from '../../src/lib/avg/artifact-contract'
import type { ProductRuntimePackageV2 } from '../../src/lib/types'
import { fixture } from './avg-carrier-fixture'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { createProductReleaseManifestV2, productReleaseIdentityHashV2 } from '../../src/lib/product-production/runtime-package'
import { createProductBuildPreviewManifestV2 } from '../../src/lib/product-production/preview-manifest'
import { createProductReleaseLineageV1, productReleaseUidV1 } from '../../src/lib/product/source-contracts'

export const AVG_SCRIPT: AvgSceneScriptV1 = {
  schema: 'storyforge.avg.scene-script', version: 1, sceneKey: 'archive',
  lines: [{ lineKey: 'line.envelope', beatKey: 'line.envelope', speakerKey: 'lin', text: '信封还没打开。', informationKeys: ['sealed'], actionKeys: [] }],
  choices: [{ choiceKey: 'choice.wait', text: '先放回去', actionKey: 'wait' }],
}
export function avgModule(pkg: ProductRuntimePackageV2): AvgRuntimeModuleV1 {
  const characters = [...new Set(pkg.narrative.beats.flatMap(beat => beat.speakerKey ? [beat.speakerKey] : []))]
  return { schema: 'storyforge.avg.runtime-module', version: 1, storyMode: pkg.narrative.choices.length ? 'branching' : 'linear',
    capabilities: [{ name: 'narrative', version: 1, dependsOn: [] }],
    subjects: characters.map(key => ({ key, kind: 'character', displayName: key })),
    lines: pkg.narrative.beats.map(beat => ({ lineKey: beat.beatKey, sceneKey: beat.nodeKey, speakerKey: beat.speakerKey,
      text: beat.text, textRevision: 1, locale: 'zh-CN' })),
    stateDefinitions: [], actions: [], transitions: [], presentation: { schema: 'storyforge.avg.presentation', version: 2, aspectRatio: '16:9', consumers: [], cues: [] },
    mediaBindings: [], progressPolicy: 'off', assistPolicy: 'off' }
}
export async function avgCarrierWithModule() {
  const f = await fixture()
  const runtimePackage = { ...f.runtimePackage, modules: [avgModule(f.runtimePackage)] }
  const { productionProvenance, sourceContracts } = f.release
  const body = { schema: 'storyforge.product-release' as const, version: 2 as const, productType: 'avg' as const,
    sourceWorldRelease: f.release.sourceWorldRelease, runtimePackage, packageHash: await hashProductProductionValueV2(runtimePackage), productionProvenance, sourceContracts }
  const releaseHash = await productReleaseIdentityHashV2(body)
  const { sourcePlan, confirmedBrief, sourceManifest } = sourceContracts
  const lineage = await createProductReleaseLineageV1({
    productType: 'avg', productInstanceKey: sourcePlan.productInstanceKey,
    releaseUid: productReleaseUidV1({ productType: 'avg', productInstanceKey: sourcePlan.productInstanceKey, releaseVersion: 1, releaseHash }),
    releaseVersion: 1, releaseHash, parentRelease: null, worldReference: sourcePlan.worldReference, sourcePlan, confirmedBrief, sourceManifest,
    build: f.release.lineage.build, quality: f.release.lineage.quality, compatibility: f.release.lineage.compatibility, createdAt: f.release.lineage.createdAt,
  })
  const release = await createProductReleaseManifestV2({ runtimePackage, productionProvenance, sourceContracts, lineage })
  const preview = await createProductBuildPreviewManifestV2({ runtimePackage, productionKey: f.preview.productionKey, buildNumber: 1, buildManifestHash: f.preview.buildManifestHash })
  return { runtimePackage, release, preview }
}
export function binding(): AvgMediaBindingV1 {
  return { schema: 'storyforge.avg.media-binding', version: 1, bindingKey: 'envelope.icon',
    requirement: { key: 'req.envelope', revision: 1, contentHash: 'a'.repeat(64) },
    family: { subjectKey: 'envelope', familyKey: 'envelope', variantKey: 'sealed', revision: 1 },
    consumer: { consumerKey: 'inventory.envelope', domain: 'inventory', slot: 'icon', subjectKey: 'envelope',
      sceneKey: null, lineKey: null, required: true, fallback: 'none' },
    locale: 'zh-CN', visibility: { requiredFactKeys: ['obtained'], stateKey: 'sealed' },
    layout: { anchor: 'center', scale: 1 },
    asset: { key: 'envelope.icon', blobHash: 'b'.repeat(64), mimeType: 'image/png', adoptionRevision: 1, processingRevision: 0, inputHashes: [] }, voice: null }
}
export const PROFESSIONAL_FIXTURES: Array<{ key: string; payload: AvgProfessionalArtifactV1 }> = [
  { key: 'avg.governance.production-plan', payload: { schema: 'storyforge.avg.production-plan', version: 1,
    goal: '一场完整的戏', requiredOutputKeys: ['avg.content.story-bible','avg.content.cast-bible'],
    dependencySuggestions: [{ outputKey: 'avg.content.cast-bible', inputKeys: ['avg.content.story-bible'] }], stopReasons: ['关键来源未知'] } },
  { key: 'avg.governance.source-audit', payload: { schema: 'storyforge.avg.source-audit', version: 1,
    facts: [{ factKey: 'sealed', resourceKeys: ['world:story:sealed'], statement: '信封未开封', disclosure: 'public' }], gaps: [], proposedSupplements: [] } },
  { key: 'avg.content.story-bible', payload: { schema: 'storyforge.avg.story-bible', version: 1,
    promise: '是否等待收信人', theme: '等待的代价', subjectKeys: ['lin'], causalChain: ['先确认信封状态'], invariants: ['不能提前知道信中内容'], payoffIntent: ['下场回应等待'], sourceFactKeys: ['sealed'] } },
  { key: 'avg.content.cast-bible', payload: { schema: 'storyforge.avg.cast-bible', version: 1, characters: [{
    characterKey: 'lin', displayName: '林', sourceResourceKey: 'world:character:lin', proposedOrigin: null, desire: '守住承诺',
    cost: '错过解释的机会', voice: '先用短句试探', knowledgeKeys: ['sealed'], relationshipArc: '信任需要等待' }] } },
  { key: 'avg.content.route-plan', payload: { schema: 'storyforge.avg.route-plan', version: 1, storyMode: 'linear',
    routes: [{ routeKey: 'wait', sceneKeys: ['archive'], endingKeys: ['morning'], revealFactKeys: ['sealed'], choiceIntents: [] }] } },
  { key: 'avg.content.scene-script.archive', payload: AVG_SCRIPT },
  { key: 'avg.content.dialogue-patch.archive', payload: { schema: 'storyforge.avg.dialogue-patch', version: 1, sceneKey: 'archive', baseScriptHash: 'a'.repeat(64), changes: [] } },
  { key: 'avg.review.content.archive', payload: { schema: 'storyforge.avg.review-issues', version: 1, targetKey: 'archive',
    observations: ['text'], unobserved: ['audio'], issues: [{ issueKey: 'issue.knowledge', locationKey: 'line.envelope',
      evidence: '不能提前读信', severity: 'blocking', owner: 'content', allowedChange: '仅修改表达', impact: '破坏信息揭示', recheck: '重审当前场景' }] } },
]
