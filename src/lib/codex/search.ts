/**
 * 词条搜索打分(纯函数,可单测)。
 * 规则:① 全字匹配(名称/简介/字段值整体包含 query)最高;
 *      ② 名称命中加权;③ 单字相关性(名称含 query 里几个不同字 → 命中字数加分)。
 * 分数为 0 = 不命中。
 */
export function scoreCodexEntry(
  name: string,
  summary: string,
  fieldsText: string,
  query: string,
): number {
  const q = query.trim()
  if (!q) return 0
  const n = (name || '').trim()
  const hay = `${n} ${summary || ''} ${fieldsText || ''}`
  const qChars = [...new Set([...q])]
  let score = 0
  if (hay.includes(q)) score += 1000          // 全字匹配
  if (n.includes(q)) score += 500             // 名称整体命中
  score += qChars.filter(ch => n.includes(ch)).length * 10  // 单字相关性
  return score
}
