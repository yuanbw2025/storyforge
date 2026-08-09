import type {
  AgentRunStepProjectionV1,
  AnyAgentRunEventV1,
} from '../../types/agent-run'
import type { AgentRunSnapshotV1 } from './event-store'
import {
  CHAPTER_POST_ADOPTION_STEP_IDS_V1,
  type ChapterPostAdoptionStepIdV1,
} from './chapter-post-adoption-durable'

/**
 * HARNESS-42 control-plane decision for a post-adoption step.
 * This module is deliberately side-effect free: it decides what may run;
 * domain handlers remain responsible for context assembly, adoption and DB IO.
 */
export type ChapterPostAdoptionResumeActionV1 =
  | 'skip-succeeded'
  | 'awaiting-confirmation'
  | 'retry-failed'
  | 'blocked-non-retryable'
  | 'blocked-stale'
  | 'inspect-running'
  | 'run-scheduled'
  | 'blocked-dependency'

export interface ChapterPostAdoptionResumeStepV1 {
  stepId: ChapterPostAdoptionStepIdV1
  status: AgentRunStepProjectionV1['status']
  attempt: number
  nextAttempt: number | null
  retryable: boolean | null
  failureCode?: string
  action: ChapterPostAdoptionResumeActionV1
  dependencyStepIds: ChapterPostAdoptionStepIdV1[]
}

export interface ChapterPostAdoptionResumePlanV1 {
  runId: number
  state: AgentRunSnapshotV1['projection']['state']
  terminal: boolean
  canResume: boolean
  blockedReason?: string
  steps: ChapterPostAdoptionResumeStepV1[]
  nextStepId: ChapterPostAdoptionStepIdV1 | null
}

const BASE_STEP_IDS: readonly ChapterPostAdoptionStepIdV1[] = [
  CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization,
  CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory,
  CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval,
]

const DEPENDENCIES: Record<ChapterPostAdoptionStepIdV1, readonly ChapterPostAdoptionStepIdV1[]> = {
  [CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization]: [],
  // Memory reads the same source正文 and may proceed while the author is
  // reviewing the organization candidate, but never before that step has
  // been attempted at least once.
  [CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory]: [],
  [CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval]: [CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory],
  [CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency]: [CHAPTER_POST_ADOPTION_STEP_IDS_V1.retrieval],
}

function stepIds(snapshot: AgentRunSnapshotV1): ChapterPostAdoptionStepIdV1[] {
  return snapshot.contract.executionBindings?.some(binding => (
    binding.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency
  ))
    ? [...BASE_STEP_IDS, CHAPTER_POST_ADOPTION_STEP_IDS_V1.consistency]
    : [...BASE_STEP_IDS]
}

function lastFailure(
  events: readonly AnyAgentRunEventV1[],
  stepId: ChapterPostAdoptionStepIdV1,
): Extract<AnyAgentRunEventV1, { type: 'step.failed' }>['payload'] | null {
  const event = [...events].reverse().find((candidate): candidate is Extract<AnyAgentRunEventV1, { type: 'step.failed' }> => (
    candidate.type === 'step.failed' && candidate.payload.stepId === stepId
  ))
  return event?.payload ?? null
}

function dependencyAction(
  steps: readonly ChapterPostAdoptionResumeStepV1[],
  dependencyStepIds: readonly ChapterPostAdoptionStepIdV1[],
): boolean {
  return dependencyStepIds.every(dependency => (
    steps.find(step => step.stepId === dependency)?.status === 'succeeded'
  ))
}

function classifyStep(
  snapshot: AgentRunSnapshotV1,
  stepId: ChapterPostAdoptionStepIdV1,
  knownSteps: readonly ChapterPostAdoptionResumeStepV1[],
): ChapterPostAdoptionResumeStepV1 {
  const step = snapshot.projection.steps[stepId]
  const dependencyStepIds = [...DEPENDENCIES[stepId]]
  const organization = knownSteps.find(candidate => candidate.stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.organization)
  if (!step) {
    return {
      stepId,
      status: 'scheduled',
      attempt: 0,
      nextAttempt: 1,
      retryable: null,
      action: dependencyAction(knownSteps, dependencyStepIds)
        && (stepId !== CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory || (organization?.attempt ?? 0) > 0)
        ? 'run-scheduled'
        : 'blocked-dependency',
      dependencyStepIds,
    }
  }
  const failure = lastFailure(snapshot.events, stepId)
  const maxAttempts = snapshot.contract.budget.maxAttemptsPerStep
  let action: ChapterPostAdoptionResumeActionV1
  let nextAttempt: number | null = null
  if (step.status === 'succeeded') action = 'skip-succeeded'
  else if (step.status === 'awaiting_confirmation') action = 'awaiting-confirmation'
  else if (step.status === 'stale') action = 'blocked-stale'
  else if (step.status === 'running') action = 'inspect-running'
  else if (
    !dependencyAction(knownSteps, dependencyStepIds)
    || (stepId === CHAPTER_POST_ADOPTION_STEP_IDS_V1.memory && (organization?.attempt ?? 0) === 0)
  ) action = 'blocked-dependency'
  else if (failure?.retryable === false || step.attempt >= maxAttempts) action = 'blocked-non-retryable'
  else {
    action = step.status === 'failed' ? 'retry-failed' : 'run-scheduled'
    nextAttempt = step.status === 'failed' ? step.attempt + 1 : 1
  }
  return {
    stepId,
    status: step.status,
    attempt: step.attempt,
    nextAttempt,
    retryable: failure?.retryable ?? null,
    ...(step.failureCode ? { failureCode: step.failureCode } : {}),
    action,
    dependencyStepIds,
  }
}

export function buildChapterPostAdoptionResumePlanV1(
  snapshot: AgentRunSnapshotV1,
): ChapterPostAdoptionResumePlanV1 {
  const steps: ChapterPostAdoptionResumeStepV1[] = []
  for (const stepId of stepIds(snapshot)) {
    steps.push(classifyStep(snapshot, stepId, steps))
  }
  const next = steps.find(step => (
    step.action === 'run-scheduled' || step.action === 'retry-failed'
  ))
  const blocked = steps.find(step => (
    step.action === 'blocked-non-retryable'
    || step.action === 'blocked-stale'
    || step.action === 'blocked-dependency'
    || step.action === 'inspect-running'
  ))
  const terminal = snapshot.projection.state === 'completed'
  return {
    runId: snapshot.run.id,
    state: snapshot.projection.state,
    terminal,
    canResume: !terminal && !blocked,
    ...(blocked ? { blockedReason: `${blocked.stepId}:${blocked.action}` } : {}),
    steps,
    nextStepId: next?.stepId ?? null,
  }
}

export function isChapterPostAdoptionStepRunnableV1(
  plan: ChapterPostAdoptionResumePlanV1,
  stepId: ChapterPostAdoptionStepIdV1,
): boolean {
  const step = plan.steps.find(candidate => candidate.stepId === stepId)
  return step?.action === 'run-scheduled' || step?.action === 'retry-failed'
}
