import { isTtrpgRuntimeContentV2 } from './content-version'
import { ttrpgCompatibleOpeningAuthoringBaseV1, assertTtrpgCompatibleOpeningAuthoringV1, appendedTtrpgCompatibleOpeningEffectPlanKeysV2, isTtrpgCompatibleOpeningTextFreeProfileV1, type TtrpgCompatibleOpeningRevision } from './open-compatible-opening-contract'
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

interface PendingTtrpgOpenBriefRevisionInputV1 {
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
}

/** Retained V1 boundary: runtime budgets only, with identical frozen output. */
export async function reviseTtrpgOpenPendingRuntimeBriefV1(value: PendingTtrpgOpenBriefRevisionInputV1): Promise<ProductProductionBriefV3> {
  return revisePendingBrief(value, 'budget')
}

/** A separate human S2 decision, never an amendment of a published release or save. */
export async function reviseTtrpgOpenPendingStagePolicyBriefV1(value: PendingTtrpgOpenBriefRevisionInputV1 & {
  decision: 'revise-pending-stage-policy'
}): Promise<ProductProductionBriefV3> {
  if (value.decision !== 'revise-pending-stage-policy') fail('阶段条件修订需要本次明确选择')
  return revisePendingBrief(value, 'stage')
}

export async function reviseTtrpgOpenPendingCompatibleOpeningBriefV1(value: PendingTtrpgOpenBriefRevisionInputV1 & {
  decision: 'revise-pending-compatible-opening'
}): Promise<ProductProductionBriefV3> {
  if (value.decision !== 'revise-pending-compatible-opening') fail('兼容开局修订需要本次明确选择')
  return revisePendingBrief(value, 'opening')
}

/** Full same-source author revision is a separate decision; old narrow operations stay unchanged. */
export async function reviseTtrpgOpenPendingAuthoringBriefV1(value: PendingTtrpgOpenBriefRevisionInputV1 & {
  decision: 'revise-pending-authoring'
}): Promise<ProductProductionBriefV3> {
  if (value.decision !== 'revise-pending-authoring') fail('完整方案修订需要本次明确选择')
  return revisePendingBrief(value, 'authoring')
}

async function revisePendingBrief(value: PendingTtrpgOpenBriefRevisionInputV1, mode: 'budget' | 'stage' | 'opening' | 'authoring'): Promise<ProductProductionBriefV3> {
  const stagePolicyRevision = mode === 'stage', openingRevision = mode === 'opening', authoringRevision = mode === 'authoring'

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
  if (old.compatibleOpeningRevision?.baseReleaseHash === release.contentHash && !openingRevision && !authoringRevision) fail('兼容开局方案须沿兼容开局操作继续修订，不能改回普通额度方案')
  let compatibleOpeningRevision: TtrpgCompatibleOpeningRevision | undefined
  const settings = structuredClone(input.settings)
  if (settings.runFormat !== 'open') fail('待开始方案只接受 open 配置')
  settings.wizard.savedRulePackId = null
  if (authoringRevision) {
    if (canonical(input.common.source.selection) !== canonical(prior.source.selection)
      || canonical(input.common.source.startingPoint) !== canonical(prior.source.startingPoint)
      || input.common.source.worldContentHash !== prior.source.worldContentHash) fail('完整方案修订须保留原冻结世界、起点与读取范围；世界来源变化须另行建立制作')
    if (canonical(settings) === canonical(old.settings) && canonical(input.rulePack) === canonical(old.rulePack)) fail('完整方案未变化，请先保存本次作者修改')
    const content = await createTtrpgProductionBriefContentV3({ settingsRevision: input.settingsRevision,
      settings, rulePack: input.rulePack, worldReference: old.worldReference, sourcePlan: old.sourcePlan })
    // A previous compatible opening may have disabled text requirements. A full
    // new authoring revision needs the normal current capabilities and DAG.
    return parseProductProductionBriefV3({ ...input.common, productionBudget: prior.productionBudget, ttrpgOpen: content,
      evolution: { ...evolution, affectedLanes: [...new Set([...evolution.affectedLanes,
        'content', 'product', 'visual', 'audio', 'runtime'])] } })
  }
  const expectedSettings = structuredClone(old.settings)
  const policy = settings.openAuthoring.runtimePolicy, oldPolicy = expectedSettings.openAuthoring.runtimePolicy
  if (!policy || !oldPolicy) fail('运行边界尚未完成')
  const changed = RUNTIME_BUDGET_FIELDS.some(key => policy[key] !== oldPolicy[key])
  if (!openingRevision) Object.assign(oldPolicy, Object.fromEntries(RUNTIME_BUDGET_FIELDS.map(key => [key, policy[key]])))
  if (stagePolicyRevision) {
    const stage = settings.openAuthoring.stageClosurePolicy, oldStage = expectedSettings.openAuthoring.stageClosurePolicy
    if (!stage || !oldStage) fail('新旧方案都需要完整的阶段条件')
    if (canonical(stage) === canonical(oldStage)) fail('阶段条件未变化，请核对新版本的修订内容')
    expectedSettings.openAuthoring.stageClosurePolicy = structuredClone(stage)
  }
  if (openingRevision) {
    const frozen = manifest.runtimePackage.ttrpg
    if (!frozen || !isTtrpgRuntimeContentV2(frozen)) fail('原发布不是开放跑团')
    const base = ttrpgCompatibleOpeningAuthoringBaseV1(frozen.campaign, old.settings.openAuthoring.factPolicy)
    const appendedTemplateKeys = assertTtrpgCompatibleOpeningAuthoringV1(base, settings.openAuthoring)
    const appendedEffectPlanKeys = appendedTtrpgCompatibleOpeningEffectPlanKeysV2(base, settings.openAuthoring)
    expectedSettings.openAuthoring = { ...base, situationTemplates: structuredClone(settings.openAuthoring.situationTemplates),
      openingSituationKeys: [...settings.openAuthoring.openingSituationKeys], stageClosurePolicy: structuredClone(settings.openAuthoring.stageClosurePolicy),
      effectPlanTemplates: structuredClone(settings.openAuthoring.effectPlanTemplates) }
    const common = { schema: 'storyforge.ttrpg-compatible-opening-revision' as const, baseReleaseHash: release.contentHash,
      baseRuntimeSourceHash: manifest.packageHash, baseContentHash: await hashProductProductionValueV2(frozen), appendedTemplateKeys }
    compatibleOpeningRevision = appendedEffectPlanKeys.length ? { ...common, version: 2, appendedEffectPlanKeys } : { ...common, version: 1 }
  }
  if (canonical(settings) !== canonical(expectedSettings) || canonical(input.rulePack) !== canonical(old.rulePack)
    || canonical(input.common.source.selection) !== canonical(prior.source.selection)
    || canonical(input.common.source.startingPoint) !== canonical(prior.source.startingPoint)
    || input.common.source.worldContentHash !== prior.source.worldContentHash) {
    fail(openingRevision ? '兼容开局不得修改其他配置、规则或来源' : stagePolicyRevision
      ? '本次只支持调整待开始新版本的阶段条件和运行额度；其他配置或来源变化须另行明确修订'
      : '本次只支持调整待开始版本的运行额度；其他配置或来源变化须另行明确修订')
  }
  const content = await createTtrpgProductionBriefContentV3({ settingsRevision: input.settingsRevision,
    settings: input.settings, rulePack: input.rulePack, worldReference: old.worldReference, sourcePlan: old.sourcePlan,
    ...(compatibleOpeningRevision ? { compatibleOpeningRevision } : {}) })
  return parseProductProductionBriefV3({ ...prior, ttrpgOpen: content,
    ...(openingRevision && isTtrpgCompatibleOpeningTextFreeProfileV1({ ttrpgOpen: content, media: prior.media }) ? { capabilityRequirements: prior.capabilityRequirements.map(r => r.mediaClass === 'text' ? { ...r, required: false } : r) } : {}),
    evolution: { ...evolution, affectedLanes: [...new Set([...evolution.affectedLanes,
      ...(changed ? ['runtime' as const] : []), ...(stagePolicyRevision || openingRevision ? ['content' as const, 'runtime' as const] : [])])] } })
}
