import { db } from '../db/schema'
import type { TextOpenWorldMediaRequirementsV1, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { hashProductProductionValueV2 } from '../product-production/hash'
import {
  assertProductProductionBudgetLedgerV1,
  projectProductProductionSchedulerV1,
} from '../product-production/scheduler'
import { readTextOpenWorldArtifactGovernanceV1 } from './creator-artifact-governance'
import {
  projectTextOpenWorldResponsibilitiesV1,
  type TextOpenWorldResponsibilityUsageV1,
} from './responsibility-progress'

/** Read-only composition of the existing governance and scheduler evidence.
 * A changing Build is retried by the UI, never presented as a ready snapshot. */
export async function readTextOpenWorldResponsibilityWorkspaceV1(input: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
}) {
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.buildId)
  if (!build || build.productionId !== input.productionId
    || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) {
    throw new Error('[text-open-world-responsibility] Build 不存在或跨作用域')
  }
  const plan = parseProductProductionPlanV3(build.planJson, undefined, build.briefHash)
  if (await hashProductProductionValueV2(plan) !== build.planHash) {
    throw new Error('[text-open-world-responsibility] Plan Hash 不一致')
  }
  assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
  const ledger = JSON.parse(build.budgetLedgerJson || '{}') as {
    version?: number
    attempts?: TextOpenWorldResponsibilityUsageV1[]
    tasks?: Record<string, Omit<TextOpenWorldResponsibilityUsageV1, 'taskKey' | 'usageKnown'>>
  }
  const usage = ledger.version === 1
    ? Object.entries(ledger.tasks ?? {}).map(([taskKey, row]) => ({ taskKey, usage: row.usage, usageKnown: row.usage !== null }))
    : ledger.attempts ?? []
  const [governance, progress, requirementsRows] = await Promise.all([
    readTextOpenWorldArtifactGovernanceV1({ scope, productionId: input.productionId }),
    projectProductProductionSchedulerV1({ scope, productionId: input.productionId }),
    db.productBuildArtifacts.where('buildId').equals(input.buildId)
      .filter(row => row.artifactKey === 'text-open-world.media-requirements').toArray(),
  ])
  const current = await db.productBuilds.get(input.buildId)
  if (JSON.stringify(current) !== JSON.stringify(build) || governance.build.id !== input.buildId) {
    throw new Error('[text-open-world-responsibility] 读取期间 Build 已变化，请刷新')
  }
  const verifiedRequirement = governance.artifacts.find(row => row.artifactKey === 'text-open-world.media-requirements'
    && row.currentEpoch && row.health === 'verified' && row.productionValidation === 'production-validated')
  const requirement = verifiedRequirement && requirementsRows.find(row => row.id === verifiedRequirement.rowId)
  const degradations = requirement
    ? (JSON.parse(requirement.payloadJson) as TextOpenWorldMediaRequirementsV1).slots
      .filter(slot => ['fallback-only', 'procedural-code'].includes(slot.productionMode))
      .map(slot => `${slot.title}：${slot.fallback}（冻结需求）`)
    : []
  return projectTextOpenWorldResponsibilitiesV1({ plan, progress, governance, usage, degradations })
}
