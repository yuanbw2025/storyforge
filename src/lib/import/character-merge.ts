/**
 * 跨块角色合并（AI 辅助去重 / 别名归并）。
 *
 * 从 pipeline.ts 抽出。原函数直接读 pipeline 模块级变量
 * `activeController` / `activePauseFlag`，抽出后改成通过参数注入：
 *   - `signal`：AbortSignal，传给 chatWithAbort 支持中途取消
 *   - `isPaused`：闭包，让合并过程能随时查暂停状态（用户按 ⏸ 时尽快跳出）
 *
 * 副作用：
 *   - AI 调用（usePromptStore + useAIConfigStore + chatWithAbort）
 *   - DB 事务（db.characters 合并/删除）
 *   - 更新 useImportStatusStore / useImportSessionStore（UI 反馈 + 日志）
 *   - 触发 useCharacterStore.loadAll 让侧栏角色列表刷新
 */

import { db } from '../db/schema'
import { renderPrompt } from '../ai/prompt-engine'
import { usePromptStore } from '../../stores/prompt'
import { useAIConfigStore } from '../../stores/ai-config'
import { useCharacterStore } from '../../stores/character'
import { useImportSessionStore } from '../../stores/import-session'
import { useImportStatusStore } from '../../stores/import-status'
import { extractJSON } from '../ai/adapters/import-adapter'
import type { AIConfig, Character } from '../types'
import { chatWithAbort } from './chat-with-abort'

export interface RunCharacterMergeArgs {
  sessionId: number
  projectId: number
  isFinal: boolean
  signal?: AbortSignal
  /** 查询是否已暂停；返回 true 则立即跳出 */
  isPaused?: () => boolean
}

/** 跑跨块角色合并（用 AI 找别名 / 同人） */
export async function runCharacterMerge(args: RunCharacterMergeArgs): Promise<void> {
  const { sessionId, projectId, isFinal, signal, isPaused } = args
  if (isPaused?.()) return

  const statusStore = useImportStatusStore.getState()
  const sessionStore = useImportSessionStore.getState()

  statusStore.setPhase('merging')
  statusStore.pushActivity('info',
    isFinal ? '🔀 终末跨块角色合并...' : '🔀 阶段性跨块角色合并...')

  // 拉当前项目所有角色
  const allChars = await db.characters.where('projectId').equals(projectId).toArray()
  if (allChars.length < 2) {
    statusStore.setPhase('running')
    statusStore.pushActivity('info', '角色数 < 2，跳过合并')
    return
  }
  // 角色清单（截到最近 200 个，避免 prompt 爆炸）
  const recent = allChars.slice(-200)
  const lines = recent.map(c =>
    `${c.name}｜${c.role}｜${(c.shortDescription || '').slice(0, 40)}`,
  )
  const characterList = lines.join('\n')

  try {
    const tpl = usePromptStore.getState().getActive('import.merge-characters')
    const { messages } = renderPrompt(tpl, { characterList })
    const baseConfig = useAIConfigStore.getState().config
    const config: AIConfig = {
      ...baseConfig,
      maxTokens: Math.max(baseConfig.maxTokens ?? 4096, 4096),
    }
    if (!config.apiKey) throw new Error('未配置 AI API Key')

    const output = await chatWithAbort(messages, config, signal)
    const parsed = extractJSON(output) as { mergeGroups?: Array<{
      canonical: string
      aliases: string[]
      reason?: string
    }>}

    let mergedCount = 0
    if (parsed?.mergeGroups && Array.isArray(parsed.mergeGroups)) {
      for (const g of parsed.mergeGroups) {
        if (!g.canonical || !Array.isArray(g.aliases) || g.aliases.length < 2) continue
        const merged = await applyMergeGroup(projectId, g.canonical, g.aliases, recent)
        if (merged > 0) {
          mergedCount += merged
          await sessionStore.log(sessionId, -1, 'success',
            `合并：${g.aliases.join(' = ')} → ${g.canonical}${g.reason ? '（' + g.reason + '）' : ''}`)
          statusStore.pushActivity('success',
            `合并：${g.aliases.join(' = ')} → ${g.canonical}`)
        }
      }
    }
    if (mergedCount === 0) {
      statusStore.pushActivity('info', '本轮无角色需要合并')
    }
    // 通知 UI 刷新
    await useCharacterStore.getState().loadAll(projectId)
  } catch (err) {
    if ((err as Error).name === 'AbortError') return
    const msg = err instanceof Error ? err.message : String(err)
    statusStore.pushActivity('warn', `角色合并失败（不影响主流程）：${msg.slice(0, 80)}`)
    await sessionStore.log(sessionId, -1, 'warn', `角色合并失败：${msg}`)
  } finally {
    statusStore.setPhase('running')
  }
}

/** 把同一组角色合并：选 canonical 那条，把其他条目的信息合并进来后删除 */
async function applyMergeGroup(
  projectId: number,
  canonical: string,
  aliases: string[],
  pool: Character[],
): Promise<number> {
  const targets = pool.filter(c => aliases.includes(c.name) && c.projectId === projectId)
  if (targets.length < 2) return 0

  // 优先选名字 == canonical 的，否则选 aliases[0] 那个
  const primary = targets.find(t => t.name === canonical) || targets[0]
  if (!primary.id) return 0

  const others = targets.filter(t => t.id !== primary.id)
  const append = (cur: string, extra: string) => {
    const e = (extra || '').trim()
    if (!e) return cur
    if (cur && cur.includes(e)) return cur
    return cur ? `${cur}\n\n${e}` : e
  }

  const merged: Partial<Character> = {
    name: canonical,
    shortDescription: primary.shortDescription,
    appearance: primary.appearance,
    personality: primary.personality,
    background: primary.background,
    motivation: primary.motivation,
    abilities: primary.abilities,
    relationships: primary.relationships,
    arc: primary.arc,
  }
  // 收集别名（写到 relationships 里附记）
  const aliasNote = `（曾用名/别称：${aliases.filter(a => a !== canonical).join('、')}）`

  for (const o of others) {
    merged.shortDescription = append(merged.shortDescription || '', o.shortDescription)
    merged.appearance = append(merged.appearance || '', o.appearance)
    merged.personality = append(merged.personality || '', o.personality)
    merged.background = append(merged.background || '', o.background)
    merged.motivation = append(merged.motivation || '', o.motivation)
    merged.abilities = append(merged.abilities || '', o.abilities)
    merged.relationships = append(merged.relationships || '', o.relationships)
    merged.arc = append(merged.arc || '', o.arc)
  }
  merged.relationships = append(merged.relationships || '', aliasNote)

  await db.transaction('rw', db.characters, async () => {
    await db.characters.update(primary.id!, { ...merged, updatedAt: Date.now() })
    for (const o of others) {
      if (o.id) await db.characters.delete(o.id)
    }
  })
  return others.length
}
