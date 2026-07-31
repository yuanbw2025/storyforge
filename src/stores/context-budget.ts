import { create } from 'zustand'

/**
 * 提示词预算覆盖（设置区「提示词预算」面板）。
 *
 * - overrides: 以 sourceKey → budgetTokens 覆盖 CONTEXT_SOURCES 中的默认单源预算；
 * - totalBudget: 覆盖总窗口输入预算（deriveInputBudget 的结果），影响分层裁剪。
 * 由 assemble-context.ts 消费时应用。
 * 存储于 localStorage —— 全局、非项目级设置，与 ai-config.ts 同构。
 */
const STORAGE_KEY = 'storyforge-context-budget'

export type ContextBudgetOverrides = Record<string, number>

interface PersistedState {
  overrides: ContextBudgetOverrides
  totalBudget: number | null
}

function sanitizeBudget(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 && Number.isInteger(n) ? n : null
}

function sanitizeOverrides(raw: unknown): ContextBudgetOverrides {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ContextBudgetOverrides = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = sanitizeBudget(value)
    if (n != null) out[key] = n
  }
  return out
}

/** 从 localStorage 加载；兼容旧格式（纯 sourceKey→number 对象）与新格式（{ overrides, totalBudget }）。 */
function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { overrides: {}, totalBudget: null }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { overrides: {}, totalBudget: null }
    if ('overrides' in parsed || 'totalBudget' in parsed) {
      return {
        overrides: sanitizeOverrides((parsed as PersistedState).overrides),
        totalBudget: sanitizeBudget((parsed as PersistedState).totalBudget),
      }
    }
    // 旧格式：纯 record → 全部视为单源覆盖
    return { overrides: sanitizeOverrides(parsed), totalBudget: null }
  } catch {
    return { overrides: {}, totalBudget: null }
  }
}

function persistState(state: PersistedState): void {
  try {
    const hasOverrides = Object.keys(state.overrides).length > 0
    const hasTotal = state.totalBudget != null
    if (!hasOverrides && !hasTotal) {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }
  } catch {
    /* ignore */
  }
}

interface ContextBudgetStore {
  overrides: ContextBudgetOverrides
  /** 总窗口输入预算覆盖（null = 按模型预设自动计算）。 */
  totalBudget: number | null
  /** 设置/更新某个源的预算覆盖；value 为空（null/undefined/<=0/非整数）时清除该覆盖。 */
  setOverride: (key: string, value: number | null | undefined) => void
  /** 设置总窗口预算覆盖；value 为空（null/undefined/<=0/非整数）时恢复按模型预设计算。 */
  setTotalBudget: (value: number | null | undefined) => void
  /** 重置全部（单源覆盖 + 总窗口预算），恢复所有默认值。 */
  resetAll: () => void
}

const initial = loadState()

export const useContextBudgetStore = create<ContextBudgetStore>((set, get) => ({
  overrides: initial.overrides,
  totalBudget: initial.totalBudget,

  setOverride: (key, value) => {
    const next = { ...get().overrides }
    const valid = value != null && Number.isFinite(value) && value > 0 && Number.isInteger(value)
    if (valid) next[key] = value as number
    else delete next[key]
    persistState({ overrides: next, totalBudget: get().totalBudget })
    set({ overrides: next })
  },

  setTotalBudget: (value) => {
    const next = sanitizeBudget(value)
    persistState({ overrides: get().overrides, totalBudget: next })
    set({ totalBudget: next })
  },

  resetAll: () => {
    persistState({ overrides: {}, totalBudget: null })
    set({ overrides: {}, totalBudget: null })
  },
}))

/** 非 React 环境读取当前单源覆盖值（assemble-context 消费点使用，调用即取最新状态）。 */
export function getContextBudgetOverrides(): ContextBudgetOverrides {
  return useContextBudgetStore.getState().overrides
}

/** 非 React 环境读取当前总窗口预算覆盖（null = 未覆盖，按模型预设计算）。 */
export function getTotalBudgetOverride(): number | null {
  return useContextBudgetStore.getState().totalBudget
}
