import { CONTEXT_SOURCE_BY_KEY } from '../../registry/context-sources'
import { FIELD_BY_TARGET } from '../../registry/field-registry'
import { ADOPTION_EXTENSIONS } from '../../registry/adoption-schema'
import { REGISTRY_BY_NAME } from '../../registry/project-tables'
import type {
  AcceptedAgentRunContract,
  AcceptedAgentRunContractV1,
  AcceptedAgentRunContractV2,
  AcceptedAgentRunContractV3,
  AgentRunAcceptanceCriterionV1,
  AgentRunAcceptanceKind,
  AgentRunContract,
  AgentRunContractV1,
  AgentRunContractV2,
  AgentRunContractV3,
  AgentExecutionBoundaryV1,
  AgentRunParentLineageV1,
  AgentRunStepExecutionBindingV2,
  AgentRunVerificationKind,
  AgentRunVerificationStepV1,
  AgentRunWorkflowKind,
  AgentRunStepExecutionBindingV1,
  AgentRunWriteMode,
  AgentRunWriteTargetV1,
} from '../../types/agent-run'
import { hashCanonicalValue } from './hash'
import { assertAgentSkillExecutionBindingIntegrityV2 } from '../execution-binding'
import {
  assertExactKeys,
  assertUnique,
  failSchema,
  readArray,
  readBoolean,
  readEnum,
  readHash,
  readInteger,
  readNonNegativeNumber,
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
const EXECUTION_BOUNDARIES: readonly AgentExecutionBoundaryV1[] = [
  'formal',
  'evaluation',
  'product-runtime',
  'experimental',
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
    'promptExecution',
    'formalEntry',
  ] as const
  assertExactKeys(record, keys, keys.filter(key => key !== 'promptExecution' && key !== 'formalEntry'), path)
  if (record.version !== 1 || record.skillVersion !== 1) {
    failSchema('unsupported_version', path, '仅支持 execution binding v1 / Skill v1')
  }
  let promptExecution: AgentRunStepExecutionBindingV1['promptExecution']
  if (record.promptExecution !== undefined) {
    const prompt = readRecord(record.promptExecution, `${path}.promptExecution`)
    const promptKeys = [
      'version', 'moduleKey', 'templateId', 'templateName', 'templateScope',
      'templateUpdatedAt', 'templateHash', 'parameterValuesHash', 'overridesHash',
    ] as const
    assertExactKeys(prompt, promptKeys, promptKeys, `${path}.promptExecution`)
    if (prompt.version !== 1) failSchema('unsupported_version', `${path}.promptExecution.version`, '仅支持 v1')
    if (prompt.templateScope !== 'system' && prompt.templateScope !== 'user') {
      failSchema('invalid_value', `${path}.promptExecution.templateScope`, '必须是 system 或 user')
    }
    promptExecution = {
      version: 1,
      moduleKey: readString(prompt.moduleKey, `${path}.promptExecution.moduleKey`, { max: 160 }),
      templateId: prompt.templateId === null
        ? null
        : readInteger(prompt.templateId, `${path}.promptExecution.templateId`, { min: 1 }),
      templateName: readString(prompt.templateName, `${path}.promptExecution.templateName`, { max: 500 }),
      templateScope: prompt.templateScope,
      templateUpdatedAt: readInteger(prompt.templateUpdatedAt, `${path}.promptExecution.templateUpdatedAt`),
      templateHash: readHash(prompt.templateHash, `${path}.promptExecution.templateHash`),
      parameterValuesHash: readHash(prompt.parameterValuesHash, `${path}.promptExecution.parameterValuesHash`),
      overridesHash: readHash(prompt.overridesHash, `${path}.promptExecution.overridesHash`),
    }
  }
  let formalEntry: AgentRunStepExecutionBindingV1['formalEntry']
  if (record.formalEntry !== undefined) {
    const entry = readRecord(record.formalEntry, `${path}.formalEntry`)
    const entryKeys = ['version', 'entryId', 'bindingJson', 'bindingHash'] as const
    assertExactKeys(entry, entryKeys, entryKeys, `${path}.formalEntry`)
    if (entry.version !== 1) failSchema('unsupported_version', `${path}.formalEntry.version`, '仅支持 v1')
    formalEntry = {
      version: 1,
      entryId: readString(entry.entryId, `${path}.formalEntry.entryId`, { max: 160 }),
      bindingJson: readString(entry.bindingJson, `${path}.formalEntry.bindingJson`, { max: 100_000 }),
      bindingHash: readHash(entry.bindingHash, `${path}.formalEntry.bindingHash`),
    }
  }
  return {
    stepId: readString(record.stepId, `${path}.stepId`, { max: 160 }),
    version: 1,
    skillId: readString(record.skillId, `${path}.skillId`, { max: 160 }),
    skillVersion: 1,
    promptVersion: readString(record.promptVersion, `${path}.promptVersion`, { max: 160 }),
    toolSchemaVersion: readString(record.toolSchemaVersion, `${path}.toolSchemaVersion`, { max: 160 }),
    toolSchemaHash: readHash(record.toolSchemaHash, `${path}.toolSchemaHash`),
    ...(promptExecution ? { promptExecution } : {}),
    ...(formalEntry ? { formalEntry } : {}),
  }
}

function readExecutionBindingV2(value: unknown, path: string): AgentRunStepExecutionBindingV2 {
  const record = readRecord(value, path)
  const keys = [
    'stepId',
    'version',
    'skillId',
    'skillVersion',
    'skillDefinitionJson',
    'skillDefinitionHash',
    'contextAccessPolicyHash',
    'promptVersion',
    'toolSchemaVersion',
    'toolSchemaHash',
    'contextSourceKeys',
    'optionalContextActivations',
    'writeTargets',
    'maxOutputTokens',
    'formalEntry',
  ] as const
  assertExactKeys(record, keys, keys.filter(key => key !== 'formalEntry'), path)
  if (record.version !== 2 || record.skillVersion !== 2) {
    failSchema('unsupported_version', path, '仅支持 execution binding v2 / Skill snapshot v2')
  }
  const contextSourceKeys = readArray(record.contextSourceKeys, `${path}.contextSourceKeys`)
    .map((item, index) => readString(item, `${path}.contextSourceKeys[${index}]`, { max: 160 }))
  assertUnique(contextSourceKeys, `${path}.contextSourceKeys`)
  for (const sourceKey of contextSourceKeys) {
    if (!CONTEXT_SOURCE_BY_KEY.has(sourceKey)) {
      failSchema('unknown_context_source', `${path}.contextSourceKeys`, `未登记的上下文源 ${sourceKey}`)
    }
  }
  const optionalContextActivations = readArray(
    record.optionalContextActivations,
    `${path}.optionalContextActivations`,
  ).map((item, index) => {
    const activationPath = `${path}.optionalContextActivations[${index}]`
    const activation = readRecord(item, activationPath)
    assertExactKeys(
      activation,
      ['sourceKey', 'reasonCode', 'boundaryHash'],
      ['sourceKey', 'reasonCode'],
      activationPath,
    )
    return {
      sourceKey: readString(activation.sourceKey, `${activationPath}.sourceKey`, { max: 160 }),
      reasonCode: readEnum(
        activation.reasonCode,
        ['perspective-character', 'prior-outline-candidate', 'explicit-runtime-boundary'],
        `${activationPath}.reasonCode`,
      ),
      ...(activation.boundaryHash === undefined ? {} : {
        boundaryHash: readHash(activation.boundaryHash, `${activationPath}.boundaryHash`),
      }),
    }
  })
  assertUnique(optionalContextActivations.map(item => item.sourceKey), `${path}.optionalContextActivations`)
  for (const activation of optionalContextActivations) {
    if (!contextSourceKeys.includes(activation.sourceKey)) {
      failSchema('invalid_execution_binding', path, `激活来源 ${activation.sourceKey} 未进入实际上下文集合`)
    }
  }
  const writeTargets = readArray(record.writeTargets, `${path}.writeTargets`)
    .map((item, index) => readWriteTarget(item, `${path}.writeTargets[${index}]`))
  assertUnique(
    writeTargets.map(item => `${item.table}:${item.adoptionExtension ?? ''}`),
    `${path}.writeTargets`,
  )
  const formalEntry = record.formalEntry === undefined
    ? undefined
    : readExecutionBinding({
      stepId: record.stepId,
      version: 1,
      skillId: record.skillId,
      skillVersion: 1,
      promptVersion: record.promptVersion,
      toolSchemaVersion: record.toolSchemaVersion,
      toolSchemaHash: record.toolSchemaHash,
      formalEntry: record.formalEntry,
    }, `${path}.formalEntryCarrier`).formalEntry
  return {
    stepId: readString(record.stepId, `${path}.stepId`, { max: 160 }),
    version: 2,
    skillId: readString(record.skillId, `${path}.skillId`, { max: 160 }),
    skillVersion: 2,
    skillDefinitionJson: readString(record.skillDefinitionJson, `${path}.skillDefinitionJson`, { max: 100_000 }),
    skillDefinitionHash: readHash(record.skillDefinitionHash, `${path}.skillDefinitionHash`),
    contextAccessPolicyHash: readHash(record.contextAccessPolicyHash, `${path}.contextAccessPolicyHash`),
    promptVersion: readString(record.promptVersion, `${path}.promptVersion`, { max: 160 }),
    toolSchemaVersion: readString(record.toolSchemaVersion, `${path}.toolSchemaVersion`, { max: 160 }),
    toolSchemaHash: readHash(record.toolSchemaHash, `${path}.toolSchemaHash`),
    contextSourceKeys,
    optionalContextActivations,
    writeTargets,
    maxOutputTokens: readInteger(record.maxOutputTokens, `${path}.maxOutputTokens`, { min: 1 }),
    ...(formalEntry ? { formalEntry } : {}),
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
    ['version', 'objective', 'workflowKind', 'ownership', 'lineage', 'scope', 'permissions', 'runtimeBindingHash', 'executionBindings', 'dependencyReceiptPolicy', 'candidateSemanticReviewPolicy', 'automationAuthorization', 'budget', 'acceptance', 'verificationPlan', 'failurePolicy'],
    ['version', 'objective', 'workflowKind', 'scope', 'permissions', 'budget', 'acceptance', 'verificationPlan', 'failurePolicy'],
    'contract',
  )
  if (record.version !== 1) failSchema('unsupported_version', 'contract.version', '仅支持版本 1')

  let ownership: AgentRunContractV1['ownership']
  if (record.ownership !== undefined) {
    const ownershipRecord = readRecord(record.ownership, 'contract.ownership')
    assertExactKeys(ownershipRecord, ['parentRunId', 'relation'], ['parentRunId', 'relation'], 'contract.ownership')
    ownership = {
      parentRunId: readInteger(ownershipRecord.parentRunId, 'contract.ownership.parentRunId', { min: 1 }),
      relation: readString(ownershipRecord.relation, 'contract.ownership.relation', { max: 220 }),
    }
  }

  let lineage: AgentRunContractV1['lineage']
  if (record.lineage !== undefined) {
    const lineageRecord = readRecord(record.lineage, 'contract.lineage')
    assertExactKeys(lineageRecord, ['parent'], ['parent'], 'contract.lineage')
    lineage = { parent: readParentLineage(lineageRecord.parent, 'contract.lineage.parent') }
  }
  if (ownership && lineage) {
    failSchema('invalid_parent_relation', 'contract', 'ownership 与 lineage 互斥')
  }

  const scopeRecord = readRecord(record.scope, 'contract.scope')
  assertExactKeys(
    scopeRecord,
    ['projectId', 'worldGroupId', 'chapterIds', 'outlineNodeIds', 'runtime', 'productProduction'],
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
      ['productRuntimeSessionId', 'baseSequence', 'stateHash', 'visibilityHash', 'releaseHash'],
      ['productRuntimeSessionId', 'baseSequence', 'stateHash', 'visibilityHash', 'releaseHash'],
      'contract.scope.runtime',
    )
    runtime = {
      productRuntimeSessionId: readInteger(runtimeRecord.productRuntimeSessionId, 'contract.scope.runtime.productRuntimeSessionId', { min: 1 }),
      baseSequence: readInteger(runtimeRecord.baseSequence, 'contract.scope.runtime.baseSequence', { min: 0 }),
      stateHash: readHash(runtimeRecord.stateHash, 'contract.scope.runtime.stateHash'),
      visibilityHash: readHash(runtimeRecord.visibilityHash, 'contract.scope.runtime.visibilityHash'),
      releaseHash: readHash(runtimeRecord.releaseHash, 'contract.scope.runtime.releaseHash'),
    }
  }
  let productProduction: AgentRunContractV1['scope']['productProduction']
  if (scopeRecord.productProduction !== undefined) {
    const productionRecord = readRecord(scopeRecord.productProduction, 'contract.scope.productProduction')
    assertExactKeys(
      productionRecord,
      ['productBuildId', 'buildNumber', 'controlEpoch', 'planHash', 'taskKey'],
      ['productBuildId', 'buildNumber', 'controlEpoch', 'planHash', 'taskKey'],
      'contract.scope.productProduction',
    )
    productProduction = {
      productBuildId: readInteger(productionRecord.productBuildId, 'contract.scope.productProduction.productBuildId', { min: 1 }),
      buildNumber: readInteger(productionRecord.buildNumber, 'contract.scope.productProduction.buildNumber', { min: 1 }),
      controlEpoch: readInteger(productionRecord.controlEpoch, 'contract.scope.productProduction.controlEpoch', { min: 0 }),
      planHash: readHash(productionRecord.planHash, 'contract.scope.productProduction.planHash'),
      taskKey: readString(productionRecord.taskKey, 'contract.scope.productProduction.taskKey', { max: 200 }),
    }
  }
  if (runtime && productProduction) {
    failSchema('invalid_scope', 'contract.scope', 'runtime 与 productProduction 运行边界互斥')
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

  let automationAuthorization: AgentRunContractV1['automationAuthorization']
  if (record.automationAuthorization !== undefined) {
    const authorization = readRecord(record.automationAuthorization, 'contract.automationAuthorization')
    assertExactKeys(
      authorization,
      ['version', 'mode', 'policy', 'taskKey', 'settingsHash', 'sourceTextHash', 'taskTypes', 'modelRoutes', 'maxCostUsd', 'allowUnknownCost', 'estimate'],
      ['version', 'mode', 'policy', 'taskKey', 'settingsHash', 'sourceTextHash', 'taskTypes', 'maxCostUsd', 'allowUnknownCost', 'estimate'],
      'contract.automationAuthorization',
    )
    if (authorization.version !== 1) {
      failSchema('unsupported_version', 'contract.automationAuthorization.version', '仅支持版本 1')
    }
    const taskTypes = readArray(authorization.taskTypes, 'contract.automationAuthorization.taskTypes')
      .map((item, index) => readEnum(
        item,
        ['organization', 'memory', 'retrieval', 'consistency'] as const,
        `contract.automationAuthorization.taskTypes[${index}]`,
      ))
    if (taskTypes.length === 0) {
      failSchema('invalid_value', 'contract.automationAuthorization.taskTypes', '不得为空')
    }
    assertUnique(taskTypes, 'contract.automationAuthorization.taskTypes')
    const modelRoutes = authorization.modelRoutes === undefined
      ? undefined
      : readArray(authorization.modelRoutes, 'contract.automationAuthorization.modelRoutes').map((item, index) => {
        const route = readRecord(item, `contract.automationAuthorization.modelRoutes[${index}]`)
        assertExactKeys(
          route,
          ['taskType', 'provider', 'model'],
          ['taskType', 'provider', 'model'],
          `contract.automationAuthorization.modelRoutes[${index}]`,
        )
        return {
          taskType: readEnum(route.taskType, ['organization', 'memory'], `contract.automationAuthorization.modelRoutes[${index}].taskType`),
          provider: readString(route.provider, `contract.automationAuthorization.modelRoutes[${index}].provider`),
          model: readString(route.model, `contract.automationAuthorization.modelRoutes[${index}].model`),
        }
      })
    if (modelRoutes) assertUnique(modelRoutes.map(route => route.taskType), 'contract.automationAuthorization.modelRoutes')
    const estimate = readRecord(authorization.estimate, 'contract.automationAuthorization.estimate')
    assertExactKeys(
      estimate,
      ['modelCalls', 'inputTokensMin', 'inputTokensMax', 'outputTokensMin', 'outputTokensMax', 'costUsdMin', 'costUsdMax'],
      ['modelCalls', 'inputTokensMin', 'inputTokensMax', 'outputTokensMin', 'outputTokensMax', 'costUsdMin', 'costUsdMax'],
      'contract.automationAuthorization.estimate',
    )
    const nullableCost = (value: unknown, path: string) => value === null
      ? null
      : readNonNegativeNumber(value, path)
    automationAuthorization = {
      version: 1,
      mode: readEnum(authorization.mode, ['author-confirmed', 'preauthorized'], 'contract.automationAuthorization.mode'),
      policy: readEnum(authorization.policy, ['suggest', 'auto-with-budget'], 'contract.automationAuthorization.policy'),
      taskKey: readHash(authorization.taskKey, 'contract.automationAuthorization.taskKey'),
      settingsHash: readHash(authorization.settingsHash, 'contract.automationAuthorization.settingsHash'),
      sourceTextHash: readHash(authorization.sourceTextHash, 'contract.automationAuthorization.sourceTextHash'),
      taskTypes,
      ...(modelRoutes ? { modelRoutes } : {}),
      maxCostUsd: readNonNegativeNumber(authorization.maxCostUsd, 'contract.automationAuthorization.maxCostUsd'),
      allowUnknownCost: readBoolean(authorization.allowUnknownCost, 'contract.automationAuthorization.allowUnknownCost'),
      estimate: {
        modelCalls: readInteger(estimate.modelCalls, 'contract.automationAuthorization.estimate.modelCalls', { min: 0 }),
        inputTokensMin: readInteger(estimate.inputTokensMin, 'contract.automationAuthorization.estimate.inputTokensMin', { min: 0 }),
        inputTokensMax: readInteger(estimate.inputTokensMax, 'contract.automationAuthorization.estimate.inputTokensMax', { min: 0 }),
        outputTokensMin: readInteger(estimate.outputTokensMin, 'contract.automationAuthorization.estimate.outputTokensMin', { min: 0 }),
        outputTokensMax: readInteger(estimate.outputTokensMax, 'contract.automationAuthorization.estimate.outputTokensMax', { min: 0 }),
        costUsdMin: nullableCost(estimate.costUsdMin, 'contract.automationAuthorization.estimate.costUsdMin'),
        costUsdMax: nullableCost(estimate.costUsdMax, 'contract.automationAuthorization.estimate.costUsdMax'),
      },
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
    ...(ownership ? { ownership } : {}),
    ...(lineage ? { lineage } : {}),
    scope: {
      projectId: readInteger(scopeRecord.projectId, 'contract.scope.projectId', { min: 1 }),
      worldGroupId,
      chapterIds: readIdArray(scopeRecord.chapterIds, 'contract.scope.chapterIds'),
      outlineNodeIds: readIdArray(scopeRecord.outlineNodeIds, 'contract.scope.outlineNodeIds'),
      ...(runtime ? { runtime } : {}),
      ...(productProduction ? { productProduction } : {}),
    },
    permissions: { contextSourceKeys, writeTargets },
    ...(record.runtimeBindingHash === undefined ? {} : {
      runtimeBindingHash: readHash(record.runtimeBindingHash, 'contract.runtimeBindingHash'),
    }),
    ...(executionBindings ? { executionBindings } : {}),
    ...(dependencyReceiptPolicy ? { dependencyReceiptPolicy } : {}),
    ...(candidateSemanticReviewPolicy ? { candidateSemanticReviewPolicy } : {}),
    ...(automationAuthorization ? { automationAuthorization } : {}),
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

function writePermissionSignatures(targets: readonly AgentRunWriteTargetV1[]): string[] {
  const signatures: string[] = []
  for (const target of targets) {
    if (target.fields.length === 0) {
      signatures.push(`${target.table}:${target.adoptionExtension ?? ''}:${target.mode}:#extension`)
      continue
    }
    for (const field of target.fields) {
      signatures.push(`${target.table}:${target.adoptionExtension ?? ''}:${target.mode}:${field}`)
    }
  }
  return [...new Set(signatures)].sort()
}

function parseSkillBoundContract(
  value: unknown,
  expectedVersion: 2 | 3,
): {
  base: AgentRunContractV1
  executionBindings: AgentRunStepExecutionBindingV2[]
  record: Record<string, unknown>
} {
  const record = readRecord(value, 'contract')
  const allowedKeys = [
    'version',
    'objective',
    'workflowKind',
    'lineage',
    'scope',
    'permissions',
    'runtimeBindingHash',
    'executionBindings',
    'dependencyReceiptPolicy',
    'candidateSemanticReviewPolicy',
    'automationAuthorization',
    'budget',
    'acceptance',
    'verificationPlan',
    'failurePolicy',
    ...(expectedVersion === 3 ? ['executionBoundary'] as const : []),
  ] as const
  assertExactKeys(record, allowedKeys, [
    'version',
    'objective',
    'workflowKind',
    'scope',
    'permissions',
    'executionBindings',
    'budget',
    'acceptance',
    'verificationPlan',
    'failurePolicy',
    ...(expectedVersion === 3 ? ['executionBoundary'] as const : []),
  ], 'contract')
  if (record.version !== expectedVersion) {
    failSchema('unsupported_version', 'contract.version', `仅支持版本 ${expectedVersion}`)
  }
  const executionBindings = readArray(record.executionBindings, 'contract.executionBindings')
    .map((item, index) => readExecutionBindingV2(item, `contract.executionBindings[${index}]`))
  if (executionBindings.length === 0) {
    failSchema('invalid_execution_binding', 'contract.executionBindings', 'V2 正式契约必须包含 Skill 派生绑定')
  }
  assertUnique(executionBindings.map(item => item.stepId), 'contract.executionBindings')

  const baseShape = { ...record, version: 1 } as Record<string, unknown>
  delete baseShape.executionBindings
  if (expectedVersion === 3) delete baseShape.executionBoundary
  const base = parseAgentRunContractV1(baseShape)
  const permissionSources = [...new Set(base.permissions.contextSourceKeys)].sort()
  const bindingSources = [...new Set(executionBindings.flatMap(binding => binding.contextSourceKeys))].sort()
  if (JSON.stringify(permissionSources) !== JSON.stringify(bindingSources)) {
    failSchema(
      'invalid_execution_binding',
      'contract.permissions.contextSourceKeys',
      'V2 Run permissions 必须等于所有 Skill binding 的实际来源并集',
    )
  }
  const permissionWrites = writePermissionSignatures(base.permissions.writeTargets)
  const bindingWrites = writePermissionSignatures(executionBindings.flatMap(binding => binding.writeTargets))
  if (JSON.stringify(permissionWrites) !== JSON.stringify(bindingWrites)) {
    failSchema(
      'invalid_execution_binding',
      'contract.permissions.writeTargets',
      'V2 Run permissions 必须等于所有 Skill binding 的实际写目标并集',
    )
  }
  if (executionBindings.some(binding => binding.maxOutputTokens > base.budget.maxOutputTokens)) {
    failSchema(
      'invalid_execution_binding',
      'contract.budget.maxOutputTokens',
      'Run 输出预算不得小于任一步骤的 Skill 输出预算',
    )
  }
  return { base, executionBindings, record }
}

export function parseAgentRunContractV2(value: unknown): AgentRunContractV2 {
  const { base, executionBindings } = parseSkillBoundContract(value, 2)
  return { ...base, version: 2, executionBindings }
}

export function parseAgentRunContractV3(value: unknown): AgentRunContractV3 {
  const { base, executionBindings, record } = parseSkillBoundContract(value, 3)
  return {
    ...base,
    version: 3,
    executionBoundary: readEnum(
      record.executionBoundary,
      EXECUTION_BOUNDARIES,
      'contract.executionBoundary',
    ),
    executionBindings,
  }
}

export function parseAgentRunContract(value: unknown): AgentRunContract {
  const record = readRecord(value, 'contract')
  if (record.version === 1) return parseAgentRunContractV1(value)
  if (record.version === 2) return parseAgentRunContractV2(value)
  if (record.version === 3) return parseAgentRunContractV3(value)
  failSchema('unsupported_version', 'contract.version', '仅支持版本 1、2 或 3')
}

export async function acceptAgentRunContractV2(value: unknown): Promise<AcceptedAgentRunContractV2> {
  const contract = parseAgentRunContractV2(value)
  for (const binding of contract.executionBindings) {
    const { stepId: _stepId, ...skillBinding } = binding
    await assertAgentSkillExecutionBindingIntegrityV2(skillBinding, `Run step ${binding.stepId}`)
  }
  return { contract, contractHash: await hashCanonicalValue(contract) }
}

export async function acceptAgentRunContractV3(value: unknown): Promise<AcceptedAgentRunContractV3> {
  const contract = parseAgentRunContractV3(value)
  for (const binding of contract.executionBindings) {
    const { stepId: _stepId, ...skillBinding } = binding
    await assertAgentSkillExecutionBindingIntegrityV2(skillBinding, `Run step ${binding.stepId}`)
  }
  return { contract, contractHash: await hashCanonicalValue(contract) }
}

export async function acceptAgentRunContract(value: unknown): Promise<AcceptedAgentRunContract> {
  const record = readRecord(value, 'contract')
  if (record.version === 1) return acceptAgentRunContractV1(value)
  if (record.version === 2) return acceptAgentRunContractV2(value)
  if (record.version === 3) return acceptAgentRunContractV3(value)
  failSchema('unsupported_version', 'contract.version', '仅支持版本 1、2 或 3')
}
