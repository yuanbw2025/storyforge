import { PROMPT_MODULE_KEYS } from '../types/prompt'
import type {
  PromptApplicability, PromptExample, PromptParameter, PromptTemplate, PromptVariableBinding,
} from '../types/prompt'

/** Global template exchange is independent of a Project backup or a frozen Run. */
export const PROMPT_TEMPLATE_EXCHANGE_FORMAT = 'storyforge.prompt-templates'
export const PROMPT_TEMPLATE_EXCHANGE_VERSION = 1

export type PromptTemplateContent = Omit<
  PromptTemplate, 'id' | 'scope' | 'isActive' | 'parentId' | 'createdAt' | 'updatedAt'
>

// Exhaustive against the current persisted type, including fields that must not
// become local identity or activation authority when a file is imported.
const TEMPLATE_FIELDS: Record<keyof PromptTemplate, true> = {
  id: true, scope: true, moduleKey: true, promptType: true, name: true,
  description: true, systemPrompt: true, userPromptTemplate: true, variables: true,
  modelOverride: true, parentId: true, isActive: true, isDefault: true, genres: true,
  parameters: true, examples: true, lengthMode: true, continuityMode: true,
  assetId: true, variableBindings: true, applicability: true, createdAt: true, updatedAt: true,
}
const LOCAL_FIELDS = new Set(['id', 'scope', 'isActive', 'parentId', 'createdAt', 'updatedAt'])

function fail(path: string, message: string): never {
  throw new Error(`${path}：${message}`)
}

function object(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(path, '必须是对象')
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) fail(`${path}.${key}`, '未知字段')
  }
  return value as Record<string, unknown>
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, '必须是字符串')
  return value
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, '必须是布尔值')
  return value
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, '必须是有限数字')
  return value
}

function positiveId(value: unknown, path: string): number {
  const result = number(value, path)
  if (!Number.isSafeInteger(result) || result <= 0) fail(path, '必须是正整数')
  return result
}

function timestamp(value: unknown, path: string): number {
  const result = number(value, path)
  if (!Number.isSafeInteger(result) || result < 0) fail(path, '必须是非负整数时间')
  return result
}

function list<T>(value: unknown, path: string, read: (item: unknown, path: string) => T): T[] {
  if (!Array.isArray(value)) fail(path, '必须是数组')
  return value.map((item, index) => read(item, `${path}[${index}]`))
}

function choice<const T extends readonly string[]>(value: unknown, path: string, values: T): T[number] {
  if (typeof value !== 'string' || !values.some(item => item === value)) fail(path, '不支持的值')
  return value as T[number]
}

function optional<T>(value: unknown, read: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : read(value)
}

function parameter(value: unknown, path: string): PromptParameter {
  const fields: Record<keyof PromptParameter, true> = {
    key: true, label: true, type: true, options: true, min: true, max: true,
    step: true, maxFromModelOutput: true, default: true, description: true, optional: true,
  }
  const row = object(value, path, Object.keys(fields))
  const key = text(row.key, `${path}.key`)
  if (!/^[a-zA-Z0-9_]+$/.test(key)) fail(`${path}.key`, '只能包含字母、数字和下划线')
  const type = choice(row.type, `${path}.type`, ['select', 'slider', 'number', 'text', 'boolean'])
  const defaultValue = row.default
  if (typeof defaultValue !== 'string' && typeof defaultValue !== 'number' && typeof defaultValue !== 'boolean') {
    fail(`${path}.default`, '必须是字符串、数字或布尔值')
  }
  if (typeof defaultValue === 'number') number(defaultValue, `${path}.default`)
  const min = optional(row.min, item => number(item, `${path}.min`))
  const max = optional(row.max, item => number(item, `${path}.max`))
  const step = optional(row.step, item => number(item, `${path}.step`))
  if (min !== undefined && max !== undefined && min > max) fail(path, 'min 不能大于 max')
  if (step !== undefined && step <= 0) fail(`${path}.step`, '必须大于零')
  return {
    key, label: text(row.label, `${path}.label`), type, default: defaultValue,
    ...(row.options === undefined ? {} : { options: list(row.options, `${path}.options`, text) }),
    ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }),
    ...(step === undefined ? {} : { step }),
    ...(row.maxFromModelOutput === undefined ? {} : { maxFromModelOutput: boolean(row.maxFromModelOutput, `${path}.maxFromModelOutput`) }),
    ...(row.description === undefined ? {} : { description: text(row.description, `${path}.description`) }),
    ...(row.optional === undefined ? {} : { optional: boolean(row.optional, `${path}.optional`) }),
  }
}

function example(value: unknown, path: string): PromptExample {
  const fields: Record<keyof PromptExample, true> = {
    id: true, text: true, rating: true, source: true, note: true, createdAt: true,
  }
  const row = object(value, path, Object.keys(fields))
  const rating = optional(row.rating, item => number(item, `${path}.rating`))
  if (rating !== undefined && (rating < 1 || rating > 5)) fail(`${path}.rating`, '必须在 1 到 5 之间')
  return {
    id: text(row.id, `${path}.id`), text: text(row.text, `${path}.text`),
    source: choice(row.source, `${path}.source`, ['system', 'ai-generated', 'user-marked']),
    createdAt: timestamp(row.createdAt, `${path}.createdAt`),
    ...(rating === undefined ? {} : { rating }),
    ...(row.note === undefined ? {} : { note: text(row.note, `${path}.note`) }),
  }
}

function binding(value: unknown, path: string): PromptVariableBinding {
  const fields: Record<keyof PromptVariableBinding, true> = {
    variable: true, label: true, description: true, sourceKeys: true, workField: true,
    manual: true, required: true, placeholder: true,
  }
  const row = object(value, path, Object.keys(fields))
  return {
    variable: text(row.variable, `${path}.variable`), label: text(row.label, `${path}.label`),
    ...(row.description === undefined ? {} : { description: text(row.description, `${path}.description`) }),
    ...(row.sourceKeys === undefined ? {} : { sourceKeys: list(row.sourceKeys, `${path}.sourceKeys`, text) }),
    ...(row.workField === undefined ? {} : { workField: choice(row.workField, `${path}.workField`, ['title', 'genres', 'description', 'targetWordCount', 'lengthMode', 'serializationMode']) }),
    ...(row.manual === undefined ? {} : { manual: boolean(row.manual, `${path}.manual`) }),
    ...(row.required === undefined ? {} : { required: boolean(row.required, `${path}.required`) }),
    ...(row.placeholder === undefined ? {} : { placeholder: text(row.placeholder, `${path}.placeholder`) }),
  }
}

function applicability(value: unknown, path: string): PromptApplicability {
  const fields: Record<keyof PromptApplicability, true> = { lengthModes: true, serializationModes: true, genres: true }
  const row = object(value, path, Object.keys(fields))
  return {
    ...(row.lengthModes === undefined ? {} : { lengthModes: list(row.lengthModes, `${path}.lengthModes`, (item, at) => choice(item, at, ['short', 'medium', 'long'])) }),
    ...(row.serializationModes === undefined ? {} : { serializationModes: list(row.serializationModes, `${path}.serializationModes`, (item, at) => choice(item, at, ['standalone', 'serial'])) }),
    ...(row.genres === undefined ? {} : { genres: list(row.genres, `${path}.genres`, text) }),
  }
}

/** Validate and detach editable fields; local row identity never enters this result. */
export function readPromptTemplateContent(value: unknown, path = '模板', legacy = true): PromptTemplateContent {
  const fields = Object.keys(TEMPLATE_FIELDS).filter(key => legacy || !LOCAL_FIELDS.has(key))
  const row = object(value, path, fields)
  if (row.id !== undefined) positiveId(row.id, `${path}.id`)
  if (row.parentId !== undefined) positiveId(row.parentId, `${path}.parentId`)
  if (row.scope !== undefined) choice(row.scope, `${path}.scope`, ['system', 'user'])
  if (row.isActive !== undefined) boolean(row.isActive, `${path}.isActive`)
  if (row.createdAt !== undefined) timestamp(row.createdAt, `${path}.createdAt`)
  if (row.updatedAt !== undefined) timestamp(row.updatedAt, `${path}.updatedAt`)
  const model = optional(row.modelOverride, item => object(item, `${path}.modelOverride`, ['temperature', 'maxTokens']))
  const temperature = optional(model?.temperature, item => number(item, `${path}.modelOverride.temperature`))
  const maxTokens = optional(model?.maxTokens, item => {
    const result = number(item, `${path}.modelOverride.maxTokens`)
    if (!Number.isSafeInteger(result) || result < 0) fail(`${path}.modelOverride.maxTokens`, '必须是非负整数，0 表示由模型决定')
    return result
  })
  if (temperature !== undefined && (temperature < 0 || temperature > 2)) fail(`${path}.modelOverride.temperature`, '必须在 0 到 2 之间')
  const examples = optional(row.examples, item => object(item, `${path}.examples`, ['good', 'bad']))
  return {
    moduleKey: choice(row.moduleKey, `${path}.moduleKey`, PROMPT_MODULE_KEYS),
    promptType: text(row.promptType === undefined && legacy ? 'generate' : row.promptType, `${path}.promptType`),
    name: text(row.name === undefined && legacy ? '导入的模板' : row.name, `${path}.name`),
    description: text(row.description === undefined && legacy ? '' : row.description, `${path}.description`),
    systemPrompt: text(row.systemPrompt, `${path}.systemPrompt`),
    userPromptTemplate: text(row.userPromptTemplate, `${path}.userPromptTemplate`),
    variables: list(row.variables === undefined && legacy ? [] : row.variables, `${path}.variables`, text),
    ...(model === undefined ? {} : { modelOverride: {
      ...(temperature === undefined ? {} : { temperature }), ...(maxTokens === undefined ? {} : { maxTokens }),
    } }),
    ...(row.isDefault === undefined ? {} : { isDefault: boolean(row.isDefault, `${path}.isDefault`) }),
    ...(row.genres === undefined ? {} : { genres: list(row.genres, `${path}.genres`, text) }),
    ...(row.parameters === undefined ? {} : { parameters: list(row.parameters, `${path}.parameters`, parameter) }),
    ...(examples === undefined ? {} : { examples: {
      ...(examples.good === undefined ? {} : { good: list(examples.good, `${path}.examples.good`, example) }),
      ...(examples.bad === undefined ? {} : { bad: list(examples.bad, `${path}.examples.bad`, example) }),
    } }),
    ...(row.lengthMode === undefined ? {} : { lengthMode: choice(row.lengthMode, `${path}.lengthMode`, ['short', 'medium', 'long']) }),
    ...(row.continuityMode === undefined ? {} : { continuityMode: choice(row.continuityMode, `${path}.continuityMode`, ['inherit', 'required', 'off']) }),
    ...(row.assetId === undefined ? {} : { assetId: text(row.assetId, `${path}.assetId`) }),
    ...(row.variableBindings === undefined ? {} : { variableBindings: list(row.variableBindings, `${path}.variableBindings`, binding) }),
    ...(row.applicability === undefined ? {} : { applicability: applicability(row.applicability, `${path}.applicability`) }),
  }
}

export function encodePromptTemplateExchange(templates: readonly PromptTemplate[]): string {
  return JSON.stringify({
    format: PROMPT_TEMPLATE_EXCHANGE_FORMAT,
    version: PROMPT_TEMPLATE_EXCHANGE_VERSION,
    templates: templates.map((row, index) => readPromptTemplateContent(row, `templates[${index}]`)),
  }, null, 2)
}

export function decodePromptTemplateExchange(json: string): PromptTemplateContent[] {
  const value: unknown = JSON.parse(json)
  if (typeof value === 'object' && value !== null && !Array.isArray(value)
    && ('format' in value || 'version' in value || 'templates' in value)) {
    const envelope = object(value, '模板文件', ['format', 'version', 'templates'])
    if (envelope.format !== PROMPT_TEMPLATE_EXCHANGE_FORMAT) fail('模板文件.format', '不是提示词模板交换文件')
    if (envelope.version !== PROMPT_TEMPLATE_EXCHANGE_VERSION) fail('模板文件.version', '不支持的版本')
    return list(envelope.templates, 'templates', (row, path) => readPromptTemplateContent(row, path, false))
  }
  // The application's previous single-template and Export All files are explicit
  // input formats. Their local ids and activation metadata are never adopted.
  return list(Array.isArray(value) ? value : [value], 'templates', (row, path) => readPromptTemplateContent(row, path))
}
