import { CONTEXT_SOURCE_BY_KEY } from '../../registry/context-sources'
import { FIELD_BY_TARGET } from '../../registry/field-registry'
import { REGISTRY_BY_NAME } from '../../registry/project-tables'
import type {
  AcceptedAgentRunContractV1,
  AgentRunAcceptanceCriterionV1,
  AgentRunAcceptanceKind,
  AgentRunContractV1,
  AgentRunVerificationKind,
  AgentRunVerificationStepV1,
  AgentRunWorkflowKind,
  AgentRunWriteMode,
  AgentRunWriteTargetV1,
} from '../../types/agent-run'
import { hashCanonicalValue } from './hash'
import {
  assertExactKeys,
  assertUnique,
  failSchema,
  readArray,
  readBoolean,
  readEnum,
  readInteger,
  readRecord,
  readString,
} from './schema-utils'

const WORKFLOW_KINDS: readonly AgentRunWorkflowKind[] = [
  'direct-generation',
  'read-only-audit',
  'plan-execute',
  'generate-verify-revise',
  'multi-domain-sequential',
  'long-running-resumable',
]

const WRITE_MODES: readonly AgentRunWriteMode[] = ['none', 'candidate-only', 'author-confirmed']
const ACCEPTANCE_KINDS: readonly AgentRunAcceptanceKind[] = [
  'output-present',
  'gate-passed',
  'author-confirmed',
  'adoption-committed',
  'post-state-matches',
  'deterministic-check',
  'semantic-review',
]
const VERIFICATION_KINDS: readonly AgentRunVerificationKind[] = [
  'protocol',
  'scope',
  'freshness',
  'adoption',
  'deterministic',
  'semantic',
  'terminal',
]

function readIdArray(value: unknown, path: string): number[] | undefined {
  if (value === undefined) return undefined
  const result = readArray(value, path).map((item, index) => readInteger(item, `${path}[${index}]`, { min: 1 }))
  if (new Set(result).size !== result.length) failSchema('duplicate_value', path, '不得包含重复 ID')
  return result
}

function readWriteTarget(value: unknown, path: string): AgentRunWriteTargetV1 {
  const record = readRecord(value, path)
  assertExactKeys(record, ['table', 'fields', 'mode'], ['table', 'fields', 'mode'], path)
  const table = readString(record.table, `${path}.table`, { max: 100 })
  if (!REGISTRY_BY_NAME.has(table)) failSchema('unknown_table', `${path}.table`, `未登记的数据表 ${table}`)
  const fields = readArray(record.fields, `${path}.fields`).map((item, index) => (
    readString(item, `${path}.fields[${index}]`, { max: 100 })
  ))
  assertUnique(fields, `${path}.fields`)
  const mode = readEnum(record.mode, WRITE_MODES, `${path}.mode`)
  if (mode === 'none' && fields.length > 0) {
    failSchema('invalid_permission', path, 'mode=none 时不得声明可写字段')
  }
  if (mode !== 'none' && fields.length === 0) {
    failSchema('invalid_permission', path, '可写目标必须声明至少一个字段')
  }
  const registeredFields = new Set((FIELD_BY_TARGET.get(table) ?? []).map(field => field.field))
  for (const field of fields) {
    if (!registeredFields.has(field)) {
      failSchema('unknown_write_field', `${path}.fields`, `${table}.${field} 未在 FIELD_REGISTRY 登记`)
    }
  }
  return { table, fields, mode }
}

function readAcceptance(value: unknown, path: string): AgentRunAcceptanceCriterionV1 {
  const record = readRecord(value, path)
  assertExactKeys(record, ['id', 'kind', 'required'], ['id', 'kind', 'required'], path)
  return {
    id: readString(record.id, `${path}.id`, { max: 120 }),
    kind: readEnum(record.kind, ACCEPTANCE_KINDS, `${path}.kind`),
    required: readBoolean(record.required, `${path}.required`),
  }
}

function readVerificationStep(value: unknown, path: string): AgentRunVerificationStepV1 {
  const record = readRecord(value, path)
  assertExactKeys(record, ['id', 'kind', 'verifier', 'criterionIds'], ['id', 'kind', 'verifier', 'criterionIds'], path)
  const criterionIds = readArray(record.criterionIds, `${path}.criterionIds`).map((item, index) => (
    readString(item, `${path}.criterionIds[${index}]`, { max: 120 })
  ))
  assertUnique(criterionIds, `${path}.criterionIds`)
  if (criterionIds.length === 0) failSchema('invalid_verification', `${path}.criterionIds`, '不得为空')
  return {
    id: readString(record.id, `${path}.id`, { max: 120 }),
    kind: readEnum(record.kind, VERIFICATION_KINDS, `${path}.kind`),
    verifier: readString(record.verifier, `${path}.verifier`, { max: 160 }),
    criterionIds,
  }
}

export function parseAgentRunContractV1(value: unknown): AgentRunContractV1 {
  const record = readRecord(value, 'contract')
  assertExactKeys(
    record,
    ['version', 'objective', 'workflowKind', 'scope', 'permissions', 'budget', 'acceptance', 'verificationPlan', 'failurePolicy'],
    ['version', 'objective', 'workflowKind', 'scope', 'permissions', 'budget', 'acceptance', 'verificationPlan', 'failurePolicy'],
    'contract',
  )
  if (record.version !== 1) failSchema('unsupported_version', 'contract.version', '仅支持版本 1')

  const scopeRecord = readRecord(record.scope, 'contract.scope')
  assertExactKeys(
    scopeRecord,
    ['projectId', 'worldGroupId', 'chapterIds', 'outlineNodeIds'],
    ['projectId', 'worldGroupId'],
    'contract.scope',
  )
  const worldGroupId = scopeRecord.worldGroupId === null
    ? null
    : readInteger(scopeRecord.worldGroupId, 'contract.scope.worldGroupId', { min: 1 })

  const permissionsRecord = readRecord(record.permissions, 'contract.permissions')
  assertExactKeys(
    permissionsRecord,
    ['contextSourceKeys', 'writeTargets'],
    ['contextSourceKeys', 'writeTargets'],
    'contract.permissions',
  )
  const contextSourceKeys = readArray(
    permissionsRecord.contextSourceKeys,
    'contract.permissions.contextSourceKeys',
  ).map((item, index) => readString(item, `contract.permissions.contextSourceKeys[${index}]`, { max: 120 }))
  if (contextSourceKeys.length === 0) {
    failSchema('invalid_permission', 'contract.permissions.contextSourceKeys', '不得为空')
  }
  assertUnique(contextSourceKeys, 'contract.permissions.contextSourceKeys')
  for (const sourceKey of contextSourceKeys) {
    if (!CONTEXT_SOURCE_BY_KEY.has(sourceKey)) {
      failSchema('unknown_context_source', 'contract.permissions.contextSourceKeys', `未登记的上下文源 ${sourceKey}`)
    }
  }
  const writeTargets = readArray(
    permissionsRecord.writeTargets,
    'contract.permissions.writeTargets',
  ).map((item, index) => readWriteTarget(item, `contract.permissions.writeTargets[${index}]`))
  assertUnique(writeTargets.map(target => target.table), 'contract.permissions.writeTargets')

  const budgetRecord = readRecord(record.budget, 'contract.budget')
  const requiredBudgetKeys = ['maxModelCalls', 'maxToolCalls', 'maxInputTokens', 'maxOutputTokens', 'maxAttemptsPerStep'] as const
  const budgetKeys = [...requiredBudgetKeys, 'maxToolResultTokens', 'maxProtocolErrors'] as const
  assertExactKeys(budgetRecord, budgetKeys, requiredBudgetKeys, 'contract.budget')

  const acceptance = readArray(record.acceptance, 'contract.acceptance')
    .map((item, index) => readAcceptance(item, `contract.acceptance[${index}]`))
  if (acceptance.length === 0) failSchema('invalid_acceptance', 'contract.acceptance', '不得为空')
  assertUnique(acceptance.map(item => item.id), 'contract.acceptance')

  const verificationPlan = readArray(record.verificationPlan, 'contract.verificationPlan')
    .map((item, index) => readVerificationStep(item, `contract.verificationPlan[${index}]`))
  if (verificationPlan.length === 0) failSchema('invalid_verification', 'contract.verificationPlan', '不得为空')
  assertUnique(verificationPlan.map(item => item.id), 'contract.verificationPlan')
  if (!verificationPlan.some(item => item.kind === 'terminal')) {
    failSchema('missing_terminal_verifier', 'contract.verificationPlan', '必须包含 terminal verifier')
  }
  const criterionIds = new Set(acceptance.map(item => item.id))
  const coveredCriterionIds = new Set<string>()
  for (const step of verificationPlan) {
    for (const criterionId of step.criterionIds) {
      if (!criterionIds.has(criterionId)) {
        failSchema('unknown_criterion', 'contract.verificationPlan', `引用了未知验收项 ${criterionId}`)
      }
      coveredCriterionIds.add(criterionId)
    }
  }
  for (const criterion of acceptance) {
    if (criterion.required && !coveredCriterionIds.has(criterion.id)) {
      failSchema('unverified_criterion', 'contract.verificationPlan', `必需验收项 ${criterion.id} 未被验证`)
    }
  }

  const failureRecord = readRecord(record.failurePolicy, 'contract.failurePolicy')
  assertExactKeys(
    failureRecord,
    ['onProtocolError', 'onVerificationFailure', 'onStaleInput'],
    ['onProtocolError', 'onVerificationFailure', 'onStaleInput'],
    'contract.failurePolicy',
  )

  const workflowKind = readEnum(record.workflowKind, WORKFLOW_KINDS, 'contract.workflowKind')
  if (workflowKind === 'read-only-audit' && writeTargets.length > 0) {
    failSchema('invalid_permission', 'contract.permissions.writeTargets', '只读任务的写集合必须为空')
  }

  return {
    version: 1,
    objective: readString(record.objective, 'contract.objective', { max: 4000 }),
    workflowKind,
    scope: {
      projectId: readInteger(scopeRecord.projectId, 'contract.scope.projectId', { min: 1 }),
      worldGroupId,
      chapterIds: readIdArray(scopeRecord.chapterIds, 'contract.scope.chapterIds'),
      outlineNodeIds: readIdArray(scopeRecord.outlineNodeIds, 'contract.scope.outlineNodeIds'),
    },
    permissions: { contextSourceKeys, writeTargets },
    budget: {
      maxModelCalls: readInteger(budgetRecord.maxModelCalls, 'contract.budget.maxModelCalls', { min: 1 }),
      maxToolCalls: readInteger(budgetRecord.maxToolCalls, 'contract.budget.maxToolCalls', { min: 0 }),
      maxInputTokens: readInteger(budgetRecord.maxInputTokens, 'contract.budget.maxInputTokens', { min: 1 }),
      maxOutputTokens: readInteger(budgetRecord.maxOutputTokens, 'contract.budget.maxOutputTokens', { min: 1 }),
      maxAttemptsPerStep: readInteger(budgetRecord.maxAttemptsPerStep, 'contract.budget.maxAttemptsPerStep', { min: 1 }),
      ...(budgetRecord.maxToolResultTokens === undefined ? {} : {
        maxToolResultTokens: readInteger(
          budgetRecord.maxToolResultTokens,
          'contract.budget.maxToolResultTokens',
          { min: 1 },
        ),
      }),
      ...(budgetRecord.maxProtocolErrors === undefined ? {} : {
        maxProtocolErrors: readInteger(
          budgetRecord.maxProtocolErrors,
          'contract.budget.maxProtocolErrors',
          { min: 0 },
        ),
      }),
    },
    acceptance,
    verificationPlan,
    failurePolicy: {
      onProtocolError: readEnum(failureRecord.onProtocolError, ['retry', 'fail'], 'contract.failurePolicy.onProtocolError'),
      onVerificationFailure: readEnum(
        failureRecord.onVerificationFailure,
        ['revise', 'replan', 'fail'],
        'contract.failurePolicy.onVerificationFailure',
      ),
      onStaleInput: readEnum(
        failureRecord.onStaleInput,
        ['restart-step', 'pause-for-author'],
        'contract.failurePolicy.onStaleInput',
      ),
    },
  }
}

export async function acceptAgentRunContractV1(value: unknown): Promise<AcceptedAgentRunContractV1> {
  const contract = parseAgentRunContractV1(value)
  return { contract, contractHash: await hashCanonicalValue(contract) }
}
