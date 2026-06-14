/**
 * 高级模式开关（H2.0 — 暴露 budget / 截断阈值之前的总闸）
 *
 * 设计目标：
 * - 默认关闭，避免普通用户面对一长串内部参数。
 * - 持久化在 localStorage，跨页面 / 刷新保留。
 * - 跨组件订阅同一份状态：在「高级设置」面板切换后，其他面板（例如未来要加的
 *   「查看注入 prompt」按钮）能实时响应。
 *
 * 注意：硬截断阈值在各业务面板上的「文本提示」与「超限警告」并不依赖此开关，
 * 它们始终对所有用户可见（参见 H3 步骤）。本开关只控制：
 *   - 设置 → 高级设置 子面板里的 budget 集中展示；
 *   - 大纲 / 正文生成面板上的「查看注入 prompt」按钮（H4）；
 *   - 高级设置子面板里的 budget / 截断长度调整入口（H5）。
 */
import { useEffect, useState } from 'react'

const STORAGE_KEY = 'storyforge.advancedMode'
const EVENT_NAME = 'storyforge:advanced-mode-change'

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** 同步读取（非 React 上下文也可用，例如 SettingsPage 之外的工具函数）。 */
export function isAdvancedModeEnabled(): boolean {
  return readInitial()
}

/** 写入新值并广播同窗口事件（跨标签页则依赖原生 storage 事件）。 */
export function setAdvancedModeEnabled(next: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0')
  } catch {
    /* localStorage 满 / 隐私模式 → 静默失败，本次会话仍可用内存值 */
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }))
}

/** React 组件用的订阅 hook。 */
export function useAdvancedMode(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(readInitial)

  useEffect(() => {
    const onCustom = (e: Event) => {
      const ce = e as CustomEvent<boolean>
      setEnabled(!!ce.detail)
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setEnabled(e.newValue === '1')
    }
    window.addEventListener(EVENT_NAME, onCustom)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVENT_NAME, onCustom)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const setter = (next: boolean) => {
    setAdvancedModeEnabled(next)
    setEnabled(next) // 当前组件立即生效（不等事件 round-trip）
  }
  return [enabled, setter]
}
