import type {
  AgentRunEventPayloadByTypeV1,
  AgentRunEventTypeV1,
  AnyAgentRunEventV1,
} from '../../types/agent-run'
import {
  assertExactKeys,
  failSchema,
  readArray,
  readBoolean,
  readEnum,
  readHash,
  readInteger,
  readRecord,
  readString,
} from './schema-utils'
import { parseAgentRunStepVerificationReceiptV1 } from './verification-receipt'

export const AGENT_RUN_EVENT_TYPES_V1: readonly AgentRunEventTypeV1[] = [
  'run.created',
  'contract.accepted',
  'contract.revised',
  'plan.replanned',
  'step.scheduled',
  'step.started',
  'step.succeeded',
  'step.failed',
  'context.assembled',
  'model.requested',
  'model.responded',
  'tool.called',
  'tool.returned',
  'candidate.persisted',
  'candidate.revised',
  'candidate.staled',
  'candidate.carried-forward',
  'runtime.candidate.adopted',
  'step.verification.accepted',
  'step.verification.staled',
  'confirmation.recorded',
  'adoption.started',
  'adoption.committed',
  'adoption.rejected',
  'verification.started',
  'verification.accepted',
  'memory.settlement.recorded',
  'verification.rejected',
  'verification.staled',
  'checkpoint.created',
  'recovery.started',
  'recovery.completed',
  'budget.reserved',
  'budget.settled',
  'budget.exhausted',
  'run.paused',
  'run.cancelled',
  'run.failed',
]

function payloadRecord(
  value: unknown,
  type: AgentRunEventTypeV1,
  keys: readonly string[],
  required: readonly string[] = keys,
): Record<string, unknown> {
  const path = `event.payload(${type})`
  const record = readRecord(value, path)
  assertExactKeys(record, keys, required, path)
  return record
}

function readStepAttempt(
  value: unknown,
  type: AgentRunEventTypeV1,
  extraKeys: readonly string[],
): { record: Record<string, unknown>; stepId: string; attempt: number } {
  const record = payloadRecord(value, type, ['stepId', 'attempt', ...extraKeys])
  return {
    record,
    stepId: readString(record.stepId, `event.payload(${type}).stepId`, { max: 160 }),
    attempt: readInteger(record.attempt, `event.payload(${type}).attempt`, { min: 1 }),
  }
}

function readStringArray(value: unknown, path: string, maxItems = 20): string[] {
  const items = readArray(value, path)
  if (items.length > maxItems) failSchema('too_many_items', path, `最多允许 ${maxItems} 项`)
  return items.map((item, index) => (
    readString(item, `${path}[${index}]`, { max: 160 })
  ))
}

function readUsagePayload(
  value: unknown,
  type: 'budget.reserved' | 'budget.settled',
): AgentRunEventPayloadByTypeV1[typeof type] {
  const record = payloadRecord(value, type, ['stepId', 'modelCalls', 'toolCalls', 'tokens'])
  return {
    stepId: readString(record.stepId, `event.payload(${type}).stepId`, { max: 160 }),
    modelCalls: readInteger(record.modelCalls, `event.payload(${type}).modelCalls`, { min: 0 }),
    toolCalls: readInteger(record.toolCalls, `event.payload(${type}).toolCalls`, { min: 0 }),
    tokens: readInteger(record.tokens, `event.payload(${type}).tokens`, { min: 0 }),
  }
}

function parsePayload<T extends AgentRunEventTypeV1>(
  type: T,
  value: unknown,
): AgentRunEventPayloadByTypeV1[T] {
  let payload: AgentRunEventPayloadByTypeV1[AgentRunEventTypeV1]
  switch (type) {
    case 'run.created': {
      const record = payloadRecord(value, type, ['objectiveHash'])
      payload = { objectiveHash: readHash(record.objectiveHash, 'event.payload(run.created).objectiveHash') }
      break
    }
    case 'contract.accepted': {
      const record = payloadRecord(value, type, ['contractJson'], [])
      payload = {
        ...(record.contractJson === undefined ? {} : {
          contractJson: readString(record.contractJson, 'event.payload(contract.accepted).contractJson', { max: 100_000 }),
        }),
      }
      break
    }
    case 'contract.revised': {
      const record = payloadRecord(value, type, ['previousContractHash', 'contractJson'], ['previousContractHash'])
      payload = {
        previousContractHash: readHash(record.previousContractHash, 'event.payload(contract.revised).previousContractHash'),
        ...(record.contractJson === undefined ? {} : {
          contractJson: readString(record.contractJson, 'event.payload(contract.revised).contractJson', { max: 100_000 }),
        }),
      }
      break
    }
    case 'plan.replanned': {
      const record = payloadRecord(value, type, [
        'previousPlanHash',
        'planHash',
        'reasonCode',
        'affectedStepIds',
        'carriedStepIds',
        'failureFingerprints',
      ])
      payload = {
        previousPlanHash: readHash(record.previousPlanHash, 'event.payload(plan.replanned).previousPlanHash'),
        planHash: readHash(record.planHash, 'event.payload(plan.replanned).planHash'),
        reasonCode: readString(record.reasonCode, 'event.payload(plan.replanned).reasonCode', { max: 160 }),
        affectedStepIds: readStringArray(record.affectedStepIds, 'event.payload(plan.replanned).affectedStepIds'),
        carriedStepIds: readStringArray(record.carriedStepIds, 'event.payload(plan.replanned).carriedStepIds'),
        failureFingerprints: readStringArray(
          record.failureFingerprints,
          'event.payload(plan.replanned).failureFingerprints',
        ).map((fingerprint, index) => readHash(
          fingerprint,
          `event.payload(plan.replanned).failureFingerprints[${index}]`,
        )),
      }
      break
    }
    case 'step.scheduled': {
      const record = payloadRecord(value, type, ['stepId'])
      payload = { stepId: readString(record.stepId, 'event.payload(step.scheduled).stepId', { max: 160 }) }
      break
    }
    case 'step.started': {
      const parsed = readStepAttempt(value, type, [])
      payload = { stepId: parsed.stepId, attempt: parsed.attempt }
      break
    }
    case 'step.succeeded': {
      const parsed = readStepAttempt(value, type, ['outputHash'])
      payload = {
        stepId: parsed.stepId,
        attempt: parsed.attempt,
        outputHash: readHash(parsed.record.outputHash, 'event.payload(step.succeeded).outputHash'),
      }
      break
    }
    case 'step.failed': {
      const record = payloadRecord(
        value,
        type,
        ['stepId', 'attempt', 'code', 'retryable', 'category', 'action', 'fingerprint'],
        ['stepId', 'attempt', 'code', 'retryable'],
      )
      payload = {
        stepId: readString(record.stepId, 'event.payload(step.failed).stepId', { max: 160 }),
        attempt: readInteger(record.attempt, 'event.payload(step.failed).attempt', { min: 1 }),
        code: readString(record.code, 'event.payload(step.failed).code', { max: 160 }),
        retryable: readBoolean(record.retryable, 'event.payload(step.failed).retryable'),
        ...(record.category === undefined ? {} : {
          category: readEnum(
            record.category,
            ['protocol', 'transient', 'stale-input', 'deterministic', 'budget', 'cancelled', 'unknown'],
            'event.payload(step.failed).category',
          ),
        }),
        ...(record.action === undefined ? {} : {
          action: readEnum(
            record.action,
            ['retry', 'replan', 'pause-for-author', 'fail'],
            'event.payload(step.failed).action',
          ),
        }),
        ...(record.fingerprint === undefined ? {} : {
          fingerprint: readHash(record.fingerprint, 'event.payload(step.failed).fingerprint'),
        }),
      }
      break
    }
    case 'context.assembled': {
      const parsed = readStepAttempt(value, type, ['manifestHash'])
      payload = {
        stepId: parsed.stepId,
        attempt: parsed.attempt,
        manifestHash: readHash(parsed.record.manifestHash, 'event.payload(context.assembled).manifestHash'),
      }
      break
    }
    case 'model.requested': {
      const parsed = readStepAttempt(value, type, ['bindingHash'])
      payload = {
        stepId: parsed.stepId,
        attempt: parsed.attempt,
        bindingHash: readHash(parsed.record.bindingHash, 'event.payload(model.requested).bindingHash'),
      }
      break
    }
    case 'model.responded': {
      const parsed = readStepAttempt(value, type, ['outputHash'])
      payload = {
        stepId: parsed.stepId,
        attempt: parsed.attempt,
        outputHash: readHash(parsed.record.outputHash, 'event.payload(model.responded).outputHash'),
      }
      break
    }
    case 'tool.called': {
      const parsed = readStepAttempt(value, type, ['toolName', 'callHash'])
      payload = {
        stepId: parsed.stepId,
        attempt: parsed.attempt,
        toolName: readString(parsed.record.toolName, 'event.payload(tool.called).toolName', { max: 160 }),
        callHash: readHash(parsed.record.callHash, 'event.payload(tool.called).callHash'),
      }
      break
    }
    case 'tool.returned': {
      const parsed = readStepAttempt(value, type, ['toolName', 'resultHash'])
      payload = {
        stepId: parsed.stepId,
        attempt: parsed.attempt,
        toolName: readString(parsed.record.toolName, 'event.payload(tool.returned).toolName', { max: 160 }),
        resultHash: readHash(parsed.record.resultHash, 'event.payload(tool.returned).resultHash'),
      }
      break
    }
    case 'candidate.persisted': {
      const parsed = readStepAttempt(value, type, ['candidateHash', 'requiresConfirmation'])
      payload = {
        stepId: parsed.stepId,
        attempt: parsed.attempt,
        candidateHash: readHash(parsed.record.candidateHash, 'event.payload(candidate.persisted).candidateHash'),
        requiresConfirmation: readBoolean(
          parsed.record.requiresConfirmation,
          'event.payload(candidate.persisted).requiresConfirmation',
        ),
      }
      break
    }
    case 'candidate.revised': {
      const parsed = readStepAttempt(value, type, ['previousCandidateHash', 'candidateHash'])
      payload = {
        stepId: parsed.stepId,
        attempt: parsed.attempt,
        previousCandidateHash: readHash(
          parsed.record.previousCandidateHash,
          'event.payload(candidate.revised).previousCandidateHash',
        ),
        candidateHash: readHash(parsed.record.candidateHash, 'event.payload(candidate.revised).candidateHash'),
      }
      break
    }
    case 'candidate.staled': {
      const record = payloadRecord(value, type, ['stepId', 'candidateHash', 'reason'])
      payload = {
        stepId: readString(record.stepId, 'event.payload(candidate.staled).stepId', { max: 160 }),
        candidateHash: readHash(record.candidateHash, 'event.payload(candidate.staled).candidateHash'),
        reason: readString(record.reason, 'event.payload(candidate.staled).reason', { max: 1000 }),
      }
      break
    }
    case 'candidate.carried-forward': {
      const record = payloadRecord(value, type, [
        'stepId',
        'sourceGeneration',
        'sourceAttempt',
        'candidateHash',
      ])
      payload = {
        stepId: readString(record.stepId, 'event.payload(candidate.carried-forward).stepId', { max: 160 }),
        sourceGeneration: readInteger(
          record.sourceGeneration,
          'event.payload(candidate.carried-forward).sourceGeneration',
          { min: 1 },
        ),
        sourceAttempt: readInteger(
          record.sourceAttempt,
          'event.payload(candidate.carried-forward).sourceAttempt',
          { min: 1 },
        ),
        candidateHash: readHash(record.candidateHash, 'event.payload(candidate.carried-forward).candidateHash'),
      }
      break
    }
    case 'runtime.candidate.adopted': {
      const record = payloadRecord(value, type, [
        'stepId', 'candidateHash', 'adoptionHash', 'commandIds', 'baseSequence', 'resultingSequence',
      ])
      const commandIds = readArray(record.commandIds, 'event.payload(runtime.candidate.adopted).commandIds')
        .map((item, index) => readString(item, `event.payload(runtime.candidate.adopted).commandIds[${index}]`, { max: 200 }))
      if (new Set(commandIds).size !== commandIds.length) {
        failSchema('duplicate_value', 'event.payload(runtime.candidate.adopted).commandIds', '不得重复')
      }
      const baseSequence = readInteger(record.baseSequence, 'event.payload(runtime.candidate.adopted).baseSequence', { min: 0 })
      const resultingSequence = readInteger(record.resultingSequence, 'event.payload(runtime.candidate.adopted).resultingSequence', { min: 0 })
      if (resultingSequence < baseSequence) {
        failSchema('invalid_value', 'event.payload(runtime.candidate.adopted).resultingSequence', '不得早于 baseSequence')
      }
      payload = {
        stepId: readString(record.stepId, 'event.payload(runtime.candidate.adopted).stepId', { max: 160 }),
        candidateHash: readHash(record.candidateHash, 'event.payload(runtime.candidate.adopted).candidateHash'),
        adoptionHash: readHash(record.adoptionHash, 'event.payload(runtime.candidate.adopted).adoptionHash'),
        commandIds,
        baseSequence,
        resultingSequence,
      }
      break
    }
    case 'step.verification.accepted': {
      const record = payloadRecord(value, type, ['receipt'])
      payload = { receipt: parseAgentRunStepVerificationReceiptV1(record.receipt) }
      break
    }
    case 'step.verification.staled': {
      const record = payloadRecord(value, type, ['stepId', 'previousReceiptHash', 'reason'])
      payload = {
        stepId: readString(record.stepId, 'event.payload(step.verification.staled).stepId', { max: 160 }),
        previousReceiptHash: readHash(
          record.previousReceiptHash,
          'event.payload(step.verification.staled).previousReceiptHash',
        ),
        reason: readString(record.reason, 'event.payload(step.verification.staled).reason', { max: 1000 }),
      }
      break
    }
    case 'confirmation.recorded': {
      const record = payloadRecord(
        value,
        type,
        ['stepId', 'candidateHash', 'decision', 'reviewItemId', 'reviewDecision', 'note'],
        ['stepId', 'candidateHash', 'decision'],
      )
      const decision = readEnum(
        record.decision,
        ['adopt', 'reject'],
        'event.payload(confirmation.recorded).decision',
      )
      const reviewFields = ['reviewItemId', 'reviewDecision', 'note'] as const
      const presentReviewFields = reviewFields.filter(key => record[key] !== undefined)
      if (presentReviewFields.length > 0 && presentReviewFields.length !== reviewFields.length) {
        failSchema(
          'missing_required_key',
          'event.payload(confirmation.recorded)',
          '作者复核元数据必须同时包含 reviewItemId、reviewDecision 和 note',
        )
      }
      if (presentReviewFields.length > 0 && decision !== 'adopt') {
        failSchema(
          'invalid_enum',
          'event.payload(confirmation.recorded).decision',
          '作者复核元数据只能附加到 adopt 确认事件',
        )
      }
      const reviewNote = record.note === undefined
        ? undefined
        : readString(record.note, 'event.payload(confirmation.recorded).note', { max: 2_000 })
      if (reviewNote !== undefined && reviewNote.length < 2) {
        failSchema(
          'invalid_value',
          'event.payload(confirmation.recorded).note',
          '长度不得少于 2',
        )
      }
      payload = {
        stepId: readString(record.stepId, 'event.payload(confirmation.recorded).stepId', { max: 160 }),
        candidateHash: readHash(record.candidateHash, 'event.payload(confirmation.recorded).candidateHash'),
        decision,
        ...(record.reviewItemId === undefined ? {} : { reviewItemId: readString(record.reviewItemId, 'event.payload(confirmation.recorded).reviewItemId', { max: 200 }) }),
        ...(record.reviewDecision === undefined ? {} : { reviewDecision: readEnum(record.reviewDecision, ['acknowledged', 'needs-manual-action'], 'event.payload(confirmation.recorded).reviewDecision') }),
        ...(reviewNote === undefined ? {} : { note: reviewNote }),
      }
      break
    }
    case 'adoption.started': {
      const record = payloadRecord(
        value,
        type,
        ['stepId', 'candidateHash', 'intentHash'],
        ['stepId', 'candidateHash'],
      )
      payload = {
        stepId: readString(record.stepId, 'event.payload(adoption.started).stepId', { max: 160 }),
        candidateHash: readHash(record.candidateHash, 'event.payload(adoption.started).candidateHash'),
        ...(record.intentHash == null ? {} : {
          intentHash: readHash(record.intentHash, 'event.payload(adoption.started).intentHash'),
        }),
      }
      break
    }
    case 'adoption.committed': {
      const record = payloadRecord(value, type, ['stepId', 'candidateHash', 'adoptionHash'])
      payload = {
        stepId: readString(record.stepId, 'event.payload(adoption.committed).stepId', { max: 160 }),
        candidateHash: readHash(record.candidateHash, 'event.payload(adoption.committed).candidateHash'),
        adoptionHash: readHash(record.adoptionHash, 'event.payload(adoption.committed).adoptionHash'),
      }
      break
    }
    case 'adoption.rejected': {
      const record = payloadRecord(value, type, ['stepId', 'candidateHash', 'code'])
      payload = {
        stepId: readString(record.stepId, 'event.payload(adoption.rejected).stepId', { max: 160 }),
        candidateHash: readHash(record.candidateHash, 'event.payload(adoption.rejected).candidateHash'),
        code: readString(record.code, 'event.payload(adoption.rejected).code', { max: 160 }),
      }
      break
    }
    case 'verification.started': {
      const record = payloadRecord(value, type, ['verifierSetVersion'])
      payload = {
        verifierSetVersion: readString(
          record.verifierSetVersion,
          'event.payload(verification.started).verifierSetVersion',
          { max: 160 },
        ),
      }
      break
    }
    case 'verification.accepted': {
      const record = payloadRecord(value, type, ['receiptHash'])
      payload = { receiptHash: readHash(record.receiptHash, 'event.payload(verification.accepted).receiptHash') }
      break
    }
    case 'memory.settlement.recorded': {
      const record = payloadRecord(value, type, [
        'receiptHash',
        'terminalReceiptHash',
        'state',
        'contextManifestHashes',
        'adoptionHashes',
        'artifactIndexHash',
        'workspaceDirty',
      ])
      const readHashes = (key: 'contextManifestHashes' | 'adoptionHashes'): string[] => {
        const values = readArray(record[key], `event.payload(memory.settlement.recorded).${key}`)
        if (values.length > 512) {
          failSchema('too_many_items', `event.payload(memory.settlement.recorded).${key}`, '最多允许 512 项')
        }
        return values.map((item, index) => readHash(
          item,
          `event.payload(memory.settlement.recorded).${key}[${index}]`,
        ))
      }
      const terminalReceiptHash = record.terminalReceiptHash === null
        ? null
        : readHash(
          record.terminalReceiptHash,
          'event.payload(memory.settlement.recorded).terminalReceiptHash',
        )
      const settlementPayload: AgentRunEventPayloadByTypeV1['memory.settlement.recorded'] = {
        receiptHash: readHash(
          record.receiptHash,
          'event.payload(memory.settlement.recorded).receiptHash',
        ),
        terminalReceiptHash,
        state: readEnum(
          record.state,
          ['settled', 'incomplete'] as const,
          'event.payload(memory.settlement.recorded).state',
        ),
        contextManifestHashes: readHashes('contextManifestHashes'),
        adoptionHashes: readHashes('adoptionHashes'),
        artifactIndexHash: readHash(
          record.artifactIndexHash,
          'event.payload(memory.settlement.recorded).artifactIndexHash',
        ),
        workspaceDirty: readBoolean(
          record.workspaceDirty,
          'event.payload(memory.settlement.recorded).workspaceDirty',
        ) as true,
      }
      if (settlementPayload.workspaceDirty !== true) {
        failSchema(
          'invalid_value',
          'event.payload(memory.settlement.recorded).workspaceDirty',
          'Harness 终态不会自动写盘，必须记录为 true',
        )
      }
      if (settlementPayload.state === 'settled' && settlementPayload.terminalReceiptHash == null) {
        failSchema(
          'invalid_value',
          'event.payload(memory.settlement.recorded).terminalReceiptHash',
          'settled 必须带 terminal receipt',
        )
      }
      payload = settlementPayload
      break
    }
    case 'verification.rejected': {
      const record = payloadRecord(value, type, ['codes', 'retryable'])
      const codes = readArray(record.codes, 'event.payload(verification.rejected).codes').map((item, index) => (
        readString(item, `event.payload(verification.rejected).codes[${index}]`, { max: 160 })
      ))
      if (codes.length === 0) failSchema('invalid_value', 'event.payload(verification.rejected).codes', '不得为空')
      payload = {
        codes,
        retryable: readBoolean(record.retryable, 'event.payload(verification.rejected).retryable'),
      }
      break
    }
    case 'verification.staled': {
      const record = payloadRecord(value, type, ['previousReceiptHash', 'reason'])
      payload = {
        previousReceiptHash: readHash(
          record.previousReceiptHash,
          'event.payload(verification.staled).previousReceiptHash',
        ),
        reason: readString(record.reason, 'event.payload(verification.staled).reason', { max: 1000 }),
      }
      break
    }
    case 'checkpoint.created': {
      const record = payloadRecord(value, type, ['throughSequence', 'checkpointHash'])
      payload = {
        throughSequence: readInteger(record.throughSequence, 'event.payload(checkpoint.created).throughSequence', { min: 0 }),
        checkpointHash: readHash(record.checkpointHash, 'event.payload(checkpoint.created).checkpointHash'),
      }
      break
    }
    case 'recovery.started':
    case 'recovery.completed': {
      const record = payloadRecord(value, type, ['checkpointHash'])
      payload = { checkpointHash: readHash(record.checkpointHash, `event.payload(${type}).checkpointHash`) }
      break
    }
    case 'budget.reserved':
    case 'budget.settled':
      payload = readUsagePayload(value, type)
      break
    case 'budget.exhausted': {
      const record = payloadRecord(value, type, ['resource'])
      payload = {
        resource: readEnum(
          record.resource,
          ['model-calls', 'tool-calls', 'input-tokens', 'output-tokens', 'attempts', 'replans'],
          'event.payload(budget.exhausted).resource',
        ),
      }
      break
    }
    case 'run.paused': {
      const record = payloadRecord(value, type, ['reason', 'recoverable'])
      payload = {
        reason: readString(record.reason, 'event.payload(run.paused).reason', { max: 1000 }),
        recoverable: readBoolean(record.recoverable, 'event.payload(run.paused).recoverable'),
      }
      break
    }
    case 'run.cancelled': {
      const record = payloadRecord(value, type, ['reason'])
      payload = { reason: readString(record.reason, 'event.payload(run.cancelled).reason', { max: 1000 }) }
      break
    }
    case 'run.failed': {
      const record = payloadRecord(value, type, ['code', 'retryable'])
      payload = {
        code: readString(record.code, 'event.payload(run.failed).code', { max: 160 }),
        retryable: readBoolean(record.retryable, 'event.payload(run.failed).retryable'),
      }
      break
    }
    default:
      failSchema('unknown_event_type', 'event.type', `未知事件 ${String(type)}`)
  }
  return payload as AgentRunEventPayloadByTypeV1[T]
}

export function parseAgentRunEventV1(value: unknown): AnyAgentRunEventV1 {
  const record = readRecord(value, 'event')
  const keys = [
    'version',
    'runId',
    'sequence',
    'generation',
    'projectId',
    'worldGroupId',
    'contractHash',
    'type',
    'createdAt',
    'payload',
  ] as const
  assertExactKeys(record, keys, keys, 'event')
  if (record.version !== 1) failSchema('unsupported_version', 'event.version', '仅支持版本 1')
  const type = readEnum(record.type, AGENT_RUN_EVENT_TYPES_V1, 'event.type')
  const worldGroupId = record.worldGroupId === null
    ? null
    : readInteger(record.worldGroupId, 'event.worldGroupId', { min: 1 })
  return {
    version: 1,
    runId: readInteger(record.runId, 'event.runId', { min: 1 }),
    sequence: readInteger(record.sequence, 'event.sequence', { min: 1 }),
    generation: readInteger(record.generation, 'event.generation', { min: 1 }),
    projectId: readInteger(record.projectId, 'event.projectId', { min: 1 }),
    worldGroupId,
    contractHash: readHash(record.contractHash, 'event.contractHash'),
    type,
    createdAt: readInteger(record.createdAt, 'event.createdAt', { min: 0 }),
    payload: parsePayload(type, record.payload),
  } as AnyAgentRunEventV1
}
