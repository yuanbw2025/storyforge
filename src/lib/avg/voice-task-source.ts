import { db } from '../db/schema'
import { assertRecordInScope } from '../workspace/scope'
import type { ProductProductionTaskExecutionInputV1 } from '../product-production/scheduler'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { readAvgSystemPlanForCompilationV1 } from './author-artifacts'
import { assertAvgStoredAssemblyBriefV3 } from './voice-assembly-storage'
import { assertAvgVoiceProductionPolicyV3, type AvgVoiceProductionBriefV3 } from './voice-production-policy'
import { validateAvgVoiceProductionSourcesV1 } from './voice-production-source'
import { validateAvgVoiceRecoveryV1 } from './voice-recovery'
import { assertAvgTaskHarnessClaimV1 } from './task-claim'


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
  await assertAvgTaskHarnessClaimV1(input, build.budgetLedgerJson, input.task.executionMode === 'media-provider' ? 'avg.media-request.v1' : null)
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
