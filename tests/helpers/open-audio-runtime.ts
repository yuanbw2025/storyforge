/** Isolated real commands with a small generated silent WAV. No provider or human-play evidence. */
import { seedOpenTtrpgSessionV1, configureOpenSeatsV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from './open-ttrpg-session'
import { readTtrpgSessionParticipantsV2, configureTtrpgSessionParticipantV2 } from '../../src/lib/ttrpg/participants'
import { completeTtrpgOpenSessionZeroV1, startTtrpgOpenRunV1, changeTtrpgSituationV1, startTtrpgOpenEpochV1,
  startTtrpgOpenOperationV1, recordTtrpgOpenHumanNarrationV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { approve, operationInput, rt } from './open-ttrpg-branch-recovery'
import { resumeTtrpgOpenPlayV1 } from '../../src/lib/ttrpg/open-play-coordinator'
import type { TtrpgOpenAudioRequestV1 } from '../../src/lib/ttrpg/open-audio-contract'

export function audioWavFixtureV1(durationMs = 250): Blob {
  const frames = Math.round(8000 * durationMs / 1000), bytes = new ArrayBuffer(44 + frames * 2), v = new DataView(bytes)
  const ascii = (offset: number, text: string) => Array.from(text).forEach((char, index) => v.setUint8(offset + index, char.charCodeAt(0)))
  ascii(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 16000, true)
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); ascii(36, 'data'); v.setUint32(40, frames * 2, true)
  return new Blob([bytes], { type: 'audio/wav' })
}
export async function setupAudioRuntimeV1(humanGm = true, narrationText = '你们确认了门口留下的线索。') {
  const f = await seedOpenTtrpgSessionV1('real P10 audio runtime', pkg => {
    const c = pkg.ttrpg!.campaign
    c.gmMode = humanGm ? 'human' : 'ai'; c.runtimePolicy.enabled = !humanGm
    pkg.ttrpg!.rulePack.content.actions[0].effects = []
    pkg.ttrpg!.rulePack.content.timePolicy.existingAction = 1; pkg.ttrpg!.rulePack.content.timePolicy.actionOverrides = []
    for (const s of c.situationTemplates) {
      s.consequences = []; s.obstacles = s.obstacles.map(o => ({ ...o, predicate: { op: 'world-turn-at-least', value: 20 } }))
      s.noInterventionOutcome.afterWorldTurns = 20
    }
  })
  await configureOpenSeatsV1(f.sessionId)
  for (const row of await readTtrpgSessionParticipantsV2(f.sessionId)) await configureTtrpgSessionParticipantV2({ sessionId: f.sessionId, seatKey: row.seatKey,
    expectedRevision: row.revision, commandId: `audio.share.${row.seatKey}`, requestedByViewerKey: row.controller === 'ai' ? 'viewer.gm' : row.viewerKey, consent: { publicSharingAllowed: true } })
  const viewerKey = humanGm ? 'viewer.gm' : OPEN_HUMAN_VIEWER, zeroState = rt(await readProductRuntimeState(f.sessionId))
  await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(f.sessionId, 'audio.zero'), viewerKey,
    acceptedItemKeys: zeroState.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
  await startTtrpgOpenRunV1({ ...await openEnvelopeV1(f.sessionId, 'audio.start'), viewerKey })
  const template = f.campaign.situationTemplates[0], action = f.runtimePackage.ttrpg!.rulePack.content.actions[0]
  await changeTtrpgSituationV1({ ...await openEnvelopeV1(f.sessionId, 'audio.opening'), templateKey: template.templateKey, activationReason: 'opening', mode: 'activated' })
  await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'audio.action.epoch'), viewerKey: OPEN_HUMAN_VIEWER, triggerKind: 'submit-action', rawInput: '检查门口线索' })
  const started = rt(await readProductRuntimeState(f.sessionId))
  await startTtrpgOpenOperationV1({ ...await openEnvelopeV1(f.sessionId, 'audio.action'), viewerKey: OPEN_HUMAN_VIEWER,
    request: { route: 'existing-action', actorKey: 'hero', controllerMode: 'human', ruleKey: action.key,
      targetKey: action.target === 'self' ? 'hero' : action.target === 'scene' ? null : 'keeper', effectBindings: {},
      discovery: { situationKey: started.openRun!.situations.active[0].situationKey, evidenceRef: template.evidence[0].clueRef,
        interventionPointKey: template.interventionPoints[0].pointKey, effectBindings: {} } } })
  const operation = rt(await readProductRuntimeState(f.sessionId)).openRun!.operations[0]
  await approve(f.sessionId, operation.operationKey)
  const command = { sessionId: f.sessionId, operationKey: operation.operationKey, frozenPlanHash: operation.planHash, viewerKey: OPEN_HUMAN_VIEWER }
  const before = await resumeTtrpgOpenPlayV1(command)
  if (before.status !== 'awaiting-narration') throw new Error('Expected actual narration boundary: ' + JSON.stringify(before))
  const text = narrationText
  await recordTtrpgOpenHumanNarrationV1({ ...await operationInput(f.sessionId, operation.operationKey, 'narration'), viewerKey, text, reason: 'host-authored' })
  if ((await resumeTtrpgOpenPlayV1(command)).status !== 'completed') throw new Error('Expected completed owner chain')
  const runtime = rt(await readProductRuntimeState(f.sessionId)), narrationSourceRef = runtime.openRun!.narrations![0].sourceRef
  const owner = { scope: f.scope, sessionId: f.sessionId, viewerKey }
  const request = (submissionKey: string, channel: TtrpgOpenAudioRequestV1['channel'] = 'music', audience: TtrpgOpenAudioRequestV1['audience'] = 'party'): TtrpgOpenAudioRequestV1 => ({
    action: 'play', channel, audience, privateActorKey: audience === 'private' ? 'hero' : null, narrationSourceRef, fade: 0,
    voiceTimeline: channel === 'voice' ? { granularity: 'char', speakerVoiceId: 'voice.fixture', styleKey: null, styleDegree: null,
      marks: [{ textOffset: 0, textLength: text.length, startMs: 0, durationMs: 250 }] } : null, media: { kind: 'upload', submissionKey } })
  return { f, owner, command, request, text, narrationSourceRef }
}
