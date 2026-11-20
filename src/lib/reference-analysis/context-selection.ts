import { estimateTokens } from '../ai/context-budget'
import { REFERENCE_APPLICATION_SKILL } from './content-skill'

/** Budget whole evidence units, never prefixes that can lose a qualification. */
export function selectReferenceMethods(units: string[], budgetTokens = 2000): string {
  if (!units.length) return ''
  const prefix = `【引用手法：选读材料，不代表全书已核实】\n${REFERENCE_APPLICATION_SKILL}\n`
  const kept: string[] = []
  // Reserve space for an honest coverage notice before packing.
  for (const unit of units) {
    if (estimateTokens(`${prefix}${kept.join('\n\n')}\n\n${unit}`) <= budgetTokens - 100) kept.push(unit)
  }
  const omitted = units.length - kept.length
  return `${prefix}${kept.join('\n\n')}\n【覆盖：使用 ${kept.length}/${units.length} 条完整分析；${omitted ? `其余 ${omitted} 条未纳入本次预算，不得据此推断不存在。完整证据见作品分析版本。` : '没有截取句首或省略条目。'}】`
}

/** Interleave first, last, middle to avoid always preferring the opening. */
export function spreadReferenceItems<T>(items: T[]): T[] {
  if (items.length < 3) return [...items]
  const indices = [0, items.length - 1, Math.floor(items.length / 2)]
  return [...new Set([...indices, ...items.map((_, index) => index)])].map(index => items[index])
}
