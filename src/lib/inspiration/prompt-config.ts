import {
  createPromptExecutionRequestV1,
  verifyPromptTemplateSelectionV1,
  type PromptTemplateSelectionV1,
} from '../agent/prompt-execution'

export const INSPIRATION_PROMPT_CONFIG_MODULES_V1 = ['inspiration.reverse', 'inspiration.reverse.multiworld'] as const
export type InspirationPromptConfigModuleV1 = typeof INSPIRATION_PROMPT_CONFIG_MODULES_V1[number]
export type InspirationPromptChoiceV1 = { kind: 'follow-default' } | (
  { kind: 'bound'; parameterValues?: Record<string, unknown> } & PromptTemplateSelectionV1
)
export interface InspirationPromptConfigV1 {
  version: 1
  revision: number
  updatedAt: number
  modes: Partial<Record<InspirationPromptConfigModuleV1, InspirationPromptChoiceV1>>
}

function fail(message: string): never { throw new Error(`灵感模板配置：${message}；原数据未修改`) }
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function fields(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail('包含未声明字段')
}

/** Synchronous backup shape validation. Absence is legacy-compatible, never a synthesized write. */
export function parseInspirationPromptConfigV1(raw: unknown): InspirationPromptConfigV1 | null {
  if (raw === undefined) return null
  if (typeof raw !== 'string') fail('必须是 JSON 字符串')
  let value: unknown
  try { value = JSON.parse(raw) } catch { fail('JSON 无法完整读取') }
  if (!record(value)) fail('必须是对象')
  fields(value, ['version', 'revision', 'updatedAt', 'modes'])
  if (value.version !== 1 || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1
    || !Number.isSafeInteger(value.updatedAt) || Number(value.updatedAt) < 0 || !record(value.modes)) {
    fail('版本、revision、时间或模式无效')
  }
  fields(value.modes, INSPIRATION_PROMPT_CONFIG_MODULES_V1)
  const modes: InspirationPromptConfigV1['modes'] = {}
  for (const moduleKey of INSPIRATION_PROMPT_CONFIG_MODULES_V1) {
    if (!Object.prototype.hasOwnProperty.call(value.modes, moduleKey)) continue
    const choice = value.modes[moduleKey]
    if (!record(choice)) fail('模式配置无效')
    if (choice.kind === 'follow-default') {
      fields(choice, ['kind'])
      modes[moduleKey] = { kind: 'follow-default' }
    } else if (choice.kind === 'bound') {
      fields(choice, ['kind', 'template', 'templateHash', 'parameterValues'])
      const request = createPromptExecutionRequestV1({
        moduleKey,
        selection: { template: choice.template, templateHash: choice.templateHash } as PromptTemplateSelectionV1,
        ...(choice.parameterValues === undefined ? {} : { parameterValues: choice.parameterValues as Record<string, unknown> }),
      })
      modes[moduleKey] = {
        kind: 'bound', ...request.selection!,
        ...(request.parameterValues === undefined ? {} : { parameterValues: request.parameterValues }),
      }
    } else fail('未知选择方式')
  }
  return { version: 1, revision: Number(value.revision), updatedAt: Number(value.updatedAt), modes }
}

/** Must finish before any import/config write transaction opens. Never resolves a global template id. */
export async function verifyInspirationPromptConfigV1(config: InspirationPromptConfigV1): Promise<void> {
  const parsed = parseInspirationPromptConfigV1(JSON.stringify(config))!
  for (const moduleKey of INSPIRATION_PROMPT_CONFIG_MODULES_V1) {
    const choice = parsed.modes[moduleKey]
    if (choice?.kind === 'bound') await verifyPromptTemplateSelectionV1({ template: choice.template, templateHash: choice.templateHash })
  }
}
