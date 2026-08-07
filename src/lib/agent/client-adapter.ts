import { chat, type AICallMeta, type ChatResult } from '../ai/client'
import type { AIConfig } from '../types'
import {
  runDurableReadOnlyAgentV1,
  type RunDurableReadOnlyAgentInputV1,
} from './run/read-only-durable'
import {
  runReadOnlyAgent,
  type AgentModelAdapter,
  type RunReadOnlyAgentInput,
} from './runner'

export interface RunReadOnlyAgentWithClientInput extends Omit<RunReadOnlyAgentInput, 'model'> {
  config: AIConfig
  meta?: AICallMeta
}

export interface RunDurableReadOnlyAgentWithClientInputV1 extends Omit<
  RunDurableReadOnlyAgentInputV1,
  'model' | 'executionBinding'
> {
  config: AIConfig
  meta?: AICallMeta
}

function clientModel(input: {
  config: AIConfig
  meta?: AICallMeta
  context: RunReadOnlyAgentInput['context']
}): AgentModelAdapter {
  return {
    complete: async (messages, signal) => {
      const result: ChatResult = {}
      const content = await chat(
        messages,
        input.config,
        {
          ...input.meta,
          category: 'agent.readonly',
          projectId: input.context.projectId,
          contextOverflowPolicy: 'reject',
        },
        signal,
        result,
      )
      return { content, usage: result.usage }
    },
  }
}

/**
 * Provider-neutral protocol transport.
 *
 * The safe baseline is strict JSON actions over the existing text client, so every configured
 * text-capable provider shares one auditable behavior. Native tools can be added later as a
 * capability-probed optimization without changing Runner.
 */
export function runReadOnlyAgentWithClient(input: RunReadOnlyAgentWithClientInput) {
  const { config, meta, ...runnerInput } = input
  return runReadOnlyAgent({
    ...runnerInput,
    model: clientModel({ config, meta, context: input.context }),
  })
}

/** Durable transport adapter; protocol and tool execution still use the same Runner. */
export function runDurableReadOnlyAgentWithClientV1(
  input: RunDurableReadOnlyAgentWithClientInputV1,
) {
  const { config, meta, ...runnerInput } = input
  return runDurableReadOnlyAgentV1({
    ...runnerInput,
    model: clientModel({ config, meta, context: input.context }),
    executionBinding: {
      provider: config.provider,
      model: config.model,
      adapterVersion: 'chat-client-v1',
    },
  })
}
