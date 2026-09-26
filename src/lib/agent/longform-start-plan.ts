import type { MasterAgentPlan } from './orchestrator'
import type { OutlineNode, WorkspaceScope } from '../types'
import { readOwnedRows } from '../workspace/scope'
import { walkOutlineChaptersInCanonicalOrder } from '../outline/canonical-outline-walk'
import { parseAuthorOrdinalV1 } from './author-intent'

/** A visible proposal only. Each prerequisite uses the existing outline Skill
 * and must be adopted before the following task can read it. No placeholder
 * Canon, full-book outline, character or world generation is created here. */
export async function prepareLongformStartProposalV1(
  plan: MasterAgentPlan,
  scope: WorkspaceScope,
  worldGroupId: number | null,
): Promise<MasterAgentPlan> {
  if (plan.tasks.length !== 1 || plan.tasks[0].skillId !== 'prose.generate') return plan
  const nodes = await readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' })
  if (
    walkOutlineChaptersInCanonicalOrder(nodes).chapters.some(
      (item) => (item.worldGroupId ?? null) === worldGroupId,
    )
  )
    return plan
  const volumes = nodes.filter(
    (node) =>
      node.type === 'volume' && node.parentId === null && (node.worldGroupId ?? null) === worldGroupId,
  )
  const prose = plan.tasks[0]
  const ordinal = prose.instruction.match(/第\s*([零〇一二两三四五六七八九十百千\d]+)\s*章/)
  if (ordinal && parseAuthorOrdinalV1(ordinal[1]) !== 1) {
    return {
      ...plan,
      tasks: [],
      summary: `当前还没有章节，未找到指定的第${ordinal[1]}章。可以先创建一个章节，或导入已有章纲；不会把要求改写到其他位置。`,
    }
  }
  const prefix = `start-${prose.id}`.slice(0, 50)
  const volumeId = `${prefix}-volume`
  const chapterId = `${prefix}-chapter`
  const authorGoal = `作者本次目标：${prose.instruction}`
  return {
    ...plan,
    summary:
      '这部作品还没有章节保存位置。本轮只准备一个章节，再写你指定的正文；不要求补齐世界、角色或全书大纲。请确认下面的最小计划，每份候选都由你采纳后再继续。',
    workflow: {
      version: 1,
      workflowId: 'staged-author-confirmed',
      reasonCodes: ['outline-prose-confirmation-barrier', 'multiple-explicit-domains'],
    },
    tasks: [
      ...(!volumes.length
        ? [
            {
              id: volumeId,
              agentId: 'outline' as const,
              skillId: 'outline.volumes' as const,
              instruction: `只拟定 1 个卷的简短标题和一句话摘要，作为本次章节的容器；不要规划全书，不扩展其他设定。${authorGoal}`,
              dependsOn: [],
              ...(prose.requestContext ? { requestContext: prose.requestContext } : {}),
            },
          ]
        : []),
      {
        id: chapterId,
        agentId: 'outline',
        skillId: 'outline.chapters',
        instruction: `只拟定 1 个章节标题和简短场景摘要，供本次正文使用；不要生成多章或完整细纲。${authorGoal}`,
        dependsOn: volumes.length ? [] : [volumeId],
        ...(prose.requestContext ? { requestContext: prose.requestContext } : {}),
      },
      { ...prose, dependsOn: [chapterId] },
    ],
  }
}
