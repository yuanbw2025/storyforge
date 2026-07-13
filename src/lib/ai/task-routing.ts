import type { AIConfig, AIConfigPreset } from '../types'
import { aiProviderAllowsEmptyKey } from './config-readiness'

export const AI_TASK_KINDS = ['creation', 'extraction', 'analysis', 'review'] as const

export type AITaskKind = typeof AI_TASK_KINDS[number]
export type AITaskRoutes = Partial<Record<AITaskKind, string>>

export interface ResolvedAITaskConfig {
  config: AIConfig
  taskKind: AITaskKind | null
  presetId: string | null
  fallbackReason?: 'missing-preset' | 'missing-api-key'
}

const EXTRACTION_PREFIXES = [
  'state.extract',
  'fact.extract',
  'inventory.extract',
  'relation.extract',
  'codex.extract',
  'location.extract',
  'story.timeline',
  'chapter.memory',
  'character.structure',
  'foreshadow.structure',
  'ai.restructure',
  'import.',
]

const ANALYSIS_PREFIXES = [
  'reference.',
  'summary.',
  'style.learn',
  'prompt.examples',
  'retrieval.',
]

const REVIEW_PREFIXES = [
  'review.',
  'scene.verify',
  'history.consult',
  'chapter.deai',
  'consistency.',
]

const CREATION_PREFIXES = [
  'chapter.',
  'outline.',
  'detail.',
  'worldview.',
  'world-group.',
  'character.',
  'story.',
  'story-arc.',
  'rules.',
  'foreshadow.',
  'geography.',
  'history.storm',
  'technology',
  'emotion.beat',
  'inspiration.',
]

function matchesPrefix(category: string, prefixes: readonly string[]): boolean {
  return prefixes.some(prefix => category === prefix || category.startsWith(prefix))
}

/** Unknown categories deliberately stay on the global model until explicitly classified. */
export function classifyAITask(category?: string): AITaskKind | null {
  const normalized = category?.trim().toLowerCase()
  if (!normalized) return null
  if (matchesPrefix(normalized, EXTRACTION_PREFIXES)) return 'extraction'
  if (matchesPrefix(normalized, ANALYSIS_PREFIXES)) return 'analysis'
  if (matchesPrefix(normalized, REVIEW_PREFIXES)) return 'review'
  if (matchesPrefix(normalized, CREATION_PREFIXES)) return 'creation'
  return null
}

export function sanitizeAITaskRoutes(value: unknown): AITaskRoutes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const raw = value as Record<string, unknown>
  const routes: AITaskRoutes = {}
  for (const taskKind of AI_TASK_KINDS) {
    if (typeof raw[taskKind] === 'string' && raw[taskKind].trim()) {
      routes[taskKind] = raw[taskKind].trim()
    }
  }
  return routes
}

function isSameConnection(left: AIConfig, right: AIConfig): boolean {
  return left.provider === right.provider
    && left.baseUrl.replace(/\/+$/, '') === right.baseUrl.replace(/\/+$/, '')
    && left.model === right.model
}

function preserveCallOverrides(
  routed: AIConfig,
  requested: AIConfig,
  globalConfig: AIConfig,
  explicitOverrides?: Partial<AIConfig>,
): AIConfig {
  const next = { ...routed }
  for (const key of ['temperature', 'maxTokens', 'contextWindow'] as const) {
    if (requested[key] !== globalConfig[key]) {
      next[key] = requested[key] as never
    }
  }
  return explicitOverrides ? { ...next, ...explicitOverrides } : next
}

/**
 * Resolves a routed preset at the shared client boundary.
 * Connection fields come from the preset; per-call generation overrides remain intact.
 */
export function resolveAIConfigForTask(args: {
  category?: string
  requestedConfig: AIConfig
  globalConfig: AIConfig
  presets: readonly AIConfigPreset[]
  routes: AITaskRoutes
  explicitOverrides?: Partial<AIConfig>
}): ResolvedAITaskConfig {
  const taskKind = classifyAITask(args.category)
  if (!taskKind) {
    return { config: args.requestedConfig, taskKind: null, presetId: null }
  }

  const presetId = args.routes[taskKind]
  if (!presetId) {
    return { config: args.requestedConfig, taskKind, presetId: null }
  }

  const preset = args.presets.find(item => item.id === presetId)
  if (!preset) {
    return {
      config: args.requestedConfig,
      taskKind,
      presetId: null,
      fallbackReason: 'missing-preset',
    }
  }

  let routed = { ...preset.config }
  if (!routed.apiKey && !aiProviderAllowsEmptyKey(routed.provider)) {
    if (!args.globalConfig.apiKey || !isSameConnection(routed, args.globalConfig)) {
      return {
        config: args.requestedConfig,
        taskKind,
        presetId: null,
        fallbackReason: 'missing-api-key',
      }
    }
    routed = { ...routed, apiKey: args.globalConfig.apiKey }
  }

  return {
    config: preserveCallOverrides(
      routed,
      args.requestedConfig,
      args.globalConfig,
      args.explicitOverrides,
    ),
    taskKind,
    presetId,
  }
}
