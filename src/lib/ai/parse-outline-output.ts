/**
 * 解析 AI 生成的大纲文本，提取结构化卷/章节数据
 *
 * Phase 30.4: JSON 优先解析
 * 解析增强（2026-06）：全局原则——文本内容提取用 AI 不用正则。
 *   smart 版（parseChapterOutlineSmart）：JSON 优先 → 失败则 AI 重构（不靠正则）。
 *   旧的正则版保留为 AI 不可用（无 API Key/离线）时的最后兜底。
 */

import type { AIConfig } from '../types'
import { aiRestructure } from './restructure'

export interface ParsedVolume {
  title: string
  summary: string
}

export interface ParsedChapter {
  title: string
  summary: string
}

// ── JSON 提取 ──

/** 从 AI 输出中提取 JSON 数组（支持 ```json 包裹 或裸 JSON） */
function extractJsonArray(text: string): unknown[] | null {
  // 1. 尝试从 ```json ... ``` 代码块提取
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/)
  if (codeBlockMatch) {
    try {
      const parsed = JSON.parse(codeBlockMatch[1].trim())
      if (Array.isArray(parsed)) return parsed
    } catch { /* fall through */ }
  }

  // 2. 尝试直接解析整个文本（去掉前后空白和可能的 ``` 标记）
  const cleaned = text.replace(/^```\w*\s*/, '').replace(/\s*```\s*$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed)) return parsed
  } catch { /* fall through */ }

  // 3. 尝试找到第一个 [ ... ] 区间
  const firstBracket = text.indexOf('[')
  const lastBracket = text.lastIndexOf(']')
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      const parsed = JSON.parse(text.slice(firstBracket, lastBracket + 1))
      if (Array.isArray(parsed)) return parsed
    } catch { /* fall through */ }
  }

  return null
}

// ── 工具函数 ──

/** 去除 markdown 格式：**bold**、##标题、*italic*、【】等 */
function stripMarkdown(s: string): string {
  return s
    .replace(/^\s*#+\s*/, '')       // ## 标题
    .replace(/\*\*(.+?)\*\*/g, '$1') // **bold**
    .replace(/\*(.+?)\*/g, '$1')     // *italic*
    .replace(/【(.+?)】/g, '$1')     // 【中括号】
    .replace(/^---+\s*$/, '')        // --- 分割线
    .trim()
}

/** 判断一行是否是 AI 开场白/结尾套话 */
function isPreambleOrClosing(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0) return true
  if (trimmed === '---') return true

  // 开场白模式
  const preamblePatterns = [
    /^好的[，,。！!]/,
    /^以下是/,
    /^根据你/,
    /^根据您/,
    /^基于你/,
    /^基于您/,
    /^下面是/,
    /^这是一份/,
    /^我[将会来]为你/,
    /^我为你/,
    /^我将根据/,
    /^我来为你/,
  ]
  // 结尾套话
  const closingPatterns = [
    /^以上是/,
    /^以上就是/,
    /^希望这/,
    /^希望以上/,
    /^如果你需要/,
    /^如需调整/,
    /^如需修改/,
    /^需要我进一步/,
    /^是否需要/,
  ]

  for (const p of [...preamblePatterns, ...closingPatterns]) {
    if (p.test(trimmed)) return true
  }
  return false
}

/** 判断一行是否是非大纲的段落标题（世界观、故事核心等） */
function isNonOutlineHeading(line: string): boolean {
  const stripped = stripMarkdown(line)
  const nonOutlinePatterns = [
    /^小说名称/,
    /^小说类型/,
    /^目标字数/,
    /^建议卷数/,
    /^世界观设定/,
    /^世界观[：:]/,
    /^故事核心/,
    /^故事背景/,
    /^核心冲突/,
    /^主题[：:]/,
    /^卷级大纲[：:]/,
    /^章节大纲[：:]/,
    /^人物设定/,
    /^角色设定/,
    /^写作说明/,
    /^注[：:]/,
    /^备注/,
  ]
  for (const p of nonOutlinePatterns) {
    if (p.test(stripped)) return true
  }
  return false
}

/** 中文数字→阿拉伯数字 */
function chineseToNum(cn: string): string {
  const map: Record<string, string> = {
    '零': '0', '一': '1', '二': '2', '三': '3', '四': '4',
    '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10',
  }
  // 简单映射：一 → 1, 十二 → 12
  if (/^\d+$/.test(cn)) return cn
  if (map[cn]) return map[cn]
  // 十X 或 X十Y
  if (cn.startsWith('十')) {
    return `1${map[cn[1]] || '0'}`
  }
  if (cn.includes('十')) {
    const [a, b] = cn.split('十')
    return `${map[a] || ''}${map[b] || '0'}`
  }
  return cn
}

// ── 卷级大纲解析 ──

/** 匹配卷标题行，返回 { volNum, restTitle } 或 null */
function matchVolumeTitle(line: string): { volNum: string; restTitle: string } | null {
  const stripped = stripMarkdown(line)

  // 格式1: 第X卷：标题 / 第X卷 标题
  const m1 = stripped.match(
    /(?:\d+[.)、]\s*)?第([零一二三四五六七八九十百\d]+)卷[：:：\s—-]*(.*)/
  )
  if (m1) {
    return { volNum: chineseToNum(m1[1]), restTitle: stripMarkdown(m1[2]) }
  }

  // 格式2: 卷X：标题
  const m2 = stripped.match(
    /(?:\d+[.)、]\s*)?卷([零一二三四五六七八九十百\d]+)[：:：\s—-]*(.*)/
  )
  if (m2) {
    return { volNum: chineseToNum(m2[1]), restTitle: stripMarkdown(m2[2]) }
  }

  return null
}

/**
 * 解析卷级大纲文本
 *
 * Phase 30.4: JSON 优先 → 正则降级
 */
export function parseVolumeOutlineOutput(text: string): ParsedVolume[] {
  // Phase 30.4: 优先 JSON 解析
  const jsonArr = extractJsonArray(text)
  if (jsonArr && jsonArr.length > 0) {
    const result: ParsedVolume[] = []
    for (const item of jsonArr) {
      if (item && typeof item === 'object' && 'title' in item) {
        const obj = item as { title?: string; summary?: string }
        if (obj.title) {
          result.push({
            title: String(obj.title).trim(),
            summary: String(obj.summary || '').trim(),
          })
        }
      }
    }
    if (result.length > 0) return result
  }

  // 降级：正则解析
  const volumes: ParsedVolume[] = []
  const lines = text.split('\n')

  let currentVol: { title: string; summaryLines: string[] } | null = null

  const flushVol = () => {
    if (currentVol) {
      const summary = currentVol.summaryLines
        .map(l => stripMarkdown(l)
          .replace(/^[-*•]\s*/, '')
          .replace(/^(?:情节摘要|情节概要|摘要|内容简介|故事摘要|概述|简介)[：:：]\s*/i, '')
          .trim()
        )
        .filter(l => l.length > 0 && !isPreambleOrClosing(l) && !isNonOutlineHeading(l))
        .join('')
      volumes.push({ title: currentVol.title, summary })
      currentVol = null
    }
  }

  for (const line of lines) {
    // 跳过 AI 套话
    if (isPreambleOrClosing(line)) {
      // 但如果已经在收集某个卷的摘要，空行可以忽略但不 flush
      continue
    }

    // 跳过非大纲标题（"世界观设定"等）
    if (isNonOutlineHeading(line)) {
      // 遇到非大纲标题，结束当前卷摘要收集
      flushVol()
      continue
    }

    // 尝试匹配卷标题
    const vol = matchVolumeTitle(line)
    if (vol) {
      flushVol()
      const title = vol.restTitle
        ? `第${vol.volNum}卷：${vol.restTitle}`
        : `第${vol.volNum}卷`
      currentVol = { title, summaryLines: [] }
      continue
    }

    // 如果在某个卷内，收集摘要行
    if (currentVol) {
      const stripped = line.trim()
      // 遇到"第X章"开头说明进入了章节区域，停止收集卷摘要
      if (/第[零一二三四五六七八九十百\d]+章/.test(stripped)) {
        flushVol()
        continue
      }
      if (stripped.length > 0) {
        currentVol.summaryLines.push(stripped)
      }
    }
  }

  flushVol()
  return volumes
}

// ── 章节大纲解析 ──

/** 匹配章节标题行 */
function matchChapterTitle(line: string): { chNum: string; restTitle: string } | null {
  const stripped = stripMarkdown(line)

  // 格式1: 第X章：标题
  const m1 = stripped.match(
    /(?:\d+[.)、]\s*)?第([零一二三四五六七八九十百\d]+)章[：:：\s—-]*(.*)/
  )
  if (m1) {
    return { chNum: chineseToNum(m1[1]), restTitle: stripMarkdown(m1[2]) }
  }

  // 格式2: 章X：标题 / 章：标题
  const m2 = stripped.match(
    /^章([零一二三四五六七八九十百\d]*)[：:：\s—-]+(.*)/
  )
  if (m2) {
    return { chNum: m2[1] ? chineseToNum(m2[1]) : '', restTitle: stripMarkdown(m2[2]) }
  }

  return null
}

/**
 * 解析章节大纲文本
 *
 * Phase 30.4: JSON 优先 → 正则降级
 * 正则支持格式：第X章、## 第X章、**第X章**、数字序号
 */
export function parseChapterOutlineOutput(text: string): ParsedChapter[] {
  // Phase 30.4: 优先 JSON 解析
  const jsonArr = extractJsonArray(text)
  if (jsonArr && jsonArr.length > 0) {
    const result: ParsedChapter[] = []
    for (const item of jsonArr) {
      if (item && typeof item === 'object' && 'title' in item) {
        const obj = item as { title?: string; summary?: string }
        if (obj.title) {
          result.push({
            title: String(obj.title).trim(),
            summary: String(obj.summary || '').trim(),
          })
        }
      }
    }
    if (result.length > 0) return result
  }

  // 降级：正则解析
  const chapters: ParsedChapter[] = []
  const lines = text.split('\n')

  let currentCh: { title: string; summaryLines: string[] } | null = null
  let autoChapterNum = 0

  const flushCh = () => {
    if (currentCh) {
      const summary = currentCh.summaryLines
        .map(l => stripMarkdown(l)
          .replace(/^[-*•]\s*/, '')
          .replace(/^(?:情节摘要|情节概要|摘要|内容简介|一句话概要)[：:：]\s*/i, '')
          .trim()
        )
        .filter(l => {
          if (l.length === 0) return false
          if (isPreambleOrClosing(l)) return false
          // 过滤掉"涉及角色"之类的附属信息
          if (/^(?:涉及的?主要角色|主要角色|关键角色|出场角色|涉及角色)[：:：]/.test(l)) return false
          // 过滤掉"主要人物：XXX"
          if (/^主要人物[：:：]/.test(l)) return false
          return true
        })
        .join('')
      chapters.push({ title: currentCh.title, summary })
      currentCh = null
    }
  }

  for (const line of lines) {
    if (isPreambleOrClosing(line)) continue
    if (isNonOutlineHeading(line)) continue

    // 尝试匹配"第X章"格式
    const ch = matchChapterTitle(line)
    if (ch) {
      flushCh()
      autoChapterNum++
      const num = ch.chNum || String(autoChapterNum)
      const title = ch.restTitle
        ? `第${num}章：${ch.restTitle}`
        : `第${num}章`
      currentCh = { title, summaryLines: [] }
      continue
    }

    // 尝试匹配纯数字序号: "1. 标题" / "1、标题" / "1) 标题"
    const numMatch = line.trim().match(/^(\d+)[.)、]\s+(.+)/)
    if (numMatch && !currentCh) {
      flushCh()
      autoChapterNum++
      const restTitle = stripMarkdown(numMatch[2])
      currentCh = { title: `第${numMatch[1]}章：${restTitle}`, summaryLines: [] }
      continue
    }

    // 收集摘要行
    if (currentCh) {
      const stripped = line.trim()
      if (stripped.length > 0) {
        currentCh.summaryLines.push(stripped)
      }
    }
  }

  flushCh()
  return chapters
}

// ── Smart 版：JSON 优先 → AI 重构（不靠正则） ─────────────────────────────

/** 把 JSON 数组转为 {title, summary}[] */
function jsonToTitleSummary(arr: unknown[] | null): { title: string; summary: string }[] {
  if (!arr) return []
  const out: { title: string; summary: string }[] = []
  for (const item of arr) {
    if (item && typeof item === 'object' && 'title' in item) {
      const obj = item as { title?: string; summary?: string }
      if (obj.title) out.push({ title: String(obj.title).trim(), summary: String(obj.summary || '').trim() })
    }
  }
  return out
}

const TITLE_SUMMARY_SCHEMA = `目标结构：JSON 数组，每个元素 { "title": "标题", "summary": "情节摘要" }。
原文里每一个卷/章（无论用"第X章"、数字序号、**加粗标题**、有无冒号等任何格式书写）都要提取为一个元素。`

/**
 * 智能解析章节大纲：JSON 优先 → AI 重构 → 正则兜底（仅 AI 不可用时）。
 * 解决任意格式（含「**标题**摘要」无冒号）的提取，不依赖正则准确率。
 */
export async function parseChapterOutlineSmart(text: string, config: AIConfig): Promise<ParsedChapter[]> {
  const json = jsonToTitleSummary(extractJsonArray(text))
  if (json.length > 0) return json
  const restructured = jsonToTitleSummary(await aiRestructure<unknown[]>(text, TITLE_SUMMARY_SCHEMA, config))
  if (restructured.length > 0) return restructured
  return parseChapterOutlineOutput(text) // 最后兜底（AI 不可用时）
}

/** 智能解析卷大纲：JSON 优先 → AI 重构 → 正则兜底。 */
export async function parseVolumeOutlineSmart(text: string, config: AIConfig): Promise<ParsedVolume[]> {
  const json = jsonToTitleSummary(extractJsonArray(text))
  if (json.length > 0) return json
  const restructured = jsonToTitleSummary(await aiRestructure<unknown[]>(text, TITLE_SUMMARY_SCHEMA, config))
  if (restructured.length > 0) return restructured
  return parseVolumeOutlineOutput(text)
}
