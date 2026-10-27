/** Deterministic production of an explicitly authored compatible opening. No model dispatch. */
import type { ProductProductionBriefV3, WorkspaceScope } from '../types'
import { db } from '../db/schema'
import { readTtrpgCompatibleOpeningReleaseV1 } from './open-compatible-opening-source'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { parseTtrpgOpenSourceFactsArtifactV1, parseTtrpgOpenRuleSystemArtifactV1, parseTtrpgOpenSituationLayerArtifactV1 } from './open-production-artifacts'
import { ttrpgCompatibleOpeningAuthoringBaseV1, assertTtrpgCompatibleOpeningAuthoringV1, TTRPG_COMPATIBLE_OPENING_AUTHORED_TASKS_V1 } from './open-compatible-opening-contract'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'

export async function readTtrpgCompatibleOpeningProductionBaseV1(input: { scope: WorkspaceScope; productionId: number; brief: ProductProductionBriefV3 }) {
  const marker = input.brief.ttrpgOpen?.compatibleOpeningRevision, base = input.brief.evolution?.base
  if (!marker || base?.kind !== 'release' || base.contentHash !== marker.baseReleaseHash) throw Error('[ttrpg-compatible-opening] 缺少原发布及明确作者修订')
  const source = await readTtrpgCompatibleOpeningReleaseV1({ ...input, expectedContentHash: marker.baseReleaseHash })
  if (source.manifest.packageHash !== marker.baseRuntimeSourceHash || await hash(source.content) !== marker.baseContentHash) throw Error('[ttrpg-compatible-opening] 原发布来源已变化')
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([input.productionId, source.manifest.productionProvenance.buildNumber]).first()
  if (!build || build.status !== 'released' || build.releasedProductReleaseId !== source.release.id
    || build.manifestHash !== source.manifest.productionProvenance.buildManifestHash
    || build.rootTerminalReceiptHash !== source.manifest.productionProvenance.rootTerminalReceiptHash) throw Error('[ttrpg-compatible-opening] 缺少原已发布制作回执')
  const rows = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  const adopted = async (key: string, expectedHash: string) => {
    const own = rows.filter(r => r.artifactKey === key && r.controlEpoch === build.controlEpoch && ['accepted', 'carried-forward'].includes(r.status))
    if (own.length !== 1 || own[0].projectId !== input.scope.projectId || own[0].worldId !== input.scope.worldId || own[0].workId !== input.scope.workId
      || own[0].contentHash !== expectedHash || await hash(JSON.parse(own[0].payloadJson)) !== expectedHash) throw Error('[ttrpg-compatible-opening] 原采纳产物缺失或不匹配发布')
    return JSON.parse(own[0].payloadJson)
  }
  const provenance = source.content.campaign.designProvenance
  if (!provenance || !('schema' in provenance) || provenance.schema !== 'storyforge.ttrpg-open-design-provenance') throw Error('[ttrpg-compatible-opening] 原发布缺少作者制作来源')
  const facts = parseTtrpgOpenSourceFactsArtifactV1(await adopted('ttrpg.open.source-facts', provenance.sourceFactsArtifactHash))
  const system = parseTtrpgOpenRuleSystemArtifactV1(await adopted('ttrpg.open.rule-system', provenance.ruleSystemArtifactHash), input.brief.ttrpgOpen!.rulePack, input.brief.ttrpgOpen!.settings)
  const layer = parseTtrpgOpenSituationLayerArtifactV1(await adopted('ttrpg.open.situation-layer', provenance.situationLayerArtifactHash), facts)
  const baseAuthoring = ttrpgCompatibleOpeningAuthoringBaseV1(source.content.campaign, input.brief.ttrpgOpen!.settings.openAuthoring.factPolicy)
  const added = assertTtrpgCompatibleOpeningAuthoringV1(baseAuthoring, input.brief.ttrpgOpen!.settings.openAuthoring)
  if (stable(added) !== stable(marker.appendedTemplateKeys)) throw Error('[ttrpg-compatible-opening] 新开局与作者冻结修订不一致')
  return { ...source, facts, system, layer }
}
export async function produceTtrpgCompatibleOpeningArtifactV1(input: {
  scope: WorkspaceScope; productionId: number; brief: ProductProductionBriefV3; taskKey: string
}) {
  if (!TTRPG_COMPATIBLE_OPENING_AUTHORED_TASKS_V1.some(k => k === input.taskKey)) throw Error('[ttrpg-compatible-opening] 非兼容开局确定性岗位')
  const source = await readTtrpgCompatibleOpeningProductionBaseV1(input)
  const { factPolicy: _facts, ...authoring } = structuredClone(input.brief.ttrpgOpen!.settings.openAuthoring)
  const payload = input.taskKey === 'ttrpg.open.source-facts' ? source.facts : input.taskKey === 'ttrpg.open.rule-system' ? source.system
    : parseTtrpgOpenSituationLayerArtifactV1({ ...source.layer, authoring }, source.facts)
  return { artifactKey: input.taskKey, kind: input.taskKey === 'ttrpg.open.source-facts' ? 'product-design' as const : 'product-module' as const, payload,
    quality: { authorConfirmedCompatibleOpening: true, originalSourceVerified: true },
    rights: { origin: input.taskKey === 'ttrpg.open.situation-layer' ? 'author-confirmed-opening' : 'preserved-adopted-release-content', baseReleaseHash: source.release.contentHash },
    metadata: { schema: 'storyforge.ttrpg-compatible-opening-artifact', version: 1, baseReleaseHash: source.release.contentHash,
      baseRuntimeSourceHash: source.manifest.packageHash, originalContentHash: await hash(input.taskKey === 'ttrpg.open.source-facts' ? source.facts : input.taskKey === 'ttrpg.open.rule-system' ? source.system : source.layer) } }
}
