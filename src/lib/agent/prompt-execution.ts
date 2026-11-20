import { INSPIRATION_PREPARATION_MODULES, type InspirationPreparationPromptModuleKey } from '../inspiration/preparation-contract'
import { renderPrompt } from '../ai/prompt-engine'
import type { ChatMessage } from '../types'
import type {
  PromptExample,
  PromptModuleKey,
  PromptParameter,
  PromptTemplate,
  PromptVariableContext,
} from '../types/prompt'
import { hashCanonicalValue } from './run/hash'

export const PROMPT_EXECUTION_VERSION_V1 = 1 as const
export const MAX_PROMPT_OVERRIDE_CHARS_V1 = 40_000
export const MAX_PROMPT_PARAMETER_JSON_CHARS_V1 = 40_000
export const MAX_PROMPT_TEMPLATE_CHARS_V1 = 120_000
export const MAX_PROMPT_AUTHOR_INSTRUCTION_CHARS_V1 = 8_000

export type GovernedPromptModuleKeyV1 =
  | 'worldview.dimension'
  | 'story.generate'
  | 'character.generate'
  | InspirationPreparationPromptModuleKey
  | 'inspiration.reverse'
  | 'inspiration.reverse.multiworld'

export interface PromptExecutionRequestV1 {
  version: typeof PROMPT_EXECUTION_VERSION_V1
  moduleKey: GovernedPromptModuleKeyV1
  parameterValues?: Record<string, unknown>
  systemOverride?: string | null
  userOverride?: string | null
  temperature?: number
  maxTokens?: number
}

export interface PromptTemplateSnapshotV1 {
  id: number | null
  scope: 'system' | 'user'
  moduleKey: GovernedPromptModuleKeyV1
  promptType: string
  name: string
  description: string
  systemPrompt: string
  userPromptTemplate: string
  variables: string[]
  modelOverride?: { temperature?: number; maxTokens?: number }
  parameters?: PromptParameter[]
  examples?: { good?: PromptExample[]; bad?: PromptExample[] }
  createdAt: number
  updatedAt: number
}

/** Immutable plan input. The complete template is deliberately stored in the durable plan. */
export interface PromptExecutionOptionsV1 extends PromptExecutionRequestV1 {
  template: PromptTemplateSnapshotV1
  templateHash: string
  parameterValuesHash: string
  overridesHash: string
}

/** Candidate/run evidence for the messages that were actually sent to the model. */
export interface PromptExecutionEvidenceV1 {
  version: typeof PROMPT_EXECUTION_VERSION_V1
  moduleKey: GovernedPromptModuleKeyV1
  templateId: number | null
  templateName: string
  templateScope: 'system' | 'user'
  templateUpdatedAt: number
  templateHash: string
  parameterValuesHash: string
  overridesHash: string
  renderedPromptHash: string
  effectiveTemperature: number | null
  effectiveMaxTokens: number | null
}

const GOVERNED_MODULES = new Set<PromptModuleKey>([
  'inspiration.reverse', 'inspiration.reverse.multiworld',
  ...Object.values(INSPIRATION_PREPARATION_MODULES),
  'worldview.dimension',
  'story.generate',
  'character.generate',
])

function fail(message: string): never {
  throw new Error(`Prompt 执行契约无效：${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function assertString(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    fail(`${label} 超出允许范围或为空`)
  }
  return value
}

function assertFiniteNumber(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${label} 必须在 ${min}-${max} 之间`)
  }
  return value
}

function normalizeNullableOverride(value: unknown, label: string): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const result = assertString(value, label, MAX_PROMPT_OVERRIDE_CHARS_V1, true)
  return result.trim() ? result : null
}

function normalizeParameterValues(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) fail('parameterValues 必须是对象')
  const entries = Object.entries(value)
  if (entries.length > 64) fail('parameterValues 最多允许 64 项')
  const normalized: Record<string, unknown> = {}
  for (const [key, item] of entries) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) fail(`参数名 ${key} 无效`)
    if (
      item !== null
      && typeof item !== 'string'
      && typeof item !== 'number'
      && typeof item !== 'boolean'
    ) fail(`参数 ${key} 只允许字符串、数字、布尔值或 null`)
    if (typeof item === 'string' && item.length > 20_000) fail(`参数 ${key} 超过 20000 字符`)
    if (typeof item === 'number' && !Number.isFinite(item)) fail(`参数 ${key} 不是有限数字`)
    normalized[key] = item
  }
  if (JSON.stringify(normalized).length > MAX_PROMPT_PARAMETER_JSON_CHARS_V1) {
    fail(`parameterValues 总长度超过 ${MAX_PROMPT_PARAMETER_JSON_CHARS_V1} 字符`)
  }
  return normalized
}

function normalizeModuleKey(value: unknown): GovernedPromptModuleKeyV1 {
  if (typeof value !== 'string' || !GOVERNED_MODULES.has(value as PromptModuleKey)) {
    fail(`moduleKey ${String(value)} 未登记为本阶段正式模块`)
  }
  return value as GovernedPromptModuleKeyV1
}

function normalizeTemplateParameters(value: unknown): PromptParameter[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 64) fail('template.parameters 无效或超过 64 项')
  const seen = new Set<string>()
  return value.map((item, index) => {
    if (!isRecord(item)) fail(`template.parameters[${index}] 无效`)
    const allowed = new Set([
      'key', 'label', 'type', 'options', 'min', 'max', 'step', 'maxFromModelOutput',
      'default', 'description', 'optional',
    ])
    if (Object.keys(item).some(field => !allowed.has(field))) fail(`template.parameters[${index}] 包含未知字段`)
    if (item.optional !== undefined && typeof item.optional !== 'boolean') fail(`template.parameters[${index}].optional 无效`)
    if (item.maxFromModelOutput !== undefined && typeof item.maxFromModelOutput !== 'boolean') {
      fail(`template.parameters[${index}].maxFromModelOutput 无效`)
    }
    const key = assertString(item.key, `template.parameters[${index}].key`, 64)
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key) || seen.has(key)) {
      fail(`template.parameters[${index}].key 无效或重复`)
    }
    seen.add(key)
    if (!['select', 'slider', 'number', 'text', 'boolean'].includes(String(item.type))) {
      fail(`template.parameters[${index}].type 无效`)
    }
    const defaultValue = item.default
    if (!['string', 'number', 'boolean'].includes(typeof defaultValue)) {
      fail(`template.parameters[${index}].default 无效`)
    }
    if (typeof defaultValue === 'number' && !Number.isFinite(defaultValue)) {
      fail(`template.parameters[${index}].default 无效`)
    }
    const options = item.options === undefined
      ? undefined
      : Array.isArray(item.options) && item.options.length <= 100
        ? item.options.map((option, optionIndex) => (
            assertString(option, `template.parameters[${index}].options[${optionIndex}]`, 500)
          ))
        : fail(`template.parameters[${index}].options 无效`)
    const min = assertFiniteNumber(item.min, `template.parameters[${index}].min`, -1_000_000_000, 1_000_000_000)
    const max = assertFiniteNumber(item.max, `template.parameters[${index}].max`, -1_000_000_000, 1_000_000_000)
    const step = assertFiniteNumber(item.step, `template.parameters[${index}].step`, 0.000001, 1_000_000_000)
    if (min !== undefined && max !== undefined && min > max) fail(`template.parameters[${index}] min 大于 max`)
    return {
      key,
      label: assertString(item.label, `template.parameters[${index}].label`, 500),
      type: item.type as PromptParameter['type'],
      ...(options ? { options } : {}),
      ...(min === undefined ? {} : { min }),
      ...(max === undefined ? {} : { max }),
      ...(step === undefined ? {} : { step }),
      ...(item.maxFromModelOutput === true ? { maxFromModelOutput: true } : {}),
      default: defaultValue as PromptParameter['default'],
      ...(item.description === undefined
        ? {}
        : { description: assertString(item.description, `template.parameters[${index}].description`, 4_000, true) }),
      ...(item.optional === true ? { optional: true } : {}),
    }
  })
}

function normalizeExamples(value: unknown): PromptTemplateSnapshotV1['examples'] | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) fail('template.examples 无效')
  if (Object.keys(value).some(key => key !== 'good' && key !== 'bad')) fail('template.examples 包含未知字段')
  const normalizeList = (items: unknown, label: string): PromptExample[] | undefined => {
    if (items === undefined) return undefined
    if (!Array.isArray(items) || items.length > 20) fail(`${label} 无效或超过 20 项`)
    return items.map((item, index) => {
      if (!isRecord(item)) fail(`${label}[${index}] 无效`)
      const allowed = new Set(['id', 'text', 'rating', 'source', 'note', 'createdAt'])
      if (Object.keys(item).some(field => !allowed.has(field))) fail(`${label}[${index}] 包含未知字段`)
      if (!['system', 'ai-generated', 'user-marked'].includes(String(item.source))) {
        fail(`${label}[${index}].source 无效`)
      }
      const rating = item.rating === undefined
        ? undefined
        : assertFiniteNumber(item.rating, `${label}[${index}].rating`, 1, 5)
      if (!Number.isInteger(item.createdAt) || Number(item.createdAt) < 0) fail(`${label}[${index}].createdAt 无效`)
      return {
        id: assertString(item.id, `${label}[${index}].id`, 160),
        text: assertString(item.text, `${label}[${index}].text`, 40_000, true),
        ...(rating === undefined ? {} : { rating }),
        source: item.source as PromptExample['source'],
        ...(item.note === undefined ? {} : { note: assertString(item.note, `${label}[${index}].note`, 4_000, true) }),
        createdAt: Number(item.createdAt),
      }
    })
  }
  const good = normalizeList(value.good, 'template.examples.good')
  const bad = normalizeList(value.bad, 'template.examples.bad')
  return {
    ...(good ? { good } : {}),
    ...(bad ? { bad } : {}),
  }
}

function snapshotTemplate(
  template: PromptTemplate,
  expectedModuleKey: GovernedPromptModuleKeyV1,
): PromptTemplateSnapshotV1 {
  if (template.moduleKey !== expectedModuleKey) fail('模板 moduleKey 与请求不一致')
  const systemPrompt = assertString(
    template.systemPrompt,
    'template.systemPrompt',
    MAX_PROMPT_TEMPLATE_CHARS_V1,
    true,
  )
  const userPromptTemplate = assertString(
    template.userPromptTemplate,
    'template.userPromptTemplate',
    MAX_PROMPT_TEMPLATE_CHARS_V1,
    true,
  )
  if (!systemPrompt.trim() && !userPromptTemplate.trim()) fail('模板 system/user 不能同时为空')
  if (template.scope !== 'system' && template.scope !== 'user') fail('template.scope 无效')
  const id = template.id === undefined || template.id === null
    ? null
    : Number.isInteger(template.id) && template.id > 0
      ? template.id
      : fail('template.id 无效')
  const modelOverride = template.modelOverride
    ? {
        ...(assertFiniteNumber(template.modelOverride.temperature, 'template.temperature', 0, 2) === undefined
          ? {}
          : { temperature: template.modelOverride.temperature }),
        ...(assertFiniteNumber(template.modelOverride.maxTokens, 'template.maxTokens', 1, 2_000_000) === undefined
          ? {}
          : { maxTokens: template.modelOverride.maxTokens }),
      }
    : undefined
  const parameters = normalizeTemplateParameters(template.parameters)
  const examples = normalizeExamples(template.examples)
  if (!Number.isInteger(template.createdAt) || template.createdAt < 0) fail('template.createdAt 无效')
  if (!Number.isInteger(template.updatedAt) || template.updatedAt < 0) fail('template.updatedAt 无效')
  return cloneJson({
    id,
    scope: template.scope,
    moduleKey: expectedModuleKey,
    promptType: assertString(template.promptType, 'template.promptType', 160),
    name: assertString(template.name, 'template.name', 500),
    description: assertString(template.description, 'template.description', 4_000, true),
    systemPrompt,
    userPromptTemplate,
    variables: Array.isArray(template.variables)
      ? template.variables.map((item, index) => assertString(item, `template.variables[${index}]`, 160))
      : fail('template.variables 必须是数组'),
    ...(modelOverride && Object.keys(modelOverride).length ? { modelOverride } : {}),
    ...(parameters ? { parameters } : {}),
    ...(examples ? { examples } : {}),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  })
}

export function createPromptExecutionRequestV1(input: Omit<PromptExecutionRequestV1, 'version'>): PromptExecutionRequestV1 {
  const moduleKey = normalizeModuleKey(input.moduleKey)
  const parameterValues = normalizeParameterValues(input.parameterValues)
  const systemOverride = normalizeNullableOverride(input.systemOverride, 'systemOverride')
  const userOverride = normalizeNullableOverride(input.userOverride, 'userOverride')
  const temperature = assertFiniteNumber(input.temperature, 'temperature', 0, 2)
  const maxTokens = assertFiniteNumber(input.maxTokens, 'maxTokens', 1, 2_000_000)
  return {
    version: 1,
    moduleKey,
    ...(parameterValues ? { parameterValues } : {}),
    ...(systemOverride === undefined ? {} : { systemOverride }),
    ...(userOverride === undefined ? {} : { userOverride }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }
}

export async function freezePromptExecutionOptionsV1(input: {
  request: PromptExecutionRequestV1
  template: PromptTemplate
}): Promise<PromptExecutionOptionsV1> {
  const request = createPromptExecutionRequestV1(input.request)
  const template = snapshotTemplate(input.template, request.moduleKey)
  const parameterValues = request.parameterValues ?? {}
  const declaredParameters = new Set((template.parameters ?? []).map(parameter => parameter.key))
  for (const key of Object.keys(parameterValues)) {
    if (!declaredParameters.has(key)) fail(`参数 ${key} 未在冻结模板中声明`)
  }
  const overrides = {
    systemOverride: request.systemOverride ?? null,
    userOverride: request.userOverride ?? null,
  }
  return {
    ...request,
    template,
    templateHash: await hashCanonicalValue(template),
    parameterValuesHash: await hashCanonicalValue(parameterValues),
    overridesHash: await hashCanonicalValue(overrides),
  }
}

export function assertPromptAuthorInstructionV1(value: string): string {
  if (typeof value !== 'string' || !value.trim()) fail('作者要求不能为空')
  if (value.length > MAX_PROMPT_AUTHOR_INSTRUCTION_CHARS_V1) {
    fail(`作者要求超过 ${MAX_PROMPT_AUTHOR_INSTRUCTION_CHARS_V1} 字符；请缩短后再调用模型`)
  }
  return value.trim()
}

export function parsePromptExecutionOptionsV1(
  value: unknown,
  expectedModuleKey?: GovernedPromptModuleKeyV1,
): PromptExecutionOptionsV1 {
  if (!isRecord(value) || value.version !== 1) fail('options 版本无效')
  const allowed = new Set([
    'version', 'moduleKey', 'parameterValues', 'systemOverride', 'userOverride',
    'temperature', 'maxTokens', 'template', 'templateHash', 'parameterValuesHash', 'overridesHash',
  ])
  if (Object.keys(value).some(key => !allowed.has(key))) fail('options 包含未声明字段')
  const request = createPromptExecutionRequestV1({
    moduleKey: normalizeModuleKey(value.moduleKey),
    ...(value.parameterValues === undefined ? {} : { parameterValues: value.parameterValues as Record<string, unknown> }),
    ...(value.systemOverride === undefined ? {} : { systemOverride: value.systemOverride as string | null }),
    ...(value.userOverride === undefined ? {} : { userOverride: value.userOverride as string | null }),
    ...(value.temperature === undefined ? {} : { temperature: value.temperature as number }),
    ...(value.maxTokens === undefined ? {} : { maxTokens: value.maxTokens as number }),
  })
  if (expectedModuleKey && request.moduleKey !== expectedModuleKey) fail('options moduleKey 与 Skill 不一致')
  if (!isRecord(value.template)) fail('template 快照缺失')
  const template = snapshotTemplate(value.template as unknown as PromptTemplate, request.moduleKey)
  if (!isHash(value.templateHash) || !isHash(value.parameterValuesHash) || !isHash(value.overridesHash)) {
    fail('冻结 hash 无效')
  }
  return {
    ...request,
    template,
    templateHash: value.templateHash,
    parameterValuesHash: value.parameterValuesHash,
    overridesHash: value.overridesHash,
  }
}

export async function verifyPromptExecutionOptionsV1(options: PromptExecutionOptionsV1): Promise<void> {
  const parsed = parsePromptExecutionOptionsV1(options, options.moduleKey)
  const expectedTemplateHash = await hashCanonicalValue(parsed.template)
  const expectedParametersHash = await hashCanonicalValue(parsed.parameterValues ?? {})
  const expectedOverridesHash = await hashCanonicalValue({
    systemOverride: parsed.systemOverride ?? null,
    userOverride: parsed.userOverride ?? null,
  })
  if (
    parsed.templateHash !== expectedTemplateHash
    || parsed.parameterValuesHash !== expectedParametersHash
    || parsed.overridesHash !== expectedOverridesHash
  ) fail('冻结内容与 hash 不一致')
}

export async function renderFrozenPromptExecutionV1(input: {
  options: PromptExecutionOptionsV1
  context: PromptVariableContext
  hardSystem: string
  authorInstruction: string
  additionalUserMessages?: string[]
}): Promise<{
  messages: ChatMessage[]
  evidence: PromptExecutionEvidenceV1
  generationOverrides: { temperature?: number; maxTokens?: number }
}> {
  const options = parsePromptExecutionOptionsV1(input.options, input.options.moduleKey)
  await verifyPromptExecutionOptionsV1(options)
  const hardSystem = assertString(input.hardSystem, 'Harness hardSystem', 120_000)
  const authorInstruction = assertPromptAuthorInstructionV1(input.authorInstruction)
  const additional = (input.additionalUserMessages ?? []).map((message, index) => (
    assertString(message, `additionalUserMessages[${index}]`, 500_000)
  ))
  const rendered = renderPrompt(options.template as PromptTemplate, input.context, {
    parameterValues: options.parameterValues,
    overrides: {
      ...(options.systemOverride == null ? {} : { systemPrompt: options.systemOverride }),
      ...(options.userOverride == null ? {} : { userPromptTemplate: options.userOverride }),
    },
  })
  const systemMessages = rendered.messages.filter(message => message.role === 'system')
  const otherMessages = rendered.messages.filter(message => message.role !== 'system')
  // OpenAI-compatible gateways are inconsistent about accepting more than one
  // system message. Keep every frozen template instruction and the Harness hard
  // constraint, but send them as one provider-portable leading envelope. The
  // merged request is what renderedPromptHash and the Context Gateway transcript
  // bind, so durable evidence still describes the exact bytes sent to the model.
  const systemEnvelope = [...systemMessages.map(message => message.content), hardSystem]
    .join('\n\n')
  const messages: ChatMessage[] = [
    { role: 'system', content: systemEnvelope },
    ...otherMessages,
    { role: 'user', content: `【作者本轮明确要求】\n${authorInstruction}` },
    ...additional.map(content => ({ role: 'user' as const, content })),
  ]
  const effectiveTemperature = options.temperature ?? rendered.modelOverride?.temperature
  const effectiveMaxTokens = options.maxTokens ?? rendered.modelOverride?.maxTokens
  const evidence: PromptExecutionEvidenceV1 = {
    version: 1,
    moduleKey: options.moduleKey,
    templateId: options.template.id,
    templateName: options.template.name,
    templateScope: options.template.scope,
    templateUpdatedAt: options.template.updatedAt,
    templateHash: options.templateHash,
    parameterValuesHash: options.parameterValuesHash,
    overridesHash: options.overridesHash,
    renderedPromptHash: await hashCanonicalValue(messages),
    effectiveTemperature: effectiveTemperature ?? null,
    effectiveMaxTokens: effectiveMaxTokens ?? null,
  }
  return {
    messages,
    evidence,
    generationOverrides: {
      ...(effectiveTemperature === undefined ? {} : { temperature: effectiveTemperature }),
      ...(effectiveMaxTokens === undefined ? {} : { maxTokens: effectiveMaxTokens }),
    },
  }
}

export function parsePromptExecutionEvidenceV1(value: unknown): PromptExecutionEvidenceV1 {
  if (!isRecord(value)) fail('evidence 必须是对象')
  const keys = [
    'version', 'moduleKey', 'templateId', 'templateName', 'templateScope', 'templateUpdatedAt',
    'templateHash', 'parameterValuesHash', 'overridesHash', 'renderedPromptHash',
    'effectiveTemperature', 'effectiveMaxTokens',
  ]
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) {
    fail('evidence 字段不符合严格契约')
  }
  const moduleKey = normalizeModuleKey(value.moduleKey)
  const templateId = value.templateId === null
    ? null
    : Number.isInteger(value.templateId) && Number(value.templateId) > 0
      ? Number(value.templateId)
      : fail('evidence.templateId 无效')
  if (value.templateScope !== 'system' && value.templateScope !== 'user') fail('evidence.templateScope 无效')
  if (![value.templateHash, value.parameterValuesHash, value.overridesHash, value.renderedPromptHash].every(isHash)) {
    fail('evidence hash 无效')
  }
  const temperature = value.effectiveTemperature === null
    ? null
    : assertFiniteNumber(value.effectiveTemperature, 'evidence.effectiveTemperature', 0, 2)!
  const maxTokens = value.effectiveMaxTokens === null
    ? null
    : assertFiniteNumber(value.effectiveMaxTokens, 'evidence.effectiveMaxTokens', 1, 2_000_000)!
  return {
    version: 1,
    moduleKey,
    templateId,
    templateName: assertString(value.templateName, 'evidence.templateName', 500),
    templateScope: value.templateScope,
    templateUpdatedAt: assertFiniteNumber(value.templateUpdatedAt, 'evidence.templateUpdatedAt', 0, Number.MAX_SAFE_INTEGER)!,
    templateHash: value.templateHash as string,
    parameterValuesHash: value.parameterValuesHash as string,
    overridesHash: value.overridesHash as string,
    renderedPromptHash: value.renderedPromptHash as string,
    effectiveTemperature: temperature,
    effectiveMaxTokens: maxTokens,
  }
}

export function assertPromptEvidenceMatchesOptionsV1(
  evidence: PromptExecutionEvidenceV1,
  options: PromptExecutionOptionsV1,
): void {
  if (
    evidence.moduleKey !== options.moduleKey
    || evidence.templateId !== options.template.id
    || evidence.templateName !== options.template.name
    || evidence.templateScope !== options.template.scope
    || evidence.templateUpdatedAt !== options.template.updatedAt
    || evidence.templateHash !== options.templateHash
    || evidence.parameterValuesHash !== options.parameterValuesHash
    || evidence.overridesHash !== options.overridesHash
  ) fail('候选 evidence 与冻结 options 不一致')
}

export function promptExecutionRequestForModuleV1(
  moduleKey: GovernedPromptModuleKeyV1,
): PromptExecutionRequestV1 {
  return { version: 1, moduleKey }
}
