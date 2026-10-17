import { describe, expect, it } from 'vitest'
import {
  applyTtrpgAudioCueAppliedEventV1,
  canViewTtrpgAudioAudienceV1,
  createTtrpgAudioStateV1,
  filterTtrpgAudioStateForAudienceV1,
  planTtrpgAudioRequestsV1,
  projectTtrpgAudioForAudienceV1,
  replayTtrpgAudioEventsV1,
  resolveTtrpgAudioRequestV1,
  splitTtrpgVoiceTextV1,
  type TtrpgAudioCueV1,
  type TtrpgAudioCueAppliedEventV1,
} from '../../src/lib/ttrpg/open-audio-runtime'

function voiceCue(overrides: Partial<TtrpgAudioCueV1> = {}): TtrpgAudioCueV1 {
  const text = overrides.text ?? '潮声压过了灯室里的低语。'
  return {
    cueKey: 'cue.voice.1',
    slotKey: 'voice.room',
    kind: 'voice',
    channel: 'voice',
    audience: 'party',
    targetRef: 'actor.kp',
    text,
    fallbackText: '主持人继续用文字描述灯室里的声音。',
    assetKey: null,
    voiceTimeline: {
      granularity: 'char',
      marks: [{ textOffset: 0, textLength: text.length, startMs: 0, durationMs: 2_000 }],
      speakerVoiceId: 'voice.kp',
      styleKey: null,
      styleDegree: null,
    },
    ...overrides,
  }
}

function event(overrides: Partial<TtrpgAudioCueAppliedEventV1> = {}): TtrpgAudioCueAppliedEventV1 {
  return {
    type: 'ttrpg.audio.cue.applied',
    eventSequence: 1,
    commandId: 'audio.cue.1',
    worldTurn: 4,
    slotKey: 'voice.room',
    channel: 'voice',
    action: 'play',
    fade: 120,
    audience: 'private',
    targetRef: 'actor.aria',
    assetKey: 'asset.voice.aria',
    fallbackText: '阿莉娅的语音暂不可用。',
    voiceTimeline: {
      granularity: 'char',
      marks: [{ textOffset: 0, textLength: 6, startMs: 0, durationMs: 1_000 }],
      speakerVoiceId: 'voice.aria',
      styleKey: null,
      styleDegree: null,
    },
    ...overrides,
  }
}

describe('R-TTRPGOPEN10 P10 audio nonblocking contract', () => {
  it('splits voice requests at 2000 characters and caps a worldTurn at three requests', () => {
    const text = '长音节。'.repeat(1_200)
    const parts = splitTtrpgVoiceTextV1({
      text,
      voiceTimeline: {
        granularity: 'char',
        marks: [{ textOffset: 0, textLength: text.length, startMs: 0, durationMs: 12_000 }],
        speakerVoiceId: 'voice.kp',
        styleKey: null,
        styleDegree: null,
      },
    })
    expect(parts.every(part => part.text.length <= 2_000)).toBe(true)
    expect(parts.map(part => part.text).join('')).toBe(text)

    const plan = planTtrpgAudioRequestsV1({
      worldTurn: 7,
      cues: [voiceCue({ text }), voiceCue({
        cueKey: 'cue.voice.2',
        slotKey: 'voice.2',
        targetRef: 'actor.aria',
      })],
    })
    expect(plan.requests).toHaveLength(3)
    expect(plan.requests.every(request => request.text.length <= 2_000)).toBe(true)
    expect(plan.fallbacks).toEqual([
      expect.objectContaining({
        cueKey: 'cue.voice.2',
        reason: 'world-turn-request-budget',
      }),
    ])
    expect(plan.blocking).toBe(false)
    expect(plan.rollsBackResolution).toBe(false)
    expect(plan.reservesResources).toBe(false)
  })

  it('uses fallbackText for missing, failed, and malformed voice delivery without throwing', () => {
    const missing = planTtrpgAudioRequestsV1({
      worldTurn: 1,
      cues: [voiceCue({ availability: 'missing' })],
    })
    expect(missing.requests).toHaveLength(0)
    expect(missing.fallbacks[0]).toMatchObject({
      fallbackText: '主持人继续用文字描述灯室里的声音。',
      reason: 'missing',
    })

    const request = planTtrpgAudioRequestsV1({
      worldTurn: 1,
      cues: [voiceCue()],
    }).requests[0]!
    expect(resolveTtrpgAudioRequestV1({
      request,
      status: 'failed',
    })).toMatchObject({
      status: 'fallback',
      displayText: request.fallbackText,
      assetKey: null,
    })
    expect(resolveTtrpgAudioRequestV1({
      request,
      status: 'available',
      assetKey: 'asset.voice.1',
    })).toMatchObject({
      status: 'audio',
      displayText: null,
      assetKey: 'asset.voice.1',
    })

    const noTimeline = planTtrpgAudioRequestsV1({
      worldTurn: 1,
      cues: [voiceCue({ voiceTimeline: null })],
    })
    expect(noTimeline.fallbacks[0]).toMatchObject({
      reason: 'voice-timeline-missing',
    })
  })

  it('replays the audio event stream and filters the recovered state by the closed audience set', () => {
    const initial = createTtrpgAudioStateV1()
    const events = [
      event(),
      event({
        eventSequence: 2,
        commandId: 'audio.cue.2',
        slotKey: 'bgm.harbor',
        channel: 'music',
        audience: 'public',
        targetRef: 'scene.harbor',
        assetKey: 'asset.bgm.harbor',
        fallbackText: '港口背景音乐暂不可用。',
        voiceTimeline: null,
      }),
    ]
    const replayed = replayTtrpgAudioEventsV1(initial, events)
    expect(replayed.channels.voice?.voiceTimeline?.speakerVoiceId).toBe('voice.aria')
    expect(replayed.channels.music?.assetKey).toBe('asset.bgm.harbor')
    expect(replayed.lastEventSequence).toBe(2)
    expect(initial).toEqual(createTtrpgAudioStateV1())
    expect(events[0]!.voiceTimeline?.marks[0]!.textOffset).toBe(0)

    const aria = projectTtrpgAudioForAudienceV1(replayed, {
      role: 'player',
      actorKey: 'actor.aria',
    })
    expect(aria.channels.voice?.slotKey).toBe('voice.room')
    expect(aria.channels.music?.slotKey).toBe('bgm.harbor')

    const spectator = filterTtrpgAudioStateForAudienceV1(replayed, {
      role: 'spectator',
      actorKey: null,
    })
    expect(spectator.channels.voice).toBeNull()
    expect(spectator.channels.music?.slotKey).toBe('bgm.harbor')
  })

  it('keeps audience validation closed and does not let private audio cross actor boundaries', () => {
    expect(canViewTtrpgAudioAudienceV1('private', {
      role: 'player',
      actorKey: 'actor.aria',
    }, 'actor.aria')).toBe(true)
    expect(canViewTtrpgAudioAudienceV1('private', {
      role: 'player',
      actorKey: 'actor.borin',
    }, 'actor.aria')).toBe(false)
    expect(() => canViewTtrpgAudioAudienceV1(
      'friends-only' as never,
      { role: 'player', actorKey: 'actor.aria' },
      'actor.aria',
    )).toThrow(/闭集/)
    expect(() => planTtrpgAudioRequestsV1({
      worldTurn: 1,
      cues: [voiceCue({ audience: 'friends-only' as never })],
    })).toThrow(/闭集/)
  })

  it('applies a stop cue immutably so replay never touches rule resolution state', () => {
    const played = applyTtrpgAudioCueAppliedEventV1(createTtrpgAudioStateV1(), event())
    const stopped = applyTtrpgAudioCueAppliedEventV1(played, event({
      eventSequence: 2,
      commandId: 'audio.stop.1',
      action: 'stop',
      assetKey: null,
      voiceTimeline: null,
    }))
    expect(played.channels.voice).not.toBeNull()
    expect(stopped.channels.voice).toBeNull()
    expect(stopped.lastEventSequence).toBe(2)
  })
})
