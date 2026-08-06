/**
 * Phase 26.3 — 角色驱动剧情生成
 *
 * 根据角色的初始状态和目标状态/结局，AI 推演中间情节并输出卷/章大纲。
 */

import type { ChatMessage } from '../types'
import {
  parseCharacterDrivenPlotVolumes,
  type CharacterDrivenPlanArc,
  type CharacterDrivenPlotChapter,
  type CharacterDrivenPlotVolume,
} from '../types/character-driven-plan'
import type { OutlineNode } from '../types/outline'
import { usePromptStore } from '../../stores/prompt'
import { renderPrompt } from './prompt-engine'
import { assembleContext } from '../registry/assemble-context'
import {
  appendSimplifiedChineseOutputConstraint,
  appendUserConstraint,
} from './adapters/prompt-guards'
import { isLegacyReadScope, readOwnedRows, resolveReadScopeLike } from '../world-engine/scope'

// ── 类型 ────────────────────────────────────────────────────────────────

/** 单个角色的弧光设定（用户填写） */
export type CharacterArcInput = CharacterDrivenPlanArc

/** AI 输出的章节 */
export type PlotChapter = CharacterDrivenPlotChapter

/** AI 输出的卷 */
export type PlotVolume = CharacterDrivenPlotVolume

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

async function resolveContextWorldGroupId(projectId: number): Promise<number | null | undefined> {
  const scope = await resolveReadScopeLike(projectId)
  const active = (await readOwnedRows<any>(scope, 'worldGroups', { owner: 'world' }))
    .find(group => group.type === 'primary')
  return active?.id ?? undefined
}

function extractStoryCoreBlock(contextText: string): string {
  const match = contextText.match(/【故事核心】[\s\S]*?(?=\n\n【|$)/)
  const storyCore = match?.[0].replace(/^【故事核心】\n?/, '').trim()
  return storyCore || contextText.trim()
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
  const readScope = await resolveReadScopeLike(projectId)
  const worldGroupId = await resolveContextWorldGroupId(projectId)
  const context = await assembleContext({
    projectId,
    scope: isLegacyReadScope(readScope) ? undefined : readScope,
    worldGroupId,
    sourceKeys: [
      'worldview',
      'storyCore',
      'powerSystem',
      'cultivationProgress',
      'codex',
      'characters',
      'worldRules',
      'existingVolumeOutlines',
    ],
  })
  const storyCoreBlock = extractStoryCoreBlock(context.text)

  // 已有大纲结构
  const outlineNodes = await readOwnedRows<OutlineNode>(readScope, 'outlineNodes', { owner: 'work' })
  const existingOutline = buildExistingOutlineSummary(outlineNodes)

  const characterArcs = formatCharacterArcs(arcs)

  const tpl = usePromptStore.getState().getActive('plot.character-driven')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres: genre,
    worldContext: context.text || '',
    storyCore: storyCoreBlock || '',
    existingOutline,
    characterArcs,
    userHint: userHint || '',
  })

  const aligned = appendUserConstraint(messages, [
    '【角色驱动与故事主线对齐硬约束】',
    '若上文存在「故事核心 / 主线 / 一句话故事 / 复线」，角色弧光推演必须服务这条主线，不得另起一套主线。',
    '每一卷的 volumeSummary 或 characterArcs 必须说明：本卷推动了故事主线的哪一阶段，以及哪些角色转变在其中起作用。',
    '每一章的 arcProgress 必须写清它推动了哪个角色弧光，并说明它如何推进本卷主线。',
    '如果角色目标与故事主线存在冲突，不要静默改写主线；请在对应 summary 或 characterArcs 中标注冲突点与调整建议。',
  ].join('\n'))

  return appendSimplifiedChineseOutputConstraint(aligned)
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
    return parseCharacterDrivenPlotVolumes(parsed)
  } catch {
    // JSON 解析失败，尝试正则降级（简单的标题+摘要提取）
    return []
  }
}
