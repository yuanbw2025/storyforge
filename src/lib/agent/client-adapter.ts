import {
  chat,
  estimateChatRequestOptionsTokens,
  resolveRequestConfig,
  type AICallMeta,
  type AIRequestConfigResolution,
  type ChatRequestOptions,
  type ChatResult,
} from '../ai/client'
import { getAIProviderCapabilityProfileV1 } from '../ai/provider-capabilities'
import type { AIConfig } from '../types'
import {
  runDurableReadOnlyAgentV1,
  type RunDurableReadOnlyAgentInputV1,
} from './run/read-only-durable'
import {
  runReadOnlyAgent,
  type AgentModelAdapter,
  type AgentModelTransportV1,
  type RunReadOnlyAgentInput,
} from './runner'
import { AGENT_READ_TOOLS } from './tool-registry'
import {
  buildNativeAgentSystemPrompt,
  parseAgentProtocolActionValue,
  parseNativeAgentToolCalls,
} from './protocol'
import { hashCanonicalValue } from './run/hash'

export const NATIVE_READ_TOOLS_STORAGE_KEY_V1 = 'storyforge:harness:native-read-tools-v1'
export type AgentToolTransportPreferenceV1 = 'auto' | AgentModelTransportV1

export interface RunReadOnlyAgentWithClientInput extends Omit<RunReadOnlyAgentInput, 'model'> {
  config: AIConfig
  meta?: AICallMeta
  transport?: AgentToolTransportPreferenceV1
}

export interface RunDurableReadOnlyAgentWithClientInputV1 extends Omit<
  RunDurableReadOnlyAgentInputV1,
  'model' | 'executionBinding'
> {
  config: AIConfig
  meta?: AICallMeta
  transport?: AgentToolTransportPreferenceV1
}

function nativeToolsEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem(NATIVE_READ_TOOLS_STORAGE_KEY_V1) === 'enabled'
  } catch {
    return false
  }
}

export function resolveAgentToolTransportV1(input: {
  config: Pick<AIConfig, 'provider'>
  preference?: AgentToolTransportPreferenceV1
}): AgentModelTransportV1 {
  const preference = input.preference ?? 'auto'
  if (preference === 'text-json-v1') return 'text-json-v1'
  const capability = getAIProviderCapabilityProfileV1(input.config.provider)
  if (preference === 'native-tools-v1') {
    if (capability.nativeToolCalls !== 'supported') {
      throw new Error(`${input.config.provider} 尚无 StoryForge 原生工具调用合同证据`)
    }
    return 'native-tools-v1'
  }
  return nativeToolsEnabled() && capability.nativeToolCalls === 'supported'
    ? 'native-tools-v1'
    : 'text-json-v1'
}

function nativeToolOptions(): ChatRequestOptions {
  return {
    toolChoice: 'auto',
    tools: AGENT_READ_TOOLS.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    })),
  }
}

function readOnlyCallMeta(
  meta: AICallMeta | undefined,
  projectId: number,
): AICallMeta {
  return {
    ...meta,
    category: 'agent.readonly',
    projectId,
    contextOverflowPolicy: 'reject',
  }
}

function clientModel(input: {
  resolution: AIRequestConfigResolution
  meta?: AICallMeta
  context: RunReadOnlyAgentInput['context']
  transport: AgentModelTransportV1
}): AgentModelAdapter {
  const options = input.transport === 'native-tools-v1' ? nativeToolOptions() : undefined
  return {
    transport: input.transport,
    ...(options ? {
      systemPrompt: buildNativeAgentSystemPrompt(),
      requestOverheadTokens: estimateChatRequestOptionsTokens(options),
    } : {}),
    complete: async (messages, signal) => {
      const result: ChatResult = {}
      const content = await chat(
        messages,
        input.resolution.config,
        {
          ...input.meta,
          category: 'agent.readonly',
          projectId: input.context.projectId,
          contextOverflowPolicy: 'reject',
        },
        signal,
        result,
        options,
        input.resolution,
      )
      if (!options) return { content, usage: result.usage }

      const traceContent = !result.toolCallsPresent
        ? content
        : JSON.stringify({ toolCalls: result.toolCalls })
      try {
        const action = result.toolCallsPresent || result.finishReason === 'tool_calls'
          ? parseNativeAgentToolCalls(result.toolCalls)
          : parseAgentProtocolActionValue({ type: 'final', answer: content })
        return {
          content: action.type === 'tool' ? JSON.stringify(action) : content,
          usage: result.usage,
          action,
        }
      } catch (error) {
        return {
          content: traceContent,
          usage: result.usage,
          protocolError: error instanceof Error ? error.message : '原生工具响应不合法',
        }
      }
    },
  }
}

/**
 * Provider-neutral protocol transport.
 *
 * The safe baseline is strict JSON actions over the existing text client, so every configured
 * text-capable provider shares one auditable behavior. Verified providers may opt into native
 * tool calls as a transport optimization without changing the Runner or tool execution gate.
 */
export function runReadOnlyAgentWithClient(input: RunReadOnlyAgentWithClientInput) {
  const { config, meta, transport: preference, ...runnerInput } = input
  const requestMeta = readOnlyCallMeta(meta, input.context.projectId)
  const resolution = resolveRequestConfig(config, requestMeta)
  const transport = resolveAgentToolTransportV1({ config: resolution.config, preference })
  return runReadOnlyAgent({
    ...runnerInput,
    model: clientModel({ resolution, meta: requestMeta, context: input.context, transport }),
  })
}

/** Durable transport adapter; protocol and tool execution still use the same Runner. */
export async function runDurableReadOnlyAgentWithClientV1(
  input: RunDurableReadOnlyAgentWithClientInputV1,
) {
  const { config, meta, transport: preference, ...runnerInput } = input
  const requestMeta = readOnlyCallMeta(meta, input.context.projectId)
  const resolution = resolveRequestConfig(config, requestMeta)
  const transport = resolveAgentToolTransportV1({ config: resolution.config, preference })
  const capabilityProfile = getAIProviderCapabilityProfileV1(resolution.config.provider)
  return await runDurableReadOnlyAgentV1({
    ...runnerInput,
    model: clientModel({ resolution, meta: requestMeta, context: input.context, transport }),
    executionBinding: {
      provider: resolution.config.provider,
      model: resolution.config.model,
      adapterVersion: transport === 'native-tools-v1'
        ? 'chat-client-native-tools-v1'
        : 'chat-client-text-json-v1',
      capabilityProfileHash: await hashCanonicalValue(capabilityProfile),
    },
  })
}
