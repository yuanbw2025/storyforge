/** Frozen protocol fixture; never claimed as normal model production or human acceptance. */
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { setupChecksFixtureV1 } from './open-ttrpg-checks'
import { operationInput, rt } from './open-ttrpg-branch-recovery'
import { closeTtrpgOpenStageV1, recordTtrpgOpenHumanNarrationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { resumeTtrpgOpenChecksV1 } from '../../src/lib/ttrpg/open-checks-coordinator'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { finishTtrpgOpenTableWindowV1 } from '../../src/lib/ttrpg/open-table-service'

export async function setupClosedStageOpeningV1(released = false) {
  const f = await setupChecksFixtureV1({ closure: true, ai: true, released })
  await resumeTtrpgOpenChecksV1(f.command)
  await closeTtrpgOpenStageV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'stage.close'), summary: '确认第一阶段收束，保留原时间和线索' })
  await resumeTtrpgOpenChecksV1(f.command)
  await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(f.command.sessionId, f.command.operationKey, 'narration'), text: '队伍整理了这一阶段已确认的线索。', reason: 'host-authored' })
  await resumeTtrpgOpenPlayV1(f.command)
  await finishTtrpgOpenTableWindowV1({ scope: f.f.scope, sessionId: f.command.sessionId, viewerKey: f.command.viewerKey })
  const state = await readProductRuntimeState(f.command.sessionId)
  const session = (await db.productRuntimeSessions.get(f.command.sessionId))!
  const content = f.f.runtimePackage.ttrpg!
  const templateKeys = [rt(state).openRun!.situations.active[0].templateKey]
  return { f, input: { state, content, runtimeSourceHash: session.runtimeSourceHash, viewerKey: f.command.viewerKey, commandId: 'next-stage.explicit', templateKeys } }
}
