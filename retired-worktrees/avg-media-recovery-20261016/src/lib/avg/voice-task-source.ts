import { db } from '../db/schema'
import { assertRecordInScope } from '../workspace/scope'
import type { ProductProductionTaskExecutionInputV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readAvgSystemPlanForCompilationV1 } from './author-artifacts'
import { assertAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { assertAvgVoiceProductionPolicyV3, type AvgVoiceProductionBriefV3 } from './voice-production-policy'
import { validateAvgVoiceProductionSourcesV1 } from './voice-production-source'
import { readAgentRunV1 } from '../agent/run/event-store'
import { createAgentSkillExecutionBindingV1 } from '../agent/execution-binding'
import { getAgentSkillV1 } from '../agent/skill-registry'
import { validateAvgVoiceRecoveryV1 } from './voice-recovery'

async function assertHarnessClaim(input: ProductProductionTaskExecutionInputV1, budgetLedgerJson: string) {
  if (!input.taskRunId) throw new Error('[avg-voice] 配音调用缺少实际 durable 子 Run')
  let parsed: unknown
  try { parsed = JSON.parse(budgetLedgerJson) } catch { throw new Error('[avg-voice] 配音预算 ledger 损坏') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('[avg-voice] 配音预算 ledger 无效')
  const ledger = parsed as { schema?: string; version?: number; rootRunId?: number;
    tasks?: Record<string, { runId?: number; attempt?: number; status?: string; idempotencyKey?: string }> }
  const claim = ledger.tasks?.[input.task.taskKey]
  if (ledger.schema !== 'storyforge.product-production-budget-ledger' || ledger.version !== 2
    || !Number.isSafeInteger(ledger.rootRunId) || ledger.rootRunId! < 1 || claim?.runId !== input.taskRunId
    || claim.attempt !== input.attempt || claim.status !== 'claimed' || claim.idempotencyKey !== input.idempotencyKey) {
    throw new Error('[avg-voice] 配音子 Run 没有当前预算 ledger 的准确领取')
  }
  const child = await readAgentRunV1(input.scope, input.taskRunId), root = await readAgentRunV1(input.scope, ledger.rootRunId!)
  const boundary = child.contract.scope.productProduction, rootBoundary = root.contract.scope.productProduction
  const skill = input.task.executionMode === 'media-provider' ? getAgentSkillV1('avg.media-request.v1') : null
  const expectedBindings = skill ? [{ stepId: input.task.taskKey, ...createAgentSkillExecutionBindingV1(skill) }] : []
  const writes = skill ? skill.writeTargets.map(target => ({ table: target.table, fields: [...target.fields], mode: 'candidate-only',
    ...(target.adoptionExtension ? { adoptionExtension: target.adoptionExtension } : {}) }))
    : [{ table: 'productBuildArtifacts', fields: [], mode: 'candidate-only', adoptionExtension: 'product-production-artifacts' }]
  if (child.run.productBuildId !== input.buildId || child.projection.state !== 'running'
    || child.run.parentRunId !== root.run.id || child.run.parentRelation !== `task:${input.task.taskKey}`
    || boundary?.productBuildId !== input.buildId || boundary.buildNumber !== input.buildNumber
    || boundary.controlEpoch !== input.controlEpoch || boundary.planHash !== input.planHash || boundary.taskKey !== input.task.taskKey
    || child.projection.steps[input.task.taskKey]?.status !== 'running' || child.projection.steps[input.task.taskKey]?.attempt !== input.attempt
    || canonicalProductProductionJsonV2(child.contract.executionBindings ?? []) !== canonicalProductProductionJsonV2(expectedBindings)
    || canonicalProductProductionJsonV2(child.contract.permissions.writeTargets) !== canonicalProductProductionJsonV2(writes)
    || root.run.productBuildId !== input.buildId || root.run.parentRunId != null || root.projection.state !== 'running'
    || rootBoundary?.productBuildId !== input.buildId || rootBoundary.buildNumber !== input.buildNumber
    || rootBoundary.controlEpoch !== input.controlEpoch || rootBoundary.planHash !== input.planHash || rootBoundary.taskKey !== '$root') {
    throw new Error('[avg-voice] 实际 root/子 Run、Skill 快照或候选写域与当前任务不一致')
  }
}

/** Uses the existing actual author-adoption/start/SourcePlan reader. A private
 * V3 declaration or supplied input Artifact alone cannot grant source/dispatch
 * authority. Commands still refuse new V3 production until its complete
 * execution/adoption slice is enabled; a readable Brief grants no start.
 */
export async function readAvgVoiceTaskSourcesV3(input: ProductProductionTaskExecutionInputV1, brief: AvgVoiceProductionBriefV3) {
  const resolved = await assertAvgStoredAssemblyBriefV3(brief.avgAssembly)
  assertAvgVoiceProductionPolicyV3({ ...brief, avgAssembly: resolved.assembly })
  const build = await db.productBuilds.get(input.buildId)
  if (!build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })
    || build.productionId !== input.productionId || build.buildNumber !== input.buildNumber || build.status !== 'building'
    || build.controlEpoch !== input.controlEpoch || build.planHash !== input.planHash
    || build.briefHash !== await hashProductProductionValueV2(brief)) throw new Error('[avg-voice] 配音任务的 Build、冻结 Brief 或来源已 stale')
  const production = await db.productProductions.get(input.productionId)
  if (!production || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })
    || production.productType !== 'avg' || production.status !== 'producing' || production.controlEpoch !== input.controlEpoch
    || production.currentBuildNumber !== input.buildNumber) throw new Error('[avg-voice] 配音任务不属于当前 AVG 作品生产')
  await assertHarnessClaim(input, build.budgetLedgerJson)
  await validateAvgVoiceRecoveryV1({ scope: input.scope, productionId: input.productionId, brief, targetBuild: build,
    checkProspectiveRequests: false })
  const accepted = await readAvgSystemPlanForCompilationV1({ scope: input.scope, buildId: input.buildId,
    expectedBuildRevision: build.stateRevision, controlEpoch: input.controlEpoch, includeSceneScripts: true })
  const required = new Set(resolved.assembly.voice.batch.requirements.map(r => r.script.artifactKey))
  await validateAvgVoiceProductionSourcesV1(resolved.assembly.voice.batch,
    { systemPlan: accepted.plan, scripts: accepted.scripts.map(s => s.payload) },
    accepted.scripts.filter(s => required.has(s.artifact.artifactKey)).map(s => ({ ...s.artifact, payload: s.payload })))
  const refs = [accepted.artifact, ...accepted.scripts.map(s => s.artifact)]
  const actual = input.inputArtifacts.map(row => ({ artifactKey: row.artifactKey, version: row.version, contentHash: row.contentHash }))
  const sort = (rows: typeof refs) => [...rows].sort((a, b) => a.artifactKey < b.artifactKey ? -1 : a.artifactKey > b.artifactKey ? 1 : 0)
  if (canonicalProductProductionJsonV2(sort(refs)) !== canonicalProductProductionJsonV2(sort(actual))) {
    throw new Error('[avg-voice] Harness 输入不是准确的已采用规则和规范脚本')
  }
  const current = await db.productBuilds.get(input.buildId), owner = await db.productProductions.get(input.productionId)
  if (!current || !owner || current.controlEpoch !== input.controlEpoch || current.planHash !== input.planHash
    || current.status !== 'building' || current.briefHash !== build.briefHash || owner.controlEpoch !== input.controlEpoch
    || owner.status !== 'producing' || owner.currentBuildNumber !== input.buildNumber) throw new Error('[avg-voice] 配音来源校验期间生产状态已变化')
  return { ...resolved, accepted }
}
