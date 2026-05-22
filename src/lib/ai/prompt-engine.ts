import type { ChatMessage } from '../types'
import type { PromptTemplate, PromptVariableContext } from '../types'

/**
 * 渲染提示词模板。
 *
 * 支持语法：
 *   {{var}}              字符串替换；缺失时替换为空串并 console.warn
 *   {{#if var}}...{{/if}} 条件块；var 真值且非空字符串时保留块内容，否则去掉整块
 *
 * 不支持嵌套 {{#if}}（Phase 1 内置模板没有这个需求；后续按需扩展）。
 *
 * Phase 12 升级：模板的 parameters 字段会自动注入到 ctx：
 *   - 每个 parameter.key 直接作为 {{key}} 变量
 *   - 每个 parameter 同时生成 {{usesKey}} 标志：optional=true 且参数值有效时为 '1'，
 *     用 {{#if usesXxx}}...{{/if}} 包住可选段落
 *
 * Phase 12 升级：parameterValues 用户运行时覆盖参数值（不写回模板）。
 */
export function renderPrompt(
  template: PromptTemplate,
  ctx: PromptVariableContext,
  options?: {
    /** 运行时覆盖参数值（user 在创作区临时调整时用） */
    parameterValues?: Record<string, unknown>
    /** 运行时覆盖 system / user 模板（临时微调，不写回） */
    overrides?: { systemPrompt?: string; userPromptTemplate?: string }
  },
): { messages: ChatMessage[]; modelOverride?: { temperature?: number; maxTokens?: number } } {
  // 1. 把模板参数注入到 ctx（运行时值覆盖默认值）
  const enriched: PromptVariableContext = { ...ctx }
  if (template.parameters && template.parameters.length > 0) {
    for (const p of template.parameters) {
      const userVal = options?.parameterValues?.[p.key]
      const cap = p.key.charAt(0).toUpperCase() + p.key.slice(1)
      const usesKey = `uses${cap}`
      const notUsesKey = `notUses${cap}`

      // optional 且用户显式关闭：不注入参数变量、usesXxx 设为空、notUsesXxx 设为 '1'
      if (p.optional && options?.parameterValues && (userVal === undefined || userVal === null || userVal === '')) {
        enriched[p.key] = ''
        enriched[usesKey] = ''
        enriched[notUsesKey] = '1'
        continue
      }

      // 注入参数值（用户值优先，否则默认值）
      const v = userVal !== undefined ? userVal : p.default
      const truthy = !(v === '' || v === false || v === null || v === undefined)
      enriched[p.key] = v as string | number
      enriched[usesKey] = truthy ? '1' : ''
      enriched[notUsesKey] = truthy ? '' : '1'
    }
  }

  const sysSrc = options?.overrides?.systemPrompt ?? template.systemPrompt
  const userSrc = options?.overrides?.userPromptTemplate ?? template.userPromptTemplate

  let userContent = renderString(userSrc, enriched, template.moduleKey)
  const systemContent = renderString(sysSrc, enriched, template.moduleKey)

  // P15: 拼接示例（few-shot）到 user prompt 末尾
  // - good 示例：作者标记的"输出风格参考"
  // - bad 示例：作者标记的"避免的输出"
  const goodExamples = (template.examples?.good || []).filter(e => e.text.trim()).slice(0, 3)
  const badExamples = (template.examples?.bad || []).filter(e => e.text.trim()).slice(0, 2)
  if (goodExamples.length > 0 || badExamples.length > 0) {
    const parts: string[] = ['', '---', '【参考示例】']
    if (goodExamples.length > 0) {
      parts.push('请参考以下风格（这些是作者认可的输出）：')
      goodExamples.forEach((e, i) => {
        parts.push(`\n[好示例 ${i + 1}]`)
        parts.push(e.text.trim())
      })
    }
    if (badExamples.length > 0) {
      parts.push('\n请避免以下风格（这些是作者认为不好的输出）：')
      badExamples.forEach((e, i) => {
        parts.push(`\n[反例 ${i + 1}]`)
        parts.push(e.text.trim())
      })
    }
    userContent += '\n' + parts.join('\n')
  }

  const messages: ChatMessage[] = []
  if (systemContent.trim()) {
    messages.push({ role: 'system', content: systemContent })
  }
  messages.push({ role: 'user', content: userContent })

  return {
    messages,
    modelOverride: template.modelOverride,
  }
}

function renderString(tpl: string, ctx: PromptVariableContext, moduleKey: string): string {
  // 1. 先处理 {{#if var}}...{{/if}} 块
  let out = tpl.replace(
    /\{\{#if\s+([a-zA-Z0-9_]+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_, varName: string, block: string) => {
      const v = ctx[varName]
      const truthy =
        v !== undefined &&
        v !== null &&
        !(typeof v === 'string' && v.trim() === '')
      return truthy ? block : ''
    },
  )

  // 2. 处理 {{var}} 替换
  out = out.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, varName: string) => {
    const v = ctx[varName]
    if (v === undefined || v === null) {
      console.warn(`[prompt-engine] missing variable {{${varName}}} in module ${moduleKey}`)
      return ''
    }
    return String(v)
  })

  return out
}
