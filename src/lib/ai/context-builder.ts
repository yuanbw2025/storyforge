import type { Worldview, StoryCore, PowerSystem, Character } from '../types'

/** 构建世界观上下文摘要 */
export function buildWorldContext(wv: Worldview | null, sc: StoryCore | null, ps: PowerSystem | null): string {
  if (!wv && !sc && !ps) return ''
  const parts: string[] = []

  if (wv?.summary) {
    parts.push(`【世界观摘要】\n${wv.summary}`)
  } else if (wv) {
    const dims = [
      wv.geography && `地理：${wv.geography.slice(0, 200)}`,
      wv.society && `社会：${wv.society.slice(0, 200)}`,
      wv.rules && `规则：${wv.rules.slice(0, 200)}`,
    ].filter(Boolean)
    if (dims.length) parts.push(`【世界观】\n${dims.join('\n')}`)
  }

  if (sc) {
    const scParts = [
      sc.theme && `主题：${sc.theme}`,
      sc.centralConflict && `核心冲突：${sc.centralConflict}`,
      sc.plotPattern && `情节模式：${sc.plotPattern}`,
    ].filter(Boolean)
    if (scParts.length) parts.push(`【故事核心】\n${scParts.join('\n')}`)
  }

  if (ps?.name) {
    parts.push(`【力量体系】${ps.name}：${ps.description?.slice(0, 200) || ''}`)
  }

  return parts.join('\n\n')
}

/** 构建角色上下文 */
export function buildCharacterContext(characters: Character[]): string {
  if (!characters.length) return ''
  return characters.map(c =>
    `${c.name}（${getRoleLabel(c.role)}）：${c.shortDescription || ''}${c.personality ? `，性格：${c.personality.slice(0, 100)}` : ''}`
  ).join('\n')
}

function getRoleLabel(role: string): string {
  const map: Record<string, string> = {
    protagonist: '主角', antagonist: '反派',
    supporting: '配角', minor: '次要',
  }
  return map[role] || role
}

/** 构建世界观各维度已有内容（用于 AI 生成时做参考） */
export function buildExistingWorldview(wv: Worldview | null): string {
  if (!wv) return ''
  const parts = [
    wv.geography && `地理环境：${wv.geography.slice(0, 300)}`,
    wv.history && `历史：${wv.history.slice(0, 300)}`,
    wv.society && `社会：${wv.society.slice(0, 300)}`,
    wv.culture && `文化：${wv.culture.slice(0, 300)}`,
    wv.economy && `经济：${wv.economy.slice(0, 300)}`,
    wv.rules && `规则：${wv.rules.slice(0, 300)}`,
  ].filter(Boolean)
  return parts.join('\n')
}
