/** Genuine isolated discovery/settlement using existing owners, not normal author or human acceptance. */
import { setup, start } from './open-ttrpg-knowledge'
import { operationInput } from './open-ttrpg-branch-recovery'
import { OPEN_HUMAN_VIEWER, openEnvelopeV1 } from './open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import { recordTtrpgOpenHumanNarrationV1, closeTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'

export async function setupClueSharingDeskV1() {
  const f = await setup({ private: true, generic: true, failForward: true }, pkg => {
    const c = pkg.ttrpg!.campaign
    c.gmMode = 'human'; c.characterTemplates.find(row => row.characterKey === 'companion.2')!.controller = 'hybrid'
    c.characterTemplates.find(row => row.characterKey === 'keeper')!.gmProfile!.secret = 'CLUE-SHARING-GM-SECRET'
    for (const t of c.situationTemplates) {
      t.consequences = []; t.obstacles = t.obstacles.map(row => ({ ...row, predicate: { op: 'world-turn-at-least', value: 20 } }))
      t.noInterventionOutcome.afterWorldTurns = 20
    }
  })
  const command = await start(f)
  if ((await resumeTtrpgOpenPlayV1(command)).status !== 'awaiting-narration') throw new Error('Expected actual narration boundary')
  await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(f.sessionId, command.operationKey, 'narration'), viewerKey: 'viewer.gm', text: '你实际核对了门口的线索。', reason: 'host-authored' })
  if ((await resumeTtrpgOpenPlayV1(command)).status !== 'completed') throw new Error('Expected fully settled discovery')
  const before = await readProductRuntimeState(f.sessionId), run = before.ttrpg!.openRun!
  await closeTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'clue.setup.close'), viewerKey: OPEN_HUMAN_VIEWER,
    epochKey: run.coordination.activeEpochKey!, reason: '明确结束原行动窗口' })
  return { f, input: { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER }, root: run.knowledge[0] }
}
