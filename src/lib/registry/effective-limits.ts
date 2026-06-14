/**
 * Effective limits（H5 — budget / 截断阈值的可调整层）
 *
 * 思路：
 *   - 所有硬截断仍然写在原 reader / formatter / context-source 里作为 **默认值**。
 *   - 这里只提供 `getEffectiveLimit(key, defaultValue)`：若用户在「高级设置」改过该 key
 *     则返回用户值，否则返回默认值。
 *   - 用户值持久化在 localStorage；改完立即广播 CustomEvent，业务侧拉取一次新值即可。
 *
 * key 命名规则与 budget-config.ts 中的 leaf 路径一致：
 *   - 单值 entry：直接用 `key`，例如 'src.contextMemo' / 'assemble.defaultInputBudget'
 *   - 对象型 entry：用 `parentKey.subFieldName`，例如 'reader.foreshadows.最多条数'
 *     这样 budget-config 里的对象型 entry（如 reader.storyArcs 含 4 个子字段）
 *     可以分别被独立调整。
 *
 * 该文件本身保持纯同步访问，避免在热路径上引入异步代价。
 */
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'storyforge.effectiveLimits.v1'
const EVENT_NAME = 'storyforge:effective-limits-change'

type Snapshot = Record<string, number>

let _cache: Snapshot | null = null

function load(): Snapshot {
  if (_cache) return _cache
  if (typeof window === 'undefined') return (_cache = {})
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return (_cache = {})
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      const cleaned: Snapshot = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) cleaned[k] = v
      }
      return (_cache = cleaned)
    }
    return (_cache = {})
  } catch {
    return (_cache = {})
  }
}

function persist(snapshot: Snapshot): void {
  _cache = snapshot
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    /* 满 / 隐私模式 → 静默失败，本会话仍可读 _cache */
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

/** 同步获取生效值；若未被覆盖则返回 fallback。 */
export function getEffectiveLimit(key: string, fallback: number): number {
  const snap = load()
  const v = snap[key]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
}

/** 写入一个覆盖；传 undefined / null / NaN 则视为"恢复默认"。 */
export function setEffectiveLimit(key: string, value: number | null | undefined): void {
  const snap = { ...load() }
  if (value == null || !Number.isFinite(value) || value <= 0) {
    delete snap[key]
  } else {
    snap[key] = Math.round(value)
  }
  persist(snap)
}

/** 一次性恢复所有默认值。 */
export function resetAllEffectiveLimits(): void {
  persist({})
}

/** 获取当前完整快照（高级设置面板用以渲染输入框）。 */
export function getEffectiveLimitsSnapshot(): Snapshot {
  return { ...load() }
}

/** 订阅入口（高级设置面板自身需要重渲染） */
export function onEffectiveLimitsChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => listener()
  window.addEventListener(EVENT_NAME, handler)
  // 跨标签页
  const onStorage = (e: StorageEvent) => { if (e.key === STORAGE_KEY) { _cache = null; listener() } }
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT_NAME, handler)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * React hook —— 在组件里读 effective limit，自动订阅变化并触发重渲染。
 * 用于业务面板的字段提示 / 超限警告，使「高级设置」改完之后立即对齐。
 */
export function useEffectiveLimit(key: string, fallback: number): number {
  const [value, setValue] = useState<number>(() => getEffectiveLimit(key, fallback))
  useEffect(() => {
    return onEffectiveLimitsChange(() => setValue(getEffectiveLimit(key, fallback)))
  }, [key, fallback])
  return value
}
