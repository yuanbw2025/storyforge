/** Manual open-TTRPG budget revision on the existing stopped Production lineage. */
import { db } from '../db/schema'
import type { WorkspaceScope, ProductProductionBriefV3, ProductProductionCommandV1 } from '../types'
import { readProductProductionDetailsV1 } from '../product-production/service'
import { executeProductProductionCommand } from '../product-production/commands'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { createProductProductionPlanV3 } from '../product-production/plan'
import { assertProductProductionBudgetLedgerV1 } from '../product-production/scheduler'

export interface TtrpgOpenProductionBudgetValuesV1 {
  maximumModelCalls: number
  maximumInputTokens: number
  maximumOutputTokens: number
}
export interface TtrpgOpenProductionBudgetOwnerV1 {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  buildNumber: number
  controlEpoch: number
  expectedStateRevision: number
  briefRevision: number
  briefHash: string
  ledgerHash: string
  failureHash: string
}
const KEYS = ['maximumModelCalls', 'maximumInputTokens', 'maximumOutputTokens'] as const
function fail(message: string): never { throw Error(`[ttrpg-open-budget-revision] ${message}`) }
function explicitScope(scope: WorkspaceScope) {
  if (!scope || [scope.projectId, scope.worldId, scope.workId].some(id => !Number.isSafeInteger(id) || Number(id) < 1)) {
    fail('必须明确当前作品、世界和工作区，不能回退到活动作品')
  }
}
function budgetValues(value: TtrpgOpenProductionBudgetValuesV1) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== KEYS.length || Object.keys(value).some(key => !(KEYS as readonly string[]).includes(key))) {
    fail('只可提交本次明确核对的文本调用、输入和输出上限')
  }
  for (const key of KEYS) if (!Number.isSafeInteger(value[key]) || value[key] < 1) fail('制作上限必须是正整数')
  return { maximumModelCalls: value.maximumModelCalls, maximumInputTokens: value.maximumInputTokens,
    maximumOutputTokens: value.maximumOutputTokens }
}
async function parent(input: { scope: WorkspaceScope; productionId: number; briefRevision: number; briefHash: string }) {
  explicitScope(input.scope)
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['ttrpg'])
  const row = details.briefHistory.find(item => item.revision === input.briefRevision)
  if (!row || row.briefHash !== input.briefHash) fail('原制作方案版本已变化')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (!brief.ttrpgOpen || brief.intent.productType !== 'ttrpg'
    || await hashProductProductionValueV2(brief) !== row.briefHash) fail('原开放跑团方案不可核对')
  return { details, brief }
}

/** No stop/start, command, Run, inference, fee settlement or adoption. */
export async function inspectTtrpgOpenProductionBudgetRevisionV1(input: {
  scope: WorkspaceScope; productionId: number
}) {
  explicitScope(input.scope)
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['ttrpg'])
  const { production, build, brief: row } = details
  if (!build?.id || !row || production.status !== 'stopped' || build.status !== 'cancelled'
    || production.currentBuildNumber !== build.buildNumber || row.revision !== build.briefRevision
    || row.briefHash !== build.briefHash || build.controlEpoch !== production.controlEpoch) {
    fail('请先用现有停止操作保留旧轮次，再核对新方案；不会在这里自动停止或重试')
  }
  const { brief } = await parent({ ...input, briefRevision: row.revision, briefHash: row.briefHash })
  assertProductProductionBudgetLedgerV1(build.budgetLedgerJson)
  const owner: TtrpgOpenProductionBudgetOwnerV1 = {
    scope: structuredClone(input.scope), productionId: input.productionId, buildId: build.id,
    buildNumber: build.buildNumber, controlEpoch: build.controlEpoch,
    expectedStateRevision: production.stateRevision, briefRevision: row.revision, briefHash: row.briefHash,
    ledgerHash: await hashProductProductionValueV2(build.budgetLedgerJson),
    failureHash: await hashProductProductionValueV2(build.failureJson),
  }
  return { owner, budget: structuredClone(brief.productionBudget),
    nextBuildNumber: Math.max(...details.buildHistory.map(item => item.buildNumber)) + 1 }
}

/** Read-only proposal using the real current Plan factory; it is not a frozen Build Plan. */
export async function prepareTtrpgOpenProductionBudgetRevisionV1(input: {
  owner: TtrpgOpenProductionBudgetOwnerV1; values: TtrpgOpenProductionBudgetValuesV1
}) {
  const values = budgetValues(input.values)
  const current = await inspectTtrpgOpenProductionBudgetRevisionV1(input.owner)
  if (canonicalProductProductionJsonV2(current.owner) !== canonicalProductProductionJsonV2(input.owner)) {
    fail('旧轮次或方案在核对期间发生变化，请重新读取')
  }
  const { brief } = await parent(input.owner)
  const candidate = parseProductProductionBriefV3({ ...brief,
    productionBudget: { ...brief.productionBudget, ...values } })
  const briefHash = await hashProductProductionValueV2(candidate)
  const previewPlan = await createProductProductionPlanV3({ brief: candidate, briefHash,
    buildNumber: current.nextBuildNumber, controlEpoch: current.owner.controlEpoch,
    ttrpgOpenExecutionProfile: 3 })
  return { owner: current.owner, values, brief: candidate, briefHash, previewPlan }
}

/** Save one explicit new Brief through the existing scoped command. Start remains separate. */
export async function saveTtrpgOpenProductionBudgetRevisionV1(input: {
  owner: TtrpgOpenProductionBudgetOwnerV1; values: TtrpgOpenProductionBudgetValuesV1; commandId: string
}) {
  explicitScope(input.owner.scope)
  const values = budgetValues(input.values)
  if (typeof input.commandId !== 'string' || !input.commandId.trim() || input.commandId !== input.commandId.trim() || input.commandId.length > 200) fail('保存命令标识无效')
  const previous = await db.productProductionCommands.where('[productionId+commandId]')
    .equals([input.owner.productionId, input.commandId]).first()
  let brief: ProductProductionBriefV3
  if (previous) {
    if (previous.projectId !== input.owner.scope.projectId || previous.worldId !== input.owner.scope.worldId
      || previous.workId !== input.owner.scope.workId || previous.type !== 'save-brief-revision') fail('原保存命令不属于当前作品')
    const original = await parent(input.owner)
    brief = parseProductProductionBriefV3({ ...original.brief,
      productionBudget: { ...original.brief.productionBudget, ...values } })
  } else {
    brief = (await prepareTtrpgOpenProductionBudgetRevisionV1(input)).brief
  }
  const command: Extract<ProductProductionCommandV1, { type: 'save-brief-revision' }> = {
    type: 'save-brief-revision', commandId: input.commandId,
    expectedStateRevision: input.owner.expectedStateRevision, parentRevision: input.owner.briefRevision, brief,
  }
  if (previous && previous.payloadHash !== await hashProductProductionValueV2(command)) fail('该保存标识已经绑定另一份新方案')
  const receipt = await executeProductProductionCommand({ scope: input.owner.scope,
    productionId: input.owner.productionId, command })
  if (!receipt.ok) fail(String(receipt.result.message ?? receipt.errorCode ?? '新方案未保存，请保留原轮次并重新核对'))
  return { receipt, details: await readProductProductionDetailsV1(input.owner.scope, input.owner.productionId, ['ttrpg']) }
}
