/** Explicit same-Build author repair; no model dispatch or direct artifact writes. */
import { db } from '../db/schema'
import type { ProductBuildRecordV1, ProductProductionCommandV1, WorkspaceScope } from '../types'
import { parseProductProductionBriefV3, parseTtrpgOpenContentRevisionV1 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { resolveProductProductionTaskRecoveryPolicyV1 } from '../product-production/recovery-policy'
import { prepareTtrpgOpenContentRevisionSourceV1 } from '../product-production/artifact-store'
import { parseTtrpgOpenSourceFactsArtifactV1, parseTtrpgOpenRuleSystemArtifactV1,
  parseTtrpgOpenSituationLayerArtifactV1 } from './open-production-artifacts'
import { ttrpgOpenProductionMediaContextV1 } from './open-production-media'

export async function prepareTtrpgOpenContentRevisionV1(input: {
  scope: WorkspaceScope
  productionId: number
  build: ProductBuildRecordV1 & { id: number }
  command: Extract<ProductProductionCommandV1, { type: 'resume' }>
}) {
  const { scope, build, command } = input
  const revision = parseTtrpgOpenContentRevisionV1(command.ttrpgContentRevision)
  const production = await db.productProductions.get(input.productionId)
  if ([scope.projectId, scope.worldId, scope.workId].some(id => !Number.isSafeInteger(id) || Number(id) < 1)
    || !production || production.productType !== 'ttrpg' || production.status !== 'paused'
    || production.projectId !== scope.projectId || production.worldId !== scope.worldId || production.workId !== scope.workId
    || production.currentBuildNumber !== build.buildNumber || production.id !== build.productionId
    || production.currentBriefRevision !== build.briefRevision
    || production.controlEpoch !== build.controlEpoch || production.stateRevision !== command.expectedStateRevision
    || build.status !== 'paused' || !['building', 'recovery-required'].includes(build.resumeState ?? '')
    || build.releasedProductReleaseId != null || build.controlEpoch !== revision.expectedControlEpoch
    || build.planHash !== revision.expectedPlanHash) {
    throw Error('[ttrpg-content-revision] 只能修订当前作品尚未发布、明确暂停的原制作轮次')
  }
  const plan = parseProductProductionPlanV3(build.planJson)
  const task = plan.tasks.find(task => task.taskKey === revision.artifactKey)
  if (plan.productType !== 'ttrpg' || !task
    || !resolveProductProductionTaskRecoveryPolicyV1({ productType: 'ttrpg', task }).authorDraftAllowed) {
    throw Error('[ttrpg-content-revision] 冻结岗位不支持作者内容修订')
  }
  const brief = await db.productProductionBriefs.where('[productionId+revision]')
    .equals([production.id!, build.briefRevision]).first()
  if (!brief || brief.projectId !== scope.projectId || brief.worldId !== scope.worldId || brief.workId !== scope.workId
    || brief.briefHash !== build.briefHash) throw Error('[ttrpg-content-revision] 原方案已变化')
  const parsedBrief = parseProductProductionBriefV3(brief.briefJson)
  if (!parsedBrief.ttrpgOpen || await hashProductProductionValueV2(parsedBrief) !== build.briefHash) {
    throw Error('[ttrpg-content-revision] 原跑团方案校验失败')
  }
  parseProductProductionPlanV3(build.planJson, parsedBrief, build.briefHash)
  const source = await prepareTtrpgOpenContentRevisionSourceV1({ scope, build,
    artifactKey: revision.artifactKey, version: revision.expectedArtifactVersion, contentHash: revision.expectedArtifactHash })
  // Use exactly the production executor's author parsers. They cannot confer
  // rights or turn unconfirmed facts/attributes into author-confirmed content.
  const value = JSON.parse(revision.authorDraftJson)
  let ruleSource: Awaited<ReturnType<typeof prepareTtrpgOpenContentRevisionSourceV1>> | null = null
  if (revision.artifactKey === 'ttrpg.open.source-facts') parseTtrpgOpenSourceFactsArtifactV1(value)
  else if (revision.artifactKey === 'ttrpg.open.rule-system') {
    parseTtrpgOpenRuleSystemArtifactV1(value, parsedBrief.ttrpgOpen.rulePack, parsedBrief.ttrpgOpen.settings)
  } else {
    const facts = (await db.productBuildArtifacts.where('buildId').equals(build.id).toArray())
      .filter(row => row.artifactKey === 'ttrpg.open.source-facts' && row.controlEpoch === plan.controlEpoch
        && (row.status === 'accepted' || row.status === 'carried-forward'))
    if (facts.length !== 1 || facts[0].projectId !== scope.projectId || facts[0].worldId !== scope.worldId
      || facts[0].workId !== scope.workId
      || await hashProductProductionValueV2(JSON.parse(facts[0].payloadJson)) !== facts[0].contentHash) {
      throw Error('[ttrpg-content-revision] 已采用来源事实不完整或已变化')
    }
    parseTtrpgOpenSituationLayerArtifactV1(value, parseTtrpgOpenSourceFactsArtifactV1(facts[0].payloadJson))
    const rules = (await db.productBuildArtifacts.where('buildId').equals(build.id).toArray())
      .filter(row => row.artifactKey === 'ttrpg.open.rule-system' && row.controlEpoch === plan.controlEpoch
        && (row.status === 'accepted' || row.status === 'carried-forward'))
    if (rules.length !== 1) throw Error('[ttrpg-content-revision] 已采用规则角色不唯一')
    ruleSource = await prepareTtrpgOpenContentRevisionSourceV1({ scope, build,
      artifactKey: 'ttrpg.open.rule-system', version: rules[0].version, contentHash: rules[0].contentHash })
    ttrpgOpenProductionMediaContextV1({ ruleSystem: JSON.parse(ruleSource.artifact.payloadJson),
      situationLayer: value, rulePack: parsedBrief.ttrpgOpen.rulePack })
  }
  const { inspectTtrpgOpenContentRevisionImpactV1, assertTtrpgOpenContentRevisionImpactV1 } = await import('./open-production-content-revision-impact')
  const impact = await inspectTtrpgOpenContentRevisionImpactV1({ scope, buildId: build.id, plan,
    fromControlEpoch: plan.controlEpoch, sourcePlanHash: build.planHash, artifactKey: revision.artifactKey })
  assertTtrpgOpenContentRevisionImpactV1(impact, revision.expectedImpactHash)
  const assertCurrent = async () => {
    if (canonicalProductProductionJsonV2(await db.productProductionBriefs.get(brief.id!))
      !== canonicalProductProductionJsonV2(brief)) throw Error('[ttrpg-content-revision] 原方案读取后已变化')
    await source.assertCurrent()
    await ruleSource?.assertCurrent()
    await impact.assertCurrent()
  }
  await assertCurrent()
  return { sourceProofHash: source.proofHash, assertCurrent }
}
