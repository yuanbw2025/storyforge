/**
 * 分块解析结果的合并 / 规范化 / 报告生成工具。
 *
 * 全部是纯函数：无 I/O、无全局状态、无 side effect，易单测。
 * 从 pipeline.ts 抽出。
 */

import type { UnifiedParseResult } from '../types'
import type { ImportSession } from '../types'

/**
 * 把一块新解析出的 UnifiedParseResult 合并进累计结果。
 * - worldview: 每个字段以 "\n\n" 连接追加
 * - characters / outline: 直接 push（跨块重名由 runCharacterMerge 另行处理）
 */
export function mergeUnified(
  acc: UnifiedParseResult,
  fresh: UnifiedParseResult,
): UnifiedParseResult {
  const out: UnifiedParseResult = {
    worldview: { ...(acc.worldview || {}) },
    characters: [...(acc.characters || [])],
    outline: [...(acc.outline || [])],
    writingTechniques: { ...(acc.writingTechniques || {}) },
  }
  if (fresh.worldview) {
    for (const [k, v] of Object.entries(fresh.worldview)) {
      if (typeof v === 'string' && v.trim()) {
        const cur = out.worldview![k] || ''
        out.worldview![k] = cur ? `${cur}\n\n${v.trim()}` : v.trim()
      }
    }
  }
  if (Array.isArray(fresh.characters)) {
    for (const c of fresh.characters) {
      if (c && typeof c.name === 'string' && c.name.trim()) {
        out.characters!.push(c)
      }
    }
  }
  if (Array.isArray(fresh.outline)) {
    for (const n of fresh.outline) out.outline!.push(n)
  }
  // 写作技法：每个字段追加拼接
  if (fresh.writingTechniques && typeof fresh.writingTechniques === 'object') {
    for (const [k, v] of Object.entries(fresh.writingTechniques)) {
      if (typeof v === 'string' && v.trim()) {
        const cur = (out.writingTechniques as Record<string, string>)[k] || ''
        ;(out.writingTechniques as Record<string, string>)[k] = cur ? `${cur}\n\n${v.trim()}` : v.trim()
      }
    }
  }
  return out
}

/**
 * 构造给下一块的 ~1500 字滚动上下文，
 * 帮 AI 避免把同一个角色在不同块识别成不同名字。
 */
export function buildRollingContext(merged: UnifiedParseResult): string {
  const lines: string[] = []
  // 已识别角色
  if (Array.isArray(merged.characters) && merged.characters.length > 0) {
    lines.push(`【已识别角色（${merged.characters.length} 名）】`)
    const recent = merged.characters.slice(-40) // 只取最近 40 个，避免无限增长
    for (const c of recent) {
      const name = String(c.name || '')
      const role = String(c.role || '')
      const desc = String(c.shortDescription || '').slice(0, 30)
      lines.push(`- ${name}（${role}）${desc ? '：' + desc : ''}`)
    }
  }
  // 世界观关键词
  if (merged.worldview) {
    const wv = merged.worldview
    const keys = ['worldOrigin', 'powerHierarchy', 'factionLayout', 'races'] as const
    const keep: string[] = []
    for (const k of keys) {
      const v = wv[k]
      if (typeof v === 'string' && v.trim()) keep.push(`${k}=${v.trim().slice(0, 80)}`)
    }
    if (keep.length > 0) {
      lines.push('【已识别世界观要点】')
      lines.push(keep.join(' / '))
    }
  }
  let txt = lines.join('\n')
  if (txt.length > 1500) txt = txt.slice(0, 1500) + '...（截断）'
  return txt
}

/** 把 AI 原始 JSON 规整成 UnifiedParseResult 的标准形状，缺项用空对象/空数组兜底。 */
export function normalizeUnified(raw: unknown): UnifiedParseResult {
  const r = (raw as UnifiedParseResult) || {}
  return {
    worldview: r.worldview && typeof r.worldview === 'object' ? r.worldview : {},
    characters: Array.isArray(r.characters) ? r.characters : [],
    outline: Array.isArray(r.outline) ? r.outline : [],
    writingTechniques: r.writingTechniques && typeof r.writingTechniques === 'object'
      ? r.writingTechniques : {},
  }
}

/** 生成给用户看的任务总结（ReportModal 里顶部那段文本）。 */
export function buildFinalReport(session: ImportSession): string {
  const done = session.chunks.filter(c => c.status === 'done').length
  const failed = session.chunks.filter(c => c.status === 'failed').length
  const totalWv = session.chunks
    .map(c => c.extractedCounts?.worldviewFields || 0)
    .reduce((a, b) => a + b, 0)
  const totalChars = session.chunks
    .map(c => c.extractedCounts?.characters || 0)
    .reduce((a, b) => a + b, 0)
  const totalOl = session.chunks
    .map(c => c.extractedCounts?.outlineNodes || 0)
    .reduce((a, b) => a + b, 0)
  const lines = [
    `📊 任务汇报：${session.filename}`,
    `· 文件总字数：${session.totalChars.toLocaleString()} 字`,
    `· 分块：${session.totalChunks} 块（每块约 ${session.chunkSize.toLocaleString()} 字）`,
    `· 成功：${done} 块；失败：${failed} 块`,
    `· 累计入库：世界观字段 ${totalWv}、角色 ${totalChars}（合并前）、大纲节点 ${totalOl}、写作技法已分析`,
  ]
  if (failed > 0) {
    lines.push('')
    lines.push('❗ 失败块（可单独重试）：')
    for (const c of session.chunks) {
      if (c.status === 'failed') {
        lines.push(`  - 第 ${c.index + 1} 块（${c.label || '未命名'}）：${c.errorMessage || '原因未知'}`)
      }
    }
  }
  return lines.join('\n')
}
