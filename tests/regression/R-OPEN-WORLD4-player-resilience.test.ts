import { describe, expect, it } from 'vitest'
import {
  classifyTextOpenWorldPlayerIssueV1,
  projectTextOpenWorldPlayerPhaseV1,
  textOpenWorldProjectionUnavailableIssueV1,
  textOpenWorldUnsupportedRuntimeIssueV1,
} from '../../src/lib/open-world/player-resilience'

describe('R-OPEN-WORLD4 G4-14 · player resilience contract', () => {
  it('keeps optional model and network failures degraded without locking deterministic gameplay', () => {
    const secret = 'sk-private-provider-key'
    const issue = classifyTextOpenWorldPlayerIssueV1({
      error: new Error(`Provider network timeout: ${secret}`),
      surface: 'optional-ai',
    })

    expect(issue).toMatchObject({
      state: 'degraded',
      code: 'TOW-PLAYER-OPTIONAL-AI',
      retryAllowed: false,
      gameplayAvailability: 'enabled',
      recoveryActions: ['dismiss'],
    })
    expect(JSON.stringify(issue)).not.toContain(secret)
    expect(projectTextOpenWorldPlayerPhaseV1({
      loading: false,
      hasPlayableContent: true,
      issue,
    })).toBe('ready')

    const unknownAiResult = classifyTextOpenWorldPlayerIssueV1({
      error: new Error('provider request outcome unknown after dispatch'),
      surface: 'optional-ai',
    })
    expect(unknownAiResult).toMatchObject({
      state: 'degraded',
      code: 'TOW-PLAYER-OPTIONAL-AI',
      gameplayAvailability: 'enabled',
    })
  })

  it('classifies stale and unknown outcomes as read-only recovery without resubmission', () => {
    const stale = classifyTextOpenWorldPlayerIssueV1({
      error: new Error('确认基线已变化: action.private'),
      surface: 'runtime-operation',
    })
    expect(stale).toMatchObject({
      state: 'recoverable-error',
      code: 'TOW-PLAYER-STALE',
      gameplayAvailability: 'read-only',
      recoveryActions: ['refresh-session', 'return-library'],
    })
    expect(JSON.stringify(stale)).not.toContain('action.private')

    const unknown = classifyTextOpenWorldPlayerIssueV1({
      error: new Error('request outcome unknown: command.secret'),
      surface: 'runtime-operation',
    })
    expect(unknown).toMatchObject({
      code: 'TOW-PLAYER-UNKNOWN-RESULT',
      gameplayAvailability: 'read-only',
      recoveryActions: ['resume-settlement', 'return-library'],
    })
    expect(JSON.stringify(unknown)).not.toContain('command.secret')
  })

  it('fails closed for storage and integrity problems even when the source also mentions a provider', () => {
    const storage = classifyTextOpenWorldPlayerIssueV1({
      error: new Error('IndexedDB QuotaExceededError: row.private'),
      surface: 'optional-ai',
    })
    expect(storage).toMatchObject({
      state: 'blocking-error',
      code: 'TOW-PLAYER-STORAGE',
      gameplayAvailability: 'blocked',
    })

    const integrity = classifyTextOpenWorldPlayerIssueV1({
      error: new Error('Provider failed after 状态hash不一致: deadbeef'),
      surface: 'optional-ai',
    })
    expect(integrity).toMatchObject({
      state: 'blocking-error',
      code: 'TOW-PLAYER-INTEGRITY',
      gameplayAvailability: 'blocked',
    })
    expect(JSON.stringify({ storage, integrity })).not.toMatch(/row\.private|deadbeef/)

    expect(classifyTextOpenWorldPlayerIssueV1({
      error: new Error('请求结果未知 because IndexedDB QuotaExceededError'),
      surface: 'runtime-operation',
    })).toMatchObject({ code: 'TOW-PLAYER-STORAGE', gameplayAvailability: 'blocked' })
    expect(classifyTextOpenWorldPlayerIssueV1({
      error: new Error('outcome unknown because 状态hash不一致'),
      surface: 'runtime-operation',
    })).toMatchObject({ code: 'TOW-PLAYER-INTEGRITY', gameplayAvailability: 'blocked' })
  })

  it('uses an explicit loading, empty, ready, recoverable and blocking phase order', () => {
    const recoverable = classifyTextOpenWorldPlayerIssueV1({
      error: new Error('operation failed'),
      surface: 'runtime-operation',
    })
    const blocking = textOpenWorldProjectionUnavailableIssueV1()

    expect(projectTextOpenWorldPlayerPhaseV1({ loading: true, hasPlayableContent: true, issue: blocking }))
      .toBe('loading')
    expect(projectTextOpenWorldPlayerPhaseV1({ loading: false, hasPlayableContent: false, issue: null }))
      .toBe('empty')
    expect(projectTextOpenWorldPlayerPhaseV1({ loading: false, hasPlayableContent: true, issue: null }))
      .toBe('ready')
    expect(projectTextOpenWorldPlayerPhaseV1({ loading: false, hasPlayableContent: true, issue: recoverable }))
      .toBe('recoverable-error')
    expect(projectTextOpenWorldPlayerPhaseV1({ loading: false, hasPlayableContent: true, issue: blocking }))
      .toBe('blocking-error')
  })

  it('provides stable blocking fallbacks for unsupported packages and failed projections', () => {
    for (const issue of [textOpenWorldUnsupportedRuntimeIssueV1(), textOpenWorldProjectionUnavailableIssueV1()]) {
      expect(issue).toMatchObject({
        state: 'blocking-error',
        code: 'TOW-PLAYER-INTEGRITY',
        gameplayAvailability: 'blocked',
      })
      expect(issue.recoveryActions).toEqual(['refresh-session', 'return-library'])
    }
  })
})
