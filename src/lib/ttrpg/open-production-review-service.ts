/** Read the original current task's completed, rejected draft; never infer or adopt. */
import type { WorkspaceScope } from '../types'
import { readProductProductionDetailsV1, readProductProductionProgressV1,
  readProductProductionTaskEvidenceV1 } from '../product-production/service'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductionModelJsonObjectV1 } from '../product-production/production-executor'
import { inspectProductProductionBuildRecoveryPolicyV1, readProductProductionRecoveryTaskKeyV1 } from '../product-production/recovery-policy'
import { productProductionFailureNeedsProviderAccountingV1 } from '../product-production/scheduler'
import { parseTtrpgOpenProductionReviewDraftV1, normalizeTtrpgOpenSourceFactsForReviewV1, normalizeTtrpgOpenRuleSystemForReviewV1,
  type TtrpgOpenProductionReviewTaskV1 } from './open-production-review'

export interface TtrpgOpenProductionReviewOwnerV1 {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  controlEpoch: number
  planHash: string
  taskKey: TtrpgOpenProductionReviewTaskV1
  runId: number
  attempt: number
}

async function current(input: TtrpgOpenProductionReviewOwnerV1) {
  const details = await readProductProductionDetailsV1(input.scope, input.productionId, ['ttrpg'])
  const { build, production } = details
  const progress = await readProductProductionProgressV1(input)
  const task = progress.tasks.find(item => item.taskKey === input.taskKey)
  if (!build || build.id !== input.buildId || build.controlEpoch !== input.controlEpoch
    || build.planHash !== input.planHash || build.status !== 'recovery-required'
    || production.controlEpoch !== input.controlEpoch
    || progress.buildId !== input.buildId || progress.controlEpoch !== input.controlEpoch
    || progress.planHash !== input.planHash || task?.runId !== input.runId || task.attempt !== input.attempt
    || readProductProductionRecoveryTaskKeyV1(build.failureJson) !== input.taskKey
    || !inspectProductProductionBuildRecoveryPolicyV1({ productType: 'ttrpg', planJson: build.planJson,
      taskKey: input.taskKey }).authorDraftAllowed
    || productProductionFailureNeedsProviderAccountingV1(build)) {
    throw new Error('待审稿已不属于当前作品、制作轮次或任务，请刷新后重新读取。')
  }
  const failure = JSON.parse(build.failureJson)
  const provenance = failure.failureProvenance
  if (failure.code !== 'task-draft-rejected' || provenance?.runId !== input.runId
    || provenance.attempt !== input.attempt || provenance.controlEpoch !== input.controlEpoch
    || provenance.planHash !== input.planHash) {
    throw new Error('当前任务没有可逐项审阅的完整待确认稿；部分、超时或未知回答仍保留在原记录中。')
  }
  const row = details.briefHistory.find(item => item.revision === build.briefRevision)
  if (!row || row.briefHash !== build.briefHash) throw new Error('原授权方案已不一致，请检查制作记录。')
  const brief = parseProductProductionBriefV3(row.briefJson)
  if (!brief.ttrpgOpen || await hashProductProductionValueV2(brief) !== build.briefHash) {
    throw new Error('原跑团方案校验失败，不能读取待审稿。')
  }
  return { brief: brief.ttrpgOpen, stateRevision: production.stateRevision }
}

export async function readTtrpgOpenProductionReviewDraftV1(input: TtrpgOpenProductionReviewOwnerV1): Promise<string> {
  const before = await current(input)
  const rows = await readProductProductionTaskEvidenceV1(input)
  const originals = [...new Set(rows.filter(row => row.kind === 'raw-response' && row.attempt === input.attempt)
    .map(row => row.content))]
  const source = originals.length === 0 ? await import('../product-production/original-response-author-source') : null
  const authored = source ? await source.readProductProductionRejectedOriginalAuthorDraftV1(input) : null
  const retainedInput = source && authored == null ? await source.readProductProductionRejectedAuthorInputV1(input) : null
  if (originals.length !== 1 && authored == null && retainedInput == null) throw new Error(originals.length
    ? '原任务存在不同版本的回答，请先查看制作记录；系统不会替你选择。'
    : '原任务没有完整回答可供逐项审阅；原记录仍保留，可使用高级修订。')
  const value = parseProductionModelJsonObjectV1(authored ?? retainedInput ?? originals[0], input.taskKey)
  const artifact = authored != null ? parseTtrpgOpenProductionReviewDraftV1(input.taskKey, authored, before.brief).artifact
    : input.taskKey === 'ttrpg.open.source-facts'
    ? normalizeTtrpgOpenSourceFactsForReviewV1(value, before.brief)
    : normalizeTtrpgOpenRuleSystemForReviewV1(value, before.brief)
  const text = JSON.stringify(artifact)
  if (text.length > 120_000) throw new Error('完整待审稿超过修订长度上限；请检查原稿，不会自动截断。')
  const after = await current(input)
  if (before.stateRevision !== after.stateRevision) throw new Error('读取期间任务状态已变化，请重新读取。')
  return text
}
