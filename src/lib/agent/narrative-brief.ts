import type { AssembleContextResult } from '../registry/types'
import {
  parseCreativeAssumptionV1,
  type CreativeAssumptionV1,
} from './creative-reliability'

export const NARRATIVE_BRIEF_FIELD_KEYS = [
  'protagonistDesire',
  'obstacle',
  'stakes',
  'requiredChoice',
  'entryState',
  'exitChange',
  'nextPressure',
] as const

export type NarrativeBriefFieldKeyV1 = typeof NARRATIVE_BRIEF_FIELD_KEYS[number]

export interface NarrativeBriefV1 {
  version: 1
  creativeGoal: string
  protagonistDesire: string
  obstacle: string
  stakes: string
  requiredChoice: string
  entryState: string
  exitChange: string
  nextPressure: string
  mustHonor: string[]
  mustNotReveal: string[]
  creativeFreedom: string[]
  assumptions: CreativeAssumptionV1[]
}

const OPEN_PREFIX = '待本轮候选提出：'
const MAX_FIELD_CHARS = 2_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value)
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) {
    throw new Error(`叙事任务合同字段必须严格为 ${expected.join('、')}。`)
  }
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} 必须是非空字符串。`)
  const normalized = value.trim()
  if (normalized.length > MAX_FIELD_CHARS) throw new Error(`${label} 超过 ${MAX_FIELD_CHARS} 字符。`)
  return normalized
}

function readStringArray(value: unknown, label: string, max = 50): string[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} 必须是最多 ${max} 项的数组。`)
  const result = value.map((item, index) => readString(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) throw new Error(`${label} 不能有重复项。`)
  return result
}

export function parseNarrativeBriefV1(value: unknown): NarrativeBriefV1 {
  if (!isRecord(value)) throw new Error('叙事任务合同必须是对象。')
  assertExactKeys(value, [
    'version', 'creativeGoal', 'protagonistDesire', 'obstacle', 'stakes',
    'requiredChoice', 'entryState', 'exitChange', 'nextPressure', 'mustHonor',
    'mustNotReveal', 'creativeFreedom', 'assumptions',
  ])
  if (value.version !== 1) throw new Error('叙事任务合同版本不支持。')
  if (!Array.isArray(value.assumptions) || value.assumptions.length > 100) {
    throw new Error('叙事任务合同 assumptions 必须是最多 100 项的数组。')
  }
  const assumptions = value.assumptions.map(parseCreativeAssumptionV1)
  if (assumptions.some(assumption => assumption.status !== 'provisional')) {
    throw new Error('运行时叙事任务只能携带 provisional 假设。')
  }
  if (new Set(assumptions.map(assumption => assumption.id)).size !== assumptions.length) {
    throw new Error('叙事任务合同 assumptions 不能有重复身份。')
  }
  return {
    version: 1,
    creativeGoal: readString(value.creativeGoal, 'creativeGoal'),
    protagonistDesire: readString(value.protagonistDesire, 'protagonistDesire'),
    obstacle: readString(value.obstacle, 'obstacle'),
    stakes: readString(value.stakes, 'stakes'),
    requiredChoice: readString(value.requiredChoice, 'requiredChoice'),
    entryState: readString(value.entryState, 'entryState'),
    exitChange: readString(value.exitChange, 'exitChange'),
    nextPressure: readString(value.nextPressure, 'nextPressure'),
    mustHonor: readStringArray(value.mustHonor, 'mustHonor'),
    mustNotReveal: readStringArray(value.mustNotReveal, 'mustNotReveal'),
    creativeFreedom: readStringArray(value.creativeFreedom, 'creativeFreedom'),
    assumptions,
  }
}

function sourceText(assembled: AssembleContextResult, key: string): string {
  const index = assembled.included.indexOf(key)
  return index < 0 ? '' : assembled.segments[index]?.content ?? ''
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function labeledValue(text: string, labels: readonly string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`(?:^|[；\\n])${escapeRegExp(label)}：([^；\\n]+)`, 'm'))
    if (match?.[1]?.trim()) return match[1].trim().slice(0, MAX_FIELD_CHARS)
  }
  return ''
}

function firstContentLine(text: string): string {
  return text.split('\n')
    .map(line => line.trim())
    .find(line => line && !line.startsWith('【'))
    ?.slice(0, MAX_FIELD_CHARS) ?? ''
}

function open(label: string): string {
  return `${OPEN_PREFIX}${label}`
}

function isOpen(value: string): boolean {
  return value.startsWith(OPEN_PREFIX)
}

/**
 * Builds a per-run narrative task only from text already delivered by
 * CONTEXT_SOURCES. It never performs a side read and never promotes an open
 * field to Canon; missing semantics remain explicit creative freedom.
 */
export function buildNarrativeBriefV1(input: {
  authorRequest: string
  assembled: AssembleContextResult
  inheritedAssumptions?: readonly CreativeAssumptionV1[]
}): NarrativeBriefV1 {
  const storyCore = sourceText(input.assembled, 'storyCore')
  const characters = sourceText(input.assembled, 'characters')
  const chapterOutline = sourceText(input.assembled, 'chapterOutline')
  const detailedOutline = sourceText(input.assembled, 'detailedOutline')
  const storyArcs = sourceText(input.assembled, 'storyArcs')
  const worldview = sourceText(input.assembled, 'worldview')

  const desire = labeledValue(characters, ['目标(短/长期)', '动机/欲望'])
  const centralConflict = labeledValue(storyCore, ['核心冲突'])
    || labeledValue(worldview, ['矛盾冲突'])
  const stakes = labeledValue(storyCore, ['代价', '风险'])
  const choice = /决定|选择|是否|抉择/.test(centralConflict) ? centralConflict : ''
  const entry = firstContentLine(chapterOutline)
    || firstContentLine(detailedOutline)
    || firstContentLine(storyArcs)
  const mustHonor = [
    labeledValue(storyCore, ['一句话故事']),
    centralConflict,
    labeledValue(worldview, ['世界来源', '世界规则', '规则']),
  ].filter(Boolean)
  const values: Pick<NarrativeBriefV1, NarrativeBriefFieldKeyV1> = {
    protagonistDesire: desire || open('一个可以通过行动追求的主角欲望'),
    obstacle: centralConflict || open('阻止主角立刻达成目标的具体阻力'),
    stakes: stakes || open('失败、拖延或错误选择会造成的具体代价'),
    requiredChoice: choice || open('主角必须作出的不可回避选择'),
    entryState: entry || open('场景开始时人物、关系或局势的可验证状态'),
    exitChange: open('本轮结束时至少一项人物、关系、资源或局势变化'),
    nextPressure: open('迫使故事继续向前的下一步压力'),
  }
  const freedomLabels: Record<NarrativeBriefFieldKeyV1, string> = {
    protagonistDesire: '主角欲望',
    obstacle: '具体阻力',
    stakes: '失败代价',
    requiredChoice: '关键选择',
    entryState: '进入状态',
    exitChange: '退出变化',
    nextPressure: '下一步压力',
  }
  const creativeFreedom = NARRATIVE_BRIEF_FIELD_KEYS
    .filter(key => isOpen(values[key]))
    .map(key => `可在不冲突的前提下提议${freedomLabels[key]}；它在作者采纳前不是 Canon。`)

  return parseNarrativeBriefV1({
    version: 1,
    creativeGoal: input.authorRequest.trim() || '推进当前故事任务',
    ...values,
    mustHonor: [...new Set(mustHonor)],
    mustNotReveal: ['不得把规划中的未来信息或角色不知道的私人事实写成角色当前已知内容。'],
    creativeFreedom,
    assumptions: mergeProvisionalAssumptionsV1(input.inheritedAssumptions ?? []),
  })
}

export function mergeProvisionalAssumptionsV1(
  ...groups: ReadonlyArray<readonly CreativeAssumptionV1[]>
): CreativeAssumptionV1[] {
  const byText = new Map<string, CreativeAssumptionV1>()
  for (const assumption of groups.flat()) {
    const parsed = parseCreativeAssumptionV1(assumption)
    if (parsed.status !== 'provisional') continue
    const key = parsed.text.trim().replace(/\s+/g, ' ')
    if (!byText.has(key)) byText.set(key, parsed)
  }
  return [...byText.values()].slice(0, 100)
}

export function formatNarrativeBriefForPromptV1(brief: NarrativeBriefV1): string {
  return [
    '【本轮叙事任务（运行时合同，不是新增 Canon）】',
    `创作目标：${brief.creativeGoal}`,
    `主角欲望：${brief.protagonistDesire}`,
    `具体阻力：${brief.obstacle}`,
    `失败代价：${brief.stakes}`,
    `关键选择：${brief.requiredChoice}`,
    `进入状态：${brief.entryState}`,
    `退出变化：${brief.exitChange}`,
    `下一步压力：${brief.nextPressure}`,
    brief.mustHonor.length ? `必须遵守：\n- ${brief.mustHonor.join('\n- ')}` : '',
    brief.mustNotReveal.length ? `不得泄露：\n- ${brief.mustNotReveal.join('\n- ')}` : '',
    brief.assumptions.length
      ? `上游临时假设（作者采纳前不是正式设定）：\n- ${brief.assumptions.map(item => item.text).join('\n- ')}`
      : '',
    brief.creativeFreedom.length ? `开放创作空间：\n- ${brief.creativeFreedom.join('\n- ')}` : '',
    '开放项必须转化为行动、阻力、选择和状态变化，不要用世界观介绍代替故事推进。',
  ].filter(Boolean).join('\n')
}
