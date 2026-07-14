import type { ChatMessage, OutlineNode, Project } from '../types'
import {
  buildChapterOutlinePrompt,
  buildSingleChapterOutlinePrompt,
  buildVolumeOutlinePrompt,
  type RunOptions,
} from '../ai/adapters/outline-adapter'
import type { AssembleContextResult } from '../registry/types'
import type { OutlineGenerationRequest } from './generation-request'

export type OutlineGenerationPlan = {
  status: 'ready'
  category: 'outline.volume' | 'outline.chapter'
  messages: ChatMessage[]
} | {
  status: 'skip'
  reason: string
}

function contextPart(assembled: AssembleContextResult, key: string): string {
  const index = assembled.included.indexOf(key)
  return index >= 0 ? assembled.segments[index]?.content ?? '' : ''
}

export function findVolumeForOutlineChapter(nodes: OutlineNode[], chapterId: number): OutlineNode | null {
  const chapter = nodes.find(node => node.id === chapterId && node.type === 'chapter')
  if (!chapter) return null
  const parent = nodes.find(node => node.id === chapter.parentId)
  if (parent?.type === 'volume') return parent
  if (parent?.type === 'storyBlock') {
    return nodes.find(node => node.id === parent.parentId && node.type === 'volume') ?? null
  }
  return null
}

export function findGenerationTargetVolume(
  request: OutlineGenerationRequest,
  nodes: OutlineNode[],
  volumes: OutlineNode[],
): OutlineNode | null {
  if (request.kind === 'single-volume' || request.kind === 'chapters') {
    return volumes.find(volume => volume.id === request.volumeId) ?? null
  }
  if (request.kind === 'single-chapter') return findVolumeForOutlineChapter(nodes, request.chapterId)
  return null
}

export function outlineGenerationTargetError(
  request: OutlineGenerationRequest,
  nodes: OutlineNode[],
  volumes: OutlineNode[],
): string | null {
  if (request.kind === 'volumes') return null
  if (findGenerationTargetVolume(request, nodes, volumes)) return null
  return request.kind === 'single-volume'
    ? '要补全的卷不存在，请重新选择。'
    : '要生成章纲的卷不存在，请重新选择。'
}

export function buildOutlineGenerationPlan(input: {
  request: OutlineGenerationRequest
  project: Project
  nodes: OutlineNode[]
  volumes: OutlineNode[]
  assembled: AssembleContextResult
  hint: string
  options: RunOptions
}): OutlineGenerationPlan {
  const { request, project, nodes, volumes, assembled, hint, options } = input
  const targetError = outlineGenerationTargetError(request, nodes, volumes)
  if (targetError) return { status: 'skip', reason: targetError }

  if (request.kind === 'volumes' || request.kind === 'single-volume') {
    const explicitCount = Number(options.parameterValues?.volumeCount)
    if (
      request.kind === 'volumes'
      && options.parameterValues?.volumeCount !== ''
      && options.parameterValues?.volumeCount != null
      && Number.isFinite(explicitCount)
      && explicitCount > 0
      && explicitCount <= volumes.length
    ) {
      return {
        status: 'skip',
        reason: `当前已有 ${volumes.length} 卷，已达到你设定的 ${Math.floor(explicitCount)} 卷，无需继续生成。`,
      }
    }
    const targetVolume = request.kind === 'single-volume'
      ? volumes.find(volume => volume.id === request.volumeId) ?? null
      : null
    return {
      status: 'ready',
      category: 'outline.volume',
      messages: buildVolumeOutlinePrompt(
        project.name,
        project.genre,
        assembled.text,
        contextPart(assembled, 'storyCore'),
        project.targetWordCount || 500000,
        hint,
        options,
        contextPart(assembled, 'characters'),
        contextPart(assembled, 'worldRules'),
        {
          existingVolumesContext: contextPart(assembled, 'existingVolumeOutlines'),
          existingVolumeCount: volumes.length,
          targetVolumeTitle: targetVolume?.title,
        },
      ),
    }
  }

  const volume = request.kind === 'chapters'
    ? volumes.find(item => item.id === request.volumeId) ?? null
    : findVolumeForOutlineChapter(nodes, request.chapterId)
  if (!volume) return { status: 'skip', reason: '要生成章纲的卷不存在，请重新选择。' }

  const volumeIndex = volumes.findIndex(item => item.id === volume.id)
  const previousSummary = volumeIndex > 0 ? volumes[volumeIndex - 1].summary : ''
  const characterContext = contextPart(assembled, 'characters')
  const worldRulesContext = contextPart(assembled, 'worldRules')
  if (request.kind === 'single-chapter') {
    const chapter = nodes.find(node => node.id === request.chapterId && node.type === 'chapter')
    if (!chapter) return { status: 'skip', reason: '要生成章纲的章节不存在，请重新选择。' }
    const siblings = nodes
      .filter(node => node.type === 'chapter' && node.parentId === chapter.parentId && node.id !== chapter.id)
      .sort((a, b) => a.order - b.order)
    const siblingContext = siblings.length
      ? `同级已有章节：\n${siblings.map(item => `- ${item.title}${item.summary ? `：${item.summary}` : ''}`).join('\n')}`
      : ''
    return {
      status: 'ready',
      category: 'outline.chapter',
      messages: buildSingleChapterOutlinePrompt(
        volume.title,
        volume.summary,
        chapter.title,
        siblingContext,
        assembled.text,
        previousSummary,
        hint,
        options,
        characterContext,
        worldRulesContext,
      ),
    }
  }

  return {
    status: 'ready',
    category: 'outline.chapter',
    messages: buildChapterOutlinePrompt(
      volume.title,
      volume.summary,
      assembled.text,
      previousSummary,
      hint,
      options,
      characterContext,
      worldRulesContext,
    ),
  }
}
