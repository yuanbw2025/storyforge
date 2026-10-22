/** S2 revision of an unstarted release-based open Brief. No DB writes/start. */
import type { ProductBuildRecordV1, ProductProductionBriefRecordV1, ProductProductionBriefV3,
  ProductProductionRecordV1, ProductRelease, WorkspaceScope, WorldReferenceV1 } from '../types'
import type { TtrpgAuthoringSettingsV2 } from './authoring-contract-v2'
import type { RulePackV2 } from './open-contract'
import { canonicalProductProductionJsonV2 as canonical, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { verifyProductReleaseManifestV1 } from '../product-production/runtime-package'
import { createTtrpgProductionBriefContentV3 } from './production-brief-v3'

function fail(message: string): never { throw Error(`[ttrpg-open-pending-brief] ${message}`) }
// The existing visible S2 runtime controls. Failure/unknown-result semantics,
// output protocol and content/rule settings are not budget edits.
const RUNTIME_BUDGET_FIELDS = ['enabled', 'maximumCallsPerEpoch', 'maxAiActions', 'maximumOutputTokens',
  'maximumEpochTokens', 'maximumEpochCostUsd', 'maximumRepairAttempts'] as const

export async function reviseTtrpgOpenPendingRuntimeBriefV1(value: {
  scope: WorkspaceScope
  production: ProductProductionRecordV1
  row: ProductProductionBriefRecordV1
  build: ProductBuildRecordV1 | null
  release: ProductRelease | undefined
  settingsRevision: number
  settings: TtrpgAuthoringSettingsV2
  rulePack: RulePackV2
  worldReference: WorldReferenceV1
  common: Omit<ProductProductionBriefV3, 'ttrpg' | 'ttrpgOpen'>
}): Promise<ProductProductionBriefV3> {
  const input = structuredClone(value)
  const { scope, production, row, build, release } = input
  const sameOwner = (record: { projectId: number; worldId: number; workId: number }) =>
    record.projectId === scope.projectId && record.worldId === scope.worldId && record.workId === scope.workId
  if (!sameOwner(production) || !sameOwner(row) || !build || !sameOwner(build) || !release || !sameOwner(release)
    || production.productType !== 'ttrpg' || release.productType !== 'ttrpg'
    || production.status !== 'brief-ready' || row.status !== 'draft' || row.authorizedAt !== null
    || row.productionId !== production.id || row.revision !== production.currentBriefRevision
    || row.revision <= build.briefRevision || build.productionId !== production.id
    || build.buildNumber !== production.currentBuildNumber || build.status !== 'released'
    || build.releasedProductReleaseId !== release.id || production.currentProductReleaseId !== release.id
    || release.productionKey !== production.productionKey) fail('请先在原制作记录中准备一个尚未开始的发布后新版本')
  const prior = parseProductProductionBriefV3(row.briefJson), old = prior.ttrpgOpen, evolution = prior.evolution
  if (!old || evolution?.base.kind !== 'release' || evolution.base.productReleaseId !== release.id
    || evolution.base.contentHash !== release.contentHash
    || await hashProductProductionValueV2(prior) !== row.briefHash
    || old.sourcePlan.planHash !== row.sourcePlanHash || old.sourcePlan.productInstanceKey !== production.productionKey
    || row.sourceWorldReleaseId !== input.worldReference.localReleaseRecordId
    || row.sourceWorldContentHash !== input.worldReference.releaseHash
    || canonical(old.worldReference) !== canonical(input.worldReference)) fail('待开始方案的发布基线或世界来源已变化')
  const manifest = await verifyProductReleaseManifestV1(release.manifestJson, { ttrpgProtocol: 2 })
  if (await hashProductProductionValueV2(manifest) !== release.contentHash
    || manifest.productionProvenance.productionKey !== production.productionKey
    || manifest.productionProvenance.buildNumber !== build.buildNumber
    || manifest.productionProvenance.buildManifestHash !== build.manifestHash
    || manifest.productionProvenance.rootTerminalReceiptHash !== build.rootTerminalReceiptHash) fail('原发布版本与当前制作轮次不一致')
  const settings = structuredClone(input.settings)
  if (settings.runFormat !== 'open') fail('待开始方案只接受 open 配置')
  settings.wizard.savedRulePackId = null
  const expectedSettings = structuredClone(old.settings)
  const policy = settings.openAuthoring.runtimePolicy, oldPolicy = expectedSettings.openAuthoring.runtimePolicy
  if (!policy || !oldPolicy) fail('运行边界尚未完成')
  const changed = RUNTIME_BUDGET_FIELDS.some(key => policy[key] !== oldPolicy[key])
  Object.assign(oldPolicy, Object.fromEntries(RUNTIME_BUDGET_FIELDS.map(key => [key, policy[key]])))
  if (canonical(settings) !== canonical(expectedSettings) || canonical(input.rulePack) !== canonical(old.rulePack)
    || canonical(input.common.source.selection) !== canonical(prior.source.selection)
    || canonical(input.common.source.startingPoint) !== canonical(prior.source.startingPoint)
    || input.common.source.worldContentHash !== prior.source.worldContentHash) {
    fail('本次只支持调整待开始版本的运行额度；其他配置或来源变化须另行明确修订')
  }
  const content = await createTtrpgProductionBriefContentV3({ settingsRevision: input.settingsRevision,
    settings: input.settings, rulePack: input.rulePack, worldReference: old.worldReference, sourcePlan: old.sourcePlan })
  return parseProductProductionBriefV3({ ...prior, ttrpgOpen: content,
    evolution: { ...evolution, affectedLanes: changed ? [...new Set([...evolution.affectedLanes, 'runtime'])] : evolution.affectedLanes } })
}
