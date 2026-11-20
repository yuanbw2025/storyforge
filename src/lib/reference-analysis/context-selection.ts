import { REFERENCE_APPLICATION_SKILL } from './content-skill'

/** Preserve all selected reference analysis units. Request-level reading is accounted for separately. */
export function selectReferenceMethods(units: string[]): string {
  if (!units.length) return ''
  return `【引用手法：完整已选分析材料，不代表全书事实已核实】\n${REFERENCE_APPLICATION_SKILL}\n${units.join('\n\n')}\n【覆盖：使用 ${units.length}/${units.length} 条完整分析；没有按应用固定条数或长度省略。实际生成任务的选读范围另见 Context Manifest。】`
}

/** Interleave first, last, middle to avoid always preferring the opening. */
export function spreadReferenceItems<T>(items: T[]): T[] {
  if (items.length < 3) return [...items]
  const indices = [0, items.length - 1, Math.floor(items.length / 2)]
  return [...new Set([...indices, ...items.map((_, index) => index)])].map(index => items[index])
}
