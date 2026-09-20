import {
  assertAgentSkillExecutionBindingIntegrityV2,
  projectFrozenAgentSkillDefinitionV1,
} from '../agent/execution-binding'
import { executeFrozenFormalAIEntryV1 } from '../agent/formal-ai-entry'
import type { AgentRunStepExecutionBindingV2 } from '../types/agent-run'
import type { AIConfig, ChatMessage } from '../types'
import {
  resolveRequestConfig,
  type ChatResult,
  type AIRequestConfigResolution,
} from '../ai/client'
import {
  TextOpenWorldRuntimeAIExecutionErrorV1,
  type TextOpenWorldRuntimeAIExecutionObservationV1,
} from './runtime-ai-error'
export {
  TextOpenWorldRuntimeAIExecutionErrorV1,
  type TextOpenWorldRuntimeAIExecutionObservationV1,
} from './runtime-ai-error'
import {
  getTextOpenWorldRuntimeAISkillContractV1,
  type TextOpenWorldRuntimeAISkillIdV1,
} from './runtime-ai-contract'

// G6-02 extends this existing headless runtime-AI boundary with the exact
// Context Gateway preparation API. Keeping the export here makes the governed
// packet builder reachable without pulling it into a player route before
// G6-03 starts adopting intent candidates.
export {
  createTextOpenWorldRuntimeAIContextBaseManifestV2,
  prepareTextOpenWorldRuntimeAIContextV1,
  type TextOpenWorldRuntimeAIContextPreparationV1,
  type TextOpenWorldRuntimeAIContextRequestV1,
  type TextOpenWorldRuntimeAIContextSelectionV1,
} from './runtime-ai-context'

function fail(message: string): never {
  throw new Error(`[text-open-world-runtime-ai-execution] ${message}`)
}

function routeCategory(skillId: TextOpenWorldRuntimeAISkillIdV1): string {
  return getTextOpenWorldRuntimeAISkillContractV1(skillId).model.routeCategory
}

function createTimedSignal(input: {
  signal?: AbortSignal
  timeoutMs: number
}): {
  signal: AbortSignal
  timedOut: () => boolean
  dispose: () => void
} {
  const controller = new AbortController()
  let timeoutReached = false
  const abortFromCaller = () => controller.abort(input.signal?.reason)
  if (input.signal?.aborted) abortFromCaller()
  else input.signal?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = globalThis.setTimeout(() => {
    timeoutReached = true
    controller.abort(new DOMException('文字开放世界运行时 AI 调用超时', 'TimeoutError'))
  }, input.timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timeoutReached,
    dispose: () => {
      globalThis.clearTimeout(timer)
      input.signal?.removeEventListener('abort', abortFromCaller)
    },
  }
}

function observation(input: {
  resolved: AIRequestConfigResolution
  category: string
  result: ChatResult
  startedAt: number
  timedOut: boolean
}): TextOpenWorldRuntimeAIExecutionObservationV1 {
  return {
    version: 1,
    provider: input.resolved.config.provider,
    model: input.resolved.config.model,
    routeCategory: input.category,
    startedAt: input.startedAt,
    finishedAt: Date.now(),
    timedOut: input.timedOut,
    requestLifecycle: input.result.requestLifecycle
      ?? { phase: 'pre-dispatch', responseStatus: null },
    usage: input.result.usage ? { ...input.result.usage } : null,
  }
}

/**
 * The only provider gateway for vNext text-open-world runtime AI Skills.
 *
 * The caller must supply the frozen V2 Skill and formal-entry snapshots from
 * the accepted RunContract. This gateway returns a strict-JSON candidate only;
 * it cannot commit Actions, Events, Effects, memory, dialogue, or quest state.
 */
export async function executeTextOpenWorldRuntimeAISkillV1(input: {
  skillId: TextOpenWorldRuntimeAISkillIdV1
  executionBinding: AgentRunStepExecutionBindingV2
  messages: ChatMessage[]
  aiConfig: AIConfig
  projectId: number
  signal?: AbortSignal
}): Promise<string> {
  if (!Number.isSafeInteger(input.projectId) || input.projectId < 1) fail('projectId 无效')
  if (!Array.isArray(input.messages) || input.messages.length === 0) fail('messages 不能为空')
  await assertAgentSkillExecutionBindingIntegrityV2(
    input.executionBinding,
    '文字开放世界运行时 AI frozen binding',
  )
  const registered = getTextOpenWorldRuntimeAISkillContractV1(input.skillId)
  if (input.executionBinding.skillId !== registered.skillId) fail('请求的 Skill 与冻结 binding 不匹配')
  const frozenSkill = projectFrozenAgentSkillDefinitionV1(input.executionBinding)
  const formalEntry = input.executionBinding.formalEntry ?? fail('冻结 binding 缺少正式 AI 入口')
  const category = routeCategory(input.skillId)
  const request = {
    projectId: input.projectId,
    configOverrides: { maxTokens: registered.budget.maxOutputTokens },
    contextOverflowPolicy: 'reject' as const,
  }
  const options = { responseFormat: 'json_object' as const }
  const meta = { category, ...request }
  // Resolve exactly once per Run attempt. The frozen resolution is kept only
  // in memory because it may contain a credential; durable evidence stores the
  // frozen Skill/entry plus provider-safe request lifecycle, never the key.
  const resolved = resolveRequestConfig(input.aiConfig, meta)
  const result: ChatResult = {}
  const timed = createTimedSignal({ signal: input.signal, timeoutMs: registered.budget.maxDurationMs })
  const startedAt = Date.now()
  try {
    switch (input.skillId) {
      case 'prose.text-open-world-runtime-intent':
        return await executeFrozenFormalAIEntryV1(
          'text-open-world.runtime.intent', formalEntry, frozenSkill, 'src/lib/open-world/runtime-ai-execution.ts',
          input.messages, input.aiConfig, { category: 'runtime.text-open-world.intent', ...request },
          timed.signal, result, options, resolved,
        )
      case 'prose.text-open-world-runtime-dialogue':
        return await executeFrozenFormalAIEntryV1(
          'text-open-world.runtime.dialogue', formalEntry, frozenSkill, 'src/lib/open-world/runtime-ai-execution.ts',
          input.messages, input.aiConfig, { category: 'runtime.text-open-world.dialogue', ...request },
          timed.signal, result, options, resolved,
        )
      case 'prose.text-open-world-runtime-expression':
        return await executeFrozenFormalAIEntryV1(
          'text-open-world.runtime.expression', formalEntry, frozenSkill, 'src/lib/open-world/runtime-ai-execution.ts',
          input.messages, input.aiConfig, { category: 'runtime.text-open-world.expression', ...request },
          timed.signal, result, options, resolved,
        )
      case 'prose.text-open-world-runtime-quest-packaging':
        return await executeFrozenFormalAIEntryV1(
          'text-open-world.runtime.quest-packaging', formalEntry, frozenSkill, 'src/lib/open-world/runtime-ai-execution.ts',
          input.messages, input.aiConfig, { category: 'runtime.text-open-world.quest-packaging', ...request },
          timed.signal, result, options, resolved,
        )
      case 'prose.text-open-world-runtime-direction':
        return await executeFrozenFormalAIEntryV1(
          'text-open-world.runtime.direction', formalEntry, frozenSkill, 'src/lib/open-world/runtime-ai-execution.ts',
          input.messages, input.aiConfig, { category: 'runtime.text-open-world.direction', ...request },
          timed.signal, result, options, resolved,
        )
      case 'prose.text-open-world-runtime-memory':
        return await executeFrozenFormalAIEntryV1(
          'text-open-world.runtime.memory', formalEntry, frozenSkill, 'src/lib/open-world/runtime-ai-execution.ts',
          input.messages, input.aiConfig, { category: 'runtime.text-open-world.memory', ...request },
          timed.signal, result, options, resolved,
        )
      default:
        return fail(`未登记运行时 Skill ${String(input.skillId)}`)
    }
  } catch (error) {
    throw new TextOpenWorldRuntimeAIExecutionErrorV1(error, observation({
      resolved,
      category,
      result,
      startedAt,
      timedOut: timed.timedOut(),
    }))
  } finally {
    timed.dispose()
  }
}
