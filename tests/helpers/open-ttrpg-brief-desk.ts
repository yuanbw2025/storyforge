import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from './open-ttrpg-session'
import { recordTtrpgOpenNarrativeMemoryV1 } from '../../src/lib/ttrpg/runtime-commands'

export async function seedTtrpgOpenBriefDeskV1(humanGm = false) {
  const f = await readyOpenTtrpgSessionV1('旧港冒险复盘', p => {
    p.ttrpg!.campaign.gmMode = humanGm ? 'human' : 'ai'
    p.ttrpg!.campaign.runtimePolicy.enabled = true
    p.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    p.ttrpg!.campaign.characterTemplates[1].controller = 'hybrid'
  })
  const host = { scope: f.scope, sessionId: f.sessionId, viewerKey: humanGm ? 'viewer.gm' : OPEN_HUMAN_VIEWER }
  for (const gm of [false, true]) {
    const e = await openEnvelopeV1(f.sessionId, gm ? 'brief.desk.gm.note' : 'brief.desk.shared.note')
    await recordTtrpgOpenNarrativeMemoryV1({ ...e, viewerKey: gm ? host.viewerKey : OPEN_HUMAN_VIEWER,
      draft: { revisionKey: gm ? 'brief-desk.gm' : 'brief-desk.shared', observerKey: gm ? 'gm' : 'hero', reliability: 'belief',
        audience: gm ? 'gm-only' : 'party', knownBy: [], summary: gm ? 'GM-PRIVATE-BRIEF-DESK-EXCLUDED' : '英雄怀疑旧港的船只被人动过，尚未确认。',
        fromEventSequence: 1, toEventSequence: e.baseSequence } })
  }
  return { f, host, other: { ...host, viewerKey: 'viewer.seat.companion.1' } }
}
