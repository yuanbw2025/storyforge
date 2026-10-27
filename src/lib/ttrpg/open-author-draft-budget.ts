/** Exact existing author-command authority for a zero-provider budget claim. */
import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 as canonical, hashProductProductionValueV2 as hash } from '../product-production/hash'
import { parseProductProductionCommandV1 } from '../product-production/contracts'
import { validateProductProductionRecoveryDirectiveV1 } from '../product-production/context'

export async function assertTtrpgOpenAuthorDraftBudgetAuthorityV1(input: {
  scope: WorkspaceScope; productionId: number; buildId: number; controlEpoch: number; taskKey: string; failureJson: string
}): Promise<void> {
  const failure = JSON.parse(input.failureJson)
  if (failure.code === 'author-revised-content') {
    await validateProductProductionRecoveryDirectiveV1({ scope: input.scope, productProductionId: input.productionId,
      productBuildId: input.buildId, productProductionTaskKey: input.taskKey, expectedState: 'resolved' })
    return
  }
  const fail = () => { throw Error('[ttrpg-author-budget] 作者命令回执、草稿或制作轮次已变化') }
  if (failure.blockerKey !== input.taskKey || failure.resolution?.action !== 'author-edit'
    || typeof failure.commandId !== 'string') return fail()
  const receipt = await db.productProductionCommands.where('[productionId+commandId]')
    .equals([input.productionId, failure.commandId]).first()
  if (!receipt || !await assertRecordInScope(input.scope, 'productProductionCommands', receipt, { owner: 'work' })
    || receipt.type !== 'resolve-blocker' || receipt.status !== 'succeeded' || receipt.expectedStateRevision == null) return fail()
  const result = JSON.parse(receipt.resultJson), { unknownResultAccounting, ...resolution } = failure.resolution
  if (unknownResultAccounting != null) {
    if (canonical(unknownResultAccounting) !== canonical(failure.unknownResultAccounting)
      || canonical(unknownResultAccounting) !== canonical(result.unknownResultAccounting)) return fail()
    resolution.unknownResultReservation = { runId: unknownResultAccounting.runId, attempt: unknownResultAccounting.attempt,
      controlEpoch: unknownResultAccounting.controlEpoch, disposition: unknownResultAccounting.requestedDisposition }
  }
  const command = parseProductProductionCommandV1({ type: 'resolve-blocker', commandId: failure.commandId,
    expectedStateRevision: receipt.expectedStateRevision, blockerKey: input.taskKey, resolution })
  const build = await db.productBuilds.get(input.buildId)
  if (!build || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })
    || build.productionId !== input.productionId || build.controlEpoch !== input.controlEpoch || build.failureJson !== input.failureJson
    || result.buildNumber !== build.buildNumber || result.controlEpoch !== input.controlEpoch
    || result.blockerKey !== input.taskKey || result.action !== 'author-edit' || await hash(command) !== receipt.payloadHash) return fail()
}
