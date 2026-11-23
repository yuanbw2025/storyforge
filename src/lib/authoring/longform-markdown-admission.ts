import { resolveLongformChapterNavigationV1 } from './longform-chapter-navigation'
import type { AuthoringCandidate, AuthoringNodeInstance } from '../node-authoring/contracts'
import type { Chapter, Project, Work, WorkspaceScope } from '../types'
import { readOwnedRows } from '../workspace/scope'

export interface LongformMarkdownAdmissionInputV1 {
  workspacePurpose?: Project['workspacePurpose'] | null
  workKind?: Work['kind'] | null
  novelProfile?: Work['novelProfile'] | null
}

/**
 * 长篇正文 Markdown 预览/交接的产品准入：只在「独立长篇」开放。
 * 短篇、世界内叙事、只读对照、资格未知一律不开放，保持原富文本/候选 textarea 合同。
 * 本机模式偏好不参与判定，不能绕过产品准入。
 */
export function isLongformMarkdownAdmissionV1(input: LongformMarkdownAdmissionInputV1): boolean {
  return input.workspacePurpose === 'independent-work'
    && input.workKind === 'novel'
    && input.novelProfile === 'long'
}

/**
 * 节点图「在正文编辑器打开」的最小交接。只对已采用为正式 chapter.prose 的节点，
 * 或带已验证 live 章节绑定的节点给出跳转目标；其余一律拒绝，不猜目标、不跳转。
 * 跳转复用现成的 resolveLongformChapterNavigationV1，不手拼 URL、不直接读 active
 * chapter、不重新调用模型、不采纳、不另写正文副本。
 */
export async function resolveNodeAuthoringChapterHandoffV1(input: {
  scope: WorkspaceScope
  project: Pick<Project, 'workspacePurpose'>
  work: Pick<Work, 'kind' | 'novelProfile'>
  node: AuthoringNodeInstance
  candidate?: AuthoringCandidate | null
}): Promise<string> {
  if (!isLongformMarkdownAdmissionV1({
    workspacePurpose: input.project.workspacePurpose,
    workKind: input.work.kind,
    novelProfile: input.work.novelProfile,
  })) {
    throw new Error('当前用途或作品不开放正文 Markdown 编辑；请继续使用富文本。')
  }
  const outlineNodeId = await resolveNodeChapterOutlineNodeIdV1(input.scope, input.node, input.candidate ?? null)
  return resolveLongformChapterNavigationV1({ scope: input.scope, outlineNodeId, module: 'chapters-list' })
}

async function resolveNodeChapterOutlineNodeIdV1(
  scope: WorkspaceScope,
  node: AuthoringNodeInstance,
  candidate: AuthoringCandidate | null,
): Promise<number> {
  // 1) 已采用为正式 chapter.prose 的候选：prose 领域冻结了唯一章纲身份。
  if (candidate?.status === 'adopted' && candidate.domain?.kind === 'prose') {
    const id = candidate.domain.outlineNodeId
    if (Number.isSafeInteger(id) && id > 0) return id
    throw new Error('已采纳正文缺少可用章纲身份，不能跳转。')
  }
  // 2) 已验证 live 章节绑定：绑定必须回当前作品唯一章纲。
  const ref = node.binding?.ref
  if (node.binding?.mode === 'live' && ref?.documentId) {
    const chapters = await readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' })
    const matches = chapters.filter(chapter => chapter.ragDocumentId === ref.documentId)
    if (matches.length !== 1) throw new Error('节点章节绑定已失效或不是当前作品的唯一章节，不能跳转。')
    const id = matches[0].outlineNodeId
    if (Number.isSafeInteger(id) && id > 0) return id
    throw new Error('节点章节绑定缺少可用章纲身份，不能跳转。')
  }
  throw new Error('该节点尚未采用为正式正文，也没有已验证的章节绑定，不能跳转。')
}
