import type { Chapter, OutlineNode, Project, WorldGroup } from '../types'
import type { PromptTemplate } from '../types/prompt'
import { resolveCanonicalChapterSequence } from './chapter-memory/canonical-chapter-sequence'
import { getLibraryScopeNeeds } from './prompt-library'

export interface PromptLibraryScopeSelection {
  worldGroupId?: number | null
  outlineNodeId?: number | null
  chapterId?: number | null
}

export interface ResolvedPromptLibraryScope {
  projectId: number
  worldGroupId: number | null
  outlineNodeId: number | null
  chapterId: number | null
  errors: string[]
}

export function resolvePromptLibraryScope(args: {
  template: PromptTemplate
  project: Project
  chapters: readonly Chapter[]
  nodes: readonly OutlineNode[]
  groups: readonly WorldGroup[]
  selection: PromptLibraryScopeSelection
}): ResolvedPromptLibraryScope {
  const projectId = args.project.id
  if (projectId == null) {
    return { projectId: 0, worldGroupId: null, outlineNodeId: null, chapterId: null, errors: ['当前项目不存在。'] }
  }

  const errors: string[] = []
  const needs = getLibraryScopeNeeds(args.template)
  const chapterRequired = needs.chapter || args.template.library?.output.recordScope === 'chapter'
  const projectChapters = args.chapters.filter(chapter => chapter.projectId === projectId)
  const projectNodes = args.nodes.filter(node => node.projectId === projectId)
  const projectGroups = args.groups.filter(group => group.projectId === projectId)

  let chapterId: number | null = null
  let outlineNodeId: number | null = null
  let worldGroupId: number | null = null

  if (chapterRequired) {
    const chapter = projectChapters.find(item => item.id === args.selection.chapterId)
    if (!chapter?.id) {
      errors.push('请选择当前项目中的章节。')
    } else {
      chapterId = chapter.id
      const node = projectNodes.find(item => item.id === chapter.outlineNodeId)
      if (!node?.id) {
        errors.push('所选章节关联的大纲节点不存在或不属于当前项目。')
      } else {
        outlineNodeId = node.id
        worldGroupId = args.project.enableMultiWorld
          ? resolveNodeWorldGroupId(node, projectNodes)
          : null
        if (args.selection.outlineNodeId != null && args.selection.outlineNodeId !== node.id) {
          errors.push('所选大纲节点与章节关联的大纲节点不一致。')
        }
      }

      if (args.template.library?.assetId === 'P11-A') {
        const first = resolveCanonicalChapterSequence(projectNodes, projectChapters).sequence[0]?.chapter
        if (!first?.id || first.id !== chapter.id) {
          errors.push('“首章草稿”只能写入当前大纲顺序中的第一章。')
        }
      }
    }
  } else if (needs.outline) {
    const node = projectNodes.find(item => item.id === args.selection.outlineNodeId)
    if (!node?.id) {
      errors.push('请选择当前项目中的大纲节点。')
    } else {
      outlineNodeId = node.id
      worldGroupId = args.project.enableMultiWorld
        ? resolveNodeWorldGroupId(node, projectNodes)
        : null
    }
  }

  if (args.project.enableMultiWorld && (needs.world || worldGroupId != null)) {
    if (worldGroupId == null && args.selection.worldGroupId != null) {
      worldGroupId = args.selection.worldGroupId
    }
    const group = projectGroups.find(item => item.id === worldGroupId)
    if (!group?.id) {
      errors.push('无法从当前范围确定有效的世界。')
    }
  }

  if (
    args.project.enableMultiWorld
    && worldGroupId != null
    && args.selection.worldGroupId != null
    && worldGroupId !== args.selection.worldGroupId
    && (chapterRequired || needs.outline)
  ) {
    errors.push('所选世界与章节或大纲节点所属世界不一致。')
  }

  return { projectId, worldGroupId, outlineNodeId, chapterId, errors: [...new Set(errors)] }
}

export function resolveNodeWorldGroupId(
  node: OutlineNode,
  nodes: readonly OutlineNode[],
): number | null {
  const byId = new Map(nodes.map(item => [item.id, item] as const))
  const visited = new Set<number>()
  let current: OutlineNode | undefined = node
  while (current?.id != null && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.worldGroupId != null) return current.worldGroupId
    current = current.parentId == null ? undefined : byId.get(current.parentId)
  }
  return null
}
