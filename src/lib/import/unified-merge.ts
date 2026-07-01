/**
 * 分块解析结果的合并 / 规范化 / 报告生成工具。
 *
 * 全部是纯函数：无 I/O、无全局状态、无 side effect，易单测。
 * 从 pipeline.ts 抽出。
 */

import type { UnifiedParseResult } from '../types'
import type { ImportSession } from '../types'

const CHARACTER_LIKE_SYSTEM_WORDS = /精灵|器灵|人格|助手|伙伴|化身|宿主|管理员|管家/

function normalizeConceptName(name: string): string {
  return name.replace(/[\s　:：\-—_【】\[\]（）()]/g, '').trim()
}

function isNonCharacterConceptName(name: string): boolean {
  const n = normalizeConceptName(name)
  if (!n) return false
  if (CHARACTER_LIKE_SYSTEM_WORDS.test(n)) return false
  if (/金手指|外挂/.test(n)) return true
  if (/^(系统|系统面板|随身系统|主角系统|能力设定|天赋|天赋设定|特殊能力|宝物|法宝|道具)$/.test(n)) return true
  if (/设定$/.test(n) && /(系统|能力|天赋|宝物|道具|器物)/.test(n)) return true
  return false
}

function isProtagonistLike(raw: unknown): boolean {
  const role = String(raw || '').trim().toLowerCase()
  return role === 'protagonist' || role.includes('主角') || role.includes('主人公')
}

function compactField(label: string, value: unknown): string {
  const text = String(value || '').trim()
  return text ? `${label}: ${text}` : ''
}

function formatConceptCharacter(c: Record<string, unknown>): string {
  const name = String(c.name || '').trim() || '金手指'
  const parts = [
    compactField('简介', c.shortDescription),
    compactField('能力', c.abilities),
    compactField('背景', c.background),
    compactField('动机/限制', c.motivation),
    compactField('成长/代价', c.arc),
    compactField('关系', c.relationships),
  ].filter(Boolean)
  return `【${name}】${parts.length ? parts.join('；') : '文档中提到的非人物设定'}`
}

function appendText(existing: unknown, addition: string): string {
  const cur = String(existing || '').trim()
  return cur ? `${cur}\n\n${addition}` : addition
}

/**
 * 导入解析兜底:AI 常把「金手指 / 系统 / 外挂 / 天赋设定」误识别成角色。
 * 这些不是人物记录;除非写成系统精灵/器灵/助手等拟人角色,否则应归入主角能力
 * 或世界观的道具/能力体系概述,避免角色表出现一条名叫「金手指」的伪角色。
 */
export function normalizeNonCharacterConcepts(input: UnifiedParseResult): UnifiedParseResult {
  if (!Array.isArray(input.characters) || input.characters.length === 0) return input

  const kept: Array<Record<string, unknown>> = []
  const conceptTexts: string[] = []

  for (const raw of input.characters) {
    const c = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
    if (!c) continue
    const name = String(c.name || '').trim()
    if (isNonCharacterConceptName(name)) {
      conceptTexts.push(formatConceptCharacter(c))
    } else {
      kept.push(c)
    }
  }

  if (conceptTexts.length === 0) return input

  const conceptText = conceptTexts.join('\n')
  const protagonists = kept.filter(c => isProtagonistLike(c.role))
  if (protagonists.length === 1) {
    protagonists[0].abilities = appendText(protagonists[0].abilities, conceptText)
    return { ...input, characters: kept }
  }

  return {
    ...input,
    worldview: {
      ...(input.worldview || {}),
      itemDesign: appendText(input.worldview?.itemDesign, conceptText),
    },
    characters: kept,
  }
}

/**
 * 把一块新解析出的 UnifiedParseResult 合并进累计结果。
 * - worldview: 每个字段以 "\n\n" 连接追加
 * - characters / outline: 直接 push（跨块重名由 runCharacterMerge 另行处理）
 */
/** 世界观字段追加：段落级去重，已存在的段落不再重复拼接。 */
function appendDedupParagraph(cur: string, add: string): string {
  if (!add) return cur
  if (!cur) return add
  const existing = cur.split('\n\n').map(s => s.trim())
  if (existing.includes(add)) return cur
  return `${cur}\n\n${add}`
}

/** 大纲节点去重键：标题 + 摘要精确匹配。 */
function olKey(n: Record<string, unknown>): string {
  return `${String(n.title ?? '').trim()}¦${String(n.summary ?? '').trim()}`
}

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
  // 世界观：段落级去重——每块常重述同一段设定，旧代码无脑 \n\n 拼接会拼成 N 份
  // （社区反馈：导入后世界观同一句重复十几遍）。同一段落只保留一次。
  if (fresh.worldview) {
    for (const [k, v] of Object.entries(fresh.worldview)) {
      if (typeof v === 'string' && v.trim()) {
        out.worldview![k] = appendDedupParagraph(out.worldview![k] || '', v.trim())
      }
    }
  }
  // 角色：按名字去重——每块都会重复吐出同一角色，旧代码无脑 push 堆到几百个。
  // 同名只保留信息最全的一条（不同称呼的语义合并仍由「AI 整理角色卡」处理）。
  if (Array.isArray(fresh.characters)) {
    const idxByName = new Map<string, number>()
    out.characters!.forEach((c, i) => {
      const n = String((c as Record<string, unknown>).name ?? '').trim()
      if (n) idxByName.set(n, i)
    })
    for (const c of fresh.characters) {
      const name = c && typeof c.name === 'string' ? c.name.trim() : ''
      if (!name) continue
      const existingIdx = idxByName.get(name)
      if (existingIdx == null) {
        idxByName.set(name, out.characters!.length)
        out.characters!.push(c)
      } else if (JSON.stringify(c).length > JSON.stringify(out.characters![existingIdx]).length) {
        // 后出现的信息更全 → 用它替换（保留信息最多的一份）
        out.characters![existingIdx] = c
      }
    }
  }
  // 大纲：按「标题+摘要」精确去重（分块重叠会重复吐同一节点；不同章节标题/摘要不同，不会误删）。
  if (Array.isArray(fresh.outline)) {
    const seen = new Set(out.outline!.map(olKey))
    for (const n of fresh.outline) {
      const key = olKey(n as Record<string, unknown>)
      if (seen.has(key)) continue
      seen.add(key)
      out.outline!.push(n)
    }
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
  return normalizeNonCharacterConcepts({
    worldview: r.worldview && typeof r.worldview === 'object' ? r.worldview : {},
    characters: Array.isArray(r.characters) ? r.characters : [],
    outline: Array.isArray(r.outline) ? r.outline : [],
    writingTechniques: r.writingTechniques && typeof r.writingTechniques === 'object'
      ? r.writingTechniques : {},
  })
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
