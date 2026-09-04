import type { UseAIStreamReturn } from '../../hooks/useAIStream'
import type { GenerationNode } from '../generation/generation-node'
import type { AssembleContextResult } from '../registry/types'
import type { OutlineNode, Project, Work } from '../types'
import type { RunOptions } from '../ai/adapters/outline-adapter'
import {
  parseChapterOutlineOutput,
  parseVolumeOutlineOutput,
} from '../ai/parse-outline-output'
import { buildOutlineGenerationPlan } from './generation-plan'
import {
  encodeGenerationOperation,
  outlineGenerationModuleKey,
  type OutlineGenerationRequest,
} from './generation-request'

type OutlineGenerationAI = Pick<UseAIStreamReturn, 'start'>

export class OutlineGenerationSkipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutlineGenerationSkipError'
  }
}

export function createOutlineGenerationNode(input: {
  request: OutlineGenerationRequest
  project: Project
  work: Work
  nodes: OutlineNode[]
  volumes: OutlineNode[]
  hint: string
  runOptions: RunOptions
  ai: OutlineGenerationAI
}): GenerationNode<AssembleContextResult, string> {
  const { request, project, work, nodes, volumes, hint, runOptions, ai } = input
  const category = outlineGenerationModuleKey(request)
  return {
    id: encodeGenerationOperation(request),
    kind: category,
    editableInput: true,
    assembleInput: assembled => {
      const plan = buildOutlineGenerationPlan({
        request,
        work,
        nodes,
        volumes,
        assembled,
        hint,
        options: runOptions,
      })
      if (plan.status === 'skip') throw new OutlineGenerationSkipError(plan.reason)
      return plan.messages
    },
    run: messages => category === 'outline.volume'
      ? ai.start(messages, undefined, {
        formalEntryId: 'outline.volume.generate',
        category: 'outline.volume',
        projectId: project.id!,
      })
      : ai.start(messages, undefined, {
        formalEntryId: 'outline.chapter.generate',
        category: 'outline.chapter',
        projectId: project.id!,
      }),
    gate: output => {
      if (!output.trim()) {
        return {
          status: 'blocked',
          issues: [{ code: 'outline_output_missing', message: '模型没有返回可持久化的大纲候选。' }],
        }
      }
      const items = request.kind === 'volumes' || request.kind === 'single-volume'
        ? parseVolumeOutlineOutput(output)
        : parseChapterOutlineOutput(output)
      if (items.length === 0) {
        return {
          status: 'blocked',
          issues: [{ code: 'outline_output_unparseable', message: '模型输出无法确定性解析为大纲条目。' }],
        }
      }
      if ((request.kind === 'single-volume' || request.kind === 'single-chapter') && items.length !== 1) {
        return {
          status: 'blocked',
          issues: [{ code: 'outline_single_target_count', message: '单项补全必须且只能返回一个大纲条目。' }],
        }
      }
      return { status: 'pass', issues: [] }
    },
  }
}
