/**
 * 设定对齐适配器 · Settings Alignment Adapter
 *
 * 输入：全部已有设定（通过 assembleCrossSettingContext 装配）
 * 输出：设定之间的矛盾列表 + 修复建议
 *
 * 与 consistency-audit-adapter 的区别：
 * - consistency-audit：章节正文 vs 事实基准（写后检测）
 * - settings-alignment：设定 vs 设定（写前预防）
 */

import type { ChatMessage } from '../../types'

export type AlignmentSeverity = 'critical' | 'warning' | 'info'

export interface AlignmentConflict {
  /** 矛盾涉及的第一个设定域 */
  domainA: string
  /** 矛盾涉及的第二个设定域 */
  domainB: string
  /** 严重程度 */
  severity: AlignmentSeverity
  /** 设定A中的具体冲突内容 */
  contentA: string
  /** 设定B中的具体冲突内容 */
  contentB: string
  /** 为什么这两条设定互相矛盾 */
  reason: string
  /** 修复建议 */
  suggestion: string
}

export interface AlignmentResult {
  conflicts: AlignmentConflict[]
  /** AI 对设定库整体一致性的简要评价 */
  overview: string
  /** 本次检查覆盖的设定域 */
  checkedDomains: string[]
}

/**
 * 构建设定对齐检测 prompt
 */
export function buildSettingsAlignmentPrompt(args: {
  projectName: string
  /** 完整的跨设定上下文（来自 assembleCrossSettingContext） */
  allSettings: string
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是一个小说设定一致性审计器。你的任务是：阅读作者已填写的全部设定，找出其中互相矛盾的地方。

工作方式：
1. 逐条对比不同设定域之间的内容——世界观 vs 角色设定、力量体系 vs 故事核心、历史线 vs 角色背景 等
2. 只报告"确定矛盾"——A 说的和 B 说的在逻辑上不可调和
3. 不报告"可能不一致但可以被合理解释"的情况
4. 不报告文笔/质量/完整性问题——只看事实矛盾
5. 每条矛盾必须引用原文，且两条引用来自不同的设定域

常见的矛盾类型（仅供参考，不限于此）：
- 时间线矛盾：角色A的背景说我出生在战后，但世界历史线说那场战争发生在角色出生前
- 实力矛盾：力量体系说境界X需要千年修炼，但角色设定说20岁就到了境界X
- 地理矛盾：角色设定说住在北方冰原，但世界观说北方冰原无人生存
- 规则矛盾：故事核心说主题是"凡人逆天"，但力量体系说力量是血统决定的
- 关系矛盾：角色A说与角色B是师徒，但角色B说与角色A是仇敌
- 数量矛盾：世界观说世界有七个王国，但势力分布列出了九个
- 存在性矛盾：力量体系定义了某境界/能力，但世界观说那个领域的力量不存在

输出严格 JSON（不要 markdown 包裹）：
{
  "conflicts": [
    {
      "domainA": "设定域名（如：世界观-世界历史线 / 角色-林月背景 / 力量体系-等级规则）",
      "domainB": "设定域名",
      "severity": "critical|warning|info",
      "contentA": "设定A中的原文引用（逐字）",
      "contentB": "设定B中的原文引用（逐字）",
      "reason": "为何这两条互相矛盾（简洁）",
      "suggestion": "修复建议——至少给出两种可能的改法"
    }
  ],
  "overview": "对整体设定库一致性的一句话评价"
}

严重程度标准：
- critical：逻辑上绝对不可调和，必须改一处才能讲得通
- warning：存在明显张力但可能可以被解释（需要作者确认）
- info：小瑕疵——不一致但不太影响主线叙事

如果确实没有矛盾，返回空 conflicts 数组和正面的 overview。不要为了找矛盾而强行找矛盾。`,
    },
    {
      role: 'user',
      content: `小说：${args.projectName}

以下是作者已填写的全部设定。请找到其中互相矛盾的地方：

${args.allSettings}

请输出 JSON：`,
    },
  ]
}

/**
 * 解析 AI 返回的对齐结果
 */
export function parseAlignmentResult(raw: string): AlignmentResult | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1))
    if (!parsed || typeof parsed !== 'object') return null

    const conflicts: AlignmentConflict[] = Array.isArray(parsed.conflicts)
      ? parsed.conflicts
          .filter((item: unknown) => item && typeof item === 'object')
          .map((item: Record<string, unknown>) => ({
            domainA: String(item.domainA ?? '').trim(),
            domainB: String(item.domainB ?? '').trim(),
            severity: ['critical', 'warning', 'info'].includes(String(item.severity))
              ? String(item.severity) as AlignmentSeverity
              : 'warning',
            contentA: String(item.contentA ?? '').trim(),
            contentB: String(item.contentB ?? '').trim(),
            reason: String(item.reason ?? '').trim(),
            suggestion: String(item.suggestion ?? '').trim(),
          }))
          .filter((c: AlignmentConflict) =>
            c.domainA && c.domainB && c.contentA && c.contentB && c.reason,
          )
      : []

    const overview = typeof parsed.overview === 'string'
      ? parsed.overview.trim()
      : conflicts.length === 0 ? '未发现设定矛盾。' : ''

    return {
      conflicts,
      overview,
      checkedDomains: [...new Set(conflicts.flatMap(c => [c.domainA, c.domainB]))],
    }
  } catch {
    return null
  }
}

/**
 * 构建"按建议修复"的 prompt — 用于单条冲突的自动修复
 */
export function buildAlignmentFixPrompt(args: {
  conflict: AlignmentConflict
  allSettings: string
}): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `你是一个小说设定修复助手。作者有一对互相矛盾的设定，你的任务是给出修改后的文本。

规则：
1. 优先修改冲突中更"下游"的那条设定（如：角色设定比世界观更容易调整）
2. 尽量保留作者的原始意图，只改矛盾的部分
3. 输出纯 JSON：{"fixedDomain": "要修改的设定域", "fixedContent": "修改后的完整文本", "explanation": "一句话说明改了什么"}
4. 如果两条都需要改，输出两次。`,
    },
    {
      role: 'user',
      content: `全部设定：\n${args.allSettings}\n\n矛盾：\n- ${args.conflict.domainA}：${args.conflict.contentA}\n- ${args.conflict.domainB}：${args.conflict.contentB}\n原因：${args.conflict.reason}\n建议：${args.conflict.suggestion}\n\n请输出修复 JSON：`,
    },
  ]
}
