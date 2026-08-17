import { CONTEXT_SOURCE_BY_KEY } from '../../registry/context-sources'
import { FIELD_BY_TARGET } from '../../registry/field-registry'
import { ADOPTION_EXTENSIONS } from '../../registry/adoption-schema'
import { REGISTRY_BY_NAME } from '../../registry/project-tables'
import type {
  AcceptedAgentRunContractV1,
  AgentRunAcceptanceCriterionV1,
  AgentRunAcceptanceKind,
  AgentRunContractV1,
  AgentRunParentLineageV1,
  AgentRunVerificationKind,
  AgentRunVerificationStepV1,
  AgentRunWorkflowKind,
  AgentRunStepExecutionBindingV1,
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
  readHash,
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
  'fan-out-synthesize',
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
  assertExactKeys(record, ['table', 'fields', 'mode', 'adoptionExtension'], ['table', 'fields', 'mode'], path)
  const table = readString(record.table, `${path}.table`, { max: 100 })
  if (!REGISTRY_BY_NAME.has(table)) failSchema('unknown_table', `${path}.table`, `未登记的数据表 ${table}`)
  const fields = readArray(record.fields, `${path}.fields`).map((item, index) => (
    readString(item, `${path}.fields[${index}]`, { max: 100 })
  ))
  assertUnique(fields, `${path}.fields`)
  const mode = readEnum(record.mode, WRITE_MODES, `${path}.mode`)
  const adoptionExtension = record.adoptionExtension === undefined
    ? undefined
    : readString(record.adoptionExtension, `${path}.adoptionExtension`, { max: 120 })
  const extension = adoptionExtension
    ? ADOPTION_EXTENSIONS.find(item => item.id === adoptionExtension)
    : undefined
  if (adoptionExtension && (!extension || extension.target !== table)) {
    failSchema(
      'unknown_adoption_extension',
      `${path}.adoptionExtension`,
      `未登记或与目标表不匹配的采纳扩展 ${adoptionExtension}`,
    )
  }
  if (mode === 'none' && fields.length > 0) {
    failSchema('invalid_permission', path, 'mode=none 时不得声明可写字段')
  }
  if (mode !== 'none' && fields.length === 0 && !adoptionExtension) {
    failSchema('invalid_permission', path, '可写目标必须声明至少一个字段')
  }
  const registeredFields = new Set((FIELD_BY_TARGET.get(table) ?? []).map(field => field.field))
  for (const field of fields) {
    if (!registeredFields.has(field)) {
      failSchema('unknown_write_field', `${path}.fields`, `${table}.${field} 未在 FIELD_REGISTRY 登记`)
    }
  }
  return {
    table,
    fields,
    mode,
    ...(adoptionExtension ? { adoptionExtension } : {}),
  }
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

function readExecutionBinding(value: unknown, path: string): AgentRunStepExecutionBindingV1 {
  const record = readRecord(value, path)
  const keys = [
    'stepId',
    'version',
    'skillId',
    'skillVersion',
    'promptVersion',
    'toolSchemaVersion',
    'toolSchemaHash',
  ] as const
  assertExactKeys(record, keys, keys, path)
  if (record.version !== 1 || record.skillVersion !== 1) {
    failSchema('unsupported_version', path, '仅支持 execution binding v1 / Skill v1')
  }
  return {
    stepId: readString(record.stepId, `${path}.stepId`, { max: 160 }),
    version: 1,
    skillId: readString(record.skillId, `${path}.skillId`, { max: 160 }),
    skillVersion: 1,
    promptVersion: readString(record.promptVersion, `${path}.promptVersion`, { max: 160 }),
    toolSchemaVersion: readString(record.toolSchemaVersion, `${path}.toolSchemaVersion`, { max: 160 }),
    toolSchemaHash: readHash(record.toolSchemaHash, `${path}.toolSchemaHash`),
  }
}

function readParentLineage(value: unknown, path: string): AgentRunParentLineageV1 {
  const record = readRecord(value, path)
  assertExactKeys(
    record,
    ['runId', 'receiptHash', 'relation', 'artifactHash'],
    ['runId', 'receiptHash', 'relation'],
    path,
  )
  return {
    runId: readInteger(record.runId, `${path}.runId`, { min: 1 }),
    receiptHash: readHash(record.receiptHash, `${path}.receiptHash`),
    relation: readString(record.relation, `${path}.relation`, { max: 120 }),
    ...(record.artifactHash === undefined ? {} : {
      artifactHash: readHash(record.artifactHash, `${path}.artifactHash`),
    }),
  }
}

export function parseAgentRunContractV1(value: unknown): AgentRunContractV1 {
  const record = readRecord(value, 'contract')
  assertExactKeys(
    record,
    ['version', 'objective', 'workflowKind', 'lineage', 'scope', 'permissions', 'runtimeBindingHash', 'executionBindings', 'dependencyReceiptPolicy', 'candidateSemanticReviewPolicy', 'budget', 'acceptance', 'verificationPlan', 'failurePolicy'],
    ['version', 'objective', 'workflowKind', 'scope', 'permissions', 'budget', 'acceptance', 'verificationPlan', 'failurePolicy'],
    'contract',
  )
  if (record.version !== 1) failSchema('unsupported_version', 'contract.version', '仅支持版本 1')

  let lineage: AgentRunContractV1['lineage']
  if (record.lineage !== undefined) {
    const lineageRecord = readRecord(record.lineage, 'contract.lineage')
    assertExactKeys(lineageRecord, ['parent'], ['parent'], 'contract.lineage')
    lineage = { parent: readParentLineage(lineageRecord.parent, 'contract.lineage.parent') }
  }

  const scopeRecord = readRecord(record.scope, 'contract.scope')
  assertExactKeys(
    scopeRecord,
    ['projectId', 'worldGroupId', 'chapterIds', 'outlineNodeIds', 'runtime'],
    ['projectId', 'worldGroupId'],
    'contract.scope',
  )
  const worldGroupId = scopeRecord.worldGroupId === null
    ? null
    : readInteger(scopeRecord.worldGroupId, 'contract.scope.worldGroupId', { min: 1 })
  let runtime: AgentRunContractV1['scope']['runtime']
  if (scopeRecord.runtime !== undefined) {
    const runtimeRecord = readRecord(scopeRecord.runtime, 'contract.scope.runtime')
    assertExactKeys(
      runtimeRecord,
      ['simulationSessionId', 'baseSequence', 'stateHash', 'visibilityHash', 'releaseHash'],
      ['simulationSessionId', 'baseSequence', 'stateHash', 'visibilityHash', 'releaseHash'],
      'contract.scope.runtime',
    )
    runtime = {
      simulationSessionId: readInteger(runtimeRecord.simulationSessionId, 'contract.scope.runtime.simulationSessionId', { min: 1 }),
      baseSequence: readInteger(runtimeRecord.baseSequence, 'contract.scope.runtime.baseSequence', { min: 0 }),
      stateHash: readHash(runtimeRecord.stateHash, 'contract.scope.runtime.stateHash'),
      visibilityHash: readHash(runtimeRecord.visibilityHash, 'contract.scope.runtime.visibilityHash'),
      releaseHash: readHash(runtimeRecord.releaseHash, 'contract.scope.runtime.releaseHash'),
    }
  }

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
  const executionBindings = record.executionBindings === undefined
    ? undefined
    : readArray(record.executionBindings, 'contract.executionBindings')
        .map((item, index) => readExecutionBinding(item, `contract.executionBindings[${index}]`))
  if (executionBindings?.length === 0) {
    failSchema('invalid_execution_binding', 'contract.executionBindings', '存在字段时不得为空')
  }
  if (executionBindings) assertUnique(executionBindings.map(item => item.stepId), 'contract.executionBindings')

  let dependencyReceiptPolicy: AgentRunContractV1['dependencyReceiptPolicy']
  if (record.dependencyReceiptPolicy !== undefined) {
    const policy = readRecord(record.dependencyReceiptPolicy, 'contract.dependencyReceiptPolicy')
    assertExactKeys(
      policy,
      ['requiredForJoin', 'verifierSetVersion'],
      ['requiredForJoin', 'verifierSetVersion'],
      'contract.dependencyReceiptPolicy',
    )
    if (policy.requiredForJoin !== true) {
      failSchema(
        'invalid_value',
        'contract.dependencyReceiptPolicy.requiredForJoin',
        '存在策略时必须启用 join 回执',
      )
    }
    dependencyReceiptPolicy = {
      requiredForJoin: true,
      verifierSetVersion: readString(
        policy.verifierSetVersion,
        'contract.dependencyReceiptPolicy.verifierSetVersion',
        { max: 160 },
      ),
    }
  }

  let candidateSemanticReviewPolicy: AgentRunContractV1['candidateSemanticReviewPolicy']
  if (record.candidateSemanticReviewPolicy !== undefined) {
    const policy = readRecord(
      record.candidateSemanticReviewPolicy,
      'contract.candidateSemanticReviewPolicy',
    )
    assertExactKeys(
      policy,
      ['requiredForJoin', 'verifierSetVersion', 'taskIds'],
      ['requiredForJoin', 'verifierSetVersion', 'taskIds'],
      'contract.candidateSemanticReviewPolicy',
    )
    if (policy.requiredForJoin !== true) {
      failSchema(
        'invalid_value',
        'contract.candidateSemanticReviewPolicy.requiredForJoin',
        '存在策略时必须启用语义终验 join',
      )
    }
    const taskIds = readArray(policy.taskIds, 'contract.candidateSemanticReviewPolicy.taskIds')
      .map((item, index) => readString(
        item,
        `contract.candidateSemanticReviewPolicy.taskIds[${index}]`,
        { max: 80 },
      ))
    if (taskIds.length === 0) {
      failSchema('invalid_value', 'contract.candidateSemanticReviewPolicy.taskIds', '不得为空')
    }
    assertUnique(taskIds, 'contract.candidateSemanticReviewPolicy.taskIds')
    candidateSemanticReviewPolicy = {
      requiredForJoin: true,
      verifierSetVersion: readString(
        policy.verifierSetVersion,
        'contract.candidateSemanticReviewPolicy.verifierSetVersion',
        { max: 160 },
      ),
      taskIds,
    }
    if (!dependencyReceiptPolicy) {
      failSchema(
        'invalid_value',
        'contract.candidateSemanticReviewPolicy',
        '语义终验 join 必须建立在候选确定性回执策略之上',
      )
    }
  }

  const budgetRecord = readRecord(record.budget, 'contract.budget')
  const requiredBudgetKeys = ['maxModelCalls', 'maxToolCalls', 'maxInputTokens', 'maxOutputTokens', 'maxAttemptsPerStep'] as const
  const budgetKeys = [...requiredBudgetKeys, 'maxReplans', 'maxToolResultTokens', 'maxProtocolErrors'] as const
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
    ...(lineage ? { lineage } : {}),
    scope: {
      projectId: readInteger(scopeRecord.projectId, 'contract.scope.projectId', { min: 1 }),
      worldGroupId,
      chapterIds: readIdArray(scopeRecord.chapterIds, 'contract.scope.chapterIds'),
      outlineNodeIds: readIdArray(scopeRecord.outlineNodeIds, 'contract.scope.outlineNodeIds'),
      ...(runtime ? { runtime } : {}),
    },
    permissions: { contextSourceKeys, writeTargets },
    ...(record.runtimeBindingHash === undefined ? {} : {
      runtimeBindingHash: readHash(record.runtimeBindingHash, 'contract.runtimeBindingHash'),
    }),
    ...(executionBindings ? { executionBindings } : {}),
    ...(dependencyReceiptPolicy ? { dependencyReceiptPolicy } : {}),
    ...(candidateSemanticReviewPolicy ? { candidateSemanticReviewPolicy } : {}),
    budget: {
      maxModelCalls: readInteger(budgetRecord.maxModelCalls, 'contract.budget.maxModelCalls', { min: 1 }),
      maxToolCalls: readInteger(budgetRecord.maxToolCalls, 'contract.budget.maxToolCalls', { min: 0 }),
      maxInputTokens: readInteger(budgetRecord.maxInputTokens, 'contract.budget.maxInputTokens', { min: 1 }),
      maxOutputTokens: readInteger(budgetRecord.maxOutputTokens, 'contract.budget.maxOutputTokens', { min: 1 }),
      maxAttemptsPerStep: readInteger(budgetRecord.maxAttemptsPerStep, 'contract.budget.maxAttemptsPerStep', { min: 1 }),
      ...(budgetRecord.maxReplans === undefined ? {} : {
        maxReplans: readInteger(budgetRecord.maxReplans, 'contract.budget.maxReplans', { min: 0 }),
      }),
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
