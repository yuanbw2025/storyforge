import { beforeEach, afterEach, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedOpenTtrpgSessionV1, configureOpenSeatsV1, openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { configureTtrpgSessionParticipantV2, readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'
import { completeTtrpgOpenSessionZeroV1, startTtrpgOpenRunV1 } from '../../src/lib/ttrpg/runtime-commands'
import { parseTtrpgOpenAuthorizationV1, type TtrpgOpenAuthorizationV1 } from '../../src/lib/ttrpg/open-authorization'
import { createTtrpgOpenAudioScopeV1, assertTtrpgOpenAudioScopeAuthorityV1, parseTtrpgOpenAudioScopeV1,
  parseTtrpgOpenScopedAudioEventV1, projectTtrpgOpenScopedAudioV1, projectTtrpgOpenAudioTransitionsV1, type TtrpgOpenScopedAudioEventV1 } from '../../src/lib/ttrpg/open-audio-scope'
import type { TtrpgAudioAudienceV1 } from '../../src/lib/ttrpg/open-audio-runtime'

async function setup(humanGm = true, publicAllowed = true) {
  const f = await seedOpenTtrpgSessionV1('P10 pure audio scope foundation', pkg => {
    if (humanGm) pkg.ttrpg!.campaign.gmMode = 'human'
  })
  await configureOpenSeatsV1(f.sessionId)
  if (publicAllowed) {
    for (const row of await readTtrpgSessionParticipantsV2(f.sessionId)) {
      await configureTtrpgSessionParticipantV2({ sessionId: f.sessionId, seatKey: row.seatKey,
        expectedRevision: row.revision, commandId: `audio.public.${row.seatKey}`, requestedByViewerKey: row.controller === 'ai' ? 'viewer.gm' : row.viewerKey,
        consent: { publicSharingAllowed: true } })
    }
  }
  const state = await readProductRuntimeState(f.sessionId), viewerKey = humanGm ? 'viewer.gm' : OPEN_HUMAN_VIEWER
  await completeTtrpgOpenSessionZeroV1({ ...await openEnvelopeV1(f.sessionId, 'audio.zero'), viewerKey,
    acceptedItemKeys: state.ttrpg!.product.sessionZero.requiredItemKeys, selectedCharacterKeys: ['hero', 'companion.1', 'companion.2'] })
  await startTtrpgOpenRunV1({ ...await openEnvelopeV1(f.sessionId, 'audio.start'), viewerKey })
  const before = await readProductRuntimeState(f.sessionId), authorization = parseTtrpgOpenAuthorizationV1(before.ttrpg!.authorization)
  const scope = (audience: TtrpgAudioAudienceV1, privateActorKey: string | null = null) => createTtrpgOpenAudioScopeV1({ authorization, viewerKey, audience, privateActorKey })
  const frame = (sequence: number, audience: TtrpgAudioAudienceV1, options: Partial<TtrpgOpenScopedAudioEventV1['event']> = {}) => {
    const sourceRef = { sessionKey: authorization.sourceRef.sessionKey, sequence: authorization.revision + sequence }
    return parseTtrpgOpenScopedAudioEventV1({ schema: 'storyforge.ttrpg-open-scoped-audio', version: 1, sourceRef,
      scope: scope(audience, audience === 'private' ? 'hero' : null), event: {
        type: 'ttrpg.audio.cue.applied', eventSequence: sourceRef.sequence, commandId: `audio.test.${sequence}`, worldTurn: 1,
        slotKey: `audio.${audience}`, channel: 'music', action: 'play', fade: 100, audience,
        targetRef: audience === 'private' ? 'hero' : `audio.${audience}`, assetKey: `asset.${audience}`,
        fallbackText: `${audience} fallback`, voiceTimeline: null, ...options } })
  }
  return { f, authorization, before, scope, frame }
}
const human = (viewerKey = OPEN_HUMAN_VIEWER) => ({ kind: 'human' as const, viewerKey })
function replacement(authorization: TtrpgOpenAuthorizationV1, viewerKey: string) {
  const copy = structuredClone(authorization)
  copy.seats.find(row => row.actorKey === 'hero')!.viewerKey = viewerKey
  if (copy.completedBySeatKey === copy.seats.find(row => row.actorKey === 'hero')!.seatKey) copy.viewerKey = viewerKey
  return parseTtrpgOpenAuthorizationV1(copy)
}

describe('R-TTRPGOPEN10 scoped audio recipient and replay foundation (no formal dispatch)', () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('freezes the actual Session Zero recipients including AI, and performs no runtime/media/model write', async () => {
    const s = await setup(), events = await db.productRuntimeEvents.count(), media = await db.productMediaAssets.count(), runs = await db.agentRuns.count()
    const scope = s.scope('party')
    expect(scope.recipients.map(row => row.actorKey).sort()).toEqual([null, 'hero', 'companion.1', 'companion.2'].sort())
    expect(scope.authorizationRef).toEqual(s.authorization.sourceRef)
    expect(() => assertTtrpgOpenAudioScopeAuthorityV1(scope, s.authorization)).not.toThrow()
    expect(await readProductRuntimeState(s.f.sessionId)).toEqual(s.before)
    expect([await db.productRuntimeEvents.count(), await db.productMediaAssets.count(), await db.agentRuns.count()]).toEqual([events, media, runs])
  })
  it('requires the real human host, public consent, and a real private target; AI-host fallback has no private-GM grant', async () => {
    const s = await setup(true, false)
    expect(() => s.scope('public')).toThrow(/公开分享/)
    expect(() => s.scope('private', 'not.selected')).toThrow(/活动角色/)
    expect(() => s.scope('party', 'hero')).toThrow(/仅私密/)
    expect(() => createTtrpgOpenAudioScopeV1({ authorization: s.authorization, viewerKey: OPEN_HUMAN_VIEWER, audience: 'party', privateActorKey: null })).toThrow(/人工主持/)
    const a = await setup(false, false)
    expect(() => a.scope('party')).not.toThrow()
    expect(() => a.scope('gm-only')).toThrow(/实际真人 GM/)
    expect(() => a.scope('private', 'hero')).toThrow(/实际真人 GM/)
  })
  it('rejects caller-narrowed, widened, replaced-viewer, and self-stated authority envelopes', async () => {
    const s = await setup(), scope = s.scope('party')
    const narrowed = { ...scope, recipients: scope.recipients.filter(row => row.actorKey !== 'companion.1') }
    expect(() => assertTtrpgOpenAudioScopeAuthorityV1(narrowed, s.authorization)).toThrow(/准确接收者/)
    const changed = replacement(s.authorization, 'viewer.other.owner')
    expect(() => assertTtrpgOpenAudioScopeAuthorityV1(scope, changed)).toThrow(/准确接收者/)
    expect(() => parseTtrpgOpenAudioScopeV1({ ...scope, runtimeAuthority: true })).toThrow(/字段不精确/)
    const duplicate = { ...scope, recipients: [...scope.recipients, scope.recipients[0]] }
    expect(() => parseTtrpgOpenAudioScopeV1(duplicate)).toThrow(/重复/)
  })
  it('keeps public music for other listeners; ending a private overlay reveals the still-playing common track', async () => {
    const s = await setup(), publicCue = s.frame(1, 'public'), privateCue = s.frame(2, 'private')
    const view = (events: TtrpgOpenScopedAudioEventV1[], reader = human()) => projectTtrpgOpenScopedAudioV1({ events, authorization: s.authorization, reader })
    expect(view([publicCue, privateCue]).channels.music?.assetKey).toBe('asset.private')
    expect(projectTtrpgOpenScopedAudioV1({ events: [publicCue, privateCue], authorization: s.authorization, reader: { kind: 'public' } })
      .channels.music?.assetKey).toBe('asset.public')
    const stopped = s.frame(3, 'private', { action: 'stop', assetKey: null })
    expect(view([publicCue, privateCue, stopped]).channels.music?.assetKey).toBe('asset.public')
    expect(view([publicCue, privateCue], human('viewer.gm')).channels.music?.assetKey).toBe('asset.private')
  })
  it('does not expand an old party/private audience to a new viewer or an AI listener', async () => {
    const s = await setup(), party = s.frame(1, 'party'), privateCue = s.frame(2, 'private'), publicCue = s.frame(3, 'public')
    const authorization = replacement(s.authorization, 'viewer.new.owner')
    const projection = projectTtrpgOpenScopedAudioV1({ events: [party, privateCue, publicCue], authorization, reader: human('viewer.new.owner') })
    expect(projection.channels.music?.assetKey).toBe('asset.public')
    expect(JSON.stringify(projection)).not.toContain('private')
    expect(projectTtrpgOpenScopedAudioV1({ events: [party, privateCue], authorization, reader: human('viewer.new.owner') }).visibleChannelCount).toBe(0)
    const ai = authorization.seats.find(row => row.controller === 'ai')!
    expect(() => projectTtrpgOpenScopedAudioV1({ events: [party], authorization, reader: human(ai.viewerKey) })).toThrow(/当前实际真人/)
    expect(() => projectTtrpgOpenScopedAudioV1({ events: [party], authorization, reader: human() })).toThrow(/当前实际真人/)
    const transferred = structuredClone(s.authorization), originalAi = transferred.seats.find(row => row.controller === 'ai' && row.role === 'player')!
    originalAi.controller = 'human'; originalAi.assignmentState = 'claimed'
    transferred.approvalBindings = transferred.approvalBindings.filter(row => row.companionActorKey !== originalAi.actorKey)
    expect(projectTtrpgOpenScopedAudioV1({ events: [party], authorization: parseTtrpgOpenAuthorizationV1(transferred), reader: human(originalAi.viewerKey) }).visibleChannelCount).toBe(0)
  })
  it('isolates all four channels and ignores an old-slot stop after replacement', async () => {
    const s = await setup(), events = [s.frame(1, 'party'), s.frame(2, 'party', { slotKey: 'audio.new', assetKey: 'asset.new' }),
      s.frame(3, 'party', { action: 'stop', assetKey: null }), s.frame(4, 'party', { channel: 'ambience' }),
      s.frame(5, 'party', { channel: 'sfx' }), s.frame(6, 'party', { channel: 'voice', assetKey: null, fallbackText: 'voice unavailable' })]
    const result = projectTtrpgOpenScopedAudioV1({ events, authorization: s.authorization, reader: human() })
    expect(result.visibleChannelCount).toBe(4); expect(result.channels.music?.assetKey).toBe('asset.new')
    expect(result.channels.voice).toMatchObject({ assetKey: null, fallbackText: 'voice unavailable' })
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
  it('rejects scope mismatch, unknown fields, hidden timeline fields, malformed stops and duplicate source events', async () => {
    const s = await setup(), row = s.frame(1, 'party')
    expect(() => parseTtrpgOpenScopedAudioEventV1({ ...row, event: { ...row.event, audience: 'public' } })).toThrow(/受众不一致/)
    expect(() => parseTtrpgOpenScopedAudioEventV1({ ...row, event: { ...row.event, hiddenPrompt: 'secret' } })).toThrow(/字段不精确/)
    expect(() => parseTtrpgOpenScopedAudioEventV1({ ...row, event: { ...row.event, assetKey: undefined } })).toThrow(/audio asset/)
    expect(() => s.frame(2, 'private', { targetRef: 'companion.1' })).toThrow(/受众不一致/)
    expect(() => s.frame(2, 'party', { action: 'stop' })).toThrow(/受众不一致/)
    expect(() => s.frame(2, 'party', { channel: 'voice', voiceTimeline: null })).toThrow(/受众不一致/)
    const voice = s.frame(2, 'party', { channel: 'voice', voiceTimeline: { granularity: 'char', speakerVoiceId: 'voice.one', styleKey: null, styleDegree: null,
      marks: [{ textOffset: 0, textLength: 1, startMs: 0, durationMs: 100 }] } })
    const bad = structuredClone(voice); Object.assign(bad.event.voiceTimeline!.marks[0], { prompt: 'never keep this field' })
    expect(() => parseTtrpgOpenScopedAudioEventV1(bad)).toThrow(/字段不精确/)
    expect(() => projectTtrpgOpenScopedAudioV1({ events: [row, row], authorization: s.authorization, reader: human() })).toThrow(/重复/)
  })
  it('keeps an explicitly supplied lineage order when a child source sequence restarts, without rewriting original envelopes', async () => {
    const s = await setup(), first = s.frame(10, 'party'), child = structuredClone(s.frame(1, 'party', { assetKey: 'asset.child' }))
    child.sourceRef.sessionKey = 'session.child'; child.scope.authorizationRef.sessionKey = 'session.child'
    const before = JSON.stringify([first, child]), result = projectTtrpgOpenScopedAudioV1({ events: [first, child], authorization: s.authorization, reader: human() })
    expect(result.channels.music?.assetKey).toBe('asset.child'); expect(JSON.stringify([first, child])).toBe(before)
    expect(result).not.toHaveProperty('lastEventSequence'); expect(result).not.toHaveProperty('lastWorldTurn')
  })
  it('derives only the actual listener audible change and keeps obsolete stops and hidden layers out of transition evidence', async () => {
    const s = await setup(), publicCue = s.frame(1, 'public', { slotKey: 'public.one', fade: 1000 })
    const hidden = s.frame(2, 'gm-only', { channel: 'sfx', slotKey: 'hidden.effect', fallbackText: 'HIDDEN-TRANSITION-TEXT' })
    const privateCue = s.frame(3, 'private', { slotKey: 'private.one', fade: 2000 })
    const oldStop = s.frame(4, 'public', { action: 'stop', slotKey: 'public.obsolete', assetKey: null, fade: 3000 })
    const stop = s.frame(5, 'private', { action: 'stop', slotKey: 'private.one', assetKey: null, fade: 3000 })
    const events = [publicCue, hidden, privateCue, oldStop, stop]
    const view = (viewerKey: string) => projectTtrpgOpenAudioTransitionsV1({ events, authorization: s.authorization, reader: human(viewerKey) })
    expect(view(OPEN_HUMAN_VIEWER)).toEqual([{ controlRef: stop.sourceRef, channel: 'music', action: 'stop', fade: 3000, fromSlotKey: 'private.one', toSlotKey: 'public.one' }])
    expect(projectTtrpgOpenAudioTransitionsV1({ events, authorization: s.authorization, reader: { kind: 'public' } })).toEqual([{ controlRef: publicCue.sourceRef, channel: 'music', action: 'play', fade: 1000, fromSlotKey: null, toSlotKey: 'public.one' }])
    expect(JSON.stringify(view(OPEN_HUMAN_VIEWER))).not.toContain('HIDDEN-TRANSITION-TEXT')
    expect(projectTtrpgOpenScopedAudioV1({ events, authorization: s.authorization, reader: human() }).channels.music?.slotKey).toBe('public.one')
  })

})
