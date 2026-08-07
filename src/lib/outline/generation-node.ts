import type { UseAIStreamReturn } from '../../hooks/useAIStream'
import type { GenerationNode } from '../generation/generation-node'
import type { AssembleContextResult } from '../registry/types'
import type { OutlineNode, Project } from '../types'
import type { RunOptions } from '../ai/adapters/outline-adapter'
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
  nodes: OutlineNode[]
  volumes: OutlineNode[]
  hint: string
  runOptions: RunOptions
  ai: OutlineGenerationAI
}): GenerationNode<AssembleContextResult, string> {
  const { request, project, nodes, volumes, hint, runOptions, ai } = input
  const category = outlineGenerationModuleKey(request)
  return {
    id: encodeGenerationOperation(request),
    kind: category,
    editableInput: true,
    assembleInput: assembled => {
      const plan = buildOutlineGenerationPlan({
        request,
        project,
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
        category: 'outline.volume',
        projectId: project.id!,
      })
      : ai.start(messages, undefined, {
        category: 'outline.chapter',
        projectId: project.id!,
      }),
    gate: output => output.trim()
      ? { status: 'pass', issues: [] }
      : {
          status: 'blocked',
          issues: [{ code: 'outline_output_missing', message: '模型没有返回可持久化的大纲候选。' }],
        },
  }
}
