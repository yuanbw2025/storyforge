/**
 * 上下文快照 — 生成一份紧凑、AI 可读的项目状态摘要
 *
 * 用途：
 * 1. 导出为 .md 文件，可粘贴到任何 AI 聊天中"续写"
 * 2. 导入后自动注入后续 AI 调用，避免重新烧 token
 */
import { db } from '../db/schema'
import { htmlToPlainText } from '../utils/html'
import { buildBestChapterByOutlineMap } from '../chapters/selectors'
import type { OutlineNode, Chapter } from '../types'

const SEPARATOR = '\n\n---\n\n'

/** 生成上下文快照文本 */
export async function generateContextSnapshot(projectId: number): Promise<string> {
  const [
    project,
    worldviews,
    storyCores,
    powerSystems,
    characters,
    outlineNodes,
    chapters,
    foreshadows,
  ] = await Promise.all([
    db.projects.get(projectId),
    db.worldviews.where('projectId').equals(projectId).toArray(),
    db.storyCores.where('projectId').equals(projectId).toArray(),
    db.powerSystems.where('projectId').equals(projectId).toArray(),
    db.characters.where('projectId').equals(projectId).toArray(),
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.chapters.where('projectId').equals(projectId).toArray(),
    db.foreshadows.where('projectId').equals(projectId).toArray(),
  ])

  if (!project) throw new Error('项目不存在')

  const sections: string[] = []

  // ── 头部 ──
  sections.push(`# 上下文快照：${project.name}\n生成时间：${new Date().toLocaleString('zh-CN')}\n类型：${project.genre || '未指定'}`)

  // ── 世界观（v3 字段；v2 仅作极老项目兜底）──
  const wv = worldviews[0]
  if (wv) {
    const parts: string[] = ['## 世界观']
    if (wv.summary) parts.push(wv.summary)
    const v3: [string, string | undefined][] = [
      ['世界来源', wv.worldOrigin], ['力量体系', wv.powerHierarchy],
      ['世界结构', wv.worldStructure], ['地貌分布', wv.continentLayout],
      ['气候环境', wv.climateByRegion], ['山川水系', wv.mountainsRivers],
      ['世界历史线', wv.historyLine], ['世界大事记', wv.worldEvents],
      ['种族民族', wv.races], ['势力分布', wv.factionLayout],
      ['政经文化', wv.politicsEconomyCulture], ['矛盾冲突', wv.internalConflicts],
    ]
    let hasV3 = false
    for (const [label, val] of v3) {
      if (val) { parts.push(`**${label}**：${compress(val, 250)}`); hasV3 = true }
    }
    if (!hasV3 && !wv.summary) {
      if (wv.geography) parts.push(`**地理**：${compress(wv.geography, 300)}`)
      if (wv.society) parts.push(`**社会**：${compress(wv.society, 300)}`)
      if (wv.culture) parts.push(`**文化**：${compress(wv.culture, 200)}`)
      if (wv.rules) parts.push(`**规则**：${compress(wv.rules, 200)}`)
    }
    sections.push(parts.join('\n'))
  }

  // ── 故事核心 ──
  const sc = storyCores[0]
  if (sc) {
    const parts: string[] = ['## 故事核心']
    if (sc.theme) parts.push(`**主题**：${sc.theme}`)
    if (sc.centralConflict) parts.push(`**核心冲突**：${sc.centralConflict}`)
    if (sc.plotPattern) parts.push(`**情节模式**：${sc.plotPattern}`)
    sections.push(parts.join('\n'))
  }

  // ── 力量体系 ──
  const ps = powerSystems[0]
  if (ps?.name) {
    sections.push(`## 力量体系\n**${ps.name}**：${compress(ps.description || '', 300)}`)
  }

  // ── 角色 ──
  if (characters.length) {
    const roleLabel: Record<string, string> = { protagonist: '主角', antagonist: '反派', supporting: '配角', minor: '次要' }
    const lines = characters.map(c => {
      const parts = [`- **${c.name}**（${roleLabel[c.role] || c.role}）`]
      if (c.shortDescription) parts.push(`：${c.shortDescription}`)
      if (c.personality) parts.push(`，性格：${compress(c.personality, 80)}`)
      if (c.motivation) parts.push(`，动机：${compress(c.motivation, 80)}`)
      return parts.join('')
    })
    sections.push(`## 角色\n${lines.join('\n')}`)
  }

  // (势力已并入「势力」词条,经词条上下文源进入生成上下文)

  // ── 大纲 + 章节摘要 ──
  if (outlineNodes.length) {
    const sorted = outlineNodes.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const chapterMap = buildBestChapterByOutlineMap(chapters)
    sections.push(buildOutlineSection(sorted, chapterMap))
  }

  // ── 伏笔 ──
  const activeForeshadows = foreshadows.filter(f => f.status === 'planned' || f.status === 'planted')
  if (activeForeshadows.length) {
    const lines = activeForeshadows.map(f =>
      `- 【${f.status === 'planted' ? '已埋' : '计划'}】${f.name}${f.description ? `：${compress(f.description, 100)}` : ''}`
    )
    sections.push(`## 活跃伏笔\n${lines.join('\n')}`)
  }

  return sections.join(SEPARATOR)
}

/** 构建大纲 + 章节摘要部分 */
function buildOutlineSection(nodes: OutlineNode[], chapterMap: Map<number, Chapter>): string {
  const lines: string[] = ['## 大纲与章节']

  // 按层级构建树
  const rootNodes = nodes.filter(n => !n.parentId)
  for (const node of rootNodes) {
    renderNode(node, nodes, chapterMap, lines, 0)
  }

  return lines.join('\n')
}

function renderNode(
  node: OutlineNode,
  allNodes: OutlineNode[],
  chapterMap: Map<number, Chapter>,
  lines: string[],
  depth: number,
) {
  const indent = '  '.repeat(depth)
  const prefix = node.type === 'volume' ? '📖' : node.type === 'arc' ? '📂' : '📝'
  let line = `${indent}${prefix} **${node.title}**`

  if (node.summary) {
    line += `：${compress(node.summary, 150)}`
  }

  // 如果是章节且有正文，附加末尾摘要
  if (node.type === 'chapter' && node.id) {
    const ch = chapterMap.get(node.id)
    if (ch?.content) {
      const plain = htmlToPlainText(ch.content)
      if (plain.length > 0) {
        const wordCount = plain.length
        const ending = plain.slice(-200).trim()
        line += ` [${wordCount}字]`
        line += `\n${indent}  └ 末尾：…${ending}`
      }
    }
  }

  lines.push(line)

  // 递归子节点
  const children = allNodes.filter(n => n.parentId === node.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  for (const child of children) {
    renderNode(child, allNodes, chapterMap, lines, depth + 1)
  }
}

/** 截断压缩，保留前 n 个字符 */
function compress(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > maxLen ? clean.slice(0, maxLen) + '…' : clean
}

/** 下载快照文件 */
export function downloadContextSnapshot(text: string, projectName: string) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${projectName}_上下文快照_${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// ── 上下文快照本地存储 ──

const MEMO_KEY_PREFIX = 'storyforge-context-memo-'

/** 保存上下文快照到 localStorage（用于自动注入 AI 调用） */
export function saveContextMemo(projectId: number, text: string) {
  localStorage.setItem(`${MEMO_KEY_PREFIX}${projectId}`, text)
}

/** 读取已保存的上下文快照 */
export function loadContextMemo(projectId: number): string | null {
  return localStorage.getItem(`${MEMO_KEY_PREFIX}${projectId}`)
}

/** 清除上下文快照 */
export function clearContextMemo(projectId: number) {
  localStorage.removeItem(`${MEMO_KEY_PREFIX}${projectId}`)
}
