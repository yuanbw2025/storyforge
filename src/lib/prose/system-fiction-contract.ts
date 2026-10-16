import type { SystemFictionElementsV1 } from '../types/creative-rules'

export const SYSTEM_FICTION_ELEMENT_FIELDS = [
  { key: 'protagonistIntent', label: '主角处境与目标', placeholder: '主角想争取什么，为什么现在行动？已有角色资料继续保留。' },
  { key: 'systemMechanism', label: '系统机制', placeholder: '签到、任务、经营、抽取……能做什么，怎样触发？' },
  { key: 'rewardGrowth', label: '奖励与成长', placeholder: '想安排怎样的回报与成长？这些是计划，尚未成为库存或已发生事实。' },
  { key: 'limitsCosts', label: '限制与代价', placeholder: '能力范围、资源、时间、关系等条件；也可以明确无惩罚、免费奖励。' },
  { key: 'oppositionRelations', label: '对抗力量与人物关系', placeholder: '谁有不同诉求？也可以是日常协作，不必每章出现敌人。' },
] as const

export type SystemFictionElementField = typeof SYSTEM_FICTION_ELEMENT_FIELDS[number]['key']

export function createSystemFictionElementsV1(): SystemFictionElementsV1 {
  return { version: 1, enabled: false, protagonistIntent: '', systemMechanism: '', rewardGrowth: '', limitsCosts: '', oppositionRelations: '' }
}

/** 严格版本/键/类型验证；保留作者空白与原文，不猜测字段或自动升级未知版本。 */
export function parseSystemFictionElementsV1(value: unknown): SystemFictionElementsV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('系统文元素必须是当前版本的对象')
  const row = value as Record<string, unknown>
  const keys = new Set<string>(['version', 'enabled', ...SYSTEM_FICTION_ELEMENT_FIELDS.map(field => field.key)])
  if (Object.keys(row).some(key => !keys.has(key))) throw new Error('系统文元素包含未登记字段')
  if (row.version !== 1) throw new Error('系统文元素版本不受支持，原数据未被更改')
  if (typeof row.enabled !== 'boolean') throw new Error('系统文元素启用状态必须是布尔值')
  for (const { key, label } of SYSTEM_FICTION_ELEMENT_FIELDS) {
    if (typeof row[key] !== 'string') throw new Error(`${label}必须是文本，允许留空`)
    if ((row[key] as string).length > 8_000) throw new Error(`${label}超过 8000 字符，请拆分到具体章场资料`)
  }
  if (JSON.stringify(row).length > 40_000) throw new Error('系统文元素内容过长，请拆分到具体章场资料')
  return { version: 1, enabled: row.enabled, ...Object.fromEntries(SYSTEM_FICTION_ELEMENT_FIELDS.map(({ key }) => [key, row[key]])) } as SystemFictionElementsV1
}

export function formatSystemFictionElementsV1(value: unknown): string {
  if (value === undefined) return ''
  const elements = parseSystemFictionElementsV1(value)
  if (!elements.enabled) return ''
  const fields = SYSTEM_FICTION_ELEMENT_FIELDS.flatMap(({ key, label }) => elements[key].trim() ? [`${label}：${elements[key]}`] : [])
  return [
    '【系统文作者要求 v1】',
    '以下是作者确认的写作意图和机制约束；成长回报属于规划，不代表已兑现。已确认正文与事实有冲突时必须报告，不自动改写历史。',
    ...fields,
    '按作者设定选择签到、日常、成长或强主角写法，不自动添加惩罚、固定面板或同一种胜利过程。',
  ].join('\n')
}
