import type { ChatResult } from '../ai/client'
import type {
  AgentRunFailureActionV1,
  AgentRunFailureCategoryV1,
} from '../types/agent-run'

export interface TextOpenWorldRuntimeAIExecutionObservationV1 {
  version: 1
  provider: string
  model: string
  routeCategory: string
  startedAt: number
  finishedAt: number
  timedOut: boolean
  requestLifecycle: NonNullable<ChatResult['requestLifecycle']>
  usage: ChatResult['usage'] | null
}

export class TextOpenWorldRuntimeAIExecutionErrorV1 extends Error {
  readonly cause: unknown
  readonly observation: TextOpenWorldRuntimeAIExecutionObservationV1

  constructor(cause: unknown, observation: TextOpenWorldRuntimeAIExecutionObservationV1) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'TextOpenWorldRuntimeAIExecutionErrorV1'
    this.cause = cause
    this.observation = observation
  }
}

export const TEXT_OPEN_WORLD_RUNTIME_AI_FAILURE_KINDS_V1 = [
  'cancelled',
  'stale',
  'budget',
  'insufficient-balance',
  'authorization',
  'rate-limit',
  'provider-unavailable',
  'protocol',
  'unknown-result',
  'configuration',
] as const

export type TextOpenWorldRuntimeAIFailureKindV1 =
  typeof TEXT_OPEN_WORLD_RUNTIME_AI_FAILURE_KINDS_V1[number]

export interface TextOpenWorldRuntimeAIFailureV1 {
  version: 1
  kind: TextOpenWorldRuntimeAIFailureKindV1
  code: string
  category: AgentRunFailureCategoryV1
  action: AgentRunFailureActionV1
  retryable: boolean
  unknownResult: boolean
  possibleCharge: boolean
  message: string
  recovery: string
  fingerprint: string
  requestPhase: 'pre-dispatch' | 'request-dispatched' | 'response-observed' | 'not-observed'
  responseStatus: number | null
}

export class TextOpenWorldRuntimeAIPlayerErrorV1 extends Error {
  readonly cause: unknown
  readonly failure: TextOpenWorldRuntimeAIFailureV1

  constructor(cause: unknown, failure: TextOpenWorldRuntimeAIFailureV1) {
    // Preserve the domain error text for developers and existing regression
    // assertions. Player surfaces must use failure.message/recovery instead.
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'TextOpenWorldRuntimeAIPlayerErrorV1'
    this.cause = cause
    this.failure = failure
  }
}

export function textOpenWorldRuntimeAIPlayerFailureV1(error: unknown): TextOpenWorldRuntimeAIFailureV1 | null {
  return error instanceof TextOpenWorldRuntimeAIPlayerErrorV1 ? error.failure : null
}
