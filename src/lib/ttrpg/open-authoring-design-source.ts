/** Read-only S2 basis. Preparing an assisted design is neither a formal Brief
 * nor production authorization; it may start from empty situation templates. */
import { db } from '../db/schema'
import type { ProductProductionBriefV3, ProductSourcePlanV1, WorldReferenceV1, WorkspaceScope } from '../types'
import { resolveScope } from '../workspace/scope'
import { createWorldReferenceV1 } from '../world-engine/world-reference'
import { assertWorldSemanticReleaseCurrentV1 } from '../context-gateway/world-release-client'
import { draftTtrpgOpenProductionCommonBriefV3 } from '../product-production/consultation'
import { createProductProductionSourcePlanV1 } from '../product-production/source-contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readTtrpgDraft } from './authoring-service'
import { isTtrpgAuthoringSettingsV2, settingsFromTtrpgDraft } from './authoring-contract'
import type { TtrpgAuthoringSettingsV2 } from './authoring-contract-v2'
import type { RulePackV2 } from './open-contract'
import { readTtrpgRulePackVersionedV1 } from './rule-pack-library'
import { verifyTtrpgOpenAuthoringSourceProvenanceV1 } from './open-source-provenance'
import { assertTtrpgOpenAuthoringSeatPlanCurrentV1 } from './open-authoring-seat-plan'

export interface TtrpgOpenAuthoringDesignSourceV1 {
  schema: 'storyforge.ttrpg-open-authoring-design-source'; version: 1; portable: false
  scope: WorkspaceScope; draftId: number; revision: number
  settings: Extract<TtrpgAuthoringSettingsV2, { runFormat: 'open' }>
  settingsHash: string; selectionHash: string; rulePackId: number; rulePack: RulePackV2; rulePackHash: string
  draftRecordHash: string; ruleRecordHash: string
  sourceSelection: ProductProductionBriefV3['source']['selection']
  worldReference: WorldReferenceV1; sourcePlan: ProductSourcePlanV1
  basisHash: string
}

function fail(message: string): never { throw new Error(`[ttrpg-authoring-design] ${message}`) }
function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  for (const item of Object.values(value)) freeze(item)
  Object.freeze(value)
}

export async function prepareTtrpgOpenAuthoringDesignSourceV1(input: { scope: WorkspaceScope; revision: number }): Promise<{
  source: TtrpgOpenAuthoringDesignSourceV1; assertCurrent: () => Promise<void>
}> {
  return prepare(input)
}

/** Reconstruct the original read-only snapshot at its recorded creation time.
 * This is verification, never a new preparation or a permission to re-send. */
export async function assertTtrpgOpenAuthoringDesignSourceCurrentV1(source: TtrpgOpenAuthoringDesignSourceV1): Promise<void> {
  if (!source || !Number.isSafeInteger(source.sourcePlan?.createdAt) || source.sourcePlan.createdAt < 0) fail('来源计划创建时刻无效')
  const rebuilt = await prepare({ scope: source.scope, revision: source.revision }, source.sourcePlan.createdAt)
  if (canonicalProductProductionJsonV2(rebuilt.source) !== canonicalProductProductionJsonV2(source)) fail('保存的设计来源与当前草稿、规则或世界不一致')
}

async function prepare(input: { scope: WorkspaceScope; revision: number }, originalCreatedAt?: number): Promise<{
  source: TtrpgOpenAuthoringDesignSourceV1; assertCurrent: () => Promise<void>
}> {
  const scope = await resolveScope({ scope: input.scope }), draft = await readTtrpgDraft(scope)
  if (draft.revision !== input.revision) fail('草稿已变化，请先保存并核对当前版本')
  if (!Number.isSafeInteger(draft.id) || !draft.id) fail('请先保存作品')
  const work = await db.works.get(scope.workId)
  if (!work || work.kind !== 'ttrpg') fail('设计只能属于当前跑团作品')
  const settings = settingsFromTtrpgDraft(draft)
  if (!isTtrpgAuthoringSettingsV2(settings) || settings.runFormat !== 'open') fail('设计只接受明确的开放格式')
  if (!settings.openingSituation.trim() || !settings.playerRole.trim()) fail('请先填写开场目标与玩家身份')
  const policy = settings.openAuthoring
  if (!policy.companionPolicy || !policy.stageClosurePolicy || !policy.runtimePolicy) fail('请先填写本桌边界草稿')
  if (settings.authoringSeatPlan) assertTtrpgOpenAuthoringSeatPlanCurrentV1({ plan: settings.authoringSeatPlan,
    seats: settings.wizard.seats, companionPolicy: policy.companionPolicy })
  if (!draft.worldReleaseId || !draft.selectionJson || !draft.suggestionKey) fail('请先选择冻结世界并保存出口范围')
  if (settings.wizard.ruleOrigin !== 'saved-rule-pack' || !draft.savedRulePackId
    || settings.wizard.savedRulePackId !== draft.savedRulePackId) fail('请先确认本作品的开放规则')
  if ([settings.wizard.initiativeDiceSides, settings.wizard.actionsPerTurn, settings.wizard.reactionsPerRound,
    settings.wizard.deathRecoveryHeroicDiceCost].some(value => value !== null) || settings.wizard.customHouseRulePatches.length) {
    fail('请先把村规确认并保存为独立开放规则版本')
  }
  const rule = await readTtrpgRulePackVersionedV1({ scope, rulePackId: draft.savedRulePackId })
  if (rule.rulePack.version !== 2) fail('设计不能把旧格式规则当作开放规则')
  const worldReference = await createWorldReferenceV1(draft.worldReleaseId)
  const common = await draftTtrpgOpenProductionCommonBriefV3({ scope, worldReleaseId: draft.worldReleaseId,
    suggestionKey: draft.suggestionKey, sourceSelection: JSON.parse(draft.selectionJson),
    qualityProfile: settings.qualityProfile, scale: 'campaign', playerRole: settings.playerRole,
    openingSituation: settings.openingSituation, visualLevel: settings.wizard.maximumGeneratedAssets > 0 ? 'key-scenes' : 'none', audioLevel: 'none' })
  const settingsHash = await hashProductProductionValueV2(settings), selectionHash = await hashProductProductionValueV2(JSON.parse(draft.selectionJson))
  const draftRecordHash = await hashProductProductionValueV2(draft), ruleRecordHash = await hashProductProductionValueV2(rule.record)
  const instance = await hashProductProductionValueV2({ scope, draftId: draft.id, revision: draft.revision,
    settingsHash, selectionHash, draftRecordHash, ruleRecordHash, worldReferenceHash: worldReference.referenceHash, rulePackHash: rule.record.contentHash })
  const sourcePlan = await createProductProductionSourcePlanV1({ scope, productionKey: `ttrpg-authoring.${instance.slice(0, 40)}`,
    brief: common, ...(originalCreatedAt === undefined ? {} : { createdAt: originalCreatedAt }) })
  if (sourcePlan.worldReference.referenceHash !== worldReference.referenceHash) fail('来源计划与实际世界不一致')
  await verifyTtrpgOpenAuthoringSourceProvenanceV1({ sourcePlan, facts: policy.factPolicy.map(item => item.fact) })
  const originalDraft = JSON.stringify(draft), originalRule = JSON.stringify(rule.record)
  const assertCurrent = async () => {
    await resolveScope({ scope })
    if (JSON.stringify(await readTtrpgDraft(scope)) !== originalDraft
      || (await db.works.get(scope.workId))?.kind !== 'ttrpg'
      || JSON.stringify((await readTtrpgRulePackVersionedV1({ scope, rulePackId: draft.savedRulePackId! })).record) !== originalRule) {
      fail('设计所依据的草稿或规则已变化；原候选只可保留参考')
    }
    await assertWorldSemanticReleaseCurrentV1({ localReleaseRecordId: draft.worldReleaseId!, expectedProjectId: scope.projectId,
      expectedWorldId: scope.worldId, expectedReleaseHash: worldReference.releaseHash })
  }
  await assertCurrent()
  const body = { schema: 'storyforge.ttrpg-open-authoring-design-source' as const, version: 1 as const, portable: false as const,
    scope, draftId: draft.id!, revision: draft.revision, settings, settingsHash, selectionHash,
    draftRecordHash, ruleRecordHash,
    sourceSelection: common.source.selection,
    rulePackId: draft.savedRulePackId, rulePack: rule.rulePack, rulePackHash: rule.record.contentHash, worldReference, sourcePlan }
  const source: TtrpgOpenAuthoringDesignSourceV1 = { ...body, basisHash: await hashProductProductionValueV2(body) }
  freeze(source)
  return { source, assertCurrent }
}
