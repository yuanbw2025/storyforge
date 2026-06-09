/**
 * Phase 26.3 — 角色驱动剧情生成
 *
 * 根据角色的初始状态和目标状态/结局，AI 推演中间情节并输出卷/章大纲。
 */

import type { ChatMessage } from '../types'
import type { OutlineNode } from '../types/outline'
import { usePromptStore } from '../../stores/prompt'
import { renderPrompt } from './prompt-engine'
import { buildWorldContext } from './context-builder'
import { buildCodexContext } from './codex-context'
import { buildWorldRulesContext } from './world-rules-manifest'
import { useWorldviewStore } from '../../stores/worldview'
import { useOutlineStore } from '../../stores/outline'

// ── 类型 ────────────────────────────────────────────────────────────────

/** 单个角色的弧光设定（用户填写） */
export interface CharacterArcInput {
  characterId: number
  name: string
  role: string
  /** 初始状态描述 */
  initialState: string
  /** 目标状态/结局描述 */
  targetState: string
}

/** AI 输出的章节 */
export interface PlotChapter {
  title: string
  summary: string
  keyCharacters: string[]
  arcProgress: string
}

/** AI 输出的卷 */
export interface PlotVolume {
  volumeTitle: string
  volumeSummary: string
  characterArcs: string
  chapters: PlotChapter[]
}

// ── 构建 Prompt ─────────────────────────────────────────────────────────

/**
 * 将角色弧光设定格式化为文本
 */
function formatCharacterArcs(arcs: CharacterArcInput[]): string {
  return arcs.map((a, i) => {
    const lines = [
      `【角色${i + 1}】${a.name}（${a.role}）`,
      `  起始状态：${a.initialState}`,
      `  目标状态/结局：${a.targetState}`,
    ]
    return lines.join('\n')
  }).join('\n\n')
}

/**
 * 构建已有大纲摘要（避免与已有结构冲突）
 */
function buildExistingOutlineSummary(nodes: OutlineNode[]): string {
  const topLevel = nodes
    .filter(n => n.parentId === null)
    .sort((a, b) => a.order - b.order)

  if (topLevel.length === 0) return ''

  const lines: string[] = []
  for (const vol of topLevel) {
    const children = nodes
      .filter(n => n.parentId === vol.id)
      .sort((a, b) => a.order - b.order)
    lines.push(`卷：${vol.title}${vol.summary ? `（${vol.summary.slice(0, 60)}）` : ''}`)
    for (const ch of children.slice(0, 5)) {
      lines.push(`  - ${ch.title}${ch.summary ? `：${ch.summary.slice(0, 40)}` : ''}`)
    }
    if (children.length > 5) {
      lines.push(`  - ... 共 ${children.length} 章`)
    }
  }
  return lines.join('\n')
}

/**
 * 构建角色驱动剧情生成的 prompt messages
 */
export async function buildCharacterDrivenPlotPrompt(
  projectId: number,
  projectName: string,
  genre: string,
  arcs: CharacterArcInput[],
  userHint?: string,
): Promise<ChatMessage[]> {
  const { worldview, storyCore, powerSystem } = useWorldviewStore.getState()
  const codexCtx = await buildCodexContext(projectId, null)
  const worldContext = [buildWorldContext(worldview, storyCore, powerSystem), codexCtx].filter(Boolean).join('\n\n')
  const worldRulesContext = await buildWorldRulesContext(projectId)

  const storyCoreParts: string[] = []
  if (storyCore?.theme) storyCoreParts.push(`主题：${storyCore.theme}`)
  if (storyCore?.centralConflict) storyCoreParts.push(`核心冲突：${storyCore.centralConflict}`)
  if (storyCore?.plotPattern) storyCoreParts.push(`情节模式：${storyCore.plotPattern}`)

  // 已有大纲结构
  const outlineNodes = useOutlineStore.getState().nodes
  const existingOutline = buildExistingOutlineSummary(outlineNodes)

  const characterArcs = formatCharacterArcs(arcs)

  const tpl = usePromptStore.getState().getActive('plot.character-driven')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres: genre,
    worldContext: worldContext || '',
    storyCore: storyCoreParts.join('\n') || '',
    existingOutline,
    characterArcs,
    worldRulesContext: worldRulesContext || '',
    userHint: userHint || '',
  })

  return messages
}

// ── 解析输出 ─────────────────────────────────────────────────────────────

/**
 * 从 AI 输出文本中解析卷/章结构
 */
export function parsePlotOutput(output: string): PlotVolume[] {
  // 尝试从 markdown 代码块中提取 JSON
  const jsonMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : output.trim()

  try {
    const parsed = JSON.parse(jsonStr)
    if (!Array.isArray(parsed)) return []

    return parsed.map((vol: Record<string, unknown>) => ({
      volumeTitle: String(vol.volumeTitle || vol.title || ''),
      volumeSummary: String(vol.volumeSummary || vol.summary || ''),
      characterArcs: String(vol.characterArcs || ''),
      chapters: Array.isArray(vol.chapters)
        ? vol.chapters.map((ch: Record<string, unknown>) => ({
            title: String(ch.title || ''),
            summary: String(ch.summary || ''),
            keyCharacters: Array.isArray(ch.keyCharacters) ? ch.keyCharacters.map(String) : [],
            arcProgress: String(ch.arcProgress || ''),
          }))
        : [],
    })).filter(v => v.volumeTitle)
  } catch {
    // JSON 解析失败，尝试正则降级（简单的标题+摘要提取）
    return []
  }
}
