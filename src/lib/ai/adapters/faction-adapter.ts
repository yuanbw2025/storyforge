/**
 * 势力模块 Adapter —— 镜像 foreshadow-adapter 模式
 *
 * 两个动作：
 * 1. faction.generate —— AI 生成势力建议（自由文本）
 * 2. faction.relations —— AI 生成势力间关系建议
 *
 * 二次结构化解析把自由文本拆成 JSON 数组，方便走 adopt() 入库。
 * memberCharacterNames 在 adapter 内查 characters 表按名匹配转成 memberCharacterIds。
 */
import type { ChatMessage } from '../../types'
import type {
  FactionType,
  FactionStatus,
  FactionRelationType,
} from '../../types/faction'
import { usePromptStore } from '../../../stores/prompt'
import { renderPrompt } from '../prompt-engine'
import { db } from '../../db/schema'

export interface RunOptions {
  parameterValues?: Record<string, unknown>
  overrides?: { systemPrompt?: string; userPromptTemplate?: string }
}

// ── 势力生成 ────────────────────────────────────────────────────────────

export function buildFactionGeneratePrompt(
  projectName: string,
  genres: string,
  worldContext: string,
  characterContext: string,
  existingFactions: string,
  options?: RunOptions,
  userHint?: string,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('faction.generate')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres,
    worldContext,
    characters: characterContext,
    existingFactions,
    hasNoFactions: existingFactions ? '' : '1',
    userHint: userHint ?? '',
  }, options)
  return messages
}

const VALID_FACTION_TYPES: FactionType[] = [
  'nation', 'sect', 'guild', 'clan', 'organization', 'military', 'religion', 'merchant', 'other',
]
const VALID_FACTION_STATUSES: FactionStatus[] = [
  'rising', 'peak', 'declining', 'destroyed', 'hidden',
]

export interface StructuredFaction {
  name: string
  type: FactionType
  ideology: string
  leader: string
  memberNames: string[]
  baseLocation: string
  power: string
  resources: string
  secret: string
  status: FactionStatus
}

/** 把 AI 自由文本拆成结构化 JSON 数组的二次解析 prompt */
export function buildFactionStructurePrompt(text: string): ChatMessage[] {
  const system = `你是一个文本结构化助手。用户提供了一段 AI 生成的势力建议文本，请把其中每一个势力拆分为结构化条目，输出纯 JSON 数组（不要 markdown 代码块，不要解释）：
[{ "name": "势力名", "type": "类型代码", "ideology": "核心理念", "leader": "首领名", "memberNames": ["角色A","角色B"], "baseLocation": "根据地", "power": "实力描述", "resources": "资源描述", "secret": "隐秘信息", "status": "状态代码" }]

type 只能是以下之一（按势力性质选最贴切的）：
nation(国家/政权) / sect(门派/宗门) / guild(公会/行会) / clan(家族/氏族) / organization(组织) / military(军事单位) / religion(宗教/信仰) / merchant(商会/财团) / other(其他)
无法判断时用 other。

status 只能是以下之一：
rising(崛起中) / peak(鼎盛) / declining(衰落) / destroyed(已覆灭) / hidden(隐秘)
无法判断时用 rising。

memberNames 是该势力的成员角色名列表（来自上方角色档案，必须用角色真实姓名，不是势力名）。

请完整提取文本中的每一个势力，不要遗漏，不要合并。`
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ]
}

/** 解析结构化输出 */
export function parseFactionStructured(raw: string): StructuredFaction[] {
  const trimmed = raw.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  let jsonStr = fence ? fence[1].trim() : trimmed
  const start = jsonStr.indexOf('[')
  const end = jsonStr.lastIndexOf(']')
  if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1)
  try {
    const arr = JSON.parse(jsonStr)
    if (!Array.isArray(arr)) return []
    return arr
      .map((f: Record<string, unknown>): StructuredFaction => ({
        name: String(f.name || '').trim(),
        type: VALID_FACTION_TYPES.includes(f.type as FactionType) ? (f.type as FactionType) : 'other',
        ideology: String(f.ideology || '').trim(),
        leader: String(f.leader || '').trim(),
        memberNames: Array.isArray(f.memberNames)
          ? f.memberNames.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map((n: string) => n.trim())
          : [],
        baseLocation: String(f.baseLocation || '').trim(),
        power: String(f.power || '').trim(),
        resources: String(f.resources || '').trim(),
        secret: String(f.secret || '').trim(),
        status: VALID_FACTION_STATUSES.includes(f.status as FactionStatus) ? (f.status as FactionStatus) : 'rising',
      }))
      .filter(f => f.name)
  } catch {
    return []
  }
}

/**
 * 把结构化势力里的 memberNames 转成 memberCharacterIds（按名匹配 characters 表）。
 * 未匹配到的名字静默丢弃（adopt 的 arrayMemberChecks 也会二次过滤）。
 */
export async function resolveMemberCharacterIds(
  projectId: number,
  memberNames: string[],
): Promise<number[]> {
  if (!memberNames.length) return []
  const characters = await db.characters.where('projectId').equals(projectId).toArray()
  const nameToId = new Map(characters.filter(c => c.id != null).map(c => [c.name, c.id!]))
  return memberNames.map(n => nameToId.get(n)).filter((id): id is number => typeof id === 'number')
}

// ── 势力关系生成 ────────────────────────────────────────────────────────

export function buildFactionRelationsPrompt(
  projectName: string,
  genres: string,
  factionsList: string,
  options?: RunOptions,
  userHint?: string,
): ChatMessage[] {
  const tpl = usePromptStore.getState().getActive('faction.relations')
  const { messages } = renderPrompt(tpl, {
    projectName,
    genres,
    factions: factionsList,
    hasNoFactions: factionsList ? '' : '1',
    userHint: userHint ?? '',
  }, options)
  return messages
}

const VALID_RELATION_TYPES: FactionRelationType[] = [
  'alliance', 'hostile', 'vassal', 'trade', 'covert', 'rival', 'neutral',
]

export interface StructuredFactionRelation {
  fromFactionName: string
  toFactionName: string
  relationType: FactionRelationType
  label: string
  description: string
  isBidirectional: boolean
  intensity: number
}

export function buildFactionRelationsStructurePrompt(text: string): ChatMessage[] {
  const system = `你是一个文本结构化助手。用户提供了一段 AI 生成的势力关系建议文本，请把其中每一对势力关系拆分为结构化条目，输出纯 JSON 数组（不要 markdown 代码块，不要解释）：
[{ "fromFactionName": "势力A名", "toFactionName": "势力B名", "relationType": "关系代码", "label": "关系标签", "description": "关系描述", "isBidirectional": true, "intensity": 75 }]

relationType 只能是以下之一：
alliance(结盟) / hostile(敌对) / vassal(附庸/从属) / trade(贸易往来) / covert(暗中合作) / rival(竞争) / neutral(中立)
无法判断时用 neutral。

fromFactionName / toFactionName 必须使用上方势力列表里的真实势力名。

isBidirectional 为布尔值（true/false），表示关系是否双向。
intensity 为 0-100 的整数，表示关系强度。

请完整提取文本中的每一对势力关系，不要遗漏，不要合并。`
  return [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ]
}

export function parseFactionRelationsStructured(raw: string): StructuredFactionRelation[] {
  const trimmed = raw.trim()
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  let jsonStr = fence ? fence[1].trim() : trimmed
  const start = jsonStr.indexOf('[')
  const end = jsonStr.lastIndexOf(']')
  if (start >= 0 && end > start) jsonStr = jsonStr.slice(start, end + 1)
  try {
    const arr = JSON.parse(jsonStr)
    if (!Array.isArray(arr)) return []
    return arr
      .map((r: Record<string, unknown>): StructuredFactionRelation => ({
        fromFactionName: String(r.fromFactionName || '').trim(),
        toFactionName: String(r.toFactionName || '').trim(),
        relationType: VALID_RELATION_TYPES.includes(r.relationType as FactionRelationType)
          ? (r.relationType as FactionRelationType) : 'neutral',
        label: String(r.label || '').trim(),
        description: String(r.description || '').trim(),
        isBidirectional: Boolean(r.isBidirectional),
        intensity: typeof r.intensity === 'number'
          ? Math.max(0, Math.min(100, Math.round(r.intensity)))
          : 50,
      }))
      .filter(r => r.fromFactionName && r.toFactionName)
  } catch {
    return []
  }
}
