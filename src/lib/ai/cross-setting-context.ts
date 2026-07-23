/**
 * 跨设定协调上下文 · 统一装配入口
 *
 * 项目已有完善的上下文装配系统（CONTEXT_SOURCES 注册表 + assembleContext），
 * 但设定生成面板（世界观/角色/故事核心等）普遍手写局部 buildCtx()/worldCtx()，
 * 只取同面板内的几个字段，绕过了注册表 → 导致 AI 生成时"看不到其他设定"，
 * 产出设定彼此矛盾（驴唇不对马嘴）。
 *
 * 本文件是"全局设定大数据库"的唯一入口：每次生成设定时，调用
 * assembleCrossSettingContext() 即可装配全部 14 个上下文源，
 * 确保 AI 在生成任一设定时都能读到其他所有已填写的设定。
 *
 * 符合 CLAUDE.md 铁律：读走 CONTEXT_SOURCES + assembleContext。
 */

import { assembleContext } from '../registry/assemble-context'
import type { AIProvider } from '../types/ai'

/**
 * 设定生成时需要装配的全部上下文源。
 * 新增上下文源只需在此数组追加一行，所有面板自动覆盖。
 */
export const CROSS_SETTING_SOURCE_KEYS: string[] = [
  'worldview',
  'storyCore',
  'powerSystem',
  'codex',
  'characters',
  'creativeRules',
  'worldRules',
  'historical',
  'locations',
  'storyArcs',
  'storyTimeline',
  'characterRelations',
  'foreshadows',
]

export interface CrossSettingContextInput {
  projectId: number
  worldGroupId?: number | null
  provider?: AIProvider
  model?: string
}

/**
 * 装配"全局设定大数据库"上下文。
 *
 * 一次性读取全部已登记的设定源（14 个），让 AI 在生成任一设定时
 * 都能看到其他所有设定，避免产出互相矛盾的内容。
 *
 * 返回的 text 可直接拼接到 AI prompt 的 worldContext / existingContext 参数中。
 */
export async function assembleCrossSettingContext(
  input: CrossSettingContextInput,
): Promise<string> {
  const result = await assembleContext({
    projectId: input.projectId,
    worldGroupId: input.worldGroupId,
    provider: input.provider,
    model: input.model,
    sourceKeys: CROSS_SETTING_SOURCE_KEYS,
  })

  if (!result.text.trim()) return ''

  // 包裹一层明确的标注，帮助 AI 理解这是跨设定约束
  return [
    '【全局设定数据库 · 请确保生成内容与以下所有设定保持一致，勿产生矛盾】',
    result.text,
    '【全局设定数据库结束】',
  ].join('\n\n')
}
