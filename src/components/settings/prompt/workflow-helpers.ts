/**
 * 工作流面板 —— 公共常量 & 纯函数
 * ------------------------------------------------------------
 * 从 PromptWorkflowsPanel.tsx 抽出的无 React 依赖的部分：
 * - 模块键列表 / 保存目标预设
 * - SaveTarget ↔ select value 的互转
 * - saveTarget 的中文展示
 *
 * 对 UI 组件不做任何行为改变。
 */

import type { SaveTarget } from '../../../lib/types/workflow'

/** WorkflowEditor 下拉选项使用的模块键列表（与 prompt-seeds 的 system moduleKey 保持一致） */
export const ALL_MODULE_KEYS_FOR_WORKFLOW = [
  'worldview.dimension', 'character.generate', 'character.dimension',
  'outline.volume', 'outline.chapter',
  'chapter.content', 'chapter.continue', 'chapter.polish', 'chapter.expand', 'chapter.de-ai',
  'foreshadow.generate', 'story.generate', 'rules.generate', 'detail.scene',
  'geography.concept-map', 'geography.image-map-prompt',
] as const

/** WorkflowEditor "自动保存目标" 下拉预设 */
export const SAVE_TARGET_PRESETS = [
  { label: '不自动保存（仅复制）', value: '' },
  { label: '世界观.世界起源', value: 'worldview-field:worldOrigin' },
  { label: '世界观.力量层次', value: 'worldview-field:powerHierarchy' },
  { label: '世界观.世界历史线', value: 'worldview-field:historyLine' },
  { label: '世界观.世界观摘要', value: 'worldview-field:summary' },
  { label: '故事.一句话故事', value: 'storyCore-field:logline' },
  { label: '故事.故事概念', value: 'storyCore-field:concept' },
  { label: '故事.主题', value: 'storyCore-field:theme' },
  { label: '故事.核心冲突', value: 'storyCore-field:centralConflict' },
  { label: '故事.故事主线', value: 'storyCore-field:mainPlot' },
  { label: '创作规则.写作风格', value: 'creativeRules-field:writingStyle' },
  { label: '创作规则.基调氛围', value: 'creativeRules-field:toneAndMood' },
  { label: '⚡ 批量创建：角色库（要求 AI 输出 JSON 数组）', value: 'create-characters:_' },
  { label: '⚡ 批量创建：大纲节点（要求 AI 输出 JSON 数组）', value: 'create-outline-nodes:_' },
  { label: '⚡ 批量创建：伏笔（要求 AI 输出 JSON 数组）', value: 'create-foreshadows:_' },
] as const

/** SaveTarget 转 select value 字符串（`type:field` 或 `type:_`） */
export function saveTargetToValue(st?: SaveTarget): string {
  if (!st) return ''
  if (
    st.type === 'create-characters' ||
    st.type === 'create-outline-nodes' ||
    st.type === 'create-foreshadows'
  ) {
    return `${st.type}:_`
  }
  return `${st.type}:${(st as { field: string }).field}`
}

/** select value 字符串反解为 SaveTarget */
export function valueToSaveTarget(v: string): SaveTarget | undefined {
  if (!v) return undefined
  const [type, field] = v.split(':')
  if (
    type === 'create-characters' ||
    type === 'create-outline-nodes' ||
    type === 'create-foreshadows'
  ) {
    return { type } as SaveTarget
  }
  return {
    type: type as 'worldview-field' | 'storyCore-field' | 'creativeRules-field',
    field,
    mode: 'replace',
  }
}

/** 字段 key → 中文标签的映射，供 targetLabel 使用 */
const SAVE_TARGET_FIELD_LABELS: Record<string, string> = {
  worldOrigin: '世界起源', powerHierarchy: '力量层次',
  historyLine: '世界历史线', summary: '世界观摘要',
  logline: '一句话故事', concept: '故事概念', theme: '主题',
  centralConflict: '核心冲突', mainPlot: '故事主线',
  writingStyle: '写作风格', toneAndMood: '基调氛围',
}

/** 把 SaveTarget 格式化成运行时 UI 里展示的中文标签 */
export function targetLabel(target: SaveTarget): string {
  if (target.type === 'create-characters') return '角色库（批量创建）'
  if (target.type === 'create-outline-nodes') return '大纲（批量创建）'
  if (target.type === 'create-foreshadows') return '伏笔库（批量创建）'
  const field = (target as { field?: string }).field || ''
  const label = SAVE_TARGET_FIELD_LABELS[field] || field
  if (target.type === 'worldview-field') return `世界观.${label}`
  if (target.type === 'storyCore-field') return `故事.${label}`
  if (target.type === 'creativeRules-field') return `创作规则.${label}`
  return ''
}
